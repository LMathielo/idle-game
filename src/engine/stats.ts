// Derived combat stats. Computed from the save on demand, never stored (pure, read-only).
//
// Plain (TOTAL attribute) points are flat (the total includes the equipped gear's attribute bonuses, 1.22.0); core (training) points are
// a capped percent multiplier on the FINAL value, rounded once. Gear PERKS (epic, 1.22.0) come last: each kind's percent (added across
// the equipped pieces) is one more separate multiplier on the final number, after the core one, rounded once, half up.
//
//   damage   = round(round((round(weapon × (1 + Σ percent)) + 10 base + STR × 1) × (1 + core STR)) × (1 + perk max_damage))   (each of min and max)
//   magic    = round(round((0 base + INT × 1) × (1 + core INT)) × (1 + perk max_damage))
//   armor    = round(round((round(Σ armor × (1 + Σ percent)) + 10 base + END × 1) × (1 + core END)) × (1 + perk max_armor))
//   resist   = round((0 base + INT × 1) × (1 + core END))                                          (the same core END factor; no perk)
//   critChance bp = diminishing(core DEX);  critMultiplier bp = 15 000 + 100 × total DEX
//   maxHp    = hp.base   + hp.perLevel   × (level − 1) + 5 × total END
//   maxMana  = mana.base + mana.perLevel × (level − 1) + 5 × total INT
//   attackIntervalMs = max(attackInterval.minMs, attackInterval.baseMs + Σ gear attackIntervalModMs)
//
// Integer math only: percent bonuses are basis points and rounding is half-up on integers,
// so the phone (Hermes) and a future server (V8) always agree.
import {
  critMultiplierBp,
  dexCritChanceBp,
  effectiveAttributes,
  endArmorBonusBp,
  intMagicDamageBonusBp,
  strDamageBonusBp,
  type TrainingLevels,
} from './attributes';
import { applyPerk, gearPerkTotals, gearStats } from './gear';
import { BASIS_POINTS, STATS } from './config/stats';
import { type AttributeKey, type Character, EQUIPMENT_SLOTS, type EquipmentSlot } from './types';

/** A percent bonus from one source. `bp` is basis points: 1000 = +10%. */
export type PercentBonus = { source: string; bp: number };

export type PercentBonuses = { damage: readonly PercentBonus[]; armor: readonly PercentBonus[] };

export type StatSource =
  | 'weapon'
  | 'unarmed'
  | 'armor'
  | 'percent'
  | 'strength'
  | 'dexterity'
  | 'endurance'
  | 'intelligence'
  | 'core'
  | 'perk'
  | 'base'
  | 'level'
  | 'gear'
  | 'floor';

/**
 * Extra detail on a breakdown line. `bonuses` is set on the 'percent' line only: the per-source bonuses
 * that were summed before the single rounding, so a UI can list each buff/affix by name.
 */
type PartDetail = { defId?: string; slot?: EquipmentSlot; bonuses?: PercentBonus[]; /** The attribute whose core points a 'core' line is. */ attribute?: AttributeKey };

/** One line of a damage breakdown. Parts add up to the final range. */
export type RangePart = { source: StatSource; min: number; max: number } & PartDetail;

/** One line of a scalar breakdown. Parts add up to the final value. */
export type ValuePart = { source: StatSource; value: number } & PartDetail;

export type DerivedStats = {
  /** Physical damage range per strike (final: includes the core STR multiplier). */
  damage: { min: number; max: number; breakdown: RangePart[] };
  /** Magic damage per strike (INT; a fixed number, no roll). */
  magicDamage: { value: number; breakdown: ValuePart[] };
  armor: { value: number; breakdown: ValuePart[] };
  magicResist: { value: number; breakdown: ValuePart[] };
  /** Crit chance in basis points (core DEX), 0..4000. */
  critChanceBp: { value: number; breakdown: ValuePart[] };
  /** Crit damage multiplier in basis points (total DEX): 15 000 = 1.5x. */
  critMultiplierBp: { value: number; breakdown: ValuePart[] };
  maxHp: { value: number; breakdown: ValuePart[] };
  maxMana: { value: number; breakdown: ValuePart[] };
  /** Time between two hero strikes in a fight (ms). Lower is faster. */
  attackIntervalMs: { value: number; breakdown: ValuePart[] };
};

/**
 * What getDerivedStats reads. A GameState fits; UIs can pass just these slices. `training` is required:
 * the totals (spent + extra + core) and the core multipliers read it, so it can't be left out by mistake.
 */
export type StatsInput = { character: Pick<Character, 'level' | 'attributes' | 'spentPoints' | 'equipment'>; training: TrainingLevels };

/** Fixed order so breakdowns are stable. */
const SLOT_ORDER: readonly EquipmentSlot[] = ['weapon', 'shield', 'helmet', 'armor', 'legs', 'gloves', 'boots', 'amulet', 'ring1', 'ring2'];

/** Every slot, for stats any equipped item may carry (attack interval). Same order as SLOT_ORDER, then the rest of EQUIPMENT_SLOTS (axe, pickaxe). */
export const ALL_SLOTS_ORDER: readonly EquipmentSlot[] = [...SLOT_ORDER, ...EQUIPMENT_SLOTS.filter((s) => !SLOT_ORDER.includes(s))];

/**
 * Percent bonuses that apply to this hero. None exist yet: future upgrades (buffs, item affixes,
 * village upgrades) plug in here, and they only ever scale the base part. They are summed and
 * rounded once (one 'percent' breakdown line that lists every source in `bonuses`).
 */
export function percentBonuses(_state: StatsInput): PercentBonuses {
  return { damage: [], armor: [] };
}

/** round(base × (1 + Σ bp / 10000)), half-up, never below 0. Integer inputs only. */
export function applyPercent(base: number, bonuses: readonly PercentBonus[]): number {
  let sumBp = 0;
  for (const b of bonuses) {
    if (!Number.isSafeInteger(b.bp)) throw new RangeError(`applyPercent: bonus ${b.source} has non-integer bp ${b.bp}`);
    sumBp += b.bp;
  }
  const factor = Math.max(0, BASIS_POINTS + sumBp);
  return Math.floor((base * factor + BASIS_POINTS / 2) / BASIS_POINTS);
}

export function getDerivedStats(state: StatsInput, bonuses: PercentBonuses = percentBonuses(state)): DerivedStats {
  const { level, equipment } = state.character;
  const attributes = effectiveAttributes(state);

  // ---- physical damage ----
  const weapon = equipment.weapon;
  const weaponDamage = weapon ? gearStats(weapon).damage : undefined;
  const baseDamage = weaponDamage ?? STATS.unarmedDamage;
  const damageParts: RangePart[] = [
    weaponDamage && weapon
      ? { source: 'weapon', min: baseDamage.min, max: baseDamage.max, defId: weapon.defId, slot: 'weapon' }
      : { source: 'unarmed', min: baseDamage.min, max: baseDamage.max },
  ];
  const scaledMin = applyPercent(baseDamage.min, bonuses.damage);
  const scaledMax = applyPercent(baseDamage.max, bonuses.damage);
  if (scaledMin !== baseDamage.min || scaledMax !== baseDamage.max) {
    damageParts.push({
      source: 'percent',
      min: scaledMin - baseDamage.min,
      max: scaledMax - baseDamage.max,
      bonuses: bonuses.damage.map((b) => ({ ...b })),
    });
  }
  // Hero base (the old starting 10 STR, 1.16.0), then the total STR; neither is scaled by percent bonuses.
  damageParts.push({ source: 'base', min: STATS.baseDamage, max: STATS.baseDamage });
  const strFlat = attributes.strength * STATS.damagePerStrength;
  damageParts.push({ source: 'strength', min: strFlat, max: strFlat });
  const flatDamage = STATS.baseDamage + strFlat;
  // Core STR (1.19.0): a separate multiplier on the FINAL range (everything above), rounded once per end of the range.
  const strBp = strDamageBonusBp(state);
  const preMin = scaledMin + flatDamage;
  const preMax = scaledMax + flatDamage;
  const coreMin = applyCore(preMin, strBp);
  const coreMax = applyCore(preMax, strBp);
  if (coreMin !== preMin || coreMax !== preMax) {
    damageParts.push({ source: 'core', attribute: 'strength', min: coreMin - preMin, max: coreMax - preMax });
  }
  // Gear perk "max damage" (1.22.0): one more separate multiplier on the final range, after the core one.
  const perks = gearPerkTotals(equipment);
  const finalMin = applyPerk(coreMin, perks.max_damage);
  const finalMax = applyPerk(coreMax, perks.max_damage);
  if (finalMin !== coreMin || finalMax !== coreMax) {
    damageParts.push({ source: 'perk', min: finalMin - coreMin, max: finalMax - coreMax });
  }

  // ---- magic damage ----
  const magicParts: ValuePart[] = [{ source: 'base', value: STATS.baseMagicDamage }];
  const intMagic = attributes.intelligence * STATS.magicDamagePerIntelligence;
  magicParts.push({ source: 'intelligence', value: intMagic });
  const magicPre = STATS.baseMagicDamage + intMagic;
  const magicCore = applyCore(magicPre, intMagicDamageBonusBp(state));
  if (magicCore !== magicPre) magicParts.push({ source: 'core', attribute: 'intelligence', value: magicCore - magicPre });
  const magicFinal = applyPerk(magicCore, perks.max_damage); // the "max damage" perk lifts magic damage too
  if (magicFinal !== magicCore) magicParts.push({ source: 'perk', value: magicFinal - magicCore });

  // ---- armor ----
  const armorParts: ValuePart[] = [];
  let gearArmor = 0;
  for (const slot of SLOT_ORDER) {
    const item = equipment[slot];
    if (!item) continue;
    const armor = gearStats(item).armor;
    if (!armor) continue;
    gearArmor += armor;
    armorParts.push({ source: 'armor', value: armor, defId: item.defId, slot });
  }
  const scaledArmor = applyPercent(gearArmor, bonuses.armor);
  if (scaledArmor !== gearArmor) {
    armorParts.push({ source: 'percent', value: scaledArmor - gearArmor, bonuses: bonuses.armor.map((b) => ({ ...b })) });
  }
  armorParts.push({ source: 'base', value: STATS.baseArmor });
  const endArmor = attributes.endurance * STATS.armorPerEndurance;
  armorParts.push({ source: 'endurance', value: endArmor });
  // Core END (1.19.0): one factor for armor AND magic resist, a separate multiplier on each FINAL value.
  const endBp = endArmorBonusBp(state);
  const armorPre = scaledArmor + STATS.baseArmor + endArmor;
  const armorCore = applyCore(armorPre, endBp);
  if (armorCore !== armorPre) armorParts.push({ source: 'core', attribute: 'endurance', value: armorCore - armorPre });
  // Gear perk "max armor" (1.22.0): a final separate multiplier on armor only (not magic resist).
  const armorFinal = applyPerk(armorCore, perks.max_armor);
  if (armorFinal !== armorCore) armorParts.push({ source: 'perk', value: armorFinal - armorCore });

  // ---- magic resist ----
  const resistParts: ValuePart[] = [{ source: 'base', value: STATS.baseMagicResist }];
  const intResist = attributes.intelligence * STATS.magicResistPerIntelligence;
  resistParts.push({ source: 'intelligence', value: intResist });
  const resistPre = STATS.baseMagicResist + intResist;
  const resistFinal = applyCore(resistPre, endBp);
  if (resistFinal !== resistPre) resistParts.push({ source: 'core', attribute: 'endurance', value: resistFinal - resistPre });

  // ---- crits ----
  const critChance = dexCritChanceBp(state);
  const critMult = critMultiplierBp(state);

  // ---- attack interval ----
  const intervalParts: ValuePart[] = [{ source: 'base', value: STATS.attackInterval.baseMs }];
  let interval: number = STATS.attackInterval.baseMs;
  for (const slot of ALL_SLOTS_ORDER) {
    const item = equipment[slot];
    if (!item) continue;
    const mod = gearStats(item).attackIntervalModMs;
    if (!mod || !Number.isSafeInteger(mod)) continue;
    interval += mod;
    intervalParts.push({ source: 'gear', value: mod, defId: item.defId, slot });
  }
  if (interval < STATS.attackInterval.minMs) {
    intervalParts.push({ source: 'floor', value: STATS.attackInterval.minMs - interval });
    interval = STATS.attackInterval.minMs;
  }

  // ---- pools ----
  const levelsAbove1 = Math.max(0, level - 1);
  const hpFromLevel = STATS.hp.perLevel * levelsAbove1;
  const hpFromEnd = STATS.hp.perEndurance * attributes.endurance;
  const manaFromLevel = STATS.mana.perLevel * levelsAbove1;
  const manaFromInt = STATS.mana.perIntelligence * attributes.intelligence;

  return {
    damage: { min: finalMin, max: finalMax, breakdown: damageParts },
    magicDamage: { value: magicFinal, breakdown: magicParts },
    armor: { value: armorFinal, breakdown: armorParts },
    magicResist: { value: resistFinal, breakdown: resistParts },
    critChanceBp: { value: critChance, breakdown: [{ source: 'core', attribute: 'dexterity', value: critChance }] },
    critMultiplierBp: {
      value: critMult,
      breakdown: [
        { source: 'base', value: STATS.crit.multiplierBaseBp },
        { source: 'dexterity', value: STATS.crit.multiplierPerDexterityBp * attributes.dexterity },
      ],
    },
    maxHp: {
      value: STATS.hp.base + hpFromLevel + hpFromEnd,
      breakdown: [
        { source: 'base', value: STATS.hp.base },
        { source: 'level', value: hpFromLevel },
        { source: 'endurance', value: hpFromEnd },
      ],
    },
    maxMana: {
      value: STATS.mana.base + manaFromLevel + manaFromInt,
      breakdown: [
        { source: 'base', value: STATS.mana.base },
        { source: 'level', value: manaFromLevel },
        { source: 'intelligence', value: manaFromInt },
      ],
    },
    attackIntervalMs: { value: interval, breakdown: intervalParts },
  };
}

/** value × (1 + bp ÷ 10 000), half-up, once. The core multiplier of 1.19.0 (STR damage, END armor and resist, INT magic). */
function applyCore(value: number, bp: number): number {
  return bp === 0 ? value : applyPercent(value, [{ source: 'core', bp }]);
}
