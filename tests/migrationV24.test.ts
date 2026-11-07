// Save v25 (engine 1.28.0): the bag becomes a grid with gaps (`Item.cell`). Frozen v24 save, written by the UNTOUCHED 1.27.0 engine
// (origin/feat/potion-belt at ce07e58, PR #44): a strong hero (Troll Bridge open) wearing a Potion Belt with potions inside, an uncommon
// helm and a rare sword, and a bag of eight items (stacks, gear, a spare Iron Boots), cutting Oak, 4,000 gold.
// tests/fixtures/save-v24-reference.json holds what that engine produced from it (four continuations: three hours of woodcutting, 90
// minutes of Troll Bridge with gear and herb drops, and a script of unequips / sale / purchase / potion / equips). The migrated save must
// reproduce every one to the last item, draw and hash (seen without cells): the migration changes no outcome.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { LogRow } from '../src/client/types';
import {
  applyCommand,
  bagCells,
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
} from '../src/engine';
import { asV24, cmd, HOUR, makeClient, MIN } from './helpers';

const read = (name: string): Record<string, any> => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const V24 = read('save-v24.json');
const REF = read('save-v24-reference.json');
const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);
const T = REF.at as number;

/** The facts the generator recorded from the 1.27.0 engine (the hash is taken in the v24 shape: no cells). */
const facts = (st: GameState) => ({
  gold: st.character.gold,
  hp: st.character.hp,
  xp: st.character.xp,
  level: st.character.level,
  rng: st.rng.seed,
  serial: st.nextItemSerial,
  stamina: st.stamina.current,
  items: st.inventory.items.map((i) => [i.id, i.defId, i.quantity ?? 1]),
  equipment: Object.fromEntries(Object.entries(st.character.equipment).map(([k, v]) => [k, v!.id])),
  belt: st.character.equipment.accessory?.belt ?? null,
  totals: st.dungeon.totals,
  hash: hashState(asV24(st)),
});

const ok = (s: GameState, c: Parameters<typeof cmd>[0], now: number): GameState => {
  const r = applyCommand(s, cmd(c), now);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
};

function expectBagValid(s: GameState): void {
  const cells = s.inventory.items.map((i) => i.cell);
  for (const c of cells) {
    expect(Number.isInteger(c)).toBe(true);
    expect(c!).toBeGreaterThanOrEqual(0);
    expect(c!).toBeLessThan(s.inventory.capacity);
  }
  expect(new Set(cells).size).toBe(cells.length);
  for (const worn of Object.values(s.character.equipment)) expect(worn!.cell).toBeUndefined();
}

describe('the frozen v24 save', () => {
  it('is what it claims: v24, written by 1.27.0, no cells, a worn belt with potions, Oak running, eight items in the bag', () => {
    expect(V24.saveVersion).toBe(24);
    expect(REF.engine).toBe('1.27.0');
    expect(V24.inventory.items.map((i: any) => i.id)).toEqual(['bread', 'oak_logs', 'copper_helm#5', 'health_potion_t1', 'stone_sword#6', 'wild_sage', 'iron_boots#7', 'stone']);
    expect(JSON.stringify(V24.inventory)).not.toContain('"cell"');
    expect(V24.character.equipment.accessory.belt[2]).toEqual({ defId: 'greater_health_potion', count: 3, rule: 'always' });
    expect(V24.activity).toMatchObject({ kind: 'woodcutting', treeId: 'oak' });
  });
});

describe('v24 -> v25', () => {
  const s = loadSave(V24);

  it('loads as the current save; nothing but the cells differs from the document', () => {
    expect(CURRENT_SAVE_VERSION).toBe(25);
    expect(s.saveVersion).toBe(25);
    expect(s.rng).toEqual(V24.rng);
    expect(s.time).toEqual(V24.time);
    // Taking the cells off again gives the fixture byte for byte.
    expect(asV24(s)).toEqual(V24);
  });

  it('the bag looks exactly as it did: every item in the cell of its position, the free cells at the end; the list order is kept', () => {
    expect(s.inventory.items.map((i) => [i.id, i.cell])).toEqual(V24.inventory.items.map((i: any, n: number) => [i.id, n]));
    expect(bagCells(s.inventory).map((i) => i?.id ?? null)).toEqual([...V24.inventory.items.map((i: any) => i.id), ...Array(12).fill(null)]);
    expectBagValid(s);
    expect(s.character.equipment.accessory!.belt![0]).toEqual({ defId: 'health_potion_t1', count: 8, rule: 'hp_below_50' });
  });

  it('plays on exactly as the untouched 1.27.0 engine played it (seen without cells)', () => {
    expect(facts(s)).toEqual(REF.start);
    const wood = simulate(s, T + 3 * HOUR).state;
    expect(facts(wood)).toEqual(REF.afterWoodcutting3h);
    expectBagValid(wood);
    // The first Bird Nest is a new stack: the first empty cell, 8.
    expect(wood.inventory.items.find((i) => i.defId === 'bird_nest')!.cell).toBe(8);
    const crypt = ok(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'troll_bridge' }, T);
    const run = simulate(crypt, T + 90 * MIN).state;
    expect(facts(run)).toEqual(REF.afterCrypt90m);
    expectBagValid(run);
    // Troll Hide and the three Copper pieces arrived into cells 8..11, in the order they dropped.
    expect(run.inventory.items.slice(8).map((i) => [i.id, i.cell])).toEqual([['troll_hide', 8], ['copper_helm#8', 9], ['copper_sword#9', 10], ['copper_boots#10', 11]]);
  });

  it('the command script (belt and helm off, sale, purchase, potion, boots and belt on) leaves the 1.27.0 result, with the gaps where the pieces left', () => {
    let c = ok(s, { type: 'UNEQUIP_ITEM', slot: 'accessory' }, T);
    c = ok(c, { type: 'UNEQUIP_ITEM', slot: 'helmet' }, T);
    expect(c.inventory.items.slice(-2).map((i) => [i.id, i.cell])).toEqual([['potion_belt', 8], ['iron_helm#3', 9]]);
    c = ok(c, { type: 'SELL_ITEM', itemId: 'copper_helm#5', quantity: 1 }, T);
    expect(bagCells(c.inventory)[2]).toBeNull();
    const slot = c.merchant.stock.findIndex((l) => l && l.defId === 'health_potion_t1');
    const l = c.merchant.stock[slot]!;
    c = ok(c, { type: 'BUY_ITEM', slot, defId: l.defId, quantity: 2, maxUnitPrice: l.unitPrice }, T);
    c = { ...c, character: { ...c.character, hp: 20, hpRegenProgress: 0 } };
    c = ok(c, { type: 'USE_ITEM', itemId: 'health_potion_t1' }, T);
    c = ok(c, { type: 'EQUIP_ITEM', itemId: 'iron_boots#7' }, T);
    expect(bagCells(c.inventory)[6]?.id).toBe('start-worn_sandals'); // the old boots took the new ones' cell
    c = ok(c, { type: 'EQUIP_ITEM', itemId: 'potion_belt' }, T);
    expect(facts(c)).toEqual(REF.afterCommands);
    expectBagValid(c);
    expect(facts(simulate(c, T + HOUR).state)).toEqual(REF.afterCommands1h);
  });

  it('the migrated belt still works: a drag-style unequip into a chosen cell keeps the potions inside', () => {
    const u = ok(s, { type: 'UNEQUIP_ITEM', slot: 'accessory', toCell: 15 }, T);
    const belt = u.inventory.items.find((i) => i.defId === 'potion_belt')!;
    expect(belt.cell).toBe(15);
    expect(belt.belt![2]).toEqual({ defId: 'greater_health_potion', count: 3, rule: 'always' });
    expectBagValid(u);
  });

  it('pure and deterministic; odd documents survive: no inventory, no items array, more items than cells, a missing capacity', () => {
    const copy = JSON.parse(JSON.stringify(V24));
    expect(loadSave(copy)).toEqual(loadSave(V24));
    expect(copy).toEqual(V24);
    expect(MIGRATIONS[24](JSON.parse(JSON.stringify(V24))).saveVersion).toBe(25);
    expect((MIGRATIONS[24]({ saveVersion: 24 }) as any).inventory).toBeUndefined();
    expect((MIGRATIONS[24]({ saveVersion: 24, inventory: { capacity: 5 } }) as any).inventory).toEqual({ capacity: 5 });
    const over = MIGRATIONS[24]({ saveVersion: 24, inventory: { capacity: 2, items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } }) as any;
    expect(over.inventory.items).toEqual([{ id: 'a', cell: 0 }, { id: 'b', cell: 1 }, { id: 'c' }]); // the extra one is kept, uncelled
    const noCap = MIGRATIONS[24]({ saveVersion: 24, inventory: { items: Array.from({ length: 22 }, (_, i) => ({ id: `i${i}` })) } }) as any;
    expect(noCap.inventory.items.filter((i: any) => i.cell !== undefined)).toHaveLength(20);
  });

  it('the release table: 1.28.0 wrote save 25', () => {
    expect(RELEASED_ENGINES.at(-1)).toEqual({ engine: '1.28.0', save: 25 });
    expect(ENGINE_VERSION).toBe('1.28.0');
  });
});

describe('through the client', () => {
  it('loading writes a MIGRATE anchor (save 24 -> 25, engine 1.27.0 -> current); a drag after it is logged and the log replays', async () => {
    const repo = new MemoryGameRepository();
    await repo.init();
    const last = { commandId: 'v24-last', type: 'SIMULATE' as const, payload: { checkpoint: true }, clientTime: T, engineVersion: '1.27.0', stateHash: hashState(V24) };
    await repo.commit([last], V24 as unknown as GameState, { [META_ENGINE_VERSION]: '1.27.0', device_id: 'phone' });
    const clock = new FakeClock(T + 3 * 1000);
    const { client } = makeClient({ repo, clock, prefix: 'v25' });
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect(p).toMatchObject({ fromSave: 24, toSave: CURRENT_SAVE_VERSION, fromEngine: '1.27.0', toEngine: ENGINE_VERSION });
    expect(p.snapshot).toEqual(loadSave(V24));
    expect((await client.dispatch({ type: 'MOVE_ITEM', itemId: 'stone', toCell: 14 })).ok).toBe(true);
    expect((await client.dispatch({ type: 'MOVE_ITEM', itemId: 'oak_logs', toCell: 0 })).ok).toBe(true); // swaps with the bread
    expect((await client.dispatch({ type: 'UNEQUIP_ITEM', slot: 'helmet', toCell: 4 })).ok).toBe(false); // the Stone Sword is not a helm: CELL_TAKEN, not logged
    expect((await client.dispatch({ type: 'UNEQUIP_ITEM', slot: 'helmet', toCell: 2 })).ok).toBe(true); // the Copper Helm fits: swapped in
    const state = client.getState();
    expect(state.character.equipment.helmet!.id).toBe('copper_helm#5');
    expect(bagCells(state.inventory).slice(0, 3).map((i) => i?.id)).toEqual(['oak_logs', 'bread', 'iron_helm#3']);
    expect(bagCells(state.inventory)[14]?.id).toBe('stone');
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: 1 });
    expect(hashState(report.state!)).toBe(hashState(state));
  });
});
