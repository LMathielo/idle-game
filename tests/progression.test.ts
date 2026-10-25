import { describe, expect, it } from 'vitest';
import { applyCommand, newGame } from '../src/engine';
import { HERO_XP_CURVE, SKILL_XP_CURVE } from '../src/engine/config/xpCurve';
import { addXp, cumulativeXp, levelPower, xpToNext } from '../src/engine/progression';
import { T0, cmd } from './helpers';

const REFERENCE: [number, number][] = [
  [1, 1500],
  [10, 47434],
  [20, 134164],
  [30, 401482],
  [40, 1006856],
  [50, 2768025],
  [60, 7157802],
  [80, 42644530],
  [100, 230623682],
];

describe('hero XP curve', () => {
  it.each(REFERENCE)('xpToNext(%i) ≈ %i (±1)', (level, expected) => {
    expect(Math.abs(xpToNext(HERO_XP_CURVE, level) - expected)).toBeLessThanOrEqual(1);
  });

  it('is strictly increasing up to the clamp', () => {
    let prev = 0;
    for (let l = 1; l <= 300; l++) {
      const v = xpToNext(HERO_XP_CURVE, l);
      if (v === Number.MAX_SAFE_INTEGER) break;
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it.each([20, 40, 100])('does not drop at segment boundary %i', (boundary) => {
    const before = xpToNext(HERO_XP_CURVE, boundary - 1);
    const at = xpToNext(HERO_XP_CURVE, boundary);
    const after = xpToNext(HERO_XP_CURVE, boundary + 1);
    expect(at).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(at);
  });

  it('clamps to MAX_SAFE_INTEGER far beyond level 150 and never returns NaN/Infinity', () => {
    expect(xpToNext(HERO_XP_CURVE, 150)).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(xpToNext(HERO_XP_CURVE, 300)).toBe(Number.MAX_SAFE_INTEGER);
    expect(xpToNext(HERO_XP_CURVE, 5000)).toBe(Number.MAX_SAFE_INTEGER);
    expect(cumulativeXp(HERO_XP_CURVE, 400)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('skill curve uses base 500 with the same shape', () => {
    expect(xpToNext(SKILL_XP_CURVE, 1)).toBe(500);
    expect(Math.abs(xpToNext(SKILL_XP_CURVE, 20) - 134164 / 3)).toBeLessThanOrEqual(1);
  });

  it('rejects invalid levels', () => {
    expect(() => xpToNext(HERO_XP_CURVE, 0)).toThrow();
    expect(() => xpToNext(HERO_XP_CURVE, 1.5)).toThrow();
  });
});

describe('levelPower (runtime-independent L^power)', () => {
  it('L^1.5 is computed as L × √L (exactly-rounded ops only)', () => {
    for (let l = 1; l <= 500; l++) expect(levelPower(l, 1.5)).toBe(l * Math.sqrt(l));
  });

  it('agrees with Math.pow after rounding for every level that matters', () => {
    for (let l = 1; l <= 160; l++) {
      expect(Math.round(1500 * levelPower(l, 1.5))).toBe(Math.round(1500 * Math.pow(l, 1.5)));
    }
  });

  it('supports whole and half powers only', () => {
    expect(levelPower(9, 2)).toBe(81);
    expect(levelPower(9, 0.5)).toBe(3);
    expect(levelPower(9, 0)).toBe(1);
    expect(() => levelPower(9, 1.6)).toThrow();
    expect(() => levelPower(9, -1)).toThrow();
  });
});

describe('addXp', () => {
  it('processes multiple level-ups in one call and carries the excess', () => {
    const start = { level: 1, xp: 0, xpToNext: 1500 };
    const amount = 1500 + xpToNext(HERO_XP_CURVE, 2) + 123;
    const res = addXp(start, amount, HERO_XP_CURVE);
    expect(res.levelsGained).toBe(2);
    expect(res.progress).toEqual({ level: 3, xp: 123, xpToNext: xpToNext(HERO_XP_CURVE, 3) });
  });

  it('keeps 0 <= xp < xpToNext', () => {
    let p = { level: 1, xp: 0, xpToNext: 500 };
    for (let i = 0; i < 500; i++) {
      p = addXp(p, 777 * (i % 7), SKILL_XP_CURVE).progress;
      expect(p.xp).toBeGreaterThanOrEqual(0);
      expect(p.xp).toBeLessThan(p.xpToNext);
    }
  });

  it('total XP is conserved across level-ups', () => {
    const res = addXp({ level: 1, xp: 0, xpToNext: 1500 }, 1_000_000, HERO_XP_CURVE);
    expect(cumulativeXp(HERO_XP_CURVE, res.progress.level) + res.progress.xp).toBe(1_000_000);
  });

  it('rejects negative or non-finite amounts', () => {
    const p = { level: 1, xp: 0, xpToNext: 1500 };
    expect(() => addXp(p, -1, HERO_XP_CURVE)).toThrow();
    expect(() => addXp(p, Number.NaN, HERO_XP_CURVE)).toThrow();
    expect(() => addXp(p, Number.POSITIVE_INFINITY, HERO_XP_CURVE)).toThrow();
  });

  it('skill multi level-up with carry-over', () => {
    const amount = 500 + xpToNext(SKILL_XP_CURVE, 2) + xpToNext(SKILL_XP_CURVE, 3) + 9;
    const res = addXp({ level: 1, xp: 0, xpToNext: 500 }, amount, SKILL_XP_CURVE);
    expect(res.levelsGained).toBe(3);
    expect(res.progress.level).toBe(4);
    expect(res.progress.xp).toBe(9);
  });
});

describe('DEBUG_GRANT_HERO_XP', () => {
  it('levels the hero along the curve with carry-over', () => {
    const s0 = newGame(1, T0);
    const res = applyCommand(s0, cmd({ type: 'DEBUG_GRANT_HERO_XP', amount: 10_000 }), T0);
    if (!res.ok) throw new Error(res.error.message);
    // 1500 (L1) + 4243 (L2) = 5743 → L3 with 4257 left (L3 needs 7794)
    expect(res.state.character.level).toBe(3);
    expect(res.state.character.xp).toBe(10_000 - 1500 - xpToNext(HERO_XP_CURVE, 2));
    expect(res.state.character.xpToNext).toBe(xpToNext(HERO_XP_CURVE, 3));
    expect(res.events.filter((e) => e.type === 'HERO_LEVEL_UP')).toHaveLength(1);
  });

  it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e13])('rejects amount %s', (amount) => {
    const res = applyCommand(newGame(1, T0), cmd({ type: 'DEBUG_GRANT_HERO_XP', amount }), T0);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVALID_AMOUNT');
  });
});
