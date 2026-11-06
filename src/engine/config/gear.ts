// Gear (data): item quality and rarity, the stat scaling, the rarity stat and price multipliers, the random affixes
// (attribute bonuses, perks), the Merchant's and crafting's rolls, and the gear sets the Crafting house makes. Rules in src/engine/gear.ts; tables in docs/ENGINE.md ("Gear:
// quality and rarity") and docs/PRODUCT.md. Owner-approved 2026-11-01 (engine 1.14.0, save v14).
//
//   gear     = every equippable item (all slots, tools included); every instance carries `rarity` and `quality`
//   quality  = an integer percent 0..100 (a d101 roll: both ends included)
//   stat     = max(1, round(catalog max × (100 + quality) × rarity stat pct / 20 000)), half up, one rounding (1.22.0); damage min and max both scale
//   affixes  = rare: 1 random attribute, epic: 2 different attributes + 1 perk (1.22.0); values from quality and the item's gear level
//   price    = floor(catalog price × rarity multiplier); quality does not change prices; the Town Hall sell bonus after it
//   catalog gear stats are the 100% maxima; quality 25 gives the pre-1.14.0 numbers of every item
import type { AttributeKey, EquipmentSlot, GearPerkKind, ItemRarity } from '../types';

const MIN_MS = 60 * 1000;

export type RarityWeight = { value: ItemRarity; weight: number };

export const GEAR = {
  /** Quality is an integer percent: 0..maxQuality. */
  maxQuality: 100,
  /** Every gear instance from before 1.14.0, a new hero's starting gear and a new save's starter stock. */
  defaultQuality: 25,
  defaultRarity: 'common' as ItemRarity,
  /** Effective stat = max(minStat, round(max × (statBase + quality) × rarityStatPct ÷ (statDivisor × 100))), half up, one rounding. */
  statBase: 100,
  statDivisor: 200,
  minStat: 1,
  /**
   * The rarity multiplier on the MAIN stat (damage min / max, armor, woodcutting / mining strength), percent (1.22.0, owner-approved
   * 2026-11-05): common ×1, uncommon ×1.1, rare ×1.25, epic ×1.5. `junk` and `legendary` are unused (×1). The attack interval is never scaled.
   */
  rarityStatPct: { junk: 100, common: 100, uncommon: 110, rare: 125, epic: 150, legendary: 100 } as Record<ItemRarity, number>,
  /**
   * Gear buy and sell prices = floor(catalog price × multiplier ÷ 100), by the instance's (or listing's) rarity.
   * `legendary` is unused for now (×1); junk gear does not exist (×1).
   */
  rarityPricePct: { junk: 100, common: 100, uncommon: 150, rare: 200, epic: 400, legendary: 100 } as Record<ItemRarity, number>,
  merchant: {
    /** Gear listings: quality a uniform integer in 0..maxQuality. */
    maxQuality: 50,
    /** Never epic or above. */
    rarityWeights: [
      { value: 'common', weight: 70 },
      { value: 'uncommon', weight: 25 },
      { value: 'rare', weight: 5 },
    ] as readonly RarityWeight[],
    /**
     * The gear rolls of a restock draw from their own stream, seeded from the main RNG after the stock was picked
     * XOR this salt: the main stream (drops, yields, combat) is not advanced by them.
     */
    rollSalt: 0x5bd1e995,
    /**
     * The gear listings' affixes (1.22.0) draw from a second salted stream (seed = the main RNG after the stock was picked XOR this
     * salt), apart from the quality / rarity stream above so those rolls are exactly what they were; the main stream is not advanced.
     */
    affixSalt: 0x7a3c91e5,
  },
  /**
   * Mob-dropped gear (the Troll Chieftain's): quality a uniform integer in 0..maxQuality. `affixSalt` seeds the drop's affix
   * stream (the main RNG after the rarity and quality draws XOR this), so the main stream is not advanced by affixes.
   */
  drops: { maxQuality: 70, affixSalt: 0x3d8f6b27 },
  /**
   * Random affixes (1.22.0, owner-approved 2026-11-05). Only rare and epic pieces have them; the values are not stored (src/engine/gear.ts
   * computes them from quality, rarity and the catalog `gearLevel`).
   *
   *   attribute bonus  = max(1, floor(max × quality ÷ 100)), max = floor(gearLevel × maxPct ÷ 100); plain points, never core
   *   perk (epic only) = max(1, floor(gearLevel × quality ÷ 100)) percent; one per piece
   */
  affixes: {
    /** Attribute bonuses by rarity: how many different attributes (uniform among the four) and the max as a percent of the gear level. */
    attributes: { rare: { count: 1, maxPct: 100 }, epic: { count: 2, maxPct: 150 } } as Partial<Record<ItemRarity, { count: number; maxPct: number }>>,
    /** The attributes a bonus can be on (uniform odds). */
    attributePool: ['strength', 'dexterity', 'endurance', 'intelligence'] as readonly AttributeKey[],
    minValue: 1,
    perk: {
      /** Only these rarities roll a perk. */
      rarities: ['epic'] as readonly ItemRarity[],
      /** The perk's max percent as a percent of the gear level (100 = gearLevel %). */
      maxPct: 100,
      /** Combat gear (everything but the tools): one of these, equal odds. */
      combatKinds: ['max_damage', 'max_armor', 'hp_regen', 'mana_regen'] as readonly GearPerkKind[],
      /** Tools: fixed by the tool type (the slot). */
      toolKinds: { axe: 'woodcutting_strength', pickaxe: 'mining_strength' } as Partial<Record<EquipmentSlot, GearPerkKind>>,
    },
  },
  craft: {
    /** Stamina a gear job can invest at start (0..maxStamina), paid up front and never refunded. */
    maxStamina: 50,
    /** Each invested stamina point raises the quality floor by this much (percent points). */
    qualityPerStamina: 1,
    /** A flat floor every gear craft gets (hook for later upgrades; 0 for now). The floor is capped at 100. */
    minQuality: 0,
    /** Default rarity odds of a crafted piece (a recipe can override them). */
    rarityWeights: [
      { value: 'uncommon', weight: 75 },
      { value: 'rare', weight: 20 },
      { value: 'epic', weight: 5 },
    ] as readonly RarityWeight[],
    /**
     * The piece's affixes (1.22.0) draw from their own stream, seeded from the main RNG after the quality and rarity draws XOR this salt,
     * so the main stream is exactly what it was (two draws per gear job).
     */
    affixSalt: 0x1c6e4a93,
    /** A crafted piece's catalog sell price = max(1, floor(this × the sell value of its inputs)). */
    sellRatioBp: 2500,
  },
} as const;

// ---------- crafted gear sets ----------

export type GearPieceId = 'sword' | 'helm' | 'chestplate' | 'shield' | 'greaves' | 'gloves' | 'boots' | 'axe' | 'pickaxe';
export type GearSetId = 'stone' | 'copper' | 'iron' | 'silver' | 'gold';

/** Tier n's set is made from tier n's processed materials. Ids are `<set>_<piece>` (T3 = the existing iron items). */
export const GEAR_SETS: readonly { id: GearSetId; name: string; tier: number; bar: string; plank: string }[] = [
  { id: 'stone', name: 'Stone', tier: 1, bar: 'stone_brick', plank: 'oak_plank' },
  { id: 'copper', name: 'Copper', tier: 2, bar: 'copper_ingot', plank: 'birch_plank' },
  { id: 'iron', name: 'Iron', tier: 3, bar: 'iron_ingot', plank: 'maple_plank' },
  { id: 'silver', name: 'Silver', tier: 4, bar: 'silver_ingot', plank: 'yew_plank' },
  { id: 'gold', name: 'Gold', tier: 5, bar: 'gold_ingot', plank: 'ironwood_plank' },
];

/**
 * Per piece: slot, icon, inputs (bricks / ingots, planks; the same at every tier), T1 craft time (doubles each tier)
 * and the max stats at 100% quality per tier (T1..T5). Owner-approved 2026-11-01.
 */
export const GEAR_PIECES: Record<
  GearPieceId,
  { name: string; slot: EquipmentSlot; icon: string; bars: number; planks: number; t1Ms: number; damage?: readonly (readonly [number, number])[]; armor?: readonly number[]; woodcuttingStrength?: readonly number[]; miningStrength?: readonly number[] }
> = {
  sword: { name: 'Sword', slot: 'weapon', icon: '⚔️', bars: 4, planks: 2, t1Ms: 5 * MIN_MS, damage: [[4, 6], [7, 10], [10, 14], [16, 22], [24, 34]] },
  helm: { name: 'Helm', slot: 'helmet', icon: '🪖', bars: 3, planks: 1, t1Ms: 4 * MIN_MS, armor: [2, 4, 6, 10, 15] },
  chestplate: { name: 'Chestplate', slot: 'armor', icon: '🦺', bars: 6, planks: 2, t1Ms: 8 * MIN_MS, armor: [3, 6, 10, 16, 24] },
  shield: { name: 'Shield', slot: 'shield', icon: '🛡️', bars: 3, planks: 3, t1Ms: 5 * MIN_MS, armor: [3, 5, 8, 13, 20] },
  greaves: { name: 'Greaves', slot: 'legs', icon: '🦿', bars: 4, planks: 2, t1Ms: 5 * MIN_MS, armor: [2, 5, 8, 13, 20] },
  gloves: { name: 'Gloves', slot: 'gloves', icon: '🧤', bars: 2, planks: 1, t1Ms: 2 * MIN_MS, armor: [1, 2, 3, 5, 8] },
  boots: { name: 'Boots', slot: 'boots', icon: '🥾', bars: 2, planks: 1, t1Ms: 2 * MIN_MS, armor: [1, 2, 3, 5, 8] },
  // Tools (1.21.0, owner-approved 2026-11-05): the Iron tier is the existing iron_axe / iron_pickaxe (same ids, prices and 64).
  axe: { name: 'Axe', slot: 'axe', icon: '🪓', bars: 3, planks: 2, t1Ms: 3 * MIN_MS, woodcuttingStrength: [8, 24, 64, 128, 256] },
  pickaxe: { name: 'Pickaxe', slot: 'pickaxe', icon: '⛏️', bars: 3, planks: 2, t1Ms: 3 * MIN_MS, miningStrength: [8, 24, 64, 128, 256] },
};

/** Picker order inside a tier. */
export const GEAR_PIECE_IDS: readonly GearPieceId[] = ['sword', 'helm', 'chestplate', 'shield', 'greaves', 'gloves', 'boots', 'axe', 'pickaxe'];
