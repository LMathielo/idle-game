// App wiring: LocalGameClient + SQLite (expo-sqlite) + system clock + expo-crypto ids.
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { SystemClock } from './clock';
import { LocalGameClient } from './LocalGameClient';
import { SQLiteGameRepository } from './sqliteRepository';

const DB_NAME = 'idle-game.db';

export function createAppClient(): LocalGameClient {
  return new LocalGameClient(new SQLiteGameRepository(() => SQLite.openDatabaseAsync(DB_NAME)), new SystemClock(), {
    uuid: () => Crypto.randomUUID(),
    seed: () => Crypto.getRandomValues(new Uint32Array(1))[0],
  });
}
