// Level curves and XP gain for the hero and skills.
import type { XpCurveConfig } from './config/xpCurve';
import type { LevelProgress } from './types';

const MAX = Number.MAX_SAFE_INTEGER;

type CurveCache = { multipliers: number[] /* index = level */ };
const caches = new WeakMap<XpCurveConfig, CurveCache>();

function growthAt(curve: XpCurveConfig, level: number): number {
  let growth = 1;
  for (const seg of curve.segments) {
    if (level >= seg.fromLevel) growth = seg.growth;
    else break;
  }
  return growth;
}

/** multiplier(L) = product of the growth of every level below L. Cached per curve. */
function multiplier(curve: XpCurveConfig, level: number): number {
  let cache = caches.get(curve);
  if (!cache) {
    cache = { multipliers: [1, 1] }; // index 0 unused, multiplier(1) = 1
    caches.set(curve, cache);
  }
  const m = cache.multipliers;
  for (let l = m.length; l <= level; l++) {
    m[l] = m[l - 1] * growthAt(curve, l - 1);
  }
  return m[level];
}

/**
 * level^power using only exactly-rounded IEEE 754 operations (multiply, sqrt), so every JS
 * engine (Hermes on the phone, V8 on a server) gets the same bits. Math.pow is not guaranteed
 * to be correctly rounded and can differ between runtimes. Supports whole and half powers.
 */
export function levelPower(level: number, power: number): number {
  const twice = power * 2;
  if (!Number.isInteger(twice) || power < 0) throw new RangeError(`levelPower: unsupported power ${power}`);
  let result = 1;
  for (let i = 0; i < Math.floor(power); i++) result *= level;
  if (twice % 2 === 1) result *= Math.sqrt(level);
  return result;
}

/**
 * XP needed to go from `level` to `level + 1`.
 * Clamped to Number.MAX_SAFE_INTEGER (reached only far beyond level 150; big numbers are a backlog item).
 */
export function xpToNext(curve: XpCurveConfig, level: number): number {
  if (!Number.isInteger(level) || level < 1) throw new RangeError(`xpToNext: invalid level ${level}`);
  const raw = Math.round(curve.base * levelPower(level, curve.power) * multiplier(curve, level));
  return Number.isFinite(raw) && raw < MAX ? raw : MAX;
}

/** Total XP needed to reach `level` from level 1 (0 for level 1). */
export function cumulativeXp(curve: XpCurveConfig, level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total = Math.min(MAX, total + xpToNext(curve, l));
  return total;
}

export function newProgress(curve: XpCurveConfig): LevelProgress {
  return { level: 1, xp: 0, xpToNext: xpToNext(curve, 1) };
}

/**
 * Adds XP, processing any number of level-ups and carrying the excess.
 * Invariant after the call: 0 <= xp < xpToNext.
 */
export function addXp(
  progress: LevelProgress,
  amount: number,
  curve: XpCurveConfig,
): { progress: LevelProgress; levelsGained: number } {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`addXp: invalid amount ${amount}`);
  let level = progress.level;
  let xp = Math.min(MAX, progress.xp + amount);
  let next = xpToNext(curve, level);
  let levelsGained = 0;
  while (xp >= next) {
    xp -= next;
    level += 1;
    levelsGained += 1;
    next = xpToNext(curve, level);
  }
  return { progress: { level, xp, xpToNext: next }, levelsGained };
}
