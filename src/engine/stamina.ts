// Stamina rules (pure). Regenerates inside simulate(); spent by debug now and by dungeons later.
import { STAMINA } from './config/stamina';
import type { GameState, Stamina } from './types';

/**
 * Adds regen for `elapsedMs` of accepted time: +1 per regenIntervalMs, never above max.
 * The remainder stays in progressMs so no partial time is lost between resumes. At max, progressMs
 * is 0: the timer only starts once stamina is spent. Returns the same object when nothing changes.
 *
 * `elapsedMs` is the sanitized time from simulate() BEFORE the offline cap: max already bounds
 * stamina, so the 8h activity cap is not applied here (docs/ENGINE.md).
 */
export function regenStamina(stamina: Stamina, elapsedMs: number, intervalMs: number = STAMINA.regenIntervalMs): Stamina {
  if (stamina.current >= stamina.max) {
    return stamina.progressMs === 0 ? stamina : { ...stamina, progressMs: 0 };
  }
  if (!(elapsedMs > 0)) return stamina;
  const banked = stamina.progressMs + elapsedMs;
  const points = Math.floor(banked / intervalMs);
  const current = Math.min(stamina.max, stamina.current + points);
  const progressMs = current >= stamina.max ? 0 : banked - points * intervalMs;
  return { ...stamina, current, progressMs };
}

export type StaminaErrorCode = 'INVALID_AMOUNT' | 'NOT_ENOUGH_STAMINA';

export type SpendStaminaResult =
  | { ok: true; state: GameState }
  | { ok: false; error: { code: StaminaErrorCode; message: string } };

/**
 * Spends `amount` stamina. Pure: returns a new state, never mutates the input. Callers simulate to
 * `now` first (applyCommand does), so regen up to that moment is already counted.
 * Spending from full starts the regen timer at 0.
 */
export function spendStamina(state: GameState, amount: number): SpendStaminaResult {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, error: { code: 'INVALID_AMOUNT', message: `Invalid stamina amount ${String(amount)}` } };
  }
  const { stamina } = state;
  if (stamina.current < amount) {
    return {
      ok: false,
      error: { code: 'NOT_ENOUGH_STAMINA', message: `Needs ${amount} stamina, has ${stamina.current}` },
    };
  }
  return { ok: true, state: { ...state, stamina: { ...stamina, current: stamina.current - amount } } };
}

/** Full bar, timer reset. Used by the debug refill. Pure. */
export function refillStamina(state: GameState): GameState {
  const { stamina } = state;
  if (stamina.current === stamina.max && stamina.progressMs === 0) return state;
  return { ...state, stamina: { ...stamina, current: stamina.max, progressMs: 0 } };
}

export type StaminaView = {
  current: number;
  max: number;
  full: boolean;
  /** ms until the next point (0 when full). */
  nextInMs: number;
  /** ms until the bar is full (0 when full). */
  fullInMs: number;
};

/** Read-only view for UIs. */
export function staminaView(state: Pick<GameState, 'stamina'>, intervalMs: number = STAMINA.regenIntervalMs): StaminaView {
  const { current, max, progressMs } = state.stamina;
  if (current >= max) return { current, max, full: true, nextInMs: 0, fullInMs: 0 };
  const nextInMs = Math.max(0, intervalMs - progressMs);
  return { current, max, full: false, nextInMs, fullInMs: nextInMs + (max - current - 1) * intervalMs };
}
