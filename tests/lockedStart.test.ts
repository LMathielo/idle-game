// The locked start (engine 1.18.0, save v18): a new game has 500 gold and every building unbuilt (the Merchant and Storage
// included), Merchant and Storage are built with Town Hall Lv1 + 100 gold + 10 oak logs + 10 stone, an unbuilt Merchant
// refuses every command and banks nothing, Storage is a building with no function and no upgrades, every dungeon search
// is 2:00 at core DEX 0, and the v17 → v18 migration keeps an existing Merchant exactly as it was (frozen v17 save).
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
  CURRENT_SAVE_VERSION,
  DUNGEON_IDS,
  DUNGEONS,
  ENGINE_VERSION,
  type GameState,
  hashState,
  loadSave,
  type MigratePayload,
  MIGRATIONS,
  newGame,
  replayLogReport,
  type ReplayEntry,
  searchMsFor,
  simulate,
  starterStock,
  STARTING_HERO,
  upgradeView,
} from '../src/engine';
import { makeItem } from '../src/engine/inventory';
import { apply, builtGame, cmd, HOUR, makeClient, MIN, qty, T0, V18_ADDED, withBuilt, withCore } from './helpers';

const FIXTURES = join(__dirname, 'fixtures');
/** Frozen v17 save + log written by the untouched 1.17.0 engine (origin/dev): Merchant Lv2 (7 slots, one refresh and one buy done, 4/5 charges, 45 min banked), Town Hall Lv2. 21 rows. */
const V17_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v17.json'), 'utf8'));
const V17_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v17.json'), 'utf8'));
const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);

const run = (s: GameState, c: CommandInput, at = T0) => applyCommand(s, cmd(c), at);

/** A new game with these extras: gold, hero level, stacks of items. */
function hero(opts: { gold?: number; items?: Record<string, number> } = {}): GameState {
  const s = newGame(1, T0);
  const items = [...s.inventory.items];
  for (const [defId, quantity] of Object.entries(opts.items ?? {})) items.push(makeItem(defId, quantity));
  return { ...s, character: { ...s.character, gold: opts.gold ?? s.character.gold }, inventory: { ...s.inventory, items } };
}

const READY = { gold: 100, items: { oak_logs: 10, stone: 10 } };
/** Town Hall built (as a real build leaves it) plus what Merchant / Storage cost. */
const withTownHall = (extra: Parameters<typeof hero>[0] = READY) => withBuilt(hero(extra), ['town_hall']);

describe('a new game (1.18.0)', () => {
  it('500 gold, every building unbuilt (Merchant and Storage too), the dungeon open', () => {
    expect(STARTING_HERO.gold).toBe(500);
    const s = newGame(7, T0);
    expect(s.character.gold).toBe(500);
    expect(BUILDING_IDS).toContain('merchant');
    expect(BUILDING_IDS).toContain('storage');
    for (const id of BUILDING_IDS) expect(s.buildings[id], id).toEqual({ state: 'locked', level: 0 });
    expect(run(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }).ok).toBe(true);
  });

  it('the fixed starter stock waits in the unbuilt Merchant: 5 slots, full charges', () => {
    const s = newGame(7, T0);
    expect(s.merchant.stock).toEqual(starterStock(5));
    expect(s.merchant).toMatchObject({ charges: 5, chargeProgressMs: 0 });
    expect(s.merchant.stock[0]).toMatchObject({ defId: 'health_potion_t1', quantity: 10 });
    expect(s.merchant.stock.slice(1).map((l) => l?.defId)).toEqual(['iron_axe', 'iron_pickaxe', 'iron_sword', 'iron_helm']);
  });
});

describe('BUILD: Merchant and Storage (Town Hall Lv1 + 100 gold + 10 oak logs + 10 stone)', () => {
  for (const id of ['merchant', 'storage'] as const) {
    it(`${id}: the requirements are data`, () => {
      expect(BUILDINGS[id].requirements).toEqual({
        buildings: [{ buildingId: 'town_hall', level: 1 }],
        items: [{ defId: 'oak_logs', quantity: 10 }, { defId: 'stone', quantity: 10 }],
        gold: 100,
      });
    });

    it(`${id}: needs the Town Hall first (REQUIREMENTS_NOT_MET), even with everything else`, () => {
      const r = run(hero(READY), { type: 'BUILD', buildingId: id });
      expect(r).toEqual({ ok: false, error: { code: 'REQUIREMENTS_NOT_MET', message: expect.stringContaining('Town Hall level 1') } });
    });

    it(`${id}: missing gold, oak logs or stone is refused with what is missing; nothing is consumed`, () => {
      const th = (extra: Parameters<typeof hero>[0]) => withTownHall(extra);
      expect(run(th({ gold: 99, items: READY.items }), { type: 'BUILD', buildingId: id })).toMatchObject({ ok: false, error: { code: 'REQUIREMENTS_NOT_MET', message: expect.stringContaining('100 gold (you have 99)') } });
      expect(run(th({ gold: 100, items: { oak_logs: 9, stone: 10 } }), { type: 'BUILD', buildingId: id })).toMatchObject({ ok: false, error: { code: 'REQUIREMENTS_NOT_MET', message: expect.stringContaining('10 Oak Logs (you have 9)') } });
      expect(run(th({ gold: 100, items: { oak_logs: 10 } }), { type: 'BUILD', buildingId: id })).toMatchObject({ ok: false, error: { code: 'REQUIREMENTS_NOT_MET', message: expect.stringContaining('10 Stone (you have 0)') } });
    });

    it(`${id}: built at Town Hall Lv1 for 100 gold, 10 oak logs and 10 stone, consumed; a second build is ALREADY_BUILT`, () => {
      const s = withTownHall({ gold: 150, items: { oak_logs: 12, stone: 11 } });
      const r = run(s, { type: 'BUILD', buildingId: id });
      if (!r.ok) throw new Error(r.error.message);
      expect(r.state.buildings[id]).toEqual({ state: 'built', level: 1 });
      expect([r.state.character.gold, qty(r.state, 'oak_logs'), qty(r.state, 'stone')]).toEqual([50, 2, 1]);
      expect(r.events).toContainEqual({ type: 'BUILDING_BUILT', buildingId: id });
      expect(run(r.state, { type: 'BUILD', buildingId: id })).toMatchObject({ ok: false, error: { code: 'ALREADY_BUILT' } });
    });

    it(`${id}: the Build sheet lists Town Hall, oak logs, stone and gold (have / need)`, () => {
      const v = buildingView(withTownHall({ gold: 60, items: { oak_logs: 4 } }), id);
      expect(v).toMatchObject({ built: false, canBuild: false });
      expect(v.requirements).toEqual([
        { kind: 'building', buildingId: 'town_hall', need: 1, have: 1, met: true },
        { kind: 'item', defId: 'oak_logs', need: 10, have: 4, met: false },
        { kind: 'item', defId: 'stone', need: 10, have: 0, met: false },
        { kind: 'gold', need: 100, have: 60, met: false },
      ]);
      expect(buildingView(withTownHall(), id).canBuild).toBe(true);
    });
  }

  it('the Town Hall itself is unchanged: hero Lv5 + 20 oak logs + 20 stone + 100 gold', () => {
    expect(BUILDINGS.town_hall.requirements).toEqual({ heroLevel: 5, items: [{ defId: 'oak_logs', quantity: 20 }, { defId: 'stone', quantity: 20 }], gold: 100 });
  });
});

describe('Storage: a building with no function and no upgrades', () => {
  const built = () => withBuilt(newGame(1, T0), ['town_hall', 'storage']);

  it('no bonuses at any level: not upgradable (data-driven), the Upgrade entry is hidden', () => {
    for (const bonuses of BUILDINGS.storage.levels) expect(bonuses).toEqual({});
    const v = upgradeView(built(), 'storage');
    expect(v).toMatchObject({ level: 1, nextLevel: 2, block: 'not_upgradable' }); // UpgradeEntry renders nothing for this block
  });

  it('UPGRADE_BUILDING is refused with NOT_UPGRADABLE; nothing is paid', () => {
    const s = { ...built(), character: { ...built().character, gold: 1_000_000 } };
    expect(run(s, { type: 'UPGRADE_BUILDING', buildingId: 'storage', level: 2 })).toMatchObject({ ok: false, error: { code: 'NOT_UPGRADABLE' } });
  });

  it('while unbuilt: UPGRADE_BUILDING is BUILDING_LOCKED', () => {
    expect(run(newGame(1, T0), { type: 'UPGRADE_BUILDING', buildingId: 'storage', level: 2 })).toMatchObject({ ok: false, error: { code: 'BUILDING_LOCKED' } });
  });

  it('building it changes nothing else (no effect, no tier, no stock)', () => {
    const s = withTownHall();
    const r = run(s, { type: 'BUILD', buildingId: 'storage' });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.merchant).toEqual(s.merchant);
    expect(r.state.training).toEqual(s.training);
    expect(r.state.inventory.items.map((i) => i.defId).sort()).toEqual(s.inventory.items.map((i) => i.defId).filter((d) => d !== 'oak_logs' && d !== 'stone').sort());
  });
});

describe('an unbuilt Merchant', () => {
  const sellable = (s: GameState) => s.inventory.items[0];

  it('REFRESH_MERCHANT, BUY_ITEM, SELL_ITEM and the debug charge are refused with BUILDING_LOCKED; nothing changes', () => {
    const s = hero({ gold: 5_000 });
    const item = sellable(s);
    const cases: CommandInput[] = [
      { type: 'REFRESH_MERCHANT' },
      { type: 'BUY_ITEM', slot: 0, defId: 'health_potion_t1', quantity: 1, maxUnitPrice: 12 },
      { type: 'SELL_ITEM', itemId: item.id, quantity: 1 },
      { type: 'DEBUG_ADD_MERCHANT_CHARGE' },
    ];
    for (const c of cases) {
      expect(run(s, c), c.type).toEqual({ ok: false, error: { code: 'BUILDING_LOCKED', message: expect.stringContaining('Merchant') } });
    }
    expect(hashState(s)).toBe(hashState(hero({ gold: 5_000 })));
  });

  it('banks no refresh charge while unbuilt; regenerates once built', () => {
    const base = newGame(1, T0);
    const spent: GameState = { ...base, merchant: { ...base.merchant, charges: 2, chargeProgressMs: 30 * MIN } };
    expect(simulate(spent, T0 + 10 * HOUR).state.merchant).toEqual(spent.merchant);
    const open = simulate(withBuilt(spent, ['merchant']), T0 + 10 * HOUR).state;
    expect(open.merchant.charges).toBe(5);
  });

  it('a new save finds its fixed starter stock when the Merchant is built, and then it works as before', () => {
    const s = withTownHall({ gold: 300, items: READY.items });
    const r = run(s, { type: 'BUILD', buildingId: 'merchant' });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.merchant.stock).toEqual(starterStock(5));
    expect(r.state.merchant.charges).toBe(5);
    const gold = r.state.character.gold;
    const buy = apply(r.state, { type: 'BUY_ITEM', slot: 0, defId: 'health_potion_t1', quantity: 2, maxUnitPrice: 12 }, T0);
    expect(buy.character.gold).toBe(gold - 24);
    expect(run(buy, { type: 'REFRESH_MERCHANT' }).ok).toBe(true);
  });

  it('the Merchant upgrade needs it built', () => {
    expect(run(newGame(1, T0), { type: 'UPGRADE_BUILDING', buildingId: 'merchant', level: 2 })).toMatchObject({ ok: false, error: { code: 'BUILDING_LOCKED' } });
  });
});

describe('dungeon search: 2:00 on every tier (1.18.0)', () => {
  it('config: baseMs 2:00 and floor 1:00 on all five dungeons', () => {
    for (const id of DUNGEON_IDS) expect(DUNGEONS[id].search, id).toEqual({ baseMs: 2 * MIN, minMs: 1 * MIN });
  });

  it('at core DEX 0 a new hero searches 2:00 in every dungeon; core DEX shortens it on the curve, floor 1:00', () => {
    const g = builtGame(1, T0);
    expect(DUNGEON_IDS.map((id) => searchMsFor(id, g))).toEqual([120_000, 120_000, 120_000, 120_000, 120_000]);
    expect(DUNGEON_IDS.map((id) => searchMsFor(id, withCore(g, { dexterity: 10 })))).toEqual(Array(5).fill(110_004));
    expect(DUNGEON_IDS.map((id) => searchMsFor(id, withCore(g, { dexterity: 50 })))).toEqual(Array(5).fill(90_000));
    // The curve never reaches −50% (at most 60,012 ms of 120,000 here), so the 1:00 floor is never undercut.
    expect(searchMsFor('troll_bridge', withCore(g, { dexterity: 1_000_000 }))).toBe(60_012);
  });
});

describe('save v18 migration (v17 → v18)', () => {
  it('the frozen v17 save is what 1.17.0 wrote: Merchant Lv2 with 7 slots, 4/5 charges, 45 min banked', () => {
    expect(V17_SAVE.saveVersion).toBe(17);
    expect(V17_SAVE.buildings.merchant).toEqual({ state: 'built', level: 2 });
    expect(V17_SAVE.buildings).not.toHaveProperty('storage');
    expect(V17_SAVE.merchant).toMatchObject({ charges: 4, chargeProgressMs: 45 * MIN });
    expect(V17_SAVE.merchant.stock).toHaveLength(7);
    expect(new Set(V17_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.17.0']));
    expect(hashState(V17_SAVE)).toBe(V17_LOG.at(-1)!.stateHash);
  });

  it('adds Storage unbuilt; the Merchant (level, stock, charges, timers), gold and everything else are kept as they are', () => {
    const s = loadSave(V17_SAVE);
    expect(s.saveVersion).toBe(CURRENT_SAVE_VERSION);
    expect(s.buildings.storage).toEqual({ state: 'locked', level: 0 });
    expect(s.buildings.merchant).toEqual({ state: 'built', level: 2 });
    expect(s.merchant).toEqual(V17_SAVE.merchant);
    expect(s.character.gold).toBe(V17_SAVE.character.gold);
    expect(s.character.gold).not.toBe(500);
    const { saveVersion: _v, buildings, ...rest } = s;
    const { saveVersion: _rv, buildings: rawBuildings, ...raw } = V17_SAVE;
    expect(rest).toEqual({ ...raw, dungeon: { ...raw.dungeon, bosses: {} } }); // v20: boss counters;
    expect(buildings).toEqual({ ...rawBuildings, storage: V18_ADDED.storageBuilding });
    expect(hashState(loadSave(V17_SAVE))).toBe(hashState(s)); // deterministic
  });

  it('pure; keeps a Storage that is already there; a broken buildings value is replaced by Storage alone', () => {
    const d = { saveVersion: 17, buildings: { merchant: { state: 'built', level: 3 } }, character: { gold: 7 } };
    const frozen = JSON.parse(JSON.stringify(d));
    expect(MIGRATIONS[17](d)).toEqual({ saveVersion: 18, buildings: { merchant: { state: 'built', level: 3 }, storage: { state: 'locked', level: 0 } }, character: { gold: 7 } });
    expect(d).toEqual(frozen);
    expect((MIGRATIONS[17]({ saveVersion: 17, buildings: { storage: { state: 'built', level: 1 } } }) as Record<string, any>).buildings.storage).toEqual({ state: 'built', level: 1 });
    expect(MIGRATIONS[17]({ saveVersion: 17 })).toEqual({ saveVersion: 18, buildings: { storage: { state: 'locked', level: 0 } } });
  });

  it('the grandfathered Merchant still works after the migration (buy, sell, refresh) and the charge timer keeps running', () => {
    const s = loadSave(V17_SAVE);
    const stock = s.merchant.stock;
    const slot = stock.findIndex((l) => l !== null);
    const l = stock[slot]!;
    const gold = s.character.gold;
    const bought = apply(s, { type: 'BUY_ITEM', slot, defId: l.defId, quantity: 1, maxUnitPrice: l.unitPrice }, V17_SAVE.time.lastSimulatedAt);
    expect(bought.character.gold).toBe(gold - l.unitPrice);
    expect(run(s, { type: 'REFRESH_MERCHANT' }, V17_SAVE.time.lastSimulatedAt).ok).toBe(true);
    const later = simulate(s, V17_SAVE.time.lastSimulatedAt + 2 * HOUR).state.merchant;
    expect(later.charges).toBe(5); // 4 charges + 45 min banked + 2 h
  });

  it('loading writes a MIGRATE anchor (save 17 → current, engine 1.17.0 → current); Storage can be built; the whole log replays', async () => {
    const repo = new MemoryGameRepository();
    await repo.init();
    await repo.commit(entriesToRows(V17_LOG), V17_SAVE as GameState, { [META_ENGINE_VERSION]: '1.17.0', device_id: 'phone' });
    const clock = new FakeClock(V17_SAVE.time.lastSimulatedAt + 3 * MIN);
    const { client } = makeClient({ repo, clock, prefix: 'v18' });
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({ fromSave: 17, toSave: CURRENT_SAVE_VERSION, fromEngine: '1.17.0', toEngine: ENGINE_VERSION, fromHash: V17_LOG.at(-1)!.stateHash, snapshot: undefined });
    expect(p.snapshot).toEqual(loadSave(V17_SAVE));
    expect(client.getState().buildings).toMatchObject({ merchant: { state: 'built', level: 2 }, storage: { state: 'locked', level: 0 } });
    expect((await client.dispatch({ type: 'BUILD', buildingId: 'storage' })).ok).toBe(true); // Town Hall Lv2, gold, oak and stone are in the fixture
    expect(client.getState().buildings.storage).toEqual({ state: 'built', level: 1 });
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: V17_LOG.length });
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});

function entriesToRows(rows: LogRow[]) {
  return rows.map(({ seq: _seq, synced: _synced, ...r }) => r);
}
