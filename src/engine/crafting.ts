// Crafting house (pure): pipes that turn materials into crafted items on engine time, beside everything else. Data in
// config/crafting.ts; see docs/ENGINE.md ("Crafting").
//
// Material jobs (1.15.0) are continuous: no quantity, no mode. A pipe crafts its recipe until STOP_CRAFT.
//   START_CRAFT   opens the job in a pipe (named, or the first free open one); its first craft starts now or waits
//   each craft    takes its inputs WHEN IT STARTS (prepaid crafts from the v15 migration first) and its duration is
//                 computed right then; with too few inputs the pipe is `waiting`: no time passes, nothing is taken, and
//                 it starts the instant the inputs are there (a gather or crew event, another pipe's output, a command)
//   world walk    each running pipe advances on the granted time; a finished craft delivers its output (or holds the
//                 pipe while the output does not fit), then the next craft starts or waits, in pipe order
//   X10_CRAFT     on the craft in progress: 9× more inputs now + max(1, ceil(9 × craft minutes)) stamina → 10× output;
//                 only that craft (the next is ×1 again)
//   INSTA_CRAFT   ceil(remaining minutes) stamina finishes the current craft now (also a ×10 one)
//   STOP_CRAFT    ends a material job: refunds the inputs of the craft in progress (×10 included) and any prepaid ones
//   COLLECT_CRAFT a ready gear piece goes into the inventory (Done)
//
// Gear jobs (1.14.0, unchanged): one piece, any invested stamina (0..50) paid at start and never refunded. Its quality (a
// uniform integer in [floor, 100], floor = 1 per stamina + minQuality, capped at 100) and rarity are rolled
// at START_CRAFT with the seeded RNG and stored on the job. When the craft finishes the job turns `ready`: the pipe holds
// the piece (live and offline) until COLLECT_CRAFT moves it into the inventory. Insta takes it to `ready`; CANCEL_CRAFT
// refunds its inputs (a ready job cannot be cancelled).
//
// Pipes are NOT an activity: they never use the hero and never stop (or get stopped by) gathering, dungeons or
// training. They share one inventory: at one instant they draw their inputs in pipe order, after the hero, the builder
// and the crews (see world.ts).
import { intCraftReductionBp } from './attributes';
import { levelBonuses } from './bonuses';
import { consumeItem, isBuilt } from './buildings';
import { BUILDINGS } from './config/buildings';
import { CRAFTING, isRecipeId, RECIPE_IDS, RECIPES, type RecipeDef, type RecipeId } from './config/crafting';
import { GEAR } from './config/gear';
import { getItemDef } from './config/items';
import { BASIS_POINTS } from './config/stats';
import { gearStatsAt, type GearStats, rarityOdds, rollQuality, rollRarity } from './gear';
import { addStackable, freeSlots, makeItem } from './inventory';
import { itemQuantity } from './selectors';
import type { CraftingState, CraftJob, GameEvent, GameState, Inventory, ItemRarity, SimulationSummary } from './types';

export type CraftErrorCode =
  | 'BUILDING_LOCKED'
  | 'INVALID_COMMAND'
  | 'INVALID_AMOUNT'
  | 'PIPE_LOCKED'
  | 'PIPE_BUSY'
  | 'ALL_PIPES_BUSY'
  | 'UNKNOWN_RECIPE'
  | 'NOT_ENOUGH_ITEMS'
  | 'NOT_ENOUGH_STAMINA'
  | 'COST_CHANGED'
  | 'NO_CRAFT_JOB'
  | 'CRAFT_CHANGED'
  | 'CRAFT_WAITING'
  | 'ALREADY_X10'
  | 'INVENTORY_FULL'
  | 'PIPES_MAXED'
  | 'CRAFT_READY'
  | 'CRAFT_NOT_READY';

export type CraftError = { code: CraftErrorCode; message: string } | null;

const err = (code: CraftErrorCode, message: string): CraftError => ({ code, message });

type ItemAmount = { defId: string; quantity: number };

// ---------- state ----------

/** A new save: 2 open pipes of 8, all idle, an empty fraction ledger. */
export function newCraftingState(): CraftingState {
  return { pipesUnlocked: CRAFTING.startPipes, pipes: Array.from({ length: CRAFTING.pipeSlots }, () => null), remainders: {}, nextJobSerial: 1 };
}

// ---------- numbers ----------

/** The house level's craft time multiplier, bp (10 000 while it gives none). */
export function houseTimeBp(state: Pick<GameState, 'buildings'>): number {
  return levelBonuses(state, 'crafting').craftTimeBp ?? BASIS_POINTS;
}

/** The house level's extra output of normal items, bp (0 below Lv4). */
export function houseYieldBp(state: Pick<GameState, 'buildings'>): number {
  return levelBonuses(state, 'crafting').craftYieldBp ?? 0;
}

/**
 * Craft time, ms: max(minCraftMs, ceil(baseMs × timeBp / 10 000 × (10 000 − intBp) / 10 000)). The two reductions
 * multiply. Integer math: the product stays far below 2^53 (80 000 × 10 000 × 10 000 = 8e12).
 */
export function craftMsFor(baseMs: number, timeBp: number, intBp: number): number {
  const scaled = baseMs * Math.max(0, timeBp) * Math.max(0, BASIS_POINTS - intBp);
  return Math.max(CRAFTING.minCraftMs, Math.ceil(scaled / (BASIS_POINTS * BASIS_POINTS)));
}

/** Effective craft time of a recipe right now (house level and core INT). */
export function craftMs(state: GameState, recipeId: RecipeId): number {
  return craftMsFor(RECIPES[recipeId].baseMs, houseTimeBp(state), intCraftReductionBp(state));
}

/** ×10 tap stamina for a craft of `ms`: max(1, ceil(9 × craft ms ÷ 1 min)). */
export function x10StaminaPerCraft(ms: number): number {
  const perMin = CRAFTING.x10.staminaPerMinute;
  return Math.max(1, Math.ceil((perMin * Math.max(0, ms)) / 60_000));
}

/** Insta cost: staminaPerStep per started minute left, at least one step (the rule of every skip). */
export function instaCost(remainingMs: number): number {
  const { stepMs, staminaPerStep } = CRAFTING.insta;
  return Math.max(1, Math.ceil(Math.max(0, remainingMs) / stepMs)) * staminaPerStep;
}

/** Inputs of `crafts` x1 crafts. */
function inputsFor(recipe: RecipeDef, crafts: number): ItemAmount[] {
  return recipe.inputs.map((i) => ({ defId: i.defId, quantity: i.quantity * crafts }));
}

/** Inputs short for `crafts` x1 crafts right now (have < need), in recipe order. */
function shortInputs(state: GameState, recipe: RecipeDef, crafts: number): { defId: string; have: number; need: number }[] {
  return inputsFor(recipe, crafts)
    .map((i) => ({ defId: i.defId, have: itemQuantity(state, i.defId), need: i.quantity }))
    .filter((i) => i.have < i.need);
}

const nameOf = (defId: string) => getItemDef(defId)?.name ?? defId;

/** Can a stackable item go into the inventory (an existing stack, or a free slot)? */
function canAdd(inventory: Inventory, defId: string): boolean {
  return inventory.items.some((i) => i.stackable && i.defId === defId) || inventory.items.length < inventory.capacity;
}

/** Refunds that would need more new stacks than there are free slots: how many slots are missing (0 = fits). */
function slotsShort(inventory: Inventory, items: ItemAmount[]): number {
  const newStacks = new Set(items.filter((i) => i.quantity > 0 && !inventory.items.some((it) => it.stackable && it.defId === i.defId)).map((i) => i.defId));
  return Math.max(0, newStacks.size - freeSlots(inventory));
}

/** Bonus to every gear craft's quality floor, percent points (a hook for later upgrades; GEAR.craft.minQuality, 0 for now). */
export function minQuality(_state: Pick<GameState, 'buildings'>): number {
  return GEAR.craft.minQuality;
}

/** A gear craft's quality floor, percent: 1 per invested stamina + minQuality, capped at 100. The screen reads this too. */
export function gearQualityFloor(state: Pick<GameState, 'buildings'>, stamina: number): number {
  return Math.min(GEAR.maxQuality, Math.max(0, stamina) * GEAR.craft.qualityPerStamina + minQuality(state));
}

/** The rarity odds of a gear recipe: its own, else the default (uncommon 75 / rare 20 / epic 5). */
export function gearRarityWeights(recipe: RecipeDef) {
  return recipe.rarityWeights ?? GEAR.craft.rarityWeights;
}

// ---------- a material craft starting (shared by START_CRAFT, delivery, the walk and settling) ----------

/**
 * The material job in pipe `index` is between crafts (just started, just delivered, or waiting): its next craft starts
 * now if it can be paid (a prepaid craft first, else the recipe's inputs, taken now), with its duration read right now;
 * otherwise the pipe waits (`CRAFT_WAITING` once). Returns whether a craft started. Mutates `draft` (the crafting slice
 * and the inventory must already be the caller's copies).
 */
function startNextCraft(draft: GameState, index: number, job: CraftJob, events: GameEvent[]): boolean {
  if (!isRecipeId(job.recipeId)) return false;
  const recipe = RECIPES[job.recipeId];
  if ((job.prepaid ?? 0) > 0) {
    job.prepaid = (job.prepaid ?? 0) - 1;
    if (job.prepaid <= 0) delete job.prepaid;
  } else if (shortInputs(draft, recipe, 1).length > 0) {
    if (job.status !== 'waiting') {
      job.status = 'waiting';
      events.push({ type: 'CRAFT_WAITING', pipe: index, jobId: job.id });
    }
    job.craftMs = 0;
    job.progressMs = 0;
    job.x10 = false;
    return false;
  } else {
    for (const i of recipe.inputs) consumeItem(draft, i.defId, i.quantity);
  }
  // Each craft's duration is fixed when it starts: an upgrade or trained INT counts from here.
  job.craftMs = craftMs(draft, job.recipeId);
  job.progressMs = 0;
  job.x10 = false;
  job.status = 'running';
  return true;
}

// ---------- delivery (shared by the walk, insta and settling) ----------

/**
 * The current craft of the job in pipe `index` is finished. Gear: the job turns ready. Materials: the output goes into
 * the inventory, with the house's yield bonus and the fraction ledger (×10 for a ×10 craft); if it does not fit, the
 * pipe is held (timer held, nothing lost) and false is returned. Then the next craft starts or waits.
 */
function deliver(draft: GameState, index: number, events: GameEvent[], summary: SimulationSummary | null): boolean {
  const c = draft.crafting;
  const job = c.pipes[index];
  if (!job || !isRecipeId(job.recipeId)) return false;
  const recipe = RECIPES[job.recipeId];
  const outId = recipe.output.defId;
  if (recipe.kind === 'gear') {
    markReady(job, index, outId, events, summary);
    return false;
  }
  if (!canAdd(draft.inventory, outId)) {
    job.progressMs = job.craftMs;
    if (job.status !== 'held') {
      job.status = 'held';
      events.push({ type: 'CRAFT_HELD', pipe: index, jobId: job.id });
    }
    return false;
  }
  const units = recipe.output.quantity * (job.x10 ? CRAFTING.x10.multiplier : 1);
  const yieldBp = houseYieldBp(draft);
  // Thousandths: units × (10 000 + yield bp) / 10 000 × 1000. The whole part is delivered; the rest goes to the ledger.
  const milli = Math.floor((units * Math.max(0, BASIS_POINTS + yieldBp)) / 10);
  const unit = CRAFTING.remainderUnit;
  const ledger = (c.remainders[outId] ?? 0) + (milli % unit);
  const whole = Math.floor(milli / unit) + Math.floor(ledger / unit);
  const rest = ledger % unit;
  if (rest > 0) c.remainders[outId] = rest;
  else delete c.remainders[outId];
  if (whole > 0) addStackable(draft.inventory, outId, whole);
  if (summary) {
    summary.craftsCompleted += 1;
    summary.itemsCrafted[outId] = (summary.itemsCrafted[outId] ?? 0) + whole;
  }
  events.push({ type: 'CRAFT_COMPLETED', pipe: index, jobId: job.id, itemId: outId, quantity: whole });
  job.done += 1;
  startNextCraft(draft, index, job, events);
  return true;
}

/** A gear craft finished: the pipe holds the piece (`ready`) until COLLECT_CRAFT. Mutates the job. */
function markReady(job: CraftJob, index: number, defId: string, events: GameEvent[], summary: SimulationSummary | null): void {
  job.progressMs = job.craftMs;
  if (job.status === 'ready') return;
  job.status = 'ready';
  events.push({ type: 'CRAFT_READY', pipe: index, jobId: job.id, defId });
  if (summary) summary.craftsReady[defId] = (summary.craftsReady[defId] ?? 0) + 1;
}

// ---------- the world walk ----------

/** True while a pipe's timer runs or a pipe waits for inputs (both need the world walk; held and ready ones do not). */
export function anyPipeActive(state: Pick<GameState, 'crafting'>): boolean {
  for (const job of state.crafting.pipes) if (job?.status === 'running' || job?.status === 'waiting') return true;
  return false;
}

/** True while some pipe waits for inputs: the walk then also stops at the hero's events (a log or an ore can feed it). */
export function anyPipeWaiting(state: Pick<GameState, 'crafting'>): boolean {
  for (const job of state.crafting.pipes) if (job?.status === 'waiting') return true;
  return false;
}

/** Wall ms to the next craft finishing in any pipe (ceil over efficiency, at least 1), Infinity when none runs. */
export function pipesNextEventMs(state: Pick<GameState, 'crafting' | 'offline'>): number {
  const eff = state.offline.efficiency;
  let next = Number.POSITIVE_INFINITY;
  for (const job of state.crafting.pipes) {
    if (job?.status !== 'running') continue;
    const left = Math.max(0, job.craftMs - job.progressMs);
    next = Math.min(next, eff > 0 ? Math.max(1, Math.ceil(left / eff)) : Number.POSITIVE_INFINITY);
  }
  return next;
}

/**
 * A walk step of `ms` is about to pass: every waiting pipe spends it waiting. Notes each (pipe, missing input) once in
 * the summary ("Pipe 1 waited for Oak Logs"). Read before the step, so it names what was missing during it.
 */
export function notePipeWaits(state: GameState, ms: number, summary: SimulationSummary): void {
  if (ms <= 0) return;
  state.crafting.pipes.forEach((job, pipe) => {
    if (job?.status !== 'waiting' || !isRecipeId(job.recipeId)) return;
    for (const s of shortInputs(state, RECIPES[job.recipeId], 1)) {
      if (!summary.craftWaits.some((w) => w.pipe === pipe && w.defId === s.defId)) summary.craftWaits.push({ pipe, defId: s.defId });
    }
  });
}

/**
 * The pipes inside the world walk, at the end of a step of `ms` granted time (× efficiency), in pipe order: a running
 * pipe advances and delivers a craft that is due (its next craft then starts or waits); a waiting pipe starts its
 * craft if its inputs arrived during the step (a log, a crew's yield, another pipe's output earlier in the order). The
 * walk never passes more than the time to the next craft finishing, so a craft never carries time into the next one.
 * Mutates draft.crafting (already the walk's own copy).
 */
export function advancePipes(draft: GameState, ms: number, events: GameEvent[], summary: SimulationSummary): void {
  const pipes = draft.crafting.pipes;
  for (let i = 0; i < pipes.length; i += 1) {
    const job = pipes[i];
    if (job?.status === 'running') {
      job.progressMs = Math.min(job.craftMs, job.progressMs + ms * draft.offline.efficiency);
      if (job.progressMs >= job.craftMs) deliver(draft, i, events, summary);
    } else if (job?.status === 'waiting') {
      startNextCraft(draft, i, job, events);
    }
  }
}

/**
 * At one instant, in pipe order: held pipes deliver if their output fits now and waiting pipes start if their inputs
 * are there. Runs at the start and end of every world-walk step and after every command (a sale or a build can free a
 * slot; a buy, a collect or a refund can bring inputs). Mutates the draft (a copy owned by the caller).
 */
export function settleCrafting(draft: GameState, events: GameEvent[], summary: SimulationSummary | null): void {
  const pipes = draft.crafting.pipes;
  for (let i = 0; i < pipes.length; i += 1) {
    const job = pipes[i];
    if (job?.status === 'held') deliver(draft, i, events, summary);
    else if (job?.status === 'waiting') startNextCraft(draft, i, job, events);
  }
}

// ---------- commands (draft = a full copy) ----------

function pipeIndex(draft: GameState, pipe: unknown): { index: number } | { error: CraftError } {
  if (typeof pipe !== 'number' || !Number.isSafeInteger(pipe) || pipe < 0 || pipe >= draft.crafting.pipes.length) {
    return { error: err('INVALID_COMMAND', `Invalid pipe ${String(pipe)}`) };
  }
  return { index: pipe };
}

const isCount = (n: unknown, min: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= min;

/** The first open, idle pipe (where the Recipes view's Start goes), or null when every open pipe is busy. */
export function firstFreePipe(state: Pick<GameState, 'crafting'>): number | null {
  const c = state.crafting;
  for (let i = 0; i < Math.min(c.pipesUnlocked, c.pipes.length); i += 1) if (!c.pipes[i]) return i;
  return null;
}

/**
 * START_CRAFT: `recipeId` in pipe `pipe`, or (no `pipe`) in the first free open pipe (ALL_PIPES_BUSY when none).
 * Material: a continuous job; nothing is paid now beyond its first craft's inputs, and with too few the pipe waits.
 * Gear: one piece; every input and the invested stamina are paid at once, and the piece is rolled now.
 */
export function startCraft(
  draft: GameState,
  cmd: { pipe?: unknown; recipeId: unknown; maxCost?: unknown; stamina?: unknown },
  now: number,
  events: GameEvent[],
): CraftError {
  if (!isBuilt(draft, 'crafting')) return err('BUILDING_LOCKED', `Build the ${BUILDINGS.crafting.name} house first`);
  const c = draft.crafting;
  let index: number;
  if (cmd.pipe === undefined) {
    const free = firstFreePipe(draft);
    if (free === null) return err('ALL_PIPES_BUSY', 'All pipes are busy');
    index = free;
  } else {
    const p = pipeIndex(draft, cmd.pipe);
    if ('error' in p) return p.error;
    index = p.index;
    if (index >= c.pipesUnlocked) return err('PIPE_LOCKED', `Pipe ${index + 1} is locked`);
    if (c.pipes[index]) return err('PIPE_BUSY', `Pipe ${index + 1} is already crafting`);
  }
  if (!isRecipeId(cmd.recipeId)) return err('UNKNOWN_RECIPE', `Unknown recipe ${String(cmd.recipeId)}`);
  const recipeId = cmd.recipeId;
  const recipe = RECIPES[recipeId];
  const maxCost = cmd.maxCost ?? 0;
  if (!isCount(maxCost, 0)) return err('INVALID_AMOUNT', `Invalid maxCost ${String(cmd.maxCost)}`);
  const invest = cmd.stamina ?? 0;
  if (recipe.kind !== 'gear') {
    if (invest !== 0) return err('INVALID_AMOUNT', 'Only gear takes invested stamina');
    const job: CraftJob = { id: c.nextJobSerial, recipeId, done: 0, craftMs: 0, progressMs: 0, x10: false, status: 'running', startedAt: now };
    c.pipes[index] = job;
    c.nextJobSerial += 1;
    events.push({ type: 'CRAFT_STARTED', pipe: index, jobId: job.id, recipeId });
    startNextCraft(draft, index, job, events);
    return null;
  }
  if (!isCount(invest, 0) || invest > GEAR.craft.maxStamina) return err('INVALID_AMOUNT', `Invest 0 to ${GEAR.craft.maxStamina} stamina`);
  const missing = shortInputs(draft, recipe, 1);
  if (missing.length > 0) {
    const text = missing.map((i) => `${i.need} ${nameOf(i.defId)} (you have ${i.have})`).join(', ');
    return err('NOT_ENOUGH_ITEMS', `${recipe.name} needs ${text}`);
  }
  if (invest > maxCost) return err('COST_CHANGED', `This job now costs ${invest} stamina, more than the ${maxCost} shown`);
  if (invest > draft.stamina.current) return err('NOT_ENOUGH_STAMINA', `Needs ${invest} stamina, has ${draft.stamina.current}`);
  for (const i of recipe.inputs) consumeItem(draft, i.defId, i.quantity);
  if (invest > 0) draft.stamina = { ...draft.stamina, current: draft.stamina.current - invest };
  // The piece is rolled now, the moment it is paid for: quality, then rarity (two draws of the main stream).
  const q = rollQuality(draft.rng, gearQualityFloor(draft, invest), GEAR.maxQuality);
  const r = rollRarity(q.rng, gearRarityWeights(recipe));
  draft.rng = r.rng;
  const job: CraftJob = {
    id: c.nextJobSerial,
    recipeId,
    done: 0,
    craftMs: craftMs(draft, recipeId),
    progressMs: 0,
    x10: false,
    status: 'running',
    startedAt: now,
    gear: { staminaInvested: invest, quality: q.value, rarity: r.value },
  };
  c.pipes[index] = job;
  c.nextJobSerial += 1;
  events.push({ type: 'CRAFT_STARTED', pipe: index, jobId: job.id, recipeId });
  return null;
}

/**
 * What ending the job gives back: the inputs of the craft in progress (×10 for a ×10 craft; a held craft too, a waiting
 * pipe has none) plus those of its prepaid crafts. Gear (CANCEL_CRAFT): its one piece's inputs. Stamina never comes back.
 */
export function stopRefund(job: CraftJob): ItemAmount[] {
  if (!isRecipeId(job.recipeId)) return [];
  const recipe = RECIPES[job.recipeId];
  const current = job.status === 'waiting' || job.status === 'ready' ? 0 : job.x10 ? CRAFTING.x10.multiplier : 1;
  return inputsFor(recipe, current + (job.prepaid ?? 0)).filter((i) => i.quantity > 0);
}

/** Shared by STOP_CRAFT and CANCEL_CRAFT once the job is checked: refund (or INVENTORY_FULL, nothing changes) and free the pipe. */
function endJob(draft: GameState, index: number, job: CraftJob, events: GameEvent[], event: 'CRAFT_STOPPED' | 'CRAFT_JOB_CANCELLED'): CraftError {
  const refund = stopRefund(job);
  const short = slotsShort(draft.inventory, refund);
  if (short > 0) return err('INVENTORY_FULL', `Free ${short} inventory slot(s) first: the refunded materials need room`);
  for (const i of refund) addStackable(draft.inventory, i.defId, i.quantity);
  draft.crafting.pipes[index] = null;
  events.push({ type: event, pipe: index, jobId: job.id });
  return null;
}

/** The job in pipe `pipe` if it is the one shown (`jobId`), else the error. */
function shownJob(draft: GameState, pipe: unknown, jobId: unknown): { index: number; job: CraftJob } | { error: CraftError } {
  const p = pipeIndex(draft, pipe);
  if ('error' in p) return p;
  const job = draft.crafting.pipes[p.index];
  if (!job) return { error: err('NO_CRAFT_JOB', `Pipe ${p.index + 1} is idle`) };
  if (jobId !== job.id) return { error: err('CRAFT_CHANGED', 'That job already finished') };
  return { index: p.index, job };
}

const isGearJob = (job: CraftJob) => isRecipeId(job.recipeId) && RECIPES[job.recipeId].kind === 'gear';

/**
 * STOP_CRAFT (materials), bound to the job shown (`jobId`): refunds the inputs of the craft in progress (its ×10 extra
 * too; its stamina is not refunded) and of any prepaid crafts; a waiting pipe just becomes free. Refused with
 * INVENTORY_FULL when the refund would not fit (nothing changes). Gear jobs use CANCEL_CRAFT.
 */
export function stopCraft(draft: GameState, pipe: unknown, jobId: unknown, events: GameEvent[]): CraftError {
  const s = shownJob(draft, pipe, jobId);
  if ('error' in s) return s.error;
  if (isGearJob(s.job)) return err('INVALID_COMMAND', 'A gear job is cancelled, not stopped');
  return endJob(draft, s.index, s.job, events, 'CRAFT_STOPPED');
}

/**
 * CANCEL_CRAFT (gear), bound to the job shown (`jobId`): refunds the piece's inputs (the invested stamina is lost).
 * Refused on a ready piece (CRAFT_READY) and with INVENTORY_FULL when the refund would not fit. Material jobs use STOP_CRAFT.
 */
export function cancelCraft(draft: GameState, pipe: unknown, jobId: unknown, events: GameEvent[]): CraftError {
  const s = shownJob(draft, pipe, jobId);
  if ('error' in s) return s.error;
  if (!isGearJob(s.job)) return err('INVALID_COMMAND', 'A material job is stopped, not cancelled');
  // A finished gear piece is never cancelled: that would refund its inputs and drop the rolled piece.
  if (s.job.status === 'ready') return err('CRAFT_READY', 'The piece is finished: collect it with Done');
  return endJob(draft, s.index, s.job, events, 'CRAFT_JOB_CANCELLED');
}

/** The job and craft shown (INSTA_CRAFT, X10_CRAFT), checked in this order: amounts, pipe, job, binding, ready, waiting. */
function shownCraft(draft: GameState, cmd: { pipe: unknown; jobId: unknown; craft: unknown; maxCost: unknown }): { index: number; job: CraftJob } | { error: CraftError } {
  if (!isCount(cmd.maxCost, 1)) return { error: err('INVALID_AMOUNT', `Invalid maxCost ${String(cmd.maxCost)}`) };
  if (!isCount(cmd.craft, 1)) return { error: err('INVALID_COMMAND', `Invalid craft ${String(cmd.craft)}`) };
  const s = shownJob(draft, cmd.pipe, cmd.jobId);
  if ('error' in s) return s;
  if (cmd.craft !== s.job.done + 1) return { error: err('CRAFT_CHANGED', 'That craft already finished') };
  if (s.job.status === 'ready') return { error: err('CRAFT_READY', 'The piece is finished: collect it with Done') };
  if (s.job.status === 'waiting') return { error: err('CRAFT_WAITING', 'The pipe is waiting for materials') };
  if (s.job.status !== 'running' || !isRecipeId(s.job.recipeId)) return { error: err('INVENTORY_FULL', 'This craft is done and waits for room in the inventory') };
  return s;
}

/**
 * INSTA_CRAFT: spends ceil(remaining minutes) stamina (at least 1) to finish the current craft now (a ×10 one too),
 * bound to the pipe, job and craft number shown (CRAFT_CHANGED once that craft finished) and the cost shown
 * (COST_CHANGED when higher). Refused with INVENTORY_FULL when the output would not fit (no stamina is spent), also
 * while the pipe is held, and with CRAFT_WAITING while it waits for inputs.
 */
export function instaCraft(draft: GameState, cmd: { pipe: unknown; jobId: unknown; craft: unknown; maxCost: unknown }, events: GameEvent[]): CraftError {
  const s = shownCraft(draft, cmd);
  if ('error' in s) return s.error;
  const { index, job } = s;
  const cost = instaCost(job.craftMs - job.progressMs);
  if (cost > (cmd.maxCost as number)) return err('COST_CHANGED', `Finishing now costs ${cost}, more than the ${String(cmd.maxCost)} shown`);
  if (draft.stamina.current < cost) return err('NOT_ENOUGH_STAMINA', `Needs ${cost} stamina, has ${draft.stamina.current}`);
  const recipe = RECIPES[job.recipeId as RecipeId];
  // Gear waits in the pipe (ready), so it needs no room now; materials go straight into the inventory.
  if (recipe.kind !== 'gear' && !canAdd(draft.inventory, recipe.output.defId)) return err('INVENTORY_FULL', 'No room in the inventory for the crafted items');
  draft.stamina = { ...draft.stamina, current: draft.stamina.current - cost };
  job.progressMs = job.craftMs;
  deliver(draft, index, events, null);
  return null;
}

/** What a ×10 tap on the craft in progress costs now: 9× its inputs and max(1, ceil(9 × its craft minutes)) stamina. */
export function x10TapCost(job: Pick<CraftJob, 'recipeId' | 'craftMs'>): { items: ItemAmount[]; stamina: number } {
  if (!isRecipeId(job.recipeId)) return { items: [], stamina: 0 };
  return { items: inputsFor(RECIPES[job.recipeId], CRAFTING.x10.multiplier - 1), stamina: x10StaminaPerCraft(job.craftMs) };
}

/**
 * X10_CRAFT: the material craft in progress (bound to the job and craft number shown, CRAFT_CHANGED; and to the stamina
 * shown, COST_CHANGED) makes 10× its output in the same time, its progress kept. Takes 9× the recipe's inputs now
 * (NOT_ENOUGH_ITEMS) and max(1, ceil(9 × its craftMs ÷ 1 min)) stamina (NOT_ENOUGH_STAMINA). Only that craft: the next
 * starts ×1. Refused on gear (INVALID_COMMAND), a waiting pipe (CRAFT_WAITING), a held one (INVENTORY_FULL) and a craft
 * already ×10 (ALREADY_X10).
 */
export function x10Craft(draft: GameState, cmd: { pipe: unknown; jobId: unknown; craft: unknown; maxCost: unknown }, events: GameEvent[]): CraftError {
  const s = shownCraft(draft, cmd);
  if ('error' in s) return s.error;
  const { index, job } = s;
  if (isGearJob(job)) return err('INVALID_COMMAND', 'Gear is crafted one piece at a time');
  if (job.x10) return err('ALREADY_X10', 'This craft is already ×10');
  const cost = x10TapCost(job);
  const missing = cost.items.filter((i) => itemQuantity(draft, i.defId) < i.quantity);
  if (missing.length > 0) {
    const text = missing.map((i) => `${i.quantity} ${nameOf(i.defId)} (you have ${itemQuantity(draft, i.defId)})`).join(', ');
    return err('NOT_ENOUGH_ITEMS', `×10 needs ${text}`);
  }
  if (cost.stamina > (cmd.maxCost as number)) return err('COST_CHANGED', `×10 now costs ${cost.stamina} stamina, more than the ${String(cmd.maxCost)} shown`);
  if (draft.stamina.current < cost.stamina) return err('NOT_ENOUGH_STAMINA', `Needs ${cost.stamina} stamina, has ${draft.stamina.current}`);
  for (const i of cost.items) consumeItem(draft, i.defId, i.quantity);
  draft.stamina = { ...draft.stamina, current: draft.stamina.current - cost.stamina };
  job.x10 = true;
  events.push({ type: 'CRAFT_X10', pipe: index, jobId: job.id, craft: job.done + 1, stamina: cost.stamina });
  return null;
}

/**
 * COLLECT_CRAFT (Done), bound to the job shown (`jobId`): the ready gear piece goes into the inventory with its rolled
 * quality and rarity as a new instance (`<defId>#<serial>`, see collectedItemId) and the pipe turns idle. Refused with
 * INVENTORY_FULL when no slot is free (the piece stays safe in the pipe) and CRAFT_NOT_READY while it is still crafting.
 */
export function collectCraft(draft: GameState, pipe: unknown, jobId: unknown, events: GameEvent[]): CraftError {
  const s = shownJob(draft, pipe, jobId);
  if ('error' in s) return s.error;
  const { index, job } = s;
  if (job.status !== 'ready' || !job.gear || !isRecipeId(job.recipeId)) return err('CRAFT_NOT_READY', 'Still crafting');
  if (freeSlots(draft.inventory) < 1) return err('INVENTORY_FULL', 'Free an inventory slot first: the piece waits in the pipe');
  const defId = RECIPES[job.recipeId].output.defId;
  const itemId = collectedItemId(draft, defId);
  draft.inventory.items.push(makeItem(defId, 1, itemId, { quality: job.gear.quality, rarity: job.gear.rarity }));
  draft.nextItemSerial += 1;
  draft.crafting.pipes[index] = null;
  events.push({ type: 'CRAFT_COLLECTED', pipe: index, jobId: job.id, itemId, defId });
  return null;
}

/** The instance id COLLECT_CRAFT gives the next piece (the UI opens its popover after Done). */
export function collectedItemId(state: Pick<GameState, 'nextItemSerial'>, defId: string): string {
  return `${defId}#${state.nextItemSerial}`;
}

/** DEBUG_UNLOCK_PIPE: opens the next pipe (up to all 8). */
export function unlockPipe(draft: GameState, events: GameEvent[]): CraftError {
  const c = draft.crafting;
  if (c.pipesUnlocked >= c.pipes.length) return err('PIPES_MAXED', `All ${c.pipes.length} pipes are open`);
  c.pipesUnlocked += 1;
  events.push({ type: 'PIPE_UNLOCKED', pipes: c.pipesUnlocked });
  return null;
}

// ---------- views ----------

/** A gear recipe's extra view: what the piece can be and what stamina buys. */
export type GearRecipeView = {
  slot: string;
  /** Stats at 100% quality (the catalog maxima). */
  maxStats: GearStats;
  /** Rarity odds in whole percents, in table order. */
  rarityOdds: { rarity: ItemRarity; pct: number }[];
  /** Stamina investable at start (0..maxStamina); the floor it gives comes from gearQualityFloor(). */
  maxStamina: number;
};

export type RecipeView = {
  recipeId: RecipeId;
  name: string;
  kind: RecipeDef['kind'];
  tier: number;
  /** Per craft, with what the hero has. */
  inputs: { defId: string; perCraft: number; have: number }[];
  output: { defId: string; perCraft: number };
  /** Effective craft time right now (house level, INT). */
  craftMs: number;
  /** The inputs of one craft are there now (a material job still starts without them: it waits). */
  enough: boolean;
  /** Gear recipes only. */
  gear: GearRecipeView | null;
};

export function recipeView(state: GameState, recipeId: RecipeId): RecipeView {
  const r = RECIPES[recipeId];
  const outDef = getItemDef(r.output.defId);
  return {
    recipeId,
    name: r.name,
    kind: r.kind,
    tier: r.tier,
    inputs: r.inputs.map((i) => ({ defId: i.defId, perCraft: i.quantity, have: itemQuantity(state, i.defId) })),
    output: { defId: r.output.defId, perCraft: r.output.quantity },
    craftMs: craftMs(state, recipeId),
    enough: shortInputs(state, r, 1).length === 0,
    gear:
      r.kind === 'gear'
        ? {
            slot: outDef?.slot ?? '',
            maxStats: gearStatsAt(outDef, GEAR.maxQuality),
            rarityOdds: rarityOdds(gearRarityWeights(r)),
            maxStamina: GEAR.craft.maxStamina,
          }
        : null,
  };
}

/** The ×10 tap on a running material craft: what it takes now, and why it is greyed out (null = it can be tapped). */
export type X10TapView = { items: ItemAmount[]; stamina: number; blocked: string | null };

/** A job as the screen may show it: never the rolled quality or rarity of a gear piece (revealed only by Done). */
export type CraftJobView = Omit<CraftJob, 'gear' | 'prepaid'> & {
  pipe: number;
  recipeName: string;
  kind: RecipeDef['kind'];
  outputDefId: string;
  /** Gear: the finished piece waits for Done (COLLECT_CRAFT). */
  ready: boolean;
  /** Gear: the stamina invested at start (lost on cancel); 0 for materials. */
  staminaInvested: number;
  /** The current (or next) craft's number (done + 1), which INSTA_CRAFT and X10_CRAFT name. */
  craftNumber: number;
  /** Time left on the current craft, ms (0 while held or waiting). */
  remainingMs: number;
  /** progressMs ÷ craftMs, 0..1 (0 while waiting). */
  fraction: number;
  /** Stamina for INSTA_CRAFT now. */
  instaCost: number;
  /** Materials, running and not yet ×10: the tap's cost and state; null otherwise (gear, waiting, held, already ×10). */
  x10Tap: X10TapView | null;
  /** Waiting: the inputs one craft lacks now, with have / need ("Waiting for Oak Logs (1/2)"). */
  waitingFor: { defId: string; have: number; need: number }[];
  /** Crafts already paid by the v15 migration (used before new inputs). */
  prepaid: number;
  /** What STOP_CRAFT (materials) or CANCEL_CRAFT (gear) gives back now. */
  refund: ItemAmount[];
};

/** `open`: usable (idle or with a job); `later`: unlocks later by play; `premium`: a premium pipe (coming soon). */
export type PipeSlotState = 'open' | 'later' | 'premium';

export type PipeView = { index: number; slot: PipeSlotState; job: CraftJobView | null };

function x10TapView(state: GameState, job: CraftJob): X10TapView | null {
  if (job.status !== 'running' || job.x10 || isGearJob(job)) return null;
  const cost = x10TapCost(job);
  const short = cost.items.find((i) => itemQuantity(state, i.defId) < i.quantity);
  const blocked = short ? `Needs ${short.quantity} ${nameOf(short.defId)}` : state.stamina.current < cost.stamina ? 'Not enough stamina' : null;
  return { ...cost, blocked };
}

export function craftJobView(state: GameState, index: number): CraftJobView | null {
  const job = state.crafting.pipes[index];
  if (!job || !isRecipeId(job.recipeId)) return null;
  const r = RECIPES[job.recipeId];
  const remainingMs = job.status === 'running' ? Math.max(0, job.craftMs - job.progressMs) : 0;
  const { gear, prepaid, ...shown } = job;
  return {
    ...shown,
    pipe: index,
    recipeName: r.name,
    kind: r.kind,
    outputDefId: r.output.defId,
    ready: job.status === 'ready',
    staminaInvested: gear?.staminaInvested ?? 0,
    craftNumber: job.done + 1,
    remainingMs,
    fraction: job.status === 'waiting' ? 0 : job.craftMs > 0 ? Math.min(1, job.progressMs / job.craftMs) : 1,
    instaCost: instaCost(remainingMs),
    x10Tap: x10TapView(state, job),
    waitingFor: job.status === 'waiting' ? shortInputs(state, r, 1) : [],
    prepaid: prepaid ?? 0,
    refund: stopRefund(job),
  };
}

export type CraftingView = {
  built: boolean;
  level: number;
  /** House craft time multiplier, bp. */
  timeBp: number;
  /** House yield bonus for normal items, bp. */
  yieldBp: number;
  /** INT's craft time reduction, bp. */
  intReductionBp: number;
  pipesUnlocked: number;
  pipes: PipeView[];
  /** Pipes with a job (running, waiting, held or ready). */
  busy: number;
  /** Some pipe waits for inventory room. */
  held: boolean;
  /** Pipes waiting for materials. */
  waiting: number;
  /** Pipes holding a finished gear piece (waiting for Done). */
  ready: number;
  /** Where the Recipes view's Start goes: the first free open pipe, or null ("All pipes busy"). */
  freePipe: number | null;
  recipes: RecipeView[];
};

export function craftingView(state: GameState): CraftingView {
  const c = state.crafting;
  const pipes: PipeView[] = c.pipes.map((_, index) => ({
    index,
    slot: index < c.pipesUnlocked ? 'open' : index < CRAFTING.freePipes ? 'later' : 'premium',
    job: craftJobView(state, index),
  }));
  let busy = 0;
  let held = false;
  let waiting = 0;
  let ready = 0;
  for (const p of pipes) {
    if (!p.job) continue;
    busy += 1;
    if (p.job.status === 'held') held = true;
    else if (p.job.status === 'waiting') waiting += 1;
    else if (p.job.status === 'ready') ready += 1;
  }
  const built = isBuilt(state, 'crafting');
  return {
    built,
    level: built ? state.buildings.crafting.level : 0,
    timeBp: houseTimeBp(state),
    yieldBp: houseYieldBp(state),
    intReductionBp: intCraftReductionBp(state),
    pipesUnlocked: c.pipesUnlocked,
    pipes,
    busy,
    held,
    waiting,
    ready,
    freePipe: firstFreePipe(state),
    recipes: RECIPE_IDS.map((id) => recipeView(state, id)),
  };
}

/**
 * The Village sign's line: busy pipes of the open ones, any held pipe, every busy pipe waiting for materials, the
 * shortest time to a craft finishing, and the name of a finished gear piece waiting for Done ("Iron Sword ready"; the
 * first in pipe order). Null when idle.
 */
export type CraftingSign = { busy: number; open: number; held: boolean; waiting: boolean; nextCraftMs: number; readyName: string | null };

/** Cheap (no recipe views): read on every live tick by the Village. */
export function craftingSign(state: GameState): CraftingSign | null {
  const c = state.crafting;
  let busy = 0;
  let waiting = 0;
  let held = false;
  let readyName: string | null = null;
  let next = Number.POSITIVE_INFINITY;
  for (const job of c.pipes) {
    if (!job) continue;
    busy += 1;
    if (job.status === 'ready') readyName ??= isRecipeId(job.recipeId) ? RECIPES[job.recipeId].name : null;
    else if (job.status === 'held') held = true;
    else if (job.status === 'waiting') waiting += 1;
    else next = Math.min(next, Math.max(0, job.craftMs - job.progressMs));
  }
  if (busy === 0) return null;
  return { busy, open: c.pipesUnlocked, held, waiting: waiting === busy, nextCraftMs: Number.isFinite(next) ? next : 0, readyName };
}
