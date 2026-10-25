import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { CHECKPOINT_INTERVAL_MS, LocalGameClient } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import { NoopSyncTransport } from '../src/client/types';
import { hashState, replayStep, simulate, type GameState } from '../src/engine';
import { HOUR, MIN, SEC, T0, idSource, makeClient, qty } from './helpers';

/** Replays the stored log and checks every row's state_hash. Returns the final state. */
async function verifyLog(repo: MemoryGameRepository): Promise<GameState> {
  const rows = await repo.getAllLog();
  let state: GameState | null = null;
  for (const row of rows) {
    state = replayStep(state, { type: row.type, payload: row.payload, clientTime: row.clientTime });
    expect({ seq: row.seq, type: row.type, hash: hashState(state) }).toEqual({ seq: row.seq, type: row.type, hash: row.stateHash });
  }
  return state!;
}

async function tickFor(client: LocalGameClient, clock: FakeClock, seconds: number) {
  for (let i = 0; i < seconds; i++) {
    clock.advance(SEC);
    await client.tick();
  }
}

describe('LocalGameClient', () => {
  it('first load creates a new game, logs NEW_GAME + RESUME and stores meta', async () => {
    const { repo, client } = makeClient();
    const snap = await client.load();
    expect(snap.state.character.level).toBe(1);
    expect(snap.state.character.name).toBe('Lucius');
    const rows = await repo.getAllLog();
    expect(rows.map((r) => r.type)).toEqual(['NEW_GAME', 'RESUME']);
    expect(await repo.getMeta('device_id')).toBeTruthy();
    expect(await repo.getMeta('engine_version')).toBe('1.0.0');
    expect(await repo.getMeta('schema_version')).toBe('1');
    expect(JSON.parse(repo.stateDoc!)).toEqual(snap.state);
  });

  it('kill during woodcutting and reopen: correct rewards, summary, no double grant', async () => {
    const repo = new MemoryGameRepository();
    const clock = new FakeClock(T0);
    const a = new LocalGameClient(repo, clock, idSource('a'));
    await a.load();
    await a.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting' });
    const started = a.getState();
    await tickFor(a, clock, 10); // live ticks, not yet checkpointed
    // App is killed here: no persist(). Reopen 2h later.
    clock.advance(2 * HOUR);
    const b = new LocalGameClient(repo, clock, idSource('b'));
    const snap = await b.load();
    // Exactly what the engine grants for the whole span (level-ups included), no more, no less.
    const expected = simulate(started, T0 + 2 * HOUR + 10 * SEC).state;
    const expectedActions = expected.stats.totalActions;
    expect(expectedActions).toBeGreaterThan(2000);
    expect(hashState(snap.state)).toBe(hashState(expected));
    expect(snap.state.stats.totalActions).toBe(expectedActions);
    expect(snap.awaySummary?.actions).toBe(expectedActions);
    expect(snap.awaySummary?.grantedMs).toBe(2 * HOUR + 10 * SEC);

    // Reopening again right away grants nothing more.
    const c = new LocalGameClient(repo, clock, idSource('c'));
    const again = await c.load();
    expect(again.state.stats.totalActions).toBe(expectedActions);
    expect(again.awaySummary).toBeNull();
    await verifyLog(repo);
  });

  it('dispatching a command id that is already logged does not re-apply it', async () => {
    const { repo, client, clock } = makeClient();
    await client.load();
    const first = await client.dispatch({ id: 'xp-1', type: 'DEBUG_GRANT_HERO_XP', amount: 10_000 });
    expect(first).toMatchObject({ ok: true, duplicate: false });
    clock.advance(SEC);
    const second = await client.dispatch({ id: 'xp-1', type: 'DEBUG_GRANT_HERO_XP', amount: 10_000 });
    expect(second).toMatchObject({ ok: true, duplicate: true });
    expect(client.getState().character.level).toBe(3);
    expect((await repo.getAllLog()).filter((r) => r.commandId === 'xp-1')).toHaveLength(1);
  });

  it('command_id is unique in the store: a commit with a duplicate id writes nothing', async () => {
    const { repo, client } = makeClient();
    await client.load();
    const before = { log: repo.log.length, doc: repo.stateDoc };
    const row = { commandId: repo.log[0].commandId, type: 'SIMULATE' as const, payload: {}, clientTime: T0, engineVersion: '1', stateHash: 'x' };
    await expect(repo.commit([row], client.getState())).rejects.toThrow(/UNIQUE/);
    expect(repo.log.length).toBe(before.log);
    expect(repo.stateDoc).toBe(before.doc);
  });

  it('a failed commit rolls memory back to the stored state', async () => {
    const { repo, client } = makeClient();
    await client.load();
    repo.failNextCommit = new Error('disk full');
    await expect(client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting' })).rejects.toThrow('disk full');
    expect(client.getState().activity).toBeNull();
    expect(JSON.parse(repo.stateDoc!).activity).toBeNull();
  });

  it('invalid commands return a typed error and log nothing', async () => {
    const { repo, client } = makeClient();
    await client.load();
    const n = repo.log.length;
    const res = await client.dispatch({ type: 'STOP_ACTIVITY' });
    expect(res).toEqual({ ok: false, error: expect.objectContaining({ code: 'NO_ACTIVE_ACTIVITY' }) });
    expect(repo.log.length).toBe(n);
  });

  it('live ticks use the same path as offline (identical hash) and checkpoint every 30s', async () => {
    const { repo, client, clock } = makeClient();
    await client.load();
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting' });
    const started = client.getState();
    await tickFor(client, clock, 95);
    expect(hashState(client.getState())).toBe(hashState(simulate(started, T0 + 95 * SEC).state));
    const checkpoints = repo.log.filter((r) => r.type === 'SIMULATE');
    expect(checkpoints.length).toBe(Math.floor((95 * SEC) / CHECKPOINT_INTERVAL_MS));
    expect(client.getSnapshot().awaySummary).toBeNull(); // live play shows no modal
    await client.persist();
    expect(JSON.parse(repo.stateDoc!)).toEqual(client.getState());
    await verifyLog(repo);
  });

  it('debug +24h: capped at 8h, anomaly logged, summary flags it', async () => {
    const { repo, client } = makeClient();
    await client.load();
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting' });
    const summary = await client.debug.shiftClock(24 * HOUR);
    expect(summary.grantedMs).toBe(8 * HOUR);
    expect(summary.anomalies).toEqual([{ type: 'CLOCK_ANOMALY', kind: 'forward_capped', requestedMs: 24 * HOUR, grantedMs: 8 * HOUR }]);
    expect(client.getSnapshot().awaySummary?.anomalies[0]?.kind).toBe('forward_capped');
    expect(client.getSnapshot().clockOffsetMs).toBe(24 * HOUR);
    const types = repo.log.map((r) => r.type);
    expect(types).toContain('DEBUG_CLOCK_OFFSET');
    expect(types).toContain('CLOCK_ANOMALY');
    expect(await repo.getMeta('debug_clock_offset_ms')).toBe(String(24 * HOUR));
    await verifyLog(repo);
  });

  it('debug clock −2h: anomaly, paused, no rewards until time catches up; logged once', async () => {
    const { repo, client, clock } = makeClient();
    await client.load();
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting' });
    await tickFor(client, clock, 30);
    const logsBefore = qty(client.getState(), 'oak_logs');
    await client.debug.shiftClock(-2 * HOUR);
    const snap = client.getSnapshot();
    expect(snap.clockPaused).toBe(true);
    expect(snap.awaySummary?.anomalies[0]).toMatchObject({ kind: 'backward' });

    const anomaliesBefore = repo.log.filter((r) => r.type === 'CLOCK_ANOMALY').length;
    await tickFor(client, clock, 120);
    expect(qty(client.getState(), 'oak_logs')).toBe(logsBefore);
    expect(repo.log.filter((r) => r.type === 'CLOCK_ANOMALY').length).toBe(anomaliesBefore); // not one per tick

    // Real time passes the highest seen time again → progress resumes.
    clock.advance(2 * HOUR);
    await client.tick();
    await tickFor(client, clock, 6);
    expect(client.getSnapshot().clockPaused).toBe(false);
    expect(qty(client.getState(), 'oak_logs')).toBeGreaterThan(logsBefore);
    await verifyLog(repo);
  });

  it('the debug clock offset survives a restart', async () => {
    const repo = new MemoryGameRepository();
    const clock = new FakeClock(T0);
    const a = new LocalGameClient(repo, clock, idSource('a'));
    await a.load();
    await a.debug.shiftClock(HOUR);
    const clock2 = new FakeClock(T0);
    const b = new LocalGameClient(repo, clock2, idSource('b'));
    const snap = await b.load();
    expect(clock2.offsetMs).toBe(HOUR);
    expect(snap.clockPaused).toBe(false);
  });

  it('+10k hero XP levels the hero along the curve and is logged as DEBUG_GRANT_HERO_XP', async () => {
    const { repo, client } = makeClient();
    await client.load();
    await client.debug.grantHeroXp(10_000);
    expect(client.getState().character.level).toBe(3);
    expect(repo.log.at(-1)?.type).toBe('DEBUG_GRANT_HERO_XP');
  });

  it('reset save: new level-1 hero, offset cleared, log kept', async () => {
    const { repo, client } = makeClient();
    await client.load();
    await client.debug.grantHeroXp(10_000);
    await client.debug.shiftClock(-2 * HOUR);
    const n = repo.log.length;
    await client.debug.resetSave();
    expect(client.getState().character.level).toBe(1);
    expect(client.getSnapshot().clockOffsetMs).toBe(0);
    expect(client.getSnapshot().clockPaused).toBe(false);
    expect(repo.log.slice(n).map((r) => r.type)).toEqual(['DEBUG_RESET_SAVE', 'NEW_GAME']);
    expect(await repo.getMeta('debug_clock_offset_ms')).toBe('0');
  });

  it('every row has a state hash, engine version and unique command id; replay matches', async () => {
    const { repo, client, clock } = makeClient();
    await client.load();
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting' });
    await tickFor(client, clock, 40);
    await client.debug.grantHeroXp(10_000);
    await tickFor(client, clock, 5);
    await client.persist();
    clock.advance(3 * HOUR);
    await client.resume();
    await client.debug.shiftClock(24 * HOUR);
    await client.debug.shiftClock(-2 * HOUR);
    await client.dispatch({ type: 'STOP_ACTIVITY' });
    const rows = await repo.getAllLog();
    expect(new Set(rows.map((r) => r.commandId)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.stateHash).toMatch(/^[0-9a-f]{8}$/);
      expect(r.engineVersion).toBe('1.0.0');
    }
    const replayed = await verifyLog(repo);
    expect(hashState(replayed)).toBe(hashState(client.getState()));
  });

  it('a long JS suspension without a background event is handled as a resume', async () => {
    const { repo, client, clock } = makeClient();
    await client.load();
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting' });
    const started = client.getState();
    clock.advance(HOUR);
    await client.tick();
    const expected = simulate(started, T0 + HOUR);
    expect(client.getSnapshot().awaySummary?.actions).toBe(expected.summary.actions);
    expect(hashState(client.getState())).toBe(hashState(expected.state));
    expect(repo.log.at(-1)?.type).toBe('RESUME');
  });

  it('sync outbox: unsynced rows are exposed; Noop transport acknowledges nothing', async () => {
    const { client } = makeClient();
    await client.load();
    const unsynced = await client.getUnsyncedLog();
    expect(unsynced.map((r) => r.type)).toEqual(['NEW_GAME', 'RESUME']);
    expect(await client.syncOnce(new NoopSyncTransport())).toBe(0);
    expect(await client.syncOnce({ pushLog: async (rows) => [rows[0].seq, 999] })).toBe(1);
    expect((await client.getUnsyncedLog()).map((r) => r.type)).toEqual(['RESUME']);
  });

  it('notifies subscribers only when the snapshot changes', async () => {
    const { client, clock } = makeClient();
    await client.load();
    let calls = 0;
    client.subscribe(() => calls++);
    await client.tick(); // no time passed, idle hero
    expect(calls).toBe(0);
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting' });
    expect(calls).toBe(1);
    clock.advance(SEC);
    await client.tick();
    expect(calls).toBe(2);
  });

  it('concurrent calls are serialized (no lost update)', async () => {
    const { client, clock } = makeClient();
    await client.load();
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting' });
    clock.advance(MIN);
    await Promise.all([client.tick(), client.resume(), client.debug.grantHeroXp(100), client.persist(), client.tick()]);
    expect(client.getState().stats.totalActions).toBe(20);
    expect(client.getState().character.xp).toBe(100);
  });
});
