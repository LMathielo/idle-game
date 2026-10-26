// Player commands. Serializable, validated here (never in the UI), applied after simulating to `now`.
import { grantHeroXp } from './activities';
import { cloneState } from './clone';
import { ACTIVITIES, isGatheringKind } from './config/activities';
import { DEV_TOOLS_ENABLED } from './config/dev';
import { DUNGEONS, isDungeonId } from './config/dungeons';
import { completeRun, isDungeonUnlocked, recordDungeonResults, runMsFor, skipCost } from './dungeon';
import { markDebugUsed } from './flags';
import { maxHpOf } from './hp';
import { simulate } from './simulate';
import { refillStamina, spendStamina } from './stamina';
import {
  type Activity,
  ATTRIBUTE_KEYS,
  type AttributeKey,
  type DungeonId,
  type GameEvent,
  type GameState,
  type GatheringKind,
  type SimulationSummary,
} from './types';

export type Command =
  | { id: string; type: 'START_ACTIVITY'; kind: GatheringKind }
  /** Starts auto-repeating runs. Only one activity at a time: a running one is stopped (a dungeon run in progress is lost). */
  | { id: string; type: 'START_ACTIVITY'; kind: 'dungeon'; dungeonId: DungeonId }
  /** Stops the activity. A dungeon run in progress is lost and gives nothing. */
  | { id: string; type: 'STOP_ACTIVITY' }
  /**
   * Spends ceil(remaining minutes) stamina to resolve the current run's fight now. Auto-repeat continues.
   * `run` is the run the player saw (DungeonRunView.run) and `maxCost` the cost the button showed: if that
   * run already finished, or the real cost is higher, the skip fails with RUN_CHANGED and nothing changes.
   */
  | { id: string; type: 'SKIP_DUNGEON_RUN'; run: number; maxCost: number }
  | { id: string; type: 'DEBUG_SET_HERO_HP'; hp: number }
  /** Adds wins (and runs) to an unlocked dungeon's lifetime counters, so unlocks can be tested on a phone. */
  | { id: string; type: 'DEBUG_ADD_DUNGEON_WINS'; dungeonId: DungeonId; amount: number }
  /** Resolves the current run's fight now, for free. */
  | { id: string; type: 'DEBUG_FINISH_DUNGEON_RUN' }
  | { id: string; type: 'DEBUG_GRANT_HERO_XP'; amount: number }
  | { id: string; type: 'DEBUG_SPEND_STAMINA'; amount: number }
  | { id: string; type: 'DEBUG_REFILL_STAMINA' }
  | { id: string; type: 'DEBUG_ADD_ATTRIBUTE'; attribute: AttributeKey; amount: number };

export type CommandType = Command['type'];

export type CommandErrorCode =
  | 'INVALID_TIME'
  | 'INVALID_COMMAND'
  | 'UNKNOWN_ACTIVITY'
  | 'UNKNOWN_DUNGEON'
  | 'DUNGEON_LOCKED'
  | 'NO_ACTIVE_ACTIVITY'
  | 'NO_DUNGEON_RUN'
  | 'RUN_CHANGED'
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

/** Debug dungeon-win grant per command. */
export const MAX_DEBUG_DUNGEON_WINS = 1000;

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
      let next: Activity;
      if (cmd.kind === 'dungeon') {
        if (!isDungeonId(cmd.dungeonId)) return fail('UNKNOWN_DUNGEON', `Unknown dungeon ${String(cmd.dungeonId)}`);
        if (!isDungeonUnlocked(draft, cmd.dungeonId)) return fail('DUNGEON_LOCKED', `${DUNGEONS[cmd.dungeonId].name} is locked`);
        // Already running this dungeon: keep the current run.
        if (draft.activity?.kind === 'dungeon' && draft.activity.dungeonId === cmd.dungeonId) break;
        next = { kind: 'dungeon', dungeonId: cmd.dungeonId, startedAt: now, progressMs: 0 };
      } else {
        if (!isGatheringKind(cmd.kind)) return fail('UNKNOWN_ACTIVITY', `Unknown activity ${String(cmd.kind)}`);
        if (draft.activity?.kind === cmd.kind) break; // already running: keep its banked progress
        next = { kind: cmd.kind, startedAt: now, progressMs: 0 };
      }
      if (draft.activity) stopActivity(draft, events);
      draft.activity = next;
      events.push({ type: 'ACTIVITY_STARTED', kind: next.kind });
      break;
    }
    case 'STOP_ACTIVITY': {
      if (!draft.activity) return fail('NO_ACTIVE_ACTIVITY', 'No activity is running');
      stopActivity(draft, events);
      break;
    }
    case 'SKIP_DUNGEON_RUN': {
      const a = draft.activity;
      if (a?.kind !== 'dungeon') return fail('NO_DUNGEON_RUN', 'No dungeon run in progress');
      const { run, maxCost } = cmd;
      if (typeof maxCost !== 'number' || !Number.isSafeInteger(maxCost) || maxCost <= 0) {
        return fail('INVALID_AMOUNT', `Invalid maxCost ${String(maxCost)}`);
      }
      if (typeof run !== 'number' || !Number.isSafeInteger(run) || run <= 0) return fail('INVALID_COMMAND', `Invalid run ${String(run)}`);
      // The run the player saw finished (simulating to now, or earlier): never resolve the next one instead.
      if (run !== draft.dungeon.totals.runs + 1) return fail('RUN_CHANGED', 'That run already finished');
      const remainingMs = Math.max(0, runMsFor(a.dungeonId, draft.character.attributes) - a.progressMs);
      const cost = skipCost(remainingMs);
      if (cost > maxCost) return fail('RUN_CHANGED', `Skipping now costs ${cost}, more than the ${maxCost} shown`);
      const spent = spendStamina(draft, cost);
      if (!spent.ok) return fail(spent.error.code, spent.error.message);
      draft = spent.state;
      finishRunNow(draft, a.dungeonId, events);
      break;
    }
    case 'DEBUG_SET_HERO_HP': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const { hp } = cmd;
      const maxHp = maxHpOf(draft);
      if (typeof hp !== 'number' || !Number.isSafeInteger(hp) || hp < 0 || hp > maxHp) {
        return fail('INVALID_AMOUNT', `HP must be a whole number from 0 to ${maxHp}`);
      }
      draft = markDebugUsed(draft);
      draft.character.hp = hp;
      draft.character.hpRegenProgress = 0;
      break;
    }
    case 'DEBUG_ADD_DUNGEON_WINS': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const { dungeonId, amount } = cmd;
      if (!isDungeonId(dungeonId)) return fail('UNKNOWN_DUNGEON', `Unknown dungeon ${String(dungeonId)}`);
      if (!isDungeonUnlocked(draft, dungeonId)) return fail('DUNGEON_LOCKED', `${DUNGEONS[dungeonId].name} is locked`);
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_DEBUG_DUNGEON_WINS) {
        return fail('INVALID_AMOUNT', `Invalid win amount ${String(amount)}`);
      }
      draft = markDebugUsed(draft);
      recordDungeonResults(draft, dungeonId, amount, 0, null, events);
      break;
    }
    case 'DEBUG_FINISH_DUNGEON_RUN': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const a = draft.activity;
      if (a?.kind !== 'dungeon') return fail('NO_DUNGEON_RUN', 'No dungeon run in progress');
      draft = markDebugUsed(draft);
      finishRunNow(draft, a.dungeonId, events);
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

/** Stops the running activity on a full draft copy. A dungeon run in progress is lost: no fight, no rewards. */
function stopActivity(draft: GameState, events: GameEvent[]) {
  const a = draft.activity;
  if (!a) return;
  if (a.kind === 'dungeon') events.push({ type: 'DUNGEON_RUN_CANCELLED', dungeonId: a.dungeonId });
  events.push({ type: 'ACTIVITY_STOPPED', kind: a.kind });
  draft.activity = null;
}

/** Resolves the current run's fight at the current HP (draft is a full copy), then starts the next run. */
function finishRunNow(draft: GameState, dungeonId: DungeonId, events: GameEvent[]) {
  completeRun(draft, dungeonId, null, events);
  if (draft.activity?.kind === 'dungeon') draft.activity.progressMs = 0;
}

/** Gathering kinds, for UIs that list them. */
export const GATHERING_KINDS = Object.keys(ACTIVITIES) as GatheringKind[];
