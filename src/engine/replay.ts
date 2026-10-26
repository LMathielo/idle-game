// Rebuilds state from an action log. This is what a server will run to validate a client:
// same seed + same entries → same state hash at every step.
import { applyCommand, type Command } from './commands';
import { markDebugUsed } from './flags';
import { newGame } from './newGame';
import { simulate } from './simulate';
import type { GameState } from './types';

/** Every row type the client writes to the action log. */
export const LOG_TYPES = [
  'NEW_GAME',
  'START_ACTIVITY',
  'STOP_ACTIVITY',
  'DEBUG_GRANT_HERO_XP',
  'DEBUG_SPEND_STAMINA',
  'DEBUG_REFILL_STAMINA',
  'DEBUG_ADD_ATTRIBUTE',
  'RESUME',
  'SIMULATE',
  'CLOCK_ANOMALY',
  'DEBUG_CLOCK_OFFSET',
  'DEBUG_RESET_SAVE',
] as const;

export type LogType = (typeof LOG_TYPES)[number];

export type ReplayEntry = {
  type: string;
  payload: unknown;
  clientTime: number;
  /** Engine version that produced the row. Recorded for a future server; replay uses the current rules. */
  engineVersion?: string;
};

export class ReplayError extends Error {}

/**
 * Applies one log entry. CLOCK_ANOMALY rows leave the state unchanged; DEBUG_CLOCK_OFFSET and
 * DEBUG_RESET_SAVE only set flags.debugUsed. DEBUG_* commands are accepted whatever the build flag says.
 */
export function replayStep(state: GameState | null, entry: ReplayEntry): GameState {
  const { type, payload, clientTime } = entry;
  if (type === 'NEW_GAME') {
    const p = payload as { seed?: unknown; debugUsed?: unknown } | null;
    if (typeof p?.seed !== 'number') throw new ReplayError('NEW_GAME without seed');
    const fresh = newGame(p.seed, clientTime);
    // A save created by the debug "Reset save" starts flagged.
    return p.debugUsed === true ? markDebugUsed(fresh) : fresh;
  }
  if (!state) throw new ReplayError(`${type} before NEW_GAME`);
  switch (type as LogType) {
    case 'START_ACTIVITY':
    case 'STOP_ACTIVITY':
    case 'DEBUG_GRANT_HERO_XP':
    case 'DEBUG_SPEND_STAMINA':
    case 'DEBUG_REFILL_STAMINA':
    case 'DEBUG_ADD_ATTRIBUTE': {
      const res = applyCommand(state, payload as Command, clientTime, { allowDebug: true });
      if (!res.ok) throw new ReplayError(`${type} rejected on replay: ${res.error.code}`);
      return res.state;
    }
    case 'RESUME':
    case 'SIMULATE':
      return simulate(state, clientTime).state;
    case 'CLOCK_ANOMALY':
      return state;
    case 'DEBUG_CLOCK_OFFSET':
    case 'DEBUG_RESET_SAVE':
      return markDebugUsed(state);
    default:
      throw new ReplayError(`Unknown log type ${type}`);
  }
}

export function replayLog(entries: readonly ReplayEntry[]): GameState | null {
  let state: GameState | null = null;
  for (const e of entries) state = replayStep(state, e);
  return state;
}
