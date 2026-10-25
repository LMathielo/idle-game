// Save migrations: ordered pure functions, each upgrading a document by exactly one version.
// To change the save shape: bump CURRENT_SAVE_VERSION, widen GameState.saveVersion,
// add MIGRATIONS[oldVersion] and a fixture test of the old version.
import type { GameState } from './types';

export const CURRENT_SAVE_VERSION = 1 as const;

export type SaveDoc = Record<string, unknown> & { saveVersion?: unknown };
export type Migration = (doc: SaveDoc) => SaveDoc;

/** MIGRATIONS[n] upgrades a version-n document to version n + 1. Empty while we are at v1. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export class SaveVersionError extends Error {}

/** Runs every migration from the document's version up to `target`. Pure: never mutates `doc`. */
export function migrateDoc(
  doc: unknown,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = CURRENT_SAVE_VERSION,
): SaveDoc {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new SaveVersionError('Save is not an object');
  let current = JSON.parse(JSON.stringify(doc)) as SaveDoc;
  const stored = current.saveVersion;
  if (typeof stored !== 'number' || !Number.isInteger(stored) || stored < 0) {
    throw new SaveVersionError(`Save has an invalid saveVersion: ${String(stored)}`);
  }
  let version: number = stored;
  if (version > target) {
    throw new SaveVersionError(`Save version ${version} is newer than this app (${target}). Update the app.`);
  }
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new SaveVersionError(`No migration from save version ${version}`);
    current = step(current);
    if (current.saveVersion !== version + 1) {
      throw new SaveVersionError(`Migration from ${version} must set saveVersion to ${version + 1}`);
    }
    version += 1;
  }
  return current;
}

/** Loads a stored document into the current GameState shape. */
export function loadSave(doc: unknown): GameState {
  return migrateDoc(doc) as unknown as GameState;
}
