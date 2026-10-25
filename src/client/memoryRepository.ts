// In-memory GameRepository with the same semantics as SQLite (atomic commit, unique command_id).
// Used by tests; also handy for previews.
import type { GameState } from '../engine';
import type { GameRepository, LogRow, NewLogRow } from './types';

export class MemoryGameRepository implements GameRepository {
  stateDoc: string | null = null;
  docVersion = 0;
  log: LogRow[] = [];
  meta = new Map<string, string>();
  private nextSeq = 1;
  /** Test hook: when set, the next commit throws before writing anything. */
  failNextCommit: Error | null = null;

  async init(): Promise<void> {
    if (!this.meta.has('schema_version')) this.meta.set('schema_version', '1');
  }

  async loadState(): Promise<unknown | null> {
    return this.stateDoc === null ? null : JSON.parse(this.stateDoc);
  }

  async hasCommand(commandId: string): Promise<boolean> {
    return this.log.some((r) => r.commandId === commandId);
  }

  async commit(rows: NewLogRow[], state: GameState, meta?: Record<string, string>): Promise<void> {
    if (this.failNextCommit) {
      const err = this.failNextCommit;
      this.failNextCommit = null;
      throw err;
    }
    // Validate everything first so the commit is all-or-nothing, like a SQL transaction.
    const ids = new Set(this.log.map((r) => r.commandId));
    for (const r of rows) {
      if (ids.has(r.commandId)) throw new Error(`UNIQUE constraint failed: action_log.command_id (${r.commandId})`);
      ids.add(r.commandId);
    }
    const doc = JSON.stringify(state);
    for (const r of rows) {
      this.log.push({ ...r, payload: JSON.parse(JSON.stringify(r.payload)), seq: this.nextSeq++, synced: false });
    }
    this.stateDoc = doc;
    this.docVersion += 1;
    if (meta) for (const [k, v] of Object.entries(meta)) this.meta.set(k, v);
  }

  async getMeta(key: string): Promise<string | null> {
    return this.meta.get(key) ?? null;
  }

  async setMeta(values: Record<string, string>): Promise<void> {
    for (const [k, v] of Object.entries(values)) this.meta.set(k, v);
  }

  async getUnsyncedLog(limit: number): Promise<LogRow[]> {
    return this.log.filter((r) => !r.synced).slice(0, limit);
  }

  async getRecentLog(limit: number): Promise<LogRow[]> {
    return this.log.slice(-limit).reverse();
  }

  async getAllLog(): Promise<LogRow[]> {
    return [...this.log];
  }

  async countLog(): Promise<{ total: number; unsynced: number }> {
    return { total: this.log.length, unsynced: this.log.filter((r) => !r.synced).length };
  }

  async markSynced(seqs: number[]): Promise<void> {
    const set = new Set(seqs);
    for (const r of this.log) if (set.has(r.seq)) r.synced = true;
  }
}
