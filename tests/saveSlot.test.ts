import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DB_NAME, dbNameForSlot, isDefaultSlot, sanitizeSaveSlot, slotSeedsFromDefault } from '../src/client/saveSlot';
import { type SeedDb, seedFromDefaultSave } from '../src/client/seedSave';

describe('save slot -> database file name', () => {
  it('main keeps the existing file: no slot, empty, or "main"', () => {
    expect(DEFAULT_DB_NAME).toBe('idle-game.db');
    for (const raw of [undefined, null, '', 'main', 'MAIN', '  ', '///']) {
      expect(dbNameForSlot(raw)).toBe('idle-game.db');
      expect(isDefaultSlot(raw)).toBe(true);
    }
  });

  it('dev has its own file', () => {
    expect(dbNameForSlot('dev')).toBe('idle-game-dev.db');
    expect(isDefaultSlot('dev')).toBe(false);
  });

  it('PR preview slots are the sanitized head branch', () => {
    expect(dbNameForSlot('feat/expo-test-previews')).toBe('idle-game-feat-expo-test-previews.db');
    expect(dbNameForSlot('fix/Stamina_Bug.2')).toBe('idle-game-fix-stamina-bug-2.db');
    expect(dbNameForSlot('chore/a//b')).toBe('idle-game-chore-a-b.db');
  });

  it('sanitizing leaves only [a-z0-9-], never a leading, trailing or doubled dash', () => {
    for (const raw of ['Feat/Ünïcode ✓ branch', '../../etc/passwd', 'a b\tc', '-x-', 'x--y', 'UPPER']) {
      const slot = sanitizeSaveSlot(raw);
      expect(slot).toMatch(/^([a-z0-9]+(-[a-z0-9]+)*)?$/);
    }
    expect(sanitizeSaveSlot('../../etc/passwd')).toBe('etc-passwd');
    expect(dbNameForSlot('../../etc/passwd')).toBe('idle-game-etc-passwd.db');
  });

  it('is idempotent, so a slot sanitized by the workflow is unchanged in the app', () => {
    for (const raw of ['dev', 'feat/expo-test-previews', 'Fix_1', 'a--b']) {
      expect(sanitizeSaveSlot(sanitizeSaveSlot(raw))).toBe(sanitizeSaveSlot(raw));
    }
  });

  it('only dev seeds from the default save', () => {
    expect(slotSeedsFromDefault('dev')).toBe(true);
    expect(slotSeedsFromDefault('DEV')).toBe(true);
    for (const raw of [undefined, '', 'main', 'feat/x', 'dev-2']) expect(slotSeedsFromDefault(raw)).toBe(false);
  });
});

/** A Node SQLite connection shaped like the slice of expo-sqlite that seedSave uses. */
function seedDb(db: DatabaseSync): SeedDb & { closed: boolean } {
  return {
    closed: false,
    async getFirstAsync<T>(sql: string) {
      return (db.prepare(sql).get() as T | undefined) ?? null;
    },
    async closeAsync() {
      this.closed = true;
    },
  };
}

describe('seeding the dev slot from the default save', () => {
  const withSave = () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE documents (collection TEXT, id TEXT, doc TEXT)');
    db.exec("INSERT INTO documents VALUES ('game_state', 'main', '{}')");
    return db;
  };

  it('copies the default save into an empty slot, reads the default only, and closes it', async () => {
    const slot = seedDb(new DatabaseSync(':memory:'));
    const def = seedDb(withSave());
    const backup = vi.fn(async () => undefined);
    const result = await seedFromDefaultSave({ slot, openDefault: async () => def, backup });
    expect(result).toBe('seeded');
    expect(backup).toHaveBeenCalledWith(def, slot);
    expect(def.closed).toBe(true);
    expect(slot.closed).toBe(false);
  });

  it('does nothing when the slot already has tables (seeded or used before)', async () => {
    const used = new DatabaseSync(':memory:');
    used.exec('CREATE TABLE documents (collection TEXT)');
    const openDefault = vi.fn(async () => seedDb(withSave()));
    const backup = vi.fn(async () => undefined);
    expect(await seedFromDefaultSave({ slot: seedDb(used), openDefault, backup })).toBe('slot-not-empty');
    expect(openDefault).not.toHaveBeenCalled();
    expect(backup).not.toHaveBeenCalled();
  });

  it('starts fresh when the default file is empty or has no save', async () => {
    for (const make of [() => new DatabaseSync(':memory:'), () => {
      const db = new DatabaseSync(':memory:');
      db.exec('CREATE TABLE documents (collection TEXT, id TEXT, doc TEXT)');
      return db;
    }]) {
      const def = seedDb(make());
      const backup = vi.fn(async () => undefined);
      const result = await seedFromDefaultSave({ slot: seedDb(new DatabaseSync(':memory:')), openDefault: async () => def, backup });
      expect(result).toBe('no-default-save');
      expect(backup).not.toHaveBeenCalled();
      expect(def.closed).toBe(true);
    }
  });

  it('closes the default database even when the backup fails, and reports the failure', async () => {
    const def = seedDb(withSave());
    const backup = vi.fn(async () => {
      throw new Error('disk full');
    });
    await expect(
      seedFromDefaultSave({ slot: seedDb(new DatabaseSync(':memory:')), openDefault: async () => def, backup }),
    ).rejects.toThrow('disk full');
    expect(def.closed).toBe(true);
  });
});
