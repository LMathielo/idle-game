// Diminishing returns (pure, integer): the shared curve for attribute effects that approach a cap but never reach it.
//
//   diminishing(value, cap, k) = cap × value ÷ (value + k)        (value ≥ 0; half the cap at value = k)
//
// Worked in basis points and floored, so it is exact and deterministic. Parameters live in data
// (config/stats.ts STAT_EFFECTS). Core INT's crafting time (1.13.0) and core DEX's activity time (1.16.0) use it.

/** floor(capBp × value ÷ (value + k)) in basis points; 0 for a value ≤ 0 or not a number, never above capBp. */
export function diminishingBp(value: number, capBp: number, k: number): number {
  if (!(value > 0) || !(capBp > 0) || !(k >= 0)) return 0;
  const v = Number.isFinite(value) ? Math.floor(value) : Number.MAX_SAFE_INTEGER;
  if (v <= 0) return 0;
  // capBp × v stays below 2^53 for any v below ~1.8e12 at a 5 000 bp cap; larger values are at the cap anyway.
  if (v > 1e12) return Math.min(capBp, Math.floor(capBp - (capBp * k) / (v + k)));
  return Math.floor((capBp * v) / (v + k));
}
