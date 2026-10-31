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

/** Hero growth segments (unchanged since engine 1.1.0). */
const HERO_SEGMENTS: readonly GrowthSegment[] = [
  { fromLevel: 1, growth: 1.0 },
  { fromLevel: 20, growth: 1.05 },
  { fromLevel: 40, growth: 1.07 },
  { fromLevel: 100, growth: 1.18 },
];

/**
 * Skill growth segments (engine 1.12.0). Flat to Lv15 so Lv1 → 15 takes about a day of gathering, then steeper than
 * the hero's from Lv15 (1.07 instead of 1.05 from Lv20) and from Lv40 (1.08 instead of 1.07): the late game stays long.
 */
const SKILL_SEGMENTS: readonly GrowthSegment[] = [
  { fromLevel: 1, growth: 1.0 },
  { fromLevel: 15, growth: 1.07 },
  { fromLevel: 40, growth: 1.08 },
  { fromLevel: 100, growth: 1.18 },
];

/**
 * Hero. Base 100 since engine 1.8.0 (was 1500): Lv5 needs 1,703 XP, about 49 Rat Cellar wins, so a new player
 * gets there in the first minutes with the 100 starting stamina. No level cap.
 */
export const HERO_XP_CURVE: XpCurveConfig = { base: 100, power: 1.5, segments: HERO_SEGMENTS };

/**
 * Woodcutting, mining and every other skill. Base 100 since engine 1.12.0 (was 500): Lv15 needs 31,998 XP, about 23.5 h
 * of gathering at DEX 0 (Oak to Lv5, then Birch); 22.6 h at DEX 10. Own segments (above). Table in docs/ENGINE.md.
 */
export const SKILL_XP_CURVE: XpCurveConfig = { base: 100, power: 1.5, segments: SKILL_SEGMENTS };
