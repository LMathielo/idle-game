// Player commands. Serializable, validated here (never in the UI), applied after simulating to `now`.
import { grantHeroXp } from './activities';
import { cloneState } from './clone';
import { ACTIVITIES, isActivityKind } from './config/activities';
import { DEV_TOOLS_ENABLED } from './config/dev';
import { simulate } from './simulate';
import type { ActivityKind, GameEvent, GameState, SimulationSummary } from './types';

export type Command =
  | { id: string; type: 'START_ACTIVITY'; kind: ActivityKind }
  | { id: string; type: 'STOP_ACTIVITY' }
  | { id: string; type: 'DEBUG_GRANT_HERO_XP'; amount: number };

export type CommandType = Command['type'];

export type CommandErrorCode =
  | 'INVALID_TIME'
  | 'INVALID_COMMAND'
  | 'UNKNOWN_ACTIVITY'
  | 'NO_ACTIVE_ACTIVITY'
  | 'INVALID_AMOUNT'
  | 'DEBUG_DISABLED';

export type CommandError = { code: CommandErrorCode; message: string };

export type CommandResult =
  | { ok: true; state: GameState; events: GameEvent[]; summary: SimulationSummary }
  | { ok: false; error: CommandError };

/** Upper bound for the debug XP grant, keeps numbers far from MAX_SAFE_INTEGER. */
export const MAX_DEBUG_XP_GRANT = 1_000_000_000_000;

const fail = (code: CommandErrorCode, message: string): CommandResult => ({ ok: false, error: { code, message } });

/**
 * Simulates up to `now` (so rewards are never lost or double-counted), then applies `cmd`.
 * Returns a typed error and leaves the input untouched when the command is invalid.
 */
export function applyCommand(state: GameState, cmd: Command, now: number): CommandResult {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.id !== 'string' || cmd.id.length === 0) {
    return fail('INVALID_COMMAND', 'Command must be an object with a non-empty id');
  }
  if (typeof now !== 'number' || !Number.isFinite(now)) return fail('INVALID_TIME', `Non-finite time ${String(now)}`);

  const sim = simulate(state, now);
  // simulate() shares unchanged sub-objects with its input; commands work on a full copy.
  const draft = cloneState(sim.state);
  const events: GameEvent[] = [...sim.events];

  switch (cmd.type) {
    case 'START_ACTIVITY': {
      if (!isActivityKind(cmd.kind)) return fail('UNKNOWN_ACTIVITY', `Unknown activity ${String(cmd.kind)}`);
      if (draft.activity?.kind === cmd.kind) break; // already running: keep its banked progress
      if (draft.activity) events.push({ type: 'ACTIVITY_STOPPED', kind: draft.activity.kind });
      draft.activity = { kind: cmd.kind, startedAt: now, progressMs: 0 };
      events.push({ type: 'ACTIVITY_STARTED', kind: cmd.kind });
      break;
    }
    case 'STOP_ACTIVITY': {
      if (!draft.activity) return fail('NO_ACTIVE_ACTIVITY', 'No activity is running');
      events.push({ type: 'ACTIVITY_STOPPED', kind: draft.activity.kind });
      draft.activity = null;
      break;
    }
    case 'DEBUG_GRANT_HERO_XP': {
      if (!DEV_TOOLS_ENABLED) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const { amount } = cmd;
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_DEBUG_XP_GRANT) {
        return fail('INVALID_AMOUNT', `Invalid XP amount ${String(amount)}`);
      }
      grantHeroXp(draft, amount, null, events);
      break;
    }
    default: {
      const unknown = cmd as { type?: unknown };
      return fail('INVALID_COMMAND', `Unknown command type ${String(unknown.type)}`);
    }
  }

  return { ok: true, state: draft, events, summary: sim.summary };
}

/** Activity kinds, for UIs that list them. */
export const ACTIVITY_KINDS = Object.keys(ACTIVITIES) as ActivityKind[];
