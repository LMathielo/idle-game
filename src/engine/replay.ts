// Rebuilds state from an action log. This is what a server will run to validate a client:
// same seed + same entries → same state hash at every step.
//
// Replay is valid within one engine-version span. A rules change (ENGINE_VERSION bump) or a save
// migration writes a MIGRATE row: an ANCHOR that carries the full post-migration state. Replay resets to
// the anchor's snapshot, so anchors stitch the spans together. An anchor is only accepted when it is
// chained to the row before it (fromHash, fromEngine) and really is a version change; see checkAnchor().
// A span written by another engine version is not re-simulated: it is counted as skippedOldEngine, and
// the anchor after it stays client-trusted until a server re-runs that span with the old engine build.
import { applyCommand, type Command } from './commands';
import { markDebugUsed } from './flags';
import { hashState } from './hash';
import { loadSave } from './migrations';
import { newGame } from './newGame';
import { simulate } from './simulate';
import type { GameState } from './types';
import { ENGINE_VERSION, RELEASED_ENGINES, releasedEngineIndex } from './version';

/** Every row type the client writes to the action log. */
export const LOG_TYPES = [
  'NEW_GAME',
  'START_ACTIVITY',
  'STOP_ACTIVITY',
  'SKIP_DUNGEON_RUN',
  'DEBUG_GRANT_HERO_XP',
  'DEBUG_SPEND_STAMINA',
  'DEBUG_REFILL_STAMINA',
  'DEBUG_ADD_ATTRIBUTE',
  'DEBUG_SET_HERO_HP',
  'DEBUG_ADD_DUNGEON_WINS',
  'DEBUG_FINISH_DUNGEON_RUN',
  'UNLOCK_TRAINING_TIER',
  'DEBUG_ADD_TRAINING_XP',
  'DEBUG_ADD_GOLD',
  'SKIP_WOODCUT',
  'SPEEDUP_TRAINING',
  'DEBUG_ADD_WOODCUTTING_LEVEL',
  'EQUIP_ITEM',
  'UNEQUIP_ITEM',
  'USE_ITEM',
  'REFRESH_MERCHANT',
  'BUY_ITEM',
  'SELL_ITEM',
  'DEBUG_ADD_MERCHANT_CHARGE',
  'SKIP_MINE',
  'BUILD',
  'DEBUG_BUILD',
  'DEBUG_ADD_MINING_LEVEL',
  'UPGRADE_BUILDING',
  'DEBUG_FINISH_CONSTRUCTION',
  'HIRE_WORKER',
  'DISMISS_WORKER',
  'ASSIGN_WORKER',
  'UNASSIGN_WORKER',
  'START_CRAFT',
  'INSTA_CRAFT',
  'CANCEL_CRAFT',
  'COLLECT_CRAFT',
  'DEBUG_UNLOCK_PIPE',
  'MIGRATE',
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
  /**
   * Engine version that wrote the row. replayLogReport() requires it on every row, re-simulates only
   * spans written by the current ENGINE_VERSION and skips older spans up to the next anchor.
   * replayStep() alone ignores it, except on MIGRATE rows.
   */
  engineVersion?: string;
  /** state_hash of the row. replayLogReport() checks it when present; MIGRATE rows (and the row before them) must have it. */
  stateHash?: string;
};

/** Payload of a MIGRATE row (written by the client in the same transaction as the migrated state). */
export type MigratePayload = {
  fromSave: number | null;
  toSave: number;
  /** Engine version the save was last written with (null when unknown). Must equal the previous row's engineVersion. */
  fromEngine: string | null;
  toEngine: string;
  /** Hash of the stored document BEFORE migration. Must equal the previous row's state_hash. */
  fromHash: string;
  /** The full GameState document after migration. Its hash is the row's state_hash. */
  snapshot: unknown;
};

export class ReplayError extends Error {}

/** Starts a new replay span: the state no longer depends on earlier rows. */
const isSpanStart = (type: string) => type === 'NEW_GAME' || type === 'MIGRATE';

/**
 * Validates a MIGRATE row and returns the state to continue from (a copy of its snapshot, brought to the
 * current save version). An anchor that fails any check is rejected, so a log can't reset to an arbitrary
 * state:
 *  - the row has its engineVersion (= toEngine) and a stateHash that matches the snapshot;
 *  - it is chained to the row before it: fromHash = that row's stateHash, fromEngine = its engineVersion;
 *  - it is an engine change: fromEngine ≠ toEngine (every save bump ships with an engine bump), and
 *    fromSave / toSave (= snapshot.saveVersion) are the save versions RELEASED_ENGINES lists for them;
 *  - when the span before it was re-simulated (`replayed` non-null), migrating that state gives the snapshot.
 * When the span before it was NOT re-simulated (another engine), the snapshot is trusted as far as the chain
 * goes: a server must re-run that span with the old engine build to verify it.
 */
export function checkAnchor(entry: ReplayEntry, prev: ReplayEntry | null | undefined, replayed: GameState | null): GameState {
  const p = entry.payload as Partial<MigratePayload> | null;
  const bad = (why: string) => new ReplayError(`MIGRATE rejected: ${why}`);
  if (!p || !p.snapshot || typeof p.snapshot !== 'object') throw bad('no snapshot');
  const snapshotHash = hashState(p.snapshot);
  if (typeof entry.engineVersion !== 'string') throw bad('row has no engineVersion');
  if (p.toEngine !== entry.engineVersion) throw bad(`toEngine ${String(p.toEngine)} is not the row's engine ${entry.engineVersion}`);
  if (typeof entry.stateHash !== 'string') throw bad('row has no stateHash');
  if (snapshotHash !== entry.stateHash) throw bad(`snapshot hash ${snapshotHash} does not match the row (${entry.stateHash})`);
  if (!prev) throw bad('no row before it');
  if (typeof prev.engineVersion !== 'string' || typeof prev.stateHash !== 'string') throw bad('the row before it has no engineVersion/stateHash');
  if (p.fromHash !== prev.stateHash) throw bad(`fromHash ${String(p.fromHash)} is not the previous row's hash ${prev.stateHash}`);
  if (p.fromEngine !== prev.engineVersion) throw bad(`fromEngine ${String(p.fromEngine)} is not the previous row's engine ${prev.engineVersion}`);
  const snapshotSave = (p.snapshot as { saveVersion?: unknown }).saveVersion;
  if (p.toSave !== snapshotSave) throw bad(`toSave ${String(p.toSave)} is not the snapshot's saveVersion`);
  if (p.fromEngine === p.toEngine) throw bad('same engine on both sides: not a migration');
  const fromIdx = releasedEngineIndex(p.fromEngine);
  const toIdx = releasedEngineIndex(p.toEngine);
  if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) throw bad(`engine ${String(p.fromEngine)} → ${String(p.toEngine)} is not a released upgrade`);
  if (p.fromSave !== RELEASED_ENGINES[fromIdx].save) throw bad(`fromSave ${String(p.fromSave)} is not what engine ${p.fromEngine} wrote`);
  if (p.toSave !== RELEASED_ENGINES[toIdx].save) throw bad(`toSave ${String(p.toSave)} is not what engine ${p.toEngine} writes`);
  if (replayed && hashState(loadSave(replayed)) !== snapshotHash) throw bad('snapshot differs from the migrated replayed state');
  // A copy, so later replay steps never share objects with the log entry.
  return loadSave(p.snapshot);
}

/**
 * Applies one log entry. CLOCK_ANOMALY rows leave the state unchanged; DEBUG_CLOCK_OFFSET and
 * DEBUG_RESET_SAVE only set flags.debugUsed. DEBUG_* commands are accepted whatever the build flag says.
 * A MIGRATE row needs `prev` (the row before it) and is validated by checkAnchor(); `state` is then the
 * re-simulated state before it, or null when that span was not re-simulated.
 */
export function replayStep(state: GameState | null, entry: ReplayEntry, prev?: ReplayEntry | null): GameState {
  const { type, payload, clientTime } = entry;
  if (type === 'NEW_GAME') {
    const p = payload as { seed?: unknown; debugUsed?: unknown } | null;
    if (typeof p?.seed !== 'number') throw new ReplayError('NEW_GAME without seed');
    const fresh = newGame(p.seed, clientTime);
    // A save created by the debug "Reset save" starts flagged.
    return p.debugUsed === true ? markDebugUsed(fresh) : fresh;
  }
  if (type === 'MIGRATE') return checkAnchor(entry, prev, state);
  if (!state) throw new ReplayError(`${type} before NEW_GAME`);
  switch (type as LogType) {
    case 'START_ACTIVITY':
    case 'STOP_ACTIVITY':
    case 'SKIP_DUNGEON_RUN':
    case 'DEBUG_SET_HERO_HP':
    case 'DEBUG_ADD_DUNGEON_WINS':
    case 'DEBUG_FINISH_DUNGEON_RUN':
    case 'DEBUG_GRANT_HERO_XP':
    case 'DEBUG_SPEND_STAMINA':
    case 'DEBUG_REFILL_STAMINA':
    case 'DEBUG_ADD_ATTRIBUTE':
    case 'UNLOCK_TRAINING_TIER':
    case 'DEBUG_ADD_TRAINING_XP':
    case 'DEBUG_ADD_GOLD':
    case 'SKIP_WOODCUT':
    case 'SPEEDUP_TRAINING':
    case 'DEBUG_ADD_WOODCUTTING_LEVEL':
    case 'EQUIP_ITEM':
    case 'UNEQUIP_ITEM':
    case 'USE_ITEM':
    case 'REFRESH_MERCHANT':
    case 'BUY_ITEM':
    case 'SELL_ITEM':
    case 'DEBUG_ADD_MERCHANT_CHARGE':
    case 'SKIP_MINE':
    case 'BUILD':
    case 'DEBUG_BUILD':
    case 'DEBUG_ADD_MINING_LEVEL':
    case 'UPGRADE_BUILDING':
    case 'DEBUG_FINISH_CONSTRUCTION':
    case 'HIRE_WORKER':
    case 'DISMISS_WORKER':
    case 'ASSIGN_WORKER':
    case 'UNASSIGN_WORKER':
    case 'START_CRAFT':
    case 'INSTA_CRAFT':
    case 'CANCEL_CRAFT':
    case 'COLLECT_CRAFT':
    case 'DEBUG_UNLOCK_PIPE': {
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

export type ReplayReport = {
  state: GameState | null;
  /** Rows re-simulated with the current engine (and hash-checked when they carry a stateHash). */
  replayed: number;
  /** Rows of another engine version, not re-simulated. The anchor after them is chain-checked, not re-run. */
  skippedOldEngine: number;
  /** MIGRATE rows the replay reset to. */
  anchors: number;
};

/**
 * Replays a whole log, span by span. A span starts at NEW_GAME or MIGRATE and runs to the next one.
 * Every row must carry an engineVersion from RELEASED_ENGINES (not newer than ENGINE_VERSION), and the
 * versions never decrease along the log. A span whose rows were all written by the current
 * ENGINE_VERSION is re-simulated (and hash-checked); any other span is skipped (skippedOldEngine). Each
 * MIGRATE is validated against the row before it (checkAnchor). The last span must be current (the
 * client writes a MIGRATE anchor on the first load after an engine change), otherwise this throws.
 */
export function replayLogReport(entries: readonly ReplayEntry[]): ReplayReport {
  const report: ReplayReport = { state: null, replayed: 0, skippedOldEngine: 0, anchors: 0 };
  // engineVersion is written by the client, so it is checked before it decides what gets re-simulated:
  // only versions that shipped (up to this engine), and never going back in time along the log.
  // Otherwise relabelling one current row as '9.9.9' would turn its span into a "skipped" one.
  const current = releasedEngineIndex(ENGINE_VERSION);
  let highest = -1;
  entries.forEach((e, k) => {
    if (typeof e.engineVersion !== 'string' || e.engineVersion.length === 0) throw new ReplayError(`Row ${k} (${e.type}) has no engineVersion`);
    const idx = releasedEngineIndex(e.engineVersion);
    if (idx < 0) throw new ReplayError(`Row ${k} (${e.type}) has engine ${e.engineVersion}, which never shipped`);
    if (idx > current) throw new ReplayError(`Row ${k} (${e.type}) has engine ${e.engineVersion}, newer than ${ENGINE_VERSION}`);
    if (idx < highest) throw new ReplayError(`Row ${k} (${e.type}) has engine ${e.engineVersion}, older than an earlier row`);
    highest = idx;
  });
  const isCurrent = (e: ReplayEntry) => e.engineVersion === ENGINE_VERSION;
  let i = 0;
  while (i < entries.length) {
    let end = i + 1;
    while (end < entries.length && !isSpanStart(entries[end].type)) end++;
    const span = entries.slice(i, end);
    if (!span.every(isCurrent)) {
      // A genuine log anchors on entry to the current engine, so a skipped span never holds current rows.
      // (Old spans need not be uniform: real pre-1.4.0 logs mix 1.2.0 and 1.3.0 rows without anchors.)
      const cur = span.findIndex(isCurrent);
      if (cur >= 0) throw new ReplayError(`Row ${i + cur} (${span[cur].type}) is ${ENGINE_VERSION} inside an older-engine span: no anchor before it`);
      if (end === entries.length) {
        const old = span.find((e) => !isCurrent(e))!;
        throw new ReplayError(`Rows from engine ${old.engineVersion} after the last anchor: cannot replay with ${ENGINE_VERSION}`);
      }
      report.state = null;
      report.skippedOldEngine += span.length;
    } else {
      for (let k = 0; k < span.length; k++) {
        const e = span[k];
        report.state = replayStep(report.state, e, i + k > 0 ? entries[i + k - 1] : null);
        if (e.type === 'MIGRATE') report.anchors += 1;
        report.replayed += 1;
        if (e.stateHash !== undefined && hashState(report.state) !== e.stateHash) {
          throw new ReplayError(`Hash mismatch at row ${i + k} (${e.type}): ${hashState(report.state)} ≠ ${e.stateHash}`);
        }
      }
    }
    i = end;
  }
  return report;
}

/** Replays a log and returns the final state (see replayLogReport). */
export function replayLog(entries: readonly ReplayEntry[]): GameState | null {
  return replayLogReport(entries).state;
}
