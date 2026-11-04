import { describe, expect, it } from 'vitest';
import { applyCommand, type GameState, hashState, newGame, regenStamina, simulate, spendStamina, STAMINA, staminaView } from '../src/engine';
import { apply, HOUR, MIN, SEC, T0 } from './helpers';

const INTERVAL = STAMINA.regenIntervalMs;

/** New game at T0 with `current` stamina (regen timer at 0). */
function withStamina(current: number): GameState {
  const s = newGame(3, T0);
  return { ...s, stamina: { ...s.stamina, current } };
}

describe('stamina', () => {
  it('new hero starts full at 100/100 with no timer', () => {
    expect(newGame(1, T0).stamina).toEqual({ current: 100, max: 100, progressMs: 0 });
    expect(INTERVAL).toBe(300_000);
    expect(STAMINA).not.toHaveProperty('costs'); // replaced by the dungeon skip rule (config/dungeons.ts)
  });

  it('+1 every 5 minutes, exactly on the interval', () => {
    const s = withStamina(90);
    expect(simulate(s, T0 + INTERVAL - 1).state.stamina).toEqual({ current: 90, max: 100, progressMs: INTERVAL - 1 });
    expect(simulate(s, T0 + INTERVAL).state.stamina).toEqual({ current: 91, max: 100, progressMs: 0 });
    expect(simulate(s, T0 + 3 * INTERVAL).state.stamina.current).toBe(93);
  });

  it('keeps the remainder: many small resumes equal one big resume', () => {
    const s = withStamina(50);
    const once = simulate(s, T0 + 47 * MIN + 13 * SEC).state;
    expect(once.stamina).toEqual({ current: 59, max: 100, progressMs: 2 * MIN + 13 * SEC });
    let step = s;
    for (let t = 7 * SEC; t <= 47 * MIN + 13 * SEC; t += 7 * SEC) step = simulate(step, T0 + t).state;
    step = simulate(step, T0 + 47 * MIN + 13 * SEC).state;
    expect(step.stamina).toEqual(once.stamina);
    expect(hashState(step)).toBe(hashState(once));
  });

  it('caps at max and keeps progressMs at 0 while full', () => {
    const s = withStamina(99);
    const full = simulate(s, T0 + 3 * HOUR).state;
    expect(full.stamina).toEqual({ current: 100, max: 100, progressMs: 0 });
    // Waiting while full banks nothing: spending starts a fresh 5-minute timer.
    const later = simulate(full, T0 + 4 * HOUR).state;
    expect(later.stamina).toEqual({ current: 100, max: 100, progressMs: 0 });
    const spent = apply(later, { type: 'DEBUG_SPEND_STAMINA', amount: 10 }, T0 + 4 * HOUR);
    expect(spent.stamina).toEqual({ current: 90, max: 100, progressMs: 0 });
    expect(simulate(spent, T0 + 4 * HOUR + INTERVAL - 1).state.stamina.current).toBe(90);
    expect(simulate(spent, T0 + 4 * HOUR + INTERVAL).state.stamina.current).toBe(91);
  });

  it('a full bar keeps its stamina object (no needless re-render)', () => {
    const s = newGame(1, T0);
    expect(simulate(s, T0 + HOUR).state.stamina).toBe(s.stamina);
  });

  it('clock moved backwards: no regen until real time passes the highest time seen', () => {
    const s = simulate(withStamina(50), T0 + 10 * MIN).state; // 52, highestSeenAt = T0+10m
    expect(s.stamina.current).toBe(52);
    const back = simulate(s, T0 + 10 * MIN - 2 * HOUR);
    expect(back.summary.anomalies[0]).toMatchObject({ kind: 'backward' });
    expect(back.state.stamina).toEqual(s.stamina);
    // Still behind (catching up) → still nothing.
    expect(simulate(back.state, T0 + 9 * MIN).state.stamina).toEqual(s.stamina);
    // Past highestSeenAt again: only the time after it counts.
    expect(simulate(back.state, T0 + 15 * MIN).state.stamina.current).toBe(53);
  });

  it('invalid time is a no-op', () => {
    const s = withStamina(10);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '1' as unknown as number]) {
      const r = simulate(s, bad);
      expect(r.state).toBe(s);
      expect(r.events[0]).toMatchObject({ type: 'ERROR', code: 'INVALID_TIME' });
    }
  });

  it('far forward jump: not bound by the 8h activity cap, fills to max and never beyond', () => {
    // From 0, 9h is 108 intervals. Capped at 8h it would be 96; uncapped it fills the bar.
    const empty = withStamina(0);
    const r = simulate(empty, T0 + 9 * HOUR);
    expect(r.summary.grantedMs).toBe(8 * HOUR); // activities are still capped
    expect(r.state.stamina).toEqual({ current: 100, max: 100, progressMs: 0 });
    // A whole year forward: still exactly max.
    expect(simulate(empty, T0 + 365 * 24 * HOUR).state.stamina).toEqual({ current: 100, max: 100, progressMs: 0 });
    // Under the cap the result is the same as plain regen.
    expect(simulate(empty, T0 + 7 * HOUR + 2 * MIN).state.stamina).toEqual({ current: 84, max: 100, progressMs: 2 * MIN });
  });

  it('full regen from empty takes 100 × 5 min = 8h20', () => {
    const empty = withStamina(0);
    expect(simulate(empty, T0 + 8 * HOUR + 20 * MIN - 1).state.stamina.current).toBe(99);
    expect(simulate(empty, T0 + 8 * HOUR + 20 * MIN).state.stamina.current).toBe(100);
    expect(staminaView(empty).fullInMs).toBe(8 * HOUR + 20 * MIN);
  });

  it('a raised max (future upgrade) regenerates towards the new max', () => {
    const s = { ...newGame(1, T0), stamina: { current: 100, max: 120, progressMs: 0 } };
    expect(simulate(s, T0 + HOUR).state.stamina).toEqual({ current: 112, max: 120, progressMs: 0 });
  });

  it('regenStamina is pure and handles odd input safely', () => {
    const st = { current: 5, max: 100, progressMs: 100 };
    expect(regenStamina(st, 0)).toBe(st);
    expect(regenStamina(st, -5)).toBe(st);
    expect(regenStamina(st, Number.NaN)).toBe(st);
    expect(regenStamina({ current: 120, max: 100, progressMs: 7 }, 10)).toEqual({ current: 120, max: 100, progressMs: 0 });
    expect(st).toEqual({ current: 5, max: 100, progressMs: 100 });
  });

  it('staminaView: countdown to the next point and to full', () => {
    expect(staminaView(newGame(1, T0))).toEqual({ current: 100, max: 100, full: true, nextInMs: 0, fullInMs: 0 });
    const s = { stamina: { current: 90, max: 100, progressMs: 60_000 } };
    expect(staminaView(s)).toEqual({ current: 90, max: 100, full: false, nextInMs: 240_000, fullInMs: 240_000 + 9 * INTERVAL });
  });
});

describe('spendStamina', () => {
  it('spends and returns a new state, input untouched', () => {
    const s = newGame(1, T0);
    const r = spendStamina(s, 25);
    expect(r.ok && r.state.stamina).toEqual({ current: 75, max: 100, progressMs: 0 });
    expect(s.stamina.current).toBe(100);
  });

  it('can spend down to exactly 0', () => {
    const r = spendStamina(withStamina(10), 10);
    expect(r.ok && r.state.stamina.current).toBe(0);
  });

  it('typed error when there is not enough stamina', () => {
    const s = withStamina(9);
    expect(spendStamina(s, 10)).toEqual({ ok: false, error: { code: 'NOT_ENOUGH_STAMINA', message: expect.any(String) } });
    expect(s.stamina.current).toBe(9);
  });

  it('typed error on a bad amount', () => {
    const s = newGame(1, T0);
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '10' as unknown as number]) {
      expect(spendStamina(s, bad)).toMatchObject({ ok: false, error: { code: 'INVALID_AMOUNT' } });
    }
  });

  it('DEBUG_SPEND_STAMINA counts regen up to now before spending', () => {
    const s = withStamina(9);
    // At T0+5m regen gives the 10th point, so spending 10 works.
    const r = applyCommand(s, { id: 'a', type: 'DEBUG_SPEND_STAMINA', amount: 10 }, T0 + INTERVAL);
    expect(r.ok && r.state.stamina).toEqual({ current: 0, max: 100, progressMs: 0 });
    const tooSoon = applyCommand(s, { id: 'b', type: 'DEBUG_SPEND_STAMINA', amount: 10 }, T0 + INTERVAL - 1);
    expect(tooSoon).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_STAMINA' } });
  });
});
