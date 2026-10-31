// Power-based gathering yield (1.10.0): items per action = power ÷ requirement × bonus, whole part guaranteed,
// fraction = chance of one more (seeded RNG). XP and the rare drop stay per action.
import { describe, expect, it } from 'vitest';
import { applyCommand, type GameState, nextInt, ROCKS, simulate, TREES } from '../src/engine';
import { rollYield, yieldBp } from '../src/engine/gathering';
import { builtGame, cmd, MIN, qty, SEC, T0 } from './helpers';

const OAK_MS = 2 * MIN - 10 * SEC; // DEX 10

/** A hero with `str` extra STR (base attribute) and woodcutting / mining started on Oak / Stone. */
function gatherer(kind: 'woodcutting' | 'mining', str = 0, seed = 7): GameState {
  let s = builtGame(seed, T0);
  s = { ...s, character: { ...s.character, attributes: { ...s.character.attributes, strength: s.character.attributes.strength + str } } };
  const c = kind === 'woodcutting' ? cmd({ type: 'START_ACTIVITY', kind, treeId: 'oak' }) : cmd({ type: 'START_ACTIVITY', kind, rockId: 'stone' });
  const r = applyCommand(s, c, T0);
  if (!r.ok) throw new Error(r.error.message);
  return r.state;
}

describe('yield math (integer basis points)', () => {
  it('power 30 on requirement 20 = 1.5 items: 15 000 bp', () => {
    expect(yieldBp(30, 20, 10_000)).toBe(15_000);
    expect(yieldBp(21, 20, 10_000)).toBe(10_500);
    expect(yieldBp(20, 20, 10_000)).toBe(10_000);
    // Bonus multiplier: +20% → ×1.2.
    expect(yieldBp(30, 20, 12_000)).toBe(18_000);
    // Truncates below 1 bp, never rounds up.
    expect(yieldBp(1, 3, 10_000)).toBe(3333);
    // Never divides by 0; nothing from no power.
    expect(yieldBp(10, 0, 10_000)).toBe(100_000);
    expect(yieldBp(0, 20, 10_000)).toBe(0);
    expect(yieldBp(-5, 20, 10_000)).toBe(0);
  });

  it('whole part guaranteed, fraction = chance of one more, exactly one draw per roll', () => {
    let rng = { seed: 99 };
    let extra = 0;
    const N = 20_000;
    for (let i = 0; i < N; i += 1) {
      const before = nextInt(rng, 0, 9999).rng; // one draw from the same seed
      const r = rollYield(rng, 15_000);
      expect(r.rng).toEqual(before);
      expect([1, 2]).toContain(r.count);
      extra += r.count - 1;
      rng = r.rng;
    }
    expect(extra / N).toBeGreaterThan(0.48);
    expect(extra / N).toBeLessThan(0.52);
    // A whole number of items: no roll can change it.
    let r2 = { seed: 5 };
    for (let i = 0; i < 1000; i += 1) {
      const r = rollYield(r2, 30_000);
      expect(r.count).toBe(3);
      r2 = r.rng;
    }
    // Below one item: 0 or 1.
    expect([0, 1]).toContain(rollYield({ seed: 1 }, 2500).count);
  });

  it('outcomes are whole numbers (no floats reach the inventory)', () => {
    const s = simulate(gatherer('woodcutting', 7), T0 + 60 * MIN).state;
    for (const it of s.inventory.items) expect(Number.isSafeInteger(it.quantity ?? 1)).toBe(true);
  });
});

describe('hero yield on the trees and rocks', () => {
  it('Oak and Stone need 20 power; a new hero (21) gets 1 item per action plus a 5% chance of a second', () => {
    expect(TREES.oak.reqWs).toBe(20);
    expect(ROCKS.stone.reqMs).toBe(20);
    for (const kind of ['woodcutting', 'mining'] as const) {
      // 3 actions stay at skill level 1 (the 4th reaches 100 XP), so WS stays 21.
      const r = simulate(gatherer(kind), T0 + 3 * OAK_MS);
      const item = kind === 'woodcutting' ? 'oak_logs' : 'stone';
      const actions = kind === 'woodcutting' ? r.summary.actions : r.summary.oresMined;
      expect(actions).toBe(3);
      const got = r.summary.itemsGained[item] ?? 0;
      expect(got).toBeGreaterThanOrEqual(3);
      expect(got).toBeLessThanOrEqual(3 + 3);
    }
  });

  it('power 30 on Oak (STR 19 extra → WS 30): 1 log per cut plus 50% chance, i.e. ~1.5 per cut', () => {
    const s = gatherer('woodcutting', 9); // 10 (level) + 19 STR + 1 axe = 30
    const r = simulate(s, T0 + 200 * OAK_MS);
    expect(r.summary.actions).toBe(200); // levels up along the way, so WS rises above 30
    const per = (r.summary.itemsGained.oak_logs ?? 0) / r.summary.actions;
    expect(per).toBeGreaterThan(1.4);
  });

  it('skill XP stays per action (not per item), and the rare drop is one roll per action', () => {
    const strong = gatherer('woodcutting', 200); // WS ≥ 220 → ≥ 11 logs per cut
    const r = simulate(strong, T0 + 10 * OAK_MS);
    expect(r.summary.actions).toBe(10);
    expect(r.summary.itemsGained.oak_logs).toBeGreaterThanOrEqual(110);
    expect(r.summary.skillXpGained.woodcutting).toBe(10 * TREES.oak.xpPerLog);
    // Two draws per cut (yield + nest), never more, whatever the yield.
    let rng = strong.rng;
    for (let i = 0; i < 20; i += 1) rng = nextInt(rng, 0, 1).rng;
    expect(r.state.rng).toEqual(rng);
  });

  it('the stamina skip of one log also rolls the yield', () => {
    const s = gatherer('woodcutting', 200);
    const r = applyCommand(s, cmd({ type: 'SKIP_WOODCUT', log: 1, maxCost: 2 }), T0);
    if (!r.ok) throw new Error(r.error.message);
    expect(qty(r.state, 'oak_logs')).toBeGreaterThanOrEqual(11);
  });

  it('views show the expected yield per action', async () => {
    const { woodcuttingView, miningView } = await import('../src/engine');
    const s = gatherer('woodcutting');
    expect(woodcuttingView(s).trees[0].yieldBp).toBe(10_500);
    expect(miningView(s).rocks[0].yieldBp).toBe(10_500);
  });
});
