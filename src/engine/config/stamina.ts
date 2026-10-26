// Stamina (data). Rules in src/engine/stamina.ts and docs/ENGINE.md.

const MIN_MS = 60 * 1000;

export const STAMINA = {
  /** A new hero starts full at this max. Stored per player (GameState.stamina.max) so it can grow later. */
  startMax: 100,
  /** +1 stamina per interval while below max. 100 points ≈ 8h20 from empty. */
  regenIntervalMs: 5 * MIN_MS,
  /** Planned costs (M4). Not used by any rule yet. */
  costs: {
    dungeonRun: 10,
    boss: 25,
  },
} as const;
