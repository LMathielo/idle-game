// Training Grounds upgrades (engine 1.11.0, save v11 unchanged): +1 training XP per minute per level, read when the XP
// is credited (an upgrade completing mid-training counts from that instant), the stamina speed-up at the current
// rate, the Town Hall cap, and the frozen v11 fixture written by the 1.10.0 engine (engine-only MIGRATE anchor).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { LogRow } from '../src/client/types';
import {
  applyCommand,
  BUILDINGS,
  CURRENT_SAVE_VERSION,
  ENGINE_VERSION,
  type GameState,
  hashState,
  loadSave,
  type MigratePayload,
  type ReplayEntry,
  replayLogReport,
  simulate,
  trainingView,
  trainingXpPerMinute,
  upgradeView,
} from '../src/engine';
import type { CommandInput } from '../src/client/types';
import { apply, builtGame, cmd, HOUR, makeClient, MIN, SEC, T0, V13_ADDED, v12Skills } from './helpers';

const FIXTURES = join(__dirname, 'fixtures');
/** Frozen v11 save + its action log, written by the 1.10.0 engine before Training Grounds upgrades (tests/fixtures). */
const V11_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v11.json'), 'utf8'));
const V11_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v11.json'), 'utf8'));

const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);

/** Every building built, the Training Grounds and Town Hall at the given levels, gold and every upgrade material. */
function game(opts: { grounds?: number; townHall?: number; seed?: number } = {}): GameState {
  const s = builtGame(opts.seed ?? 7, T0);
  const items = ['oak_logs', 'stone', 'birch_logs', 'copper_ore', 'maple_logs', 'iron_ore', 'yew_logs', 'silver_ore'].map((id) => ({
    id,
    defId: id,
    name: id,
    icon: '?',
    stackable: true,
    quantity: 10_000,
  }));
  return {
    ...s,
    character: { ...s.character, gold: 1_000_000 },
    inventory: { ...s.inventory, items },
    training: { ...s.training, tier: 10 },
    buildings: {
      ...s.buildings,
      town_hall: { state: 'built', level: opts.townHall ?? 5 },
      training_grounds: { state: 'built', level: opts.grounds ?? 1 },
    },
  };
}

function run(s: GameState, c: CommandInput, at = s.time.lastSimulatedAt) {
  return applyCommand(s, cmd(c), at);
}

const str = (s: GameState) => s.training.attributes.strength;

/** Total trained ms of an attribute since level 0 (levels + XP + remainder). */
function trainedMs(t: { level: number; xp: number; progressMs: number }): number {
  let xp = 0;
  for (let l = 0; l < t.level; l += 1) xp += 5 + 10 * l;
  return (xp + t.xp) * 60_000 + t.progressMs;
}

describe('training XP per minute by Training Grounds level', () => {
  it('data: +1 XP/min per level (Lv1 = 1 … Lv5 = 5), and every level is upgradable', () => {
    expect(BUILDINGS.training_grounds.levels.map((l) => l.trainingXpPerMin)).toEqual([1, 2, 3, 4, 5]);
    for (let lv = 1; lv <= 5; lv += 1) expect(trainingXpPerMinute(game({ grounds: lv }))).toBe(lv);
  });

  it.each([1, 2, 3, 4, 5])('Lv%i: 1 h of training credits %i × 60 trained minutes; the view shows the rate and time to level', (lv) => {
    const s = apply(game({ grounds: lv }), { type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' }, T0);
    const v = trainingView(s);
    expect(v.xpPerMinute).toBe(lv);
    const row = v.attributes.find((a) => a.attribute === 'strength')!;
    expect(row.xpPerMinute).toBe(lv);
    expect(row.remainingMs).toBe(Math.ceil((5 * MIN) / lv)); // Lv1 needs 5 XP
    const after = simulate(s, T0 + HOUR).state;
    expect(trainedMs(str(after))).toBe(lv * HOUR);
    expect(simulate(s, T0 + HOUR).summary.trainingXpGained.strength).toBe(lv * 60);
  });

  it('above 1 XP/min the sub-ms overflow of a level is carried into the next one (nothing lost)', () => {
    // 1 ms banked, Lv0 → Lv1 needs 299 999 ms: at 2 XP/min that is 150 000 wall ms with 1 ms over.
    const base = apply(game({ grounds: 2 }), { type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' }, T0);
    const s: GameState = { ...base, training: { ...base.training, attributes: { ...base.training.attributes, strength: { level: 0, xp: 0, progressMs: 1 } } } };
    const after = simulate(s, T0 + 150_000).state;
    expect(str(after)).toEqual({ level: 1, xp: 0, progressMs: 1 });
    expect(trainedMs(str(after))).toBe(1 + 2 * 150_000);
  });

  it('a locked building gives the Lv1 rate (training needs it built anyway)', () => {
    const s = game();
    expect(trainingXpPerMinute({ buildings: { ...s.buildings, training_grounds: { state: 'locked', level: 0 } } })).toBe(1);
  });
});

describe('an upgrade completing mid-training', () => {
  /** Lv1 grounds, the upgrade to Lv2 starts at T0 + 333 ms (15 min), STR training runs from T0. */
  function upgrading(withCrew = false): GameState {
    let s = apply(game(), { type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' }, T0);
    if (withCrew) {
      s = apply(s, { type: 'HIRE_WORKER', maxCost: 100 }, T0);
      s = apply(s, { type: 'ASSIGN_WORKER', workerId: 'w1', node: 'oak' }, T0);
    }
    return apply(s, { type: 'UPGRADE_BUILDING', buildingId: 'training_grounds', level: 2 }, T0 + 333);
  }

  it('the new rate counts from the completion instant: 1 XP/min before, 2 after', () => {
    const s = upgrading();
    const end = T0 + 2 * HOUR;
    const done = T0 + 333 + 15 * MIN;
    const after = simulate(s, end).state;
    expect(after.buildings.training_grounds.level).toBe(2);
    expect(trainedMs(str(after))).toBe((done - T0) * 1 + (end - done) * 2);
  });

  it.each([false, true])('split-invariant (crew: %s): one resume = 1 s ticks = 7 s and 13 s splits, byte for byte', (withCrew) => {
    const s = upgrading(withCrew);
    const end = T0 + 2 * HOUR + 17;
    const one = simulate(s, end).state;
    for (const step of [SEC, 7 * SEC, 13 * SEC + 1, 15 * MIN + 333]) {
      let t = s;
      for (let at = s.time.lastSimulatedAt + step; at < end; at += step) t = simulate(t, at).state;
      t = simulate(t, end).state;
      expect(hashState(t)).toBe(hashState(one));
    }
  });

  it('offline: the upgrade completes inside the 8 h cap and the rest of the granted time trains at 2 XP/min', () => {
    const s = upgrading();
    const after = simulate(s, T0 + 10 * HOUR).state; // capped at 8 h
    const done = T0 + 333 + 15 * MIN;
    expect(trainedMs(str(after))).toBe((done - T0) + (T0 + 333 + 8 * HOUR - done) * 2);
  });
});

describe('stamina speed-up at higher levels', () => {
  it.each([1, 3, 5])('Lv%i: 1 stamina = 1 minute at the current XP/min; "to next level" and the cap clamp follow the rate', (lv) => {
    const s = apply(game({ grounds: lv }), { type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' }, T0);
    const row = trainingView(s).attributes.find((a) => a.attribute === 'strength')!;
    expect(row.speedupToNextLevel).toBe(Math.ceil(5 / lv)); // Lv1 needs 5 XP
    const r = run(s, { type: 'SPEEDUP_TRAINING', minutes: 10, maxCost: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.stamina.current).toBe(s.stamina.current - 10);
    expect(trainedMs(str(r.state))).toBe(10 * lv * MIN);
  });

  it('never charged beyond the tier cap: steps are clamped at the current rate', () => {
    const base = apply(game({ grounds: 5 }), { type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' }, T0);
    // Tier 1 (cap 20); STR at Lv19 with 0 XP: 195 XP left = 39 minutes at 5 XP/min.
    const s: GameState = {
      ...base,
      training: { ...base.training, tier: 1, attributes: { ...base.training.attributes, strength: { level: 19, xp: 0, progressMs: 0 } } },
    };
    expect(trainingView(s).attributes.find((a) => a.attribute === 'strength')!.speedupToCap).toBe(39);
    const r = run(s, { type: 'SPEEDUP_TRAINING', minutes: 100, maxCost: 100 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.stamina.current).toBe(s.stamina.current - 39);
    expect(str(r.state).level).toBe(20);
    expect(r.state.activity).toBeNull(); // maxed: stops by itself
  });
});

describe('Training Grounds upgrades', () => {
  it('capped by the Town Hall level: TOWN_HALL_TOO_LOW, nothing paid', () => {
    const s = game({ grounds: 2, townHall: 2 });
    const r = run(s, { type: 'UPGRADE_BUILDING', buildingId: 'training_grounds', level: 3 });
    expect(r).toMatchObject({ ok: false, error: { code: 'TOWN_HALL_TOO_LOW' } });
    expect(upgradeView(s, 'training_grounds')).toMatchObject({ nextLevel: 3, block: 'town_hall', townHallNeeded: 3 });
    const ok = run({ ...s, buildings: { ...s.buildings, town_hall: { state: 'built', level: 3 } } }, { type: 'UPGRADE_BUILDING', buildingId: 'training_grounds', level: 3 });
    expect(ok.ok).toBe(true);
  });

  it('standard cost (half the Town Hall): Lv2 250 g, 25 Oak, 25 Stone, 15 min; shows +1 XP/min per level', () => {
    const s = game();
    const v = upgradeView(s, 'training_grounds');
    expect(v).toMatchObject({ nextLevel: 2, block: null, durationMs: 15 * MIN, bonuses: { trainingXpPerMin: 1 }, nextBonuses: { trainingXpPerMin: 2 } });
    expect(v.cost.map((c) => [c.kind, c.need])).toEqual([
      ['item', 25],
      ['item', 25],
      ['gold', 250],
    ]);
    const r = run(s, { type: 'UPGRADE_BUILDING', buildingId: 'training_grounds', level: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.character.gold).toBe(s.character.gold - 250);
  });

  it('max Lv5', () => {
    expect(upgradeView(game({ grounds: 5 }), 'training_grounds')).toMatchObject({ nextLevel: null, block: 'max_level' });
  });
});

describe('replay', () => {
  it('upgrade + training + speed-up through the client replays to the live hash', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'tgu' });
    await client.load();
    for (const id of ['woodcutting', 'mine_shaft', 'town_hall', 'training_grounds'] as const) expect((await client.debug.build(id)).ok).toBe(true);
    await client.debug.addWoodcuttingLevel(100);
    await client.debug.addMiningLevel(100);
    await client.debug.addGold(5000);
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' });
    clock.advance(4 * MIN);
    await client.resume();
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' });
    clock.advance(4 * MIN);
    await client.resume();
    expect((await client.dispatch({ type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 2 })).ok).toBe(true);
    clock.advance(30 * MIN);
    await client.resume();
    expect((await client.dispatch({ type: 'UPGRADE_BUILDING', buildingId: 'training_grounds', level: 2 })).ok).toBe(true);
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'training', attribute: 'endurance' })).ok).toBe(true);
    for (let i = 0; i < 20; i += 1) {
      clock.advance(SEC);
      await client.tick();
    }
    clock.advance(20 * MIN);
    await client.resume();
    expect(client.getState().buildings.training_grounds.level).toBe(2);
    const n = trainingView(client.getState()).attributes.find((a) => a.attribute === 'endurance')!.speedupToNextLevel;
    expect((await client.dispatch({ type: 'SPEEDUP_TRAINING', minutes: n, maxCost: n })).ok).toBe(true);
    clock.advance(HOUR);
    await client.resume();
    await client.persist();
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report.skippedOldEngine).toBe(0);
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});

describe('frozen v11 save (tests/fixtures/save-v11.json), 1.10.0 → 1.11.0 (engine only)', () => {
  async function v11Phone(after = 3 * MIN) {
    const repo = new MemoryGameRepository();
    await repo.init();
    await repo.commit(
      V11_LOG.map(({ seq: _seq, synced: _synced, ...r }) => r),
      V11_SAVE as GameState,
      { [META_ENGINE_VERSION]: '1.10.0', device_id: 'phone' },
    );
    const clock = new FakeClock(V11_SAVE.time.lastSimulatedAt + after);
    return makeClient({ repo, clock, prefix: 'v111' });
  }

  it('is what the 1.10.0 engine wrote: Town Hall Lv2, Training Grounds Lv1, STR training, 52 Oak / 52 Stone', () => {
    expect(V11_SAVE.saveVersion).toBe(11);
    expect(V11_SAVE.buildings.town_hall).toEqual({ state: 'built', level: 2 });
    expect(V11_SAVE.buildings.training_grounds).toEqual({ state: 'built', level: 1 });
    expect(V11_SAVE.activity).toMatchObject({ kind: 'training', attribute: 'strength' });
    expect(new Set(V11_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.10.0']));
    expect(hashState(V11_SAVE)).toBe(V11_LOG.at(-1)!.stateHash);
    // Since 1.12.0 (save v12) it also runs the v11 → v12 skill migration: only the skills change. Since 1.13.0 (save v13)
    // the Crafting house (locked) and the idle pipes are added, and smithing is dropped.
    const { character, saveVersion: _v, buildings, crafting, ...rest } = loadSave(V11_SAVE);
    const { character: rc, saveVersion: _rv, buildings: rb, ...rawRest } = V11_SAVE;
    expect(rest).toEqual(rawRest);
    expect(buildings).toEqual({ ...rb, crafting: V13_ADDED.craftingBuilding });
    expect(crafting).toEqual(V13_ADDED.crafting);
    expect(character).toEqual({ ...rc, skills: v12Skills(rc.skills) });
  });

  it('loading writes a MIGRATE anchor (engine 1.10.0 → current; save 11 → 12 since 1.12.0); the upgrade then doubles the rate; the whole log replays', async () => {
    const { repo, clock, client } = await v11Phone();
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({
      fromSave: 11,
      toSave: CURRENT_SAVE_VERSION,
      fromEngine: '1.10.0',
      toEngine: ENGINE_VERSION,
      fromHash: V11_LOG.at(-1)!.stateHash,
      snapshot: undefined,
    });

    expect(trainingView(client.getState()).xpPerMinute).toBe(1);
    expect((await client.dispatch({ type: 'UPGRADE_BUILDING', buildingId: 'training_grounds', level: 2 })).ok).toBe(true);
    expect((await client.dispatch({ type: 'UPGRADE_BUILDING', buildingId: 'training_grounds', level: 3 })).ok).toBe(false);
    const before = trainedMs(str(client.getState()));
    clock.advance(15 * MIN + HOUR);
    await client.resume();
    expect(client.getState().buildings.training_grounds.level).toBe(2);
    expect(trainingView(client.getState()).xpPerMinute).toBe(2);
    expect(trainedMs(str(client.getState())) - before).toBe(15 * MIN + 2 * HOUR);

    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: V11_LOG.length });
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});
