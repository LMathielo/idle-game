// Attributes (pure, read-only): normal and core points, the total, and the core-only effects. See docs/ENGINE.md
// ("Attributes & derived stats"). Owner-approved 2026-11-01 (engine 1.16.0), spendable points 2026-11-03 (1.17.0).
//
//   total  = normal + core           (plain effects, flat: STR damage and WS / MS, DEX crit multiplier, END max HP / HP regen / armor,
//                                     INT magic damage / magic resist / max mana / mana regen)
//   normal = spent + stored extra    (spent = character.spentPoints, the player's choice on level-up; extra = character.attributes)
//   core   = training level          (Training is the only source; core effects read it alone)
//
// Core effects (diminishing curve, capped; 1.19.0 gave every attribute one): STR → physical damage ×, DEX → crit chance and
// activity time (search, cut, mine), END → armor and magic resist ×, INT → magic damage × and craft time.
// Level-ups grant UNSPENT points (character.unspentPoints), never attributes.
import { STAT_EFFECTS, STATS } from './config/stats';
import { diminishingBp } from './diminishing';
import { regenRateUnits, REGEN_RATE_SCALE } from './regen';
import { ATTRIBUTE_KEYS, type AttributeKey, type AttributeTraining, type Attributes, type Character } from './types';

const BP = 10_000;

/** The training slice core points need. A GameState fits. */
export type TrainingLevels = { attributes: Record<AttributeKey, Pick<AttributeTraining, 'level'>> };

/** What core points read: training only. A GameState fits. */
export type CoreInput = { training: TrainingLevels };

/** What totals read. A GameState fits; UIs can pass just these slices. */
export type AttributeInput = { character: Pick<Character, 'attributes' | 'spentPoints'>; training: TrainingLevels };

/** Core points = training levels. */
export function coreAttributes(state: CoreInput): Attributes {
  const out = {} as Attributes;
  for (const k of ATTRIBUTE_KEYS) out[k] = state.training.attributes[k].level;
  return out;
}

/** Normal points = spent points + stored extra points (character.attributes). */
export function normalAttributes(state: AttributeInput): Attributes {
  const spent = state.character.spentPoints;
  const extra = state.character.attributes;
  const out = {} as Attributes;
  for (const k of ATTRIBUTE_KEYS) out[k] = spent[k] + extra[k];
  return out;
}

/** Total = normal + core, for every attribute. Linear effects (damage, defense, HP regen, WS / MS, mana regen) read this. */
export function effectiveAttributes(state: AttributeInput): Attributes {
  const normal = normalAttributes(state);
  const core = coreAttributes(state);
  const out = {} as Attributes;
  for (const k of ATTRIBUTE_KEYS) out[k] = normal[k] + core[k];
  return out;
}

// ---------- core effects ----------

/** Core DEX's activity-time reduction (bp): diminishing(core DEX, STAT_EFFECTS.dexterity.activityTime). */
export function dexActivityReductionBp(state: CoreInput): number {
  const { capBp, k } = STAT_EFFECTS.dexterity.activityTime;
  return diminishingBp(state.training.attributes.dexterity.level, capBp, k);
}

/** Core INT's crafting-time reduction (bp): diminishing(core INT, STAT_EFFECTS.intelligence.craftTime). */
export function intCraftReductionBp(state: CoreInput): number {
  const { capBp, k } = STAT_EFFECTS.intelligence.craftTime;
  return diminishingBp(state.training.attributes.intelligence.level, capBp, k);
}

/** Core STR's physical damage bonus (bp): diminishing(core STR, STAT_EFFECTS.strength.damageMult), cap 50%. */
export function strDamageBonusBp(state: CoreInput): number {
  const { capBp, k } = STAT_EFFECTS.strength.damageMult;
  return diminishingBp(state.training.attributes.strength.level, capBp, k);
}

/** Core DEX's crit chance (bp): diminishing(core DEX, STAT_EFFECTS.dexterity.critChance), cap 40%. */
export function dexCritChanceBp(state: CoreInput): number {
  const { capBp, k } = STAT_EFFECTS.dexterity.critChance;
  return diminishingBp(state.training.attributes.dexterity.level, capBp, k);
}

/** Core END's bonus to armor AND magic resist (bp), one shared factor: diminishing(core END, STAT_EFFECTS.endurance.armorMult), cap 50%. */
export function endArmorBonusBp(state: CoreInput): number {
  const { capBp, k } = STAT_EFFECTS.endurance.armorMult;
  return diminishingBp(state.training.attributes.endurance.level, capBp, k);
}

/** Core INT's magic damage bonus (bp): diminishing(core INT, STAT_EFFECTS.intelligence.magicDamageMult), cap 50%. */
export function intMagicDamageBonusBp(state: CoreInput): number {
  const { capBp, k } = STAT_EFFECTS.intelligence.magicDamageMult;
  return diminishingBp(state.training.attributes.intelligence.level, capBp, k);
}

/** The crit multiplier (bp) from TOTAL DEX: 15 000 + 100 per point (1 DEX → 15 100, 100 DEX → 25 000). Linear, uncapped. */
export function critMultiplierBp(state: AttributeInput): number {
  return STATS.crit.multiplierBaseBp + STATS.crit.multiplierPerDexterityBp * effectiveAttributes(state).dexterity;
}

/**
 * An activity's time with core DEX: max(floorMs, ceil(baseMs × (10 000 − reductionBp) ÷ 10 000)). Integer math (a 30 min
 * base × 10 000 is far below 2^53). Another time multiplier (a house bonus) would multiply in here, as in crafting.
 */
export function activityTimeMs(baseMs: number, floorMs: number, reductionBp: number): number {
  const bp = Math.min(BP, Math.max(0, reductionBp));
  return Math.max(floorMs, Math.ceil((baseMs * (BP - bp)) / BP));
}

// ---------- view ----------

/**
 * One effect line of an attribute: flat points (`amount`, fractional for the regens: +2.4 HP/min), or basis points (`bp`):
 * a time reduction (activityTime, craftTime), a percent bonus (damageMult, magicDamageMult, armorMult = armor AND magic
 * resist, critChance), or for `critMultiplier` the whole multiplier (15 100 = 1.51x).
 */
export type AttributeEffect =
  | { kind: 'damage' | 'armor' | 'maxHp' | 'hpRegen' | 'gatheringPower' | 'magicDamage' | 'magicResist' | 'maxMana' | 'manaRegen'; amount: number }
  | { kind: 'activityTime' | 'craftTime' | 'damageMult' | 'magicDamageMult' | 'armorMult' | 'critChance' | 'critMultiplier'; bp: number };

export type AttributeView = {
  attribute: AttributeKey;
  total: number;
  normal: number;
  /** Normal points the player spent (level-up points). */
  spent: number;
  /** Stored extra normal points (debug now, gear later). */
  extra: number;
  /** Training level. */
  core: number;
  /** Effects of the TOTAL (empty = none yet). */
  linear: AttributeEffect[];
  /** Effects of the CORE part only (empty = none yet). */
  coreEffects: AttributeEffect[];
};

/** Read-only view for the Status panel: each attribute's split and effects. The screen formats, never computes. */
export function attributeViews(state: AttributeInput): AttributeView[] {
  const total = effectiveAttributes(state);
  const core = coreAttributes(state);
  // Regens are fractional (0.2 per point): computed from the integer rate units, then ÷ 100, so 3 END is exactly 0.6.
  const regen = (perPoint: number, points: number) => (regenRateUnits(perPoint) * points) / REGEN_RATE_SCALE;
  const linear: Record<AttributeKey, AttributeEffect[]> = {
    strength: [
      { kind: 'damage', amount: total.strength * STATS.damagePerStrength },
      { kind: 'gatheringPower', amount: total.strength },
    ],
    dexterity: [{ kind: 'critMultiplier', bp: critMultiplierBp(state) }],
    endurance: [
      { kind: 'maxHp', amount: total.endurance * STATS.hp.perEndurance },
      { kind: 'hpRegen', amount: regen(STATS.hpRegen.perEndurance, total.endurance) },
      { kind: 'armor', amount: total.endurance * STATS.armorPerEndurance },
    ],
    intelligence: [
      { kind: 'magicDamage', amount: total.intelligence * STATS.magicDamagePerIntelligence },
      { kind: 'magicResist', amount: total.intelligence * STATS.magicResistPerIntelligence },
      { kind: 'maxMana', amount: total.intelligence * STATS.mana.perIntelligence },
      { kind: 'manaRegen', amount: regen(STATS.manaRegen.perIntelligence, total.intelligence) },
    ],
  };
  const coreEffects: Record<AttributeKey, AttributeEffect[]> = {
    strength: [{ kind: 'damageMult', bp: strDamageBonusBp(state) }],
    dexterity: [
      { kind: 'critChance', bp: dexCritChanceBp(state) },
      { kind: 'activityTime', bp: dexActivityReductionBp(state) },
    ],
    endurance: [{ kind: 'armorMult', bp: endArmorBonusBp(state) }],
    intelligence: [
      { kind: 'magicDamageMult', bp: intMagicDamageBonusBp(state) },
      { kind: 'craftTime', bp: intCraftReductionBp(state) },
    ],
  };
  return ATTRIBUTE_KEYS.map((attribute) => ({
    attribute,
    total: total[attribute],
    normal: total[attribute] - core[attribute],
    spent: state.character.spentPoints[attribute],
    extra: state.character.attributes[attribute],
    core: core[attribute],
    linear: linear[attribute],
    coreEffects: coreEffects[attribute],
  }));
}
