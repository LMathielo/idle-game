// Buildings and construction (engine 1.9.0, save v10): locked / built state, BUILD with data-driven requirements,
// BUILDING_LOCKED on the activities they host, the Training Grounds' free Tier 1, the debug build, the v9 → v10
// migration with the frozen v9 fixture, and replay.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { CommandInput, LogRow } from '../src/client/types';
import {
  applyCommand,
  BUILDING_IDS,
  BUILDINGS,
  buildingView,
  type BuildingId,
  CURRENT_SAVE_VERSION,
  ENGINE_VERSION,
  type GameState,
  hashState,
  loadSave,
  type MigratePayload,
  MIGRATIONS,
  newGame,
  type ReplayEntry,
  replayLogReport,
  simulate,
} from '../src/engine';
import { makeItem } from '../src/engine/inventory';
import { apply, cmd, HOUR, makeClient, MIN, qty, SEC, T0, v12Skills, withBuilt, withoutGearRolls } from './helpers';

const FIXTURES = join(__dirname, 'fixtures');
/** Frozen v9 save + its action log, written by the 1.8.0 engine before buildings (tests/fixtures). */
const V9_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v9.json'), 'utf8'));
const V9_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v9.json'), 'utf8'));

const entries = (rows: LogRow[]): ReplayEntry[] =>
  rows.map((r) => ({ type: r.type, payload: r.payload, clientTime: r.clientTime, engineVersion: r.engineVersion, stateHash: r.stateHash }));

function run(s: GameState, c: CommandInput, at = T0) {
  return applyCommand(s, cmd(c), at);
}

/** A hero with `gold`, hero `level` and stacks of the given items. */
function hero(opts: { gold?: number; level?: number; items?: Record<string, number> } = {}, seed = 1): GameState {
  const s = newGame(seed, T0);
  const items = [...s.inventory.items];
  for (const [defId, quantity] of Object.entries(opts.items ?? {})) items.push(makeItem(defId, quantity));
  return {
    ...s,
    character: { ...s.character, gold: opts.gold ?? s.character.gold, level: opts.level ?? s.character.level },
    inventory: { ...s.inventory, items },
  };
}

const TOWN_HALL_READY = { gold: 100, level: 5, items: { oak_logs: 20, stone: 20 } };
const GROUNDS_READY = { gold: 250, level: 10, items: { oak_logs: 50, stone: 50 } };

describe('config and a new save', () => {
  it('the four buildings and their requirements are data, as the owner approved (+ the Merchant, always built, since 1.10.0)', () => {
    expect(BUILDING_IDS).toEqual(['woodcutting', 'mine_shaft', 'town_hall', 'training_grounds', 'merchant', 'crafting']);
    expect(BUILDINGS.merchant.startsBuilt).toBe(true);
    expect(BUILDINGS.woodcutting.requirements).toEqual({ gold: 50 });
    expect(BUILDINGS.mine_shaft.requirements).toEqual({ gold: 50 });
    expect(BUILDINGS.town_hall.requirements).toEqual({ heroLevel: 5, items: [{ defId: 'oak_logs', quantity: 20 }, { defId: 'stone', quantity: 20 }], gold: 100 });
    expect(BUILDINGS.training_grounds.requirements).toEqual({
      heroLevel: 10,
      buildings: [{ buildingId: 'town_hall', level: 1 }],
      items: [{ defId: 'oak_logs', quantity: 50 }, { defId: 'stone', quantity: 50 }],
      gold: 250,
    });
    expect(BUILDINGS.training_grounds.grantsTrainingTier).toBe(1);
    // 1.13.0: the Crafting house (owner-approved 2026-11-01).
    expect(BUILDINGS.crafting.requirements).toEqual({
      buildings: [
        { buildingId: 'woodcutting', level: 1 },
        { buildingId: 'mine_shaft', level: 1 },
      ],
      items: [{ defId: 'oak_logs', quantity: 30 }, { defId: 'stone', quantity: 30 }],
      gold: 150,
    });
  });

  it('a new save has every building locked (level 0) but the Merchant (built, Lv1); the dungeon and storage are not stored', () => {
    const s = newGame(1, T0);
    expect(s.buildings).toEqual({
      woodcutting: { state: 'locked', level: 0 },
      mine_shaft: { state: 'locked', level: 0 },
      town_hall: { state: 'locked', level: 0 },
      training_grounds: { state: 'locked', level: 0 },
      merchant: { state: 'built', level: 1 },
      crafting: { state: 'locked', level: 0 },
    });
    expect(s.training.tier).toBe(0);
  });
});

describe('BUILDING_LOCKED: a locked building cannot be used', () => {
  it('woodcutting, mining and training refuse to start; nothing changes', () => {
    const s = newGame(1, T0);
    const cases: [CommandInput, string][] = [
      [{ type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, 'Woodcutting'],
      [{ type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' }, 'Mine Shaft'],
      [{ type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' }, 'Training Grounds'],
      [{ type: 'UNLOCK_TRAINING_TIER', tier: 1 }, 'Training Grounds'],
    ];
    for (const [c, name] of cases) {
      expect(run({ ...s, character: { ...s.character, gold: 1000 } }, c)).toEqual({ ok: false, error: { code: 'BUILDING_LOCKED', message: expect.stringContaining(name) } });
    }
  });

  it('the lock is checked before the rest (a locked building with an unknown tree still says BUILDING_LOCKED)', () => {
    expect(run(newGame(1, T0), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'palm' as never })).toMatchObject({ ok: false, error: { code: 'BUILDING_LOCKED' } });
  });

  it('each building only unlocks its own activity; the dungeon is always open', () => {
    const wood = withBuilt(newGame(1, T0), ['woodcutting']);
    expect(run(wood, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }).ok).toBe(true);
    expect(run(wood, { type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' })).toMatchObject({ ok: false, error: { code: 'BUILDING_LOCKED' } });
    expect(run(newGame(1, T0), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }).ok).toBe(true);
  });
});

describe('BUILD', () => {
  it('Woodcutting and Mine Shaft cost 50 gold each: refused at 25 (new hero), built at 50 with 0 left', () => {
    for (const id of ['woodcutting', 'mine_shaft'] as const) {
      const poor = run(hero(), { type: 'BUILD', buildingId: id });
      expect(poor).toEqual({ ok: false, error: { code: 'REQUIREMENTS_NOT_MET', message: expect.stringContaining('50 gold (you have 25)') } });
      const r = run(hero({ gold: 50 }), { type: 'BUILD', buildingId: id });
      if (!r.ok) throw new Error(r.error.message);
      expect(r.state.buildings[id]).toEqual({ state: 'built', level: 1 });
      expect(r.state.character.gold).toBe(0);
      expect(r.events).toContainEqual({ type: 'BUILDING_BUILT', buildingId: id });
      expect(r.state.flags.debugUsed).toBe(false);
    }
  });

  it('Town Hall: each missing requirement refuses it on its own, and nothing is consumed', () => {
    const missing: [Parameters<typeof hero>[0], string][] = [
      [{ ...TOWN_HALL_READY, level: 4 }, 'hero level 5 (you are 4)'],
      [{ ...TOWN_HALL_READY, items: { oak_logs: 19, stone: 20 } }, '20 Oak Logs (you have 19)'],
      [{ ...TOWN_HALL_READY, items: { oak_logs: 20 } }, '20 Stone (you have 0)'],
      [{ ...TOWN_HALL_READY, gold: 99 }, '100 gold (you have 99)'],
    ];
    for (const [opts, text] of missing) {
      const s = hero(opts);
      const frozen = JSON.parse(JSON.stringify(s));
      expect(run(s, { type: 'BUILD', buildingId: 'town_hall' })).toEqual({ ok: false, error: { code: 'REQUIREMENTS_NOT_MET', message: expect.stringContaining(text) } });
      expect(s).toEqual(frozen);
    }
  });

  it('Town Hall built: consumes exactly 20 Oak Logs, 20 Stone and 100 gold (atomic), level 1', () => {
    const s = hero({ gold: 130, level: 5, items: { oak_logs: 25, stone: 20 } });
    const r = run(s, { type: 'BUILD', buildingId: 'town_hall' });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.buildings.town_hall).toEqual({ state: 'built', level: 1 });
    expect(r.state.character.gold).toBe(30);
    expect(qty(r.state, 'oak_logs')).toBe(5);
    expect(r.state.inventory.items.some((i) => i.defId === 'stone')).toBe(false); // the emptied stack is removed
    expect(qty(r.state, 'bread')).toBe(3); // nothing else touched
    expect(r.state.training.tier).toBe(0);
  });

  it('Training Grounds needs the Town Hall, hero Lv10, 50 Oak Logs, 50 Stone and 250 gold', () => {
    const noHall = run(hero(GROUNDS_READY), { type: 'BUILD', buildingId: 'training_grounds' });
    expect(noHall).toEqual({ ok: false, error: { code: 'REQUIREMENTS_NOT_MET', message: expect.stringContaining('Town Hall level 1') } });
    const lv9 = run(withBuilt(hero({ ...GROUNDS_READY, level: 9 }), ['town_hall']), { type: 'BUILD', buildingId: 'training_grounds' });
    expect(lv9).toMatchObject({ ok: false, error: { code: 'REQUIREMENTS_NOT_MET' } });
    const r = run(withBuilt(hero(GROUNDS_READY), ['town_hall']), { type: 'BUILD', buildingId: 'training_grounds' });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.buildings.training_grounds).toEqual({ state: 'built', level: 1 });
    expect([r.state.character.gold, qty(r.state, 'oak_logs'), qty(r.state, 'stone')]).toEqual([0, 0, 0]);
  });

  it('Training Grounds come with Tier 1 (no extra 100 gold); Tier 2+ is paid as before', () => {
    const r = run(withBuilt(hero({ ...GROUNDS_READY, gold: 1050 }), ['town_hall']), { type: 'BUILD', buildingId: 'training_grounds' });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.training.tier).toBe(1);
    expect(r.state.character.gold).toBe(800);
    expect(r.events).toContainEqual({ type: 'TRAINING_TIER_UNLOCKED', tier: 1 });
    expect(run(r.state, { type: 'UNLOCK_TRAINING_TIER', tier: 1 })).toMatchObject({ ok: false, error: { code: 'TIER_NOT_NEXT' } });
    const train = apply(r.state, { type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' }, T0);
    expect(train.activity).toMatchObject({ kind: 'training', attribute: 'strength' });
    const t2 = apply(r.state, { type: 'UNLOCK_TRAINING_TIER', tier: 2 }, T0);
    expect([t2.training.tier, t2.character.gold]).toEqual([2, 0]);
  });

  it('a hero who already had a higher tier keeps it when the Training Grounds are built', () => {
    const s = withBuilt(hero(GROUNDS_READY), ['town_hall']);
    const r = run({ ...s, training: { ...s.training, tier: 3 } }, { type: 'BUILD', buildingId: 'training_grounds' });
    expect(r.ok && r.state.training.tier).toBe(3);
    expect(r.ok && r.events.some((e) => e.type === 'TRAINING_TIER_UNLOCKED')).toBe(false);
  });

  it('ALREADY_BUILT on a second build (a double tap never pays twice) and on the Merchant; UNKNOWN_BUILDING for anything else', () => {
    const once = apply(hero({ gold: 200 }), { type: 'BUILD', buildingId: 'woodcutting' }, T0);
    expect(run(once, { type: 'BUILD', buildingId: 'woodcutting' })).toMatchObject({ ok: false, error: { code: 'ALREADY_BUILT' } });
    expect(once.character.gold).toBe(150);
    expect(run(hero({ gold: 200 }), { type: 'BUILD', buildingId: 'merchant' })).toMatchObject({ ok: false, error: { code: 'ALREADY_BUILT' } });
    for (const bad of ['dungeon', 'storage', 'nope', '__proto__', undefined]) {
      expect(run(hero({ gold: 200 }), { type: 'BUILD', buildingId: bad as BuildingId })).toMatchObject({ ok: false, error: { code: 'UNKNOWN_BUILDING' } });
    }
  });

  it('BUILD works while an activity runs and never touches it', () => {
    const s = apply(hero({ gold: 100 }), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    const r = apply(s, { type: 'BUILD', buildingId: 'mine_shaft' }, T0 + MIN);
    expect(r.activity).toMatchObject({ kind: 'dungeon', progressMs: MIN });
  });

  it('gold is never negative over any build order (invariant)', () => {
    let s = withBuilt(hero({ gold: 600, level: 10, items: { oak_logs: 100, stone: 100 } }), []);
    for (const id of ['woodcutting', 'crafting', 'mine_shaft', 'town_hall', 'training_grounds', 'crafting', 'woodcutting'] as const) {
      const r = run(s, { type: 'BUILD', buildingId: id });
      if (r.ok) s = r.state;
      expect(s.character.gold).toBeGreaterThanOrEqual(0);
    }
    expect(BUILDING_IDS.map((id) => s.buildings[id].state)).toEqual(['built', 'built', 'built', 'built', 'built', 'built']);
    expect([s.character.gold, qty(s, 'oak_logs'), qty(s, 'stone')]).toEqual([0, 0, 0]);
  });
});

describe('buildingView (the Build sheet)', () => {
  it('lists every requirement with have / need / met, in order; Build is enabled only when all are met', () => {
    const v = buildingView(hero({ gold: 60, level: 3, items: { oak_logs: 40 } }), 'training_grounds');
    expect(v).toMatchObject({ buildingId: 'training_grounds', name: 'Training Grounds', built: false, level: 0, canBuild: false, grantsTrainingTier: 1 });
    expect(v.requirements).toEqual([
      { kind: 'heroLevel', need: 10, have: 3, met: false },
      { kind: 'building', buildingId: 'town_hall', need: 1, have: 0, met: false },
      { kind: 'item', defId: 'oak_logs', need: 50, have: 40, met: false },
      { kind: 'item', defId: 'stone', need: 50, have: 0, met: false },
      { kind: 'gold', need: 250, have: 60, met: false },
    ]);
    const ready = buildingView(hero(TOWN_HALL_READY), 'town_hall');
    expect(ready.canBuild).toBe(true);
    expect(ready.requirements.every((r) => r.met)).toBe(true);
    const built = buildingView(apply(hero(TOWN_HALL_READY), { type: 'BUILD', buildingId: 'town_hall' }, T0), 'town_hall');
    expect(built).toMatchObject({ built: true, level: 1, canBuild: false });
  });
});

describe('DEBUG_BUILD', () => {
  it('builds for free (requirements ignored), applies effects, sets debugUsed; refused when built or debug is off', () => {
    const s = newGame(1, T0);
    const r = run(s, { type: 'DEBUG_BUILD', buildingId: 'training_grounds' });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.buildings.training_grounds).toEqual({ state: 'built', level: 1 });
    expect(r.state.training.tier).toBe(1);
    expect(r.state.character.gold).toBe(25);
    expect(r.state.flags.debugUsed).toBe(true);
    expect(run(r.state, { type: 'DEBUG_BUILD', buildingId: 'training_grounds' })).toMatchObject({ ok: false, error: { code: 'ALREADY_BUILT' } });
    expect(applyCommand(s, cmd({ type: 'DEBUG_BUILD', buildingId: 'woodcutting' }), T0, { allowDebug: false })).toMatchObject({ ok: false, error: { code: 'DEBUG_DISABLED' } });
  });
});

describe('save v10 migration (v9 → v10)', () => {
  const v9Doc = (patch: Record<string, unknown> = {}) => ({
    saveVersion: 9,
    activity: { kind: 'training', attribute: 'strength', startedAt: 1 },
    training: { tier: 2, attributes: { strength: { level: 7, xp: 3, progressMs: 500 } } },
    merchant: { charges: 3, chargeProgressMs: 9, stock: [{ defId: 'health_potion_t1', quantity: 4, unitPrice: 12 }, null, null, null, null, null] },
    character: {
      level: 7,
      gold: 333,
      equipment: { axe: { id: 'start-wooden_axe', defId: 'wooden_axe', name: 'Wooden Axe', icon: '🪓', slot: 'axe' } },
      skills: { woodcutting: { level: 9, xp: 1, xpToNext: 2 } },
    },
    inventory: { capacity: 20, items: [{ id: 'oak_logs', defId: 'oak_logs', name: 'Oak Logs', icon: '🪵', stackable: true, quantity: 12 }] },
    ...patch,
  });

  it('every building locked; a running training or woodcutting stops (training XP and logs kept); pure', () => {
    const doc = v9Doc();
    const frozen = JSON.parse(JSON.stringify(doc));
    const v10 = MIGRATIONS[9](doc) as unknown as GameState;
    expect(doc).toEqual(frozen);
    expect(v10.saveVersion).toBe(10);
    expect(v10.buildings).toEqual({
      woodcutting: { state: 'locked', level: 0 },
      mine_shaft: { state: 'locked', level: 0 },
      town_hall: { state: 'locked', level: 0 },
      training_grounds: { state: 'locked', level: 0 },
    });
    expect(v10.activity).toBeNull();
    expect(v10.training).toEqual(doc.training); // tier and XP kept
    expect(v10.inventory).toEqual(doc.inventory);
    expect(v10.character).toMatchObject({ level: 7, gold: 333 });
    const wood = MIGRATIONS[9](v9Doc({ activity: { kind: 'woodcutting', treeId: 'oak', startedAt: 1, progressMs: 50_000 } })) as unknown as GameState;
    expect(wood.activity).toBeNull();
    const dungeon = { kind: 'dungeon', dungeonId: 'rat_cellar', startedAt: 1, progressMs: 7, phase: 'search', fight: null };
    expect((MIGRATIONS[9](v9Doc({ activity: dungeon })) as unknown as GameState).activity).toEqual(dungeon);
    expect((MIGRATIONS[9](v9Doc({ activity: null })) as unknown as GameState).activity).toBeNull();
  });

  it('adds the Wooden Pickaxe exactly as a new hero has it, and mining at Lv1 when missing (kept when present)', () => {
    const v10 = MIGRATIONS[9](v9Doc()) as unknown as GameState;
    expect(v10.character.equipment.pickaxe).toEqual(withoutGearRolls(newGame(1, T0)).character.equipment.pickaxe);
    expect(v10.character.equipment.axe?.defId).toBe('wooden_axe');
    // The v10 literal (mining Lv1 on the v10 skill curve, base 500); v11 → v12 recomputes it later.
    expect(v10.character.skills).toEqual({ woodcutting: { level: 9, xp: 1, xpToNext: 2 }, mining: { level: 1, xp: 0, xpToNext: 500 } });
    const own = { id: 'iron_pickaxe#4', defId: 'iron_pickaxe', name: 'Iron Pickaxe', icon: '⛏️', slot: 'pickaxe' };
    const doc = v9Doc();
    const kept = MIGRATIONS[9](
      v9Doc({ character: { ...doc.character, equipment: { ...doc.character.equipment, pickaxe: own }, skills: { mining: { level: 3, xp: 4, xpToNext: 2598 } } } }),
    ) as unknown as GameState;
    expect(kept.character.equipment.pickaxe).toEqual(own);
    expect(kept.character.skills.mining).toEqual({ level: 3, xp: 4, xpToNext: 2598 });
  });

  it('the Iron Pickaxe listing goes in merchant slot 4 when it is empty; other slots and charges are kept', () => {
    const v10 = MIGRATIONS[9](v9Doc()) as unknown as GameState;
    expect(v10.merchant).toEqual({
      charges: 3,
      chargeProgressMs: 9,
      stock: [{ defId: 'health_potion_t1', quantity: 4, unitPrice: 12 }, null, null, null, { defId: 'iron_pickaxe', quantity: 1, unitPrice: 600 }, null],
    });
    const taken = { defId: 'iron_helm', quantity: 1, unitPrice: 400 };
    const full = MIGRATIONS[9](v9Doc({ merchant: { charges: 5, chargeProgressMs: 0, stock: [null, null, null, null, taken] } })) as unknown as GameState;
    expect(full.merchant.stock[4]).toEqual(taken);
    const short = MIGRATIONS[9](v9Doc({ merchant: { charges: 5, chargeProgressMs: 0, stock: [null, null] } })) as unknown as GameState;
    expect(short.merchant.stock).toEqual([null, null]);
  });

  it('tolerates a bare document', () => {
    const bare = MIGRATIONS[9]({ saveVersion: 9 }) as unknown as GameState;
    expect(bare.buildings.town_hall).toEqual({ state: 'locked', level: 0 });
    expect(bare.character.equipment.pickaxe?.defId).toBe('wooden_pickaxe');
  });
});

describe('frozen v9 save (tests/fixtures/save-v9.json) → v10', () => {
  /** A phone that ran the 1.8.0 build: the v9 document, its log and engine_version = 1.8.0. */
  async function v9Phone(after = 3 * MIN) {
    const repo = new MemoryGameRepository();
    await repo.init();
    await repo.commit(
      V9_LOG.map(({ seq: _seq, synced: _synced, ...r }) => r),
      V9_SAVE as GameState,
      { [META_ENGINE_VERSION]: '1.8.0', device_id: 'phone' },
    );
    const clock = new FakeClock(V9_SAVE.time.lastSimulatedAt + after);
    return makeClient({ repo, clock, prefix: 'v10' });
  }

  it('is what the 1.8.0 engine wrote: hero Lv6, 265 gold, Tier 1, 36 Oak Logs, Oak running 1:47 into a log', () => {
    expect(V9_SAVE.saveVersion).toBe(9);
    expect(V9_SAVE).not.toHaveProperty('buildings');
    expect(V9_SAVE.character).toMatchObject({ level: 6, gold: 265 });
    expect(V9_SAVE.character.equipment).not.toHaveProperty('pickaxe');
    expect(V9_SAVE.training.tier).toBe(1);
    expect(V9_SAVE.activity).toMatchObject({ kind: 'woodcutting', treeId: 'oak', progressMs: 107_000 });
    expect(V9_SAVE.dungeon.totals).toEqual({ runs: 95, wins: 95, losses: 0 });
    expect(new Set(V9_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.8.0']));
  });

  it('migrates: buildings locked, woodcutting stopped, pickaxe added, everything else kept (deterministic)', () => {
    expect(loadSave(V9_SAVE).saveVersion).toBe(CURRENT_SAVE_VERSION);
    const s = withoutGearRolls(loadSave(V9_SAVE)); // the v13 → v14 gear rolls: tests/migrationV14.test.ts
    expect(s.activity).toBeNull();
    expect(BUILDING_IDS.map((id) => s.buildings[id].state)).toEqual(['locked', 'locked', 'locked', 'locked', 'built', 'locked']); // v11: the Merchant; v13: Crafting
    expect(s.character.equipment.pickaxe?.defId).toBe('wooden_pickaxe');
    expect(s.merchant.stock[4]).toEqual({ defId: 'iron_pickaxe', quantity: 1, unitPrice: 600 });
    const { activity: _a, buildings: _b, construction: _k, workers: _w, crafting: _cr, merchant, character, saveVersion: _v, ...rest } = s;
    const { activity: _ra, merchant: rm, character: rc, saveVersion: _rv, ...rawRest } = V9_SAVE;
    expect(rest).toEqual(rawRest);
    const { pickaxe: _p, ...equipment } = character.equipment;
    // v11 → v12 (1.12.0) then recomputes each skill's level from its total XP on the new skill curve.
    expect({ ...character, equipment }).toEqual({ ...rc, skills: v12Skills({ ...rc.skills, mining: { level: 1, xp: 0, xpToNext: 500 } }) });
    expect({ ...merchant, stock: merchant.stock.map((x, i) => (i === 4 ? null : x)) }).toEqual(rm);
    expect(hashState(withoutGearRolls(loadSave(V9_SAVE)))).toBe(hashState(s));
  });

  it('loading writes a MIGRATE anchor (save 9 → 10, engine 1.8.0 → 1.9.0); real builds and mining follow; the whole log replays', async () => {
    const { repo, clock, client } = await v9Phone();
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({
      fromSave: 9,
      toSave: CURRENT_SAVE_VERSION,
      fromEngine: '1.8.0',
      toEngine: ENGINE_VERSION,
      fromHash: V9_LOG.at(-1)!.stateHash,
      snapshot: undefined,
    });
    expect(p.snapshot).toEqual(loadSave(V9_SAVE));
    // Woodcutting stopped on migration: the 3 minutes before load cut nothing, and it can't restart while locked.
    expect(qty(client.getState(), 'oak_logs')).toBe(36);
    expect(await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' })).toMatchObject({ ok: false, error: { code: 'BUILDING_LOCKED' } });

    // Real builds with the save's own gold (265): Woodcutting and Mine Shaft (50 each), then 40 min of Stone.
    expect((await client.dispatch({ type: 'BUILD', buildingId: 'woodcutting' })).ok).toBe(true);
    expect((await client.dispatch({ type: 'BUILD', buildingId: 'mine_shaft' })).ok).toBe(true);
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' })).ok).toBe(true);
    clock.advance(40 * MIN);
    await client.resume();
    // 40 min / 1:50 = 21 ores; since 1.12.0 mining levels up faster (Lv5 in that time), so MS and the yield rise.
    expect(qty(client.getState(), 'stone')).toBe(34);
    // Town Hall: Lv6 ≥ 5, 36 Oak Logs, 21 Stone, 165 gold.
    expect((await client.dispatch({ type: 'BUILD', buildingId: 'town_hall' })).ok).toBe(true);
    expect([qty(client.getState(), 'oak_logs'), qty(client.getState(), 'stone'), client.getState().character.gold]).toEqual([16, 14, 65]);
    // Training Grounds need hero Lv10: refused, nothing logged for it.
    expect(await client.dispatch({ type: 'BUILD', buildingId: 'training_grounds' })).toMatchObject({ ok: false, error: { code: 'REQUIREMENTS_NOT_MET' } });
    // The Training Tier bought under 1.8.0 is kept, but the Training Grounds are locked.
    expect(client.getState().training.tier).toBe(1);
    clock.advance(HOUR);
    await client.resume();

    const rows = await repo.getAllLog();
    expect(rows.filter((r) => r.type === 'BUILD')).toHaveLength(3);
    expect(client.getState().flags.debugUsed).toBe(false);
    const report = replayLogReport(entries(rows));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: V9_LOG.length });
    expect(hashState(report.state)).toBe(hashState(client.getState()));
  });

  it('a fresh install builds through the client, and the log replays (BUILD rows are replayable commands)', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'bld' });
    await client.load();
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' })).ok).toBe(true);
    clock.advance(HOUR);
    await client.resume();
    expect(client.getState().character.gold).toBeGreaterThanOrEqual(50);
    expect((await client.dispatch({ type: 'BUILD', buildingId: 'mine_shaft' })).ok).toBe(true);
    expect((await client.dispatch({ type: 'BUILD', buildingId: 'mine_shaft' })).ok).toBe(false); // ALREADY_BUILT: not logged
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' })).ok).toBe(true);
    clock.advance(10 * MIN + 5 * SEC);
    await client.tick();
    await client.persist();
    const rows = await repo.getAllLog();
    expect(rows.filter((r) => r.type === 'BUILD')).toHaveLength(1);
    const report = replayLogReport(entries(rows));
    expect(hashState(report.state)).toBe(hashState(client.getState()));
    expect(simulate(client.getState(), clock.now()).state.buildings.mine_shaft.state).toBe('built');
  });
});
