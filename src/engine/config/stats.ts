// Derived combat stats (data). Formulas in src/engine/stats.ts and docs/ENGINE.md.
//
// damage / defense: final = round(base × (1 + Σ percent bonuses)) + flat from attributes
// Attribute points are flat FINAL bonuses: percent upgrades never scale them (owner decision 2026-10-26).

export const STATS = {
  /** Damage range with no weapon (or a weapon the catalog does not know). */
  unarmedDamage: { min: 1, max: 2 },
  /** Flat damage per Strength point, added to both min and max. */
  damagePerStrength: 1,
  /** Flat defense per Endurance point. */
  defensePerEndurance: 1,
  /** maxHp = base + perLevel × (level − 1) */
  hp: { base: 50, perLevel: 10 },
  /** maxMana = base + perLevel × (level − 1) */
  mana: { base: 20, perLevel: 5 },
  /** Flat HP regen per minute = basePerMin + perEndurance × END. Runs always (idle, gathering, runs, offline). */
  hpRegen: { basePerMin: 5, perEndurance: 1 },
  /**
   * Hero attack interval (ms between two strikes; the first lands this long after the fight starts) =
   * baseMs + Σ attackIntervalModMs of the equipped items, never below minMs. No item sets a modifier yet.
   */
  attackInterval: { baseMs: 1000, minMs: 200 },
} as const;

/** Percent bonuses are integers in basis points: 100 = +1%, 1000 = +10%, −500 = −5%. */
export const BASIS_POINTS = 10_000;

/**
 * Attribute effects on a diminishing curve (src/engine/diminishing.ts): reduction (bp) = floor(capBp × value ÷ (value + k)),
 * never reaching the cap. Effective attribute values. Several reductions on one number multiply (docs/ENGINE.md).
 */
export const STAT_EFFECTS = {
  intelligence: {
    /** Crafting time: INT 10 → −8.33%, 50 → −25%, 100 → −33.33%, 210 → −40.38% (owner-approved 2026-11-01). */
    craftTime: { capBp: 5000, k: 50 },
  },
} as const;
