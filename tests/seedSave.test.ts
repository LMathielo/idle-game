// Seeding the dev slot from idle-game.db, on real SQLite files (Node's built-in SQLite; its `backup` stands in for
// expo-sqlite's backupDatabaseAsync, both wrap the SQLite online-backup API).
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { LocalGameClient } from '../src/client/LocalGameClient';
import { SeedBackupError, type SeedDb, type SlotStore, openSlotDatabase, seedFromDefaultSave } from '../src/client/seedSave';
import { SQLiteGameRepository } from '../src/client/sqliteRepository';
import { hashState, replayLog } from '../src/engine';
import { HOUR, T0, idSource } from './helpers';
import { nodeSqlDb } from './nodeSqlite';

const DEFAULT = 'idle-game.db';
const SLOT = 'idle-game-dev.db';

type FileDb = SeedDb & { db: DatabaseSync; path: string };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seed-save-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function openFile(name: string): FileDb {
  const path = join(dir, name);
  const db = new DatabaseSync(path);
  const sql = nodeSqlDb(db);
  return { db, path, getFirstAsync: (source) => sql.getFirstAsync(source), closeAsync: () => sql.closeAsync() };
}

/** A store over real files in `dir`; individual operations can be overridden to fail. */
function makeStore(overrides: Partial<SlotStore<FileDb>> = {}): SlotStore<FileDb> & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    async open(name) {
      return openFile(name);
    },
    async remove(name) {
      removed.push(name);
      rmSync(join(dir, name), { force: true });
      rmSync(join(dir, `${name}-wal`), { force: true });
      rmSync(join(dir, `${name}-shm`), { force: true });
    },
    async backup(source, dest) {
      await sqliteBackup(source.db, dest.path);
    },
    ...overrides,
  };
}

/** Plays a hero on idle-game.db: a woodcutting session, then a restart. Returns the final state hash. */
async function playOnDefault(): Promise<string> {
  const file = openFile(DEFAULT);
  const clock = new FakeClock(T0);
  const client = new LocalGameClient(new SQLiteGameRepository(async () => nodeSqlDb(file.db)), clock, idSource('p'));
  await client.load();
  await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' });
  clock.advance(HOUR);
  await client.resume();
  const hash = hashState(client.getState());
  file.db.close();
  return hash;
}

const slotTables = (): string[] => {
  const db = new DatabaseSync(join(dir, SLOT));
  try {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
  } finally {
    db.close();
  }
};

describe('seeding the dev slot: real copy', () => {
  it('copies a played save; the copy loads, matches the hash chain and replays; the default file is untouched', async () => {
    const savedHash = await playOnDefault();
    const store = makeStore();
    const db = await openSlotDatabase({ slotName: SLOT, defaultName: DEFAULT, seed: true, store });
    db.db.close();

    // The slot now loads as the same game, with its log intact.
    const open = async () => nodeSqlDb(new DatabaseSync(join(dir, SLOT)));
    const repo = new SQLiteGameRepository(open);
    await repo.init();
    const client = new LocalGameClient(new SQLiteGameRepository(open), new FakeClock(T0 + HOUR), idSource('s'));
    const snap = await client.load();
    expect(hashState(snap.state)).toBe(savedHash);
    const rows = await repo.getAllLog();
    expect(rows.length).toBeGreaterThan(1);
    const replayed = replayLog(rows.map((r) => ({ type: r.type, payload: r.payload, clientTime: r.clientTime, engineVersion: r.engineVersion })));
    expect(hashState(replayed)).toBe(rows.at(-1)!.stateHash);

    // Playing on the slot never writes the default file.
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' });
    const defaultRepo = new SQLiteGameRepository(async () => nodeSqlDb(new DatabaseSync(join(dir, DEFAULT))));
    await defaultRepo.init();
    expect(hashState((await defaultRepo.loadState()) as never)).toBe(savedHash);
    expect(store.removed).toEqual([]);
  });

  it('a second launch does not copy again: later dev progress is kept', async () => {
    await playOnDefault();
    const store = makeStore();
    (await openSlotDatabase({ slotName: SLOT, defaultName: DEFAULT, seed: true, store })).db.close();
    const slot = openFile(SLOT);
    slot.db.exec("DELETE FROM documents; INSERT INTO meta (key, value) VALUES ('marker', 'dev progress') ON CONFLICT (key) DO NOTHING");
    slot.db.close();
    const backup = vi.fn(store.backup);
    (await openSlotDatabase({ slotName: SLOT, defaultName: DEFAULT, seed: true, store: { ...store, backup } })).db.close();
    expect(backup).not.toHaveBeenCalled();
    const check = openFile(SLOT);
    expect(check.db.prepare("SELECT value FROM meta WHERE key = 'marker'").get()).toEqual({ value: 'dev progress' });
    check.db.close();
  });

  it('without a default save the slot starts fresh and no copy is made', async () => {
    const backup = vi.fn(async () => undefined);
    const store = makeStore({ backup });
    (await openSlotDatabase({ slotName: SLOT, defaultName: DEFAULT, seed: true, store })).db.close();
    expect(backup).not.toHaveBeenCalled();
    expect(slotTables()).toEqual([]);
  });

  it('seed=false (main, previews) never touches the default file', async () => {
    const open = vi.fn(makeStore().open);
    (await openSlotDatabase({ slotName: 'idle-game-feat-x.db', defaultName: DEFAULT, seed: false, store: { ...makeStore(), open } })).db.close();
    expect(open).toHaveBeenCalledTimes(1);
    expect(existsSync(join(dir, DEFAULT))).toBe(false);
  });
});

describe('seeding the dev slot: failures', () => {
  it('the copy fails midway: the confirmed-empty slot file is deleted and dev starts fresh', async () => {
    await playOnDefault();
    const warn = vi.fn();
    const store = makeStore({
      async backup(_source, dest) {
        dest.db.exec('CREATE TABLE half_written (x)'); // something already landed in the slot
        throw new Error('disk full');
      },
    });
    const db = await openSlotDatabase({ slotName: SLOT, defaultName: DEFAULT, seed: true, store, warn });
    db.db.close();
    expect(store.removed).toEqual([SLOT]);
    expect(slotTables()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    // The default save survived, so the next launch can try again.
    const def = openFile(DEFAULT);
    expect(def.db.prepare('SELECT COUNT(*) AS n FROM documents').get()).toEqual({ n: 1 });
    def.db.close();
  });

  it('the emptiness check fails on a slot that holds progress: nothing is deleted or copied', async () => {
    await playOnDefault();
    const progress = openFile(SLOT);
    progress.db.exec("CREATE TABLE documents (collection TEXT); INSERT INTO documents VALUES ('dev progress')");
    progress.db.close();
    const warn = vi.fn();
    const backup = vi.fn(async () => undefined);
    const store = makeStore({
      backup,
      async open(name) {
        const file = openFile(name);
        if (name !== SLOT) return file;
        return { ...file, getFirstAsync: () => Promise.reject(new Error('SQLITE_BUSY')) };
      },
    });
    const db = await openSlotDatabase({ slotName: SLOT, defaultName: DEFAULT, seed: true, store, warn });
    db.db.close();
    expect(store.removed).toEqual([]);
    expect(backup).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const check = openFile(SLOT);
    expect(check.db.prepare('SELECT collection FROM documents').get()).toEqual({ collection: 'dev progress' });
    check.db.close();
  });

  it('the default file cannot be opened or read: the slot is left untouched, nothing is deleted', async () => {
    await playOnDefault();
    const openFailing = makeStore({
      async open(name) {
        if (name === DEFAULT) throw new Error('cannot open');
        return openFile(name);
      },
    });
    (await openSlotDatabase({ slotName: SLOT, defaultName: DEFAULT, seed: true, store: openFailing, warn: () => undefined })).db.close();
    expect(openFailing.removed).toEqual([]);

    const readFailing = makeStore({
      async open(name) {
        const file = openFile(name);
        if (name !== DEFAULT) return file;
        return { ...file, getFirstAsync: (sql) => (sql.includes('FROM documents') ? Promise.reject(new Error('SQLITE_IOERR')) : file.getFirstAsync(sql)) };
      },
    });
    (await openSlotDatabase({ slotName: SLOT, defaultName: DEFAULT, seed: true, store: readFailing, warn: () => undefined })).db.close();
    expect(readFailing.removed).toEqual([]);
    expect(slotTables()).toEqual([]); // still empty: the seed retries next launch
  });

  it('only a missing `documents` table means "no default save"; other read errors propagate', async () => {
    const slot = openFile(SLOT);
    const readError = { ...openFile(DEFAULT), getFirstAsync: () => Promise.reject(new Error('SQLITE_IOERR')) } as FileDb;
    await expect(seedFromDefaultSave({ slot, openDefault: async () => readError, backup: async () => undefined })).rejects.toThrow('SQLITE_IOERR');
    const missing = openFile(DEFAULT);
    await expect(seedFromDefaultSave({ slot, openDefault: async () => missing, backup: async () => undefined })).resolves.toBe('no-default-save');
    slot.db.close();
  });

  it('a failing close of the default file after a good copy is ignored: the copy is kept', async () => {
    const savedHash = await playOnDefault();
    const store = makeStore({
      async open(name) {
        const file = openFile(name);
        if (name !== DEFAULT) return file;
        return { ...file, closeAsync: () => Promise.reject(new Error('close failed')) };
      },
    });
    (await openSlotDatabase({ slotName: SLOT, defaultName: DEFAULT, seed: true, store })).db.close();
    expect(store.removed).toEqual([]);
    const repo = new SQLiteGameRepository(async () => nodeSqlDb(new DatabaseSync(join(dir, SLOT))));
    await repo.init();
    expect(hashState((await repo.loadState()) as never)).toBe(savedHash);
  });

  it('a failed copy is reported as SeedBackupError, nothing else is', async () => {
    await playOnDefault();
    const slot = openFile(SLOT);
    const err = await seedFromDefaultSave({
      slot,
      openDefault: async () => openFile(DEFAULT),
      backup: () => Promise.reject(new Error('boom')),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SeedBackupError);
    slot.db.close();
  });
});
