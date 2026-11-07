// Save migrations: ordered pure functions, each upgrading a document by exactly one version.
// To change the save shape: bump CURRENT_SAVE_VERSION, widen GameState.saveVersion,
// add MIGRATIONS[oldVersion] and a fixture test of the old version.
import type { GameState } from './types';

export const CURRENT_SAVE_VERSION = 25 as const;

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
  10: migrateV10toV11,
  11: migrateV11toV12,
  12: migrateV12toV13,
  13: migrateV13toV14,
  14: migrateV14toV15,
  15: migrateV15toV16,
  16: migrateV16toV17,
  17: migrateV17toV18,
  18: migrateV18toV19,
  19: migrateV19toV20,
  20: migrateV20toV21,
  21: migrateV21toV22,
  22: migrateV22toV23,
  23: migrateV23toV24,
  24: migrateV24toV25,
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

// ---- v10 → v11 (2026-10-28): building upgrades, the builder, workers, the Merchant as a building ----
// Frozen literals: the Merchant as a v11 building (built, level 1) and the empty v11 village state.
const V11_MERCHANT_BUILDING = { state: 'built', level: 1 } as const;
const V11_WORKERS = { list: [], nextSerial: 1, crews: {}, paused: false, minuteLeftMs: 0, paidPerMin: 0 } as const;

/**
 * Owner-approved (2026-10-28):
 * - buildings keep their state and level (built = level 1; nothing was upgradable before); the Merchant becomes a
 *   stored building, built at level 1 (it was always built).
 * - the builder is idle (`construction = null`); no workers (`workers` empty).
 * - the merchant stock is kept as it is until the next refresh.
 * - everything else is kept.
 */
function migrateV10toV11(doc: SaveDoc): SaveDoc {
  const buildings = isDoc(doc.buildings) ? doc.buildings : {};
  return {
    ...doc,
    saveVersion: 11,
    buildings: { ...buildings, merchant: { ...V11_MERCHANT_BUILDING } },
    construction: null,
    workers: { ...V11_WORKERS, list: [], crews: {} },
  };
}

// ---- v11 → v12 (2026-10-31): skill XP curve base 500 → 100 with its own growth segments ----
// Frozen literals: the v11 skill curve (base 500, the hero's segments) and the v12 skill curve (base 100, skill
// segments). A later change to config/xpCurve.ts cannot change what this migration produces.
type FrozenCurve = { base: number; segments: readonly { fromLevel: number; growth: number }[] };
const V11_SKILL_CURVE: FrozenCurve = {
  base: 500,
  segments: [
    { fromLevel: 1, growth: 1.0 },
    { fromLevel: 20, growth: 1.05 },
    { fromLevel: 40, growth: 1.07 },
    { fromLevel: 100, growth: 1.18 },
  ],
};
const V12_SKILL_CURVE: FrozenCurve = {
  base: 100,
  segments: [
    { fromLevel: 1, growth: 1.0 },
    { fromLevel: 15, growth: 1.07 },
    { fromLevel: 40, growth: 1.08 },
    { fromLevel: 100, growth: 1.18 },
  ],
};
const SAFE = Number.MAX_SAFE_INTEGER;

/**
 * xpToNext for every level from 1 up to `upTo` on a frozen curve: round(base × L × √L × Π growth(l < L)), clamped
 * to MAX_SAFE_INTEGER. Same operations, in the same order, as progression.ts, so the result matches the engine bit for bit.
 */
function frozenXpToNext(curve: FrozenCurve, level: number, multipliers: number[]): number {
  for (let l = multipliers.length; l <= level; l++) {
    let growth = 1;
    for (const seg of curve.segments) {
      if (l - 1 >= seg.fromLevel) growth = seg.growth;
      else break;
    }
    multipliers[l] = multipliers[l - 1] * growth;
  }
  const raw = Math.round(curve.base * (level * Math.sqrt(level)) * multipliers[level]);
  return Number.isFinite(raw) && raw < SAFE ? raw : SAFE;
}

/** A skill's progress under v12: its total XP on the v11 curve, replayed onto the v12 curve. Exported for tests. */
export function v12SkillProgress(skill: unknown): { level: number; xp: number; xpToNext: number } {
  const s = isDoc(skill) ? skill : {};
  const oldLevel = typeof s.level === 'number' && Number.isSafeInteger(s.level) && s.level >= 1 ? s.level : 1;
  const oldM = [1, 1];
  let total = count(s.xp);
  // A corrupt save can carry a huge level: once the total is clamped, more levels add nothing, so stop there.
  for (let l = 1; l < oldLevel && total < SAFE; l++) total = Math.min(SAFE, total + frozenXpToNext(V11_SKILL_CURVE, l, oldM));
  const newM = [1, 1];
  let level = 1;
  let next = frozenXpToNext(V12_SKILL_CURVE, 1, newM);
  while (total >= next && next < SAFE) {
    total -= next;
    level += 1;
    next = frozenXpToNext(V12_SKILL_CURVE, level, newM);
  }
  return { level, xp: Math.min(total, next - 1), xpToNext: next };
}

/**
 * Owner-approved (2026-10-31; testers jumping levels is fine):
 * - every skill keeps its TOTAL XP (XP of every level below on the v11 curve + XP into the level) and gets the level
 *   and XP-into-level that total gives on the v12 curve. The v12 curve is cheaper at every level, so nobody loses a
 *   level; most skills gain some.
 * - a running activity is kept as it is (a higher level never locks a tree or rock); its progress is kept.
 * - everything else is kept.
 */
function migrateV11toV12(doc: SaveDoc): SaveDoc {
  const character = isDoc(doc.character) ? doc.character : {};
  const oldSkills = isDoc(character.skills) ? character.skills : {};
  const skills: Doc = {};
  for (const [key, skill] of Object.entries(oldSkills)) skills[key] = v12SkillProgress(skill);
  return { ...doc, saveVersion: 12, character: { ...character, skills } };
}

// ---- v12 → v13 (2026-11-01): the Crafting house, pipes, the yield ledger; smithing removed ----
// Frozen literals: what a new save had in 1.13.0, whatever config/crafting.ts says later.
const V13_CRAFTING_BUILDING = { state: 'locked', level: 0 } as const;
const V13_PIPES_UNLOCKED = 2;
const V13_PIPE_SLOTS = 8;

/**
 * Owner-approved (2026-11-01):
 * - the Crafting house is added, locked (`buildings.crafting`), like on a new save;
 * - `crafting` = 2 open pipes of 8, all idle, an empty fraction ledger, job serial 1;
 * - the unused `smithing` skill is dropped (crafting has no skill);
 * - everything else is kept.
 */
function migrateV12toV13(doc: SaveDoc): SaveDoc {
  const character = isDoc(doc.character) ? doc.character : {};
  const skills: Doc = { ...(isDoc(character.skills) ? character.skills : {}) };
  delete skills.smithing;
  const buildings = isDoc(doc.buildings) ? doc.buildings : {};
  return {
    ...doc,
    saveVersion: 13,
    buildings: { ...buildings, crafting: { ...V13_CRAFTING_BUILDING } },
    crafting: { pipesUnlocked: V13_PIPES_UNLOCKED, pipes: Array.from({ length: V13_PIPE_SLOTS }, () => null), remainders: {}, nextJobSerial: 1 },
    character: { ...character, skills },
  };
}

// ---- v13 → v14 (2026-11-01): gear quality and rarity on every gear instance ----
// Frozen literals: the gear (equippable) items of the 1.13.0 catalog and the default roll, whatever config says later.
const V14_GEAR_IDS: ReadonlySet<string> = new Set([
  'rusty_gladius',
  'linen_tunic',
  'worn_sandals',
  'wooden_axe',
  'iron_axe',
  'wooden_pickaxe',
  'iron_pickaxe',
  'iron_sword',
  'iron_helm',
  'iron_chestplate',
  'iron_shield',
  'iron_gloves',
  'iron_boots',
  'steel_axe',
  'steel_pickaxe',
  'steel_sword',
]);
const V14_DEFAULT_ROLL = { quality: 25, rarity: 'common' } as const;

const isV14Gear = (x: unknown): x is Doc => isDoc(x) && typeof x.defId === 'string' && V14_GEAR_IDS.has(x.defId);
const withV14Roll = (x: unknown): unknown => (isV14Gear(x) ? { ...x, ...V14_DEFAULT_ROLL } : x);

/**
 * Owner-approved (2026-11-01):
 * - every gear instance (equipped and in the inventory) gets `quality: 25, rarity: 'common'`: at quality 25 the rescaled
 *   catalog gives exactly the old stats and prices, so nothing changes for the player;
 * - every gear listing in the merchant's current stock gets the same roll (its unit price is kept);
 * - everything else (crafting jobs: materials only before v14) is kept.
 */
function migrateV13toV14(doc: SaveDoc): SaveDoc {
  const character = isDoc(doc.character) ? doc.character : {};
  const equipment: Doc = {};
  for (const [slot, item] of Object.entries(isDoc(character.equipment) ? character.equipment : {})) equipment[slot] = withV14Roll(item);
  const inventory = isDoc(doc.inventory) ? doc.inventory : {};
  const items = Array.isArray(inventory.items) ? inventory.items.map(withV14Roll) : inventory.items;
  const merchant = isDoc(doc.merchant) ? doc.merchant : null;
  const out: SaveDoc = {
    ...doc,
    saveVersion: 14,
    character: { ...character, equipment },
    inventory: { ...inventory, items },
  };
  if (merchant && Array.isArray(merchant.stock)) out.merchant = { ...merchant, stock: merchant.stock.map(withV14Roll) };
  return out;
}

// ---- v14 → v15 (2026-11-01): continuous material pipes ----
// Frozen literals: the 1.14.0 material recipes' input per craft, the ×10 multiplier, and the stack an input refund
// creates when the hero has none, whatever config/crafting.ts and config/items.ts say later.
const V15_MATERIAL_INPUT: Readonly<Record<string, { defId: string; quantity: number }>> = {
  oak_plank: { defId: 'oak_logs', quantity: 2 },
  stone_brick: { defId: 'stone', quantity: 2 },
  birch_plank: { defId: 'birch_logs', quantity: 4 },
  copper_ingot: { defId: 'copper_ore', quantity: 4 },
  maple_plank: { defId: 'maple_logs', quantity: 8 },
  iron_ingot: { defId: 'iron_ore', quantity: 8 },
  yew_plank: { defId: 'yew_logs', quantity: 16 },
  silver_ingot: { defId: 'silver_ore', quantity: 16 },
  ironwood_plank: { defId: 'ironwood_logs', quantity: 32 },
  gold_ingot: { defId: 'gold_ore', quantity: 32 },
};
const V15_INPUT_ITEM: Readonly<Record<string, { name: string; icon: string }>> = {
  oak_logs: { name: 'Oak Logs', icon: '🪵' },
  birch_logs: { name: 'Birch Logs', icon: '🪵' },
  maple_logs: { name: 'Maple Logs', icon: '🪵' },
  yew_logs: { name: 'Yew Logs', icon: '🪵' },
  ironwood_logs: { name: 'Ironwood Logs', icon: '🪵' },
  stone: { name: 'Stone', icon: '🪨' },
  copper_ore: { name: 'Copper Ore', icon: '🟠' },
  iron_ore: { name: 'Iron Ore', icon: '⚫' },
  silver_ore: { name: 'Silver Ore', icon: '⚪' },
  gold_ore: { name: 'Gold Ore', icon: '🟡' },
};
const V15_X10 = 10;
const v15Count = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : 0);

/**
 * Owner-approved (2026-11-01). Material jobs become continuous (no quantity, no mode); nothing may be lost:
 * - the craft in progress (running or held) keeps its taken inputs and its progress; it is ×10 if the job was in x10 mode
 *   (its stamina was spent);
 * - the inputs of every craft not yet started go back to the inventory (an existing stack, else a free slot), in pipe
 *   order; when they do not fit, those crafts stay on the job as `prepaid` x1 crafts (×10 crafts count 10), used before
 *   any new inputs and refunded by Stop;
 * - the up-front ×10 stamina of every craft not yet started goes back, capped at max stamina;
 * - gear jobs (one piece, x1), held and ready states are kept; every job drops `quantity`, `mode`, `staminaPerCraft`
 *   and gets `x10`.
 */
function migrateV14toV15(doc: SaveDoc): SaveDoc {
  const crafting = isDoc(doc.crafting) ? doc.crafting : null;
  if (!crafting || !Array.isArray(crafting.pipes)) return { ...doc, saveVersion: 15 };
  const inventory = isDoc(doc.inventory) ? doc.inventory : {};
  const items: Doc[] = Array.isArray(inventory.items) ? inventory.items.map((i) => (isDoc(i) ? { ...i } : i)) : [];
  const capacity = typeof inventory.capacity === 'number' ? inventory.capacity : 0;
  let staminaBack = 0;
  const pipes = crafting.pipes.map((job) => {
    if (!isDoc(job)) return job;
    const { quantity, mode, staminaPerCraft, ...rest } = job;
    const x10 = mode === 'x10';
    const input = typeof job.recipeId === 'string' ? V15_MATERIAL_INPUT[job.recipeId] : undefined;
    if (!input) return { ...rest, x10: false }; // gear: one piece, x1
    const notStarted = Math.max(0, v15Count(quantity) - v15Count(job.done) - 1);
    if (notStarted === 0) return { ...rest, x10 };
    staminaBack += v15Count(staminaPerCraft) * notStarted;
    const crafts = notStarted * (x10 ? V15_X10 : 1);
    const amount = input.quantity * crafts;
    const stack = items.find((i) => isDoc(i) && i.stackable === true && i.defId === input.defId);
    if (stack) {
      stack.quantity = v15Count(stack.quantity) + amount;
      return { ...rest, x10 };
    }
    if (items.length < capacity) {
      items.push({ id: input.defId, defId: input.defId, ...V15_INPUT_ITEM[input.defId], stackable: true, quantity: amount });
      return { ...rest, x10 };
    }
    return { ...rest, x10, prepaid: crafts };
  });
  const out: SaveDoc = { ...doc, saveVersion: 15, crafting: { ...crafting, pipes }, inventory: { ...inventory, items } };
  const stamina = isDoc(doc.stamina) ? doc.stamina : null;
  if (stamina && staminaBack > 0 && typeof stamina.current === 'number' && typeof stamina.max === 'number') {
    const current = Math.max(stamina.current, Math.min(stamina.max, stamina.current + staminaBack));
    out.stamina = { ...stamina, current, progressMs: current >= stamina.max ? 0 : stamina.progressMs };
  }
  return out;
}

// ---- v15 → v16 (2026-11-01): normal and core attribute points ----
// The stored attributes become the stored EXTRA normal points: the old new-hero baseline of 10 moved into the hero's
// base numbers, so a hero keeps only what was added on top (debug points). Training levels are the core points with
// no shape change, and level points are derived from the hero level, so existing heroes get them at once.
// Frozen literals: the old baseline and the four attribute keys.

const V16_OLD_BASELINE = 10;
const V16_ATTRIBUTE_KEYS = ['strength', 'dexterity', 'endurance', 'intelligence'] as const;

/** character.attributes[k] = max(0, old − 10) (a missing or broken value counts as 0). Everything else is kept. */
function migrateV15toV16(doc: SaveDoc): SaveDoc {
  const character = isDoc(doc.character) ? doc.character : null;
  if (!character || !isDoc(character.attributes)) return { ...doc, saveVersion: 16 };
  const old = character.attributes;
  const attributes: Doc = { ...old };
  for (const k of V16_ATTRIBUTE_KEYS) {
    const v = old[k];
    attributes[k] = typeof v === 'number' && Number.isSafeInteger(v) ? Math.max(0, v - V16_OLD_BASELINE) : 0;
  }
  return { ...doc, saveVersion: 16, character: { ...character, attributes } };
}

// ---- v16 → v17 (2026-11-03): spendable level-up points, current mana ----
// A deliberate reset: 1.16.0 gave 20 points per level above 1 (+5 on each of the 4 attributes, derived, never stored);
// 1.17.0 gives 5 CHOSEN points per level, so a hero gets 5 × (level − 1) unspent points to spend himself and ends up with
// fewer total points than in 1.16.0 (owner decision 2026-11-03). Stored extra points (debug) and training levels
// are kept as they are. Mana becomes a stored pool and starts full. Frozen literals: the points per level and the 1.16.0
// max mana formula (20 + 5 per level above 1).

const V17_UNSPENT_PER_LEVEL = 5;
const V17_MAX_MANA_BASE = 20;
const V17_MAX_MANA_PER_LEVEL = 5;
const V17_ATTRIBUTE_KEYS = ['strength', 'dexterity', 'endurance', 'intelligence'] as const;

/**
 * character.unspentPoints = 5 × (level − 1), character.spentPoints = 0 everywhere, character.mana = max mana (full),
 * character.manaRegenProgress = 0. A missing or broken level counts as 1. Everything else is kept.
 */
function migrateV16toV17(doc: SaveDoc): SaveDoc {
  const character = isDoc(doc.character) ? doc.character : null;
  if (!character) return { ...doc, saveVersion: 17 };
  const level = typeof character.level === 'number' && Number.isSafeInteger(character.level) && character.level >= 1 ? character.level : 1;
  const spentPoints: Doc = {};
  for (const k of V17_ATTRIBUTE_KEYS) spentPoints[k] = 0;
  return {
    ...doc,
    saveVersion: 17,
    character: {
      ...character,
      spentPoints,
      unspentPoints: V17_UNSPENT_PER_LEVEL * (level - 1),
      mana: V17_MAX_MANA_BASE + V17_MAX_MANA_PER_LEVEL * (level - 1),
      manaRegenProgress: 0,
    },
  };
}

// ---- v17 → v18 (2026-11-05): the locked start; Storage becomes a building ----
// A new game now starts with every building unbuilt (the Merchant and Storage included), but nothing an existing hero has
// is taken away: the Merchant stays built with its level, stock, charges and timers exactly as they are (grandfathered),
// and Storage, which never had a function, is added unbuilt. Gold is not touched. Frozen literal: the unbuilt state.

const V18_STORAGE_LOCKED = { state: 'locked', level: 0 } as const;

/** buildings.storage = locked (level 0) unless the save somehow has one already. Everything else is kept as it is. */
function migrateV17toV18(doc: SaveDoc): SaveDoc {
  const buildings = isDoc(doc.buildings) ? doc.buildings : {};
  return { ...doc, saveVersion: 18, buildings: { ...buildings, storage: isDoc(buildings.storage) ? buildings.storage : { ...V18_STORAGE_LOCKED } } };
}

// ---- v18 → v19 (2026-11-04): stats rework (armor, magic, crits, fractional regen) ----
// 1. Regen is exact at 0.2 per point: the banked regen of HP and mana moves to the finer unit (hundredths of a point per
//    minute), so every stored remainder is multiplied by 100 (6 000 000 units per point instead of 60 000): the same fraction of a point.
// 2. A fight in progress keeps its frozen numbers, renamed and widened: `defense` becomes `armor`; the hero gets no magic
//    (0 damage, 0 resist) and no crits (0 chance, 1.5x), the enemy its magic resist (equal to its armor, a frozen table).
//    The next hero strikes follow the 1.19.0 rules (one crit draw per strike).
// 3. Every logged strike (the fight in progress and the last fight) gets `crit: false`, `physical` = the damage dealt and
//    `magic: 0`, which is exactly what a 1.18.0 strike was.
// Frozen literals: the scale, the enemy table, the hero's neutral crit multiplier (base 15 000 bp) and the enemy's 10 000 bp.

const V19_REGEN_SCALE = 100;
const V19_HERO_CRIT_MULT_BP = 15_000;
const V19_ENEMY_CRIT_MULT_BP = 10_000;
const V19_ENEMY_MAGIC_RESIST: Readonly<Record<string, number>> = { rat: 2, bat: 6, wolf: 12, skeleton: 20, troll: 30 };

const v19Number = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function migrateV19Side(side: unknown, hero: boolean, enemyId: unknown): unknown {
  if (!isDoc(side)) return side;
  const { defense, ...rest } = side;
  const armor = v19Number(defense);
  const magicResist = hero ? 0 : typeof enemyId === 'string' && enemyId in V19_ENEMY_MAGIC_RESIST ? V19_ENEMY_MAGIC_RESIST[enemyId] : armor;
  return {
    ...rest,
    armor,
    magicDamage: 0,
    magicResist,
    critChanceBp: 0,
    critMultBp: hero ? V19_HERO_CRIT_MULT_BP : V19_ENEMY_CRIT_MULT_BP,
  };
}

function migrateV19Log(log: unknown): unknown {
  if (!Array.isArray(log)) return log;
  return log.map((e) => (isDoc(e) ? { ...e, crit: false, physical: v19Number(e.dealt), magic: 0 } : e));
}

function migrateV19Fight(fight: unknown): unknown {
  if (!isDoc(fight)) return fight;
  return {
    ...fight,
    hero: migrateV19Side(fight.hero, true, fight.enemyId),
    enemy: migrateV19Side(fight.enemy, false, fight.enemyId),
    log: migrateV19Log(fight.log),
  };
}

/** Regen remainders ×100, the fight in progress and the last fight widened. Everything else is kept. Pure. */
function migrateV18toV19(doc: SaveDoc): SaveDoc {
  const out: SaveDoc = { ...doc, saveVersion: 19 };
  if (isDoc(doc.character)) {
    out.character = {
      ...doc.character,
      hpRegenProgress: v19Number(doc.character.hpRegenProgress) * V19_REGEN_SCALE,
      manaRegenProgress: v19Number(doc.character.manaRegenProgress) * V19_REGEN_SCALE,
    };
  }
  if (isDoc(doc.activity) && doc.activity.kind === 'dungeon' && doc.activity.fight) {
    out.activity = { ...doc.activity, fight: migrateV19Fight(doc.activity.fight) };
  }
  if (isDoc(doc.dungeon) && isDoc(doc.dungeon.lastFight)) {
    out.dungeon = { ...doc.dungeon, lastFight: { ...doc.dungeon.lastFight, log: migrateV19Log(doc.dungeon.lastFight.log) } };
  }
  return out;
}

// ---- v19 → v20 (2026-11-05): the first boss ----
// 1. dungeon.bosses (the boss kill counters) starts empty.
// 2. A fight in progress is a stage dungeon fight (a boss fight cannot exist yet) and gets the new fields at their "nothing special"
//    values: the 60 s limit it started under (frozen literal), no enemy regen, no skills on either side, no stun. Its next strikes
//    draw exactly as before: a fight with no skills and no regen has the same RNG stream as in 1.19.0.
// Logged strikes need nothing: the new log fields (skill, stun, stunned, enemyHpAfter) only exist when they apply.

const V20_MAX_FIGHT_MS = 60_000;

function migrateV20Side(side: unknown): unknown {
  return isDoc(side) ? { ...side, skills: [] } : side;
}

function migrateV20Fight(fight: unknown): unknown {
  if (!isDoc(fight)) return fight;
  return {
    ...fight,
    hero: migrateV20Side(fight.hero),
    enemy: migrateV20Side(fight.enemy),
    maxFightMs: V20_MAX_FIGHT_MS,
    enemyRegenBp: 0,
    enemyRegenProgress: 0,
    enemyRegenAtMs: v19Number(fight.elapsedMs),
    enemySkillReady: {},
    heroStunStrikes: 0,
  };
}

/** Boss counters added, the fight in progress widened. Everything else is kept. Pure. */
function migrateV19toV20(doc: SaveDoc): SaveDoc {
  const out: SaveDoc = { ...doc, saveVersion: 20 };
  if (isDoc(doc.dungeon)) out.dungeon = { ...doc.dungeon, bosses: isDoc(doc.dungeon.bosses) ? doc.dungeon.bosses : {} };
  if (isDoc(doc.activity) && doc.activity.kind === 'dungeon' && doc.activity.fight) {
    out.activity = { ...doc.activity, fight: migrateV20Fight(doc.activity.fight) };
  }
  return out;
}

// ---- v20 → v21 (2026-11-05): gear affixes ----
// Every existing RARE (blue) or EPIC (purple) gear instance gets the affixes it would have rolled: rare 1 attribute, epic 2 different
// attributes + 1 perk (a tool's perk is fixed by its type). Common and uncommon gear get none. Only the PICKS are stored (the values
// come from quality, rarity and the catalog gear level), so this step needs nothing from the catalog but the slot of a Merchant listing.
//
// Deterministic, and the main RNG (`rng`) is not touched: one salted stream seeded from rng.seed XOR V21_SALT, drawn in a fixed
// order: equipped pieces (V21_SLOTS order), inventory (stored order), Merchant stock (stored order), then crafting jobs whose rolled
// result exists (pipe order; a gear job holds one from START_CRAFT on, running or ready). A piece that already has affixes is kept.
// Frozen literals and a private copy of mulberry32 on purpose: this migration must give the same result forever.

const V21_SALT = 0x2f6c1d4b;
const V21_ATTRIBUTES = ['strength', 'dexterity', 'endurance', 'intelligence'] as const;
const V21_COMBAT_PERKS = ['max_damage', 'max_armor', 'hp_regen', 'mana_regen'] as const;
const V21_SLOTS = ['helmet', 'amulet', 'armor', 'legs', 'weapon', 'shield', 'gloves', 'ring1', 'ring2', 'boots', 'axe', 'pickaxe'] as const;

/** mulberry32, one draw: the uniform float in [0, 1) and the next seed. A frozen copy of src/engine/rng.ts nextFloat. */
function v21Next(seed: number): [number, number] {
  const a = (seed + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

/** The slot a gear item or listing is for: its own `slot`, else read from its defId (`..._pickaxe` / `..._axe`; the rest never matters). */
function v21Slot(x: Doc): string | null {
  if (typeof x.slot === 'string') return x.slot;
  const id = typeof x.defId === 'string' ? x.defId : '';
  if (id.endsWith('_pickaxe')) return 'pickaxe';
  if (id.endsWith('_axe')) return 'axe';
  return null;
}

function migrateV20toV21(doc: SaveDoc): SaveDoc {
  const out: SaveDoc = { ...doc, saveVersion: 21 };
  const rng = isDoc(doc.rng) ? doc.rng.seed : undefined;
  let seed = (((typeof rng === 'number' && Number.isFinite(rng) ? rng : 0) >>> 0) ^ V21_SALT) >>> 0;

  /** The affixes a rare / epic piece in `slot` rolls (consuming draws), or null for any other rarity. */
  const roll = (rarity: unknown, slot: string | null): { attributes: string[]; perk?: string } | null => {
    if (rarity !== 'rare' && rarity !== 'epic') return null;
    const pool: string[] = [...V21_ATTRIBUTES];
    const attributes: string[] = [];
    for (let n = 0; n < (rarity === 'epic' ? 2 : 1); n += 1) {
      const [f, next] = v21Next(seed);
      seed = next;
      attributes.push(pool.splice(Math.floor(f * pool.length), 1)[0]);
    }
    if (rarity === 'rare') return { attributes };
    if (slot === 'axe') return { attributes, perk: 'woodcutting_strength' };
    if (slot === 'pickaxe') return { attributes, perk: 'mining_strength' };
    const [f, next] = v21Next(seed);
    seed = next;
    return { attributes, perk: V21_COMBAT_PERKS[Math.floor(f * V21_COMBAT_PERKS.length)] };
  };

  /** `x` with its affixes when it is a rare / epic piece that has none yet; anything else unchanged. */
  const withAffixes = (x: unknown): unknown => {
    if (!isDoc(x) || x.affixes !== undefined) return x;
    const affixes = roll(x.rarity, v21Slot(x));
    return affixes ? { ...x, affixes } : x;
  };

  if (isDoc(doc.character) && isDoc(doc.character.equipment)) {
    const equipment: Doc = { ...doc.character.equipment };
    // Slots in the frozen order first, then any other key (none exists) in stored order.
    for (const slot of [...V21_SLOTS, ...Object.keys(equipment).filter((k) => !(V21_SLOTS as readonly string[]).includes(k))]) {
      if (equipment[slot] !== undefined) equipment[slot] = withAffixes(equipment[slot]);
    }
    out.character = { ...doc.character, equipment };
  }
  if (isDoc(doc.inventory) && Array.isArray(doc.inventory.items)) {
    out.inventory = { ...doc.inventory, items: doc.inventory.items.map(withAffixes) };
  }
  if (isDoc(doc.merchant) && Array.isArray(doc.merchant.stock)) {
    out.merchant = { ...doc.merchant, stock: doc.merchant.stock.map(withAffixes) };
  }
  if (isDoc(doc.crafting) && Array.isArray(doc.crafting.pipes)) {
    const pipes = doc.crafting.pipes.map((job) => {
      if (!isDoc(job) || !isDoc(job.gear) || job.gear.affixes !== undefined) return job;
      const id = typeof job.recipeId === 'string' ? job.recipeId : '';
      const affixes = roll(job.gear.rarity, id.endsWith('_pickaxe') ? 'pickaxe' : id.endsWith('_axe') ? 'axe' : null);
      return affixes ? { ...job, gear: { ...job.gear, affixes } } : job;
    });
    out.crafting = { ...doc.crafting, pipes };
  }
  return out;
}

// ---- v21 → v22 (2026-11-06): difficulties and packs ----
// Existing counters, boss kills and runs become NORMAL: `byDungeon` / `bosses` stay where they are (they are the Normal counters now), the
// Hard and Extreme counters start empty (`harder`), and the selected difficulty is Normal for tier 1 (`difficulty` = {"1": "normal"}).
// A dungeon or boss activity gets `difficulty: 'normal'`. A fight in progress becomes a pack of ONE plain Normal mob that plays on
// exactly as before: the flat enemy fields (HP, max HP, side, strikes, regen, skill readiness) move into `mobs[0]` unchanged
// (`variant` 'base', `multBp` 10 000). The last fight gets `difficulty` 'normal' and `mobs` = its one plain mob. Log entries need nothing
// (`mob` is optional and absent means mob 0). Frozen literals on purpose (the tier list, the basis points).

function migrateV22Fight(fight: unknown): unknown {
  if (!isDoc(fight) || Array.isArray(fight.mobs)) return fight;
  const {
    enemyHp,
    enemyMaxHp,
    enemy,
    enemyStrikes,
    enemyRegenBp,
    enemyRegenProgress,
    enemyRegenAtMs,
    enemySkillReady,
    ...rest
  } = fight;
  return {
    ...rest,
    mobs: [
      {
        variant: 'base',
        multBp: 10000,
        hp: enemyHp,
        maxHp: enemyMaxHp,
        side: enemy,
        strikes: enemyStrikes,
        regenBp: enemyRegenBp ?? 0,
        regenProgress: enemyRegenProgress ?? 0,
        regenAtMs: enemyRegenAtMs ?? 0,
        skillReady: isDoc(enemySkillReady) ? enemySkillReady : {},
      },
    ],
  };
}

function migrateV21toV22(doc: SaveDoc): SaveDoc {
  const out: SaveDoc = { ...doc, saveVersion: 22 };
  if (isDoc(doc.dungeon)) {
    const d = doc.dungeon;
    const dungeon: Doc = {
      ...d,
      harder: isDoc(d.harder) ? d.harder : { hard: { byDungeon: {}, bosses: {} }, extreme: { byDungeon: {}, bosses: {} } },
      difficulty: isDoc(d.difficulty) ? d.difficulty : { '1': 'normal' },
    };
    if (isDoc(d.lastFight) && !Array.isArray(d.lastFight.mobs)) {
      const f = d.lastFight;
      dungeon.lastFight = { ...f, difficulty: 'normal', mobs: [{ variant: 'base', multBp: 10000, maxHp: f.enemyMaxHp, hpEnd: f.enemyHpEnd }] };
    }
    out.dungeon = dungeon;
  }
  const a = doc.activity;
  if (isDoc(a) && (a.kind === 'dungeon' || a.kind === 'boss')) {
    out.activity = { ...a, difficulty: typeof a.difficulty === 'string' ? a.difficulty : 'normal', ...(a.fight ? { fight: migrateV22Fight(a.fight) } : {}) };
  }
  return out;
}

// ---- v22 → v23 (2026-11-06): the fight's opening ----
// Fights now open with the hero's strike at 0 and the monsters' at 300 ms (engine 1.25.0), stored on the fight as `heroFirstStrikeMs` /
// `enemyFirstStrikeMs`. Strike n of a side lands at firstStrikeMs + (n - 1) x its interval. A fight IN PROGRESS when the update lands must
// finish on the old timing (first strike one interval in), so it is stamped with first strike = the side's own interval (the hero's frozen
// interval; the mobs' frozen interval: a fight's mobs are all one enemy type, so they share it). The last finished fight records the
// opening it was fought with, read from its own log: the time of the first hero entry and of the first enemy entry (what the old rule
// produced: one interval in); with no entry of a side (a fight that ended before it could strike, or at 0 HP) the old default 1000 ms.
// Frozen literal on purpose.

const V23_OLD_OPENING_MS = 1000;

const intervalOf = (side: unknown): number =>
  isDoc(side) && typeof side.attackIntervalMs === 'number' && Number.isFinite(side.attackIntervalMs) ? Math.max(1, Math.floor(side.attackIntervalMs)) : V23_OLD_OPENING_MS;

function migrateV23Fight(fight: unknown): unknown {
  if (!isDoc(fight) || typeof fight.heroFirstStrikeMs === 'number') return fight;
  const mobs = Array.isArray(fight.mobs) ? fight.mobs : [];
  return { ...fight, heroFirstStrikeMs: intervalOf(fight.hero), enemyFirstStrikeMs: intervalOf(isDoc(mobs[0]) ? mobs[0].side : undefined) };
}

function firstEntryMs(log: unknown, actor: 'hero' | 'enemy'): number {
  if (!Array.isArray(log)) return V23_OLD_OPENING_MS;
  const e = log.find((x) => isDoc(x) && x.actor === actor);
  return isDoc(e) && typeof e.atMs === 'number' && Number.isFinite(e.atMs) ? e.atMs : V23_OLD_OPENING_MS;
}

function migrateV22toV23(doc: SaveDoc): SaveDoc {
  const out: SaveDoc = { ...doc, saveVersion: 23 };
  if (isDoc(doc.dungeon) && isDoc(doc.dungeon.lastFight) && typeof doc.dungeon.lastFight.heroFirstStrikeMs !== 'number') {
    const f = doc.dungeon.lastFight;
    out.dungeon = { ...doc.dungeon, lastFight: { ...f, heroFirstStrikeMs: firstEntryMs(f.log, 'hero'), enemyFirstStrikeMs: firstEntryMs(f.log, 'enemy') } };
  }
  const a = doc.activity;
  if (isDoc(a) && (a.kind === 'dungeon' || a.kind === 'boss') && a.fight) out.activity = { ...a, fight: migrateV23Fight(a.fight) };
  return out;
}

// ---- v23 → v24 (2026-11-06): the Potion Belt ----
// The belt becomes an accessory (slot `accessory`) whose item instance holds 4 belt slots, and potion cooldowns are stored by type. Nothing an
// existing hero has changes except: `potionCooldowns = {}` (no cooldown running), and every Potion Belt instance (1.26.0 dropped them with
// no mechanics: in the bag; nothing else can hold one) gets `slot: 'accessory'` and four EMPTY belt slots. The equipment keeps no accessory
// (the Partial map has no entry for an empty slot). Frozen literals on purpose: the item id and the 4 slots.

const V24_BELT_DEF_ID = 'potion_belt';
const V24_BELT_SLOTS = 4;

function withBeltSlots(item: unknown): unknown {
  if (!isDoc(item) || item.defId !== V24_BELT_DEF_ID || Array.isArray(item.belt)) return item;
  return { ...item, slot: 'accessory', belt: Array.from({ length: V24_BELT_SLOTS }, () => null) };
}

function migrateV23toV24(doc: SaveDoc): SaveDoc {
  const out: SaveDoc = { ...doc, saveVersion: 24, potionCooldowns: isDoc(doc.potionCooldowns) ? doc.potionCooldowns : {} };
  if (isDoc(doc.inventory) && Array.isArray(doc.inventory.items)) out.inventory = { ...doc.inventory, items: doc.inventory.items.map(withBeltSlots) };
  return out;
}

// ---- v24 → v25 (2026-11-07): the bag is a grid with gaps ----
// Every inventory item gets `cell` = its position in the list (0, 1, 2, ...), so the bag looks exactly as it did, packed from the top-left,
// with the free cells at the end (a v24 document has no cells, so none is overwritten). An item past the capacity (a damaged document) gets
// none; the engine places it in the first free cell on the next change and never drops it. Nothing else changes, so every outcome is the
// 1.27.0 one. Frozen literal on purpose: the capacity default 20 when a document has none.

const V25_DEFAULT_CAPACITY = 20;

function migrateV24toV25(doc: SaveDoc): SaveDoc {
  const out: SaveDoc = { ...doc, saveVersion: 25 };
  const inv = doc.inventory;
  if (!isDoc(inv) || !Array.isArray(inv.items)) return out;
  const capacity = typeof inv.capacity === 'number' && Number.isInteger(inv.capacity) && inv.capacity >= 0 ? inv.capacity : V25_DEFAULT_CAPACITY;
  out.inventory = { ...inv, items: inv.items.map((it, index) => (isDoc(it) && index < capacity ? { ...it, cell: index } : it)) };
  return out;
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
