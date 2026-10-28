// Workers (pure): hiring, assignment, crews that gather on their own, and upkeep. Data in config/workers.ts; the
// worker cap per Town Hall level is a building bonus. See docs/ENGINE.md ("Workers").
//
//   hire cost        = 100 × 2^(workers owned)                          (no refund on dismiss)
//   crew power       = 25% × the hero's CURRENT power for the skill × workers on the node
//   yield / action   = crew power ÷ node requirement × bonus multiplier  (whole part + fraction as a chance, gathering.ts)
//   action time      = the node's base time (no DEX)
//   upkeep           = tier upkeep × working workers, per started minute; can't pay → every crew pauses
//
// Crews run inside the world walk (world.ts) on the granted time, side by side with the hero, with no XP and no
// rare drops. The hero working the same node is separate and additive.
import { workerCap, yieldMultiplierBp } from './bonuses';
import { buildingLevel, isBuilt } from './buildings';
import { BUILDINGS } from './config/buildings';
import { ROCK_IDS, ROCKS } from './config/mining';
import { BASIS_POINTS } from './config/stats';
import { TREE_IDS, TREES } from './config/woodcutting';
import { WORKERS } from './config/workers';
import { rollYield } from './gathering';
import { addStackable } from './inventory';
import { miningStrength, rockCheck } from './mining';
import { treeCheck, woodcuttingStrength } from './woodcutting';
import type { BuildingId, GameEvent, GameState, GatheringKind, SimulationSummary, WorkerNodeId, WorkersState } from './types';

// ---------- nodes ----------

/** Every node, in the order crews act at the same instant (trees, then rocks). */
export const WORKER_NODE_IDS: readonly WorkerNodeId[] = [...TREE_IDS, ...ROCK_IDS];

export type WorkerNodeDef = {
  node: WorkerNodeId;
  kind: GatheringKind;
  name: string;
  icon: string;
  /** 1 = Oak / Stone … 5 = Ironwood / Gold. */
  tier: number;
  reqLevel: number;
  /** Required power: the yield divisor. */
  req: number;
  /** One crew action (no DEX). */
  baseMs: number;
  itemId: string;
  building: BuildingId;
  upkeepPerMin: number;
};

export function isWorkerNodeId(id: unknown): id is WorkerNodeId {
  return typeof id === 'string' && (WORKER_NODE_IDS as readonly string[]).includes(id);
}

export function workerNodeDef(node: WorkerNodeId): WorkerNodeDef {
  const treeTier = (TREE_IDS as readonly string[]).indexOf(node);
  if (treeTier >= 0) {
    const t = TREES[node as (typeof TREE_IDS)[number]];
    return {
      node,
      kind: 'woodcutting',
      name: t.name,
      icon: t.icon,
      tier: treeTier + 1,
      reqLevel: t.reqLevel,
      req: t.reqWs,
      baseMs: t.baseMs,
      itemId: t.logItemId,
      building: 'woodcutting',
      upkeepPerMin: WORKERS.upkeepPerMinByTier[treeTier],
    };
  }
  const rockTier = (ROCK_IDS as readonly string[]).indexOf(node);
  const r = ROCKS[node as (typeof ROCK_IDS)[number]];
  return {
    node,
    kind: 'mining',
    name: r.name,
    icon: r.icon,
    tier: rockTier + 1,
    reqLevel: r.reqLevel,
    req: r.reqMs,
    baseMs: r.baseMs,
    itemId: r.oreItemId,
    building: 'mine_shaft',
    upkeepPerMin: WORKERS.upkeepPerMinByTier[rockTier],
  };
}

/** The hero's current gathering power for a skill (WS or MS), which crews take their share of. */
export function heroPower(state: GameState, kind: GatheringKind): number {
  return kind === 'woodcutting' ? woodcuttingStrength(state).value : miningStrength(state).value;
}

export type NodeCheck = { buildingOk: boolean; levelOk: boolean; powerOk: boolean; ok: boolean };

/** Can workers work this node now: its building is built and the HERO can work it (skill level and power). */
export function nodeCheck(state: GameState, node: WorkerNodeId): NodeCheck {
  const def = workerNodeDef(node);
  const buildingOk = isBuilt(state, def.building);
  const c = def.kind === 'woodcutting' ? treeCheck(state, node as (typeof TREE_IDS)[number]) : rockCheck(state, node as (typeof ROCK_IDS)[number]);
  const powerOk = def.kind === 'woodcutting' ? (c as ReturnType<typeof treeCheck>).wsOk : (c as ReturnType<typeof rockCheck>).msOk;
  return { buildingOk, levelOk: c.levelOk, powerOk, ok: buildingOk && c.levelOk && powerOk };
}

/** Workers assigned to `node`. */
export function crewSize(workers: WorkersState, node: WorkerNodeId): number {
  let n = 0;
  for (const w of workers.list) if (w.node === node) n += 1;
  return n;
}

// ---------- yield ----------

/**
 * Yield of one crew action in basis points: crew power ÷ requirement × bonus, where crew power = hero power ×
 * 25% × (worker·ms over the action ÷ base time), i.e. the average crew size. Integer math, staged so it stays far
 * below 2^53 (hero power ≤ ~10^6, ≤ 15 workers).
 */
export function crewYieldBp(power: number, workMs: number, baseMs: number, req: number, multiplierBp: number): number {
  if (!(power > 0) || !(workMs > 0) || !(baseMs > 0) || !(multiplierBp > 0)) return 0;
  const workerBp = Math.floor((workMs * BASIS_POINTS) / baseMs); // average workers × 10 000
  const crewPowerCenti = Math.floor((power * WORKERS.crewShareBp * workerBp) / (BASIS_POINTS * 100)); // power × 100
  return Math.floor((crewPowerCenti * multiplierBp) / (Math.max(1, req) * 100));
}

/** Expected items per crew action with `workers` on it right now, in basis points (for the UI). */
export function expectedCrewYieldBp(state: GameState, node: WorkerNodeId, workers: number): number {
  const def = workerNodeDef(node);
  return crewYieldBp(heroPower(state, def.kind), workers * def.baseMs, def.baseMs, def.req, yieldMultiplierBp(state, def.kind));
}

// ---------- hiring ----------

/** 100 × 2^owned, computed by doubling (no Math.pow). */
export function hireCost(owned: number): number {
  let cost: number = WORKERS.hireBaseGold;
  for (let i = 0; i < owned; i += 1) cost *= 2;
  return cost;
}

export function newWorkersState(): WorkersState {
  return { list: [], nextSerial: 1, crews: {}, paused: false, minuteLeftMs: 0, paidPerMin: 0 };
}

export type WorkerErrorCode =
  | 'BUILDING_LOCKED'
  | 'WORKER_CAP'
  | 'COST_CHANGED'
  | 'NOT_ENOUGH_GOLD'
  | 'INVALID_AMOUNT'
  | 'UNKNOWN_WORKER'
  | 'UNKNOWN_NODE'
  | 'NODE_LOCKED';

export type WorkerError = { code: WorkerErrorCode; message: string } | null;

const err = (code: WorkerErrorCode, message: string): WorkerError => ({ code, message });

/** HIRE_WORKER on a full draft copy. `maxCost` is the price the player saw: a double tap never pays the doubled price. */
export function hireWorker(draft: GameState, maxCost: unknown, events: GameEvent[]): WorkerError {
  if (!isBuilt(draft, 'town_hall')) return err('BUILDING_LOCKED', `Build the ${BUILDINGS.town_hall.name} first`);
  if (typeof maxCost !== 'number' || !Number.isSafeInteger(maxCost) || maxCost <= 0) return err('INVALID_AMOUNT', `Invalid maxCost ${String(maxCost)}`);
  const w = draft.workers;
  const cap = workerCap(draft);
  if (w.list.length >= cap) {
    return err('WORKER_CAP', `Town Hall level ${buildingLevel(draft, 'town_hall')} houses ${cap} workers: upgrade it for more`);
  }
  const cost = hireCost(w.list.length);
  if (cost > maxCost) return err('COST_CHANGED', `Hiring now costs ${cost}, more than the ${maxCost} shown`);
  const gold = draft.character.gold;
  if (!Number.isSafeInteger(gold) || gold < cost) return err('NOT_ENOUGH_GOLD', `Hiring costs ${cost} gold, you have ${gold}`);
  draft.character.gold = gold - cost;
  const id = `w${w.nextSerial}`;
  w.list.push({ id, node: null });
  w.nextSerial += 1;
  events.push({ type: 'WORKER_HIRED', workerId: id });
  return null;
}

/** Takes a worker off its node; the crew goes away with its last worker (its progress is dropped). Mutates `w`. */
function leaveNode(w: WorkersState, index: number): void {
  const node = w.list[index].node;
  w.list[index] = { ...w.list[index], node: null };
  if (node && crewSize(w, node) === 0) delete w.crews[node];
}

/** DISMISS_WORKER: gone for good, no refund. */
export function dismissWorker(draft: GameState, workerId: unknown): WorkerError {
  const w = draft.workers;
  const index = w.list.findIndex((x) => x.id === workerId);
  if (index < 0) return err('UNKNOWN_WORKER', `No worker ${String(workerId)}`);
  leaveNode(w, index);
  w.list.splice(index, 1);
  return null;
}

/**
 * ASSIGN_WORKER: the node must be a tree or rock the HERO can work now (its building built, skill level and power
 * at its requirement). The same node again changes nothing; another node moves the worker (a crew left empty goes
 * away). A crew keeps its progress when workers join or leave; the yield follows the worker·ms put in.
 */
export function assignWorker(draft: GameState, workerId: unknown, node: unknown): WorkerError {
  const w = draft.workers;
  const index = w.list.findIndex((x) => x.id === workerId);
  if (index < 0) return err('UNKNOWN_WORKER', `No worker ${String(workerId)}`);
  if (!isWorkerNodeId(node)) return err('UNKNOWN_NODE', `Unknown node ${String(node)}`);
  const def = workerNodeDef(node);
  const check = nodeCheck(draft, node);
  if (!check.buildingOk) return err('BUILDING_LOCKED', `Build the ${BUILDINGS[def.building].name} first`);
  if (!check.ok) {
    const skill = def.kind === 'woodcutting' ? 'woodcutting' : 'mining';
    const missing = [check.levelOk ? null : `${skill} level ${def.reqLevel}`, check.powerOk ? null : `${def.req} ${skill} strength (you have ${heroPower(draft, def.kind)})`].filter(Boolean);
    return err('NODE_LOCKED', `Workers can only work what you can: ${def.name} needs ${missing.join(' and ')}`);
  }
  if (w.list[index].node === node) return null;
  leaveNode(w, index);
  w.list[index] = { ...w.list[index], node };
  if (!w.crews[node]) w.crews[node] = { progressMs: 0, workMs: 0, idle: false };
  return null;
}

/** UNASSIGN_WORKER: back to unassigned (costs nothing). Already unassigned changes nothing. */
export function unassignWorker(draft: GameState, workerId: unknown): WorkerError {
  const w = draft.workers;
  const index = w.list.findIndex((x) => x.id === workerId);
  if (index < 0) return err('UNKNOWN_WORKER', `No worker ${String(workerId)}`);
  leaveNode(w, index);
  return null;
}

// ---------- upkeep and the crews over time ----------

/** Upkeep per minute of the crews that can work now (idle crews and unassigned workers cost nothing). */
export function upkeepPerMin(state: GameState): number {
  let total = 0;
  for (const node of WORKER_NODE_IDS) {
    const crew = state.workers.crews[node];
    if (!crew || crew.idle) continue;
    total += crewSize(state.workers, node) * workerNodeDef(node).upkeepPerMin;
  }
  return total;
}

/** The crews are working right now (someone assigned to a node the hero can work, upkeep paid). */
export function crewsWorking(state: GameState): boolean {
  return !state.workers.paused && upkeepPerMin(state) > 0;
}

/**
 * Brings the workforce up to date at one instant (the start of every world-walk step, and after every command):
 *  1. each crew's `idle` flag follows whether the hero can work its node (CREW_IDLE / CREW_ACTIVE on a change);
 *  2. upkeep: a new minute is paid in full when the last one ran out; mid-minute, a rise in upkeep (a crew joining)
 *     pays the difference. When gold can't cover what is due, every crew pauses (WORKERS_PAUSED) and nothing is
 *     charged; once gold covers it, it is paid and they resume (WORKERS_RESUMED).
 * Mutates draft.workers and draft.character (the caller owns both).
 */
export function settleWorkers(draft: GameState, events: GameEvent[], summary: SimulationSummary | null): void {
  const w = draft.workers;
  for (const node of WORKER_NODE_IDS) {
    const crew = w.crews[node];
    if (!crew) continue;
    const idle = !nodeCheck(draft, node).ok;
    if (idle !== crew.idle) {
      w.crews[node] = { ...crew, idle };
      events.push(idle ? { type: 'CREW_IDLE', node } : { type: 'CREW_ACTIVE', node });
    }
  }
  const cost = upkeepPerMin(draft);
  if (cost === 0) {
    w.paused = false; // nobody can work: nothing to pay, nothing paused
    return;
  }
  const newMinute = w.minuteLeftMs <= 0;
  const due = newMinute ? cost : Math.max(0, cost - w.paidPerMin);
  if (due > 0) {
    const gold = draft.character.gold;
    if (!Number.isSafeInteger(gold) || gold < due) {
      if (!w.paused) events.push({ type: 'WORKERS_PAUSED', upkeepDue: due });
      w.paused = true;
      return;
    }
    draft.character.gold = gold - due;
    if (summary) summary.upkeepPaid += due;
    if (newMinute) w.minuteLeftMs = WORKERS.upkeepStepMs;
    w.paidPerMin = cost;
  }
  if (w.paused) {
    w.paused = false;
    events.push({ type: 'WORKERS_RESUMED' });
  }
}

/** Wall ms to the crews' next event (an action completing, or the paid minute running out); Infinity when none works. */
export function crewsNextEventMs(state: GameState): number {
  if (!crewsWorking(state)) return Number.POSITIVE_INFINITY;
  const eff = state.offline.efficiency;
  if (!(eff > 0)) return Number.POSITIVE_INFINITY;
  let next = state.workers.minuteLeftMs;
  for (const node of WORKER_NODE_IDS) {
    const crew = state.workers.crews[node];
    if (!crew || crew.idle) continue;
    next = Math.min(next, Math.ceil(Math.max(0, workerNodeDef(node).baseMs - crew.progressMs) / eff));
  }
  return next;
}

function bump(map: Record<string, number>, key: string, by: number) {
  if (by !== 0) map[key] = (map[key] ?? 0) + by;
}

/**
 * The crews over `ms` of granted wall time (one world-walk step, never past their next event): each working crew's
 * timer and worker·ms advance; a crew whose action is done gathers (yield roll, seeded) into the inventory (lost
 * when it doesn't fit), in WORKER_NODE_IDS order. The paid minute runs down. Mutates draft.workers, draft.inventory
 * and draft.rng (the caller owns them).
 */
export function advanceCrews(draft: GameState, ms: number, summary: SimulationSummary): void {
  if (!(ms > 0) || !crewsWorking(draft)) return;
  const w = draft.workers;
  const worked = ms * draft.offline.efficiency;
  for (const node of WORKER_NODE_IDS) {
    const crew = w.crews[node];
    if (!crew || crew.idle) continue;
    const n = crewSize(w, node);
    const def = workerNodeDef(node);
    let progressMs = crew.progressMs + worked;
    let workMs = crew.workMs + worked * n;
    if (progressMs >= def.baseMs) {
      // The walk stops at every completion, so `over` is 0 at efficiency 1; kept exact anyway.
      const over = progressMs - def.baseMs;
      const bp = crewYieldBp(heroPower(draft, def.kind), workMs - over * n, def.baseMs, def.req, yieldMultiplierBp(draft, def.kind));
      const y = rollYield(draft.rng, bp);
      draft.rng = y.rng;
      if (y.count > 0) {
        const { added, lost } = addStackable(draft.inventory, def.itemId, y.count);
        bump(summary.workerItemsGained, def.itemId, added);
        bump(summary.workerItemsLost, def.itemId, lost);
      }
      summary.workerActions += 1;
      progressMs = over;
      workMs = over * n;
    }
    w.crews[node] = { ...crew, progressMs, workMs };
  }
  w.minuteLeftMs = Math.max(0, w.minuteLeftMs - ms);
}

// ---------- views ----------

export type WorkerStatus = 'unassigned' | 'working' | 'idle' | 'paused';

export type WorkerView = { id: string; node: WorkerNodeId | null; nodeName: string | null; icon: string | null; status: WorkerStatus };

export type CrewView = {
  node: WorkerNodeId;
  name: string;
  icon: string;
  kind: GatheringKind;
  tier: number;
  workers: number;
  status: Exclude<WorkerStatus, 'unassigned'>;
  /** Gold per minute while it works. */
  upkeepPerMin: number;
  /** Expected items per action, basis points. */
  yieldBp: number;
  /** Expected items per minute (display only). */
  itemsPerMin: number;
  itemId: string;
  /** Progress of the current action, 0..1, and its time left. */
  fraction: number;
  remainingMs: number;
};

export type NodeChoice = {
  node: WorkerNodeId;
  name: string;
  icon: string;
  kind: GatheringKind;
  tier: number;
  /** Gold per worker per minute. */
  upkeepPerMin: number;
  /** Expected items per minute for ONE more worker joining (display only). */
  itemsPerMinPerWorker: number;
  itemId: string;
  available: boolean;
  /** Why not, when unavailable. */
  reason: string | null;
};

export type WorkersView = {
  /** The Town Hall is built (workers can be hired). */
  unlocked: boolean;
  hired: number;
  cap: number;
  /** Price of the next hire, or null at the cap. */
  hireCost: number | null;
  canHire: boolean;
  paused: boolean;
  /** Gold per minute of the crews that can work. */
  upkeepPerMin: number;
  workers: WorkerView[];
  /** In WORKER_NODE_IDS order. */
  crews: CrewView[];
};

const perMin = (bp: number, baseMs: number) => (bp / BASIS_POINTS) * (60_000 / baseMs);

export function crewViews(state: GameState, kind?: GatheringKind): CrewView[] {
  const w = state.workers;
  const out: CrewView[] = [];
  for (const node of WORKER_NODE_IDS) {
    const crew = w.crews[node];
    if (!crew) continue;
    const def = workerNodeDef(node);
    if (kind && def.kind !== kind) continue;
    const n = crewSize(w, node);
    const yieldBpNow = expectedCrewYieldBp(state, node, n);
    out.push({
      node,
      name: def.name,
      icon: def.icon,
      kind: def.kind,
      tier: def.tier,
      workers: n,
      status: crew.idle ? 'idle' : w.paused ? 'paused' : 'working',
      upkeepPerMin: n * def.upkeepPerMin,
      yieldBp: yieldBpNow,
      itemsPerMin: perMin(yieldBpNow, def.baseMs),
      itemId: def.itemId,
      fraction: def.baseMs > 0 ? Math.min(1, crew.progressMs / def.baseMs) : 0,
      remainingMs: Math.max(0, def.baseMs - crew.progressMs),
    });
  }
  return out;
}

export function nodeChoices(state: GameState): NodeChoice[] {
  return WORKER_NODE_IDS.map((node) => {
    const def = workerNodeDef(node);
    const c = nodeCheck(state, node);
    const n = crewSize(state.workers, node);
    const extra = expectedCrewYieldBp(state, node, n + 1) - expectedCrewYieldBp(state, node, n);
    const skill = def.kind === 'woodcutting' ? 'WS' : 'MS';
    const reason = !c.buildingOk
      ? `Build the ${BUILDINGS[def.building].name}`
      : !c.levelOk
        ? `Needs ${def.kind} level ${def.reqLevel}`
        : !c.powerOk
          ? `Needs ${def.req} ${skill}`
          : null;
    return {
      node,
      name: def.name,
      icon: def.icon,
      kind: def.kind,
      tier: def.tier,
      upkeepPerMin: def.upkeepPerMin,
      itemsPerMinPerWorker: perMin(extra, def.baseMs),
      itemId: def.itemId,
      available: c.ok,
      reason,
    };
  });
}

export function workersView(state: GameState): WorkersView {
  const w = state.workers;
  const cap = workerCap(state);
  const atCap = w.list.length >= cap;
  const cost = atCap ? null : hireCost(w.list.length);
  const unlocked = isBuilt(state, 'town_hall');
  return {
    unlocked,
    hired: w.list.length,
    cap,
    hireCost: cost,
    canHire: unlocked && cost !== null && state.character.gold >= cost,
    paused: w.paused,
    upkeepPerMin: upkeepPerMin(state),
    workers: w.list.map((x) => {
      const crew = x.node ? w.crews[x.node] : undefined;
      const def = x.node ? workerNodeDef(x.node) : null;
      const status: WorkerStatus = !x.node ? 'unassigned' : crew?.idle ? 'idle' : w.paused ? 'paused' : 'working';
      return { id: x.id, node: x.node, nodeName: def?.name ?? null, icon: def?.icon ?? null, status };
    }),
    crews: crewViews(state),
  };
}
