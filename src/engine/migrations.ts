// Save migrations: ordered pure functions, each upgrading a document by exactly one version.
// To change the save shape: bump CURRENT_SAVE_VERSION, widen GameState.saveVersion,
// add MIGRATIONS[oldVersion] and a fixture test of the old version.
import type { GameState } from './types';

export const CURRENT_SAVE_VERSION = 10 as const;

export type SaveDoc = Record<string, unknown> & { saveVersion?: unknown };
export type Migration = (doc: SaveDoc) => SaveDoc;

/** MIGRATIONS[n] upgrades a version-n document to version n + 1. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // v2 adds flags.debugUsed. A v1 document carries no record of debug use, so it starts false.
  1: (doc) => ({ ...doc, saveVersion: 2, flags: { debugUsed: false } }),
  2: migrateV2toV3,
  3: migrateV3toV4,
  4: migrateV4toV5,
  5: migrateV5toV6,
  6: migrateV6toV7,
  7: migrateV7toV8,
  8: migrateV8toV9,
  9: migrateV9toV10,
};

// ---- v2 → v3 (2026-10-26): 4 attributes, derived stats, stamina ----
// Values here are frozen literals on purpose: a migration must give the same result forever,
// even after config/newGame.ts or config/stamina.ts change.

/** Owner decision 2026-10-26: migrated heroes get at least the new-hero baseline of 10. */
const V3_ATTRIBUTE_MIN = 10;
const V3_STAMINA = { current: 100, max: 100, progressMs: 0 } as const;

type Doc = Record<string, unknown>;
const isDoc = (v: unknown): v is Doc => !!v && typeof v === 'object' && !Array.isArray(v);
/** max(old, 10); a missing or broken value counts as 10. */
const atLeastBaseline = (v: unknown) =>
  typeof v === 'number' && Number.isSafeInteger(v) ? Math.max(v, V3_ATTRIBUTE_MIN) : V3_ATTRIBUTE_MIN;

/** v2 items had no defId. Stackables used the definition id as id; starting gear used `start-<defId>`. */
function withDefId(item: unknown): unknown {
  if (!isDoc(item) || typeof item.defId === 'string') return item;
  const id = typeof item.id === 'string' ? item.id : '';
  return { ...item, defId: id.startsWith('start-') ? id.slice('start-'.length) : id };
}

/**
 * - attributes: strength→strength, dexterity→dexterity, constitution→endurance, intelligence→intelligence
 *   each set to max(old value, 10) so old heroes match the new-hero baseline; agility and charisma are dropped.
 * - character.hp / maxHp dropped (derived now; current HP returns with combat).
 * - stamina added, full.
 * - every equipped and inventory item gets a defId.
 */
function migrateV2toV3(doc: SaveDoc): SaveDoc {
  const character = isDoc(doc.character) ? doc.character : {};
  const { hp: _hp, maxHp: _maxHp, attributes: oldAttrs, equipment: oldEquipment, ...restCharacter } = character;
  const a = isDoc(oldAttrs) ? oldAttrs : {};
  const attributes = {
    strength: atLeastBaseline(a.strength),
    dexterity: atLeastBaseline(a.dexterity),
    endurance: atLeastBaseline(a.constitution),
    intelligence: atLeastBaseline(a.intelligence),
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

// ---- v3 → v4 (2026-10-26): current HP, dungeon state ----
// Frozen literals again: max HP at the hero's level as the v4 rules define it (50 + 10 × (level − 1)),
// so a later change to config/stats.ts cannot change what this migration produces.
const V4_MAX_HP_BASE = 50;
const V4_MAX_HP_PER_LEVEL = 10;

/**
 * - character.hp = max HP at the hero's level (full), character.hpRegenProgress = 0.
 * - dungeon = no last fight, counters at 0.
 * - activity kept as is: v3 only had woodcutting, so no save is in a dungeon.
 */
function migrateV3toV4(doc: SaveDoc): SaveDoc {
  const character = isDoc(doc.character) ? doc.character : {};
  const level = typeof character.level === 'number' && Number.isSafeInteger(character.level) && character.level >= 1 ? character.level : 1;
  return {
    ...doc,
    saveVersion: 4,
    character: { ...character, hp: V4_MAX_HP_BASE + V4_MAX_HP_PER_LEVEL * (level - 1), hpRegenProgress: 0 },
    dungeon: { lastFight: null, totals: { runs: 0, wins: 0, losses: 0 } },
  };
}

// ---- v4 → v5 (2026-10-26): dungeon tiers, per-dungeon counters ----
// Frozen literals: the v4 dungeon id and its v5 name. Every v4 run was a Rat Cellar run.
const V5_DUNGEON_RENAMES: Readonly<Record<string, string>> = { rat_cellar_1: 'rat_cellar' };
const V5_ALL_RUNS_IN = 'rat_cellar';

const count = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0);
const renamedDungeon = (id: unknown) => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(V5_DUNGEON_RENAMES, id) ? V5_DUNGEON_RENAMES[id] : id);

/**
 * - dungeon id `rat_cellar_1` → `rat_cellar` (running activity and last fight).
 * - dungeon.byDungeon: the lifetime totals move to Rat Cellar (the only v4 dungeon), so its wins count
 *   toward the Bat Cave unlock. The global totals stay (they are the sum, and number the next run).
 */
function migrateV4toV5(doc: SaveDoc): SaveDoc {
  const dungeon = isDoc(doc.dungeon) ? doc.dungeon : {};
  const t = isDoc(dungeon.totals) ? dungeon.totals : {};
  const totals = { runs: count(t.runs), wins: count(t.wins), losses: count(t.losses) };
  const lastFight = isDoc(dungeon.lastFight) ? { ...dungeon.lastFight, dungeonId: renamedDungeon(dungeon.lastFight.dungeonId) } : null;
  const byDungeon = totals.runs + totals.wins + totals.losses > 0 ? { [V5_ALL_RUNS_IN]: { ...totals } } : {};

  const activity = isDoc(doc.activity) && doc.activity.kind === 'dungeon' ? { ...doc.activity, dungeonId: renamedDungeon(doc.activity.dungeonId) } : doc.activity;

  return { ...doc, saveVersion: 5, activity, dungeon: { ...dungeon, lastFight, totals, byDungeon } };
}

// ---- v5 → v6 (2026-10-26): training ----
// Frozen literals: the v6 attribute keys and an untrained hero (tier 0, level 0, no XP), so a later
// change to ATTRIBUTE_KEYS or config/training.ts cannot change what this migration produces.
const V6_ATTRIBUTE_KEYS = ['strength', 'dexterity', 'endurance', 'intelligence'] as const;

/**
 * - training = { tier: 0, every attribute at level 0, 0 XP, 0 ms }. Nothing is trainable until Tier 1 is bought.
 * - everything else kept as is: v5 had no training activity, and stored attributes stay the base values.
 */
function migrateV5toV6(doc: SaveDoc): SaveDoc {
  const attributes: Doc = {};
  for (const k of V6_ATTRIBUTE_KEYS) attributes[k] = { level: 0, xp: 0, progressMs: 0 };
  return { ...doc, saveVersion: 6, training: { tier: 0, attributes } };
}

// ---- v6 → v7 (2026-10-27): trees, woodcutting strength, axe slot ----
// Frozen literals: the v7 first tree and the Wooden Axe exactly as a new v7 hero gets it, so a later change
// to config/woodcutting.ts or config/items.ts cannot change what this migration produces.
const V7_FIRST_TREE = 'oak';
const V7_WOODEN_AXE = { id: 'start-wooden_axe', defId: 'wooden_axe', name: 'Wooden Axe', icon: '🪓', rarity: 'common', slot: 'axe' } as const;

/**
 * - a running woodcutting activity becomes Oak with progress 0 (the old 3 s interval has no tree; the banked
 *   part of one old action is dropped). Any other activity is kept as is.
 * - the `axe` equipment slot gets the Wooden Axe (v6 had no axe slot, so it is always empty).
 * - woodcutting level, XP, logs, nests and everything else are kept.
 */
function migrateV6toV7(doc: SaveDoc): SaveDoc {
  const activity = isDoc(doc.activity) && doc.activity.kind === 'woodcutting' ? { ...doc.activity, treeId: V7_FIRST_TREE, progressMs: 0 } : doc.activity;
  const character = isDoc(doc.character) ? doc.character : {};
  const equipment = isDoc(character.equipment) ? character.equipment : {};
  const withAxe = isDoc(equipment.axe) ? equipment : { ...equipment, axe: { ...V7_WOODEN_AXE } };
  return { ...doc, saveVersion: 7, activity, character: { ...character, equipment: withAxe } };
}

// ---- v7 → v8 (2026-10-27): merchant, item quality ----
// Frozen literals: the v8 merchant exactly as a refresh stocked it then (5/5 charges, these 4 listings at
// these prices in the first slots), so a later change to config/merchant.ts or the catalog cannot change
// what this migration produces.
const V8_MAX_CHARGES = 5;
const V8_STOCK = [
  { defId: 'health_potion_t1', quantity: 10, unitPrice: 12 },
  { defId: 'iron_axe', quantity: 1, unitPrice: 600 },
  { defId: 'iron_sword', quantity: 1, unitPrice: 500 },
  { defId: 'iron_helm', quantity: 1, unitPrice: 400 },
] as const;
const V8_DEFAULT_CAPACITY = 20;

/** v7 items copied the catalog rarity onto the instance; quality now lives only in the catalog. */
function withoutRarity(item: unknown): unknown {
  if (!isDoc(item) || !('rarity' in item)) return item;
  const { rarity: _rarity, ...rest } = item;
  return rest;
}

/**
 * - merchant = 5/5 refresh charges, no banked time, a fresh stock: as many slots as the inventory, the 4
 *   listings in the first slots, the rest empty.
 * - nextItemSerial = 1 (v7 had no bought items; starting gear uses `start-<defId>` ids).
 * - the stale per-instance `rarity` is dropped from every equipped and inventory item (quality is catalog-only).
 */
function migrateV7toV8(doc: SaveDoc): SaveDoc {
  const character = isDoc(doc.character) ? doc.character : {};
  const oldEquipment = isDoc(character.equipment) ? character.equipment : {};
  const equipment: Doc = {};
  for (const [slot, item] of Object.entries(oldEquipment)) equipment[slot] = withoutRarity(item);
  const inventory = isDoc(doc.inventory) ? doc.inventory : {};
  const items = Array.isArray(inventory.items) ? inventory.items.map(withoutRarity) : [];
  const cap = inventory.capacity;
  const capacity = typeof cap === 'number' && Number.isSafeInteger(cap) && cap >= 0 && cap <= 1000 ? cap : V8_DEFAULT_CAPACITY;
  const stock: unknown[] = Array.from({ length: capacity }, (_, i) => (i < V8_STOCK.length ? { ...V8_STOCK[i] } : null));
  return {
    ...doc,
    saveVersion: 8,
    merchant: { charges: V8_MAX_CHARGES, chargeProgressMs: 0, stock },
    nextItemSerial: 1,
    character: { ...character, equipment },
    inventory: { ...inventory, items },
  };
}

// ---- v8 → v9 (2026-10-27): live combat, hero XP curve base 1500 → 100 ----
// Frozen literals: the v9 hero curve (base 100, L × √L, growth segments) and the v8 fight timing (one strike
// per side per second, so v8 round n landed at n × 1000 ms; 50 rounds). A later change to config/xpCurve.ts
// or config/dungeons.ts cannot change what this migration produces.
const V9_HERO_XP_BASE = 100;
const V9_HERO_XP_SEGMENTS: readonly { fromLevel: number; growth: number }[] = [
  { fromLevel: 1, growth: 1.0 },
  { fromLevel: 20, growth: 1.05 },
  { fromLevel: 40, growth: 1.07 },
  { fromLevel: 100, growth: 1.18 },
];
const V8_MS_PER_ROUND = 1000;

/** xpToNext(level) on the v9 hero curve: round(100 × L × √L × Π growth(l < L)), clamped to MAX_SAFE_INTEGER. */
function v9HeroXpToNext(level: number): number {
  let multiplier = 1;
  for (let l = 1; l < level; l++) {
    let growth = 1;
    for (const seg of V9_HERO_XP_SEGMENTS) if (l >= seg.fromLevel) growth = seg.growth;
    multiplier *= growth;
  }
  const raw = Math.round(V9_HERO_XP_BASE * level * Math.sqrt(level) * multiplier);
  return Number.isFinite(raw) && raw < Number.MAX_SAFE_INTEGER ? raw : Number.MAX_SAFE_INTEGER;
}

/** v8 fight log entry {round, actor, roll, dealt, targetHpAfter} → v9 {atMs, actor, strike, roll, dealt, targetHpAfter}. */
function v9LogEntry(entry: unknown): unknown {
  if (!isDoc(entry)) return entry;
  const { round, ...rest } = entry;
  const n = count(round);
  return { atMs: n * V8_MS_PER_ROUND, actor: rest.actor, strike: n, roll: rest.roll, dealt: rest.dealt, targetHpAfter: rest.targetHpAfter };
}

/** The v8 last fight in v9 terms: same strikes, timed as they were (1 s per round); `round_cap` is `time_limit`. */
function v9LastFight(fight: unknown): unknown {
  if (!isDoc(fight)) return null;
  const { rounds, log, endReason, ...rest } = fight;
  return {
    ...rest,
    endReason: endReason === 'round_cap' ? 'time_limit' : endReason,
    durationMs: count(rounds) * V8_MS_PER_ROUND,
    log: Array.isArray(log) ? log.map(v9LogEntry) : [],
  };
}

/**
 * - hero XP: the level is kept; XP is clamped into progress toward the next level on the new curve
 *   (xp = min(xp, xpToNext − 1)), and xpToNext is the new curve's value at that level. Nobody loses a level;
 *   XP beyond the new requirement is dropped (it would have levelled the hero up under the new curve).
 * - a dungeon run in progress becomes its SEARCH phase with the time already banked kept (`progressMs`), no fight.
 *   When the kept time already covers the new, shorter search, the fight starts on the next simulate.
 * - the last fight's log gets each strike's time (round n → n × 1000 ms) and number; `rounds` → `durationMs`;
 *   `round_cap` → `time_limit`.
 */
function migrateV8toV9(doc: SaveDoc): SaveDoc {
  const character = isDoc(doc.character) ? doc.character : {};
  const lv = character.level;
  const level = typeof lv === 'number' && Number.isSafeInteger(lv) && lv >= 1 ? lv : 1;
  const xpToNext = v9HeroXpToNext(level);
  const xp = Math.min(count(character.xp), xpToNext - 1);

  const activity = isDoc(doc.activity) && doc.activity.kind === 'dungeon' ? { ...doc.activity, phase: 'search', fight: null } : doc.activity;

  const dungeon = isDoc(doc.dungeon) ? doc.dungeon : {};
  const lastFight = v9LastFight(dungeon.lastFight);

  return {
    ...doc,
    saveVersion: 9,
    activity,
    character: { ...character, level, xp, xpToNext },
    dungeon: { ...dungeon, lastFight },
  };
}

// ---- v9 → v10 (2026-10-28): buildings, Mine Shaft (mining), pickaxe slot ----
// Frozen literals: the v10 building ids (all locked, as on a new save), the Wooden Pickaxe exactly as a new v10
// hero gets it, a fresh mining skill on the v10 skill curve, and the Iron Pickaxe listing at its v10 price. A later
// change to config/buildings.ts, config/items.ts, config/merchant.ts or the XP curve cannot change what this
// migration produces.
const V10_BUILDING_IDS = ['woodcutting', 'mine_shaft', 'town_hall', 'training_grounds'] as const;
const V10_WOODEN_PICKAXE = { id: 'start-wooden_pickaxe', defId: 'wooden_pickaxe', name: 'Wooden Pickaxe', icon: '⛏️', slot: 'pickaxe' } as const;
const V10_MINING_SKILL = { level: 1, xp: 0, xpToNext: 500 } as const;
/** The 5th merchant listing (the pool grew from 4 to 5); it goes in stock slot 4 when that slot is empty. */
const V10_PICKAXE_LISTING = { defId: 'iron_pickaxe', quantity: 1, unitPrice: 600 } as const;
const V10_PICKAXE_STOCK_SLOT = 4;
/** Activities whose building starts locked: they stop. Training XP lives per attribute and is kept. */
const V10_STOPPED_ACTIVITIES: readonly string[] = ['woodcutting', 'training'];

/**
 * Owner decision (2026-10-28, wiping was fine): existing saves get buildings exactly like a new save.
 * - buildings: Woodcutting, Mine Shaft, Town Hall and Training Grounds all locked (level 0).
 * - a running woodcutting or training activity stops cleanly (activity = null): logs already cut and training
 *   XP are kept, the log in progress is dropped like any stop. A dungeon run is kept (the dungeon is always built).
 * - the `pickaxe` equipment slot gets the Wooden Pickaxe (v9 had no pickaxe slot, so it is always empty).
 * - character.skills.mining is added at Lv1 when missing (saves from v1 never had it); an existing one is kept.
 * - merchant: the Iron Pickaxe listing goes in stock slot 4 when that slot exists and is empty (v9 stocked 4
 *   listings), so it can be bought before the next refresh.
 * - everything else is kept, including the training tier already bought.
 */
function migrateV9toV10(doc: SaveDoc): SaveDoc {
  const buildings: Doc = {};
  for (const id of V10_BUILDING_IDS) buildings[id] = { state: 'locked', level: 0 };

  const stop = isDoc(doc.activity) && V10_STOPPED_ACTIVITIES.includes(String(doc.activity.kind));
  const activity = stop ? null : doc.activity;

  const character = isDoc(doc.character) ? doc.character : {};
  const equipment = isDoc(character.equipment) ? character.equipment : {};
  const withPickaxe = isDoc(equipment.pickaxe) ? equipment : { ...equipment, pickaxe: { ...V10_WOODEN_PICKAXE } };
  const skills = isDoc(character.skills) ? character.skills : {};
  const withMining = isDoc(skills.mining) ? skills : { ...skills, mining: { ...V10_MINING_SKILL } };

  let merchant = doc.merchant;
  if (isDoc(merchant) && Array.isArray(merchant.stock) && merchant.stock.length > V10_PICKAXE_STOCK_SLOT && merchant.stock[V10_PICKAXE_STOCK_SLOT] === null) {
    const stock = [...merchant.stock];
    stock[V10_PICKAXE_STOCK_SLOT] = { ...V10_PICKAXE_LISTING };
    merchant = { ...merchant, stock };
  }

  return {
    ...doc,
    saveVersion: 10,
    activity,
    buildings,
    merchant,
    character: { ...character, equipment: withPickaxe, skills: withMining },
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
