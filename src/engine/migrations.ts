// Save migrations: ordered pure functions, each upgrading a document by exactly one version.
// To change the save shape: bump CURRENT_SAVE_VERSION, widen GameState.saveVersion,
// add MIGRATIONS[oldVersion] and a fixture test of the old version.
import type { GameState } from './types';

export const CURRENT_SAVE_VERSION = 3 as const;

export type SaveDoc = Record<string, unknown> & { saveVersion?: unknown };
export type Migration = (doc: SaveDoc) => SaveDoc;

/** MIGRATIONS[n] upgrades a version-n document to version n + 1. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // v2 adds flags.debugUsed. A v1 document carries no record of debug use, so it starts false.
  1: (doc) => ({ ...doc, saveVersion: 2, flags: { debugUsed: false } }),
  2: migrateV2toV3,
};

// ---- v2 → v3 (2026-10-26): 4 attributes, derived stats, stamina ----
// Values here are frozen literals on purpose: a migration must give the same result forever,
// even after config/newGame.ts or config/stamina.ts change.

const V3_ATTRIBUTE_DEFAULT = 10;
const V3_STAMINA = { current: 100, max: 100, progressMs: 0 } as const;

type Doc = Record<string, unknown>;
const isDoc = (v: unknown): v is Doc => !!v && typeof v === 'object' && !Array.isArray(v);
const intOr = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : fallback);

/** v2 items had no defId. Stackables used the definition id as id; starting gear used `start-<defId>`. */
function withDefId(item: unknown): unknown {
  if (!isDoc(item) || typeof item.defId === 'string') return item;
  const id = typeof item.id === 'string' ? item.id : '';
  return { ...item, defId: id.startsWith('start-') ? id.slice('start-'.length) : id };
}

/**
 * - attributes: strength→strength, dexterity→dexterity, constitution→endurance, intelligence→intelligence
 *   (old values kept); agility and charisma are dropped.
 * - character.hp / maxHp dropped (derived now; current HP returns with combat).
 * - stamina added, full.
 * - every equipped and inventory item gets a defId.
 */
function migrateV2toV3(doc: SaveDoc): SaveDoc {
  const character = isDoc(doc.character) ? doc.character : {};
  const { hp: _hp, maxHp: _maxHp, attributes: oldAttrs, equipment: oldEquipment, ...restCharacter } = character;
  const a = isDoc(oldAttrs) ? oldAttrs : {};
  const attributes = {
    strength: intOr(a.strength, V3_ATTRIBUTE_DEFAULT),
    dexterity: intOr(a.dexterity, V3_ATTRIBUTE_DEFAULT),
    endurance: intOr(a.constitution, V3_ATTRIBUTE_DEFAULT),
    intelligence: intOr(a.intelligence, V3_ATTRIBUTE_DEFAULT),
  };
  const equipment: Doc = {};
  if (isDoc(oldEquipment)) for (const [slot, item] of Object.entries(oldEquipment)) equipment[slot] = withDefId(item);

  const inventory = isDoc(doc.inventory) ? doc.inventory : {};
  const items = Array.isArray(inventory.items) ? inventory.items.map(withDefId) : [];

  return {
    ...doc,
    saveVersion: 3,
    stamina: { ...V3_STAMINA },
    character: { ...restCharacter, attributes, equipment },
    inventory: { ...inventory, items },
  };
}

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
