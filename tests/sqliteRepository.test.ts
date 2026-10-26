// Runs the real schema and SQL of SQLiteGameRepository against Node's built-in SQLite.
// expo-sqlite itself cannot run in Node; the adapter below mirrors the async API we use.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { LocalGameClient } from '../src/client/LocalGameClient';
import { type SqlDatabase, SQLiteGameRepository } from '../src/client/sqliteRepository';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { ENGINE_VERSION, type GameState, hashState, loadSave, newGame, replayLog, replayLogReport } from '../src/engine';
import { HOUR, T0, idSource } from './helpers';

type Param = string | number | null;

function nodeDb(db: DatabaseSync): SqlDatabase {
  const api: SqlDatabase = {
    async execAsync(sql) {
      db.exec(sql);
    },
    async runAsync(sql, params: Param[]) {
      return db.prepare(sql).run(...params);
    },
    async getFirstAsync<T>(sql: string, params: Param[]) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, params: Param[]) {
      return db.prepare(sql).all(...params) as T[];
    },
    async withExclusiveTransactionAsync(task) {
      db.exec('BEGIN EXCLUSIVE');
      try {
        await task(api);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
  return api;
}

function makeRepo() {
  const db = new DatabaseSync(':memory:');
  const repo = new SQLiteGameRepository(async () => nodeDb(db), () => 1);
  return { db, repo };
}

const row = (commandId: string, stateHash = 'deadbeef') => ({
  commandId,
  type: 'SIMULATE' as const,
  payload: { checkpoint: true },
  clientTime: T0,
  engineVersion: '1.0.0',
  stateHash,
});

describe('SQLiteGameRepository (real SQL)', () => {
  it('creates the schema and stores the state as one JSON document', async () => {
    const { db, repo } = makeRepo();
    await repo.init();
    await repo.init(); // idempotent
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(['action_log', 'documents', 'meta']));
    expect(await repo.getMeta('schema_version')).toBe('1');

    const s = newGame(1, T0);
    await repo.commit([row('a')], s);
    await repo.commit([row('b')], s);
    expect(await repo.loadState()).toEqual(s);
    const doc = db.prepare('SELECT collection, id, doc_version FROM documents').all();
    expect(doc).toEqual([{ collection: 'game_state', id: 'main', doc_version: 2 }]);
    // Mongo-style field query straight from SQL
    expect(await repo.getStateField('$.character.name')).toBe('Lucius');
  });

  it('commit is atomic: a duplicate command_id rolls back log rows AND the document', async () => {
    const { repo } = makeRepo();
    await repo.init();
    const s1 = newGame(1, T0);
    await repo.commit([row('a')], s1);
    const s2 = { ...s1, character: { ...s1.character, gold: 999 } };
    await expect(repo.commit([row('b'), row('a')], s2)).rejects.toThrow(/UNIQUE/);
    expect(await repo.countLog()).toEqual({ total: 1, unsynced: 1 });
    expect(await repo.hasCommand('b')).toBe(false);
    expect(((await repo.loadState()) as typeof s1).character.gold).toBe(s1.character.gold);
  });

  it('outbox: unsynced rows in order, markSynced, counts', async () => {
    const { repo } = makeRepo();
    await repo.init();
    const s = newGame(1, T0);
    await repo.commit([row('a'), row('b'), row('c')], s);
    const unsynced = await repo.getUnsyncedLog(10);
    expect(unsynced.map((r) => r.commandId)).toEqual(['a', 'b', 'c']);
    expect(unsynced[0]).toMatchObject({ payload: { checkpoint: true }, synced: false, engineVersion: '1.0.0' });
    await repo.markSynced([unsynced[0].seq, unsynced[2].seq]);
    expect((await repo.getUnsyncedLog(10)).map((r) => r.commandId)).toEqual(['b']);
    expect(await repo.countLog()).toEqual({ total: 3, unsynced: 1 });
    expect((await repo.getRecentLog(2)).map((r) => r.commandId)).toEqual(['c', 'b']);
  });

  it('end to end: LocalGameClient on real SQL, restart, replay matches the stored hashes', async () => {
    const db = new DatabaseSync(':memory:');
    const clock = new FakeClock(T0);
    const open = async () => nodeDb(db);
    const a = new LocalGameClient(new SQLiteGameRepository(open), clock, idSource('a'));
    await a.load();
    await a.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting' });
    clock.advance(HOUR);
    await a.resume();

    const b = new LocalGameClient(new SQLiteGameRepository(open), clock, idSource('b'));
    const snap = await b.load();
    expect(hashState(snap.state)).toBe(hashState(a.getState()));

    const repo = new SQLiteGameRepository(open);
    await repo.init();
    const rows = await repo.getAllLog();
    const replayed = replayLog(rows.map((r) => ({ type: r.type, payload: r.payload, clientTime: r.clientTime, engineVersion: r.engineVersion })));
    expect(hashState(replayed)).toBe(rows.at(-1)!.stateHash);
    expect(hashState(replayed)).toBe(hashState(snap.state));
  });

  it('upgrade on real SQL: a stored v4 save gets a MIGRATE anchor in the same transaction, and the log replays', async () => {
    const db = new DatabaseSync(':memory:');
    const open = async () => nodeDb(db);
    const v4 = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'save-v4.json'), 'utf8'));
    const legacy = new SQLiteGameRepository(open);
    await legacy.init();
    // The legacy row's state_hash is the stored document's hash, as the 1.3.0 client wrote it.
    await legacy.commit([{ ...row('old', hashState(v4)), engineVersion: '1.3.0' }], v4 as GameState, { [META_ENGINE_VERSION]: '1.3.0' });

    const clock = new FakeClock(v4.time.lastSimulatedAt + 60_000);
    const client = new LocalGameClient(new SQLiteGameRepository(open), clock, idSource('sql'));
    await client.load();
    clock.advance(HOUR);
    await client.resume();

    const repo = new SQLiteGameRepository(open);
    await repo.init();
    const rows = await repo.getAllLog();
    const migrate = rows.find((r) => r.type === 'MIGRATE')!;
    expect(migrate.stateHash).toBe(hashState(loadSave(v4)));
    expect(await repo.getMeta(META_ENGINE_VERSION)).toBe(ENGINE_VERSION);
    const report = replayLogReport(rows.map((r) => ({ ...r, stateHash: r.stateHash })));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: 1 });
    expect(hashState(report.state)).toBe(hashState(client.getState()));
  });
});
