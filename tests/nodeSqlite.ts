// Test helper: Node's built-in SQLite shaped like the slice of expo-sqlite the app uses (SqlDatabase + close).
import { DatabaseSync } from 'node:sqlite';
import type { SqlDatabase } from '../src/client/sqliteRepository';

type Param = string | number | null;

export function nodeSqlDb(db: DatabaseSync): SqlDatabase & { closeAsync(): Promise<void>; getFirstAsync<T>(sql: string, params?: Param[]): Promise<T | null> } {
  const api = {
    async execAsync(sql: string) {
      db.exec(sql);
    },
    async runAsync(sql: string, params: Param[]) {
      return db.prepare(sql).run(...params);
    },
    async getFirstAsync<T>(sql: string, params: Param[] = []) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, params: Param[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async withExclusiveTransactionAsync(task: (txn: SqlDatabase) => Promise<void>) {
      db.exec('BEGIN EXCLUSIVE');
      try {
        await task(api);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async closeAsync() {
      if (db.isOpen) db.close();
    },
  };
  return api;
}
