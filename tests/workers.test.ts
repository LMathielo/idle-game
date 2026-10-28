// Workers (1.10.0): hiring, the assign gate, crews that gather on their own (25% of the hero's current power each),
// upkeep per started minute with pause / resume on gold, offline and split determinism.
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  type BuildingId,
  crewYieldBp,
  expectedCrewYieldBp,
  type GameEvent,
  type GameState,
  hashState,
  hireCost,
  nodeChoices,
  replayLogReport,
  simulate,
  TREES,
  WORKERS,
  workersView,
} from '../src/engine';
import type { CommandInput } from '../src/client/types';
import { apply, builtGame, cmd, HOUR, makeClient, MIN, qty, SEC, T0 } from './helpers';

const OAK_MS = TREES.oak.baseMs; // crews ignore DEX: 2:00

/** Every building built (Town Hall at `th`), `gold` gold, no activity. */
function village(opts: { gold?: number; th?: number; str?: number; seed?: number; levels?: Partial<Record<BuildingId, number>> } = {}): GameState {
  const s = builtGame(opts.seed ?? 11, T0);
  const buildings = { ...s.buildings, town_hall: { state: 'built' as const, level: opts.th ?? 1 } };
  for (const [id, level] of Object.entries(opts.levels ?? {})) buildings[id as BuildingId] = { state: 'built', level: level! };
  return {
    ...s,
    buildings,
    character: { ...s.character, gold: opts.gold ?? 100_000, attributes: { ...s.character.attributes, strength: 10 + (opts.str ?? 0) } },
  };
}

function run(s: GameState, c: CommandInput, at = s.time.lastSimulatedAt) {
  return applyCommand(s, cmd(c), at);
}

/** Hires `n` workers at their shown prices. */
function hire(s: GameState, n: number, at = s.time.lastSimulatedAt): GameState {
  for (let i = 0; i < n; i += 1) s = apply(s, { type: 'HIRE_WORKER', maxCost: hireCost(s.workers.list.length) }, at);
  return s;
}

function assignAll(s: GameState, node: CommandInput extends never ? never : string, at = s.time.lastSimulatedAt): GameState {
  for (const w of s.workers.list) s = apply(s, { type: 'ASSIGN_WORKER', workerId: w.id, node: node as 'oak' }, at);
  return s;
}

describe('hiring', () => {
  it('costs 100 × 2^(workers owned): 100, 200, 400, 800, 1600; dismissing refunds nothing and lowers the next price', () => {
    let s = village({ gold: 10_000 });
    expect([0, 1, 2, 3, 4].map(hireCost)).toEqual([100, 200, 400, 800, 1600]);
    s = hire(s, 5);
    expect(s.character.gold).toBe(10_000 - 3100);
    expect(s.workers.list.map((w) => w.id)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
    s = apply(s, { type: 'DISMISS_WORKER', workerId: 'w2' }, T0);
    expect(s.character.gold).toBe(6900);
    expect(workersView(s).hireCost).toBe(1600);
    s = hire(s, 1);
    expect(s.workers.list.map((w) => w.id)).toEqual(['w1', 'w3', 'w4', 'w5', 'w6']); // ids only go up
  });

  it('cap by Town Hall level: 5 / 7 / 9 / 12 / 15 (WORKER_CAP); refused before the Town Hall is built', () => {
    for (const [th, cap] of [[1, 5], [2, 7], [3, 9], [4, 12], [5, 15]] as const) {
      const s = hire(village({ gold: 10_000_000, th }), cap);
      expect(s.workers.list).toHaveLength(cap);
      expect(run(s, { type: 'HIRE_WORKER', maxCost: 10_000_000 })).toMatchObject({ ok: false, error: { code: 'WORKER_CAP' } });
      expect(workersView(s)).toMatchObject({ cap, hired: cap, hireCost: null, canHire: false });
    }
    const s = village();
    const locked = { ...s, buildings: { ...s.buildings, town_hall: { state: 'locked' as const, level: 0 } } };
    expect(run(locked, { type: 'HIRE_WORKER', maxCost: 100 })).toMatchObject({ ok: false, error: { code: 'BUILDING_LOCKED' } });
  });

  it('bound to the price shown (COST_CHANGED on a double tap); NOT_ENOUGH_GOLD; gold never negative', () => {
    const one = hire(village({ gold: 250 }), 1);
    expect(run(one, { type: 'HIRE_WORKER', maxCost: 100 })).toMatchObject({ ok: false, error: { code: 'COST_CHANGED' } });
    expect(run(one, { type: 'HIRE_WORKER', maxCost: 200 })).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_GOLD' } });
    expect(run(one, { type: 'HIRE_WORKER', maxCost: 0 })).toMatchObject({ ok: false, error: { code: 'INVALID_AMOUNT' } });
    expect(one.character.gold).toBe(150);
  });
});

describe('assigning', () => {
  it('only to a tree or rock the HERO can work now (level and power), in a built building', () => {
    let s = hire(village(), 2);
    expect(run(s, { type: 'ASSIGN_WORKER', workerId: 'w1', node: 'birch' })).toMatchObject({ ok: false, error: { code: 'NODE_LOCKED' } });
    expect(run(s, { type: 'ASSIGN_WORKER', workerId: 'w1', node: 'copper' })).toMatchObject({ ok: false, error: { code: 'NODE_LOCKED' } });
    expect(run(s, { type: 'ASSIGN_WORKER', workerId: 'w1', node: 'nope' as 'oak' })).toMatchObject({ ok: false, error: { code: 'UNKNOWN_NODE' } });
    expect(run(s, { type: 'ASSIGN_WORKER', workerId: 'w9', node: 'oak' })).toMatchObject({ ok: false, error: { code: 'UNKNOWN_WORKER' } });
    const noMine = { ...s, buildings: { ...s.buildings, mine_shaft: { state: 'locked' as const, level: 0 } } };
    expect(run(noMine, { type: 'ASSIGN_WORKER', workerId: 'w1', node: 'stone' })).toMatchObject({ ok: false, error: { code: 'BUILDING_LOCKED' } });
    s = apply(s, { type: 'ASSIGN_WORKER', workerId: 'w1', node: 'oak' }, T0);
    s = apply(s, { type: 'ASSIGN_WORKER', workerId: 'w2', node: 'stone' }, T0);
    expect(s.workers.list.map((w) => w.node)).toEqual(['oak', 'stone']);
    // Same node again: nothing changes. Move: the old crew goes away with its last worker.
    expect(apply(s, { type: 'ASSIGN_WORKER', workerId: 'w1', node: 'oak' }, T0).workers).toEqual(s.workers);
    s = apply(s, { type: 'ASSIGN_WORKER', workerId: 'w1', node: 'stone' }, T0);
    expect(Object.keys(s.workers.crews)).toEqual(['stone']);
    s = apply(s, { type: 'UNASSIGN_WORKER', workerId: 'w2' }, T0);
    expect(s.workers.list.map((w) => w.node)).toEqual(['stone', null]);
    // Strong enough hero: Birch opens to workers too.
    const strong = hire(village({ str: 100 }), 1);
    const lv = { ...strong, character: { ...strong.character, skills: { ...strong.character.skills, woodcutting: { level: 5, xp: 0, xpToNext: 5590 } } } };
    expect(apply(lv, { type: 'ASSIGN_WORKER', workerId: 'w1', node: 'birch' }, T0).workers.list[0].node).toBe('birch');
    expect(nodeChoices(lv).find((c) => c.node === 'birch')).toMatchObject({ available: true, tier: 2, upkeepPerMin: 5 });
    expect(nodeChoices(lv).find((c) => c.node === 'maple')).toMatchObject({ available: false, reason: 'Needs woodcutting level 15' });
  });
});

describe('crews', () => {
  it('crew power = 25% × hero power × workers; yield = crew power ÷ requirement × bonus, in integer bp', () => {
    // Hero WS 21, Oak (20): one worker = 5.25 power = 0.2625 logs per action; four = 1.05.
    expect(crewYieldBp(21, 1 * OAK_MS, OAK_MS, 20, 10_000)).toBe(2625);
    expect(crewYieldBp(21, 4 * OAK_MS, OAK_MS, 20, 10_000)).toBe(10_500);
    expect(crewYieldBp(21, 4 * OAK_MS, OAK_MS, 20, 12_000)).toBe(12_600);
    // Average crew size over the action: 1 worker for half of it, 3 for the other half = 2 workers.
    expect(crewYieldBp(21, OAK_MS / 2 + 3 * (OAK_MS / 2), OAK_MS, 20, 10_000)).toBe(5250);
    // Far from 2^53 even with a huge hero.
    expect(Number.isSafeInteger(crewYieldBp(1_010_000, 15 * 30 * MIN, 30 * MIN, 1395, 28_000))).toBe(true);
  });

  it('crews gather on their own on the node base time (no DEX), give no XP and no rare drops', () => {
    let s = hire(village({ seed: 5 }), 4);
    s = assignAll(s, 'oak');
    const r = simulate(s, T0 + 100 * OAK_MS);
    expect(r.summary.workerActions).toBe(100);
    expect(r.summary.actions).toBe(0); // the hero did nothing
    expect(r.summary.skillXpGained).toEqual({});
    expect(r.state.character.skills.woodcutting).toEqual(s.character.skills.woodcutting);
    expect(qty(r.state, 'bird_nest')).toBe(0);
    // 1.05 logs per action: 100 actions → 100 + ~5.
    const logs = r.summary.workerItemsGained.oak_logs ?? 0;
    expect(logs).toBeGreaterThanOrEqual(100);
    expect(logs).toBeLessThanOrEqual(115);
    expect(qty(r.state, 'oak_logs')).toBe(logs);
  });

  it('better hero gear raises worker power at once', () => {
    let s = hire(village(), 1);
    s = assignAll(s, 'oak');
    const before = expectedCrewYieldBp(s, 'oak', 1);
    const axe = { id: 'iron_axe#1', defId: 'iron_axe', name: 'Iron Axe', icon: '🪓', slot: 'axe' as const };
    s = { ...s, inventory: { ...s.inventory, items: [...s.inventory.items, axe] } };
    s = apply(s, { type: 'EQUIP_ITEM', itemId: 'iron_axe#1' }, T0);
    expect(before).toBe(2625); // WS 21
    expect(expectedCrewYieldBp(s, 'oak', 1)).toBe(7500); // WS 60
    expect(workersView(s).crews[0]).toMatchObject({ node: 'oak', workers: 1, status: 'working', yieldBp: 7500 });
  });

  it('the hero on the same node is separate and additive (own timer, own yield)', () => {
    let s = hire(village({ seed: 8 }), 4);
    s = assignAll(s, 'oak');
    const alone = simulate(s, T0 + HOUR);
    s = apply(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0);
    const both = simulate(s, T0 + HOUR);
    expect(both.summary.workerActions).toBe(alone.summary.workerActions); // 30
    expect(both.summary.actions).toBe(32); // the hero's own 1:50 cuts
    expect(qty(both.state, 'oak_logs')).toBe((both.summary.itemsGained.oak_logs ?? 0) + (both.summary.workerItemsGained.oak_logs ?? 0));
    expect(both.summary.workerItemsGained.oak_logs).toBeGreaterThanOrEqual(30);
  });

  it('bonuses count for crews: Town Hall Lv2 and Woodcutting Lv3 → ×1.6', () => {
    const s = hire(village({ th: 3, levels: { woodcutting: 3 } }), 4);
    expect(expectedCrewYieldBp(s, 'oak', 4)).toBe(16_800);
  });

  it('when the hero can no longer work a node, its crew goes idle (event), stays assigned, costs nothing; it resumes when the hero qualifies again', () => {
    // WC Lv5, STR 20, Iron Axe: WS 110 ≥ Birch 100; without the axe 70.
    let s = village({ str: 10, gold: 1000 });
    s = { ...s, character: { ...s.character, skills: { ...s.character.skills, woodcutting: { level: 5, xp: 0, xpToNext: 5590 } } } };
    const axe = { id: 'iron_axe#1', defId: 'iron_axe', name: 'Iron Axe', icon: '🪓', slot: 'axe' as const };
    s = { ...s, inventory: { ...s.inventory, items: [...s.inventory.items, axe] } };
    s = apply(s, { type: 'EQUIP_ITEM', itemId: 'iron_axe#1' }, T0);
    s = hire(s, 2);
    s = assignAll(s, 'birch');
    const goldBefore = s.character.gold;
    const off = applyCommand(s, cmd({ type: 'EQUIP_ITEM', itemId: 'start-wooden_axe' }), T0 + 30 * SEC);
    if (!off.ok) throw new Error(off.error.message);
    expect(off.events).toContainEqual({ type: 'CREW_IDLE', node: 'birch' } satisfies GameEvent);
    expect(off.state.workers.list.map((w) => w.node)).toEqual(['birch', 'birch']);
    expect(workersView(off.state)).toMatchObject({ upkeepPerMin: 0, crews: [{ node: 'birch', status: 'idle' }] });
    const later = simulate(off.state, T0 + 2 * HOUR);
    expect(later.summary.workerActions).toBe(0);
    expect(later.state.character.gold).toBe(off.state.character.gold);
    expect(off.state.character.gold).toBe(goldBefore); // the minute paid at the start is not refunded nor charged again
    const back = applyCommand(later.state, cmd({ type: 'EQUIP_ITEM', itemId: 'iron_axe#1' }), T0 + 2 * HOUR);
    if (!back.ok) throw new Error(back.error.message);
    expect(back.events).toContainEqual({ type: 'CREW_ACTIVE', node: 'birch' });
    expect(simulate(back.state, T0 + 3 * HOUR).summary.workerActions).toBe(12); // 5:00 per Birch action
  });

  it('an idle crew resumes when the hero levels up during simulate (no split dependence)', () => {
    // Copper needs mining Lv5 and MS 100. Hero mines Stone with STR 90 (MS 10×lvl + 100 + 1): at Lv4 MS 141 but level too low.
    let s = village({ str: 80, seed: 21 });
    s = { ...s, character: { ...s.character, skills: { ...s.character.skills, mining: { level: 5, xp: 0, xpToNext: 5590 } } } };
    s = hire(s, 3);
    s = assignAll(s, 'copper');
    // Drop to Lv4 by hand (a debug-like state): the crew is idle until the hero's mining reaches Lv5 again.
    s = { ...s, character: { ...s.character, skills: { ...s.character.skills, mining: { level: 4, xp: 3900, xpToNext: 4000 } } } };
    s = apply(s, { type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' }, T0);
    expect(s.workers.crews.copper?.idle).toBe(true);
    const big = simulate(s, T0 + 3 * HOUR);
    expect(big.events).toContainEqual({ type: 'CREW_ACTIVE', node: 'copper' });
    expect(big.summary.workerActions).toBeGreaterThan(20);
    let small = s;
    for (let t = T0 + 13 * SEC; t < T0 + 3 * HOUR; t += 13 * SEC) small = simulate(small, t).state;
    small = simulate(small, T0 + 3 * HOUR).state;
    expect(hashState(small)).toBe(hashState(big.state));
  });
});

describe('upkeep', () => {
  it('per worker per started minute by tier (1 / 5 / 15 / 40 / 100); the first minute is paid when work starts', () => {
    expect(WORKERS.upkeepPerMinByTier).toEqual([1, 5, 15, 40, 100]);
    let s = hire(village({ gold: 10_000 }), 3);
    const g0 = s.character.gold;
    s = apply(s, { type: 'ASSIGN_WORKER', workerId: 'w1', node: 'oak' }, T0);
    expect(g0 - s.character.gold).toBe(1); // minute 1, at once
    s = apply(s, { type: 'ASSIGN_WORKER', workerId: 'w2', node: 'oak' }, T0 + 10 * SEC);
    expect(g0 - s.character.gold).toBe(2); // the new worker pays its started minute
    s = apply(s, { type: 'ASSIGN_WORKER', workerId: 'w3', node: 'stone' }, T0 + 20 * SEC);
    expect(g0 - s.character.gold).toBe(3);
    const r = simulate(s, T0 + 10 * MIN);
    // Minutes 2..10 start at 1:00, 2:00, … 9:00: 9 × 3 workers.
    expect(r.summary.upkeepPaid).toBe(27);
    expect(g0 - r.state.character.gold).toBe(30);
    expect(workersView(r.state).upkeepPerMin).toBe(3);
    // Unassigned and idle workers cost nothing.
    // At 10:00 the command settles the workforce: minute 11 is paid for the 2 Oak workers left. Then 12..20.
    const g10 = r.state.character.gold;
    const off = apply(r.state, { type: 'UNASSIGN_WORKER', workerId: 'w3' }, T0 + 10 * MIN);
    expect(g10 - off.character.gold).toBe(2);
    expect(simulate(off, T0 + 20 * MIN).summary.upkeepPaid).toBe(9 * 2);
  });

  it("when gold can't cover the next minute, every crew pauses (event) and nothing is charged; selling resumes them", () => {
    let s = hire(village({ gold: 300, seed: 3 }), 2);
    s = { ...s, character: { ...s.character, gold: 5 } };
    s = assignAll(s, 'oak'); // 2/min: minute 1 paid (gold 3)
    expect(s.character.gold).toBe(3);
    const r = simulate(s, T0 + HOUR);
    expect(r.events).toContainEqual({ type: 'WORKERS_PAUSED', upkeepDue: 2 });
    expect(r.state.workers.paused).toBe(true);
    expect(r.state.character.gold).toBe(1); // minute 2 paid; minute 3 needs 2, only 1 left
    expect(r.summary.upkeepPaid).toBe(2);
    expect(r.summary.workerActions).toBe(1); // 2 minutes of work = one Oak action
    expect(workersView(r.state)).toMatchObject({ paused: true, crews: [{ status: 'paused' }] });
    // Gold never negative; while paused, time adds nothing.
    const still = simulate(r.state, T0 + 3 * HOUR);
    expect(still.summary.workerActions).toBe(0);
    expect(still.state.character.gold).toBe(1);
    // Selling logs brings gold: the command settles the workforce at once.
    const sold = applyCommand(still.state, cmd({ type: 'SELL_ITEM', itemId: 'bread', quantity: 3 }), T0 + 3 * HOUR);
    if (!sold.ok) throw new Error(sold.error.message);
    expect(sold.events).toContainEqual({ type: 'WORKERS_RESUMED' });
    expect(sold.state.workers.paused).toBe(false);
    expect(sold.state.character.gold).toBe(1 + 3 - 2);
  });

  it('dungeon gold resumes paused crews inside simulate, at the fight that brings it; split-invariant', () => {
    let s = hire(village({ gold: 10_000, seed: 17 }), 5);
    s = { ...s, character: { ...s.character, gold: 5 } };
    s = assignAll(s, 'oak'); // 5/min
    s = apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    const big = simulate(s, T0 + 4 * HOUR);
    expect(big.events.filter((e) => e.type === 'WORKERS_PAUSED').length).toBeGreaterThan(1);
    expect(big.events.filter((e) => e.type === 'WORKERS_RESUMED').length).toBeGreaterThan(0);
    expect(big.summary.dungeon.wins).toBeGreaterThan(50);
    expect(big.summary.workerActions).toBeGreaterThan(0);
    expect(big.state.character.gold).toBeGreaterThanOrEqual(0);
    let small = s;
    for (let t = T0 + 7 * SEC; t < T0 + 4 * HOUR; t += 7 * SEC) small = simulate(small, t).state;
    small = simulate(small, T0 + 4 * HOUR).state;
    expect(hashState(small)).toBe(hashState(big.state));
  });
});

describe('time rules', () => {
  it('offline: crews and upkeep use the granted (capped) time; 20 h away = 8 h of work, the same as 9 h away', () => {
    let s = hire(village({ seed: 2 }), 4);
    s = assignAll(s, 'stone');
    const a = simulate(s, T0 + 20 * HOUR);
    const b = simulate(s, T0 + 9 * HOUR);
    expect(a.summary.workerActions).toBe(240); // 8 h / 2:00
    expect(a.summary.upkeepPaid).toBe(b.summary.upkeepPaid);
    expect(a.summary.upkeepPaid).toBe(4 * (8 * 60 - 1)); // minute 1 was paid at assign
    expect(hashState({ ...a.state, time: b.state.time })).toBe(hashState(b.state));
  });

  it('split invariance: 1 s ticks = one big resume, with hero woodcutting, two crews, the builder and upkeep', () => {
    let s = hire(village({ seed: 31, th: 2, gold: 50_000 }), 6);
    s = apply(s, { type: 'ASSIGN_WORKER', workerId: 'w1', node: 'oak' }, T0);
    s = apply(s, { type: 'ASSIGN_WORKER', workerId: 'w2', node: 'oak' }, T0 + 3 * SEC);
    s = apply(s, { type: 'ASSIGN_WORKER', workerId: 'w3', node: 'stone' }, T0 + 5 * SEC);
    s = apply(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0 + 5 * SEC);
    s = {
      ...s,
      inventory: {
        ...s.inventory,
        items: [...s.inventory.items, { id: 'oak_logs', defId: 'oak_logs', name: 'Oak Logs', icon: '🪵', stackable: true, quantity: 25 }, { id: 'stone', defId: 'stone', name: 'Stone', icon: '🪨', stackable: true, quantity: 25 }],
      },
    };
    s = apply(s, { type: 'UPGRADE_BUILDING', buildingId: 'woodcutting', level: 2 }, T0 + 5 * SEC);
    const end = T0 + 5 * SEC + 40 * MIN;
    const big = simulate(s, end).state;
    let small = s;
    for (let t = T0 + 6 * SEC; t <= end; t += SEC) small = simulate(small, t).state;
    expect(hashState(small)).toBe(hashState(big));
    expect(big.buildings.woodcutting.level).toBe(2);
  });

  it('worker output that does not fit is lost, like the hero’s', () => {
    let s = hire(village({ seed: 6 }), 4);
    const filler = Array.from({ length: s.inventory.capacity }, (_, i) => ({ id: `junk${i}`, defId: 'rat_skin', name: 'x', icon: 'x', stackable: false }));
    s = { ...s, inventory: { ...s.inventory, items: filler } };
    s = assignAll(s, 'stone');
    const r = simulate(s, T0 + 20 * MIN);
    expect(r.summary.workerActions).toBe(10);
    expect(r.summary.workerItemsGained.stone ?? 0).toBe(0);
    expect(r.summary.workerItemsLost.stone).toBeGreaterThanOrEqual(10);
  });
});

describe('through the client', () => {
  it('hire, assign, play offline, dismiss: every row is logged and the log replays', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'wk' });
    await client.load();
    for (const id of ['woodcutting', 'mine_shaft', 'town_hall'] as const) await client.debug.build(id);
    await client.debug.addGold(5000);
    expect((await client.dispatch({ type: 'HIRE_WORKER', maxCost: 100 })).ok).toBe(true);
    expect((await client.dispatch({ type: 'HIRE_WORKER', maxCost: 200 })).ok).toBe(true);
    expect((await client.dispatch({ type: 'HIRE_WORKER', maxCost: 200 })).ok).toBe(false); // COST_CHANGED: not logged
    expect((await client.dispatch({ type: 'ASSIGN_WORKER', workerId: 'w1', node: 'oak' })).ok).toBe(true);
    expect((await client.dispatch({ type: 'ASSIGN_WORKER', workerId: 'w2', node: 'stone' })).ok).toBe(true);
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' })).ok).toBe(true);
    clock.advance(3 * HOUR);
    const summary = await client.resume();
    expect(summary.workerActions).toBe(180);
    expect(summary.upkeepPaid).toBe(2 * 179); // minute 1 was paid by each ASSIGN_WORKER
    expect((await client.dispatch({ type: 'DISMISS_WORKER', workerId: 'w1' })).ok).toBe(true);
    expect((await client.dispatch({ type: 'UNASSIGN_WORKER', workerId: 'w2' })).ok).toBe(true);
    clock.advance(10 * MIN);
    await client.tick();
    await client.persist();
    const rows = await repo.getAllLog();
    for (const t of ['HIRE_WORKER', 'ASSIGN_WORKER', 'DISMISS_WORKER', 'UNASSIGN_WORKER']) expect(rows.some((r) => r.type === t)).toBe(true);
    const report = replayLogReport(rows.map(({ seq: _s, synced: _y, ...r }) => r));
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});
