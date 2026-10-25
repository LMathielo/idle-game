// Seeded, pure PRNG (mulberry32). Every draw returns the advanced RNG state;
// callers must store it back into GameState so results are reproducible.
import type { RngState } from './types';

export type Draw<T> = { value: T; rng: RngState };

export function createRng(seed: number): RngState {
  return { seed: seed >>> 0 };
}

/** Uniform float in [0, 1). */
export function nextFloat(rng: RngState): Draw<number> {
  const a = (rng.seed + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, rng: { seed: a } };
}

/** Uniform integer in [min, max] (both inclusive). */
export function nextInt(rng: RngState, min: number, max: number): Draw<number> {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new RangeError(`nextInt: invalid range [${min}, ${max}]`);
  }
  const r = nextFloat(rng);
  return { value: min + Math.floor(r.value * (max - min + 1)), rng: r.rng };
}

/** True with probability p (clamped to [0, 1]). Always consumes one draw. */
export function chance(rng: RngState, p: number): Draw<boolean> {
  const r = nextFloat(rng);
  return { value: r.value < p, rng: r.rng };
}

export type WeightedEntry<T> = { value: T; weight: number };

/** Pick one entry proportionally to its weight. Always consumes one draw. */
export function weightedPick<T>(rng: RngState, table: readonly WeightedEntry<T>[]): Draw<T> {
  const total = table.reduce((sum, e) => sum + Math.max(0, e.weight), 0);
  if (table.length === 0 || !(total > 0)) throw new RangeError('weightedPick: empty table or zero total weight');
  const r = nextFloat(rng);
  let roll = r.value * total;
  for (const entry of table) {
    const w = Math.max(0, entry.weight);
    if (roll < w) return { value: entry.value, rng: r.rng };
    roll -= w;
  }
  // Floating point edge: fall back to the last entry with weight.
  const last = [...table].reverse().find((e) => e.weight > 0)!;
  return { value: last.value, rng: r.rng };
}
