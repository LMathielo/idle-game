// Gear quality and rarity (pure). Data in config/gear.ts; see docs/ENGINE.md ("Gear: quality and rarity").
//
//   gear       = an item whose catalog entry has a slot (weapons, armor, tools); its instance carries rarity + qualityBp
//   stat       = max(1, round(catalog max × (5000 + qualityBp / 2) / 10 000)), half up, integer math
//   price      = floor(catalog price × (8000 + 8000 × qualityBp / 10 000) / 10 000); the sell bonus applies after it
//   rarity     = the instance's own, else the catalog's
//
// Every reader of a gear stat or price goes through here: derived damage / defense, WS, MS (and so crews, tree and rock
// access), sell prices, popovers and equip deltas.
import { GEAR, type RarityWeight } from './config/gear';
import { getItemDef, type ItemDef } from './config/items';
import { BASIS_POINTS } from './config/stats';
import { nextInt, weightedPick } from './rng';
import type { GearRoll, Item, ItemRarity, RngState } from './types';

/** Gear = every equippable item (all slots, tools included). */
export function isGearDef(def: ItemDef | undefined): boolean {
  return def?.slot !== undefined;
}

export function isGear(defId: string): boolean {
  return isGearDef(getItemDef(defId));
}

const clampQuality = (q: number) => (Number.isSafeInteger(q) ? Math.min(GEAR.maxQualityBp, Math.max(0, q)) : GEAR.defaultQualityBp);

/** An instance's quality, bp. Gear without one (never in a v14 save) counts as the default (25%). */
export function qualityBpOf(item: Pick<Item, 'qualityBp'>): number {
  return item.qualityBp === undefined ? GEAR.defaultQualityBp : clampQuality(item.qualityBp);
}

/** An instance's rarity: its own (gear), else the catalog's. */
export function rarityOf(item: Pick<Item, 'defId' | 'rarity'>): ItemRarity {
  return item.rarity ?? getItemDef(item.defId)?.rarity ?? 'common';
}

/**
 * Effective gear stat = max(1, round(max × (5000 + q / 2) / 10 000)), half up. Integer math: (5000 + q / 2) / 10 000 =
 * (10 000 + q) / 20 000, so the result is floor((max × (10 000 + q) + 10 000) / 20 000).
 */
export function scaleGearStat(max: number, qualityBp: number): number {
  const q = clampQuality(qualityBp);
  const den = BASIS_POINTS * GEAR.statQualityDivisor; // 20 000
  const num = max * (GEAR.statBaseBp * GEAR.statQualityDivisor + q); // max × (10 000 + q)
  return Math.max(GEAR.minStat, Math.floor((num + den / 2) / den));
}

/**
 * A catalog price at `qualityBp`: floor(price × (8000 + 8000 × q / 10 000) / 10 000), exact in integers:
 * floor(price × (8000 × 10 000 + 8000 × q) / 10 000²). Far below 2^53 for any catalog price.
 */
export function scaleGearPrice(price: number, qualityBp: number): number {
  const factor = GEAR.priceBaseBp * BASIS_POINTS + GEAR.pricePerQualityBp * clampQuality(qualityBp);
  return Math.floor((price * factor) / (BASIS_POINTS * BASIS_POINTS));
}

export type GearStats = {
  damage?: { min: number; max: number };
  armor?: number;
  woodcuttingStrength?: number;
  miningStrength?: number;
  /** Not scaled by quality. */
  attackIntervalModMs?: number;
};

/** The stats of a catalog entry at `qualityBp` (non-gear items: none). */
export function gearStatsAt(def: ItemDef | undefined, qualityBp: number): GearStats {
  if (!def || !isGearDef(def)) return {};
  const out: GearStats = {};
  if (def.damage) out.damage = { min: scaleGearStat(def.damage.min, qualityBp), max: scaleGearStat(def.damage.max, qualityBp) };
  if (def.armor !== undefined) out.armor = scaleGearStat(def.armor, qualityBp);
  if (def.woodcuttingStrength !== undefined) out.woodcuttingStrength = scaleGearStat(def.woodcuttingStrength, qualityBp);
  if (def.miningStrength !== undefined) out.miningStrength = scaleGearStat(def.miningStrength, qualityBp);
  if (def.attackIntervalModMs !== undefined) out.attackIntervalModMs = def.attackIntervalModMs;
  return out;
}

/** The effective stats of an instance (its quality). */
export function gearStats(item: Pick<Item, 'defId' | 'qualityBp'>): GearStats {
  return gearStatsAt(getItemDef(item.defId), qualityBpOf(item));
}

/**
 * What the merchant pays per unit of an instance before the Town Hall bonus: the catalog sellPrice, scaled by quality
 * for gear (at least 1 when the catalog price is, so a 0% piece still sells).
 */
export function baseSellPrice(item: Pick<Item, 'defId' | 'qualityBp'>): number {
  const def = getItemDef(item.defId);
  if (!def) return 0;
  if (!isGearDef(def) || !(def.sellPrice > 0)) return def.sellPrice;
  return Math.max(1, scaleGearPrice(def.sellPrice, qualityBpOf(item)));
}

/** The default roll: pre-1.14.0 gear, starting gear, the starter stock. */
export function defaultGearRoll(): GearRoll {
  return { qualityBp: GEAR.defaultQualityBp, rarity: GEAR.defaultRarity };
}

/** One quality roll: uniform integer in [floor, maxBp]. One draw. */
export function rollQualityBp(rng: RngState, floorBp: number, maxBp: number): { value: number; rng: RngState } {
  const lo = Math.min(GEAR.maxQualityBp, Math.max(0, Math.floor(floorBp)));
  const hi = Math.min(GEAR.maxQualityBp, Math.max(lo, Math.floor(maxBp)));
  return nextInt(rng, lo, hi);
}

/** One rarity roll from a weight table. One draw. */
export function rollRarity(rng: RngState, weights: readonly RarityWeight[]): { value: ItemRarity; rng: RngState } {
  return weightedPick(rng, weights);
}

/** Rarity odds as whole percents (for views), in table order. */
export function rarityOdds(weights: readonly RarityWeight[]): { rarity: ItemRarity; pct: number }[] {
  const total = weights.reduce((n, w) => n + Math.max(0, w.weight), 0);
  return weights.map((w) => ({ rarity: w.value, pct: total > 0 ? Math.round((Math.max(0, w.weight) * 100) / total) : 0 }));
}
