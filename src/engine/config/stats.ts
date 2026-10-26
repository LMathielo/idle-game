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
} as const;

/** Percent bonuses are integers in basis points: 100 = +1%, 1000 = +10%, −500 = −5%. */
export const BASIS_POINTS = 10_000;
