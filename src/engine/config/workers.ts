// Workers (data). Rules in src/engine/workers.ts; see docs/ENGINE.md ("Workers"). Owner-approved 2026-10-28.
// The worker cap per Town Hall level is a building bonus (config/buildings.ts, `workerCap`).

export const WORKERS = {
  /** HIRE_WORKER costs hireBaseGold × 2^(workers already owned): 100, 200, 400… DISMISS_WORKER refunds nothing. */
  hireBaseGold: 100,
  /** Each worker on a node adds this share of the hero's CURRENT gathering power for that skill (basis points: 25%). */
  crewShareBp: 2500,
  /**
   * Upkeep in gold per worker per started minute of work, by node tier (tier 1 = Oak / Stone … tier 5 = Ironwood /
   * Gold). Idle or unassigned workers cost nothing.
   */
  upkeepPerMinByTier: [1, 5, 15, 40, 100],
  /** One upkeep step: paid at its start for every worker working in it. */
  upkeepStepMs: 60 * 1000,
} as const;
