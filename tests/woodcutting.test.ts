// Woodcutting trees, woodcutting strength, the axe slot and the training stamina speed-up (engine 1.6.0, save v7).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { CommandInput, LogRow } from '../src/client/types';
import {
  activityView,
  applyCommand,
  CURRENT_SAVE_VERSION,
  ENGINE_VERSION,
  type GameState,
  getItemDef,
  hashState,
  loadSave,
  logMsFor,
  migrateDoc,
  MIGRATIONS,
  type MigratePayload,
  newGame,
  type ReplayEntry,
  replayLogReport,
  simulate,
  TRAINING,
  TREE_IDS,
  TREES,
  trainingView,
  WOODCUTTING,
  woodcutActivityView,
  woodcutSkipCost,
  woodcuttingStrength,
  woodcuttingView,
} from '../src/engine';
import { apply, cmd, HOUR, makeClient, MIN, qty, SEC, T0, woodcuttingGame, progressMs, builtGame, debugBuild } from './helpers';

const FIXTURES = join(__dirname, 'fixtures');
/** Frozen v6 save + its action log, written by the 1.5.0 engine before the woodcutting rework (tests/fixtures). */
const V6_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v6.json'), 'utf8'));
const V6_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v6.json'), 'utf8'));

const entries = (rows: LogRow[]): ReplayEntry[] =>
  rows.map((r) => ({ type: r.type, payload: r.payload, clientTime: r.clientTime, engineVersion: r.engineVersion, stateHash: r.stateHash }));

const OAK_MS = 110 * SEC;

function withWc(s: GameState, level: number, extra: Partial<GameState['character']['attributes']> = {}): GameState {
  return {
    ...s,
    character: {
      ...s.character,
      attributes: { ...s.character.attributes, ...extra },
      skills: { ...s.character.skills, woodcutting: { ...s.character.skills.woodcutting, level } },
    },
  };
}

function run(s: GameState, c: CommandInput, at: number) {
  return applyCommand(s, cmd(c), at);
}

describe('config: tree table and formulas', () => {
  it('required WS = max(0, 35 × reqLevel − 75) for every tree but Oak (0): 100, 450, 905, 1395', () => {
    const { reqWsPerLevel, reqWsOffset } = WOODCUTTING.formula;
    expect(TREES.oak.reqWs).toBe(0);
    for (const id of TREE_IDS.filter((t) => t !== 'oak')) {
      expect(TREES[id].reqWs).toBe(Math.max(0, reqWsPerLevel * TREES[id].reqLevel - reqWsOffset));
    }
    expect(TREE_IDS.map((id) => TREES[id].reqWs)).toEqual([0, 100, 450, 905, 1395]);
  });

  it('XP per log = round(12.5 × base minutes × reqLevel^0.4): 25 / 119 / 369 / 853 / 1672', () => {
    const { xpPerBaseMinute, xpLevelExponent } = WOODCUTTING.formula;
    for (const id of TREE_IDS) {
      const t = TREES[id];
      expect(t.xpPerLog).toBe(Math.round(xpPerBaseMinute * (t.baseMs / MIN) * Math.pow(t.reqLevel, xpLevelExponent)));
    }
    expect(TREE_IDS.map((id) => TREES[id].xpPerLog)).toEqual([25, 119, 369, 853, 1672]);
  });

  it('levels, base times and log items match the brief; every log item is a stackable common catalog item', () => {
    expect(TREE_IDS.map((id) => [TREES[id].reqLevel, TREES[id].baseMs / MIN, TREES[id].logItemId])).toEqual([
      [1, 2, 'oak_logs'],
      [5, 5, 'birch_logs'],
      [15, 10, 'maple_logs'],
      [28, 18, 'yew_logs'],
      [42, 30, 'ironwood_logs'],
    ]);
    for (const id of TREE_IDS) expect(getItemDef(TREES[id].logItemId)).toMatchObject({ stackable: true, quality: 'common' });
    expect(WOODCUTTING.rareDrops).toEqual([{ itemId: 'bird_nest', chance: 1 / 200 }]);
    expect(getItemDef('wooden_axe')).toMatchObject({ slot: 'axe', quality: 'common', woodcuttingStrength: 1 });
  });
});

describe('woodcutting strength (WS = 10 × level + effective STR + axe)', () => {
  it('a new hero has WS 21 (10 + 10 + 1) with the Wooden Axe equipped', () => {
    const s = builtGame(1, T0);
    expect(s.character.equipment.axe).toMatchObject({ id: 'start-wooden_axe', defId: 'wooden_axe', slot: 'axe' });
    expect(woodcuttingStrength(s)).toEqual({ value: 21, breakdown: { level: 10, strength: 10, axe: 1, axeDefId: 'wooden_axe' } });
  });

  it('level 5 base hero = 61; trained STR counts (effective); no axe or an unknown axe gives 0', () => {
    const s = withWc(builtGame(1, T0), 5);
    expect(woodcuttingStrength(s).value).toBe(61);
    const trained = { ...s, training: { ...s.training, attributes: { ...s.training.attributes, strength: { level: 39, xp: 0, progressMs: 0 } } } };
    expect(woodcuttingStrength(trained).breakdown).toMatchObject({ level: 50, strength: 49, axe: 1 });
    expect(woodcuttingStrength(trained).value).toBe(100);
    const { axe: _a, ...noAxe } = s.character.equipment;
    expect(woodcuttingStrength({ ...s, character: { ...s.character, equipment: noAxe } }).breakdown).toMatchObject({ axe: 0, axeDefId: null });
    const odd = { ...s.character.equipment, axe: { ...s.character.equipment.axe!, defId: 'nope' } };
    expect(woodcuttingStrength({ ...s, character: { ...s.character, equipment: odd } }).value).toBe(60);
  });
});

describe('cut time = max(10 s, base − 1 s × effective DEX)', () => {
  it('Oak at DEX 10 is 1:50; the 10 s floor; trained DEX counts', () => {
    expect(logMsFor('oak', { dexterity: 10 })).toBe(OAK_MS);
    expect(logMsFor('ironwood', { dexterity: 10 })).toBe(30 * MIN - 10 * SEC);
    expect(logMsFor('oak', { dexterity: 110 })).toBe(10 * SEC);
    expect(logMsFor('oak', { dexterity: 5000 })).toBe(10 * SEC);
    const s = woodcuttingGame();
    const trained = { ...s, training: { ...s.training, attributes: { ...s.training.attributes, dexterity: { level: 20, xp: 0, progressMs: 0 } } } };
    expect(woodcutActivityView(trained)?.logMs).toBe(90 * SEC); // DEX 10 + 20 trained
  });
});

describe('starting a tree', () => {
  it('TREE_LOCKED when the level or the WS is missing; nothing changes', () => {
    const s = builtGame(1, T0);
    const lvl = run(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'birch' }, T0);
    expect(lvl).toMatchObject({ ok: false, error: { code: 'TREE_LOCKED' } });
    // Level 5: level ✓, WS 61 < 100 ✗.
    const l5 = withWc(s, 5);
    const ws = run(l5, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'birch' }, T0);
    expect(ws).toMatchObject({ ok: false, error: { code: 'TREE_LOCKED', message: expect.stringContaining('61') } });
    expect(woodcuttingView(l5).trees[1]).toMatchObject({ levelOk: true, wsOk: false, unlocked: false });
    expect(l5.activity).toBeNull();
    // Enough STR opens it.
    const ok = run(withWc(s, 5, { strength: 49 }), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'birch' }, T0);
    expect(ok.ok && ok.state.activity).toEqual({ kind: 'woodcutting', treeId: 'birch', startedAt: T0, progressMs: 0 });
  });

  it('unknown or missing tree → UNKNOWN_TREE', () => {
    const s = builtGame(1, T0);
    expect(run(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'palm' as never }, T0)).toMatchObject({ ok: false, error: { code: 'UNKNOWN_TREE' } });
    expect(run(s, { type: 'START_ACTIVITY', kind: 'woodcutting' } as never, T0)).toMatchObject({ ok: false, error: { code: 'UNKNOWN_TREE' } });
  });

  it('same tree again keeps the log in progress; another tree restarts it', () => {
    const s = simulate(woodcuttingGame(), T0 + 50 * SEC).state;
    expect(progressMs(apply(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0 + 50 * SEC))).toBe(50 * SEC);
    const big = withWc(s, 5, { strength: 49 });
    const birch = apply(big, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'birch' }, T0 + 50 * SEC);
    expect(birch.activity).toEqual({ kind: 'woodcutting', treeId: 'birch', startedAt: T0 + 50 * SEC, progressMs: 0 });
  });

  it('a Birch log gives Birch Logs and 119 XP every 4:50 at DEX 10', () => {
    const s = apply(withWc(builtGame(3, T0), 5, { strength: 49 }), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'birch' }, T0);
    const r = simulate(s, T0 + 2 * 290 * SEC);
    expect(r.summary.actions).toBe(2);
    expect(r.summary.itemsGained.birch_logs).toBe(2);
    expect(r.summary.skillXpGained.woodcutting).toBe(238);
    expect(qty(r.state, 'oak_logs')).toBe(0);
  });
});

describe('back-to-back logs, live and offline', () => {
  it('logs follow each other through the 8 h cap; the excess is forfeited', () => {
    const s = woodcuttingGame();
    const r = simulate(s, T0 + 24 * HOUR);
    expect(r.summary.grantedMs).toBe(8 * HOUR);
    expect(r.summary.actions).toBe(Math.floor((8 * HOUR) / OAK_MS)); // 261
    expect(r.summary.actions).toBe(261);
    expect(progressMs(r.state)).toBe(8 * HOUR - 261 * OAK_MS);
    expect(hashState(r.state.inventory)).toBe(hashState(simulate(s, T0 + 8 * HOUR).state.inventory));
  });

  it('many small ticks equal one big resume (identical hash)', () => {
    const s = woodcuttingGame(11);
    let stepped = s;
    for (let t = 7 * SEC; t <= 2 * HOUR; t += 7 * SEC) stepped = simulate(stepped, T0 + t).state;
    expect(hashState(stepped)).toBe(hashState(simulate(s, stepped.time.lastSimulatedAt).state));
  });
});

describe('SKIP_WOODCUT', () => {
  const skip = (s: GameState, at: number, over: Partial<{ log: number; maxCost: number }> = {}) => {
    const v = woodcutActivityView(simulate(s, at).state)!;
    return run(s, { type: 'SKIP_WOODCUT', log: v.log, maxCost: v.skipCost, ...over }, at);
  };

  it('costs ceil(remaining minutes) stamina (at least 1) and completes exactly the current log', () => {
    expect([woodcutSkipCost(OAK_MS), woodcutSkipCost(60 * SEC), woodcutSkipCost(61 * SEC), woodcutSkipCost(10 * SEC), woodcutSkipCost(0)]).toEqual([2, 1, 2, 1, 1]);
    const s = woodcuttingGame();
    const r = skip(s, T0 + 20 * SEC); // 1:30 left → 2
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.stamina.current).toBe(98);
    expect(r.state.stats.totalActions).toBe(1);
    expect(qty(r.state, 'oak_logs')).toBe(1);
    expect(r.state.character.skills.woodcutting.xp).toBe(25);
    expect(progressMs(r.state)).toBe(0);
    // The next log continues from 0, free.
    expect(simulate(r.state, T0 + 20 * SEC + OAK_MS).state.stats.totalActions).toBe(2);
  });

  it('boundary guard: a log that finished before the command applies is never skipped twice (LOG_CHANGED)', () => {
    const s = woodcuttingGame();
    // The player saw log 1 with 10 s left (cost 1); by the time the command applies, log 1 finished for free.
    const r = run(s, { type: 'SKIP_WOODCUT', log: 1, maxCost: 1 }, T0 + OAK_MS + 5 * SEC);
    expect(r).toMatchObject({ ok: false, error: { code: 'LOG_CHANGED' } });
    // A higher real cost than shown is refused too.
    expect(skip(s, T0 + SEC, { maxCost: 1 })).toMatchObject({ ok: false, error: { code: 'LOG_CHANGED' } });
  });

  it('typed errors: not woodcutting, not enough stamina, invalid amounts; nothing changes', () => {
    expect(run(builtGame(1, T0), { type: 'SKIP_WOODCUT', log: 1, maxCost: 2 }, T0)).toMatchObject({ ok: false, error: { code: 'NOT_WOODCUTTING' } });
    const poor = { ...woodcuttingGame(), stamina: { current: 1, max: 100, progressMs: 0 } };
    expect(skip(poor, T0 + SEC)).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_STAMINA' } });
    expect(skip(woodcuttingGame(), T0, { maxCost: 0 })).toMatchObject({ ok: false, error: { code: 'INVALID_AMOUNT' } });
    expect(skip(woodcuttingGame(), T0, { log: 0 })).toMatchObject({ ok: false, error: { code: 'INVALID_COMMAND' } });
  });
});

describe('SPEEDUP_TRAINING', () => {
  /** Tier `tier`, training `strength`, stamina full. */
  function training(tier = 1): GameState {
    const s = builtGame(9, T0);
    return apply({ ...s, training: { ...s.training, tier } }, { type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' }, T0);
  }
  const speed = (s: GameState, minutes: number, maxCost = minutes) => run(s, { type: 'SPEEDUP_TRAINING', minutes, maxCost }, T0);

  it('+10 min adds 10 XP and spends 10 stamina; to next level levels up exactly', () => {
    const r = speed(apply(training(), { type: 'DEBUG_ADD_TRAINING_XP', xp: 5 }, T0), 10); // Lv1, 0 XP → 10 XP
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.training.attributes.strength).toEqual({ level: 1, xp: 10, progressMs: 0 });
    expect(r.state.stamina.current).toBe(90);
    const n = trainingView(r.state).attributes[0].speedupToNextLevel;
    expect(n).toBe(5); // 15 − 10
    const next = speed(r.state, n);
    if (!next.ok) throw new Error(next.error.message);
    expect(next.state.training.attributes.strength).toEqual({ level: 2, xp: 0, progressMs: 0 });
    expect(next.state.stamina.current).toBe(85);
    expect(next.events).toContainEqual({ type: 'TRAINING_LEVEL_UP', attribute: 'strength', level: 2 });
  });

  it('several level-ups in one command; a partial minute rounds the "to next level" cost up', () => {
    const r = speed(training(), 90); // 5 + 15 + 25 + 35 = 80 → Lv4 + 10 XP
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.training.attributes.strength).toEqual({ level: 4, xp: 10, progressMs: 0 });
    expect(r.events.filter((e) => e.type === 'TRAINING_LEVEL_UP')).toHaveLength(4);
    const half = simulate(training(), T0 + 30 * SEC).state; // 30 s into Lv1 (5 min)
    expect(trainingView(half).attributes[0].speedupToNextLevel).toBe(5); // 4:30 → 5
  });

  it('never charges for minutes beyond the cap: clamped, then training stops at the cap', () => {
    // Tier 1 cap 20; at Lv19 with 180 of 195 XP and 30 s, 15 minutes reach the cap (14:30 → 15).
    const s = training();
    const near = { ...s, training: { ...s.training, attributes: { ...s.training.attributes, strength: { level: 19, xp: 180, progressMs: 30_000 } } } };
    expect(trainingView(near).attributes[0].speedupToCap).toBe(15);
    const r = run(near, { type: 'SPEEDUP_TRAINING', minutes: 60, maxCost: 60 }, T0);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.stamina.current).toBe(85); // 15, not 60
    expect(r.state.training.attributes.strength).toEqual({ level: 20, xp: 0, progressMs: 0 });
    expect(r.state.activity).toBeNull();
    expect(r.events).toContainEqual({ type: 'TRAINING_MAXED', attribute: 'strength' });
  });

  it('maxCost guard and typed errors; nothing changes', () => {
    const s = training();
    expect(speed(s, 10, 9)).toMatchObject({ ok: false, error: { code: 'COST_CHANGED' } });
    expect(speed(builtGame(1, T0), 10)).toMatchObject({ ok: false, error: { code: 'NOT_TRAINING' } });
    expect(speed(woodcuttingGame(), 10)).toMatchObject({ ok: false, error: { code: 'NOT_TRAINING' } });
    expect(speed({ ...s, stamina: { current: 9, max: 100, progressMs: 0 } }, 10)).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_STAMINA' } });
    for (const bad of [0, -1, 1.5, Number.NaN, TRAINING.speedup.maxStepsPerCommand + 1]) {
      expect(speed(s, bad, 10)).toMatchObject({ ok: false, error: { code: 'INVALID_AMOUNT' } });
    }
    expect(speed(s, 5, 0)).toMatchObject({ ok: false, error: { code: 'INVALID_AMOUNT' } });
    expect(s.stamina.current).toBe(100);
  });
});

describe('one activity at a time (woodcutting, dungeon, training)', () => {
  it('woodcutting ↔ dungeon ↔ training: each stops the others; a dungeon run is lost, training XP kept', () => {
    let s = woodcuttingGame();
    s = { ...s, training: { ...s.training, tier: 1 } };
    // Woodcutting → dungeon: logs so far kept.
    let r = run(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0 + 2 * OAK_MS);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.stats.totalActions).toBe(2);
    expect(r.state.activity?.kind).toBe('dungeon');
    // Dungeon → woodcutting: the run in progress is lost.
    r = run(r.state, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0 + 2 * OAK_MS + MIN);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events).toContainEqual({ type: 'DUNGEON_RUN_CANCELLED', dungeonId: 'rat_cellar' });
    expect(r.state.dungeon.totals.runs).toBe(0);
    // Woodcutting → training → woodcutting: training XP kept.
    r = run(r.state, { type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' }, T0 + 2 * OAK_MS + MIN);
    if (!r.ok) throw new Error(r.error.message);
    r = run(r.state, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0 + 2 * OAK_MS + 4 * MIN);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.training.attributes.strength.xp).toBe(3);
    expect(r.state.activity).toMatchObject({ kind: 'woodcutting', treeId: 'oak', progressMs: 0 });
  });
});

describe('views', () => {
  it('the carousel opens on the active tree, else the highest unlocked tree', () => {
    expect(woodcuttingView(builtGame(1, T0)).focusTreeId).toBe('oak');
    const big = withWc(builtGame(1, T0), 20, { strength: 400 }); // WS 601: Maple
    expect(woodcuttingView(big).focusTreeId).toBe('maple');
    const cutting = apply(big, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'birch' }, T0);
    expect(woodcuttingView(cutting)).toMatchObject({ focusTreeId: 'birch', activeTreeId: 'birch' });
    expect(activityView(cutting)).toMatchObject({ kind: 'woodcutting', treeId: 'birch', log: 1, skipCost: 5, logMs: 290 * SEC });
  });
});

describe('DEBUG_ADD_WOODCUTTING_LEVEL', () => {
  it('+1 level keeps XP, sets debugUsed, and ×4 shows Birch with level ✓ and WS ✗ (61/100)', () => {
    let s = simulate(woodcuttingGame(), T0 + 3 * OAK_MS).state; // 75 XP
    for (let i = 0; i < 4; i++) s = apply(s, { type: 'DEBUG_ADD_WOODCUTTING_LEVEL', levels: 1 }, T0 + 3 * OAK_MS);
    expect(s.flags.debugUsed).toBe(true);
    expect(s.character.skills.woodcutting).toMatchObject({ level: 5, xp: 75 });
    const v = woodcuttingView(s);
    expect(v.ws.value).toBe(61);
    expect(v.trees[1]).toMatchObject({ levelOk: true, wsOk: false, unlocked: false });
    const bad = run(s, { type: 'DEBUG_ADD_WOODCUTTING_LEVEL', levels: 0 }, T0 + 3 * OAK_MS);
    expect(bad).toMatchObject({ ok: false, error: { code: 'INVALID_AMOUNT' } });
    const off = applyCommand(s, cmd({ type: 'DEBUG_ADD_WOODCUTTING_LEVEL', levels: 1 }), T0 + 3 * OAK_MS, { allowDebug: false });
    expect(off).toMatchObject({ ok: false, error: { code: 'DEBUG_DISABLED' } });
  });

  it('client: the debug level, a skip and a speed-up are logged and the whole log replays', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'wcdbg' });
    await client.load();
    await debugBuild(client, ['woodcutting', 'training_grounds']);
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' });
    clock.advance(30 * SEC);
    const v = woodcutActivityView(client.getState())!;
    expect((await client.dispatch({ type: 'SKIP_WOODCUT', log: v.log, maxCost: 2 })).ok).toBe(true);
    expect((await client.debug.addWoodcuttingLevel()).ok).toBe(true);
    await client.debug.addGold(100);
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'training', attribute: 'dexterity' }); // Tier 1 came with the Training Grounds
    expect((await client.dispatch({ type: 'SPEEDUP_TRAINING', minutes: 10, maxCost: 10 })).ok).toBe(true);
    clock.advance(5 * MIN);
    await client.resume();
    const s = client.getState();
    expect(s.character.skills.woodcutting.level).toBe(2);
    expect(s.training.attributes.dexterity.level).toBe(1);
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(hashState(report.state)).toBe(hashState(s));
  });
});

describe('frozen v6 save (tests/fixtures/save-v6.json) → v7', () => {
  async function v6Phone() {
    const repo = new MemoryGameRepository();
    await repo.init();
    await repo.commit(
      V6_LOG.map(({ seq: _seq, synced: _synced, ...r }) => r),
      V6_SAVE as GameState,
      { [META_ENGINE_VERSION]: '1.5.0', device_id: 'phone' },
    );
    const clock = new FakeClock(V6_SAVE.time.lastSimulatedAt + 3 * MIN);
    return makeClient({ repo, clock, prefix: 'v7' });
  }

  it('is what the 1.5.0 engine wrote: woodcutting Lv5 mid-log, 1338 Oak Logs, 9 nests, STR trained 4, no axe slot', () => {
    expect(V6_SAVE.saveVersion).toBe(6);
    expect(V6_SAVE.activity).toEqual({ kind: 'woodcutting', startedAt: V6_SAVE.activity.startedAt, progressMs: 540 });
    expect(V6_SAVE.character.skills.woodcutting).toEqual({ level: 5, xp: 4868, xpToNext: 5590 });
    expect(V6_SAVE.character.equipment).not.toHaveProperty('axe');
    expect(new Set(V6_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.5.0']));
  });

  it('migrates: keeps WC level, XP and logs; equips the Wooden Axe; Oak from progress 0; pure', () => {
    const frozen = JSON.parse(JSON.stringify(V6_SAVE));
    // The v6 → v7 step only (v7 → v8 is tested from the v7 fixture in tests/merchant.test.ts).
    const s = migrateDoc(V6_SAVE, MIGRATIONS, 7) as unknown as GameState;
    expect(V6_SAVE).toEqual(frozen);
    expect(s.saveVersion).toBe(7);
    expect(s.character.skills).toEqual(V6_SAVE.character.skills);
    expect(s.inventory).toEqual(V6_SAVE.inventory);
    expect(qty(s, 'oak_logs')).toBe(1338);
    expect(qty(s, 'bird_nest')).toBe(9);
    expect(s.activity).toEqual({ kind: 'woodcutting', treeId: 'oak', startedAt: V6_SAVE.activity.startedAt, progressMs: 0 });
    expect(s.character.equipment.axe).toEqual({ id: 'start-wooden_axe', defId: 'wooden_axe', name: 'Wooden Axe', icon: '🪓', rarity: 'common', slot: 'axe' });
    const { equipment: { axe: _x, ...equipment }, ...character } = s.character;
    expect({ ...character, equipment }).toEqual(V6_SAVE.character);
    // WS: 10 × 5 + STR (10 + 4 trained) + 1 = 65.
    expect(woodcuttingStrength(s).value).toBe(65);
    expect(hashState(migrateDoc(V6_SAVE, MIGRATIONS, 7))).toBe(hashState(s as never));
  });

  it('loading writes a MIGRATE anchor (save 6 → 7, engine 1.5.0 → 1.6.0), plays on, and the whole log replays', async () => {
    const { repo, clock, client } = await v6Phone();
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({
      fromSave: 6,
      toSave: CURRENT_SAVE_VERSION,
      fromEngine: '1.5.0',
      toEngine: ENGINE_VERSION,
      fromHash: V6_LOG.at(-1)!.stateHash,
      snapshot: undefined,
    });
    expect(p.snapshot).toEqual(loadSave(V6_SAVE));
    // 1.9.0 (save v10): woodcutting stops on migration (its building starts locked), so the 3 minutes before load
    // cut nothing. Built again (debug) and restarted, Oak cuts from progress 0.
    expect(client.getState().activity).toBeNull();
    expect(qty(client.getState(), 'oak_logs')).toBe(1338);
    await debugBuild(client, ['woodcutting']);
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' })).ok).toBe(true);
    clock.advance(HOUR);
    await client.resume();
    expect(client.getState().stats.totalActions).toBe(V6_SAVE.stats.totalActions + Math.floor(HOUR / OAK_MS));
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: V6_LOG.length });
    expect(hashState(report.state)).toBe(hashState(client.getState()));
  });
});
