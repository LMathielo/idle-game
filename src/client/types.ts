// Contracts between the UI, the client and storage. No React, no Expo.
import type { AttributeKey, Command, CommandError, DungeonId, GameState, LogType, SimulationSummary } from '../engine';

/** Wall clock. The app uses SystemClock; tests use a fake. */
export interface Clock {
  now(): number;
}

/** A row in the append-only action log (also the future sync outbox). */
export type LogRow = {
  seq: number;
  commandId: string;
  type: LogType;
  payload: unknown;
  clientTime: number;
  engineVersion: string;
  stateHash: string;
  synced: boolean;
};

export type NewLogRow = Omit<LogRow, 'seq' | 'synced'>;

/** Storage for the state document, the action log and meta values. */
export interface GameRepository {
  init(): Promise<void>;
  /** Raw stored GameState document (not migrated) or null for a fresh install. */
  loadState(): Promise<unknown | null>;
  hasCommand(commandId: string): Promise<boolean>;
  /** Appends `rows` and upserts `state` (and optional meta values) in ONE transaction. */
  commit(rows: NewLogRow[], state: GameState, meta?: Record<string, string>): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(values: Record<string, string>): Promise<void>;
  getUnsyncedLog(limit: number): Promise<LogRow[]>;
  getRecentLog(limit: number): Promise<LogRow[]>;
  getAllLog(): Promise<LogRow[]>;
  countLog(): Promise<{ total: number; unsynced: number }>;
  markSynced(seqs: number[]): Promise<void>;
}

/** Future server sync. `pushLog` returns the seqs the server acknowledged. */
export interface SyncTransport {
  pushLog(rows: LogRow[]): Promise<number[]>;
}

/** M1: nothing is sent anywhere. */
export class NoopSyncTransport implements SyncTransport {
  async pushLog(): Promise<number[]> {
    return [];
  }
}

export type GameSnapshot = {
  state: GameState;
  /** True while the device clock is behind the highest time seen (progress paused). */
  clockPaused: boolean;
  /** Pending "While you were away" summary, cleared by dismissAwaySummary(). */
  awaySummary: SimulationSummary | null;
  /** Dungeons unlocked since the banner was last dismissed (dismissUnlocks()), in unlock order. */
  unlockedDungeons: readonly DungeonId[];
  /** Debug clock offset in ms (0 in normal play). */
  clockOffsetMs: number;
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A command without an id gets a fresh uuid from the client. */
export type CommandInput = DistributiveOmit<Command, 'id'> & { id?: string };

export type DispatchResult =
  | { ok: true; duplicate: boolean; state: GameState }
  | { ok: false; error: CommandError };

export interface GameClient {
  /** Opens storage, loads or creates the save (logs NEW_GAME), then resumes. */
  load(): Promise<GameSnapshot>;
  getState(): GameState;
  getSnapshot(): GameSnapshot;
  subscribe(listener: () => void): () => void;
  dispatch(cmd: CommandInput): Promise<DispatchResult>;
  /** Simulates the time since the last update and persists it (app start / foreground). */
  resume(): Promise<SimulationSummary>;
  /** Live 1s tick: same simulate() path, persisted at checkpoints. */
  tick(): Promise<void>;
  /** Persists unsaved progress (app going to background). */
  persist(): Promise<void>;
  dismissAwaySummary(): void;
  /** Clears the "dungeon unlocked" banner. */
  dismissUnlocks(): void;
  getUnsyncedLog(limit?: number): Promise<LogRow[]>;
  getRecentLog(limit: number): Promise<LogRow[]>;
  countLog(): Promise<{ total: number; unsynced: number }>;
  syncOnce(transport: SyncTransport): Promise<number>;
  debug: {
    /** Moves the debug clock by `deltaMs` (negative = backwards), then resumes. */
    shiftClock(deltaMs: number): Promise<SimulationSummary>;
    grantHeroXp(amount: number): Promise<DispatchResult>;
    spendStamina(amount: number): Promise<DispatchResult>;
    refillStamina(): Promise<DispatchResult>;
    addAttribute(attribute: AttributeKey, amount?: number): Promise<DispatchResult>;
    /** Sets current HP (0..max). Logged as DEBUG_SET_HERO_HP. */
    setHeroHp(hp: number): Promise<DispatchResult>;
    /** Resolves the current dungeon run's fight now, for free. Logged as DEBUG_FINISH_DUNGEON_RUN. */
    finishDungeonRun(): Promise<DispatchResult>;
    /** Adds wins to an unlocked dungeon's counters (default 10). Logged as DEBUG_ADD_DUNGEON_WINS. */
    addDungeonWins(dungeonId: DungeonId, amount?: number): Promise<DispatchResult>;
    /** Adds training XP (default 60 = 60 trained minutes) to the attribute being trained. Logged as DEBUG_ADD_TRAINING_XP. */
    addTrainingXp(xp?: number): Promise<DispatchResult>;
    /** Adds gold (default 1,000). Logged as DEBUG_ADD_GOLD. */
    addGold(amount?: number): Promise<DispatchResult>;
    /** Adds woodcutting levels (default 1), to test tree unlocks. Logged as DEBUG_ADD_WOODCUTTING_LEVEL. */
    addWoodcuttingLevel(levels?: number): Promise<DispatchResult>;
    /** +1 merchant refresh charge (never above max). Logged as DEBUG_ADD_MERCHANT_CHARGE. */
    addMerchantCharge(): Promise<DispatchResult>;
    /** New game with a new seed and a real clock (offset 0). Logged, never deletes the log. */
    resetSave(): Promise<void>;
  };
}
