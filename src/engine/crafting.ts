// Crafting house (pure): pipes that turn materials into crafted items on engine time, beside everything else. Data in
// config/crafting.ts; see docs/ENGINE.md ("Crafting").
//
//   START_CRAFT   pays every input of the whole job (and, in x10 mode, every craft's stamina) up front, atomically
//   world walk    each running pipe advances on the granted time; a finished craft delivers its output (or holds the
//                 pipe while the output does not fit) and the next craft starts with a duration computed right then
//   INSTA_CRAFT   ceil(remaining minutes) stamina finishes the current craft now
//   CANCEL_CRAFT  refunds the inputs of every craft not yet delivered and the stamina of every x10 craft not yet started
//   COLLECT_CRAFT a ready gear piece goes into the inventory (Done)
//
// Gear jobs (1.14.0): one piece, x1, any invested stamina (0..50) paid at start and never refunded. Its quality
// (floor + uniform × (10 000 − floor), floor = 100 bp per stamina + minQualityBp, capped at 10 000) and rarity are rolled
// at START_CRAFT with the seeded RNG and stored on the job. When the craft finishes the job turns `ready`: the pipe holds
// the piece (live and offline) until COLLECT_CRAFT moves it into the inventory. Insta takes it to `ready`; a ready job
// cannot be cancelled.
//
// Pipes are NOT an activity: they never use the hero and never stop (or get stopped by) gathering, dungeons or
// training. They never compete for materials: a job owns its inputs from the moment it starts.
import { effectiveAttributes, type AttributeInput } from './attributes';
import { levelBonuses } from './bonuses';
import { consumeItem, isBuilt } from './buildings';
import { BUILDINGS } from './config/buildings';
import { CRAFTING, isCraftMode, isRecipeId, RECIPE_IDS, RECIPES, type RecipeDef, type RecipeId } from './config/crafting';
import { GEAR } from './config/gear';
import { getItemDef } from './config/items';
import { BASIS_POINTS, STAT_EFFECTS } from './config/stats';
import { diminishingBp } from './diminishing';
import { gearStatsAt, type GearStats, rarityOdds, rollQualityBp, rollRarity } from './gear';
import { addStackable, freeSlots, makeItem } from './inventory';
import { itemQuantity } from './selectors';
import type { CraftingState, CraftJob, CraftMode, GameEvent, GameState, Inventory, ItemRarity, SimulationSummary } from './types';

export type CraftErrorCode =
  | 'BUILDING_LOCKED'
  | 'INVALID_COMMAND'
  | 'INVALID_AMOUNT'
  | 'PIPE_LOCKED'
  | 'PIPE_BUSY'
  | 'UNKNOWN_RECIPE'
  | 'NOT_ENOUGH_ITEMS'
  | 'NOT_ENOUGH_STAMINA'
  | 'COST_CHANGED'
  | 'NO_CRAFT_JOB'
  | 'CRAFT_CHANGED'
  | 'INVENTORY_FULL'
  | 'PIPES_MAXED'
  | 'CRAFT_READY'
  | 'CRAFT_NOT_READY';

export type CraftError = { code: CraftErrorCode; message: string } | null;

const err = (code: CraftErrorCode, message: string): CraftError => ({ code, message });

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

/** INT's craft time reduction, bp: diminishing(effective INT, cap 50%, k 50). */
export function intCraftReductionBp(state: AttributeInput): number {
  const { capBp, k } = STAT_EFFECTS.intelligence.craftTime;
  return diminishingBp(effectiveAttributes(state).intelligence, capBp, k);
}

/**
 * Craft time, ms: max(minCraftMs, ceil(baseMs × timeBp / 10 000 × (10 000 − intBp) / 10 000)). The two reductions
 * multiply. Integer math: the product stays far below 2^53 (80 000 × 10 000 × 10 000 = 8e12).
 */
export function craftMsFor(baseMs: number, timeBp: number, intBp: number): number {
  const scaled = baseMs * Math.max(0, timeBp) * Math.max(0, BASIS_POINTS - intBp);
  return Math.max(CRAFTING.minCraftMs, Math.ceil(scaled / (BASIS_POINTS * BASIS_POINTS)));
}

/** Effective craft time of a recipe right now (house level and effective INT). */
export function craftMs(state: GameState, recipeId: RecipeId): number {
  return craftMsFor(RECIPES[recipeId].baseMs, houseTimeBp(state), intCraftReductionBp(state));
}

/** x10 mode stamina per craft: max(1, ceil(9 × craft ms ÷ 1 min)). */
export function x10StaminaPerCraft(ms: number): number {
  const perMin = CRAFTING.x10.staminaPerMinute;
  return Math.max(1, Math.ceil((perMin * Math.max(0, ms)) / 60_000));
}

/** Insta cost: staminaPerStep per started minute left, at least one step (the rule of every skip). */
export function instaCost(remainingMs: number): number {
  const { stepMs, staminaPerStep } = CRAFTING.insta;
  return Math.max(1, Math.ceil(Math.max(0, remainingMs) / stepMs)) * staminaPerStep;
}

const multiplier = (mode: CraftMode) => CRAFTING.modeMultiplier[mode];

/** Inputs of `crafts` crafts in `mode`. */
function inputsFor(recipe: RecipeDef, mode: CraftMode, crafts: number): { defId: string; quantity: number }[] {
  return recipe.inputs.map((i) => ({ defId: i.defId, quantity: i.quantity * multiplier(mode) * crafts }));
}

/** Can `quantity` of a stackable item go into the inventory (an existing stack, or a free slot)? */
function canAdd(inventory: Inventory, defId: string): boolean {
  return inventory.items.some((i) => i.stackable && i.defId === defId) || inventory.items.length < inventory.capacity;
}

/** Most crafts of `recipeId` in `mode` the hero can pay for now (inputs, and stamina in x10), up to maxJobQuantity. */
export function maxCrafts(state: GameState, recipeId: RecipeId, mode: CraftMode): number {
  const recipe = RECIPES[recipeId];
  if (recipe.kind === 'gear' && mode !== 'x1') return 0;
  let n: number = recipe.kind === 'gear' ? 1 : CRAFTING.maxJobQuantity;
  for (const i of inputsFor(recipe, mode, 1)) n = Math.min(n, Math.floor(itemQuantity(state, i.defId) / i.quantity));
  if (mode === 'x10') n = Math.min(n, Math.floor(state.stamina.current / x10StaminaPerCraft(craftMs(state, recipeId))));
  return Math.max(0, n);
}

/** Stamina a material job costs up front: 0 in x1, x10StaminaPerCraft(effective craft time) × crafts in x10. (Gear: the stamina invested.) */
export function craftStaminaCost(state: GameState, recipeId: RecipeId, mode: CraftMode, quantity: number): number {
  return mode === 'x10' ? x10StaminaPerCraft(craftMs(state, recipeId)) * quantity : 0;
}

/** Bonus to every gear craft's quality floor, bp (a hook for later upgrades; GEAR.craft.minQualityBp, 0 for now). */
export function minQualityBp(_state: Pick<GameState, 'buildings'>): number {
  return GEAR.craft.minQualityBp;
}

/** A gear craft's quality floor, bp: 100 per invested stamina + minQualityBp, capped at 10 000. */
export function gearQualityFloorBp(state: Pick<GameState, 'buildings'>, stamina: number): number {
  return Math.min(GEAR.maxQualityBp, Math.max(0, stamina) * GEAR.craft.qualityBpPerStamina + minQualityBp(state));
}

/** The rarity odds of a gear recipe: its own, else the default (uncommon 75 / rare 20 / epic 5). */
export function gearRarityWeights(recipe: RecipeDef) {
  return recipe.rarityWeights ?? GEAR.craft.rarityWeights;
}

// ---------- delivery (shared by the walk, insta and settling) ----------

/**
 * The current craft of the job in pipe `index` is finished: its output goes into the inventory, with the house's yield
 * bonus (normal items) and the fraction ledger. If it does not fit, the pipe is held (timer held, nothing lost) and
 * false is returned. Then the next craft starts (its duration computed now) or the job ends. Mutates `draft` (the
 * crafting slice and the inventory must already be the caller's copies).
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
  const units = recipe.output.quantity * multiplier(job.mode);
  const yieldBp = recipe.kind === 'material' ? houseYieldBp(draft) : 0;
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
  if (job.done >= job.quantity) {
    c.pipes[index] = null;
    events.push({ type: 'CRAFT_JOB_DONE', pipe: index, jobId: job.id });
  } else {
    // Each craft's duration is fixed when it starts: an upgrade or trained INT counts from here.
    job.craftMs = craftMs(draft, job.recipeId);
    job.progressMs = 0;
    job.status = 'running';
  }
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

/** True while at least one pipe's timer runs (held pipes wait on the inventory, not on time). */
export function anyPipeRunning(state: Pick<GameState, 'crafting'>): boolean {
  for (const job of state.crafting.pipes) if (job?.status === 'running') return true;
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
 * The pipes inside the world walk: adds `ms` of granted time (× efficiency) to every running pipe and delivers the
 * crafts that are due, in pipe order. The walk never passes more than the time to the next craft finishing, so a
 * craft never carries time into the next one. Mutates draft.crafting (already the walk's own copy).
 */
export function advancePipes(draft: GameState, ms: number, events: GameEvent[], summary: SimulationSummary): void {
  const pipes = draft.crafting.pipes;
  for (let i = 0; i < pipes.length; i += 1) {
    const job = pipes[i];
    if (job?.status !== 'running') continue;
    job.progressMs = Math.min(job.craftMs, job.progressMs + ms * draft.offline.efficiency);
    if (job.progressMs >= job.craftMs) deliver(draft, i, events, summary);
  }
}

/**
 * Held pipes deliver as soon as their output fits: at the start of every world-walk step and after every command
 * (a sale or a build can free a slot). In pipe order. Mutates the draft (a copy owned by the caller).
 */
export function settleCrafting(draft: GameState, events: GameEvent[], summary: SimulationSummary | null): void {
  const pipes = draft.crafting.pipes;
  for (let i = 0; i < pipes.length; i += 1) if (pipes[i]?.status === 'held') deliver(draft, i, events, summary);
}

// ---------- commands (draft = a full copy) ----------

function pipeIndex(draft: GameState, pipe: unknown): { index: number } | { error: CraftError } {
  if (typeof pipe !== 'number' || !Number.isSafeInteger(pipe) || pipe < 0 || pipe >= draft.crafting.pipes.length) {
    return { error: err('INVALID_COMMAND', `Invalid pipe ${String(pipe)}`) };
  }
  return { index: pipe };
}

const isCount = (n: unknown, min: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= min;

/**
 * START_CRAFT: `quantity` crafts of `recipeId` in `mode` in pipe `pipe`. Every check runs before anything is paid;
 * then every input of the whole job (and the x10 stamina of every craft) is consumed at once.
 */
export function startCraft(
  draft: GameState,
  cmd: { pipe: unknown; recipeId: unknown; quantity: unknown; mode: unknown; maxCost: unknown; stamina?: unknown },
  now: number,
  events: GameEvent[],
): CraftError {
  if (!isBuilt(draft, 'crafting')) return err('BUILDING_LOCKED', `Build the ${BUILDINGS.crafting.name} house first`);
  const p = pipeIndex(draft, cmd.pipe);
  if ('error' in p) return p.error;
  const { index } = p;
  const c = draft.crafting;
  if (index >= c.pipesUnlocked) return err('PIPE_LOCKED', `Pipe ${index + 1} is locked`);
  if (c.pipes[index]) return err('PIPE_BUSY', `Pipe ${index + 1} is already crafting`);
  if (!isRecipeId(cmd.recipeId)) return err('UNKNOWN_RECIPE', `Unknown recipe ${String(cmd.recipeId)}`);
  if (!isCraftMode(cmd.mode)) return err('INVALID_COMMAND', `Unknown mode ${String(cmd.mode)}`);
  const { quantity, maxCost } = cmd;
  if (!isCount(quantity, 1) || quantity > CRAFTING.maxJobQuantity) return err('INVALID_AMOUNT', `Invalid quantity ${String(quantity)}`);
  if (!isCount(maxCost, 0)) return err('INVALID_AMOUNT', `Invalid maxCost ${String(maxCost)}`);
  const recipeId = cmd.recipeId;
  const mode = cmd.mode;
  const recipe = RECIPES[recipeId];
  const gear = recipe.kind === 'gear';
  const invest = cmd.stamina ?? 0;
  if (gear) {
    if (mode !== 'x1') return err('INVALID_COMMAND', 'Gear is crafted one piece at a time (x1)');
    if (quantity !== 1) return err('INVALID_AMOUNT', 'Gear is crafted one piece per job');
    if (!isCount(invest, 0) || invest > GEAR.craft.maxStamina) return err('INVALID_AMOUNT', `Invest 0 to ${GEAR.craft.maxStamina} stamina`);
  } else if (invest !== 0) {
    return err('INVALID_AMOUNT', 'Only gear takes invested stamina');
  }
  const inputs = inputsFor(recipe, mode, quantity);
  const missing = inputs.filter((i) => itemQuantity(draft, i.defId) < i.quantity);
  if (missing.length > 0) {
    const text = missing.map((i) => `${i.quantity} ${getItemDef(i.defId)?.name ?? i.defId} (you have ${itemQuantity(draft, i.defId)})`).join(', ');
    return err('NOT_ENOUGH_ITEMS', `${quantity} × ${recipe.name} needs ${text}`);
  }
  const ms = craftMs(draft, recipeId);
  const staminaPerCraft = mode === 'x10' ? x10StaminaPerCraft(ms) : 0;
  const stamina = gear ? (invest as number) : staminaPerCraft * quantity;
  if (stamina > maxCost) return err('COST_CHANGED', `This job now costs ${stamina} stamina, more than the ${maxCost} shown`);
  if (stamina > draft.stamina.current) return err('NOT_ENOUGH_STAMINA', `Needs ${stamina} stamina, has ${draft.stamina.current}`);
  for (const i of inputs) consumeItem(draft, i.defId, i.quantity);
  if (stamina > 0) draft.stamina = { ...draft.stamina, current: draft.stamina.current - stamina };
  const job: CraftJob = { id: c.nextJobSerial, recipeId, mode, quantity, done: 0, craftMs: ms, progressMs: 0, staminaPerCraft, status: 'running', startedAt: now };
  if (gear) {
    // The piece is rolled now, the moment it is paid for: quality, then rarity (two draws of the main stream).
    const q = rollQualityBp(draft.rng, gearQualityFloorBp(draft, stamina), GEAR.maxQualityBp);
    const r = rollRarity(q.rng, gearRarityWeights(recipe));
    draft.rng = r.rng;
    job.gear = { staminaInvested: stamina, qualityBp: q.value, rarity: r.value };
  }
  c.pipes[index] = job;
  c.nextJobSerial += 1;
  events.push({ type: 'CRAFT_STARTED', pipe: index, jobId: job.id, recipeId, quantity, mode });
  return null;
}

/** What cancelling the job in pipe `index` gives back: inputs of every craft not delivered, x10 stamina of every craft not started. */
export function cancelRefund(job: CraftJob): { items: { defId: string; quantity: number }[]; stamina: number } {
  if (!isRecipeId(job.recipeId)) return { items: [], stamina: 0 };
  const left = Math.max(0, job.quantity - job.done);
  return { items: inputsFor(RECIPES[job.recipeId], job.mode, left), stamina: job.staminaPerCraft * Math.max(0, left - 1) };
}

/**
 * CANCEL_CRAFT, bound to the job shown (`jobId`). Refunds the inputs of every craft not delivered (the one in progress
 * too) and the stamina of every x10 craft not yet started; stamina never goes above max. Refused with INVENTORY_FULL
 * when the refund would not fit (nothing changes).
 */
export function cancelCraft(draft: GameState, pipe: unknown, jobId: unknown, events: GameEvent[]): CraftError {
  const p = pipeIndex(draft, pipe);
  if ('error' in p) return p.error;
  const job = draft.crafting.pipes[p.index];
  if (!job) return err('NO_CRAFT_JOB', `Pipe ${p.index + 1} is idle`);
  if (jobId !== job.id) return err('CRAFT_CHANGED', 'That job already finished');
  // A finished gear piece is never cancelled: that would refund its inputs and drop the rolled piece.
  if (job.status === 'ready') return err('CRAFT_READY', 'The piece is finished: collect it with Done');
  const refund = cancelRefund(job);
  const newStacks = new Set(refund.items.filter((i) => i.quantity > 0 && !draft.inventory.items.some((it) => it.stackable && it.defId === i.defId)).map((i) => i.defId));
  if (newStacks.size > freeSlots(draft.inventory)) {
    return err('INVENTORY_FULL', `Free ${newStacks.size - freeSlots(draft.inventory)} inventory slot(s) first: the refunded materials need room`);
  }
  for (const i of refund.items) if (i.quantity > 0) addStackable(draft.inventory, i.defId, i.quantity);
  if (refund.stamina > 0) {
    const current = Math.min(draft.stamina.max, draft.stamina.current + refund.stamina);
    draft.stamina = { ...draft.stamina, current, progressMs: current >= draft.stamina.max ? 0 : draft.stamina.progressMs };
  }
  draft.crafting.pipes[p.index] = null;
  events.push({ type: 'CRAFT_JOB_CANCELLED', pipe: p.index, jobId: job.id });
  return null;
}

/**
 * INSTA_CRAFT: spends ceil(remaining minutes) stamina (at least 1) to finish the current craft now, bound to the pipe,
 * job and craft number shown (CRAFT_CHANGED once that craft finished) and the cost shown (COST_CHANGED when higher).
 * Refused with INVENTORY_FULL when the output would not fit (no stamina is spent), also while the pipe is held.
 */
export function instaCraft(draft: GameState, cmd: { pipe: unknown; jobId: unknown; craft: unknown; maxCost: unknown }, events: GameEvent[]): CraftError {
  if (!isCount(cmd.maxCost, 1)) return err('INVALID_AMOUNT', `Invalid maxCost ${String(cmd.maxCost)}`);
  if (!isCount(cmd.craft, 1)) return err('INVALID_COMMAND', `Invalid craft ${String(cmd.craft)}`);
  const p = pipeIndex(draft, cmd.pipe);
  if ('error' in p) return p.error;
  const job = draft.crafting.pipes[p.index];
  if (!job) return err('NO_CRAFT_JOB', `Pipe ${p.index + 1} is idle`);
  if (cmd.jobId !== job.id || cmd.craft !== job.done + 1) return err('CRAFT_CHANGED', 'That craft already finished');
  if (job.status === 'ready') return err('CRAFT_READY', 'The piece is finished: collect it with Done');
  if (job.status !== 'running' || !isRecipeId(job.recipeId)) return err('INVENTORY_FULL', 'This craft is done and waits for room in the inventory');
  const cost = instaCost(job.craftMs - job.progressMs);
  if (cost > cmd.maxCost) return err('COST_CHANGED', `Finishing now costs ${cost}, more than the ${cmd.maxCost} shown`);
  if (draft.stamina.current < cost) return err('NOT_ENOUGH_STAMINA', `Needs ${cost} stamina, has ${draft.stamina.current}`);
  const recipe = RECIPES[job.recipeId];
  // Gear waits in the pipe (ready), so it needs no room now; materials go straight into the inventory.
  if (recipe.kind !== 'gear' && !canAdd(draft.inventory, recipe.output.defId)) return err('INVENTORY_FULL', 'No room in the inventory for the crafted items');
  draft.stamina = { ...draft.stamina, current: draft.stamina.current - cost };
  job.progressMs = job.craftMs;
  deliver(draft, p.index, events, null);
  return null;
}

/**
 * COLLECT_CRAFT (Done), bound to the job shown (`jobId`): the ready gear piece goes into the inventory with its rolled
 * quality and rarity as a new instance (`<defId>#<serial>`, see collectedItemId) and the pipe turns idle. Refused with
 * INVENTORY_FULL when no slot is free (the piece stays safe in the pipe) and CRAFT_NOT_READY while it is still crafting.
 */
export function collectCraft(draft: GameState, pipe: unknown, jobId: unknown, events: GameEvent[]): CraftError {
  const p = pipeIndex(draft, pipe);
  if ('error' in p) return p.error;
  const job = draft.crafting.pipes[p.index];
  if (!job) return err('NO_CRAFT_JOB', `Pipe ${p.index + 1} is idle`);
  if (jobId !== job.id) return err('CRAFT_CHANGED', 'That job already finished');
  if (job.status !== 'ready' || !job.gear || !isRecipeId(job.recipeId)) return err('CRAFT_NOT_READY', 'Still crafting');
  if (freeSlots(draft.inventory) < 1) return err('INVENTORY_FULL', 'Free an inventory slot first: the piece waits in the pipe');
  const defId = RECIPES[job.recipeId].output.defId;
  const itemId = collectedItemId(draft, defId);
  draft.inventory.items.push(makeItem(defId, 1, itemId, { qualityBp: job.gear.qualityBp, rarity: job.gear.rarity }));
  draft.nextItemSerial += 1;
  draft.crafting.pipes[p.index] = null;
  events.push({ type: 'CRAFT_COLLECTED', pipe: p.index, jobId: job.id, itemId, defId });
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
  /** Stamina investable at start (0..maxStamina) and the floor each point adds, bp. */
  maxStamina: number;
  qualityBpPerStamina: number;
  /** The flat floor every gear craft gets now, bp (0 for now). */
  minQualityBp: number;
};

export type RecipeView = {
  recipeId: RecipeId;
  name: string;
  kind: RecipeDef['kind'];
  tier: number;
  /** Per x1 craft, with what the hero has. */
  inputs: { defId: string; perCraft: number; have: number }[];
  output: { defId: string; perCraft: number };
  /** Effective craft time right now (house level, INT). */
  craftMs: number;
  /** x10 mode: stamina per craft at the current craft time. */
  x10StaminaPerCraft: number;
  /** Most crafts the hero can start now, per mode. */
  max: Record<CraftMode, number>;
  /** Gear recipes only. */
  gear: GearRecipeView | null;
};

export function recipeView(state: GameState, recipeId: RecipeId): RecipeView {
  const r = RECIPES[recipeId];
  const ms = craftMs(state, recipeId);
  const outDef = getItemDef(r.output.defId);
  return {
    recipeId,
    name: r.name,
    kind: r.kind,
    tier: r.tier,
    inputs: r.inputs.map((i) => ({ defId: i.defId, perCraft: i.quantity, have: itemQuantity(state, i.defId) })),
    output: { defId: r.output.defId, perCraft: r.output.quantity },
    craftMs: ms,
    x10StaminaPerCraft: x10StaminaPerCraft(ms),
    max: { x1: maxCrafts(state, recipeId, 'x1'), x10: maxCrafts(state, recipeId, 'x10') },
    gear:
      r.kind === 'gear'
        ? {
            slot: outDef?.slot ?? '',
            maxStats: gearStatsAt(outDef, GEAR.maxQualityBp),
            rarityOdds: rarityOdds(gearRarityWeights(r)),
            maxStamina: GEAR.craft.maxStamina,
            qualityBpPerStamina: GEAR.craft.qualityBpPerStamina,
            minQualityBp: minQualityBp(state),
          }
        : null,
  };
}

/** A job as the screen may show it: never the rolled quality or rarity of a gear piece (revealed only by Done). */
export type CraftJobView = Omit<CraftJob, 'gear'> & {
  pipe: number;
  recipeName: string;
  kind: RecipeDef['kind'];
  outputDefId: string;
  /** Gear: the finished piece waits for Done (COLLECT_CRAFT). */
  ready: boolean;
  /** Gear: the stamina invested at start (lost on cancel); 0 for materials. */
  staminaInvested: number;
  /** The current craft's number (done + 1), which INSTA_CRAFT names. */
  craftNumber: number;
  /** Time left on the current craft, ms (0 while held). */
  remainingMs: number;
  /** progressMs ÷ craftMs, 0..1. */
  fraction: number;
  /** Estimated time to the job's end: the current craft + the rest at today's craft time. */
  jobRemainingMs: number;
  /** Stamina for INSTA_CRAFT now. */
  instaCost: number;
  refund: { items: { defId: string; quantity: number }[]; stamina: number };
};

/** `open`: usable (idle or with a job); `later`: unlocks later by play; `premium`: a premium pipe (coming soon). */
export type PipeSlotState = 'open' | 'later' | 'premium';

export type PipeView = { index: number; slot: PipeSlotState; job: CraftJobView | null };

export function craftJobView(state: GameState, index: number): CraftJobView | null {
  const job = state.crafting.pipes[index];
  if (!job || !isRecipeId(job.recipeId)) return null;
  const r = RECIPES[job.recipeId];
  const remainingMs = job.status === 'running' ? Math.max(0, job.craftMs - job.progressMs) : 0;
  const rest = Math.max(0, job.quantity - job.done - 1);
  const { gear, ...shown } = job;
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
    fraction: job.craftMs > 0 ? Math.min(1, job.progressMs / job.craftMs) : 1,
    jobRemainingMs: remainingMs + rest * craftMs(state, job.recipeId),
    instaCost: instaCost(remainingMs),
    refund: cancelRefund(job),
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
  /** Pipes with a job (running, held or ready). */
  busy: number;
  /** Some pipe waits for inventory room. */
  held: boolean;
  /** Pipes holding a finished gear piece (waiting for Done). */
  ready: number;
  /** Shortest estimated time to a job's end among running pipes, or null. */
  nextJobDoneMs: number | null;
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
  let ready = 0;
  let nextJobDoneMs: number | null = null;
  for (const p of pipes) {
    if (!p.job) continue;
    busy += 1;
    if (p.job.status === 'held') held = true;
    else if (p.job.status === 'ready') ready += 1;
    else nextJobDoneMs = nextJobDoneMs === null ? p.job.jobRemainingMs : Math.min(nextJobDoneMs, p.job.jobRemainingMs);
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
    ready,
    nextJobDoneMs,
    recipes: RECIPE_IDS.map((id) => recipeView(state, id)),
  };
}

/**
 * The Village sign's line: busy pipes of the open ones, any held pipe, the shortest time to a job's end, and the name
 * of a finished gear piece waiting for Done ("Iron Sword ready"; the first in pipe order). Null when idle.
 */
export type CraftingSign = { busy: number; open: number; held: boolean; nextJobDoneMs: number; readyName: string | null };

/** Cheap (no recipe views): read on every live tick by the Village. */
export function craftingSign(state: GameState): CraftingSign | null {
  const c = state.crafting;
  let busy = 0;
  let held = false;
  let readyName: string | null = null;
  let next = Number.POSITIVE_INFINITY;
  c.pipes.forEach((job, i) => {
    if (!job) return;
    busy += 1;
    if (job.status === 'ready') readyName ??= isRecipeId(job.recipeId) ? RECIPES[job.recipeId].name : null;
    else if (job.status !== 'running') held = true;
    else next = Math.min(next, craftJobView(state, i)?.jobRemainingMs ?? next);
  });
  if (busy === 0) return null;
  return { busy, open: c.pipesUnlocked, held, nextJobDoneMs: Number.isFinite(next) ? next : 0, readyName };
}
