import { FakeClock } from '../src/client/clock';
import { LocalGameClient } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { CommandInput } from '../src/client/types';
import { applyCommand, BUILDING_IDS, BUILDINGS, type BuildingId, type Command, ENGINE_VERSION, type GameState, newGame, type ReplayEntry } from '../src/engine';

export const T0 = Date.UTC(2026, 9, 25, 12, 0, 0); // fixed epoch for deterministic tests
export const SEC = 1000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;

export function idSource(prefix = 'id') {
  let n = 0;
  let seed = 12345;
  return {
    uuid: () => `${prefix}-${++n}`,
    seed: () => (seed = (seed * 1103515245 + 12345) >>> 0),
  };
}

export function makeClient(opts: { repo?: MemoryGameRepository; clock?: FakeClock; prefix?: string } = {}) {
  const repo = opts.repo ?? new MemoryGameRepository();
  const clock = opts.clock ?? new FakeClock(T0);
  const client = new LocalGameClient(repo, clock, idSource(opts.prefix));
  return { repo, clock, client };
}

let cmdN = 0;
export function cmd(c: CommandInput): Command {
  return { ...c, id: `cmd-${++cmdN}` } as Command;
}

export function apply(state: GameState, c: CommandInput, now: number): GameState {
  const res = applyCommand(state, cmd(c), now);
  if (!res.ok) throw new Error(`${res.error.code}: ${res.error.message}`);
  return res.state;
}

/**
 * The state with buildings marked built and their build effects applied (the Training Grounds raise the training
 * tier to at least 1), as a real build would leave it; no gold or items are spent. For engine tests of the rules
 * inside a building; BUILD itself is tested in tests/buildings.test.ts.
 */
export function withBuilt(state: GameState, ids: readonly BuildingId[] = BUILDING_IDS): GameState {
  const buildings = { ...state.buildings };
  let training = state.training;
  for (const id of ids) {
    buildings[id] = { state: 'built', level: 1 };
    const tier = BUILDINGS[id].grantsTrainingTier;
    if (tier !== undefined && training.tier < tier) training = { ...training, tier };
  }
  return { ...state, buildings, training };
}

/** newGame() with every building already built (see withBuilt): Training Tier 1 comes with the Training Grounds. */
export function builtGame(seed: number, now: number): GameState {
  return withBuilt(newGame(seed, now));
}

/**
 * Builds buildings through the client with logged DEBUG_BUILD rows, so the log still replays. Sets debugUsed;
 * the Training Grounds also grant Training Tier 1. Default: Woodcutting and Mine Shaft.
 */
export async function debugBuild(client: LocalGameClient, ids: readonly BuildingId[] = ['woodcutting', 'mine_shaft']) {
  for (const id of ids) {
    const r = await client.debug.build(id);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  }
}

/** New game at T0 (buildings built) with woodcutting running. */
export function woodcuttingGame(seed = 42): GameState {
  return apply(builtGame(seed, T0), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0);
}

export function qty(state: GameState, id: string): number {
  return state.inventory.items.find((i) => i.id === id)?.quantity ?? 0;
}

/** Hand-written log rows, stamped with the current engine (replayLog requires every row's engineVersion). */
export function current(rows: ReplayEntry[]): ReplayEntry[] {
  return rows.map((r) => ({ engineVersion: ENGINE_VERSION, ...r }));
}

/** Banked time of a gathering or dungeon activity (training keeps its progress per attribute instead). */
export function progressMs(state: GameState): number | undefined {
  const a = state.activity;
  return a && 'progressMs' in a ? a.progressMs : undefined;
}
