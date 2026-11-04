// Integer "units per minute" banking shared by every regenerating pool (current HP, current mana). Pure.
//
// The remainder is banked in "amount·ms per minute" units: each ms adds the regen rate (per minute), and every
// REGEN_UNIT (60 000) units is 1 point. Integer math only, so it is exact across resumes and rate changes:
// regen(a) then regen(b) == regen(a + b) at a constant rate.

/** Units of banked progress per point: one minute. */
export const REGEN_UNIT = 60_000;

/**
 * Regenerates `value` (with its banked `progress`) for `elapsedMs` at `ratePerMin`, never above `max`. At max the
 * remainder is 0 (time spent full is not banked); a value above max is brought down to max. Returns null when nothing
 * changes, so callers can keep the same object.
 *
 * No overflow: the product elapsed × rate is only formed when it is below the amount still missing (so a year of
 * elapsed time at a huge debug rate is fine).
 */
export function regenAmount(value: number, progress: number, max: number, ratePerMin: number, elapsedMs: number): [number, number] | null {
  if (value >= max) return value === max && progress === 0 ? null : [max, 0];
  if (!(elapsedMs > 0) || !(ratePerMin > 0)) return null;
  const v = Math.max(0, value);
  const needed = (max - v) * REGEN_UNIT - progress; // units until full, > 0
  if (elapsedMs >= Math.ceil(needed / ratePerMin)) return [max, 0];
  const banked = progress + elapsedMs * ratePerMin;
  const gained = Math.floor(banked / REGEN_UNIT);
  return [v + gained, banked - gained * REGEN_UNIT];
}

/** ms until full from `value` + `progress` at `ratePerMin` (0 when full, Infinity without regen). */
export function msUntilFull(value: number, progress: number, max: number, ratePerMin: number): number {
  if (value >= max) return 0;
  if (!(ratePerMin > 0)) return Number.POSITIVE_INFINITY;
  return Math.ceil(((max - Math.max(0, value)) * REGEN_UNIT - progress) / ratePerMin);
}
