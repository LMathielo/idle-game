// Gear quality and rarity (pure). Data in config/gear.ts; see docs/ENGINE.md ("Gear: quality and rarity").
//
//   gear       = an item whose catalog entry has a slot (weapons, armor, tools); its instance carries rarity + quality
//   quality    = integer percent 0..100
//   stat       = max(1, round(catalog max × (100 + quality) × rarity stat pct ÷ 20 000)), half up, integer math, ONE rounding (1.22.0)
//   price      = floor(catalog price × rarity multiplier ÷ 100); quality does not change prices; the sell bonus after it
//   rarity     = the instance's own, else the catalog's
//   affixes    = rare: 1 attribute bonus; epic: 2 different attribute bonuses + 1 perk (1.22.0); picks stored on the instance, values computed here
//
// Every reader of a gear stat or price goes through here: derived damage / armor, WS, MS (and so crews, tree and rock
// access), sell prices, popovers and equip deltas.
import { GEAR, type RarityWeight } from './config/gear';
import { getItemDef, type ItemDef } from './config/items';
import { type Draw, nextInt, weightedPick } from './rng';
import {
  ATTRIBUTE_KEYS,
  type AttributeKey,
  type Attributes,
  EQUIPMENT_SLOTS,
  type EquipmentSlot,
  type GearAffixes,
  type GearPerkKind,
  type GearRoll,
  type Item,
  type ItemRarity,
  type RngState,
} from './types';

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

/** The main-stat multiplier of a rarity, percent (common 100, uncommon 110, rare 125, epic 150). */
export function rarityStatPct(rarity: ItemRarity): number {
  return GEAR.rarityStatPct[rarity] ?? 100;
}

/**
 * Effective gear stat = max(1, round(max × (100 + q) × ratioPct ÷ 20 000)), half up, ONE rounding, in integers:
 * floor((max × (100 + q) × ratioPct + 10 000) ÷ 20 000). `rarity` defaults to common (×1), the pre-1.22.0 formula.
 */
export function scaleGearStat(max: number, quality: number, rarity: ItemRarity = 'common'): number {
  const den = GEAR.statDivisor * 100;
  const num = max * (GEAR.statBase + clampQuality(quality)) * rarityStatPct(rarity);
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

/** The stats of a catalog entry at `quality` and `rarity` (default common; non-gear items: none). */
export function gearStatsAt(def: ItemDef | undefined, quality: number, rarity: ItemRarity = 'common'): GearStats {
  if (!def || !isGearDef(def)) return {};
  const out: GearStats = {};
  if (def.damage) out.damage = { min: scaleGearStat(def.damage.min, quality, rarity), max: scaleGearStat(def.damage.max, quality, rarity) };
  if (def.armor !== undefined) out.armor = scaleGearStat(def.armor, quality, rarity);
  if (def.woodcuttingStrength !== undefined) out.woodcuttingStrength = scaleGearStat(def.woodcuttingStrength, quality, rarity);
  if (def.miningStrength !== undefined) out.miningStrength = scaleGearStat(def.miningStrength, quality, rarity);
  if (def.attackIntervalModMs !== undefined) out.attackIntervalModMs = def.attackIntervalModMs;
  return out;
}

/** The effective stats of an instance (its quality and rarity). */
export function gearStats(item: Pick<Item, 'defId' | 'quality' | 'rarity'>): GearStats {
  return gearStatsAt(getItemDef(item.defId), qualityOf(item), rarityOf(item));
}

// ---------- affixes (1.22.0) ----------

/** A catalog entry's gear level (≥ 1); 1 for gear without one. Non-gear: 0. */
export function gearLevelOfDef(def: ItemDef | undefined): number {
  if (!def || !isGearDef(def)) return 0;
  return def.gearLevel !== undefined && Number.isSafeInteger(def.gearLevel) && def.gearLevel >= 1 ? def.gearLevel : 1;
}

/** An instance's gear level (its catalog entry's). */
export function gearLevelOf(item: Pick<Item, 'defId'>): number {
  return gearLevelOfDef(getItemDef(item.defId));
}

/** How many attribute bonuses a rarity rolls (rare 1, epic 2, else 0). */
export function affixAttributeCount(rarity: ItemRarity): number {
  return GEAR.affixes.attributes[rarity]?.count ?? 0;
}

/** The top of one attribute bonus: floor(gearLevel × maxPct ÷ 100) (rare: the gear level; epic: 1.5×, floored); 0 when the rarity has none. */
export function affixAttributeMax(gearLevel: number, rarity: ItemRarity): number {
  const rule = GEAR.affixes.attributes[rarity];
  return rule ? Math.floor((gearLevel * rule.maxPct) / 100) : 0;
}

/** The top of a perk, percent: floor(gearLevel × maxPct ÷ 100) (the gear level); 0 when the rarity has no perk. */
export function perkMax(gearLevel: number, rarity: ItemRarity): number {
  return (GEAR.affixes.perk.rarities as readonly ItemRarity[]).includes(rarity) ? Math.floor((gearLevel * GEAR.affixes.perk.maxPct) / 100) : 0;
}

/** An affix value at `quality`: max(1, floor(max × quality ÷ 100)). Quality 0 still gives the minimum, 100 the max. */
export function affixValue(max: number, quality: number): number {
  return Math.max(GEAR.affixes.minValue, Math.floor((max * clampQuality(quality)) / 100));
}

/** The perks a piece can roll: combat gear one of four, an axe woodcutting strength, a pickaxe mining strength. Empty when it cannot roll one. */
export function perkKindsFor(slot: EquipmentSlot | undefined): readonly GearPerkKind[] {
  if (!slot) return [];
  const tool = GEAR.affixes.perk.toolKinds[slot];
  return tool ? [tool] : GEAR.affixes.perk.combatKinds;
}

/** A salted sub-stream of `base` (the main RNG after the roll that came before): drawing from it never advances the main stream. */
export function affixStream(base: RngState, salt: number): RngState {
  return { seed: (base.seed ^ salt) >>> 0 };
}

/**
 * Rolls the affixes of a `rarity` piece in `slot` from `rng` (a salted sub-stream, see affixStream). Rare: 1 attribute, uniform among
 * the four (one draw). Epic: 2 DIFFERENT attributes (a draw among four, then among the three left), then the perk (one draw among
 * the four combat perks; a tool's perk is fixed and draws nothing). Other rarities: none and `rng` unchanged.
 */
export function rollAffixes(rng: RngState, slot: EquipmentSlot | undefined, rarity: ItemRarity): Draw<GearAffixes | undefined> {
  const count = affixAttributeCount(rarity);
  if (count < 1) return { value: undefined, rng };
  const pool = [...GEAR.affixes.attributePool];
  const attributes: AttributeKey[] = [];
  let r = rng;
  for (let n = 0; n < count && pool.length > 0; n += 1) {
    const pick = nextInt(r, 0, pool.length - 1);
    r = pick.rng;
    attributes.push(pool[pick.value]);
    pool.splice(pick.value, 1);
  }
  const affixes: GearAffixes = { attributes };
  if ((GEAR.affixes.perk.rarities as readonly ItemRarity[]).includes(rarity)) {
    const kinds = perkKindsFor(slot);
    if (kinds.length === 1) affixes.perk = kinds[0];
    else if (kinds.length > 1) {
      const pick = nextInt(r, 0, kinds.length - 1);
      r = pick.rng;
      affixes.perk = kinds[pick.value];
    }
  }
  return { value: affixes, rng: r };
}

/** A copy of affixes safe to store on another object (no shared array). */
export function copyAffixes(affixes: GearAffixes | undefined): GearAffixes | undefined {
  return affixes ? { attributes: [...affixes.attributes], ...(affixes.perk ? { perk: affixes.perk } : {}) } : undefined;
}

export type AttributeBonus = { attribute: AttributeKey; value: number };

/**
 * The attribute bonuses of an instance, in roll order: [] for common / uncommon gear, one for a rare, two for an epic. The value is
 * max(1, floor(max × quality ÷ 100)), max by gear level and rarity. Normal (plain) points when equipped, never core.
 */
export function attributeBonusesOf(item: Pick<Item, 'defId' | 'quality' | 'rarity' | 'affixes'>): AttributeBonus[] {
  const affixes = item.affixes;
  if (!affixes || !Array.isArray(affixes.attributes)) return [];
  const rarity = rarityOf(item);
  const max = affixAttributeMax(gearLevelOf(item), rarity);
  if (max < 1) return [];
  const value = affixValue(max, qualityOf(item));
  const out: AttributeBonus[] = [];
  for (const attribute of affixes.attributes.slice(0, affixAttributeCount(rarity))) {
    if ((ATTRIBUTE_KEYS as readonly string[]).includes(attribute)) out.push({ attribute, value });
  }
  return out;
}

export type GearPerk = { kind: GearPerkKind; value: number };

/** The perk of an instance (epic only): the kind and its value, an integer percent, max(1, floor(gearLevel × quality ÷ 100)). */
export function perkOf(item: Pick<Item, 'defId' | 'quality' | 'rarity' | 'affixes'>): GearPerk | null {
  const kind = item.affixes?.perk;
  if (!kind) return null;
  const max = perkMax(gearLevelOf(item), rarityOf(item));
  if (max < 1) return null;
  return { kind, value: affixValue(max, qualityOf(item)) };
}

/** Normal attribute points from everything equipped (the "gear" part of an attribute's plain points). */
export function gearAttributePoints(equipment: Partial<Record<EquipmentSlot, Item>>): Attributes {
  const out: Attributes = { strength: 0, dexterity: 0, endurance: 0, intelligence: 0 };
  for (const slot of EQUIPMENT_SLOTS) {
    const item = equipment[slot];
    if (!item) continue;
    for (const b of attributeBonusesOf(item)) out[b.attribute] += b.value;
  }
  return out;
}

/** value × (1 + pct ÷ 100), half up, once: how a perk's percent total is applied to a final number (integers in, integer out). */
export function applyPerk(value: number, pct: number): number {
  return pct === 0 ? value : Math.floor((value * (100 + pct) + 50) / 100);
}

export type PerkTotals = Record<GearPerkKind, number>;

/** Perk percents by kind, ADDED across everything equipped (P% in total). Each kind is then applied once, as a final multiplier. */
export function gearPerkTotals(equipment: Partial<Record<EquipmentSlot, Item>>): PerkTotals {
  const out: PerkTotals = { max_damage: 0, max_armor: 0, hp_regen: 0, mana_regen: 0, woodcutting_strength: 0, mining_strength: 0 };
  for (const slot of EQUIPMENT_SLOTS) {
    const item = equipment[slot];
    if (!item) continue;
    const perk = perkOf(item);
    if (perk) out[perk.kind] += perk.value;
  }
  return out;
}

/**
 * What the merchant pays per unit of an instance before the Town Hall bonus: the catalog sellPrice, × the rarity
 * multiplier for gear.
 */
export function baseSellPrice(item: Pick<Item, 'defId' | 'rarity'>): number {
  const def = getItemDef(item.defId);
  if (!def) return 0;
  if (!isGearDef(def)) return def.sellable === false ? 0 : def.sellPrice; // sellable:false (the Tusk): the Merchant buys none
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

// ---------- what each colour can give (read-only; the Crafting recipe details) ----------

/** What one colour of a gear piece can be: its odds, main stat range, attribute bonuses and perk. Numbers only; the screen words them. */
export type GearRarityDetail = {
  rarity: ItemRarity;
  /** The colour's chance when crafted, whole percent. */
  chancePct: number;
  /** The main-stat multiplier, percent (100 = ×1, 125 = ×1.25). */
  statPct: number;
  /** The main stats at quality 0 and at quality 100 (the multiplier applied). */
  atQuality0: GearStats;
  atQuality100: GearStats;
  /** Attribute bonuses: how many different random attributes, each from `min` to `max` (by quality); null = none. */
  attributes: { count: number; min: number; max: number } | null;
  /** The perk (epic): which kinds it can be (one for a tool) and its range `min` to `max` percent; null = none. */
  perk: { kinds: readonly GearPerkKind[]; min: number; max: number } | null;
};

/** The detail of one colour of a catalog gear piece. */
export function gearRarityDetail(def: ItemDef | undefined, rarity: ItemRarity, chancePct: number): GearRarityDetail {
  const level = gearLevelOfDef(def);
  const count = affixAttributeCount(rarity);
  const attrMax = affixAttributeMax(level, rarity);
  const pMax = perkMax(level, rarity);
  const kinds = perkKindsFor(def?.slot);
  return {
    rarity,
    chancePct,
    statPct: rarityStatPct(rarity),
    atQuality0: gearStatsAt(def, 0, rarity),
    atQuality100: gearStatsAt(def, GEAR.maxQuality, rarity),
    attributes: count > 0 && attrMax >= 1 ? { count, min: GEAR.affixes.minValue, max: attrMax } : null,
    perk: pMax >= 1 && kinds.length > 0 ? { kinds, min: GEAR.affixes.minValue, max: pMax } : null,
  };
}
