// Phone flow through the client: start runs, live ticks through the search and the live fight, skip, debug
// rows, offline catch-up, and the action log replaying to the same hashes.
import { describe, expect, it } from 'vitest';
import type { MemoryGameRepository } from '../src/client/memoryRepository';
import { dungeonRunView, type GameState, hashState, hpView, replayLog, replayStep } from '../src/engine';
import { current, HOUR, makeClient, MIN, SEC, T0, progressMs, debugBuild } from './helpers';

async function verifyLog(repo: MemoryGameRepository): Promise<GameState> {
  const rows = await repo.getAllLog();
  let state: GameState | null = null;
  for (const row of rows) {
    state = replayStep(state, { type: row.type, payload: row.payload, clientTime: row.clientTime });
    expect({ seq: row.seq, type: row.type, hash: hashState(state) }).toEqual({ seq: row.seq, type: row.type, hash: row.stateHash });
  }
  return state!;
}

const START = { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' } as const;

describe('dungeon through the client', () => {
  it('start → live ticks → skip the search → the fight plays live → debug HP 1 → finish search → woodcutting; the log replays exactly', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'dng' });
    await client.load();
    expect((await client.dispatch(START)).ok).toBe(true);

    for (let i = 0; i < 70; i++) {
      clock.advance(SEC);
      await client.tick();
    }
    expect(client.getState().activity).toMatchObject({ kind: 'dungeon', phase: 'search', progressMs: 70 * SEC });

    // 0:40 of the 1:50 search left → 1 stamina.
    const view = dungeonRunView(client.getState())!;
    expect([view.run, view.skipCost]).toEqual([1, 1]);
    const skip = await client.dispatch({ type: 'SKIP_DUNGEON_RUN', run: view.run, maxCost: view.skipCost! });
    expect(skip.ok).toBe(true);
    expect(client.getState().stamina.current).toBe(99);
    expect(client.getState().activity).toMatchObject({ phase: 'fight' });
    expect(client.getState().dungeon.totals.runs).toBe(0);

    // The fight plays out tick by tick: strikes appear as engine time reaches them.
    clock.advance(SEC);
    await client.tick();
    expect(dungeonRunView(client.getState())!.fight!.log).toHaveLength(2);
    for (let i = 0; i < 10 && client.getState().dungeon.totals.runs === 0; i++) {
      clock.advance(SEC);
      await client.tick();
    }
    expect(client.getState().dungeon.totals.runs).toBe(1);
    expect(client.getState().activity).toMatchObject({ phase: 'search' });

    expect((await client.debug.setHeroHp(1)).ok).toBe(true);
    expect(client.getState().character.hp).toBe(1);
    expect((await client.debug.finishDungeonRun()).ok).toBe(true);
    expect(client.getState().activity).toMatchObject({ phase: 'fight' });
    expect(client.getState().flags.debugUsed).toBe(true);
    clock.advance(SEC);
    await client.tick();
    // At 1 HP the Rat's first strike (1 s, after the hero's) is fatal.
    expect(client.getState().dungeon.lastFight).toMatchObject({ heroHpStart: 1, won: false, heroHpEnd: 0, durationMs: 1000 });

    clock.advance(100 * SEC);
    await client.tick();
    expect(client.getState().character.hp).toBe(25); // 100 s × 15/min from 0 (+ the fight's 1 s remainder)
    await debugBuild(client, ['woodcutting']);
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' })).ok).toBe(true);
    expect(client.getState().dungeon.totals.runs).toBe(2); // the run in progress was lost
    await client.persist();

    const types = (await repo.getAllLog()).map((r) => r.type);
    expect(types).toEqual(expect.arrayContaining(['SKIP_DUNGEON_RUN', 'DEBUG_SET_HERO_HP', 'DEBUG_FINISH_DUNGEON_RUN']));
    const replayed = await verifyLog(repo);
    expect(hashState(replayed)).toBe(hashState(client.getState()));
  });

  it('a skip without enough stamina is refused, logs no command row and changes nothing', async () => {
    const { repo, client } = makeClient({ prefix: 'nos' });
    await client.load();
    await client.dispatch(START);
    await client.debug.spendStamina(99); // 1 left; a fresh 1:50 search costs 2
    const before = client.getState();
    const res = await client.dispatch({ type: 'SKIP_DUNGEON_RUN', run: 1, maxCost: 2 });
    expect(res).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_STAMINA' } });
    expect(client.getState()).toBe(before);
    expect((await repo.getAllLog()).some((r) => r.type === 'SKIP_DUNGEON_RUN')).toBe(false);
  });

  it('a tap that lands after the search ended: FIGHT_IN_PROGRESS, then RUN_CHANGED once the run is over; nothing spent or logged', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'race' });
    await client.load();
    await client.dispatch(START);
    clock.advance(110 * SEC - 20 * SEC);
    await client.tick();
    const view = dungeonRunView(client.getState())!; // what the button shows: run 1, cost 1
    expect([view.run, view.skipCost]).toEqual([1, 1]);
    clock.advance(21 * SEC); // the search ends before the tap is processed (the client simulates first)
    const during = await client.dispatch({ type: 'SKIP_DUNGEON_RUN', run: view.run, maxCost: view.skipCost! });
    expect(during).toMatchObject({ ok: false, error: { code: 'FIGHT_IN_PROGRESS' } });
    clock.advance(70 * SEC); // the fight is over (60 s at most) and run 2 is searching
    const after = await client.dispatch({ type: 'SKIP_DUNGEON_RUN', run: view.run, maxCost: view.skipCost! });
    expect(after).toMatchObject({ ok: false, error: { code: 'RUN_CHANGED' } });
    expect(client.getState().stamina.current).toBe(100);
    expect(client.getState().dungeon.totals.runs).toBe(1); // only the run that finished on its own
    await client.persist();
    expect((await repo.getAllLog()).some((r) => r.type === 'SKIP_DUNGEON_RUN')).toBe(false);
    expect(hashState(await verifyLog(repo))).toBe(hashState(client.getState()));
  });

  it('30 minutes away: search + fight runs back to back in the away summary; HP consistent; log replays', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'away' });
    await client.load();
    await client.dispatch(START);
    await client.persist();
    clock.advance(30 * MIN);
    const summary = await client.resume();
    const runs = summary.dungeon.runs;
    expect(runs).toBeGreaterThanOrEqual(14); // 30 min / (1:50 search + a few seconds of fight)
    expect(runs).toBeLessThanOrEqual(16);
    expect(summary.dungeon.wins + summary.dungeon.losses).toBe(runs);
    expect(summary.heroXpGained).toBe(35 * summary.dungeon.wins);
    expect(summary.goldGained).toBeGreaterThanOrEqual(2 * summary.dungeon.wins);
    expect(client.getSnapshot().awaySummary?.dungeon.runs).toBe(runs);
    const s = client.getState();
    expect(s.character.hp).toBeGreaterThan(0);
    expect(s.character.hp).toBeLessThanOrEqual(hpView(s).maxHp);
    expect(hashState(await verifyLog(repo))).toBe(hashState(s));
  });

  it('clock −2h pauses runs and regen until real time catches up', async () => {
    const { clock, client } = makeClient({ prefix: 'clk' });
    await client.load();
    await client.dispatch(START);
    await client.debug.setHeroHp(10);
    clock.advance(MIN);
    await client.tick();
    const at = client.getState();
    await client.debug.shiftClock(-2 * HOUR);
    clock.advance(30 * MIN);
    await client.resume();
    expect(client.getSnapshot().clockPaused).toBe(true);
    expect(client.getState().character.hp).toBe(at.character.hp);
    expect(progressMs(client.getState())).toBe(progressMs(at));
    expect(client.getState().dungeon.totals.runs).toBe(0);
  });
});

describe('replay of the new rows', () => {
  it('replayLog accepts SKIP_DUNGEON_RUN and the debug rows, mid-fight included', () => {
    const state = replayLog(current([
      { type: 'NEW_GAME', payload: { seed: 5 }, clientTime: T0 },
      { type: 'START_ACTIVITY', payload: { id: 'a', ...START }, clientTime: T0 },
      { type: 'SKIP_DUNGEON_RUN', payload: { id: 'b', type: 'SKIP_DUNGEON_RUN', run: 1, maxCost: 1 }, clientTime: T0 + MIN },
      // Mid-fight (the skip started it): HP → 1, so the Rat's first strike ends it.
      { type: 'DEBUG_SET_HERO_HP', payload: { id: 'c', type: 'DEBUG_SET_HERO_HP', hp: 1 }, clientTime: T0 + MIN + 500 },
      { type: 'SIMULATE', payload: { checkpoint: true }, clientTime: T0 + MIN + 10 * SEC },
      { type: 'DEBUG_FINISH_DUNGEON_RUN', payload: { id: 'd', type: 'DEBUG_FINISH_DUNGEON_RUN' }, clientTime: T0 + MIN + 10 * SEC },
      { type: 'RESUME', payload: {}, clientTime: T0 + MIN + 10 * MIN },
    ]));
    expect(state?.stamina.current).toBe(100); // 1 spent, +1 per 5 min back to full
    expect(state?.dungeon.byDungeon.rat_cellar?.losses).toBeGreaterThanOrEqual(1);
    expect(state?.dungeon.totals.runs).toBeGreaterThanOrEqual(6); // skip + debug finish + 1:50 runs in ~10 min
    expect(state?.flags.debugUsed).toBe(true);
  });
});
