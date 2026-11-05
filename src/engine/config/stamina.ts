// Stamina (data). Rules in src/engine/stamina.ts and docs/ENGINE.md.

const MIN_MS = 60 * 1000;

export const STAMINA = {
  /** A new hero starts full at this max. Stored per player (GameState.stamina.max) so it can grow later. */
  startMax: 100,
  /** +1 stamina per interval while below max. 100 points ≈ 8h20 from empty. */
  regenIntervalMs: 5 * MIN_MS,
} as const;

// Stamina buys time (skips: the rest of a dungeon search, a log, an ore, a craft, training minutes) and, since 1.20.0, access:
// entering a boss fight costs stamina up front (config/dungeons.ts, BOSSES[...].entryStamina). Waiting is always free.
// (The 2026-10-26 principle "stamina buys time, never access" was superseded on 2026-11-05: docs/PRODUCT.md.)
