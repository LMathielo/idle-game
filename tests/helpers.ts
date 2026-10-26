import { FakeClock } from '../src/client/clock';
import { LocalGameClient } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { CommandInput } from '../src/client/types';
import { applyCommand, type Command, ENGINE_VERSION, type GameState, newGame, type ReplayEntry } from '../src/engine';

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

/** New game at T0 with woodcutting running. */
export function woodcuttingGame(seed = 42): GameState {
  return apply(newGame(seed, T0), { type: 'START_ACTIVITY', kind: 'woodcutting' }, T0);
}

export function qty(state: GameState, id: string): number {
  return state.inventory.items.find((i) => i.id === id)?.quantity ?? 0;
}

/** Hand-written log rows, stamped with the current engine (replayLog requires every row's engineVersion). */
export function current(rows: ReplayEntry[]): ReplayEntry[] {
  return rows.map((r) => ({ engineVersion: ENGINE_VERSION, ...r }));
}
