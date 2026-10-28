// Building upgrades and the one builder (1.10.0): level cap by the Town Hall, atomic payment, one construction at
// a time, completion in simulate() on the granted time, independent of the hero's activity.
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  BUILDING_IDS,
  BUILDING_MAX_LEVEL,
  BUILDING_UPGRADES,
  BUILDINGS,
  type BuildingId,
  type GameState,
  hashState,
  simulate,
  TOWN_HALL_UPGRADES,
  upgradeView,
} from '../src/engine';
import type { CommandInput } from '../src/client/types';
import { apply, builtGame, cmd, HOUR, makeClient, MIN, qty, SEC, T0 } from './helpers';

/** Every building built, plenty of gold and every upgrade material. */
function rich(seed = 3): GameState {
  const s = builtGame(seed, T0);
  const items = ['oak_logs', 'stone', 'birch_logs', 'copper_ore', 'maple_logs', 'iron_ore', 'yew_logs', 'silver_ore'].map((id) => ({
    id,
    defId: id,
    name: id,
    icon: '?',
    stackable: true,
    quantity: 10_000,
  }));
  return { ...s, character: { ...s.character, gold: 1_000_000 }, inventory: { ...s.inventory, items } };
}

function run(s: GameState, c: CommandInput, at = T0) {
  return applyCommand(s, cmd(c), at);
}

/** Upgrades and waits for it to finish (simulate past its duration). */
function upgraded(s: GameState, id: BuildingId, at = s.time.lastSimulatedAt): GameState {
  const level = s.buildings[id].level + 1;
  let done = apply(s, { type: 'UPGRADE_BUILDING', buildingId: id, level }, at);
  // In steps of at most 8 h (the offline cap limits each simulate call).
  for (let t = at, end = at + done.construction!.durationMs; t < end; ) {
    t = Math.min(end, t + 8 * HOUR);
    done = simulate(done, t).state;
  }
  expect(done.buildings[id].level).toBe(level);
  return done;
}

describe('upgrade costs (data)', () => {
  it('Town Hall costs as approved; every other building costs half, rounded up, for the same level', () => {
    expect(TOWN_HALL_UPGRADES.map((u) => [u.gold, u.items.map((i) => `${i.quantity} ${i.defId}`), u.durationMs / MIN])).toEqual([
      [500, ['50 oak_logs', '50 stone'], 30],
      [2000, ['100 birch_logs', '100 copper_ore'], 120],
      [8000, ['200 maple_logs', '200 iron_ore'], 480],
      [32000, ['400 yew_logs', '400 silver_ore'], 1440],
    ]);
    TOWN_HALL_UPGRADES.forEach((th, i) => {
      const half = BUILDING_UPGRADES[i];
      expect(half.gold).toBe(Math.ceil(th.gold / 2));
      expect(half.durationMs).toBe(Math.ceil(th.durationMs / 2));
      expect(half.items).toEqual(th.items.map((it) => ({ defId: it.defId, quantity: Math.ceil(it.quantity / 2) })));
    });
    for (const id of BUILDING_IDS) {
      expect(BUILDINGS[id].upgrades).toHaveLength(BUILDING_MAX_LEVEL - 1);
      expect(BUILDINGS[id].upgrades).toBe(id === 'town_hall' ? TOWN_HALL_UPGRADES : BUILDING_UPGRADES);
      expect(BUILDINGS[id].cappedByTownHall).toBe(id !== 'town_hall');
    }
  });
});

describe('UPGRADE_BUILDING', () => {
  it('pays gold and items up front, atomically, and starts the builder; the upgrade completes on engine time', () => {
    const s = rich();
    const r = run(s, { type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 2 });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.character.gold).toBe(1_000_000 - 500);
    expect([qty(r.state, 'oak_logs'), qty(r.state, 'stone')]).toEqual([9950, 9950]);
    expect(r.state.construction).toEqual({ buildingId: 'town_hall', level: 2, durationMs: 30 * MIN, progressMs: 0, startedAt: T0 });
    expect(r.state.buildings.town_hall.level).toBe(1);
    expect(r.events).toContainEqual({ type: 'CONSTRUCTION_STARTED', buildingId: 'town_hall', level: 2 });

    const early = simulate(r.state, T0 + 30 * MIN - 1);
    expect(early.state.buildings.town_hall.level).toBe(1);
    const done = simulate(r.state, T0 + 30 * MIN);
    expect(done.state.buildings.town_hall).toEqual({ state: 'built', level: 2 });
    expect(done.state.construction).toBeNull();
    expect(done.events).toContainEqual({ type: 'BUILDING_UPGRADED', buildingId: 'town_hall', level: 2 });
    expect(done.summary.buildingsUpgraded).toEqual([{ buildingId: 'town_hall', level: 2 }]);
  });

  it('missing gold or items: REQUIREMENTS_NOT_MET and nothing is paid (atomic)', () => {
    const s = rich();
    const poor = { ...s, character: { ...s.character, gold: 499 } };
    const r = run(poor, { type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 2 });
    expect(r).toMatchObject({ ok: false, error: { code: 'REQUIREMENTS_NOT_MET' } });
    const noStone = { ...s, inventory: { ...s.inventory, items: s.inventory.items.filter((i) => i.defId !== 'stone') } };
    const r2 = run(noStone, { type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 2 });
    expect(r2).toMatchObject({ ok: false, error: { code: 'REQUIREMENTS_NOT_MET' } });
    expect(r2.ok === false && r2.error.message).toMatch(/50 Stone/);
  });

  it('no building goes above the Town Hall level; the Town Hall caps at 5', () => {
    let s = rich();
    for (const id of ['woodcutting', 'mine_shaft', 'merchant'] as const) {
      expect(run(s, { type: 'UPGRADE_BUILDING', buildingId: id, level: 2 })).toMatchObject({ ok: false, error: { code: 'TOWN_HALL_TOO_LOW' } });
      expect(upgradeView(s, id)).toMatchObject({ nextLevel: 2, block: 'town_hall', townHallNeeded: 2 });
    }
    s = upgraded(s, 'town_hall');
    s = upgraded(s, 'woodcutting');
    expect(run(s, { type: 'UPGRADE_BUILDING', buildingId: 'woodcutting', level: 3 })).toMatchObject({ ok: false, error: { code: 'TOWN_HALL_TOO_LOW' } });
    for (let l = 3; l <= 5; l += 1) s = upgraded(s, 'town_hall');
    for (let l = 3; l <= 5; l += 1) s = upgraded(s, 'woodcutting');
    expect(s.buildings.town_hall.level).toBe(5);
    expect(s.buildings.woodcutting.level).toBe(5);
    for (const id of ['town_hall', 'woodcutting'] as const) {
      expect(run(s, { type: 'UPGRADE_BUILDING', buildingId: id, level: 6 })).toMatchObject({ ok: false, error: { code: 'MAX_LEVEL' } });
      expect(upgradeView(s, id)).toMatchObject({ nextLevel: null, block: 'max_level', cost: [], durationMs: 0 });
    }
  });

  it('a building whose next level has no bonus data is not upgradable (Training Grounds): NOT_UPGRADABLE, nothing paid', async () => {
    const { hasLevelBonuses } = await import('../src/engine');
    // Data-driven: every level of every building with bonus data is reachable; the Training Grounds have none.
    for (const id of BUILDING_IDS) {
      for (let l = 2; l <= BUILDING_MAX_LEVEL; l += 1) expect(hasLevelBonuses(id, l)).toBe(id !== 'training_grounds');
    }
    let s = rich();
    for (let l = 2; l <= 5; l += 1) s = upgraded(s, 'town_hall');
    const r = run(s, { type: 'UPGRADE_BUILDING', buildingId: 'training_grounds', level: 2 }, s.time.lastSimulatedAt);
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_UPGRADABLE' } });
    expect(upgradeView(s, 'training_grounds')).toMatchObject({ nextLevel: 2, block: 'not_upgradable' });
    // The other buildings still upgrade with the same Town Hall.
    expect(run(s, { type: 'UPGRADE_BUILDING', buildingId: 'merchant', level: 2 }, s.time.lastSimulatedAt).ok).toBe(true);
  });

  it('one builder: a second upgrade is refused while one runs (BUILDER_BUSY), nothing paid', () => {
    const s = upgraded(rich(), 'town_hall');
    const a = apply(s, { type: 'UPGRADE_BUILDING', buildingId: 'woodcutting', level: 2 }, s.time.lastSimulatedAt);
    const r = run(a, { type: 'UPGRADE_BUILDING', buildingId: 'mine_shaft', level: 2 }, s.time.lastSimulatedAt);
    expect(r).toMatchObject({ ok: false, error: { code: 'BUILDER_BUSY' } });
    expect(upgradeView(a, 'mine_shaft').block).toBe('builder_busy');
    expect(upgradeView(a, 'woodcutting').upgrading).toBe(true);
  });

  it('bound to the level shown: a double tap is LEVEL_CHANGED or BUILDER_BUSY, never a second payment', () => {
    const s = rich();
    const once = apply(s, { type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 2 }, T0);
    expect(run(once, { type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 2 })).toMatchObject({ ok: false, error: { code: 'BUILDER_BUSY' } });
    expect(run(s, { type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 3 })).toMatchObject({ ok: false, error: { code: 'LEVEL_CHANGED' } });
    expect(run(s, { type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: '2' as unknown as number })).toMatchObject({
      ok: false,
      error: { code: 'LEVEL_CHANGED' },
    });
  });

  it('locked or unknown buildings are refused', () => {
    const s = { ...rich(), buildings: { ...rich().buildings, mine_shaft: { state: 'locked' as const, level: 0 } } };
    expect(run(s, { type: 'UPGRADE_BUILDING', buildingId: 'mine_shaft', level: 1 })).toMatchObject({ ok: false, error: { code: 'BUILDING_LOCKED' } });
    expect(run(s, { type: 'UPGRADE_BUILDING', buildingId: 'dungeon' as BuildingId, level: 2 })).toMatchObject({ ok: false, error: { code: 'UNKNOWN_BUILDING' } });
    expect(upgradeView(s, 'mine_shaft').block).toBe('locked');
  });

  it('does not block or touch the hero activity; both progress side by side', () => {
    let s = apply(rich(), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0);
    s = apply(s, { type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 2 }, T0);
    const r = simulate(s, T0 + HOUR);
    expect(r.state.activity).toMatchObject({ kind: 'woodcutting', treeId: 'oak' });
    expect(r.summary.actions).toBe(32); // 1:50 per cut
    expect(r.state.buildings.town_hall.level).toBe(2);
  });

  it('completes offline on the granted (capped) time: a 24 h upgrade is not done after a 30 h absence that grants 8 h', () => {
    let s = rich();
    for (let l = 2; l <= 4; l += 1) s = upgraded(s, 'town_hall');
    const t = s.time.lastSimulatedAt;
    s = apply(s, { type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 5 }, t);
    const a = simulate(s, t + 30 * HOUR).state; // capped: 8 h
    expect(a.construction?.progressMs).toBe(8 * HOUR);
    const b = simulate(a, t + 30 * HOUR + 8 * HOUR).state;
    const c = simulate(b, t + 30 * HOUR + 16 * HOUR).state;
    expect(c.buildings.town_hall.level).toBe(5);
  });

  it('split invariance: many small simulate calls = one big one, with the hero gathering and the builder running', () => {
    let s = apply(rich(9), { type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' }, T0);
    s = apply(s, { type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 2 }, T0);
    const big = simulate(s, T0 + 2 * HOUR).state;
    let small = s;
    for (let t = T0 + 7 * SEC; t <= T0 + 2 * HOUR; t += 7 * SEC) small = simulate(small, t).state;
    small = simulate(small, T0 + 2 * HOUR).state;
    expect(hashState(small)).toBe(hashState(big));
  });

  it('DEBUG_FINISH_CONSTRUCTION finishes now, sets debugUsed; NO_CONSTRUCTION when the builder is idle', () => {
    const s = apply(rich(), { type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 2 }, T0);
    const r = apply(s, { type: 'DEBUG_FINISH_CONSTRUCTION' }, T0 + MIN);
    expect(r.buildings.town_hall.level).toBe(2);
    expect(r.construction).toBeNull();
    expect(r.flags.debugUsed).toBe(true);
    expect(run(r, { type: 'DEBUG_FINISH_CONSTRUCTION' }, T0 + MIN)).toMatchObject({ ok: false, error: { code: 'NO_CONSTRUCTION' } });
    expect(applyCommand(s, cmd({ type: 'DEBUG_FINISH_CONSTRUCTION' }), T0, { allowDebug: false })).toMatchObject({
      ok: false,
      error: { code: 'DEBUG_DISABLED' },
    });
  });

  it('through the client: logged, and the log replays (the completion happens inside a RESUME)', async () => {
    const { replayLogReport } = await import('../src/engine');
    const { repo, clock, client } = makeClient({ prefix: 'upg' });
    await client.load();
    await client.debug.build('woodcutting');
    await client.debug.build('mine_shaft');
    await client.debug.build('town_hall');
    await client.debug.addGold(1000);
    expect(await client.dispatch({ type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 2 })).toMatchObject({
      ok: false,
      error: { code: 'REQUIREMENTS_NOT_MET' },
    });
    // The Merchant can't go above the Town Hall (Lv1).
    expect(await client.dispatch({ type: 'UPGRADE_BUILDING', buildingId: 'merchant', level: 2 })).toMatchObject({ ok: false, error: { code: 'TOWN_HALL_TOO_LOW' } });
    // Gather 50 Oak Logs and 50 Stone.
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' })).ok).toBe(true);
    clock.advance(100 * MIN);
    await client.resume();
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' })).ok).toBe(true);
    clock.advance(100 * MIN);
    await client.resume();
    expect(qty(client.getState(), 'oak_logs')).toBeGreaterThanOrEqual(50);
    expect(qty(client.getState(), 'stone')).toBeGreaterThanOrEqual(50);
    expect((await client.dispatch({ type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 2 })).ok).toBe(true);
    clock.advance(31 * MIN);
    await client.resume();
    expect(client.getState().buildings.town_hall.level).toBe(2);
    const rows = await repo.getAllLog();
    expect(rows.filter((r) => r.type === 'UPGRADE_BUILDING')).toHaveLength(1);
    const report = replayLogReport(rows.map(({ seq: _s, synced: _y, ...r }) => r));
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});
