// Attributes (pure, read-only): normal and core points, the total, and the core-only effects. See docs/ENGINE.md
// ("Attributes & derived stats"). Owner-approved 2026-11-01, engine 1.16.0.
//
//   total  = normal + core                      (linear effects: STR damage, END defense and HP regen)
//   normal = level points + stored extra        (level points = 5 × (hero level − 1), derived; extra = character.attributes)
//   core   = training level                     (Training is the only source; core effects read it alone)
//
// Core effects: DEX → activity time (search, cut, mine), INT → craft time (both on the diminishing curve),
// STR → gathering power (WS / MS). END has no core effect yet.
import { ATTRIBUTE_POINTS, STAT_EFFECTS, STATS } from './config/stats';
import { diminishingBp } from './diminishing';
import { ATTRIBUTE_KEYS, type AttributeKey, type AttributeTraining, type Attributes, type Character } from './types';

const BP = 10_000;

/** The training slice core points need. A GameState fits. */
export type TrainingLevels = { attributes: Record<AttributeKey, Pick<AttributeTraining, 'level'>> };

/** What core points read: training only. A GameState fits. */
export type CoreInput = { training: TrainingLevels };

/** What totals read. A GameState fits; UIs can pass just these slices. */
export type AttributeInput = { character: Pick<Character, 'attributes' | 'level'>; training: TrainingLevels };

/** Normal points every attribute gets from the hero level: perLevel × (level − 1), 0 at Lv1 (or a broken level). */
export function levelPoints(level: number): number {
  return Number.isSafeInteger(level) && level > 1 ? ATTRIBUTE_POINTS.perLevel * (level - 1) : 0;
}

/** Core points = training levels. */
export function coreAttributes(state: CoreInput): Attributes {
  const out = {} as Attributes;
  for (const k of ATTRIBUTE_KEYS) out[k] = state.training.attributes[k].level;
  return out;
}

/** Normal points = level points + stored extra points (character.attributes). */
export function normalAttributes(state: AttributeInput): Attributes {
  const fromLevel = levelPoints(state.character.level);
  const extra = state.character.attributes;
  const out = {} as Attributes;
  for (const k of ATTRIBUTE_KEYS) out[k] = fromLevel + extra[k];
  return out;
}

/** Total = normal + core, for every attribute. Linear effects (damage, defense, HP regen) read this. */
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

/**
 * An activity's time with core DEX: max(floorMs, ceil(baseMs × (10 000 − reductionBp) ÷ 10 000)). Integer math (a 30 min
 * base × 10 000 is far below 2^53). Another time multiplier (a house bonus) would multiply in here, as in crafting.
 */
export function activityTimeMs(baseMs: number, floorMs: number, reductionBp: number): number {
  const bp = Math.min(BP, Math.max(0, reductionBp));
  return Math.max(floorMs, Math.ceil((baseMs * (BP - bp)) / BP));
}

// ---------- view ----------

/** One effect line of an attribute: flat points (`amount`), or a time reduction in basis points (`bp`). */
export type AttributeEffect =
  | { kind: 'damage' | 'defense' | 'hpRegen' | 'gatheringPower'; amount: number }
  | { kind: 'activityTime' | 'craftTime'; bp: number };

export type AttributeView = {
  attribute: AttributeKey;
  total: number;
  normal: number;
  /** Normal points from the hero level. */
  levelPoints: number;
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
  const fromLevel = levelPoints(state.character.level);
  const total = effectiveAttributes(state);
  const core = coreAttributes(state);
  const linear: Record<AttributeKey, AttributeEffect[]> = {
    strength: [{ kind: 'damage', amount: total.strength * STATS.damagePerStrength }],
    dexterity: [],
    endurance: [
      { kind: 'defense', amount: total.endurance * STATS.defensePerEndurance },
      { kind: 'hpRegen', amount: total.endurance * STATS.hpRegen.perEndurance },
    ],
    intelligence: [],
  };
  const coreEffects: Record<AttributeKey, AttributeEffect[]> = {
    strength: [{ kind: 'gatheringPower', amount: core.strength }],
    dexterity: [{ kind: 'activityTime', bp: dexActivityReductionBp(state) }],
    endurance: [],
    intelligence: [{ kind: 'craftTime', bp: intCraftReductionBp(state) }],
  };
  return ATTRIBUTE_KEYS.map((attribute) => ({
    attribute,
    total: total[attribute],
    normal: total[attribute] - core[attribute],
    levelPoints: fromLevel,
    extra: state.character.attributes[attribute],
    core: core[attribute],
    linear: linear[attribute],
    coreEffects: coreEffects[attribute],
  }));
}
