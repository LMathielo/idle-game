// One-time seeding of a slot's save from the default save (the `dev` slot, see saveSlot.ts), so switching dev to
// its own file does not lose the progress made before slots existed. Plain TS (no Expo import): the database
// handles and the backup function are passed in, so tests can run it against Node's SQLite.

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
  /** There is no default save to copy: the slot starts fresh. */
  | 'no-default-save';

/**
 * Copies the default save into `slot` when `slot` is still an empty database and the default file holds a save.
 * The default database is only read, never written, and always closed. `slot` is left open for the caller.
 * Opening the default file creates an empty one if it never existed; that is harmless (main would create it too).
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
    let hasSave = false;
    try {
      hasSave = (await source.getFirstAsync<{ ok: number }>('SELECT 1 AS ok FROM documents LIMIT 1')) !== null;
    } catch {
      hasSave = false; // no `documents` table: the default file is empty
    }
    if (!hasSave) return 'no-default-save';
    await backup(source, slot);
    return 'seeded';
  } finally {
    await source.closeAsync();
  }
}
