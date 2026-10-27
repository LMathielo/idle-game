import { describe, expect, it } from 'vitest';
import { applyCommand, hashState, itemQuantity, newGame, simulate, type GameState } from '../src/engine';
import { CLOCK_BACKWARD_TOLERANCE_MS, DEFAULT_OFFLINE_CAP_MS } from '../src/engine/config/time';
import { HOUR, MIN, SEC, T0, apply, cmd, qty, woodcuttingGame, progressMs } from './helpers';

/** Oak at DEX 10: 2:00 − 10 s = 1:50 per log, 25 XP. */
const OAK_MS = 110 * SEC;

describe('woodcutting rules (Oak)', () => {
  it('each log gives 1 Oak Logs and 25 woodcutting XP, no hero XP', () => {
    const s = woodcuttingGame();
    const { state, summary } = simulate(s, T0 + 3 * OAK_MS);
    expect(summary.actions).toBe(3);
    expect(qty(state, 'oak_logs')).toBe(3);
    expect(state.character.skills.woodcutting.xp).toBe(75);
    expect(state.character.xp).toBe(0);
    expect(summary.heroXpGained).toBe(0);
    expect(state.stats.totalActions).toBe(3);
    expect(state.stats.itemsGathered.oak_logs).toBe(3);
  });

  it('keeps the partial remainder between resumes', () => {
    const s = woodcuttingGame();
    const a = simulate(s, T0 + 100 * SEC).state;
    expect(progressMs(a)).toBe(100 * SEC);
    expect(qty(a, 'oak_logs')).toBe(0);
    const b = simulate(a, T0 + 115 * SEC).state;
    expect(qty(b, 'oak_logs')).toBe(1);
    expect(progressMs(b)).toBe(5 * SEC);
  });

  it('bird nest drops at ~1/200 over a long run and rolls the seeded RNG', () => {
    // Fastest logs (10 s floor) so the sample is large.
    let s = woodcuttingGame(7);
    s = { ...s, character: { ...s.character, attributes: { ...s.character.attributes, dexterity: 500 } } };
    let actions = 0;
    for (let i = 0; i < 40; i++) {
      const r = simulate(s, s.time.lastSimulatedAt + DEFAULT_OFFLINE_CAP_MS);
      actions += r.summary.actions;
      s = r.state;
    }
    const nests = qty(s, 'bird_nest');
    expect(actions).toBe(40 * 2880);
    const expected = actions / 200;
    expect(Math.abs(nests - expected)).toBeLessThan(5 * Math.sqrt(expected));
    expect(s.rng.seed).not.toBe(woodcuttingGame(7).rng.seed);
  });

  it('a level-up never changes the cut time (it depends on DEX only)', () => {
    const s = woodcuttingGame();
    // 20 logs × 25 XP = 500 XP = Lv2 exactly at log 20; log 21 still takes 1:50.
    const r = simulate(s, T0 + 21 * OAK_MS);
    expect(r.summary.actions).toBe(21);
    expect(r.summary.skillLevelsGained.woodcutting).toBe(1);
    expect(r.state.character.skills.woodcutting.level).toBe(2);
    expect(progressMs(r.state)).toBe(0);
  });

  it('inventory full: logs still stack, a new stack is lost and counted', () => {
    const base = woodcuttingGame(3);
    const full: GameState = {
      ...base,
      inventory: {
        capacity: 20,
        items: Array.from({ length: 20 }, (_, i) => ({ id: `junk-${i}`, defId: 'junk', name: 'Junk', icon: '?', rarity: 'common' as const })),
      },
    };
    const r = simulate(full, T0 + 10 * OAK_MS);
    expect(r.summary.actions).toBe(10);
    expect(r.summary.itemsLost.oak_logs).toBe(10);
    expect(r.summary.itemsGained.oak_logs).toBeUndefined();
    expect(r.state.inventory.items).toHaveLength(20);
    // skill XP still granted
    expect(r.summary.skillXpGained.woodcutting).toBe(250);

    // With an existing logs stack, logs keep stacking even when every slot is taken.
    const withLogs: GameState = {
      ...full,
      inventory: {
        capacity: 20,
        items: [{ id: 'oak_logs', defId: 'oak_logs', name: 'Oak Logs', icon: '🪵', rarity: 'common', stackable: true, quantity: 5 }, ...full.inventory.items.slice(1)],
      },
    };
    const r2 = simulate(withLogs, T0 + 10 * OAK_MS);
    expect(qty(r2.state, 'oak_logs')).toBe(15);
    expect(r2.summary.itemsLost.oak_logs).toBeUndefined();

    // Stacks are matched by defId, not by instance id.
    const oddId: GameState = {
      ...full,
      inventory: {
        capacity: 20,
        items: [{ ...withLogs.inventory.items[0], id: 'logs-stack-1' }, ...full.inventory.items.slice(1)],
      },
    };
    const r3 = simulate(oddId, T0 + 10 * OAK_MS);
    expect(r3.state.inventory.items[0]).toMatchObject({ id: 'logs-stack-1', defId: 'oak_logs', quantity: 15 });
    expect(itemQuantity(r3.state, 'oak_logs')).toBe(15);
    expect(r3.summary.itemsLost.oak_logs).toBeUndefined();
  });

  it('idle hero (no activity) only moves time', () => {
    const s = newGame(1, T0);
    const r = simulate(s, T0 + HOUR);
    expect(r.summary.actions).toBe(0);
    expect(r.state.time.lastSimulatedAt).toBe(T0 + HOUR);
    expect(r.state.inventory).toEqual(s.inventory);
  });

  it('never mutates its input', () => {
    const s = woodcuttingGame();
    const before = JSON.stringify(s);
    simulate(s, T0 + HOUR);
    simulate(s, T0 - HOUR);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('time rules', () => {
  it('a. elapsed = now − lastSimulatedAt', () => {
    const s = woodcuttingGame();
    const r = simulate(s, T0 + 5 * MIN);
    expect(r.summary.requestedMs).toBe(5 * MIN);
    expect(r.summary.grantedMs).toBe(5 * MIN);
    expect(r.summary.actions).toBe(2); // 2 × 1:50, 80 s banked
    expect(r.state.time.lastSimulatedAt).toBe(T0 + 5 * MIN);
  });

  it('b. clock moved backwards: 0 granted, nothing moves back, anomaly, paused until real time catches up', () => {
    const s = simulate(woodcuttingGame(), T0 + HOUR).state;
    const back = T0 + HOUR - 2 * HOUR;
    const r = simulate(s, back);
    expect(r.state).toBe(s); // untouched
    expect(r.summary.grantedMs).toBe(0);
    expect(r.summary.actions).toBe(0);
    expect(r.events).toEqual([{ type: 'CLOCK_ANOMALY', kind: 'backward', deltaMs: 2 * HOUR }]);
    expect(r.summary.anomalies).toHaveLength(1);

    // Still paused while real time has not passed highestSeenAt.
    const later = simulate(r.state, back + HOUR);
    expect(later.summary.actions).toBe(0);
    expect(later.state.time.highestSeenAt).toBe(T0 + HOUR);

    // Once real time passes highestSeenAt, only time after it counts. No other penalty:
    // the result is identical to never having had the clock excursion.
    const caught = simulate(later.state, T0 + HOUR + 30 * SEC);
    expect(caught.summary.anomalies).toHaveLength(0);
    expect(caught.summary.grantedMs).toBe(30 * SEC);
    expect(hashState(caught.state)).toBe(hashState(simulate(s, T0 + HOUR + 30 * SEC).state));
  });

  it('c. backward jitter within tolerance: 0 elapsed, no anomaly', () => {
    const s = simulate(woodcuttingGame(), T0 + MIN).state;
    const r = simulate(s, T0 + MIN - CLOCK_BACKWARD_TOLERANCE_MS);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
    expect(r.summary.anomalies).toEqual([]);
    expect(r.summary.grantedMs).toBe(0);
    // exactly one ms beyond the tolerance is an anomaly
    expect(simulate(s, T0 + MIN - CLOCK_BACKWARD_TOLERANCE_MS - 1).summary.anomalies).toHaveLength(1);
  });

  it('d. elapsed above the cap: grant exactly the cap, anomaly, excess forfeited', () => {
    const s = woodcuttingGame();
    const r = simulate(s, T0 + 24 * HOUR);
    expect(r.summary.requestedMs).toBe(24 * HOUR);
    expect(r.summary.grantedMs).toBe(8 * HOUR);
    expect(r.events[0]).toEqual({ type: 'CLOCK_ANOMALY', kind: 'forward_capped', requestedMs: 24 * HOUR, grantedMs: 8 * HOUR });
    expect(r.state.time.lastSimulatedAt).toBe(T0 + 24 * HOUR);
    // Same rewards as exactly 8h: nothing banked.
    const exact = simulate(s, T0 + 8 * HOUR);
    expect(exact.summary.anomalies).toHaveLength(0);
    expect(r.summary.actions).toBe(exact.summary.actions);
    expect(r.state.inventory).toEqual(exact.state.inventory);
    // Next resume a second later grants one second, not the forfeited 16h.
    expect(simulate(r.state, T0 + 24 * HOUR + SEC).summary.grantedMs).toBe(SEC);
  });

  it('d. the cap is per player (a future upgrade can raise it)', () => {
    const s = { ...woodcuttingGame(), offline: { capMs: 12 * HOUR, efficiency: 0.5 } };
    const r = simulate(s, T0 + 24 * HOUR);
    expect(r.summary.grantedMs).toBe(12 * HOUR);
    expect(progressMs(r.state)! + r.summary.actions * 0).toBeGreaterThanOrEqual(0);
    // efficiency 0.5: 6h of effective progress
    const full = simulate({ ...woodcuttingGame(), offline: { capMs: 12 * HOUR, efficiency: 1 } }, T0 + 6 * HOUR);
    expect(r.summary.actions).toBe(full.summary.actions);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined as unknown as number])(
    'e. non-finite now (%s) is a no-op with an error event',
    (bad) => {
      const s = woodcuttingGame();
      const r = simulate(s, bad);
      expect(r.state).toBe(s);
      expect(r.events).toHaveLength(1);
      expect(r.events[0].type).toBe('ERROR');
      expect(r.summary.grantedMs).toBe(0);
    },
  );

  it('f. highestSeenAt = max(highestSeenAt, now) whenever now is accepted', () => {
    const s = woodcuttingGame();
    const a = simulate(s, T0 + MIN).state;
    expect(a.time.highestSeenAt).toBe(T0 + MIN);
    const jitter = simulate(a, T0 + MIN - 10 * SEC).state;
    expect(jitter.time.highestSeenAt).toBe(T0 + MIN);
    const b = simulate(jitter, T0 + 2 * MIN).state;
    expect(b.time.highestSeenAt).toBe(T0 + 2 * MIN);
  });

  it('100 resumes of 1s equal one resume of 100s (identical hash)', () => {
    const s = woodcuttingGame(99);
    let stepped = s;
    for (let i = 1; i <= 100; i++) stepped = simulate(stepped, T0 + i * SEC).state;
    const once = simulate(s, T0 + 100 * SEC).state;
    expect(hashState(stepped)).toBe(hashState(once));
  });

  it('irregular chunks over 8h equal one 8h resume (identical hash)', () => {
    const s = woodcuttingGame(5);
    let stepped = s;
    let t = T0;
    let i = 0;
    while (t < T0 + 8 * HOUR) {
      t = Math.min(T0 + 8 * HOUR, t + 997 + ((i++ * 7919) % 120_000));
      stepped = simulate(stepped, t).state;
    }
    expect(hashState(stepped)).toBe(hashState(simulate(s, T0 + 8 * HOUR).state));
  });

  it('the same now twice grants nothing the second time', () => {
    const s = woodcuttingGame();
    const a = simulate(s, T0 + HOUR);
    const b = simulate(a.state, T0 + HOUR);
    expect(a.summary.actions).toBeGreaterThan(0);
    expect(b.summary.actions).toBe(0);
    expect(b.summary.grantedMs).toBe(0);
    expect(hashState(b.state)).toBe(hashState(a.state));
  });

  it('exploit: clock forward, collect, clock back, collect again → rewarded only once', () => {
    const s = woodcuttingGame();
    const fwd = simulate(s, T0 + 8 * HOUR);
    const back = simulate(fwd.state, T0 + MIN);
    const fwdAgain = simulate(back.state, T0 + 8 * HOUR);
    expect(back.summary.actions).toBe(0);
    expect(back.summary.anomalies[0]?.kind).toBe('backward');
    expect(fwdAgain.summary.actions).toBe(0);
    expect(qty(fwdAgain.state, 'oak_logs')).toBe(qty(fwd.state, 'oak_logs'));
  });

  it('8h cap: worst-case loop (10 s floor) stays bounded', () => {
    const s = woodcuttingGame();
    const fast: GameState = { ...s, character: { ...s.character, attributes: { ...s.character.attributes, dexterity: 1_000_000 } } };
    const started = performance.now();
    const r = simulate(fast, T0 + 8 * HOUR);
    expect(r.summary.actions).toBe(2880);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('commands', () => {
  it('START_ACTIVITY then STOP_ACTIVITY', () => {
    const s = newGame(1, T0);
    const started = apply(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0);
    expect(started.activity).toEqual({ kind: 'woodcutting', treeId: 'oak', startedAt: T0, progressMs: 0 });
    const stopped = apply(started, { type: 'STOP_ACTIVITY' }, T0 + 3 * OAK_MS + 10 * SEC);
    expect(stopped.activity).toBeNull();
    // rewards up to the stop are kept
    expect(qty(stopped, 'oak_logs')).toBe(3);
  });

  it('simulates up to now before applying (no reward lost or double-counted)', () => {
    const s = woodcuttingGame();
    const res = applyCommand(s, cmd({ type: 'STOP_ACTIVITY' }), T0 + 10 * OAK_MS + 30 * SEC);
    if (!res.ok) throw new Error();
    expect(res.summary.actions).toBe(10);
    expect(qty(res.state, 'oak_logs')).toBe(10);
    // a later simulate grants nothing for the stopped activity
    expect(simulate(res.state, T0 + HOUR).summary.actions).toBe(0);
  });

  it('starting the running activity again keeps its banked progress', () => {
    const s = simulate(woodcuttingGame(), T0 + 2 * SEC).state;
    const again = apply(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0 + 2 * SEC);
    expect(progressMs(again)).toBe(2000);
  });

  it('DEBUG_GRANT_HERO_XP sets flags.debugUsed; normal commands do not', () => {
    const s = newGame(1, T0);
    const normal = apply(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0);
    expect(normal.flags.debugUsed).toBe(false);
    const debug = apply(normal, { type: 'DEBUG_GRANT_HERO_XP', amount: 1 }, T0);
    expect(debug.flags.debugUsed).toBe(true);
    expect(apply(debug, { type: 'STOP_ACTIVITY' }, T0 + HOUR).flags.debugUsed).toBe(true);
    expect(simulate(debug, T0 + HOUR).state.flags.debugUsed).toBe(true);
  });

  it('allowDebug: false rejects DEBUG_* commands with a typed error', () => {
    const res = applyCommand(newGame(1, T0), cmd({ type: 'DEBUG_GRANT_HERO_XP', amount: 1 }), T0, { allowDebug: false });
    expect(res).toEqual({ ok: false, error: expect.objectContaining({ code: 'DEBUG_DISABLED' }) });
  });

  it('typed errors, input untouched', () => {
    const s = newGame(1, T0);
    const unknown = applyCommand(s, cmd({ type: 'START_ACTIVITY', kind: 'fishing' as 'woodcutting', treeId: 'oak' }), T0);
    expect(unknown).toEqual({ ok: false, error: expect.objectContaining({ code: 'UNKNOWN_ACTIVITY' }) });
    const stop = applyCommand(s, cmd({ type: 'STOP_ACTIVITY' }), T0);
    expect(stop).toEqual({ ok: false, error: expect.objectContaining({ code: 'NO_ACTIVE_ACTIVITY' }) });
    const badType = applyCommand(s, { id: 'x', type: 'NOPE' } as never, T0);
    expect(badType).toEqual({ ok: false, error: expect.objectContaining({ code: 'INVALID_COMMAND' }) });
    const noId = applyCommand(s, { type: 'STOP_ACTIVITY' } as never, T0);
    expect(noId).toEqual({ ok: false, error: expect.objectContaining({ code: 'INVALID_COMMAND' }) });
    const badTime = applyCommand(s, cmd({ type: 'STOP_ACTIVITY' }), Number.NaN);
    expect(badTime).toEqual({ ok: false, error: expect.objectContaining({ code: 'INVALID_TIME' }) });
    expect(s.activity).toBeNull();
  });
});
