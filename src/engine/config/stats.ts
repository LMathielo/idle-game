// Derived combat stats (data). Formulas in src/engine/stats.ts and docs/ENGINE.md.
//
// Attribute roles (owner-approved 2026-11-04, engine 1.19.0): STR physical damage, DEX crits, END toughness, INT magic.
// PLAIN points (the TOTAL = spent + extra + core) give flat stats; CORE points (the Training level) give a capped percent
// multiplier on a diminishing curve (STAT_EFFECTS below), applied to the FINAL value, rounded once.
//
// damage / armor: final = round(base × (1 + Σ percent bonuses)) + hero base + flat from TOTAL attributes, then × (1 + core multiplier)
// Attribute points are flat FINAL bonuses: percent upgrades never scale them (owner decision 2026-10-26).
// Since 1.16.0 a new hero has 0 in every attribute; the old starting 10 lives in the hero base numbers below
// (baseDamage, baseArmor, hpRegen.basePerMin, and WS / MS base in config/woodcutting.ts / mining.ts).
// "Defense" was renamed "Armor" in 1.19.0 (the engine identifiers followed).

export const STATS = {
  /** Damage range with no weapon (or a weapon the catalog does not know). */
  unarmedDamage: { min: 1, max: 2 },
  /** Hero base damage, added to both min and max (unscaled by percent bonuses, like STR). Was the starting 10 STR before 1.16.0. */
  baseDamage: 10,
  /** Flat physical damage per TOTAL Strength point, added to both min and max. */
  damagePerStrength: 1,
  /** Hero base armor (unscaled by percent bonuses, like END). Was the starting 10 END before 1.16.0. */
  baseArmor: 10,
  /** Flat armor per TOTAL Endurance point (1.19.0 keeps 1). */
  armorPerEndurance: 1,
  /** Hero base magic damage: none, magic damage comes from Intelligence only. */
  baseMagicDamage: 0,
  /** Flat magic damage per TOTAL Intelligence point (1.19.0). */
  magicDamagePerIntelligence: 1,
  /** Hero base magic resist (0) and flat magic resist per TOTAL Intelligence point (1.19.0). */
  baseMagicResist: 0,
  magicResistPerIntelligence: 1,
  /** maxHp = base + perLevel × (level − 1) + perEndurance × TOTAL END (perEndurance 5 in 1.19.0). */
  hp: { base: 50, perLevel: 10, perEndurance: 5 },
  /** maxMana = base + perLevel × (level − 1) + perIntelligence × TOTAL INT (perIntelligence 5 in 1.19.0). */
  mana: { base: 20, perLevel: 5, perIntelligence: 5 },
  /**
   * HP regen per minute = basePerMin + perEndurance × TOTAL END. Runs always (idle, gathering, runs, offline).
   * basePerMin 5 → 15 in 1.16.0 (the old starting 10 END moved into the base); perEndurance 1 → 0.2 in 1.19.0 (owner accepted).
   * Rates are decimals with at most 2 digits: the engine works in hundredths of a point per minute, exact (src/engine/regen.ts).
   */
  hpRegen: { basePerMin: 15, perEndurance: 0.2 },
  /**
   * Mana regen per minute = basePerMin + perIntelligence × TOTAL INT (1.17.0, owner-approved 2026-11-03; perIntelligence 1 → 0.2
   * in 1.19.0). Runs wherever HP regen runs (idle, gathering, training, dungeon search and fight, beyond the offline cap, offline),
   * with the same exact banking (src/engine/mana.ts). Nothing spends mana yet.
   */
  manaRegen: { basePerMin: 5, perIntelligence: 0.2 },
  /**
   * Critical hits (1.19.0): chance from CORE DEX (STAT_EFFECTS.dexterity.critChance); the multiplier from TOTAL DEX, linear and
   * uncapped: baseBp + perDexterityBp × DEX (15 000 + 100 × DEX bp: 1 DEX → 1.51x, 100 DEX → 2.5x). Basis points; a crit
   * multiplies the hero's physical roll only.
   */
  crit: { multiplierBaseBp: 15_000, multiplierPerDexterityBp: 100 },
  /**
   * Hero attack interval (ms between two strikes; the first lands this long after the fight starts) =
   * baseMs + Σ attackIntervalModMs of the equipped items, never below minMs. No item sets a modifier yet.
   */
  attackInterval: { baseMs: 1000, minMs: 200 },
} as const;

/**
 * Normal and core attribute points (1.16.0; spendable points 1.17.0, owner-approved 2026-11-03).
 *   total  = normal + core
 *   normal = character.attributes: the points the player spent (permanent, no refund) + extra points (debug now, gear later)
 *   core   = the attribute's training level (Training is the only source)
 * Each hero level-up grants `unspentPerLevel` UNSPENT points (character.unspentPoints); SPEND_ATTRIBUTE_POINTS moves them
 * into character.attributes. Replaces the automatic +5 on every attribute per level (1.16.0).
 */
export const ATTRIBUTE_POINTS = {
  /** Unspent points per hero level gained (Lv2 = 5 to spend, Lv10 = 45 in all), wherever the level-up happens. */
  unspentPerLevel: 5,
} as const;

/** Percent bonuses are integers in basis points: 100 = +1%, 1000 = +10%, −500 = −5%. */
export const BASIS_POINTS = 10_000;

/**
 * Attribute effects on a diminishing curve (src/engine/diminishing.ts): bonus or reduction (bp) = floor(capBp × value ÷ (value + k)),
 * never reaching the cap. These read the CORE points only (training levels, 1.16.0). Several reductions on one number
 * multiply (docs/ENGINE.md). With k = 50: core 10 → 1/6 of the cap, 20 → 2/7, 50 → 1/2, 100 → 2/3.
 *
 * 1.19.0 core effects (each a SEPARATE multiplier on the FINAL value, rounded once, half-up):
 *   STR  physical damage × (1 + up to 50%)
 *   DEX  crit chance up to 40% (and the activity-time reduction below, unchanged)
 *   END  armor AND magic resist × (1 + up to 50%), one shared factor
 *   INT  magic damage × (1 + up to 50%) (and the crafting-time reduction below, unchanged)
 */
export const STAT_EFFECTS = {
  strength: {
    /** Physical damage multiplier: core STR 10 → +8.33%, 20 → +14.28%, 50 → +25%, 100 → +33.33%. */
    damageMult: { capBp: 5000, k: 50 },
  },
  dexterity: {
    /** Crit chance: core DEX 10 → 6.66%, 20 → 11.42%, 50 → 20%, 100 → 26.66% (cap 40%). */
    critChance: { capBp: 4000, k: 50 },
    /**
     * Dungeon search, woodcutting and mining action time (1.16.0, replaces −1 s per DEX): core DEX 10 → −8.33%,
     * 50 → −25%, 100 → −33.33%, 210 → −40.38%. time = max(floor, ceil(base × (1 − reduction))). Workers: unaffected.
     */
    activityTime: { capBp: 5000, k: 50 },
  },
  endurance: {
    /** Armor and magic resist multiplier (one shared factor): core END 10 → +8.33%, 50 → +25%, 100 → +33.33%. */
    armorMult: { capBp: 5000, k: 50 },
  },
  intelligence: {
    /** Magic damage multiplier: core INT 10 → +8.33%, 50 → +25%, 100 → +33.33%. */
    magicDamageMult: { capBp: 5000, k: 50 },
    /** Crafting time: core INT 10 → −8.33%, 50 → −25%, 100 → −33.33%, 210 → −40.38% (owner-approved 2026-11-01). */
    craftTime: { capBp: 5000, k: 50 },
  },
} as const;
