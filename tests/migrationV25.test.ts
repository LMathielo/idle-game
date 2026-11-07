// Save v26 (engine 1.29.0): the Storage. Frozen v25 save, written by the UNTOUCHED 1.28.0 engine (origin/dev at 827efcf): a strong hero
// (Troll Bridge open) with a Potion Belt in the bag, a gap in the bag, Storage at Lv2 (the save had no use for it then), the Town Hall at
// Lv3, two crafting pipes running (Oak Planks, Stone Bricks) and Oak running, 104,014 gold.
// tests/fixtures/save-v25-reference.json holds what that engine produced from it (four continuations: three hours of woodcutting with the
// pipes, 90 minutes of Troll Bridge, and a script of stop / equip / upgrade / craft / move). The migrated save must reproduce every one to
// the last item, cell, draw and hash (seen without the storage): the migration changes no outcome.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { LogRow } from '../src/client/types';
import {
  applyCommand,
  CURRENT_SAVE_VERSION,
  ENGINE_VERSION,
  type GameState,
  hashState,
  loadSave,
  type MigratePayload,
  MIGRATIONS,
  RELEASED_ENGINES,
  replayLogReport,
  type ReplayEntry,
  simulate,
  storageCapacity,
  storageView,
} from '../src/engine';
import { makeItem, placeInBag, placeInStorage } from '../src/engine/inventory';
import { asV25, cmd, HOUR, makeClient, MIN } from './helpers';

const read = (name: string): Record<string, any> => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const V25 = read('save-v25.json');
const REF = read('save-v25-reference.json');
const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);
const T = REF.at as number;

/** The facts the generator recorded from the 1.28.0 engine (the hash is taken in the v25 shape: no storage). */
const facts = (st: GameState) => ({
  gold: st.character.gold,
  hp: st.character.hp,
  xp: st.character.xp,
  level: st.character.level,
  rng: st.rng.seed,
  serial: st.nextItemSerial,
  stamina: st.stamina.current,
  items: st.inventory.items.map((i) => [i.id, i.defId, i.quantity ?? 1, i.cell]),
  equipment: Object.fromEntries(Object.entries(st.character.equipment).map(([k, v]) => [k, v!.id])),
  belt: st.character.equipment.accessory?.belt ?? null,
  totals: st.dungeon.totals,
  buildings: Object.fromEntries(Object.entries(st.buildings).map(([k, v]) => [k, `${v.state}:${v.level}`])),
  construction: st.construction ? `${st.construction.buildingId}:${st.construction.level}:${Math.round(st.construction.progressMs)}` : null,
  pipes: st.crafting.pipes.map((p) => (p ? `${p.recipeId}:${p.status}:${p.done}:${Math.round(p.progressMs)}${p.x10 ? ':x10' : ''}` : null)),
  hash: hashState(asV25(st)),
});

const ok = (s: GameState, c: Parameters<typeof cmd>[0], now: number): GameState => {
  const r = applyCommand(s, cmd(c), now);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
};

describe('the frozen v25 save', () => {
  it('is what it claims: v25, written by 1.28.0, no storage, Storage Lv2, a belt with potions in the bag, a gap, two pipes running', () => {
    expect(V25.saveVersion).toBe(25);
    expect(REF.engine).toBe('1.28.0');
    expect(V25).not.toHaveProperty('storage');
    expect(V25.buildings.storage).toEqual({ state: 'built', level: 2 });
    expect(V25.inventory.items.map((i: any) => [i.id, i.cell])).toEqual([['bread', 0], ['oak_logs', 1], ['health_potion_t1', 3], ['stone_sword#6', 4], ['wild_sage', 5], ['iron_boots#7', 6], ['stone', 7], ['potion_belt', 8]]);
    expect(V25.inventory.items.find((i: any) => i.id === 'potion_belt').belt[2]).toEqual({ defId: 'greater_health_potion', count: 3, rule: 'always' });
    expect(V25.crafting.pipes.slice(0, 2).map((p: any) => p.recipeId)).toEqual(['oak_plank', 'stone_brick']);
    expect(V25.activity).toMatchObject({ kind: 'woodcutting', treeId: 'oak' });
  });
});

describe('v25 -> v26', () => {
  const s = loadSave(V25);

  it('loads as the current save with an EMPTY storage; nothing else differs from the document', () => {
    expect(CURRENT_SAVE_VERSION).toBe(26);
    expect(s.saveVersion).toBe(26);
    expect(s.storage).toEqual({ items: [] });
    expect(s.rng).toEqual(V25.rng);
    expect(s.time).toEqual(V25.time);
    // Taking the storage off again gives the fixture byte for byte.
    expect(asV25(s)).toEqual(V25);
  });

  it('the capacity follows the save\'s Storage level (Lv2: 70 cells); an unbuilt Storage has the container and no cells', () => {
    expect(storageCapacity(s)).toBe(70);
    expect(storageView(s)).toMatchObject({ built: true, level: 2, capacity: 70, used: 0 });
    const unbuilt = loadSave({ ...V25, buildings: { ...V25.buildings, storage: { state: 'locked', level: 0 } } });
    expect(unbuilt.storage).toEqual({ items: [] });
    expect(storageCapacity(unbuilt)).toBe(0);
    const lv1 = loadSave({ ...V25, buildings: { ...V25.buildings, storage: { state: 'built', level: 1 } } });
    expect(storageCapacity(lv1)).toBe(50);
  });

  it('plays on exactly as the untouched 1.28.0 engine played it (seen without the storage): pipes, cells, draws, hashes', () => {
    expect(facts(s)).toEqual(REF.start);
    const wood = simulate(s, T + 3 * HOUR).state;
    expect(facts(wood)).toEqual(REF.afterWoodcutting3h);
    const crypt = ok(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'troll_bridge' }, T);
    expect(facts(simulate(crypt, T + 90 * MIN).state)).toEqual(REF.afterCrypt90m);
  });

  it('the command script (stop a pipe, belt on, upgrade, craft, move) leaves the 1.28.0 result, and an hour on', () => {
    let c = ok(s, { type: 'STOP_CRAFT', pipe: 0, jobId: s.crafting.pipes[0]!.id }, T);
    c = ok(c, { type: 'EQUIP_ITEM', itemId: 'potion_belt' }, T);
    c = ok(c, { type: 'UPGRADE_BUILDING', buildingId: 'crafting', level: 2 }, T);
    c = ok(c, { type: 'START_CRAFT', pipe: 0, recipeId: 'birch_plank' }, T);
    c = ok(c, { type: 'MOVE_ITEM', itemId: 'stone', toCell: 17 }, T);
    expect(facts(c)).toEqual(REF.afterCommands);
    expect(facts(simulate(c, T + HOUR).state)).toEqual(REF.afterCommands1h);
  });

  it('the new storage works on the migrated save: deposit, the upgrade to Lv3 needs the Town Hall (Lv3) and pays storage first; the belt keeps its potions', () => {
    let d = ok(s, { type: 'DEPOSIT_ALL' }, T);
    expect(d.inventory.items).toEqual([]);
    expect(d.storage.items.find((i) => i.defId === 'potion_belt')!.belt![2]).toEqual({ defId: 'greater_health_potion', count: 3, rule: 'always' });
    // Everything is in storage now: the pipes still run (their inputs come from storage), the totals are the 1.28.0 ones after a long run.
    const wood = simulate(d, T + 3 * HOUR).state;
    const base = simulate(s, T + 3 * HOUR).state;
    expect(wood.crafting.pipes.map((p) => p && [p.status, p.done])).toEqual(base.crafting.pipes.map((p) => p && [p.status, p.done]));
    const total = (x: GameState, id: string) => [...x.inventory.items, ...x.storage.items].filter((i) => i.defId === id).reduce((n, i) => n + (i.quantity ?? 1), 0);
    for (const id of ['oak_logs', 'oak_plank', 'stone', 'stone_brick', 'bird_nest']) expect(total(wood, id)).toBe(total(base, id));
    // Level 3 costs 50 Birch Logs + 50 Copper Ore: 30 + 30 in storage, 20 + 20 in the bag -> storage first, then the bag.
    d = JSON.parse(JSON.stringify(d)) as GameState;
    placeInStorage(d, makeItem('birch_logs', 30));
    placeInStorage(d, makeItem('copper_ore', 30));
    placeInBag(d.inventory, makeItem('birch_logs', 25));
    placeInBag(d.inventory, makeItem('copper_ore', 25));
    d = ok(d, { type: 'UPGRADE_BUILDING', buildingId: 'storage', level: 3 }, T);
    expect(d.construction).toMatchObject({ buildingId: 'storage', level: 3 });
    expect(d.storage.items.find((i) => i.defId === 'birch_logs')).toBeUndefined();
    expect(d.inventory.items.find((i) => i.defId === 'birch_logs')!.quantity).toBe(5);
    expect(storageCapacity(simulate(d, T + 2 * HOUR).state)).toBe(90);
  });

  it('pure and deterministic; an odd document survives: a kept storage, a broken one replaced, none', () => {
    const copy = JSON.parse(JSON.stringify(V25));
    expect(loadSave(copy)).toEqual(loadSave(V25));
    expect(copy).toEqual(V25);
    expect(MIGRATIONS[25](JSON.parse(JSON.stringify(V25))).saveVersion).toBe(26);
    expect((MIGRATIONS[25]({ saveVersion: 25 }) as any).storage).toEqual({ items: [] });
    expect((MIGRATIONS[25]({ saveVersion: 25, storage: 'broken' }) as any).storage).toEqual({ items: [] });
    const kept = { items: [{ id: 'stone', defId: 'stone', cell: 3, quantity: 4 }] };
    expect((MIGRATIONS[25]({ saveVersion: 25, storage: kept }) as any).storage).toEqual(kept);
  });

  it('the release table: 1.29.0 wrote save 26', () => {
    expect(RELEASED_ENGINES.at(-1)).toEqual({ engine: '1.29.0', save: 26 });
    expect(ENGINE_VERSION).toBe('1.29.0');
  });
});

describe('through the client', () => {
  it('loading writes a MIGRATE anchor (save 25 -> 26, engine 1.28.0 -> current); a deposit after it is logged and the log replays', async () => {
    const repo = new MemoryGameRepository();
    await repo.init();
    const last = { commandId: 'v25-last', type: 'SIMULATE' as const, payload: { checkpoint: true }, clientTime: T, engineVersion: '1.28.0', stateHash: hashState(V25) };
    await repo.commit([last], V25 as unknown as GameState, { [META_ENGINE_VERSION]: '1.28.0', device_id: 'phone' });
    const clock = new FakeClock(T + 3 * 1000);
    const { client } = makeClient({ repo, clock, prefix: 'v26' });
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect(p).toMatchObject({ fromSave: 25, toSave: CURRENT_SAVE_VERSION, fromEngine: '1.28.0', toEngine: ENGINE_VERSION });
    expect(p.snapshot).toEqual(loadSave(V25));
    const r = await client.dispatch({ type: 'DEPOSIT_ALL' });
    expect(r.ok).toBe(true);
    expect((await client.dispatch({ type: 'STORAGE_MOVE', from: 'storage', itemId: 'stone_sword#6', to: 'bag' })).ok).toBe(true);
    const state = client.getState();
    expect(state.storage.items.length).toBeGreaterThan(5);
    expect(state.inventory.items.map((i) => i.id)).toEqual(['stone_sword#6']);
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: 1 });
    expect(hashState(report.state!)).toBe(hashState(state));
  });
});
