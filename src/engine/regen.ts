// Integer "units per minute" banking shared by every regenerating pool (current HP, current mana). Pure.
//
// Regen rates are fixed-point: a rate is stored as HUNDREDTHS of a point per minute ("rate units", 15.2/min = 1520), so a
// per-point rate like 0.2 HP/min is exact (REGEN_RATE_SCALE; regenRateUnits() converts a configured decimal).
//
// The remainder is banked in "rate-unit·ms" units: each ms adds the rate in rate units, and every REGEN_UNIT (60 000 ms × the
// rate scale = 6 000 000, save v19; it was 60 000 before the scale) units is 1 point. Integer math only, so it is exact across
// resumes and rate changes: regen(a) then regen(b) == regen(a + b) at a constant rate.

/** Hundredths: a regen rate is held in 1/REGEN_RATE_SCALE of a point per minute. Two decimals per point are exact. */
export const REGEN_RATE_SCALE = 100;

/** Units of banked progress per point: one minute of a rate of 1 point/min = 60 000 ms × REGEN_RATE_SCALE. */
export const REGEN_UNIT = 60_000 * REGEN_RATE_SCALE;

/** A per-minute rate (e.g. 15.2) in rate units (1520), rounded to the nearest hundredth; never negative. */
export function regenRateUnits(perMin: number): number {
  return Number.isFinite(perMin) ? Math.max(0, Math.round(perMin * REGEN_RATE_SCALE)) : 0;
}

/**
 * Regenerates `value` (with its banked `progress`) for `elapsedMs` at `rateUnits` (hundredths of a point per minute), never above
 * `max`. At max the remainder is 0 (time spent full is not banked); a value above max is brought down to max. Returns null when
 * nothing changes, so callers can keep the same object.
 *
 * No overflow: the product elapsed × rate is only formed when it is below the amount still missing (so a year of
 * elapsed time at a huge debug rate is fine).
 */
export function regenAmount(value: number, progress: number, max: number, rateUnits: number, elapsedMs: number): [number, number] | null {
  if (value >= max) return value === max && progress === 0 ? null : [max, 0];
  if (!(elapsedMs > 0) || !(rateUnits > 0)) return null;
  const v = Math.max(0, value);
  const needed = (max - v) * REGEN_UNIT - progress; // units until full, > 0
  if (elapsedMs >= Math.ceil(needed / rateUnits)) return [max, 0];
  const banked = progress + elapsedMs * rateUnits;
  const gained = Math.floor(banked / REGEN_UNIT);
  return [v + gained, banked - gained * REGEN_UNIT];
}

/** ms until full from `value` + `progress` at `rateUnits` (0 when full, Infinity without regen). */
export function msUntilFull(value: number, progress: number, max: number, rateUnits: number): number {
  if (value >= max) return 0;
  if (!(rateUnits > 0)) return Number.POSITIVE_INFINITY;
  return Math.ceil(((max - Math.max(0, value)) * REGEN_UNIT - progress) / rateUnits);
}
