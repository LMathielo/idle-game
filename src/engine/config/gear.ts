// Gear (data): item quality and rarity, the stat and price scaling, the Merchant's and crafting's rolls, and the gear
// sets the Crafting house makes. Rules in src/engine/gear.ts; tables in docs/ENGINE.md ("Gear: quality and rarity")
// and docs/PRODUCT.md. Owner-approved 2026-11-01 (engine 1.14.0, save v14).
//
//   gear     = every equippable item (all slots, tools included); every instance carries `rarity` and `qualityBp`
//   stat     = max(1, round(catalog max × (5000 + qualityBp / 2) / 10 000)), half up; damage min and max both scale
//   price    = floor(catalog price × (8000 + 8000 × qualityBp / 10 000) / 10 000); the Town Hall sell bonus after it
//   catalog gear stats are the 100% maxima; 25% (2500 bp) gives the pre-1.14.0 numbers of every item
import type { EquipmentSlot, ItemRarity } from '../types';

const MIN_MS = 60 * 1000;

export type RarityWeight = { value: ItemRarity; weight: number };

export const GEAR = {
  /** Quality is integer basis points: 0..maxQualityBp (100%). */
  maxQualityBp: 10_000,
  /** Every gear instance from before 1.14.0, a new hero's starting gear and a new save's starter stock. */
  defaultQualityBp: 2500,
  defaultRarity: 'common' as ItemRarity,
  /** Effective stat = max(minStat, round(max × (statBaseBp + qualityBp / statQualityDivisor) / 10 000)). */
  statBaseBp: 5000,
  statQualityDivisor: 2,
  minStat: 1,
  /** Price multiplier, bp = priceBaseBp + pricePerQualityBp × qualityBp / 10 000 (0.8× at 0%, 1.0× at 25%, 1.6× at 100%). */
  priceBaseBp: 8000,
  pricePerQualityBp: 8000,
  merchant: {
    /** Gear listings: qualityBp uniform in 0..maxQualityBp. */
    maxQualityBp: 5000,
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
  },
  /** Mob-dropped gear (not yet): qualityBp uniform in 0..maxQualityBp. Unused until gear drops exist. */
  drops: { maxQualityBp: 7000 },
  craft: {
    /** Stamina a gear job can invest at start (0..maxStamina), paid up front and never refunded. */
    maxStamina: 50,
    /** Each invested stamina point raises the quality floor by this much. */
    qualityBpPerStamina: 100,
    /** A flat floor every gear craft gets (hook for later upgrades; 0 for now). The floor is capped at 10 000. */
    minQualityBp: 0,
    /** Default rarity odds of a crafted piece (a recipe can override them). */
    rarityWeights: [
      { value: 'uncommon', weight: 75 },
      { value: 'rare', weight: 20 },
      { value: 'epic', weight: 5 },
    ] as readonly RarityWeight[],
    /** A crafted piece's catalog sell price = max(1, floor(this × the sell value of its inputs)). */
    sellRatioBp: 2500,
  },
} as const;

// ---------- crafted gear sets ----------

export type GearPieceId = 'sword' | 'helm' | 'chestplate' | 'shield' | 'gloves' | 'boots';
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
  { name: string; slot: EquipmentSlot; icon: string; bars: number; planks: number; t1Ms: number; damage?: readonly (readonly [number, number])[]; armor?: readonly number[] }
> = {
  sword: { name: 'Sword', slot: 'weapon', icon: '⚔️', bars: 4, planks: 2, t1Ms: 5 * MIN_MS, damage: [[4, 6], [7, 10], [10, 14], [16, 22], [24, 34]] },
  helm: { name: 'Helm', slot: 'helmet', icon: '🪖', bars: 3, planks: 1, t1Ms: 4 * MIN_MS, armor: [2, 4, 6, 10, 15] },
  chestplate: { name: 'Chestplate', slot: 'armor', icon: '🦺', bars: 6, planks: 2, t1Ms: 8 * MIN_MS, armor: [3, 6, 10, 16, 24] },
  shield: { name: 'Shield', slot: 'shield', icon: '🛡️', bars: 3, planks: 3, t1Ms: 5 * MIN_MS, armor: [3, 5, 8, 13, 20] },
  gloves: { name: 'Gloves', slot: 'gloves', icon: '🧤', bars: 2, planks: 1, t1Ms: 2 * MIN_MS, armor: [1, 2, 3, 5, 8] },
  boots: { name: 'Boots', slot: 'boots', icon: '🥾', bars: 2, planks: 1, t1Ms: 2 * MIN_MS, armor: [1, 2, 3, 5, 8] },
};

/** Picker order inside a tier. */
export const GEAR_PIECE_IDS: readonly GearPieceId[] = ['sword', 'helm', 'chestplate', 'shield', 'gloves', 'boots'];
