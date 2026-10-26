// LocalGameClient = engine + repository + clock. No React, no Expo imports (those are injected).
//
// Persistence rules (docs/ENGINE.md, "Action log"):
// - Every stored state change is ONE repository transaction: log row(s) + state document.
// - Live 1s ticks run simulate() in memory (same code as offline) and are checkpointed every
//   CHECKPOINT_INTERVAL_MS as a SIMULATE row, plus on background. A killed app loses nothing:
//   the next resume re-simulates from the stored state, and the engine is deterministic.
// - Before any other row is logged, unsaved ticks are flushed as a SIMULATE checkpoint, so
//   replaying the log from NEW_GAME reproduces every row's state_hash exactly.
import {
  applyCommand,
  type AttributeKey,
  type Command,
  ENGINE_VERSION,
  type GameState,
  hashState,
  isNoteworthy,
  loadSave,
  type LogType,
  markDebugUsed,
  mergeSummaries,
  newGame,
  simulate,
  type SimulationSummary,
} from '../engine';
import type {
  Clock,
  CommandInput,
  DispatchResult,
  GameClient,
  GameRepository,
  GameSnapshot,
  LogRow,
  NewLogRow,
  SyncTransport,
} from './types';

/** Unsaved live progress is written at least this often while an activity runs. */
export const CHECKPOINT_INTERVAL_MS = 30_000;
/**
 * With no activity only time moves, so the 30s checkpoint is skipped. This much slower one keeps
 * highestSeenAt/lastSimulatedAt reasonably fresh if an idle app stays open for hours and is then killed.
 */
export const IDLE_CHECKPOINT_INTERVAL_MS = 10 * 60_000;
/** A tick that sees more time than this since the last one was suspended: treat it as a resume. */
export const TICK_RESUME_GAP_MS = 60_000;
export const META_CLOCK_OFFSET = 'debug_clock_offset_ms';

/** Randomness the client needs outside the engine (ids, new-game seeds). */
export interface IdSource {
  uuid(): string;
  /** uint32 seed for a new game. */
  seed(): number;
}

export type DebugClock = Clock & { offsetMs: number };

type Advance = { rows: NewLogRow[]; summary: SimulationSummary; newAnomaly: boolean };

export class LocalGameClient implements GameClient {
  private state: GameState | null = null;
  /** Last state written to the repository. `state !== committed` means unsaved ticks. */
  private committed: GameState | null = null;
  private paused = false;
  private awaySummary: SimulationSummary | null = null;
  private snapshot: GameSnapshot | null = null;
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private tickQueued = false;
  private loadPromise: Promise<GameSnapshot> | null = null;

  constructor(
    private readonly repo: GameRepository,
    private readonly clock: DebugClock,
    private readonly ids: IdSource,
  ) {}

  // ---------- public API ----------

  load(): Promise<GameSnapshot> {
    if (!this.loadPromise) {
      const p = this.serial(() => this.loadInternal());
      this.loadPromise = p;
      p.catch(() => {
        if (this.loadPromise === p) this.loadPromise = null; // allow a retry after a failed load
      });
    }
    return this.loadPromise;
  }

  isLoaded(): boolean {
    return this.snapshot !== null;
  }

  getState(): GameState {
    if (!this.state) throw new Error('GameClient not loaded');
    return this.state;
  }

  getSnapshot = (): GameSnapshot => {
    if (!this.snapshot) throw new Error('GameClient not loaded');
    return this.snapshot;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  dispatch(input: CommandInput): Promise<DispatchResult> {
    return this.serial(async () => {
      const cmd = { ...input, id: input.id ?? this.ids.uuid() } as Command;
      if (await this.repo.hasCommand(cmd.id)) return { ok: true, duplicate: true, state: this.getState() };

      const now = this.clock.now();
      const pre = this.pendingCheckpoint();
      const adv = this.advance(now, 'SIMULATE');
      const res = applyCommand(this.getState(), cmd, now);
      if (!res.ok) {
        if (adv.rows.length > 0) await this.commit([...pre, ...adv.rows]);
        this.noteAway(adv, false);
        this.publish();
        return { ok: false, error: res.error };
      }
      this.state = res.state;
      await this.commit([...pre, ...adv.rows, this.row(cmd.type, cmd, now, res.state, cmd.id)]);
      this.noteAway(adv, false);
      this.publish();
      return { ok: true, duplicate: false, state: res.state };
    });
  }

  resume(): Promise<SimulationSummary> {
    return this.serial(() => this.resumeInternal());
  }

  tick(): Promise<void> {
    if (this.tickQueued || !this.state) return Promise.resolve();
    this.tickQueued = true;
    return this.serial(async () => {
      this.tickQueued = false;
      const now = this.clock.now();
      if (now - this.getState().time.lastSimulatedAt > TICK_RESUME_GAP_MS) {
        // JS was suspended without a background event: account for it as a real resume.
        await this.resumeInternal();
        return;
      }
      const pre = this.pendingCheckpoint();
      const adv = this.advance(now, 'SIMULATE');
      if (adv.rows.length > 0) {
        await this.commit([...pre, ...adv.rows]);
      } else if (this.isDirty() && this.unsavedMs() >= this.checkpointIntervalMs()) {
        await this.commit([this.checkpointRow()]);
      }
      this.noteAway(adv, false);
      this.publish();
    });
  }

  persist(): Promise<void> {
    return this.serial(() => this.flushDirty());
  }

  dismissAwaySummary(): void {
    if (!this.awaySummary) return;
    this.awaySummary = null;
    this.publish();
  }

  getUnsyncedLog(limit = 100): Promise<LogRow[]> {
    return this.repo.getUnsyncedLog(limit);
  }

  getRecentLog(limit: number): Promise<LogRow[]> {
    return this.repo.getRecentLog(limit);
  }

  countLog(): Promise<{ total: number; unsynced: number }> {
    return this.repo.countLog();
  }

  /** Pushes one batch of unsynced rows. Returns how many were acknowledged. */
  syncOnce(transport: SyncTransport): Promise<number> {
    return this.serial(async () => {
      const rows = await this.repo.getUnsyncedLog(100);
      if (rows.length === 0) return 0;
      const sent = new Set(rows.map((r) => r.seq));
      const acked = (await transport.pushLog(rows)).filter((s) => sent.has(s));
      await this.repo.markSynced(acked);
      return acked.length;
    });
  }

  debug = {
    shiftClock: (deltaMs: number): Promise<SimulationSummary> =>
      this.serial(async () => {
        if (!Number.isFinite(deltaMs)) throw new RangeError('shiftClock: invalid delta');
        await this.flushDirty();
        const previousOffset = this.clock.offsetMs;
        this.clock.offsetMs = previousOffset + deltaMs;
        const offsetMs = this.clock.offsetMs;
        const now = this.clock.now();
        try {
          this.state = markDebugUsed(this.getState());
          const offsetRow = this.row('DEBUG_CLOCK_OFFSET', { deltaMs, offsetMs }, now, this.state);
          const adv = this.advance(now, 'RESUME');
          await this.commit([offsetRow, ...adv.rows], { [META_CLOCK_OFFSET]: String(offsetMs) });
          this.noteAway(adv, true);
          this.publish();
          return adv.summary;
        } catch (err) {
          this.clock.offsetMs = previousOffset;
          this.publish();
          throw err;
        }
      }),

    grantHeroXp: (amount: number): Promise<DispatchResult> => this.dispatch({ type: 'DEBUG_GRANT_HERO_XP', amount }),

    spendStamina: (amount: number): Promise<DispatchResult> => this.dispatch({ type: 'DEBUG_SPEND_STAMINA', amount }),

    refillStamina: (): Promise<DispatchResult> => this.dispatch({ type: 'DEBUG_REFILL_STAMINA' }),

    addAttribute: (attribute: AttributeKey, amount = 1): Promise<DispatchResult> =>
      this.dispatch({ type: 'DEBUG_ADD_ATTRIBUTE', attribute, amount }),

    setHeroHp: (hp: number): Promise<DispatchResult> => this.dispatch({ type: 'DEBUG_SET_HERO_HP', hp }),

    finishDungeonRun: (): Promise<DispatchResult> => this.dispatch({ type: 'DEBUG_FINISH_DUNGEON_RUN' }),

    resetSave: (): Promise<void> =>
      this.serial(async () => {
        const rows: NewLogRow[] = [];
        if (this.state) {
          await this.flushDirty();
          rows.push(this.row('DEBUG_RESET_SAVE', {}, this.clock.now(), markDebugUsed(this.state)));
        }
        const previousOffset = this.clock.offsetMs;
        this.clock.offsetMs = 0;
        const now = this.clock.now();
        const seed = this.ids.seed() >>> 0;
        const fresh = markDebugUsed(newGame(seed, now));
        rows.push(this.row('NEW_GAME', { seed, reason: 'debug_reset', debugUsed: true }, now, fresh));
        const prevState = this.state;
        this.state = fresh;
        try {
          await this.commit(rows, { [META_CLOCK_OFFSET]: '0' });
        } catch (err) {
          this.state = prevState;
          this.clock.offsetMs = previousOffset;
          throw err;
        }
        this.paused = false;
        this.awaySummary = null;
        this.publish();
      }),
  };

  // ---------- internals ----------

  private async loadInternal(): Promise<GameSnapshot> {
    await this.repo.init();
    const storedOffset = await this.repo.getMeta(META_CLOCK_OFFSET);
    const offset = storedOffset === null ? 0 : Number(storedOffset);
    this.clock.offsetMs = Number.isFinite(offset) ? offset : 0;

    const meta: Record<string, string> = {};
    if ((await this.repo.getMeta('engine_version')) !== ENGINE_VERSION) meta.engine_version = ENGINE_VERSION;
    if (!(await this.repo.getMeta('device_id'))) meta.device_id = this.ids.uuid();
    if (Object.keys(meta).length > 0) await this.repo.setMeta(meta);

    const raw = await this.repo.loadState();
    if (raw) {
      const state = loadSave(raw);
      this.state = state;
      this.committed = state;
    } else {
      const now = this.clock.now();
      const seed = this.ids.seed() >>> 0;
      const fresh = newGame(seed, now);
      this.state = fresh;
      await this.commit([this.row('NEW_GAME', { seed }, now, fresh)]);
    }
    await this.resumeInternal();
    return this.getSnapshot();
  }

  private async resumeInternal(): Promise<SimulationSummary> {
    const pre = this.pendingCheckpoint();
    const adv = this.advance(this.clock.now(), 'RESUME');
    await this.commit([...pre, ...adv.rows]);
    this.noteAway(adv, true);
    this.publish();
    return adv.summary;
  }

  /**
   * Simulates to `now` in memory and returns the rows to log (without any checkpoint).
   * RESUME is always logged. A SIMULATE tick is logged only when it hits a new clock anomaly
   * (a backward anomaly is logged once per pause, not once per second).
   */
  private advance(now: number, source: 'RESUME' | 'SIMULATE'): Advance {
    const res = simulate(this.getState(), now);
    const rows: NewLogRow[] = [];
    const backward = res.summary.anomalies.some((a) => a.kind === 'backward');
    const capped = res.summary.anomalies.some((a) => a.kind === 'forward_capped');
    const newAnomaly = capped || (backward && !this.paused);
    const accepted = Number.isFinite(now); // non-finite time is a no-op in the engine and never logged

    const hasAnomaly = res.summary.anomalies.length > 0;
    // A RESUME that moved no time and saw no anomaly changes nothing: not worth a row.
    const resumeWorthLogging = source === 'RESUME' && (res.summary.requestedMs > 0 || hasAnomaly);
    if (accepted && (resumeWorthLogging || newAnomaly)) {
      rows.push(this.row(source, { summary: res.summary }, now, res.state));
      for (const a of res.summary.anomalies) rows.push(this.row('CLOCK_ANOMALY', a, now, res.state));
    }
    for (const e of res.events) if (e.type === 'ERROR') console.warn(`[engine] ${e.message}`);

    // Paused exactly while the engine keeps reporting a backward clock.
    if (accepted) this.paused = backward;
    this.state = res.state;
    return { rows, summary: res.summary, newAnomaly };
  }

  private noteAway(adv: Advance, fromResume: boolean) {
    const show = (fromResume && isNoteworthy(adv.summary)) || adv.newAnomaly;
    if (!show) return;
    this.awaySummary = this.awaySummary ? mergeSummaries(this.awaySummary, adv.summary) : adv.summary;
  }

  private isDirty(): boolean {
    return this.state !== null && this.state !== this.committed;
  }

  private checkpointIntervalMs(): number {
    return this.getState().activity ? CHECKPOINT_INTERVAL_MS : IDLE_CHECKPOINT_INTERVAL_MS;
  }

  private unsavedMs(): number {
    if (!this.state || !this.committed) return 0;
    return this.state.time.lastSimulatedAt - this.committed.time.lastSimulatedAt;
  }

  /** A checkpoint row for unsaved ticks, to be written before any other row. */
  private pendingCheckpoint(): NewLogRow[] {
    return this.isDirty() ? [this.checkpointRow()] : [];
  }

  private async flushDirty() {
    if (this.isDirty()) await this.commit([this.checkpointRow()]);
  }

  /** Replaying this row (simulate to lastSimulatedAt) turns the stored state into the in-memory one. */
  private checkpointRow(): NewLogRow {
    const s = this.getState();
    return this.row('SIMULATE', { checkpoint: true }, s.time.lastSimulatedAt, s);
  }

  private row(type: LogType, payload: unknown, clientTime: number, stateAfter: GameState, commandId?: string): NewLogRow {
    return {
      commandId: commandId ?? this.ids.uuid(),
      type,
      payload,
      clientTime,
      engineVersion: ENGINE_VERSION,
      stateHash: hashState(stateAfter),
    };
  }

  /** Writes rows + the current state in one transaction. On failure, memory rolls back to the stored state. */
  private async commit(rows: NewLogRow[], meta?: Record<string, string>) {
    if (rows.length === 0) return;
    const state = this.getState();
    try {
      await this.repo.commit(rows, state, meta);
      this.committed = state;
    } catch (err) {
      if (this.committed) this.state = this.committed;
      this.publish();
      throw err;
    }
  }

  private publish() {
    if (!this.state) return;
    const prev = this.snapshot;
    if (
      prev &&
      prev.state === this.state &&
      prev.clockPaused === this.paused &&
      prev.awaySummary === this.awaySummary &&
      prev.clockOffsetMs === this.clock.offsetMs
    ) {
      return;
    }
    this.snapshot = {
      state: this.state,
      clockPaused: this.paused,
      awaySummary: this.awaySummary,
      clockOffsetMs: this.clock.offsetMs,
    };
    for (const l of this.listeners) l();
  }

  /** Runs operations one at a time so ticks, commands and resumes never interleave. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
