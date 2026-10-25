// SQLite used as a document store (docs/ENGINE.md, "Storage").
// documents: one JSON document per aggregate. action_log: append-only outbox. meta: key/value.
// Talks to a minimal SqlDatabase interface: expo-sqlite in the app (createAppClient.ts),
// Node's built-in SQLite in tests, so the real SQL is covered by the test suite.
import type { GameState, LogType } from '../engine';
import { SCHEMA, SCHEMA_VERSION } from './sqliteSchema';
import type { GameRepository, LogRow, NewLogRow } from './types';

type Param = string | number | null;

/** The subset of expo-sqlite's async API this repository uses. */
export interface SqlDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: Param[]): Promise<unknown>;
  getFirstAsync<T>(source: string, params: Param[]): Promise<T | null>;
  getAllAsync<T>(source: string, params: Param[]): Promise<T[]>;
  /** Only queries run on `txn` are part of the transaction; any throw rolls all of it back. */
  withExclusiveTransactionAsync(task: (txn: SqlDatabase) => Promise<void>): Promise<void>;
}
const STATE_COLLECTION = 'game_state';
const STATE_ID = 'main';


type LogDbRow = {
  seq: number;
  command_id: string;
  type: string;
  payload: string;
  client_time: number;
  engine_version: string;
  state_hash: string;
  synced: number;
};

function toLogRow(r: LogDbRow): LogRow {
  return {
    seq: r.seq,
    commandId: r.command_id,
    type: r.type as LogType,
    payload: JSON.parse(r.payload),
    clientTime: r.client_time,
    engineVersion: r.engine_version,
    stateHash: r.state_hash,
    synced: r.synced === 1,
  };
}

async function writeMeta(db: SqlDatabase, values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    await db.runAsync('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [
      key,
      value,
    ]);
  }
}

export class SQLiteGameRepository implements GameRepository {
  private db: SqlDatabase | null = null;

  /** `wallClock` only stamps updated_at; it is never fed to the engine. */
  constructor(
    private readonly open: () => Promise<SqlDatabase>,
    private readonly wallClock: () => number = () => Date.now(),
  ) {}

  private get conn(): SqlDatabase {
    if (!this.db) throw new Error('SQLiteGameRepository used before init()');
    return this.db;
  }

  async init(): Promise<void> {
    if (this.db) return;
    const db = await this.open();
    await db.execAsync(SCHEMA);
    await db.runAsync('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', ['schema_version', SCHEMA_VERSION]);
    this.db = db;
  }

  async loadState(): Promise<unknown | null> {
    const row = await this.conn.getFirstAsync<{ doc: string }>(
      'SELECT doc FROM documents WHERE collection = ? AND id = ?',
      [STATE_COLLECTION, STATE_ID],
    );
    return row ? JSON.parse(row.doc) : null;
  }

  async hasCommand(commandId: string): Promise<boolean> {
    const row = await this.conn.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM action_log WHERE command_id = ?',
      [commandId],
    );
    return (row?.n ?? 0) > 0;
  }

  async commit(rows: NewLogRow[], state: GameState, meta?: Record<string, string>): Promise<void> {
    const doc = JSON.stringify(state);
    const updatedAt = this.wallClock();
    // Exclusive: only queries on `txn` belong to this transaction; any failure rolls back all of it.
    await this.conn.withExclusiveTransactionAsync(async (txn) => {
      for (const r of rows) {
        await txn.runAsync(
          `INSERT INTO action_log (command_id, type, payload, client_time, engine_version, state_hash)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [r.commandId, r.type, JSON.stringify(r.payload), r.clientTime, r.engineVersion, r.stateHash],
        );
      }
      await txn.runAsync(
        `INSERT INTO documents (collection, id, doc, doc_version, updated_at) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT (collection, id) DO UPDATE SET
           doc = excluded.doc, doc_version = documents.doc_version + 1, updated_at = excluded.updated_at`,
        [STATE_COLLECTION, STATE_ID, doc, updatedAt],
      );
      if (meta) await writeMeta(txn, meta);
    });
  }

  async setMeta(values: Record<string, string>): Promise<void> {
    await this.conn.withExclusiveTransactionAsync((txn) => writeMeta(txn, values));
  }

  async getMeta(key: string): Promise<string | null> {
    const row = await this.conn.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    return row?.value ?? null;
  }

  async getUnsyncedLog(limit: number): Promise<LogRow[]> {
    const rows = await this.conn.getAllAsync<LogDbRow>(
      'SELECT * FROM action_log WHERE synced = 0 ORDER BY seq ASC LIMIT ?',
      [limit],
    );
    return rows.map(toLogRow);
  }

  async getRecentLog(limit: number): Promise<LogRow[]> {
    const rows = await this.conn.getAllAsync<LogDbRow>('SELECT * FROM action_log ORDER BY seq DESC LIMIT ?', [limit]);
    return rows.map(toLogRow);
  }

  async getAllLog(): Promise<LogRow[]> {
    const rows = await this.conn.getAllAsync<LogDbRow>('SELECT * FROM action_log ORDER BY seq ASC', []);
    return rows.map(toLogRow);
  }

  async countLog(): Promise<{ total: number; unsynced: number }> {
    const row = await this.conn.getFirstAsync<{ total: number; unsynced: number | null }>(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN synced = 0 THEN 1 ELSE 0 END) AS unsynced FROM action_log',
      [],
    );
    return { total: row?.total ?? 0, unsynced: row?.unsynced ?? 0 };
  }

  async markSynced(seqs: number[]): Promise<void> {
    if (seqs.length === 0) return;
    const placeholders = seqs.map(() => '?').join(',');
    await this.conn.runAsync(`UPDATE action_log SET synced = 1 WHERE seq IN (${placeholders})`, seqs);
  }

  /** Example document query: reads a field of the state document without parsing it in JS. */
  async getStateField(jsonPath: string): Promise<unknown> {
    const row = await this.conn.getFirstAsync<{ v: unknown }>(
      'SELECT json_extract(doc, ?) AS v FROM documents WHERE collection = ? AND id = ?',
      [jsonPath, STATE_COLLECTION, STATE_ID],
    );
    return row?.v ?? null;
  }
}
