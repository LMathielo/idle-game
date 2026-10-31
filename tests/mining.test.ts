// Mining at the Mine Shaft: rocks, mining strength, the pickaxe slot, skip, rare drop and the stop rule (engine 1.9.0,
// save v10). Mirrors tests/woodcutting.test.ts: mining has its own config and must behave the same way today.
import { describe, expect, it } from 'vitest';
import type { CommandInput } from '../src/client/types';
import {
  activityView,
  applyCommand,
  type GameState,
  getItemDef,
  hashState,
  isNoteworthy,
  mineActivityView,
  mineSkipCost,
  MINING,
  miningStrength,
  miningView,
  oreMsFor,
  replayLogReport,
  ROCK_IDS,
  ROCKS,
  simulate,
  TREES,
  WOODCUTTING,
} from '../src/engine';
import { apply, builtGame, cmd, debugBuild, HOUR, makeClient, MIN, progressMs, qty, SEC, T0 } from './helpers';

const STONE_MS = 110 * SEC;

function withMining(s: GameState, level: number, extra: Partial<GameState['character']['attributes']> = {}): GameState {
  return {
    ...s,
    character: {
      ...s.character,
      attributes: { ...s.character.attributes, ...extra },
      skills: { ...s.character.skills, mining: { ...s.character.skills.mining, level } },
    },
  };
}

function run(s: GameState, c: CommandInput, at: number) {
  return applyCommand(s, cmd(c), at);
}

/** New game at T0 (buildings built) mining Stone. */
function miningGame(seed = 42): GameState {
  return apply(builtGame(seed, T0), { type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' }, T0);
}

describe('config: rock table and formulas (own config, same numbers as the trees today)', () => {
  it('required MS = max(20, 35 × reqLevel − 75): 20, 100, 450, 905, 1395 (Stone 0 → 20 in 1.10.0: it is the yield divisor)', () => {
    const { reqMsFloor, reqMsPerLevel, reqMsOffset } = MINING.formula;
    for (const id of ROCK_IDS) {
      expect(ROCKS[id].reqMs).toBe(Math.max(reqMsFloor, reqMsPerLevel * ROCKS[id].reqLevel - reqMsOffset));
    }
    expect(ROCK_IDS.map((id) => ROCKS[id].reqMs)).toEqual([20, 100, 450, 905, 1395]);
  });

  it('XP per ore = round(12.5 × base minutes × reqLevel^0.4): 25 / 119 / 369 / 853 / 1672', () => {
    const { xpPerBaseMinute, xpLevelExponent } = MINING.formula;
    for (const id of ROCK_IDS) {
      const r = ROCKS[id];
      expect(r.xpPerOre).toBe(Math.round(xpPerBaseMinute * (r.baseMs / MIN) * Math.pow(r.reqLevel, xpLevelExponent)));
    }
    expect(ROCK_IDS.map((id) => ROCKS[id].xpPerOre)).toEqual([25, 119, 369, 853, 1672]);
  });

  it('levels, base times and ore items match the brief; ores are stackable commons with their sell prices', () => {
    expect(ROCK_IDS.map((id) => [ROCKS[id].reqLevel, ROCKS[id].baseMs / MIN, ROCKS[id].oreItemId])).toEqual([
      [1, 2, 'stone'],
      [5, 5, 'copper_ore'],
      [15, 10, 'iron_ore'],
      [28, 18, 'silver_ore'],
      [42, 30, 'gold_ore'],
    ]);
    expect(ROCK_IDS.map((id) => getItemDef(ROCKS[id].oreItemId))).toEqual(
      [1, 3, 8, 20, 50].map((sellPrice) => expect.objectContaining({ stackable: true, quality: 'common', sellPrice })),
    );
    expect(MINING.rareDrops).toEqual([{ itemId: 'geode', chance: 1 / 200 }]);
    expect(getItemDef('geode')).toMatchObject({ quality: 'uncommon', sellPrice: 30, stackable: true });
    expect(getItemDef('wooden_pickaxe')).toMatchObject({ slot: 'pickaxe', quality: 'common', miningStrength: 1, sellPrice: 1 });
    expect(getItemDef('iron_pickaxe')).toMatchObject({ slot: 'pickaxe', miningStrength: 40, buyPrice: 600, sellPrice: 180 });
  });

  it('shares no constant object with woodcutting (each skill can get its own bonuses later)', () => {
    expect(MINING).not.toBe(WOODCUTTING);
    expect(MINING.skip).not.toBe(WOODCUTTING.skip);
    expect(MINING.formula).not.toBe(WOODCUTTING.formula);
    expect(MINING.rareDrops).not.toBe(WOODCUTTING.rareDrops);
    expect(ROCKS.stone).not.toBe(TREES.oak as unknown);
  });
});

describe('mining strength (MS = 10 × level + effective STR + pickaxe)', () => {
  it('a new hero has MS 21 (10 + 10 + 1) with the Wooden Pickaxe equipped', () => {
    const s = builtGame(1, T0);
    expect(s.character.equipment.pickaxe).toEqual({ id: 'start-wooden_pickaxe', defId: 'wooden_pickaxe', name: 'Wooden Pickaxe', icon: '⛏️', slot: 'pickaxe' });
    expect(miningStrength(s)).toEqual({ value: 21, breakdown: { level: 10, strength: 10, pickaxe: 1, pickaxeDefId: 'wooden_pickaxe' } });
  });

  it('level 5 base hero = 61; trained STR counts; no pickaxe or an unknown one gives 0; the axe never counts', () => {
    const s = withMining(builtGame(1, T0), 5);
    expect(miningStrength(s).value).toBe(61);
    const trained = { ...s, training: { ...s.training, attributes: { ...s.training.attributes, strength: { level: 39, xp: 0, progressMs: 0 } } } };
    expect(miningStrength(trained).breakdown).toMatchObject({ level: 50, strength: 49, pickaxe: 1 });
    const { pickaxe: _p, ...noPick } = s.character.equipment;
    expect(miningStrength({ ...s, character: { ...s.character, equipment: noPick } }).breakdown).toMatchObject({ pickaxe: 0, pickaxeDefId: null });
    const odd = { ...s.character.equipment, pickaxe: { ...s.character.equipment.pickaxe!, defId: 'nope' } };
    expect(miningStrength({ ...s, character: { ...s.character, equipment: odd } }).value).toBe(60);
    // Woodcutting level and the axe feed WS only.
    const wc = { ...s, character: { ...s.character, skills: { ...s.character.skills, woodcutting: { level: 50, xp: 0, xpToNext: 1 } } } };
    expect(miningStrength(wc).value).toBe(61);
  });
});

describe('time per ore = max(10 s, base − 1 s × effective DEX)', () => {
  it('Stone at DEX 10 is 1:50; the 10 s floor; trained DEX counts', () => {
    expect(oreMsFor('stone', { dexterity: 10 })).toBe(STONE_MS);
    expect(oreMsFor('gold', { dexterity: 10 })).toBe(30 * MIN - 10 * SEC);
    expect(oreMsFor('stone', { dexterity: 110 })).toBe(10 * SEC);
    const s = miningGame();
    const trained = { ...s, training: { ...s.training, attributes: { ...s.training.attributes, dexterity: { level: 20, xp: 0, progressMs: 0 } } } };
    expect(mineActivityView(trained)?.oreMs).toBe(90 * SEC);
  });
});

describe('starting a rock', () => {
  it('ROCK_LOCKED when the level or the MS is missing; nothing changes; enough STR opens it', () => {
    const s = builtGame(1, T0);
    expect(run(s, { type: 'START_ACTIVITY', kind: 'mining', rockId: 'copper' }, T0)).toMatchObject({ ok: false, error: { code: 'ROCK_LOCKED' } });
    const l5 = withMining(s, 5);
    const ms = run(l5, { type: 'START_ACTIVITY', kind: 'mining', rockId: 'copper' }, T0);
    expect(ms).toMatchObject({ ok: false, error: { code: 'ROCK_LOCKED', message: expect.stringContaining('61') } });
    expect(miningView(l5).rocks[1]).toMatchObject({ levelOk: true, msOk: false, unlocked: false });
    const ok = run(withMining(s, 5, { strength: 49 }), { type: 'START_ACTIVITY', kind: 'mining', rockId: 'copper' }, T0);
    expect(ok.ok && ok.state.activity).toEqual({ kind: 'mining', rockId: 'copper', startedAt: T0, progressMs: 0 });
  });

  it('unknown or missing rock → UNKNOWN_ROCK', () => {
    const s = builtGame(1, T0);
    expect(run(s, { type: 'START_ACTIVITY', kind: 'mining', rockId: 'diamond' as never }, T0)).toMatchObject({ ok: false, error: { code: 'UNKNOWN_ROCK' } });
    expect(run(s, { type: 'START_ACTIVITY', kind: 'mining' } as never, T0)).toMatchObject({ ok: false, error: { code: 'UNKNOWN_ROCK' } });
  });

  it('same rock again keeps the ore in progress; another rock restarts it', () => {
    const s = simulate(miningGame(), T0 + 50 * SEC).state;
    expect(progressMs(apply(s, { type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' }, T0 + 50 * SEC))).toBe(50 * SEC);
    const copper = apply(withMining(s, 5, { strength: 49 }), { type: 'START_ACTIVITY', kind: 'mining', rockId: 'copper' }, T0 + 50 * SEC);
    expect(copper.activity).toEqual({ kind: 'mining', rockId: 'copper', startedAt: T0 + 50 * SEC, progressMs: 0 });
  });

  it('a Stone ore gives 1 Stone and 25 mining XP, no hero or woodcutting XP; Copper gives 119 every 4:50', () => {
    const r = simulate(miningGame(), T0 + 3 * STONE_MS);
    expect(r.summary).toMatchObject({ oresMined: 3, actions: 0, itemsGained: { stone: 3 }, skillXpGained: { mining: 75 }, heroXpGained: 0 });
    expect(qty(r.state, 'stone')).toBe(3);
    expect(r.state.character.skills.mining.xp).toBe(75);
    expect(r.state.character.skills.woodcutting.xp).toBe(0);
    expect(r.state.stats.itemsGathered.stone).toBe(3);
    const c = apply(withMining(builtGame(3, T0), 5, { strength: 49 }), { type: 'START_ACTIVITY', kind: 'mining', rockId: 'copper' }, T0);
    const rc = simulate(c, T0 + 2 * 290 * SEC);
    expect(rc.summary).toMatchObject({ oresMined: 2, itemsGained: { copper_ore: 2 }, skillXpGained: { mining: 238 } });
  });

  it('mining levels up along the skill curve and emits SKILL_LEVEL_UP for mining', () => {
    const r = simulate(miningGame(), T0 + 4 * STONE_MS); // 100 XP = Lv2 (skill curve base 100 since 1.12.0)
    expect(r.state.character.skills.mining).toMatchObject({ level: 2, xp: 0 });
    expect(r.events).toContainEqual({ type: 'SKILL_LEVEL_UP', skill: 'mining', level: 2 });
    expect(r.summary.skillLevelsGained).toEqual({ mining: 1 });
  });
});

describe('back-to-back ores, live and offline', () => {
  it('ores follow each other through the 8 h cap; the excess is forfeited', () => {
    const r = simulate(miningGame(), T0 + 24 * HOUR);
    expect(r.summary.grantedMs).toBe(8 * HOUR);
    expect(r.summary.oresMined).toBe(261);
    expect(progressMs(r.state)).toBe(8 * HOUR - 261 * STONE_MS);
    expect(isNoteworthy(r.summary)).toBe(true);
  });

  it('many small ticks equal one big resume (identical hash)', () => {
    const s = miningGame(11);
    let stepped = s;
    for (let t = 7 * SEC; t <= 2 * HOUR; t += 7 * SEC) stepped = simulate(stepped, T0 + t).state;
    expect(hashState(stepped)).toBe(hashState(simulate(s, stepped.time.lastSimulatedAt).state));
  });

  it('Geode drops at ~1/200 per ore over a long run and rolls the seeded RNG', () => {
    let s = { ...miningGame(5), character: { ...miningGame(5).character, attributes: { strength: 10, dexterity: 1000, endurance: 10, intelligence: 10 } } };
    let geodes = 0;
    let ores = 0;
    for (let h = 1; h <= 40; h++) {
      const r = simulate(s, T0 + h * 8 * HOUR);
      geodes += r.summary.itemsGained.geode ?? 0;
      ores += r.summary.oresMined;
      s = r.state;
    }
    expect(ores).toBe(40 * 2880); // 10 s floor
    expect(geodes).toBeGreaterThan(ores / 200 / 2);
    expect(geodes).toBeLessThan((ores / 200) * 2);
    expect(qty(s, 'geode')).toBe(geodes);
  });

  it('inventory full: ores still stack, a new stack is lost and counted', () => {
    const s = miningGame();
    const full = { ...s, inventory: { ...s.inventory, capacity: s.inventory.items.length } };
    const r = simulate(full, T0 + STONE_MS);
    expect(r.summary.itemsLost).toEqual({ stone: 1 });
    expect(r.state.character.skills.mining.xp).toBe(25);
  });

  it('never mutates its input', () => {
    const s = miningGame();
    const frozen = JSON.parse(JSON.stringify(s));
    simulate(s, T0 + 2 * HOUR);
    expect(s).toEqual(frozen);
  });
});

describe('SKIP_MINE', () => {
  const skip = (s: GameState, at: number, over: Partial<{ ore: number; maxCost: number }> = {}) => {
    const v = mineActivityView(simulate(s, at).state)!;
    return run(s, { type: 'SKIP_MINE', ore: v.ore, maxCost: v.skipCost, ...over }, at);
  };

  it('costs ceil(remaining minutes) stamina (at least 1) and completes exactly the current ore', () => {
    expect([mineSkipCost(STONE_MS), mineSkipCost(60 * SEC), mineSkipCost(61 * SEC), mineSkipCost(0)]).toEqual([2, 1, 2, 1]);
    const r = skip(miningGame(), T0 + 20 * SEC);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.stamina.current).toBe(98);
    expect(r.state.stats.totalActions).toBe(1);
    expect(qty(r.state, 'stone')).toBe(1);
    expect(r.state.character.skills.mining.xp).toBe(25);
    expect(progressMs(r.state)).toBe(0);
    expect(simulate(r.state, T0 + 20 * SEC + STONE_MS).state.stats.totalActions).toBe(2);
  });

  it('boundary guard: an ore that finished before the command applies is never skipped twice (ORE_CHANGED)', () => {
    const s = miningGame();
    expect(run(s, { type: 'SKIP_MINE', ore: 1, maxCost: 1 }, T0 + STONE_MS + 5 * SEC)).toMatchObject({ ok: false, error: { code: 'ORE_CHANGED' } });
    expect(skip(s, T0 + SEC, { maxCost: 1 })).toMatchObject({ ok: false, error: { code: 'ORE_CHANGED' } });
  });

  it('typed errors: not mining, not enough stamina, invalid amounts', () => {
    expect(run(builtGame(1, T0), { type: 'SKIP_MINE', ore: 1, maxCost: 2 }, T0)).toMatchObject({ ok: false, error: { code: 'NOT_MINING' } });
    const wood = apply(builtGame(1, T0), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0);
    expect(run(wood, { type: 'SKIP_MINE', ore: 1, maxCost: 2 }, T0)).toMatchObject({ ok: false, error: { code: 'NOT_MINING' } });
    const poor = { ...miningGame(), stamina: { current: 1, max: 100, progressMs: 0 } };
    expect(skip(poor, T0 + SEC)).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_STAMINA' } });
    expect(skip(miningGame(), T0, { maxCost: 0 })).toMatchObject({ ok: false, error: { code: 'INVALID_AMOUNT' } });
    expect(skip(miningGame(), T0, { ore: 0 })).toMatchObject({ ok: false, error: { code: 'INVALID_COMMAND' } });
  });
});

describe('the pickaxe: equip, unequip and the stop rule', () => {
  /** Mining Lv5 with STR 48 (MS 99, Copper needs 100), the Iron Pickaxe equipped from the bag (MS 138), mining Copper. */
  function copperWithIronPick(): GameState {
    const s = withMining(builtGame(2, T0), 5, { strength: 48 }); // 50 + 48 + 1 = 99: Copper locked
    const bag = { ...s, inventory: { ...s.inventory, items: [...s.inventory.items, { id: 'iron_pickaxe#1', defId: 'iron_pickaxe', name: 'Iron Pickaxe', icon: '⛏️', slot: 'pickaxe' as const }] } };
    expect(run(bag, { type: 'START_ACTIVITY', kind: 'mining', rockId: 'copper' }, T0)).toMatchObject({ ok: false, error: { code: 'ROCK_LOCKED' } });
    const equipped = apply(bag, { type: 'EQUIP_ITEM', itemId: 'iron_pickaxe#1' }, T0);
    expect(miningStrength(equipped).value).toBe(138); // 50 + 48 + 40
    expect(equipped.inventory.items.some((i) => i.id === 'start-wooden_pickaxe')).toBe(true); // swapped back
    return apply(equipped, { type: 'START_ACTIVITY', kind: 'mining', rockId: 'copper' }, T0);
  }

  it('equipping the Iron Pickaxe opens Copper; the Wooden Pickaxe goes back to the bag', () => {
    expect(copperWithIronPick().activity).toMatchObject({ kind: 'mining', rockId: 'copper' });
  });

  it('re-equipping the Wooden Pickaxe drops MS below Copper: mining stops; finished ores are kept', () => {
    const s = simulate(copperWithIronPick(), T0 + 290 * SEC + MIN).state; // 1 ore + 1 min into the next
    expect(qty(s, 'copper_ore')).toBe(1);
    const r = run(s, { type: 'EQUIP_ITEM', itemId: 'start-wooden_pickaxe' }, T0 + 290 * SEC + MIN);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.activity).toBeNull();
    expect(r.events).toContainEqual({ type: 'ACTIVITY_STOPPED', kind: 'mining' });
    expect(qty(r.state, 'copper_ore')).toBe(1);
  });

  it('unequipping the pickaxe stops it too; Stone (MS 0) keeps running without a pickaxe', () => {
    const r = run(copperWithIronPick(), { type: 'UNEQUIP_ITEM', slot: 'pickaxe' }, T0 + MIN);
    expect(r.ok && r.state.activity).toBeNull();
    const stone = run(miningGame(), { type: 'UNEQUIP_ITEM', slot: 'pickaxe' }, T0 + MIN);
    expect(stone.ok && stone.state.activity).toMatchObject({ kind: 'mining', rockId: 'stone', progressMs: MIN });
  });

  it('pickaxe changes never stop woodcutting, and axe changes never stop mining', () => {
    const wood = apply(builtGame(1, T0), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0);
    expect(apply(wood, { type: 'UNEQUIP_ITEM', slot: 'pickaxe' }, T0).activity).toMatchObject({ kind: 'woodcutting' });
    const s = copperWithIronPick();
    expect(apply(s, { type: 'UNEQUIP_ITEM', slot: 'axe' }, T0).activity).toMatchObject({ kind: 'mining', rockId: 'copper' });
  });

  it('the merchant sells the Iron Pickaxe right after the Iron Axe, and it equips into the pickaxe slot', () => {
    const rich = apply(builtGame(4, T0), { type: 'DEBUG_ADD_GOLD', amount: 1000 }, T0);
    expect(rich.merchant.stock[2]).toEqual({ defId: 'iron_pickaxe', quantity: 1, unitPrice: 600 });
    const bought = apply(rich, { type: 'BUY_ITEM', slot: 2, defId: 'iron_pickaxe', quantity: 1, maxUnitPrice: 600 }, T0);
    const e = apply(bought, { type: 'EQUIP_ITEM', itemId: 'iron_pickaxe#1' }, T0);
    expect(e.character.equipment.pickaxe?.defId).toBe('iron_pickaxe');
    expect(e.character.gold).toBe(1025 - 600);
  });
});

describe('one activity at a time, views and debug', () => {
  it('mining ↔ woodcutting ↔ dungeon ↔ training: each stops the others', () => {
    let s = miningGame();
    s = { ...s, training: { ...s.training, tier: 1 } };
    let r = run(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0 + 2 * STONE_MS);
    if (!r.ok) throw new Error(r.error.message);
    expect(qty(r.state, 'stone')).toBe(2);
    expect(r.events).toContainEqual({ type: 'ACTIVITY_STOPPED', kind: 'mining' });
    r = run(r.state, { type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' }, T0 + 2 * STONE_MS + MIN);
    if (!r.ok) throw new Error(r.error.message);
    r = run(r.state, { type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' }, T0 + 2 * STONE_MS + MIN);
    expect(r.ok && r.state.activity?.kind).toBe('training');
    r = run(miningGame(), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0 + MIN);
    expect(r.ok && r.state.activity?.kind).toBe('dungeon');
  });

  it('the carousel opens on the active rock, else the highest unlocked one; the strip view matches', () => {
    expect(miningView(builtGame(1, T0)).focusRockId).toBe('stone');
    const big = withMining(builtGame(1, T0), 20, { strength: 400 }); // MS 601: Iron
    expect(miningView(big).focusRockId).toBe('iron');
    const m = apply(big, { type: 'START_ACTIVITY', kind: 'mining', rockId: 'copper' }, T0);
    expect(miningView(m)).toMatchObject({ focusRockId: 'copper', activeRockId: 'copper' });
    expect(activityView(m)).toMatchObject({ kind: 'mining', rockId: 'copper', ore: 1, skipCost: 5, oreMs: 290 * SEC });
  });

  it('DEBUG_ADD_MINING_LEVEL keeps XP, sets debugUsed, bounded', () => {
    let s = simulate(miningGame(), T0 + 3 * STONE_MS).state;
    s = apply(s, { type: 'DEBUG_ADD_MINING_LEVEL', levels: 4 }, T0 + 3 * STONE_MS);
    expect(s.flags.debugUsed).toBe(true);
    expect(s.character.skills.mining).toMatchObject({ level: 5, xp: 75 });
    expect(run(s, { type: 'DEBUG_ADD_MINING_LEVEL', levels: 0 }, T0 + 3 * STONE_MS)).toMatchObject({ ok: false, error: { code: 'INVALID_AMOUNT' } });
    const off = applyCommand(s, cmd({ type: 'DEBUG_ADD_MINING_LEVEL', levels: 1 }), T0 + 3 * STONE_MS, { allowDebug: false });
    expect(off).toMatchObject({ ok: false, error: { code: 'DEBUG_DISABLED' } });
  });

  it('client: build, mine, skip, debug level, pickaxe swap — logged, and the whole log replays', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'mine' });
    await client.load();
    await debugBuild(client, ['mine_shaft']);
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' })).ok).toBe(true);
    clock.advance(30 * SEC);
    const v = mineActivityView(client.getState())!;
    expect((await client.dispatch({ type: 'SKIP_MINE', ore: v.ore, maxCost: 2 })).ok).toBe(true);
    expect((await client.debug.addMiningLevel()).ok).toBe(true);
    expect((await client.dispatch({ type: 'UNEQUIP_ITEM', slot: 'pickaxe' })).ok).toBe(true);
    clock.advance(2 * HOUR);
    await client.resume();
    await client.persist();
    expect(client.getState().character.skills.mining.level).toBeGreaterThanOrEqual(3);
    const rows = await repo.getAllLog();
    expect(rows.map((r) => r.type)).toEqual(expect.arrayContaining(['DEBUG_BUILD', 'SKIP_MINE', 'DEBUG_ADD_MINING_LEVEL', 'UNEQUIP_ITEM']));
    const report = replayLogReport(rows.map((r) => ({ type: r.type, payload: r.payload, clientTime: r.clientTime, engineVersion: r.engineVersion, stateHash: r.stateHash })));
    expect(hashState(report.state)).toBe(hashState(client.getState()));
    expect(client.getSnapshot().awaySummary?.oresMined).toBeGreaterThan(60);
  });
});
