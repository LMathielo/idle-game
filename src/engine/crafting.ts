// Crafting house (pure): pipes that turn materials into crafted items on engine time, beside everything else. Data in
// config/crafting.ts; see docs/ENGINE.md ("Crafting").
//
//   START_CRAFT   pays every input of the whole job (and, in x10 mode, every craft's stamina) up front, atomically
//   world walk    each running pipe advances on the granted time; a finished craft delivers its output (or holds the
//                 pipe while the output does not fit) and the next craft starts with a duration computed right then
//   INSTA_CRAFT   ceil(remaining minutes) stamina finishes the current craft now
//   CANCEL_CRAFT  refunds the inputs of every craft not yet delivered and the stamina of every x10 craft not yet started
//
// Pipes are NOT an activity: they never use the hero and never stop (or get stopped by) gathering, dungeons or
// training. They never compete for materials: a job owns its inputs from the moment it starts.
import { effectiveAttributes, type AttributeInput } from './attributes';
import { levelBonuses } from './bonuses';
import { consumeItem, isBuilt } from './buildings';
import { BUILDINGS } from './config/buildings';
import { CRAFTING, isCraftMode, isRecipeId, RECIPE_IDS, RECIPES, type RecipeDef, type RecipeId } from './config/crafting';
import { getItemDef } from './config/items';
import { BASIS_POINTS, STAT_EFFECTS } from './config/stats';
import { diminishingBp } from './diminishing';
import { addStackable, freeSlots } from './inventory';
import { itemQuantity } from './selectors';
import type { CraftingState, CraftJob, CraftMode, GameEvent, GameState, Inventory, SimulationSummary } from './types';

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
  | 'PIPES_MAXED';

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
  let n: number = CRAFTING.maxJobQuantity;
  for (const i of inputsFor(recipe, mode, 1)) n = Math.min(n, Math.floor(itemQuantity(state, i.defId) / i.quantity));
  if (mode === 'x10') n = Math.min(n, Math.floor(state.stamina.current / x10StaminaPerCraft(craftMs(state, recipeId))));
  return Math.max(0, n);
}

/** Stamina a job costs up front: 0 in x1, x10StaminaPerCraft(effective craft time) × crafts in x10. */
export function craftStaminaCost(state: GameState, recipeId: RecipeId, mode: CraftMode, quantity: number): number {
  return mode === 'x10' ? x10StaminaPerCraft(craftMs(state, recipeId)) * quantity : 0;
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
  cmd: { pipe: unknown; recipeId: unknown; quantity: unknown; mode: unknown; maxCost: unknown },
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
  const inputs = inputsFor(recipe, mode, quantity);
  const missing = inputs.filter((i) => itemQuantity(draft, i.defId) < i.quantity);
  if (missing.length > 0) {
    const text = missing.map((i) => `${i.quantity} ${getItemDef(i.defId)?.name ?? i.defId} (you have ${itemQuantity(draft, i.defId)})`).join(', ');
    return err('NOT_ENOUGH_ITEMS', `${quantity} × ${recipe.name} needs ${text}`);
  }
  const ms = craftMs(draft, recipeId);
  const staminaPerCraft = mode === 'x10' ? x10StaminaPerCraft(ms) : 0;
  const stamina = staminaPerCraft * quantity;
  if (stamina > maxCost) return err('COST_CHANGED', `This job now costs ${stamina} stamina, more than the ${maxCost} shown`);
  if (stamina > draft.stamina.current) return err('NOT_ENOUGH_STAMINA', `Needs ${stamina} stamina, has ${draft.stamina.current}`);
  for (const i of inputs) consumeItem(draft, i.defId, i.quantity);
  if (stamina > 0) draft.stamina = { ...draft.stamina, current: draft.stamina.current - stamina };
  const job: CraftJob = { id: c.nextJobSerial, recipeId, mode, quantity, done: 0, craftMs: ms, progressMs: 0, staminaPerCraft, status: 'running', startedAt: now };
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
  if (job.status !== 'running' || !isRecipeId(job.recipeId)) return err('INVENTORY_FULL', 'This craft is done and waits for room in the inventory');
  const cost = instaCost(job.craftMs - job.progressMs);
  if (cost > cmd.maxCost) return err('COST_CHANGED', `Finishing now costs ${cost}, more than the ${cmd.maxCost} shown`);
  if (draft.stamina.current < cost) return err('NOT_ENOUGH_STAMINA', `Needs ${cost} stamina, has ${draft.stamina.current}`);
  if (!canAdd(draft.inventory, RECIPES[job.recipeId].output.defId)) return err('INVENTORY_FULL', 'No room in the inventory for the crafted items');
  draft.stamina = { ...draft.stamina, current: draft.stamina.current - cost };
  job.progressMs = job.craftMs;
  deliver(draft, p.index, events, null);
  return null;
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

export type RecipeView = {
  recipeId: RecipeId;
  name: string;
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
};

export function recipeView(state: GameState, recipeId: RecipeId): RecipeView {
  const r = RECIPES[recipeId];
  const ms = craftMs(state, recipeId);
  return {
    recipeId,
    name: r.name,
    tier: r.tier,
    inputs: r.inputs.map((i) => ({ defId: i.defId, perCraft: i.quantity, have: itemQuantity(state, i.defId) })),
    output: { defId: r.output.defId, perCraft: r.output.quantity },
    craftMs: ms,
    x10StaminaPerCraft: x10StaminaPerCraft(ms),
    max: { x1: maxCrafts(state, recipeId, 'x1'), x10: maxCrafts(state, recipeId, 'x10') },
  };
}

export type CraftJobView = CraftJob & {
  pipe: number;
  recipeName: string;
  outputDefId: string;
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
  return {
    ...job,
    pipe: index,
    recipeName: r.name,
    outputDefId: r.output.defId,
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
  /** Pipes with a job (running or held). */
  busy: number;
  /** Some pipe waits for inventory room. */
  held: boolean;
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
  let nextJobDoneMs: number | null = null;
  for (const p of pipes) {
    if (!p.job) continue;
    busy += 1;
    if (p.job.status === 'held') held = true;
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
    nextJobDoneMs,
    recipes: RECIPE_IDS.map((id) => recipeView(state, id)),
  };
}

/** The Village sign's line: busy pipes of the open ones, any held pipe, the shortest time to a job's end. Null when idle. */
export type CraftingSign = { busy: number; open: number; held: boolean; nextJobDoneMs: number };

/** Cheap (no recipe views): read on every live tick by the Village. */
export function craftingSign(state: GameState): CraftingSign | null {
  const c = state.crafting;
  let busy = 0;
  let held = false;
  let next = Number.POSITIVE_INFINITY;
  c.pipes.forEach((job, i) => {
    if (!job) return;
    busy += 1;
    if (job.status !== 'running') held = true;
    else next = Math.min(next, craftJobView(state, i)?.jobRemainingMs ?? next);
  });
  if (busy === 0) return null;
  return { busy, open: c.pipesUnlocked, held, nextJobDoneMs: Number.isFinite(next) ? next : 0 };
}
