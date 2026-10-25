import { describe, expect, it } from 'vitest';
import { chance, createRng, nextFloat, nextInt, weightedPick } from '../src/engine/rng';

function sequence(seed: number, n: number): number[] {
  let rng = createRng(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = nextFloat(rng);
    out.push(r.value);
    rng = r.rng;
  }
  return out;
}

describe('rng (mulberry32)', () => {
  it('same seed gives the same sequence', () => {
    expect(sequence(1234, 50)).toEqual(sequence(1234, 50));
  });

  it('different seeds give different sequences', () => {
    expect(sequence(1, 10)).not.toEqual(sequence(2, 10));
  });

  it('golden values for seed 42 (guards against accidental algorithm changes)', () => {
    expect(sequence(42, 3)).toMatchInlineSnapshot(`
      [
        0.6011037519201636,
        0.44829055899754167,
        0.8524657934904099,
      ]
    `);
  });

  it('every draw advances the stored seed and never mutates the input', () => {
    const rng = createRng(7);
    const a = nextFloat(rng);
    expect(rng.seed).toBe(7);
    expect(a.rng.seed).not.toBe(7);
    const b = nextFloat(a.rng);
    expect(b.rng.seed).not.toBe(a.rng.seed);
    expect(Number.isInteger(a.rng.seed) && a.rng.seed >= 0 && a.rng.seed <= 0xffffffff).toBe(true);
  });

  it('floats stay in [0, 1)', () => {
    for (const v of sequence(99, 10_000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt is inclusive and covers the range', () => {
    let rng = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const r = nextInt(rng, 1, 6);
      seen.add(r.value);
      rng = r.rng;
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(() => nextInt(rng, 5, 1)).toThrow();
  });

  it('chance(1/200) lands near 0.5% over a large N', () => {
    let rng = createRng(2026);
    const N = 400_000;
    let hits = 0;
    for (let i = 0; i < N; i++) {
      const r = chance(rng, 1 / 200);
      if (r.value) hits++;
      rng = r.rng;
    }
    const expected = N / 200; // 2000, sd ≈ 44.6
    expect(Math.abs(hits - expected)).toBeLessThan(5 * Math.sqrt(expected));
  });

  it('chance edge cases: 0 never, 1 always', () => {
    let rng = createRng(3);
    for (let i = 0; i < 1000; i++) {
      const no = chance(rng, 0);
      const yes = chance(no.rng, 1);
      expect(no.value).toBe(false);
      expect(yes.value).toBe(true);
      rng = yes.rng;
    }
  });

  it('weightedPick follows the weights', () => {
    let rng = createRng(11);
    const table = [
      { value: 'a', weight: 70 },
      { value: 'b', weight: 25 },
      { value: 'c', weight: 5 },
      { value: 'never', weight: 0 },
    ];
    const counts: Record<string, number> = {};
    const N = 100_000;
    for (let i = 0; i < N; i++) {
      const r = weightedPick(rng, table);
      counts[r.value] = (counts[r.value] ?? 0) + 1;
      rng = r.rng;
    }
    expect(counts.never).toBeUndefined();
    expect(counts.a / N).toBeCloseTo(0.7, 1);
    expect(counts.b / N).toBeCloseTo(0.25, 1);
    expect(counts.c / N).toBeCloseTo(0.05, 1);
    expect(() => weightedPick(rng, [])).toThrow();
  });
});
