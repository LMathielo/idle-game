// One-time seeding of a slot's save from the default save (the `dev` slot, see saveSlot.ts), so switching dev to
// its own file does not lose the progress made before slots existed. Plain TS (no Expo import): the database
// handles and the file operations are passed in, so tests can run it against Node's SQLite.
//
// Safety rule: a slot file is only ever deleted when it was confirmed EMPTY and the copy itself failed. Any other
// problem (a failed check, an unreadable default file) leaves every file untouched.

/** The part of an expo-sqlite database this module touches. */
export interface SeedDb {
  getFirstAsync<T>(source: string): Promise<T | null>;
  closeAsync(): Promise<void>;
}

export type SeedResult =
  /** The slot's database was empty and the default save was copied into it. */
  | 'seeded'
  /** The slot's database already has tables (used before, or seeded before): nothing is touched. */
  | 'slot-not-empty'
  /** The default file has no save (no `documents` table, or no rows): the slot starts fresh. */
  | 'no-default-save';

/** The copy itself failed, after the slot was confirmed empty: the only case where the slot file may be deleted. */
export class SeedBackupError extends Error {
  constructor(readonly original: unknown) {
    super(`Copying the default save failed: ${original instanceof Error ? original.message : String(original)}`);
    this.name = 'SeedBackupError';
  }
}

/**
 * Copies the default save into `slot` when `slot` is still an empty database and the default file holds a save.
 * The default database is only read and always closed (a failing close is ignored). `slot` is left open.
 * Opening the default file creates an empty one if it never existed; that is harmless (main would create it too).
 *
 * Throws `SeedBackupError` when the copy fails; any other error (the emptiness check, opening or reading the default
 * file) is rethrown as is, and means nothing was written.
 */
export async function seedFromDefaultSave<D extends SeedDb>(options: {
  slot: D;
  openDefault: () => Promise<D>;
  backup: (source: D, dest: D) => Promise<void>;
}): Promise<SeedResult> {
  const { slot, openDefault, backup } = options;
  const used = await slot.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
  );
  if (used) return 'slot-not-empty';

  const source = await openDefault();
  try {
    const hasTable = await source.getFirstAsync<{ ok: number }>(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'documents'",
    );
    if (!hasTable) return 'no-default-save';
    const hasSave = await source.getFirstAsync<{ ok: number }>('SELECT 1 AS ok FROM documents LIMIT 1');
    if (!hasSave) return 'no-default-save';
    try {
      await backup(source, slot);
    } catch (err) {
      throw new SeedBackupError(err);
    }
    return 'seeded';
  } finally {
    await source.closeAsync().catch(() => undefined);
  }
}

/** The file operations `openSlotDatabase` needs (expo-sqlite in the app, Node's SQLite in tests). */
export interface SlotStore<D extends SeedDb> {
  open(name: string): Promise<D>;
  remove(name: string): Promise<void>;
  backup(source: D, dest: D): Promise<void>;
}

/**
 * Opens a slot's database, seeding it from the default file first when `seed` is set.
 *  - Seeded or already used: returned as is.
 *  - The copy failed (slot confirmed empty): the slot file is deleted and reopened empty, so the app starts fresh
 *    and retries the seed next launch.
 *  - Any other seeding problem: logged, and the slot file is left exactly as it was (it may hold real progress).
 */
export async function openSlotDatabase<D extends SeedDb>(options: {
  slotName: string;
  defaultName: string;
  seed: boolean;
  store: SlotStore<D>;
  warn?: (message: string, err: unknown) => void;
}): Promise<D> {
  const { slotName, defaultName, seed, store, warn = () => undefined } = options;
  let db = await store.open(slotName);
  if (!seed) return db;
  try {
    await seedFromDefaultSave({
      slot: db,
      openDefault: () => store.open(defaultName),
      backup: (source, dest) => store.backup(source, dest),
    });
  } catch (err) {
    if (err instanceof SeedBackupError) {
      warn(`Could not copy ${defaultName} into ${slotName}; starting fresh.`, err);
      await db.closeAsync().catch(() => undefined);
      await store.remove(slotName).catch((removeErr) => warn(`Could not delete ${slotName}.`, removeErr));
      db = await store.open(slotName);
    } else {
      warn(`Could not check whether ${slotName} needs seeding; leaving it untouched.`, err);
    }
  }
  return db;
}
