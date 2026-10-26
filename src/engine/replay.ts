// Rebuilds state from an action log. This is what a server will run to validate a client:
// same seed + same entries → same state hash at every step.
//
// Replay is valid within one engine-version span. A rules change (ENGINE_VERSION bump) or a save
// migration writes a MIGRATE row: an ANCHOR that carries the full post-migration state. Replay resets to
// the anchor's snapshot (after checking its hash), so anchors stitch the spans together. A span written
// by another engine version is not re-simulated: it is reported as "verified up to anchor".
import { applyCommand, type Command } from './commands';
import { markDebugUsed } from './flags';
import { hashState } from './hash';
import { loadSave } from './migrations';
import { newGame } from './newGame';
import { simulate } from './simulate';
import type { GameState } from './types';
import { ENGINE_VERSION } from './version';

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
   * Engine version that wrote the row. replayLogReport() re-simulates only spans written by the current
   * ENGINE_VERSION (a missing value counts as current) and skips older spans up to the next anchor.
   */
  engineVersion?: string;
  /** state_hash of the row. When present, replayLogReport() checks it; MIGRATE rows always check it. */
  stateHash?: string;
};

/** Payload of a MIGRATE row (written by the client in the same transaction as the migrated state). */
export type MigratePayload = {
  fromSave: number | null;
  toSave: number;
  /** Engine version the save was last written with (null when unknown). */
  fromEngine: string | null;
  toEngine: string;
  /** The full GameState document after migration. Its hash is the row's state_hash. */
  snapshot: unknown;
};

export class ReplayError extends Error {}

/** Starts a new replay span: the state no longer depends on earlier rows. */
const isSpanStart = (type: string) => type === 'NEW_GAME' || type === 'MIGRATE';

/** Resets to a MIGRATE row's snapshot. Checks the snapshot against `stateHash` when given, then brings it to the current save version. */
function fromAnchor(entry: ReplayEntry): GameState {
  const p = entry.payload as Partial<MigratePayload> | null;
  if (!p || !p.snapshot || typeof p.snapshot !== 'object') throw new ReplayError('MIGRATE without snapshot');
  if (entry.stateHash !== undefined && hashState(p.snapshot) !== entry.stateHash) {
    throw new ReplayError(`MIGRATE snapshot hash ${hashState(p.snapshot)} does not match the row (${entry.stateHash})`);
  }
  // A copy, so later replay steps never share objects with the log entry.
  return loadSave(p.snapshot);
}

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
  if (type === 'MIGRATE') return fromAnchor(entry);
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

export type ReplayReport = {
  state: GameState | null;
  /** Rows re-simulated with the current engine (and hash-checked when they carry a stateHash). */
  replayed: number;
  /** Rows of an older (or other) engine version, not re-simulated: trusted up to the anchor after them. */
  verifiedUpToAnchor: number;
  /** MIGRATE rows the replay reset to. */
  anchors: number;
};

/**
 * Replays a whole log, span by span. A span starts at NEW_GAME or MIGRATE and runs to the next one.
 * A span whose rows were all written by the current ENGINE_VERSION is re-simulated; any other span is
 * skipped and counted as verified up to the anchor that follows it. The last span must be current
 * (the client writes a MIGRATE anchor on the first load after an engine change), otherwise this throws.
 */
export function replayLogReport(entries: readonly ReplayEntry[]): ReplayReport {
  const report: ReplayReport = { state: null, replayed: 0, verifiedUpToAnchor: 0, anchors: 0 };
  const isCurrent = (e: ReplayEntry) => e.engineVersion === undefined || e.engineVersion === ENGINE_VERSION;
  let i = 0;
  while (i < entries.length) {
    let end = i + 1;
    while (end < entries.length && !isSpanStart(entries[end].type)) end++;
    const span = entries.slice(i, end);
    if (!span.every(isCurrent)) {
      if (end === entries.length) {
        const old = span.find((e) => !isCurrent(e))!;
        throw new ReplayError(`Rows from engine ${old.engineVersion} after the last anchor: cannot replay with ${ENGINE_VERSION}`);
      }
      report.state = null;
      report.verifiedUpToAnchor += span.length;
    } else {
      for (let k = 0; k < span.length; k++) {
        const e = span[k];
        report.state = replayStep(report.state, e);
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
