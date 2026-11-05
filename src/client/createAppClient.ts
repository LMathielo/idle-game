// App wiring: LocalGameClient + SQLite (expo-sqlite) + system clock + expo-crypto ids.
// Each build has its own save file (src/client/saveSlot.ts): main keeps `idle-game.db`.
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { SystemClock } from './clock';
import { LocalGameClient } from './LocalGameClient';
import { DEFAULT_DB_NAME, SAVE_DB_NAME, SAVE_SLOT, slotSeedsFromDefault } from './saveSlot';
import { openSlotDatabase } from './seedSave';
import { SQLiteGameRepository } from './sqliteRepository';

/**
 * Opens this build's save file. The first time the `dev` slot opens (its file is still empty), it starts from a copy
 * of the default `idle-game.db` (rules and failure handling: seedSave.ts).
 */
function openSaveDatabase(): Promise<SQLite.SQLiteDatabase> {
  return openSlotDatabase({
    slotName: SAVE_DB_NAME,
    defaultName: DEFAULT_DB_NAME,
    seed: slotSeedsFromDefault(SAVE_SLOT),
    store: {
      open: (name) => SQLite.openDatabaseAsync(name),
      remove: (name) => SQLite.deleteDatabaseAsync(name),
      backup: (sourceDatabase, destDatabase) => SQLite.backupDatabaseAsync({ sourceDatabase, destDatabase }),
    },
    warn: (message, err) => console.warn(message, err),
  });
}

export function createAppClient(): LocalGameClient {
  return new LocalGameClient(new SQLiteGameRepository(openSaveDatabase), new SystemClock(), {
    uuid: () => Crypto.randomUUID(),
    seed: () => Crypto.getRandomValues(new Uint32Array(1))[0],
  });
}
