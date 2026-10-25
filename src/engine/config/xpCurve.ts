// XP curves (data). xpToNext(L) = round(base * L^power * multiplier(L)),
// where multiplier(L) is the product of the per-level growth of every level below L.
// See docs/ENGINE.md for the reference table.

export type GrowthSegment = { fromLevel: number; growth: number };

export type XpCurveConfig = {
  base: number;
  /** Whole or half number only (1.5 = L × √L), so the result is identical on every JS runtime. */
  power: number;
  /** Sorted by fromLevel; the first segment must start at level 1. */
  segments: readonly GrowthSegment[];
};

const SEGMENTS: readonly GrowthSegment[] = [
  { fromLevel: 1, growth: 1.0 },
  { fromLevel: 20, growth: 1.05 },
  { fromLevel: 40, growth: 1.07 },
  { fromLevel: 100, growth: 1.18 },
];

/** Hero: ~2 days of play to Lv20, more than a year to Lv100. No level cap. */
export const HERO_XP_CURVE: XpCurveConfig = { base: 1500, power: 1.5, segments: SEGMENTS };

/** Woodcutting and every other skill. */
export const SKILL_XP_CURVE: XpCurveConfig = { base: 500, power: 1.5, segments: SEGMENTS };
