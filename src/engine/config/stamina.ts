// Stamina (data). Rules in src/engine/stamina.ts and docs/ENGINE.md.

const MIN_MS = 60 * 1000;

export const STAMINA = {
  /** A new hero starts full at this max. Stored per player (GameState.stamina.max) so it can grow later. */
  startMax: 100,
  /** +1 stamina per interval while below max. 100 points ≈ 8h20 from empty. */
  regenIntervalMs: 5 * MIN_MS,
} as const;

// Stamina is spent only to skip the rest of a dungeon run (config/dungeons.ts, DUNGEON_RUN.skip).
// Waiting is always free.
