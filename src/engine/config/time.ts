// Time rules (see docs/ENGINE.md, "Time rules").

const HOUR_MS = 60 * 60 * 1000;

/** Offline progress cap for a new player. Stored per player (GameState.offline.capMs). */
export const DEFAULT_OFFLINE_CAP_MS = 8 * HOUR_MS;

/** Share of granted time that counts towards activities (1.0 = 100%). */
export const DEFAULT_OFFLINE_EFFICIENCY = 1.0;

/** Backward clock moves up to this size are treated as jitter (no anomaly). */
export const CLOCK_BACKWARD_TOLERANCE_MS = 60 * 1000;

/** "While you were away" opens only when at least this much real time passed (or on any clock anomaly). */
export const AWAY_SUMMARY_MIN_MS = 60 * 1000;

/** Hard safety stop for one simulate() call, far above 8h / 1.2s ≈ 24k actions. */
export const MAX_ACTIONS_PER_SIMULATION = 1_000_000;
