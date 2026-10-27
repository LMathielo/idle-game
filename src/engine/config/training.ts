// Training (data). Rules in src/engine/training.ts; formulas and tables in docs/ENGINE.md ("Training").
// Owner-approved numbers (2026-10-26). Every number the brief names lives here.

export const TRAINING = {
  /** Training time that earns 1 training XP at the base rate (1 XP per trained minute). */
  msPerXp: 60_000,
  /**
   * Rate multiplier hook (e.g. a future INT effect): trained ms = granted ms × efficiency × rateMultiplier.
   * It does nothing today. Keep it a whole number: the engine's integer math assumes it (a fractional
   * rate would need integer progress units, like HP regen; see docs/ENGINE.md).
   */
  rateMultiplier: 1,
  /** XP (minutes) to reach training level n: firstLevelXp + perLevelXp × (n − 1). Lv1 = 5, Lv20 = 195, Lv200 = 1,995. */
  firstLevelXp: 5,
  perLevelXp: 10,
  /** Number of tiers. Tier t allows training levels up to levelsPerTier × t (200 levels at tier 10). */
  maxTier: 10,
  levelsPerTier: 20,
  /** Price of tier t in gold: tierPriceBase × t³ (100, 800, 2,700, … 100,000). Tier 1 is paid too. */
  tierPriceBase: 100,
  /**
   * Stamina speed-up (SPEEDUP_TRAINING): each step adds msPerStep of training progress at once for
   * staminaPerStep stamina (1 stamina = 1 minute). Steps beyond the tier cap are never charged.
   * maxStepsPerCommand bounds one command's input.
   */
  speedup: { msPerStep: 60_000, staminaPerStep: 1, maxStepsPerCommand: 100_000 },
} as const;
