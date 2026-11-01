// Passive building bonuses (pure, read-only). Data per building level in config/buildings.ts; see docs/ENGINE.md
// ("Building bonuses"). Bonuses from different buildings add together:
//
//   yield multiplier  = 1 + Town Hall bonus + the skill's own building bonus        (basis points)
//   sell price        = floor(base sell price × (1 + sell bonus)); base = catalog sellPrice, × the rarity multiplier for gear
//   worker cap        = the Town Hall level's workerCap (0 before the Town Hall is built)
//   stock slots       = the Merchant level's stockSlots
//   training XP / min = the Training Grounds level's trainingXpPerMin (1 … 5)
import { BUILDING_IDS, BUILDINGS, type LevelBonuses } from './config/buildings';
import { getItemDef } from './config/items';
import { BASIS_POINTS } from './config/stats';
import { baseSellPrice } from './gear';
import type { BuildingId, GameState, GatheringKind, Item } from './types';

type Buildings = Pick<GameState, 'buildings'>;

const NONE: LevelBonuses = {};

/** A building's bonuses at its current level ({} while locked). */
export function levelBonuses(state: Buildings, buildingId: BuildingId): LevelBonuses {
  const b = state.buildings[buildingId];
  if (b?.state !== 'built') return NONE;
  return bonusesAt(buildingId, b.level);
}

/** A building's bonuses at `level` ({} outside 1..max). */
export function bonusesAt(buildingId: BuildingId, level: number): LevelBonuses {
  return (Number.isSafeInteger(level) && level >= 1 ? BUILDINGS[buildingId].levels[level - 1] : undefined) ?? NONE;
}

/** One building's share of a yield multiplier, for the UI. */
export type YieldBonusPart = { buildingId: BuildingId; bp: number };

/** Every building's yield bonus for a skill (non-zero parts only), in BUILDING_IDS order. */
export function yieldBonusParts(state: Buildings, kind: GatheringKind): YieldBonusPart[] {
  const out: YieldBonusPart[] = [];
  for (const id of BUILDING_IDS) {
    const bp = levelBonuses(state, id).yieldBp?.[kind] ?? 0;
    if (bp !== 0) out.push({ buildingId: id, bp });
  }
  return out;
}

/** Yield multiplier for a gathering skill, in basis points (10 000 = ×1). Applies to the hero and to workers. */
export function yieldMultiplierBp(state: Buildings, kind: GatheringKind): number {
  let bp = BASIS_POINTS;
  for (const p of yieldBonusParts(state, kind)) bp += p.bp;
  return Math.max(0, bp);
}

/** Sum of every building's merchant sell-price bonus, in basis points. */
export function sellPriceBonusBp(state: Buildings): number {
  let bp = 0;
  for (const id of BUILDING_IDS) bp += levelBonuses(state, id).sellPriceBp ?? 0;
  return bp;
}

const withSellBonus = (state: Buildings, base: number) =>
  base > 0 ? Math.floor((base * Math.max(0, BASIS_POINTS + sellPriceBonusBp(state))) / BASIS_POINTS) : 0;

/**
 * What the merchant pays per unit of a non-gear `defId` right now: floor(catalog sellPrice × (1 + bonus)). 0 when it
 * buys none. Gear depends on the instance's rarity: use sellPriceOfItem.
 */
export function sellPriceOf(state: Buildings, defId: string): number {
  return withSellBonus(state, getItemDef(defId)?.sellPrice ?? 0);
}

/** What the merchant pays per unit of this instance right now: its base (gear: × the rarity multiplier) × (1 + bonus), floored. */
export function sellPriceOfItem(state: Buildings, item: Pick<Item, 'defId' | 'rarity'>): number {
  return withSellBonus(state, baseSellPrice(item));
}

/** Most workers the player may have (Town Hall level; 0 while it is locked). */
export function workerCap(state: Buildings): number {
  return levelBonuses(state, 'town_hall').workerCap ?? 0;
}

/** Merchant stock slots per refresh at its current level. */
export function merchantStockSlots(state: Buildings): number {
  return levelBonuses(state, 'merchant').stockSlots ?? BUILDINGS.merchant.levels[0].stockSlots ?? 0;
}

/**
 * Training XP per trained minute from the Training Grounds' level (Lv1 = 1 … Lv5 = 5). Read at the moment the XP is
 * credited, so an upgrade that completes mid-training counts from that instant (the world walk splits at it). The
 * Lv1 value applies when the building gives none (training needs it built anyway).
 */
export function trainingXpPerMinute(state: Buildings): number {
  return levelBonuses(state, 'training_grounds').trainingXpPerMin ?? BUILDINGS.training_grounds.levels[0].trainingXpPerMin ?? 1;
}
