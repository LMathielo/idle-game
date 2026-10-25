// Rebuilds state from an action log. This is what a server will run to validate a client:
// same seed + same entries → same state hash at every step.
import { applyCommand, type Command } from './commands';
import { newGame } from './newGame';
import { simulate } from './simulate';
import type { GameState } from './types';

/** Every row type the client writes to the action log. */
export const LOG_TYPES = [
  'NEW_GAME',
  'START_ACTIVITY',
  'STOP_ACTIVITY',
  'DEBUG_GRANT_HERO_XP',
  'RESUME',
  'SIMULATE',
  'CLOCK_ANOMALY',
  'DEBUG_CLOCK_OFFSET',
  'DEBUG_RESET_SAVE',
] as const;

export type LogType = (typeof LOG_TYPES)[number];

export type ReplayEntry = { type: string; payload: unknown; clientTime: number };

export class ReplayError extends Error {}

/** Applies one log entry. Informational rows (anomalies, debug clock) leave the state unchanged. */
export function replayStep(state: GameState | null, entry: ReplayEntry): GameState {
  const { type, payload, clientTime } = entry;
  if (type === 'NEW_GAME') {
    const seed = (payload as { seed?: unknown })?.seed;
    if (typeof seed !== 'number') throw new ReplayError('NEW_GAME without seed');
    return newGame(seed, clientTime);
  }
  if (!state) throw new ReplayError(`${type} before NEW_GAME`);
  switch (type as LogType) {
    case 'START_ACTIVITY':
    case 'STOP_ACTIVITY':
    case 'DEBUG_GRANT_HERO_XP': {
      const res = applyCommand(state, payload as Command, clientTime);
      if (!res.ok) throw new ReplayError(`${type} rejected on replay: ${res.error.code}`);
      return res.state;
    }
    case 'RESUME':
    case 'SIMULATE':
      return simulate(state, clientTime).state;
    case 'CLOCK_ANOMALY':
    case 'DEBUG_CLOCK_OFFSET':
    case 'DEBUG_RESET_SAVE':
      return state;
    default:
      throw new ReplayError(`Unknown log type ${type}`);
  }
}

export function replayLog(entries: readonly ReplayEntry[]): GameState | null {
  let state: GameState | null = null;
  for (const e of entries) state = replayStep(state, e);
  return state;
}
