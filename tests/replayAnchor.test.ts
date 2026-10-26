// Action-log replay anchors: a save migration or an engine change writes a MIGRATE row carrying the
// migrated state; replay resets to it, so rows from an older engine are never re-run on new rules.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { LogRow } from '../src/client/types';
import {
  CURRENT_SAVE_VERSION,
  dungeonTotals,
  ENGINE_VERSION,
  type GameState,
  hashState,
  isDungeonUnlocked,
  loadSave,
  type MigratePayload,
  newGame,
  type ReplayEntry,
  ReplayError,
  replayLog,
  replayLogReport,
  replayStep,
} from '../src/engine';
import { HOUR, makeClient, MIN, SEC, T0 } from './helpers';

const FIXTURES = join(__dirname, 'fixtures');
/** Frozen v4 save + its action log, written by the 1.3.0 engine before the tiers (tests/fixtures). */
const V4_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v4.json'), 'utf8'));
const V4_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v4.json'), 'utf8'));

/** A phone that ran the 1.3.0 build: the v4 document, its log and engine_version = 1.3.0. */
async function v4Phone() {
  const repo = new MemoryGameRepository();
  await repo.init();
  await repo.commit(
    V4_LOG.map(({ seq: _seq, synced: _synced, ...r }) => r),
    V4_SAVE as GameState,
    { [META_ENGINE_VERSION]: '1.3.0', device_id: 'phone' },
  );
  // The app reopens a few minutes after the fixture was saved.
  const clock = new FakeClock(V4_SAVE.time.lastSimulatedAt + 3 * MIN);
  return makeClient({ repo, clock, prefix: 'v5' });
}

const entries = (rows: LogRow[]): ReplayEntry[] =>
  rows.map((r) => ({ type: r.type, payload: r.payload, clientTime: r.clientTime, engineVersion: r.engineVersion, stateHash: r.stateHash }));

describe('frozen v4 save (tests/fixtures/save-v4.json)', () => {
  it('is what the 1.3.0 engine wrote: Rat Cellar running, 18 wins, 1 loss', () => {
    expect(V4_SAVE.saveVersion).toBe(4);
    expect(V4_SAVE.dungeon.totals).toEqual({ runs: 19, wins: 18, losses: 1 });
    expect(V4_SAVE.activity).toMatchObject({ kind: 'dungeon', dungeonId: 'rat_cellar_1' });
    expect(new Set(V4_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.3.0']));
  });

  it('migrates to v5: Rat Cellar keeps its wins toward Bat Cave, the run continues, nothing else changes', () => {
    const s = loadSave(V4_SAVE);
    expect(s.saveVersion).toBe(5);
    expect(hashState(loadSave(V4_SAVE))).toBe(hashState(s)); // deterministic
    expect(s.dungeon.byDungeon).toEqual({ rat_cellar: { runs: 19, wins: 18, losses: 1 } });
    expect(s.dungeon.totals).toEqual(V4_SAVE.dungeon.totals);
    expect(s.activity).toEqual({ ...V4_SAVE.activity, dungeonId: 'rat_cellar' });
    expect(s.dungeon.lastFight).toEqual({ ...V4_SAVE.dungeon.lastFight, dungeonId: 'rat_cellar' });
    expect(isDungeonUnlocked(s, 'bat_cave')).toBe(true);
    expect(isDungeonUnlocked(s, 'wolf_den')).toBe(false);
    const { dungeon: _d, activity: _a, saveVersion: _v, ...rest } = s;
    const { dungeon: _rd, activity: _ra, saveVersion: _rv, ...rawRest } = V4_SAVE;
    expect(rest).toEqual(rawRest);
  });
});

describe('MIGRATE row on load', () => {
  it('loading the v4 save writes one MIGRATE row with the migrated snapshot and its hash, and bumps engine_version', async () => {
    const { repo, client } = await v4Phone();
    await client.load();
    const log = await repo.getAllLog();
    const migrate = log.filter((r) => r.type === 'MIGRATE');
    expect(migrate).toHaveLength(1);
    const row = migrate[0];
    expect(row.seq).toBe(V4_LOG.length + 1); // right after the old rows, before the resume
    expect(row.engineVersion).toBe(ENGINE_VERSION);
    const p = row.payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({ fromSave: 4, toSave: CURRENT_SAVE_VERSION, fromEngine: '1.3.0', toEngine: ENGINE_VERSION, snapshot: undefined });
    expect(p.snapshot).toEqual(loadSave(V4_SAVE));
    expect(row.stateHash).toBe(hashState(p.snapshot));
    expect(row.stateHash).toBe(hashState(loadSave(V4_SAVE)));
    expect(await repo.getMeta(META_ENGINE_VERSION)).toBe(ENGINE_VERSION);

    // Gameplay after the upgrade: the Rat Cellar run went on, and Bat Cave can start.
    expect(client.getState().activity).toMatchObject({ kind: 'dungeon', dungeonId: 'rat_cellar' });
    expect(dungeonTotals(client.getState(), 'rat_cellar').wins).toBeGreaterThanOrEqual(18);
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'bat_cave' })).ok).toBe(true);
  });

  it('a second load with the same engine writes no new MIGRATE row', async () => {
    const { repo, clock, client } = await v4Phone();
    await client.load();
    const again = makeClient({ repo, clock, prefix: 'again' }).client;
    await again.load();
    expect((await repo.getAllLog()).filter((r) => r.type === 'MIGRATE')).toHaveLength(1);
  });

  it('an engine change alone (same save version) also writes an anchor', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'eng' });
    await client.load();
    repo.meta.set(META_ENGINE_VERSION, '1.3.9');
    await makeClient({ repo, clock, prefix: 'eng2' }).client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m.map((r) => (r.payload as MigratePayload).fromEngine)).toEqual(['1.3.9']);
    expect((m[0].payload as MigratePayload).fromSave).toBe(CURRENT_SAVE_VERSION);
  });

  it('a fresh install writes NEW_GAME and the engine version, no MIGRATE', async () => {
    const { repo, client } = makeClient({ prefix: 'fresh' });
    await client.load();
    expect((await repo.getAllLog()).map((r) => r.type)).toEqual(['NEW_GAME']);
    expect(await repo.getMeta(META_ENGINE_VERSION)).toBe(ENGINE_VERSION);
  });

  it('a failed MIGRATE commit leaves engine_version and the stored document as they were (retried next load)', async () => {
    const { repo, client } = await v4Phone();
    repo.failNextCommit = new Error('disk full');
    await expect(client.load()).rejects.toThrow('disk full');
    expect(await repo.getMeta(META_ENGINE_VERSION)).toBe('1.3.0');
    expect(((await repo.loadState()) as { saveVersion: number }).saveVersion).toBe(4);
    await client.load(); // retry works
    expect((await repo.getAllLog()).filter((r) => r.type === 'MIGRATE')).toHaveLength(1);
  });
});

describe('replay with anchors', () => {
  it('the mixed-version log (1.3.0 rows + MIGRATE + new rows) replays to the live hash without throwing', async () => {
    const { repo, clock, client } = await v4Phone();
    await client.load();
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'bat_cave' });
    for (let i = 0; i < 40; i++) {
      clock.advance(SEC);
      await client.tick();
    }
    await client.debug.addDungeonWins('bat_cave', 10);
    clock.advance(2 * HOUR);
    await client.resume();
    await client.persist();

    const rows = await repo.getAllLog();
    const report = replayLogReport(entries(rows));
    expect(report.anchors).toBe(1);
    expect(report.verifiedUpToAnchor).toBe(V4_LOG.length);
    expect(report.replayed).toBe(rows.length - V4_LOG.length);
    expect(hashState(report.state)).toBe(hashState(client.getState()));
    expect(hashState(report.state)).toBe(rows.at(-1)!.stateHash);
    expect(rows.some((r) => r.type === 'DEBUG_ADD_DUNGEON_WINS')).toBe(true);
  });

  it('why anchors matter: re-running the 1.3.0 rows on the current rules fails', () => {
    // Old rows name `rat_cellar_1`, which no longer exists.
    const blind = V4_LOG.map((r) => ({ type: r.type, payload: r.payload, clientTime: r.clientTime }));
    expect(() => replayLog(blind)).toThrow(ReplayError);
  });

  it('replayStep on a MIGRATE row resets to its snapshot, whatever came before', () => {
    const snapshot = loadSave(V4_SAVE);
    const anchor: ReplayEntry = {
      type: 'MIGRATE',
      payload: { fromSave: 4, toSave: 5, fromEngine: '1.3.0', toEngine: ENGINE_VERSION, snapshot },
      clientTime: T0,
      stateHash: hashState(snapshot),
    };
    const out = replayStep(newGame(1, T0), anchor);
    expect(out).toEqual(snapshot);
    expect(out).not.toBe(snapshot); // a copy: later steps never mutate the log entry
  });

  it('a tampered anchor snapshot is rejected by its hash', () => {
    const snapshot = loadSave(V4_SAVE);
    const hash = hashState(snapshot);
    const tampered = { ...snapshot, character: { ...snapshot.character, gold: 1_000_000 } };
    const anchor = { type: 'MIGRATE', payload: { snapshot: tampered }, clientTime: T0, stateHash: hash };
    expect(() => replayStep(null, anchor)).toThrow(/does not match/);
    expect(() => replayStep(null, { type: 'MIGRATE', payload: {}, clientTime: T0 })).toThrow(/without snapshot/);
  });

  it('a row whose replayed hash differs is reported with its index', () => {
    const rows: ReplayEntry[] = [
      { type: 'NEW_GAME', payload: { seed: 1 }, clientTime: T0, engineVersion: ENGINE_VERSION, stateHash: hashState(newGame(1, T0)) },
      { type: 'RESUME', payload: {}, clientTime: T0 + HOUR, engineVersion: ENGINE_VERSION, stateHash: 'deadbeef' },
    ];
    expect(() => replayLogReport(rows)).toThrow(/row 1 \(RESUME\)/);
  });

  it('old-engine rows after the last anchor cannot be replayed (clear error, no silent pass)', () => {
    const rows = [
      { type: 'NEW_GAME', payload: { seed: 1 }, clientTime: T0, engineVersion: ENGINE_VERSION },
      { type: 'RESUME', payload: {}, clientTime: T0 + HOUR, engineVersion: '0.9.0' },
    ];
    expect(() => replayLogReport(rows)).toThrow(/after the last anchor/);
  });

  it('a later NEW_GAME (debug reset) also starts a fresh span after old rows', () => {
    const rows: ReplayEntry[] = [
      { type: 'NEW_GAME', payload: { seed: 1 }, clientTime: T0, engineVersion: '1.3.0' },
      { type: 'START_ACTIVITY', payload: { id: 'x', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar_1' }, clientTime: T0, engineVersion: '1.3.0' },
      { type: 'NEW_GAME', payload: { seed: 2 }, clientTime: T0 + HOUR, engineVersion: ENGINE_VERSION },
    ];
    const r = replayLogReport(rows);
    expect(r).toMatchObject({ replayed: 1, verifiedUpToAnchor: 2, anchors: 0 });
    expect(r.state).toEqual(newGame(2, T0 + HOUR));
  });

  it('rows without engineVersion count as current (older callers keep working)', () => {
    const s = replayLog([
      { type: 'NEW_GAME', payload: { seed: 3 }, clientTime: T0 },
      { type: 'RESUME', payload: {}, clientTime: T0 + HOUR },
    ]);
    expect(s?.time.lastSimulatedAt).toBe(T0 + HOUR);
  });
});

describe('client: unlock banner and the debug win grant', () => {
  it('+10 wins in Rat Cellar unlocks Bat Cave, shows the banner until dismissed, and replays', async () => {
    const { repo, client } = makeClient({ prefix: 'ban' });
    await client.load();
    expect(client.getSnapshot().unlockedDungeons).toEqual([]);
    expect(await client.dispatch({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'bat_cave' })).toMatchObject({
      ok: false,
      error: { code: 'DUNGEON_LOCKED' },
    });
    expect((await repo.getAllLog()).some((r) => r.type === 'START_ACTIVITY')).toBe(false);

    expect((await client.debug.addDungeonWins('rat_cellar')).ok).toBe(true);
    expect(client.getSnapshot().unlockedDungeons).toEqual(['bat_cave']);
    expect(client.getState().flags.debugUsed).toBe(true);
    client.dismissUnlocks();
    expect(client.getSnapshot().unlockedDungeons).toEqual([]);
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'bat_cave' })).ok).toBe(true);

    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(hashState(report.state)).toBe(hashState(client.getState()));
  });

  it('an unlock earned by live ticks reaches the banner too', async () => {
    const { clock, client } = makeClient({ prefix: 'tick' });
    await client.load();
    await client.debug.addDungeonWins('rat_cellar', 9);
    client.dismissUnlocks();
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' });
    for (let i = 0; i < 290 && client.getSnapshot().unlockedDungeons.length === 0; i++) {
      clock.advance(SEC);
      await client.tick();
    }
    expect(client.getState().dungeon.lastFight?.won).toBe(true);
    expect(client.getSnapshot().unlockedDungeons).toEqual(['bat_cave']);
  });
});
