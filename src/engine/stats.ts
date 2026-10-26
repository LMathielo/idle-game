// Derived combat stats. Computed from the save on demand, never stored (pure, read-only).
//
//   damage / defense: final = round(base × (1 + Σ percent)) + flat from attributes
//   maxHp   = hp.base   + hp.perLevel   × (level − 1)
//   maxMana = mana.base + mana.perLevel × (level − 1)
//
// Integer math only: percent bonuses are basis points and rounding is half-up on integers,
// so the phone (Hermes) and a future server (V8) always agree.
import { getItemDef } from './config/items';
import { BASIS_POINTS, STATS } from './config/stats';
import type { Character, EquipmentSlot } from './types';

/** A percent bonus from one source. `bp` is basis points: 1000 = +10%. */
export type PercentBonus = { source: string; bp: number };

export type PercentBonuses = { damage: readonly PercentBonus[]; defense: readonly PercentBonus[] };

export type StatSource = 'weapon' | 'unarmed' | 'armor' | 'percent' | 'strength' | 'endurance' | 'base' | 'level';

/** One line of a damage breakdown. Parts add up to the final range. */
export type RangePart = { source: StatSource; min: number; max: number; defId?: string; slot?: EquipmentSlot };

/** One line of a scalar breakdown. Parts add up to the final value. */
export type ValuePart = { source: StatSource; value: number; defId?: string; slot?: EquipmentSlot };

export type DerivedStats = {
  damage: { min: number; max: number; breakdown: RangePart[] };
  defense: { value: number; breakdown: ValuePart[] };
  maxHp: { value: number; breakdown: ValuePart[] };
  maxMana: { value: number; breakdown: ValuePart[] };
};

/** What getDerivedStats reads. A GameState fits; UIs can pass just these slices. */
export type StatsInput = { character: Pick<Character, 'level' | 'attributes' | 'equipment'> };

/** Fixed order so breakdowns are stable. */
const SLOT_ORDER: readonly EquipmentSlot[] = ['weapon', 'shield', 'helmet', 'armor', 'gloves', 'boots', 'amulet', 'ring1', 'ring2'];

/**
 * Percent bonuses that apply to this hero. None exist yet: future upgrades (buffs, item affixes,
 * village upgrades) plug in here, and they only ever scale the base part.
 */
export function percentBonuses(_state: StatsInput): PercentBonuses {
  return { damage: [], defense: [] };
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
  const { level, attributes, equipment } = state.character;

  // ---- damage ----
  const weapon = equipment.weapon;
  const weaponDamage = weapon ? getItemDef(weapon.defId)?.damage : undefined;
  const baseDamage = weaponDamage ?? STATS.unarmedDamage;
  const damageParts: RangePart[] = [
    weaponDamage && weapon
      ? { source: 'weapon', min: baseDamage.min, max: baseDamage.max, defId: weapon.defId, slot: 'weapon' }
      : { source: 'unarmed', min: baseDamage.min, max: baseDamage.max },
  ];
  const scaledMin = applyPercent(baseDamage.min, bonuses.damage);
  const scaledMax = applyPercent(baseDamage.max, bonuses.damage);
  if (scaledMin !== baseDamage.min || scaledMax !== baseDamage.max) {
    damageParts.push({ source: 'percent', min: scaledMin - baseDamage.min, max: scaledMax - baseDamage.max });
  }
  const strFlat = attributes.strength * STATS.damagePerStrength;
  damageParts.push({ source: 'strength', min: strFlat, max: strFlat });

  // ---- defense ----
  const defenseParts: ValuePart[] = [];
  let baseDefense = 0;
  for (const slot of SLOT_ORDER) {
    const item = equipment[slot];
    if (!item) continue;
    const armor = getItemDef(item.defId)?.armor;
    if (!armor) continue;
    baseDefense += armor;
    defenseParts.push({ source: 'armor', value: armor, defId: item.defId, slot });
  }
  const scaledDefense = applyPercent(baseDefense, bonuses.defense);
  if (scaledDefense !== baseDefense) defenseParts.push({ source: 'percent', value: scaledDefense - baseDefense });
  const endFlat = attributes.endurance * STATS.defensePerEndurance;
  defenseParts.push({ source: 'endurance', value: endFlat });

  // ---- pools ----
  const levelsAbove1 = Math.max(0, level - 1);
  const hpFromLevel = STATS.hp.perLevel * levelsAbove1;
  const manaFromLevel = STATS.mana.perLevel * levelsAbove1;

  return {
    damage: { min: scaledMin + strFlat, max: scaledMax + strFlat, breakdown: damageParts },
    defense: { value: scaledDefense + endFlat, breakdown: defenseParts },
    maxHp: {
      value: STATS.hp.base + hpFromLevel,
      breakdown: [
        { source: 'base', value: STATS.hp.base },
        { source: 'level', value: hpFromLevel },
      ],
    },
    maxMana: {
      value: STATS.mana.base + manaFromLevel,
      breakdown: [
        { source: 'base', value: STATS.mana.base },
        { source: 'level', value: manaFromLevel },
      ],
    },
  };
}
