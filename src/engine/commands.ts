// Player commands. Serializable, validated here (never in the UI), applied after simulating to `now`.
import { grantHeroXp } from './activities';
import { cloneState } from './clone';
import { ACTIVITIES, isActivityKind } from './config/activities';
import { DEV_TOOLS_ENABLED } from './config/dev';
import { markDebugUsed } from './flags';
import { simulate } from './simulate';
import { refillStamina, spendStamina } from './stamina';
import { type ActivityKind, ATTRIBUTE_KEYS, type AttributeKey, type GameEvent, type GameState, type SimulationSummary } from './types';

export type Command =
  | { id: string; type: 'START_ACTIVITY'; kind: ActivityKind }
  | { id: string; type: 'STOP_ACTIVITY' }
  | { id: string; type: 'DEBUG_GRANT_HERO_XP'; amount: number }
  | { id: string; type: 'DEBUG_SPEND_STAMINA'; amount: number }
  | { id: string; type: 'DEBUG_REFILL_STAMINA' }
  | { id: string; type: 'DEBUG_ADD_ATTRIBUTE'; attribute: AttributeKey; amount: number };

export type CommandType = Command['type'];

export type CommandErrorCode =
  | 'INVALID_TIME'
  | 'INVALID_COMMAND'
  | 'UNKNOWN_ACTIVITY'
  | 'NO_ACTIVE_ACTIVITY'
  | 'INVALID_AMOUNT'
  | 'UNKNOWN_ATTRIBUTE'
  | 'NOT_ENOUGH_STAMINA'
  | 'DEBUG_DISABLED';

export type CommandError = { code: CommandErrorCode; message: string };

export type CommandResult =
  | { ok: true; state: GameState; events: GameEvent[]; summary: SimulationSummary }
  | { ok: false; error: CommandError };

/** Upper bound for the debug XP grant, keeps numbers far from MAX_SAFE_INTEGER. */
export const MAX_DEBUG_XP_GRANT = 1_000_000_000_000;

/** Debug attribute grants: per command, and the highest value an attribute may reach that way. */
export const MAX_DEBUG_ATTRIBUTE_GRANT = 1000;
export const MAX_DEBUG_ATTRIBUTE_VALUE = 1_000_000;

export function isAttributeKey(key: unknown): key is AttributeKey {
  return typeof key === 'string' && (ATTRIBUTE_KEYS as readonly string[]).includes(key);
}

const fail = (code: CommandErrorCode, message: string): CommandResult => ({ ok: false, error: { code, message } });

export type ApplyOptions = {
  /**
   * Accept DEBUG_* commands. Defaults to DEV_TOOLS_ENABLED for live play. Replay always passes
   * true so a logged debug row stays replayable even in a build where the debug tools are off.
   */
  allowDebug?: boolean;
};

/**
 * Simulates up to `now` (so rewards are never lost or double-counted), then applies `cmd`.
 * Returns a typed error and leaves the input untouched when the command is invalid.
 */
export function applyCommand(state: GameState, cmd: Command, now: number, options: ApplyOptions = {}): CommandResult {
  const allowDebug = options.allowDebug ?? DEV_TOOLS_ENABLED;
  if (!cmd || typeof cmd !== 'object' || typeof cmd.id !== 'string' || cmd.id.length === 0) {
    return fail('INVALID_COMMAND', 'Command must be an object with a non-empty id');
  }
  if (typeof now !== 'number' || !Number.isFinite(now)) return fail('INVALID_TIME', `Non-finite time ${String(now)}`);

  const sim = simulate(state, now);
  // simulate() shares unchanged sub-objects with its input; commands work on a full copy.
  let draft = cloneState(sim.state);
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
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const { amount } = cmd;
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_DEBUG_XP_GRANT) {
        return fail('INVALID_AMOUNT', `Invalid XP amount ${String(amount)}`);
      }
      draft = markDebugUsed(draft);
      grantHeroXp(draft, amount, null, events);
      break;
    }
    case 'DEBUG_SPEND_STAMINA': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const spent = spendStamina(draft, cmd.amount);
      if (!spent.ok) return fail(spent.error.code, spent.error.message);
      draft = markDebugUsed(spent.state);
      break;
    }
    case 'DEBUG_REFILL_STAMINA': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      draft = markDebugUsed(refillStamina(draft));
      break;
    }
    case 'DEBUG_ADD_ATTRIBUTE': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const { attribute, amount } = cmd;
      if (!isAttributeKey(attribute)) return fail('UNKNOWN_ATTRIBUTE', `Unknown attribute ${String(attribute)}`);
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_DEBUG_ATTRIBUTE_GRANT) {
        return fail('INVALID_AMOUNT', `Invalid attribute amount ${String(amount)}`);
      }
      const next = draft.character.attributes[attribute] + amount;
      if (next > MAX_DEBUG_ATTRIBUTE_VALUE) return fail('INVALID_AMOUNT', `${attribute} would exceed ${MAX_DEBUG_ATTRIBUTE_VALUE}`);
      draft = markDebugUsed(draft);
      draft.character.attributes[attribute] = next;
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
