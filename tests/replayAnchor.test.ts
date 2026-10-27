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
  newTrainingState,
  type ReplayEntry,
  ReplayError,
  replayLog,
  replayLogReport,
  RELEASED_ENGINES,
  releasedEngineIndex,
  replayStep,
  MIGRATIONS,
  migrateDoc,
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

  it('migrates to v6 (via v5): Rat Cellar keeps its wins toward Bat Cave, the run continues, untrained hero', () => {
    // The v6 shape (the v7 step, trees and the axe slot, is tested from the v6 fixture).
    const s = migrateDoc(V4_SAVE, MIGRATIONS, 6) as unknown as GameState;
    expect(s.saveVersion).toBe(6);
    expect(s.training).toEqual(newTrainingState());
    expect(hashState(migrateDoc(V4_SAVE, MIGRATIONS, 6) as unknown as GameState)).toBe(hashState(s)); // deterministic
    expect(s.dungeon.byDungeon).toEqual({ rat_cellar: { runs: 19, wins: 18, losses: 1 } });
    expect(s.dungeon.totals).toEqual(V4_SAVE.dungeon.totals);
    expect(s.activity).toEqual({ ...V4_SAVE.activity, dungeonId: 'rat_cellar' });
    expect(s.dungeon.lastFight).toEqual({ ...V4_SAVE.dungeon.lastFight, dungeonId: 'rat_cellar' });
    expect(isDungeonUnlocked(s, 'bat_cave')).toBe(true);
    expect(isDungeonUnlocked(s, 'wolf_den')).toBe(false);
    const { dungeon: _d, activity: _a, saveVersion: _v, training: _t, ...rest } = s;
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
    expect({ ...p, snapshot: undefined }).toEqual({
      fromSave: 4,
      toSave: CURRENT_SAVE_VERSION,
      fromEngine: '1.3.0',
      toEngine: ENGINE_VERSION,
      fromHash: hashState(V4_SAVE), // = the last 1.3.0 row's state_hash
      snapshot: undefined,
    });
    expect(p.fromHash).toBe(V4_LOG.at(-1)!.stateHash);
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

/** The phone's full log after the upgrade plus some play: 1.3.0 rows, the MIGRATE anchor, 1.4.0 rows. */
async function upgradedLog() {
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
  return { rows: entries(await repo.getAllLog()), client };
}

const anchorIndex = (rows: ReplayEntry[]) => rows.findIndex((r) => r.type === 'MIGRATE');

/** Copy of `rows` with the MIGRATE payload changed (stateHash kept consistent with the snapshot). */
function withAnchor(rows: ReplayEntry[], change: (p: MigratePayload) => MigratePayload): ReplayEntry[] {
  const i = anchorIndex(rows);
  const payload = change({ ...(rows[i].payload as MigratePayload) });
  const out = [...rows];
  out[i] = { ...rows[i], payload, stateHash: hashState(payload.snapshot) };
  return out;
}

/** A current-engine log (NEW_GAME + an hour of play), as the client writes it. */
async function currentLog() {
  const { repo, clock, client } = makeClient({ prefix: 'cur' });
  await client.load();
  await client.dispatch({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' });
  clock.advance(HOUR);
  await client.resume();
  return { rows: entries(await repo.getAllLog()), state: client.getState() };
}

describe('replay with anchors', () => {
  it('the mixed-version log (1.3.0 rows + MIGRATE + new rows) replays to the live hash without throwing', async () => {
    const { rows, client } = await upgradedLog();
    const report = replayLogReport(rows);
    expect(report.anchors).toBe(1);
    expect(report.skippedOldEngine).toBe(V4_LOG.length);
    expect(report.replayed).toBe(rows.length - V4_LOG.length);
    expect(hashState(report.state)).toBe(hashState(client.getState()));
    expect(hashState(report.state)).toBe(rows.at(-1)!.stateHash);
    expect(rows.some((r) => r.type === 'DEBUG_ADD_DUNGEON_WINS')).toBe(true);
    // The anchor is chained to the last 1.3.0 row.
    const m = rows[anchorIndex(rows)].payload as MigratePayload;
    expect([m.fromHash, m.fromEngine]).toEqual([V4_LOG.at(-1)!.stateHash, '1.3.0']);
  });

  it('why anchors matter: re-running the 1.3.0 rows on the current rules fails', () => {
    // Old rows name `rat_cellar_1`, which no longer exists. (Stamped as current to force a re-run.)
    const blind = V4_LOG.map((r) => ({ type: r.type, payload: r.payload, clientTime: r.clientTime, engineVersion: ENGINE_VERSION }));
    expect(() => replayLog(blind)).toThrow(ReplayError);
  });

  it('replayStep on a valid MIGRATE row resets to a copy of its snapshot', async () => {
    const { rows } = await upgradedLog();
    const i = anchorIndex(rows);
    const snapshot = (rows[i].payload as MigratePayload).snapshot;
    const out = replayStep(null, rows[i], rows[i - 1]);
    expect(out).toEqual(snapshot);
    expect(out).not.toBe(snapshot); // later steps never mutate the log entry
  });

  describe('rejected anchors', () => {
    it('forged mid-log anchor (same engine, same save version): rejected as "not a migration"', async () => {
      const { rows } = await currentLog();
      const prev = rows.at(-1)!;
      const rich = loadSave(JSON.parse(JSON.stringify(V4_SAVE)));
      const forged: ReplayEntry = {
        type: 'MIGRATE',
        payload: { fromSave: CURRENT_SAVE_VERSION, toSave: CURRENT_SAVE_VERSION, fromEngine: ENGINE_VERSION, toEngine: ENGINE_VERSION, fromHash: prev.stateHash, snapshot: rich },
        clientTime: prev.clientTime,
        engineVersion: ENGINE_VERSION,
        stateHash: hashState(rich),
      };
      expect(() => replayLogReport([...rows, forged])).toThrow(/same engine on both sides/);
    });

    it('forged mid-log anchor claiming a save migration under one engine: rejected (save bumps ship with engine bumps)', async () => {
      const { rows } = await currentLog();
      const prev = rows.at(-1)!;
      const rich = loadSave(JSON.parse(JSON.stringify(V4_SAVE)));
      const forged: ReplayEntry = {
        type: 'MIGRATE',
        payload: { fromSave: 4, toSave: CURRENT_SAVE_VERSION, fromEngine: ENGINE_VERSION, toEngine: ENGINE_VERSION, fromHash: prev.stateHash, snapshot: rich },
        clientTime: prev.clientTime,
        engineVersion: ENGINE_VERSION,
        stateHash: hashState(rich),
      };
      expect(() => replayLogReport([...rows, forged])).toThrow(/same engine on both sides/);
    });

    it('fromHash that is not the previous row\'s hash', async () => {
      const { rows } = await upgradedLog();
      expect(() => replayLogReport(withAnchor(rows, (p) => ({ ...p, fromHash: 'deadbeef' })))).toThrow(/fromHash deadbeef/);
    });

    it('fromSave / toSave that do not match what RELEASED_ENGINES says those engines wrote', async () => {
      const { rows } = await upgradedLog();
      expect(() => replayLogReport(withAnchor(rows, (p) => ({ ...p, fromSave: 3 })))).toThrow(/fromSave 3 is not what engine 1\.3\.0 wrote/);
      const i = anchorIndex(rows);
      const p = rows[i].payload as MigratePayload;
      // toSave must equal both the snapshot's saveVersion and the save the target engine writes.
      const wrongTo = { ...rows[i], payload: { ...p, toSave: 4, snapshot: { ...(p.snapshot as GameState), saveVersion: 4 } } };
      wrongTo.stateHash = hashState(wrongTo.payload.snapshot);
      expect(() => replayStep(null, wrongTo, rows[i - 1])).toThrow(new RegExp(`toSave 4 is not what engine ${ENGINE_VERSION} writes`));
    });

    it('fromEngine that is not the previous row\'s engine', async () => {
      const { rows } = await upgradedLog();
      expect(() => replayLogReport(withAnchor(rows, (p) => ({ ...p, fromEngine: '1.2.0' })))).toThrow(/fromEngine 1.2.0/);
    });

    it('same-version anchor (fromEngine = toEngine and no save change)', async () => {
      const { rows } = await upgradedLog();
      const i = anchorIndex(rows);
      // Rewrite the previous row so the chain itself is consistent: only the version rule can catch it.
      const same = withAnchor(rows, (p) => ({ ...p, fromEngine: ENGINE_VERSION, fromSave: CURRENT_SAVE_VERSION }));
      same[i - 1] = { ...same[i - 1], engineVersion: ENGINE_VERSION };
      expect(() => replayStep(null, same[i], same[i - 1])).toThrow(/same engine on both sides/);
    });

    it('missing engineVersion: on any row of a log, and on the anchor itself', async () => {
      const { rows } = await upgradedLog();
      const i = anchorIndex(rows);
      const noVersion = rows.map((r, k) => (k === 3 ? { ...r, engineVersion: undefined } : r));
      expect(() => replayLogReport(noVersion)).toThrow(/Row 3 .* has no engineVersion/);
      expect(() => replayStep(null, { ...rows[i], engineVersion: undefined }, rows[i - 1])).toThrow(/row has no engineVersion/);
      expect(() => replayStep(null, rows[i], { ...rows[i - 1], engineVersion: undefined })).toThrow(/before it has no engineVersion/);
    });

    it('toEngine that is not the row\'s engine, a tampered snapshot, a missing snapshot or no previous row', async () => {
      const { rows } = await upgradedLog();
      const i = anchorIndex(rows);
      expect(() => replayStep(null, { ...rows[i], payload: { ...(rows[i].payload as MigratePayload), toEngine: '9.9.9' } }, rows[i - 1])).toThrow(
        /toEngine 9.9.9/,
      );
      const p = rows[i].payload as MigratePayload;
      const tampered = { ...rows[i], payload: { ...p, snapshot: { ...(p.snapshot as GameState), character: { ...(p.snapshot as GameState).character, gold: 1e6 } } } };
      expect(() => replayStep(null, tampered, rows[i - 1])).toThrow(/does not match the row/);
      expect(() => replayStep(null, { ...rows[i], payload: { ...p, snapshot: undefined } }, rows[i - 1])).toThrow(/no snapshot/);
      expect(() => replayStep(null, rows[i])).toThrow(/no row before it/);
      expect(() => replayLogReport(rows.slice(i))).toThrow(/no row before it/);
    });

    it('known limit: after a skipped old-engine span the anchor is chain-checked only (client-trusted until a server re-runs the old span)', async () => {
      const { rows } = await upgradedLog();
      const i = anchorIndex(rows);
      const rich = { ...((rows[i].payload as MigratePayload).snapshot as GameState) };
      rich.character = { ...rich.character, gold: 123_456 };
      const forged = withAnchor(rows.slice(0, i + 1), (p) => ({ ...p, snapshot: rich }));
      const r = replayLogReport(forged);
      expect(r.state?.character.gold).toBe(123_456);
      expect(r.skippedOldEngine).toBe(V4_LOG.length);
    });
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
      { type: 'NEW_GAME', payload: { seed: 1 }, clientTime: T0, engineVersion: '1.3.0' },
      { type: 'RESUME', payload: {}, clientTime: T0 + HOUR, engineVersion: '1.3.0' },
    ];
    expect(() => replayLogReport(rows)).toThrow(/after the last anchor/);
  });

  describe('engine labels are checked before they decide what is skipped', () => {
    /** A forged anchor after `rows`, chained to the last row's label and hash, worth 999,999 gold. */
    function forgeAfter(rows: ReplayEntry[]): ReplayEntry {
      const prev = rows.at(-1)!;
      const rich = { ...newGame(1, T0), character: { ...newGame(1, T0).character, gold: 999_999 } };
      return {
        type: 'MIGRATE',
        payload: { fromSave: 4, toSave: CURRENT_SAVE_VERSION, fromEngine: prev.engineVersion, toEngine: ENGINE_VERSION, fromHash: prev.stateHash, snapshot: rich },
        clientTime: prev.clientTime,
        engineVersion: ENGINE_VERSION,
        stateHash: hashState(rich),
      };
    }

    it("relabelling a current row as '9.9.9' to skip its span is rejected (the reviewer's 999,999 gold case)", async () => {
      const { rows } = await currentLog();
      const relabelled = rows.map((r, k) => (k === rows.length - 1 ? { ...r, engineVersion: '9.9.9' } : r));
      expect(() => replayLogReport([...relabelled, forgeAfter(relabelled)])).toThrow(/9\.9\.9, which never shipped/);
    });

    it('an unknown older label is rejected too', async () => {
      const { rows } = await currentLog();
      const relabelled = rows.map((r, k) => (k === 1 ? { ...r, engineVersion: '0.9.0' } : r));
      expect(() => replayLogReport(relabelled)).toThrow(/0\.9\.0, which never shipped/);
    });

    it('a label newer than this engine is rejected (this engine is the last released one)', async () => {
      expect(RELEASED_ENGINES.at(-1)!.engine).toBe(ENGINE_VERSION);
      expect(releasedEngineIndex('1.8.0')).toBe(-1);
      const { rows } = await currentLog();
      expect(() => replayLogReport(rows.map((r) => ({ ...r, engineVersion: '1.8.0' })))).toThrow(/1\.8\.0, which never shipped/);
    });

    it('labels never go back along the log: a 1.3.0 row after 1.4.0 rows is rejected', async () => {
      const { rows } = await currentLog();
      const relabelled = rows.map((r, k) => (k === rows.length - 1 ? { ...r, engineVersion: '1.3.0' } : r));
      expect(() => replayLogReport([...relabelled, forgeAfter(relabelled)])).toThrow(/1\.3\.0, older than an earlier row/);
    });

    it('relabelling only row 0 of a current log as 1.3.0, then a current → current engine save 4 → current anchor: rejected', async () => {
      const { rows } = await currentLog();
      const relabelled = rows.map((r, k) => (k === 0 ? { ...r, engineVersion: '1.3.0' } : r));
      const forged = forgeAfter(relabelled); // fromEngine = current (the last row), toEngine = current, save 4 → current
      expect((forged.payload as MigratePayload).fromEngine).toBe(ENGINE_VERSION);
      // The skipped span still holds current-engine rows: a genuine log would have anchored before them.
      expect(() => replayLogReport([...relabelled, forged])).toThrow(new RegExp(`${ENGINE_VERSION} inside an older-engine span`));
      // And the anchor alone is refused too: same engine on both sides.
      expect(() => replayStep(null, forged, relabelled.at(-1))).toThrow(/same engine on both sides/);
    });

    it('an old span may mix released engines without anchors (real pre-1.4.0 logs did)', () => {
      const rows: ReplayEntry[] = [
        { type: 'NEW_GAME', payload: { seed: 1 }, clientTime: T0, engineVersion: '1.2.0' },
        { type: 'RESUME', payload: {}, clientTime: T0 + HOUR, engineVersion: '1.3.0' },
        { type: 'NEW_GAME', payload: { seed: 2 }, clientTime: T0 + 2 * HOUR, engineVersion: ENGINE_VERSION },
      ];
      expect(replayLogReport(rows)).toMatchObject({ skippedOldEngine: 2, replayed: 1 });
    });

    it('the genuine frozen v4 upgrade (1.3.0 rows, then 1.4.0) still replays', async () => {
      const { rows, client } = await upgradedLog();
      const report = replayLogReport(rows);
      expect(report.skippedOldEngine).toBe(V4_LOG.length);
      expect(hashState(report.state)).toBe(hashState(client.getState()));
    });
  });

  it('a later NEW_GAME (debug reset) also starts a fresh span after old rows', () => {
    const rows: ReplayEntry[] = [
      { type: 'NEW_GAME', payload: { seed: 1 }, clientTime: T0, engineVersion: '1.3.0' },
      { type: 'START_ACTIVITY', payload: { id: 'x', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar_1' }, clientTime: T0, engineVersion: '1.3.0' },
      { type: 'NEW_GAME', payload: { seed: 2 }, clientTime: T0 + HOUR, engineVersion: ENGINE_VERSION },
    ];
    const r = replayLogReport(rows);
    expect(r).toMatchObject({ replayed: 1, skippedOldEngine: 2, anchors: 0 });
    expect(r.state).toEqual(newGame(2, T0 + HOUR));
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

  it('no banner when the commit that holds the unlock fails (state rolled back)', async () => {
    const { repo, client } = makeClient({ prefix: 'fail' });
    await client.load();
    repo.failNextCommit = new Error('disk full');
    await expect(client.debug.addDungeonWins('rat_cellar')).rejects.toThrow('disk full');
    expect(client.getSnapshot().unlockedDungeons).toEqual([]);
    expect(isDungeonUnlocked(client.getState(), 'bat_cave')).toBe(false);
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
