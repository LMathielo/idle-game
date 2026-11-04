// Gear quality and rarity (pure). Data in config/gear.ts; see docs/ENGINE.md ("Gear: quality and rarity").
//
//   gear       = an item whose catalog entry has a slot (weapons, armor, tools); its instance carries rarity + quality
//   quality    = integer percent 0..100
//   stat       = max(1, round(catalog max × (100 + quality) / 200)), half up, integer math
//   price      = floor(catalog price × rarity multiplier ÷ 100); quality does not change prices; the sell bonus after it
//   rarity     = the instance's own, else the catalog's
//
// Every reader of a gear stat or price goes through here: derived damage / defense, WS, MS (and so crews, tree and rock
// access), sell prices, popovers and equip deltas.
import { GEAR, type RarityWeight } from './config/gear';
import { getItemDef, type ItemDef } from './config/items';
import { nextInt, weightedPick } from './rng';
import type { GearRoll, Item, ItemRarity, RngState } from './types';

/** Gear = every equippable item (all slots, tools included). */
export function isGearDef(def: ItemDef | undefined): boolean {
  return def?.slot !== undefined;
}

export function isGear(defId: string): boolean {
  return isGearDef(getItemDef(defId));
}

const clampQuality = (q: number) => (Number.isSafeInteger(q) ? Math.min(GEAR.maxQuality, Math.max(0, q)) : GEAR.defaultQuality);

/** An instance's quality, percent. Gear without one (never in a v14 save) counts as the default (25%). */
export function qualityOf(item: Pick<Item, 'quality'>): number {
  return item.quality === undefined ? GEAR.defaultQuality : clampQuality(item.quality);
}

/** An instance's rarity: its own (gear), else the catalog's. */
export function rarityOf(item: Pick<Item, 'defId' | 'rarity'>): ItemRarity {
  return item.rarity ?? getItemDef(item.defId)?.rarity ?? 'common';
}

/**
 * Effective gear stat = max(1, round(max × (100 + q) / 200)), half up, in integers:
 * floor((max × (100 + q) + 100) / 200).
 */
export function scaleGearStat(max: number, quality: number): number {
  const den = GEAR.statDivisor;
  const num = max * (GEAR.statBase + clampQuality(quality));
  return Math.max(GEAR.minStat, Math.floor((num + den / 2) / den));
}

/** The price multiplier of a rarity, percent (common 100, uncommon 150, rare 200, epic 400). */
export function rarityPricePct(rarity: ItemRarity): number {
  return GEAR.rarityPricePct[rarity] ?? 100;
}

/** A catalog price for a gear piece of `rarity`: floor(price × multiplier ÷ 100). Quality does not change prices. */
export function gearPrice(price: number, rarity: ItemRarity): number {
  return Math.floor((price * rarityPricePct(rarity)) / 100);
}

export type GearStats = {
  damage?: { min: number; max: number };
  armor?: number;
  woodcuttingStrength?: number;
  miningStrength?: number;
  /** Not scaled by quality. */
  attackIntervalModMs?: number;
};

/** The stats of a catalog entry at `quality` (non-gear items: none). */
export function gearStatsAt(def: ItemDef | undefined, quality: number): GearStats {
  if (!def || !isGearDef(def)) return {};
  const out: GearStats = {};
  if (def.damage) out.damage = { min: scaleGearStat(def.damage.min, quality), max: scaleGearStat(def.damage.max, quality) };
  if (def.armor !== undefined) out.armor = scaleGearStat(def.armor, quality);
  if (def.woodcuttingStrength !== undefined) out.woodcuttingStrength = scaleGearStat(def.woodcuttingStrength, quality);
  if (def.miningStrength !== undefined) out.miningStrength = scaleGearStat(def.miningStrength, quality);
  if (def.attackIntervalModMs !== undefined) out.attackIntervalModMs = def.attackIntervalModMs;
  return out;
}

/** The effective stats of an instance (its quality). */
export function gearStats(item: Pick<Item, 'defId' | 'quality'>): GearStats {
  return gearStatsAt(getItemDef(item.defId), qualityOf(item));
}

/**
 * What the merchant pays per unit of an instance before the Town Hall bonus: the catalog sellPrice, × the rarity
 * multiplier for gear.
 */
export function baseSellPrice(item: Pick<Item, 'defId' | 'rarity'>): number {
  const def = getItemDef(item.defId);
  if (!def) return 0;
  if (!isGearDef(def)) return def.sellPrice;
  return gearPrice(def.sellPrice, rarityOf(item));
}

/** The default roll: pre-1.14.0 gear, starting gear, the starter stock. */
export function defaultGearRoll(): GearRoll {
  return { quality: GEAR.defaultQuality, rarity: GEAR.defaultRarity };
}

/** One quality roll: a uniform integer in [floor, max], both ends included. One draw. */
export function rollQuality(rng: RngState, floor: number, max: number): { value: number; rng: RngState } {
  const lo = Math.min(GEAR.maxQuality, Math.max(0, Math.floor(floor)));
  const hi = Math.min(GEAR.maxQuality, Math.max(lo, Math.floor(max)));
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
