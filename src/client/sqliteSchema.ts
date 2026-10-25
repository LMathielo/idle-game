// SQLite schema (document store + append-only action log + meta). Plain strings, no Expo import,
// so tests can run it against Node's built-in SQLite.
export const SCHEMA_VERSION = '1';

export const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS documents (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  doc TEXT NOT NULL,
  doc_version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (collection, id)
);
CREATE TABLE IF NOT EXISTS action_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  client_time INTEGER NOT NULL,
  engine_version TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS action_log_unsynced ON action_log (synced, seq);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;
