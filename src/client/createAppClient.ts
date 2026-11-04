// App wiring: LocalGameClient + SQLite (expo-sqlite) + system clock + expo-crypto ids.
// Each build has its own save file (src/client/saveSlot.ts): main keeps `idle-game.db`.
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { SystemClock } from './clock';
import { LocalGameClient } from './LocalGameClient';
import { DEFAULT_DB_NAME, SAVE_DB_NAME, SAVE_SLOT, slotSeedsFromDefault } from './saveSlot';
import { seedFromDefaultSave } from './seedSave';
import { SQLiteGameRepository } from './sqliteRepository';

/**
 * Opens this build's save file. The first time the `dev` slot opens (its file is still empty), it starts from a copy
 * of the default `idle-game.db`; if that copy fails, the half-written file is deleted and dev starts fresh.
 */
async function openSaveDatabase(): Promise<SQLite.SQLiteDatabase> {
  let db = await SQLite.openDatabaseAsync(SAVE_DB_NAME);
  if (!slotSeedsFromDefault(SAVE_SLOT)) return db;
  try {
    await seedFromDefaultSave({
      slot: db,
      openDefault: () => SQLite.openDatabaseAsync(DEFAULT_DB_NAME),
      backup: (sourceDatabase, destDatabase) => SQLite.backupDatabaseAsync({ sourceDatabase, destDatabase }),
    });
  } catch (err) {
    console.warn(`Could not seed ${SAVE_DB_NAME} from ${DEFAULT_DB_NAME}; starting fresh.`, err);
    await db.closeAsync().catch(() => undefined);
    await SQLite.deleteDatabaseAsync(SAVE_DB_NAME).catch(() => undefined);
    db = await SQLite.openDatabaseAsync(SAVE_DB_NAME);
  }
  return db;
}

export function createAppClient(): LocalGameClient {
  return new LocalGameClient(new SQLiteGameRepository(openSaveDatabase), new SystemClock(), {
    uuid: () => Crypto.randomUUID(),
    seed: () => Crypto.getRandomValues(new Uint32Array(1))[0],
  });
}
