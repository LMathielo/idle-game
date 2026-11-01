// Derived combat stats (data). Formulas in src/engine/stats.ts and docs/ENGINE.md.
//
// damage / defense: final = round(base × (1 + Σ percent bonuses)) + hero base + flat from TOTAL attributes
// Attribute points are flat FINAL bonuses: percent upgrades never scale them (owner decision 2026-10-26).
// Since 1.16.0 a new hero has 0 in every attribute; the old starting 10 lives in the hero base numbers below
// (baseDamage, baseDefense, hpRegen.basePerMin, and WS / MS base in config/woodcutting.ts / mining.ts).

export const STATS = {
  /** Damage range with no weapon (or a weapon the catalog does not know). */
  unarmedDamage: { min: 1, max: 2 },
  /** Hero base damage, added to both min and max (unscaled, like STR). Was the starting 10 STR before 1.16.0. */
  baseDamage: 10,
  /** Flat damage per TOTAL Strength point, added to both min and max. */
  damagePerStrength: 1,
  /** Hero base defense (unscaled, like END). Was the starting 10 END before 1.16.0. */
  baseDefense: 10,
  /** Flat defense per TOTAL Endurance point. */
  defensePerEndurance: 1,
  /** maxHp = base + perLevel × (level − 1) */
  hp: { base: 50, perLevel: 10 },
  /** maxMana = base + perLevel × (level − 1) */
  mana: { base: 20, perLevel: 5 },
  /**
   * Flat HP regen per minute = basePerMin + perEndurance × TOTAL END. Runs always (idle, gathering, runs, offline).
   * basePerMin 5 → 15 in 1.16.0 (the old starting 10 END moved into the base).
   */
  hpRegen: { basePerMin: 15, perEndurance: 1 },
  /**
   * Hero attack interval (ms between two strikes; the first lands this long after the fight starts) =
   * baseMs + Σ attackIntervalModMs of the equipped items, never below minMs. No item sets a modifier yet.
   */
  attackInterval: { baseMs: 1000, minMs: 200 },
} as const;

/**
 * Normal and core attribute points (1.16.0, owner-approved 2026-11-01).
 *   total  = normal + core
 *   normal = level points + stored extra points (character.attributes: debug now, gear affixes later)
 *   core   = the attribute's training level (Training is the only source)
 * Level points are derived from the hero level, never stored: perLevel × (level − 1) on every attribute.
 */
export const ATTRIBUTE_POINTS = {
  /** Normal points per hero level above 1, on every attribute (Lv1 = 0, Lv2 = 5, Lv10 = 45). */
  perLevel: 5,
} as const;

/** Percent bonuses are integers in basis points: 100 = +1%, 1000 = +10%, −500 = −5%. */
export const BASIS_POINTS = 10_000;

/**
 * Attribute effects on a diminishing curve (src/engine/diminishing.ts): reduction (bp) = floor(capBp × value ÷ (value + k)),
 * never reaching the cap. These read the CORE points only (training levels, 1.16.0). Several reductions on one number
 * multiply (docs/ENGINE.md).
 */
export const STAT_EFFECTS = {
  dexterity: {
    /**
     * Dungeon search, woodcutting and mining action time (1.16.0, replaces −1 s per DEX): core DEX 10 → −8.33%,
     * 50 → −25%, 100 → −33.33%, 210 → −40.38%. time = max(floor, ceil(base × (1 − reduction))). Workers: unaffected.
     */
    activityTime: { capBp: 5000, k: 50 },
  },
  intelligence: {
    /** Crafting time: core INT 10 → −8.33%, 50 → −25%, 100 → −33.33%, 210 → −40.38% (owner-approved 2026-11-01). */
    craftTime: { capBp: 5000, k: 50 },
  },
} as const;
