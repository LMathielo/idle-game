import { describe, expect, it } from 'vitest';
import { applyCommand, type Command, hashState, newGame, simulate } from '../src/engine';
import { canonicalJson, fnv1a32 } from '../src/engine/hash';
import { HOUR, MIN, SEC, T0 } from './helpers';

type Step = { at: number; cmd?: Command };

const SCRIPT: Step[] = [
  { at: T0 + SEC, cmd: { id: 'c1', type: 'START_ACTIVITY', kind: 'woodcutting' } },
  { at: T0 + 10 * MIN },
  { at: T0 + 3 * HOUR },
  { at: T0 + 3 * HOUR + 5 * SEC, cmd: { id: 'c2', type: 'DEBUG_GRANT_HERO_XP', amount: 10_000 } },
  { at: T0 + 20 * HOUR }, // capped
  { at: T0 + 19 * HOUR }, // backward
  { at: T0 + 21 * HOUR, cmd: { id: 'c3', type: 'STOP_ACTIVITY' } },
];

function run(seed: number) {
  let s = newGame(seed, T0);
  const hashes: string[] = [];
  for (const step of SCRIPT) {
    if (step.cmd) {
      const r = applyCommand(s, step.cmd, step.at);
      if (!r.ok) throw new Error(r.error.message);
      s = r.state;
    } else {
      s = simulate(s, step.at).state;
    }
    hashes.push(hashState(s));
  }
  return { state: s, hashes };
}

describe('determinism', () => {
  it('same seed + same command list → same state hash at every step', () => {
    const a = run(424242);
    const b = run(424242);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.state).toEqual(b.state);
  });

  it('the RNG is actually used: the seed advances by exactly one draw per action', () => {
    const { state } = run(424242);
    const actions = state.stats.totalActions;
    expect(actions).toBeGreaterThan(5000);
    // One bird-nest roll per action; mulberry32 adds 0x6d2b79f5 to the seed per draw.
    expect(state.rng.seed).toBe((424242 + Math.imul(actions, 0x6d2b79f5)) >>> 0);
  });

  it('a different seed gives a different outcome over a long run (not just a different seed)', () => {
    const nests = (seed: number) => {
      const { state } = run(seed);
      return state.stats.itemsGathered.bird_nest ?? 0;
    };
    const outcomes = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(nests));
    // Same action count for every seed, so any spread comes from the dice alone.
    expect(new Set([1, 2, 3].map((s) => run(s).state.stats.totalActions)).size).toBe(1);
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('newGame is a pure function of (seed, now)', () => {
    expect(hashState(newGame(9, T0))).toBe(hashState(newGame(9, T0)));
    expect(hashState(newGame(9, T0))).not.toBe(hashState(newGame(9, T0 + 1)));
  });
});

describe('hash', () => {
  it('canonical JSON sorts keys at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}');
  });

  it('key order does not change the hash; values do', () => {
    expect(hashState({ a: 1, b: 2 })).toBe(hashState({ b: 2, a: 1 }));
    expect(hashState({ a: 1, b: 2 })).not.toBe(hashState({ a: 1, b: 3 }));
  });

  it('FNV-1a 32-bit reference vectors', () => {
    expect(fnv1a32('')).toBe('811c9dc5');
    expect(fnv1a32('a')).toBe('e40c292c');
    expect(fnv1a32('foobar')).toBe('bf9cf968');
  });

  it('hashes non-ASCII text as UTF-8', () => {
    expect(fnv1a32('🪵')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a32('🪵')).not.toBe(fnv1a32('🪺'));
  });

  it('rejects non-finite numbers (they cannot round-trip through JSON)', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });
});
