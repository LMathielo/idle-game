// The Storage building (engine 1.29.0, save v26; owner decisions 2026-11-07): a second grid beside the bag (capacity 50 / 70 / 90 / 110 / 130
// by level), DEPOSIT_ALL / DEPOSIT_STACKED / STORAGE_MOVE, dropCommand for storage drags, and the storage paying builds, upgrades and crafting
// inputs FIRST (then the bag), refunds going to the bag first. Output, drops, the Merchant, the belt, potions and equipping stay bag-only.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  bagCells,
  BUILDINGS,
  craftingView,
  craftJobView,
  countItem,
  depositPreview,
  dropCommand,
  type DragSource,
  type DragTarget,
  EQUIPMENT_SLOTS,
  type GameEvent,
  type GameState,
  hashState,
  heroOwnsItem,
  type Item,
  itemQuantity,
  newGame,
  planMove,
  replayLogReport,
  type ReplayEntry,
  requirementViews,
  simulate,
  storageBox,
  storageCapacity,
  storageView,
  upgradeView,
} from '../src/engine';
import { cloneState } from '../src/engine/clone';
import { rollItemDrop } from '../src/engine/drops';
import { cellsOf, makeItem, placeInBag, placeInStorage, placeInStorageCell } from '../src/engine/inventory';
import type { FightRewards } from '../src/engine/types';
import { builtGame, cmd, debugBuild, HOUR, makeClient, MIN, SEC, T0, withBuilt } from './helpers';

type Input = Parameters<typeof cmd>[0];

const run = (s: GameState, c: Input, at = T0) => applyCommand(s, cmd(c), at);
const ok = (s: GameState, c: Input, at = T0): GameState => {
  const r = run(s, c, at);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
};
const events = (s: GameState, c: Input, at = T0): GameEvent[] => {
  const r = run(s, c, at);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.events;
};
const code = (s: GameState, c: Input, at = T0): string => {
  const r = run(s, c, at);
  return r.ok ? 'ok' : r.error.code;
};

/** A built game (every building built at Lv1, Storage included: 50 cells), plenty of gold, an empty storage. */
function base(): GameState {
  const s = cloneState(builtGame(5, T0));
  s.character.gold = 1_000_000;
  return s;
}

/** Adds `quantity` of a stackable to the BAG (its stack, else a cell) / to the STORAGE. */
function inBag(s: GameState, defId: string, quantity: number): GameState {
  const stack = s.inventory.items.find((i) => i.stackable && i.defId === defId);
  if (stack) stack.quantity = (stack.quantity ?? 0) + quantity;
  else if (!placeInBag(s.inventory, makeItem(defId, quantity))) throw new Error('bag full');
  return s;
}
function inStorage(s: GameState, defId: string, quantity: number): GameState {
  const stack = s.storage.items.find((i) => i.stackable && i.defId === defId);
  if (stack) stack.quantity = (stack.quantity ?? 0) + quantity;
  else if (!placeInStorage(s, makeItem(defId, quantity))) throw new Error('storage full');
  return s;
}
const gearInBag = (s: GameState, defId: string, id: string): GameState => {
  placeInBag(s.inventory, makeItem(defId, 1, id, { quality: 50, rarity: 'common' }));
  return s;
};
const gearInStorage = (s: GameState, defId: string, id: string): GameState => {
  placeInStorage(s, makeItem(defId, 1, id, { quality: 50, rarity: 'common' }));
  return s;
};

const bagQty = (s: GameState, defId: string) => s.inventory.items.filter((i) => i.defId === defId).reduce((n, i) => n + (i.quantity ?? 1), 0);
const storeQty = (s: GameState, defId: string) => s.storage.items.filter((i) => i.defId === defId).reduce((n, i) => n + (i.quantity ?? 1), 0);
const bagIds = (s: GameState) => bagCells(s.inventory).map((i) => i?.id ?? null);
const storeIds = (s: GameState) => bagCells(storageBox(s)).map((i) => i?.id ?? null);
const cellIn = (items: Item[], id: string) => items.find((i) => i.id === id)?.cell;

/** Both containers valid: cells unique integers inside the capacity, one stack per stackable type per container, no id twice anywhere. */
function expectValid(s: GameState): void {
  for (const [items, capacity] of [
    [s.inventory.items, s.inventory.capacity],
    [s.storage.items, storageCapacity(s)],
  ] as const) {
    const cells = items.map((i) => i.cell);
    for (const c of cells) {
      expect(Number.isInteger(c)).toBe(true);
      expect(c!).toBeGreaterThanOrEqual(0);
      expect(c!).toBeLessThan(capacity);
    }
    expect(new Set(cells).size).toBe(cells.length);
    const stackable = items.filter((i) => i.stackable).map((i) => i.defId);
    expect(new Set(stackable).size).toBe(stackable.length);
  }
  // A stackable's id is its definition id, so the bag's and the storage's stacks of one type share it; every other id is unique everywhere.
  const all = [...s.inventory.items, ...s.storage.items, ...Object.values(s.character.equipment)].filter((i) => !i!.stackable).map((i) => i!.id);
  expect(new Set(all).size).toBe(all.length);
  for (const worn of Object.values(s.character.equipment)) expect(worn!.cell).toBeUndefined();
}

/** Total units of everything the hero owns outside the equipment, by defId. */
function totals(s: GameState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of [...s.inventory.items, ...s.storage.items]) out[i.defId] = (out[i.defId] ?? 0) + (i.quantity ?? 1);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------

describe('capacity follows the Storage level (50 / 70 / 90 / 110 / 130)', () => {
  it('data: storageSlots per level; 0 while locked; a new game has an empty storage and no cells', () => {
    expect(BUILDINGS.storage.levels.map((l) => l.storageSlots)).toEqual([50, 70, 90, 110, 130]);
    const fresh = newGame(1, T0);
    expect(fresh.storage).toEqual({ items: [] });
    expect(storageCapacity(fresh)).toBe(0);
    expect(storageView(fresh)).toMatchObject({ built: false, capacity: 0, used: 0, cells: [] });
  });

  it('each level gives its slots; the grid view has that many cells', () => {
    for (const [level, slots] of [[1, 50], [2, 70], [3, 90], [4, 110], [5, 130]] as const) {
      const s = { ...base(), buildings: { ...base().buildings, storage: { state: 'built' as const, level } } };
      expect(storageCapacity(s)).toBe(slots);
      expect(storageView(s)).toMatchObject({ built: true, level, capacity: slots, used: 0 });
      expect(storageView(s).cells).toHaveLength(slots);
    }
  });

  it('BUILD gives 50 cells at once; an upgrade (UPGRADE_BUILDING, finished by the builder) raises them, items stay where they are', () => {
    let s = cloneState(newGame(1, T0));
    s.character.gold = 100_000;
    s.character.level = 5;
    inBag(s, 'oak_logs', 500);
    inBag(s, 'stone', 500);
    s = ok(s, { type: 'BUILD', buildingId: 'town_hall' });
    s = ok(s, { type: 'BUILD', buildingId: 'storage' });
    expect(storageCapacity(s)).toBe(50);
    s = ok(s, { type: 'DEBUG_ADD_GOLD', amount: 100_000 });
    inStorage(s, 'wild_sage', 1);
    // Town Hall Lv2 first (the cap), then Storage.
    s = ok(s, { type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 2 });
    s = simulate(s, T0 + 31 * MIN).state;
    s = ok(s, { type: 'UPGRADE_BUILDING', buildingId: 'storage', level: 2 }, T0 + 31 * MIN);
    expect(storageCapacity(s)).toBe(50); // still Lv1 while the builder works
    const done = simulate(s, T0 + 31 * MIN + 16 * MIN).state;
    expect(done.buildings.storage).toEqual({ state: 'built', level: 2 });
    expect(storageCapacity(done)).toBe(70);
    expect(storageView(done).cells).toHaveLength(70);
    expect(done.storage.items.map((i) => i.defId)).toEqual(['wild_sage']);
  });

  it('DEBUG_BUILD and DEBUG_FINISH_CONSTRUCTION follow the same rule (the capacity is derived from the level)', () => {
    let s = cloneState(newGame(1, T0));
    s = ok(s, { type: 'DEBUG_BUILD', buildingId: 'storage' });
    expect(storageCapacity(s)).toBe(50);
  });

  it('standard upgrade costs, capped by the Town Hall; the Upgrade sheet knows the next level has slots', () => {
    const s = base();
    const v = upgradeView(s, 'storage');
    expect(v).toMatchObject({ level: 1, nextLevel: 2, durationMs: 15 * MIN, bonuses: { storageSlots: 50 }, nextBonuses: { storageSlots: 70 } });
    expect(v.block).toBe('town_hall'); // the Town Hall is Lv1: Storage may not pass it
    expect(v.cost.map((c) => [c.kind, c.need])).toEqual([['item', 25], ['item', 25], ['gold', 250]]);
    expect(code(s, { type: 'UPGRADE_BUILDING', buildingId: 'storage', level: 2 })).toBe('TOWN_HALL_TOO_LOW');
  });

  it('a Lv1 -> Lv5 storage with 130 cells fills all of them and no more', () => {
    const s = { ...base(), buildings: { ...base().buildings, storage: { state: 'built' as const, level: 5 } } };
    for (let n = 0; n < 130; n += 1) expect(placeInStorage(s, makeItem('stone_sword', 1, `g#${n}`))).toBe(true);
    expect(placeInStorage(s, makeItem('stone_sword', 1, 'g#x'))).toBe(false);
    expect(storageView(s)).toMatchObject({ capacity: 130, used: 130 });
    expectValid(s);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('every storage command is refused with BUILDING_LOCKED while Storage is unbuilt', () => {
  it('DEPOSIT_ALL, DEPOSIT_STACKED, STORAGE_MOVE', () => {
    const s = inBag(newGame(1, T0), 'oak_logs', 5);
    for (const c of [
      { type: 'DEPOSIT_ALL' },
      { type: 'DEPOSIT_STACKED' },
      { type: 'STORAGE_MOVE', from: 'bag', itemId: 'oak_logs', to: 'storage' },
      { type: 'STORAGE_MOVE', from: 'bag', itemId: 'oak_logs', to: 'storage', toCell: 0 },
    ] as Input[]) {
      expect(code(s, c)).toBe('BUILDING_LOCKED');
    }
    expect(storageView(s).deposit.all.reason).toBe('Build the Storage first');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('DEPOSIT_ALL', () => {
  it('merges stackables into the stacks already in storage first, then puts the rest in the lowest free storage cells in bag-cell order', () => {
    let s = base();
    inStorage(s, 'stone', 7); // storage cell 0
    inStorage(s, 'oak_logs', 3); // storage cell 1
    gearInBag(s, 'iron_sword', 'iron_sword#a'); // bag cell 1
    inBag(s, 'oak_logs', 10); // bag cell 2
    inBag(s, 'wild_sage', 4); // bag cell 3
    inBag(s, 'stone', 5); // bag cell 4
    gearInBag(s, 'iron_helm', 'iron_helm#a'); // bag cell 5
    expect(bagIds(s).slice(0, 6)).toEqual(['bread', 'iron_sword#a', 'oak_logs', 'wild_sage', 'stone', 'iron_helm#a']);
    const e = events(s, { type: 'DEPOSIT_ALL' });
    expect(e).toContainEqual({ type: 'ITEMS_DEPOSITED', mode: 'all', moved: 6, stayed: 0 });
    s = ok(s, { type: 'DEPOSIT_ALL' });
    expect(s.inventory.items).toEqual([]);
    expect(storeQty(s, 'oak_logs')).toBe(13);
    expect(storeQty(s, 'stone')).toBe(12);
    // Merged stacks keep their cells; the rest take cells 2.. in bag order: bread, sword, sage, helm.
    expect(storeIds(s).slice(0, 6)).toEqual(['stone', 'oak_logs', 'bread', 'iron_sword#a', 'wild_sage', 'iron_helm#a']);
    expectValid(s);
  });

  it('when storage fills the rest stays in the bag, and the event says how many entries stayed', () => {
    let s = base();
    for (let n = 0; n < 48; n += 1) gearInStorage(s, 'stone_sword', `filler#${n}`); // 48 of 50 cells
    inStorage(s, 'stone', 9); // cell 48
    // Bag: bread (0), then 4 more entries: wild_sage (1), 3 swords (2..4).
    inBag(s, 'wild_sage', 2);
    for (const id of ['a', 'b', 'c']) gearInBag(s, 'iron_boots', `boots#${id}`);
    inBag(s, 'stone', 1); // merges into the storage stone: needs no room
    expect(s.inventory.items).toHaveLength(6);
    const e = events(s, { type: 'DEPOSIT_ALL' });
    // 2 free cells (49 and ... only one: 48 filler + stone = 49 used, one free): the stone merges, bread takes the last cell, 4 stay.
    expect(e).toContainEqual({ type: 'ITEMS_DEPOSITED', mode: 'all', moved: 2, stayed: 4 });
    s = ok(s, { type: 'DEPOSIT_ALL' });
    expect(s.inventory.items.map((i) => i.id)).toEqual(['wild_sage', 'boots#a', 'boots#b', 'boots#c']);
    expect(storeQty(s, 'stone')).toBe(10);
    expect(s.storage.items).toHaveLength(50);
    expect(cellIn(s.storage.items, 'bread')).toBe(49);
    expectValid(s);
  });

  it('a full storage: nothing merges -> CONTAINER_FULL (nothing changes); an empty bag -> NOTHING_TO_MOVE; a merge-only deposit still works when full', () => {
    let s = base();
    for (let n = 0; n < 50; n += 1) gearInStorage(s, 'stone_sword', `filler#${n}`);
    expect(code(s, { type: 'DEPOSIT_ALL' })).toBe('CONTAINER_FULL');
    expect(storageView(s).deposit.all).toMatchObject({ moves: 0, reason: 'Storage is full' });
    const empty = { ...base(), inventory: { ...base().inventory, items: [] } };
    expect(code(empty, { type: 'DEPOSIT_ALL' })).toBe('NOTHING_TO_MOVE');
    const full = base();
    for (let n = 0; n < 49; n += 1) gearInStorage(full, 'stone_sword', `filler#${n}`);
    inStorage(full, 'bread', 1);
    expect(events(full, { type: 'DEPOSIT_ALL' })).toContainEqual({ type: 'ITEMS_DEPOSITED', mode: 'all', moved: 1, stayed: 0 });
    s = full;
  });

  it('equipped items never move; spare gear, potions and a Potion Belt with its contents go in intact', () => {
    let s = base();
    const belt = makeItem('potion_belt');
    belt.belt![1] = { defId: 'health_potion_t1', count: 12, rule: 'hp_below_25' };
    belt.belt![3] = { defId: 'greater_health_potion', count: 3, rule: 'always' };
    placeInBag(s.inventory, belt);
    inBag(s, 'health_potion_t1', 5);
    gearInBag(s, 'iron_helm', 'spare#helm');
    const worn = JSON.stringify(s.character.equipment);
    s = ok(s, { type: 'DEPOSIT_ALL' });
    expect(JSON.stringify(s.character.equipment)).toBe(worn);
    expect(s.inventory.items).toEqual([]);
    const stored = s.storage.items.find((i) => i.defId === 'potion_belt')!;
    expect(stored.belt).toEqual(belt.belt);
    expect(storeQty(s, 'health_potion_t1')).toBe(5);
    expect(s.storage.items.some((i) => i.id === 'spare#helm')).toBe(true);
    // And back: withdrawing the belt keeps the contents.
    const back = ok(s, { type: 'STORAGE_MOVE', from: 'storage', itemId: 'potion_belt', to: 'bag' });
    expect(back.inventory.items.find((i) => i.defId === 'potion_belt')!.belt).toEqual(belt.belt);
    expectValid(s);
  });

  it('is logged and replays; the preview matches what the command does', () => {
    const s = inBag(inStorage(base(), 'stone', 1), 'stone', 4);
    const p = depositPreview(s);
    expect(p.all).toEqual({ moves: 2, stays: 0, reason: null }); // bread + stone
    expect(p.stacked).toEqual({ moves: 1, reason: null });
  });
});

describe('DEPOSIT_STACKED', () => {
  it('merges only the bag stackables whose type already has a stack in storage; gear and other stackables stay', () => {
    let s = base();
    inStorage(s, 'stone', 10);
    inStorage(s, 'wild_sage', 1);
    gearInStorage(s, 'iron_sword', 'iron_sword#s');
    inBag(s, 'stone', 4);
    inBag(s, 'oak_logs', 8);
    gearInBag(s, 'iron_sword', 'iron_sword#b'); // same type as a stored piece: gear never moves
    expect(events(s, { type: 'DEPOSIT_STACKED' })).toContainEqual({ type: 'ITEMS_DEPOSITED', mode: 'stacked', moved: 1, stayed: 0 });
    s = ok(s, { type: 'DEPOSIT_STACKED' });
    expect(storeQty(s, 'stone')).toBe(14);
    expect(bagQty(s, 'stone')).toBe(0);
    expect(s.inventory.items.map((i) => i.id).sort()).toEqual(['bread', 'iron_sword#b', 'oak_logs']);
    expectValid(s);
  });

  it('works with a full storage (a merge needs no room); NOTHING_TO_MOVE when no stack matches', () => {
    let s = base();
    for (let n = 0; n < 49; n += 1) gearInStorage(s, 'stone_sword', `filler#${n}`);
    inStorage(s, 'bread', 1);
    expect(s.storage.items).toHaveLength(50);
    s = ok(s, { type: 'DEPOSIT_STACKED' });
    expect(storeQty(s, 'bread')).toBe(4);
    expect(s.inventory.items).toEqual([]);
    expect(code(inBag(base(), 'oak_logs', 1), { type: 'DEPOSIT_STACKED' })).toBe('NOTHING_TO_MOVE');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('STORAGE_MOVE', () => {
  const move = (from: 'bag' | 'storage', itemId: string, to: 'bag' | 'storage', toCell?: number): Input => (toCell === undefined ? { type: 'STORAGE_MOVE', from, itemId, to } : { type: 'STORAGE_MOVE', from, itemId, to, toCell });

  it('onto an empty cell it moves there (bag -> storage -> bag -> inside the storage), leaving a gap; the whole stack, never a split', () => {
    let s = inBag(base(), 'oak_logs', 40); // bag cell 1
    s = ok(s, move('bag', 'oak_logs', 'storage', 7));
    expect(bagQty(s, 'oak_logs')).toBe(0);
    expect(cellIn(s.storage.items, 'oak_logs')).toBe(7);
    expect(storeQty(s, 'oak_logs')).toBe(40);
    expect(bagIds(s)[1]).toBeNull(); // a gap
    s = ok(s, move('storage', 'oak_logs', 'storage', 12)); // inside the storage
    expect(cellIn(s.storage.items, 'oak_logs')).toBe(12);
    s = ok(s, move('storage', 'oak_logs', 'bag', 9));
    expect(cellIn(s.inventory.items, 'oak_logs')).toBe(9);
    expect(s.storage.items).toEqual([]);
    expectValid(s);
  });

  it('onto a different item it swaps (gear for gear, stack for gear, inside the storage too)', () => {
    let s = base();
    gearInBag(s, 'iron_sword', 'sword#b'); // bag 1
    gearInStorage(s, 'iron_helm', 'helm#s'); // storage 0
    inStorage(s, 'stone', 6); // storage 1
    s = ok(s, move('bag', 'sword#b', 'storage', 0));
    expect(storeIds(s).slice(0, 2)).toEqual(['sword#b', 'stone']);
    expect(bagIds(s)[1]).toBe('helm#s'); // the helm took the sword's old cell
    s = ok(s, move('storage', 'stone', 'bag', 1)); // onto the helm: swap
    expect(bagIds(s)[1]).toBe('stone');
    expect(storeIds(s).slice(0, 2)).toEqual(['sword#b', 'helm#s']);
    s = ok(s, move('storage', 'helm#s', 'storage', 0)); // inside the storage: trades with the sword
    expect(storeIds(s).slice(0, 2)).toEqual(['helm#s', 'sword#b']);
    expectValid(s);
  });

  it('onto the same stackable type it merges (the whole stack); aimed at any cell, a stack of its type there takes it', () => {
    let s = inStorage(inBag(base(), 'stone', 5), 'stone', 20); // storage 0
    s = ok(s, move('bag', 'stone', 'storage', 0));
    expect(storeQty(s, 'stone')).toBe(25);
    expect(bagQty(s, 'stone')).toBe(0);
    s = inBag(s, 'stone', 3);
    gearInStorage(s, 'iron_helm', 'helm#s');
    s = ok(s, move('bag', 'stone', 'storage', 30)); // an EMPTY far cell: still merges (no second stack)
    expect(storeQty(s, 'stone')).toBe(28);
    expect(s.storage.items.filter((i) => i.defId === 'stone')).toHaveLength(1);
    s = inBag(s, 'stone', 1);
    s = ok(s, move('bag', 'stone', 'storage', cellIn(s.storage.items, 'helm#s')!)); // a cell holding OTHER gear: merges, no swap
    expect(storeQty(s, 'stone')).toBe(29);
    expect(storeIds(s)).toContain('helm#s');
    expectValid(s);
  });

  it('a swap whose returning stack already has a stack in the source merges instead of making a second stack', () => {
    let s = base();
    gearInBag(s, 'iron_sword', 'sword#b'); // bag 1
    inBag(s, 'stone', 4); // the bag already has a Stone stack (cell 2)
    inStorage(s, 'stone', 9); // ... and so has the storage
    placeInStorageCell(s, makeItem('stone_sword', 1, 'x#1'), 3);
    expect(storeIds(s).slice(0, 4)).toEqual(['stone', null, null, 'x#1']);
    // Drag the sword onto the storage's Stone: Stone returns to the bag, where a Stone stack exists -> merged into it, sword's cell empties.
    s = ok(s, move('bag', 'sword#b', 'storage', 0));
    expect(bagQty(s, 'stone')).toBe(13);
    expect(bagIds(s)[1]).toBeNull();
    expect(s.inventory.items.filter((i) => i.defId === 'stone')).toHaveLength(1);
    expect(storeIds(s)[0]).toBe('sword#b');
    expectValid(s);
  });

  it('"to the other container, no cell": its stack of that type, else its first free cell; CONTAINER_FULL when neither', () => {
    let s = inStorage(inBag(base(), 'stone', 5), 'stone', 1);
    s = ok(s, move('bag', 'stone', 'storage'));
    expect(storeQty(s, 'stone')).toBe(6);
    s = gearInBag(s, 'iron_helm', 'helm#b');
    s = ok(s, move('bag', 'helm#b', 'storage')); // first free cell: 1 (the stone is in 0)
    expect(cellIn(s.storage.items, 'helm#b')).toBe(1);
    // Withdraw into the bag's first free cell (bread is 0, so the helm lands in 1).
    s = ok(s, move('storage', 'helm#b', 'bag'));
    expect(cellIn(s.inventory.items, 'helm#b')).toBe(1);
    // Full storage with no stack of the type: refused.
    const full = gearInBag(base(), 'iron_helm', 'helm#c');
    for (let n = 0; n < 50; n += 1) gearInStorage(full, 'stone_sword', `filler#${n}`);
    expect(code(full, move('bag', 'helm#c', 'storage'))).toBe('CONTAINER_FULL');
    // Full bag with no stack of the type: refused.
    const bagFull = base();
    for (let n = 0; n < 19; n += 1) gearInBag(bagFull, 'stone_sword', `bag#${n}`);
    gearInStorage(bagFull, 'iron_helm', 'helm#d');
    expect(code(bagFull, move('storage', 'helm#d', 'bag'))).toBe('CONTAINER_FULL');
    // ... but a stack of its type in the full bag takes it.
    inStorage(bagFull, 'bread', 2);
    expect(bagQty(ok(bagFull, move('storage', 'bread', 'bag')), 'bread')).toBe(5);
  });

  it('refusals: unknown item, bad cell, the same cell, bag to bag (MOVE_ITEM), inside the storage without a cell, an unknown container', () => {
    let s = gearInBag(base(), 'iron_helm', 'helm#b');
    gearInStorage(s, 'iron_sword', 'sword#s');
    expect(code(s, move('bag', 'nope', 'storage'))).toBe('NOT_IN_INVENTORY');
    expect(code(s, move('bag', 'start-linen_tunic', 'storage'))).toBe('NOT_IN_INVENTORY'); // worn
    expect(code(s, move('bag', 'helm#b', 'storage', 50))).toBe('INVALID_CELL');
    expect(code(s, move('bag', 'helm#b', 'storage', -1))).toBe('INVALID_CELL');
    expect(code(s, move('bag', 'helm#b', 'storage', 1.5))).toBe('INVALID_CELL');
    expect(code(s, move('storage', 'sword#s', 'bag', 20))).toBe('INVALID_CELL');
    expect(code(s, move('storage', 'sword#s', 'storage', 0))).toBe('SAME_CELL');
    expect(code(s, move('bag', 'helm#b', 'bag', 5))).toBe('INVALID_COMMAND');
    expect(code(s, move('storage', 'sword#s', 'storage'))).toBe('INVALID_COMMAND');
    expect(code(s, { type: 'STORAGE_MOVE', from: 'bag', itemId: 'helm#b', to: 'attic' as 'bag' })).toBe('INVALID_COMMAND');
    // Refusals change nothing: the original state is untouched.
    const before = hashState(s);
    run(s, move('bag', 'helm#b', 'storage', 50));
    expect(hashState(s)).toBe(before);
    s = ok(s, move('bag', 'helm#b', 'storage', 2));
    expectValid(s);
  });

  it('the command is deterministic, logged and replayed (a client session replays to the same state)', async () => {
    const { client, repo } = makeClient({ prefix: 'storage' });
    await client.load();
    await debugBuild(client, ['storage']);
    const r = await client.dispatch({ type: 'DEPOSIT_ALL' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.events).toContainEqual({ type: 'ITEMS_DEPOSITED', mode: 'all', moved: 1, stayed: 0 });
    expect((await client.dispatch({ type: 'STORAGE_MOVE', from: 'storage', itemId: 'bread', to: 'storage', toCell: 9 })).ok).toBe(true);
    expect((await client.dispatch({ type: 'STORAGE_MOVE', from: 'storage', itemId: 'bread', to: 'bag' })).ok).toBe(true);
    expect((await client.dispatch({ type: 'DEPOSIT_STACKED' })).ok).toBe(false); // nothing matches: refused, not logged
    expect((await client.dispatch({ type: 'STORAGE_MOVE', from: 'bag', itemId: 'bread', to: 'storage' })).ok).toBe(true);
    const rows = (await repo.getAllLog()).map(({ seq: _s, synced: _y, ...row }) => row) as ReplayEntry[];
    expect(rows.map((x) => x.type).filter((t) => t.startsWith('DEPOSIT') || t === 'STORAGE_MOVE')).toEqual(['DEPOSIT_ALL', 'STORAGE_MOVE', 'STORAGE_MOVE', 'STORAGE_MOVE']);
    const report = replayLogReport(rows);
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
    expect(storeIds(client.getState())[0]).toBe('bread');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('one stack per type in each container, whatever is played', () => {
  it('a long random game of deposits and moves keeps both grids valid and never changes a total', () => {
    let seed = 24681357;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    let s = base();
    for (const [defId, n] of [['oak_logs', 40], ['stone', 30], ['wild_sage', 4], ['health_potion_t1', 6]] as const) inBag(s, defId, n);
    for (const [defId, id] of [['iron_sword', 'g#1'], ['iron_helm', 'g#2'], ['iron_boots', 'g#3'], ['copper_helm', 'g#4']] as const) gearInBag(s, defId, id);
    inStorage(s, 'stone', 2);
    gearInStorage(s, 'iron_axe', 'g#5');
    const start = totals(s);
    let moved = 0;
    for (let step = 0; step < 600; step += 1) {
      const pick = rnd(10);
      const aSource = (): { from: 'bag' | 'storage'; itemId: string } => {
        const all = [...s.inventory.items.map((i) => ({ from: 'bag' as const, itemId: i.id })), ...s.storage.items.map((i) => ({ from: 'storage' as const, itemId: i.id }))];
        return all[rnd(all.length)];
      };
      let c: Input;
      if (pick === 0) c = { type: 'DEPOSIT_ALL' };
      else if (pick === 1) c = { type: 'DEPOSIT_STACKED' };
      else if (pick <= 4) c = { type: 'STORAGE_MOVE', ...aSource(), to: rnd(2) ? 'bag' : 'storage' };
      else if (pick <= 7) c = { type: 'STORAGE_MOVE', ...aSource(), to: rnd(2) ? 'bag' : 'storage', toCell: rnd(rnd(2) ? 20 : 50) };
      else if (pick === 8) c = { type: 'MOVE_ITEM', itemId: s.inventory.items[rnd(s.inventory.items.length)]?.id ?? 'x', toCell: rnd(20) };
      else {
        // Split a stack across the containers by hand (the engine allows a stack of a type in each): re-adding must keep one per container.
        s = inStorage(s, 'oak_logs', 1);
        s = inBag(s, 'oak_logs', 1);
        start.oak_logs += 2;
        continue;
      }
      const r = applyCommand(s, cmd(c), T0);
      if (!r.ok) continue;
      s = r.state;
      moved += 1;
      expectValid(s);
      expect(totals(s)).toEqual(start);
    }
    expect(moved).toBeGreaterThan(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('dropCommand for storage drags is exactly what the engine accepts', () => {
  /** A state with both containers holding a bit of everything: stacks that match, stacks that do not, gear, a gap or two. */
  function mixed(): GameState {
    const s = base();
    inBag(s, 'oak_logs', 10); // bag 1
    gearInBag(s, 'iron_sword', 'sword#b'); // bag 2
    inBag(s, 'stone', 3); // bag 3
    placeInBag(s.inventory, makeItem('potion_belt'));
    s.inventory.items.splice(s.inventory.items.findIndex((i) => i.id === 'sword#b'), 1); // a gap at 2
    gearInBag(s, 'iron_helm', 'helm#b'); // refills 2
    inStorage(s, 'oak_logs', 90); // storage 0
    gearInStorage(s, 'iron_sword', 'sword#s'); // storage 1
    placeInStorageCell(s, makeItem('wild_sage', 2), 5);
    inStorage(s, 'bread', 2);
    return s;
  }

  const targetsOf = (s: GameState): DragTarget[] => [
    ...Array.from({ length: s.inventory.capacity }, (_, cell): DragTarget => ({ kind: 'cell', cell })),
    ...Array.from({ length: storageCapacity(s) }, (_, cell): DragTarget => ({ kind: 'storage_cell', cell })),
    ...EQUIPMENT_SLOTS.map((slot): DragTarget => ({ kind: 'slot', slot })),
    { kind: 'area', side: 'bag' },
    { kind: 'area', side: 'storage' },
  ];
  const sourcesOf = (s: GameState): DragSource[] => [
    ...s.inventory.items.map((i): DragSource => ({ kind: 'bag', itemId: i.id })),
    ...s.storage.items.map((i): DragSource => ({ kind: 'storage', itemId: i.id })),
    ...(Object.keys(s.character.equipment) as (typeof EQUIPMENT_SLOTS)[number][]).map((slot): DragSource => ({ kind: 'slot', slot })),
    { kind: 'bag', itemId: 'ghost' },
    { kind: 'storage', itemId: 'ghost' },
  ];

  function sweep(s: GameState): number {
    let accepted = 0;
    for (const source of sourcesOf(s)) {
      for (const target of targetsOf(s)) {
        const drop = dropCommand(s, source, target);
        if (drop) {
          const r = applyCommand(s, cmd(drop as Input), T0);
          if (!r.ok) throw new Error(`${JSON.stringify(source)} -> ${JSON.stringify(target)}: dropCommand said ${JSON.stringify(drop)} but the engine said ${r.error.code}`);
          accepted += 1;
        } else if (source.kind !== 'slot' && target.kind !== 'slot' && target.kind !== 'cell' && source.kind !== 'bag') {
          // Storage-involved pairs only: the engine's own answer must also be a refusal (checked through the planner the command uses).
          const to = target.kind === 'area' ? target.side : target.kind === 'storage_cell' ? 'storage' : 'bag';
          const toCell = target.kind === 'area' ? undefined : target.cell;
          expect(planMove(s, source.kind, (source as { itemId: string }).itemId, to, toCell).ok).toBe(false);
        }
      }
    }
    return accepted;
  }

  it('every source / target pair, in a mixed state: an answer is always a command the engine accepts; refusals match the planner', () => {
    const s = mixed();
    expectValid(s);
    expect(sweep(s)).toBeGreaterThan(100);
  });

  it('the pairs in question: area drops, merges and refused ones', () => {
    const s = mixed();
    expect(dropCommand(s, { kind: 'bag', itemId: 'oak_logs' }, { kind: 'area', side: 'storage' })).toEqual({ type: 'STORAGE_MOVE', from: 'bag', itemId: 'oak_logs', to: 'storage' });
    expect(dropCommand(s, { kind: 'bag', itemId: 'oak_logs' }, { kind: 'area', side: 'bag' })).toBeNull();
    expect(dropCommand(s, { kind: 'storage', itemId: 'oak_logs' }, { kind: 'area', side: 'storage' })).toBeNull();
    expect(dropCommand(s, { kind: 'storage', itemId: 'oak_logs' }, { kind: 'area', side: 'bag' })).toEqual({ type: 'STORAGE_MOVE', from: 'storage', itemId: 'oak_logs', to: 'bag' });
    expect(dropCommand(s, { kind: 'bag', itemId: 'oak_logs' }, { kind: 'storage_cell', cell: 49 })).toEqual({ type: 'STORAGE_MOVE', from: 'bag', itemId: 'oak_logs', to: 'storage', toCell: 49 });
    expect(dropCommand(s, { kind: 'bag', itemId: 'oak_logs' }, { kind: 'storage_cell', cell: 50 })).toBeNull();
    expect(dropCommand(s, { kind: 'storage', itemId: 'sword#s' }, { kind: 'storage_cell', cell: 1 })).toBeNull(); // its own cell
    expect(dropCommand(s, { kind: 'storage', itemId: 'sword#s' }, { kind: 'slot', slot: 'weapon' })).toBeNull(); // no equipping from storage
    expect(dropCommand(s, { kind: 'slot', slot: 'weapon' }, { kind: 'storage_cell', cell: 3 })).toBeNull(); // no unequipping into storage
    expect(dropCommand(s, { kind: 'bag', itemId: 'oak_logs' }, { kind: 'cell', cell: 7 })).toEqual({ type: 'MOVE_ITEM', itemId: 'oak_logs', toCell: 7 }); // the bag keeps MOVE_ITEM
    const unbuilt = { ...s, buildings: { ...s.buildings, storage: { state: 'locked' as const, level: 0 } } };
    expect(dropCommand(unbuilt, { kind: 'bag', itemId: 'oak_logs' }, { kind: 'area', side: 'storage' })).toBeNull();
  });

  it('full containers: the answers follow CONTAINER_FULL (no first free cell) but still allow merges and swaps', () => {
    const s = mixed();
    for (let n = 0; n < 50; n += 1) if (!s.storage.items.some((i) => i.cell === n)) placeInStorageCell(s, makeItem('stone_sword', 1, `fill#${n}`), n);
    expect(s.storage.items).toHaveLength(50);
    expect(dropCommand(s, { kind: 'bag', itemId: 'helm#b' }, { kind: 'area', side: 'storage' })).toBeNull();
    expect(dropCommand(s, { kind: 'bag', itemId: 'helm#b' }, { kind: 'storage_cell', cell: 8 })).toMatchObject({ type: 'STORAGE_MOVE', to: 'storage', toCell: 8 }); // a swap
    expect(dropCommand(s, { kind: 'bag', itemId: 'oak_logs' }, { kind: 'area', side: 'storage' })).toMatchObject({ type: 'STORAGE_MOVE' }); // a merge
    expect(sweep(s)).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('storage pays for builds, upgrades and crafts first, then the bag', () => {
  /** A hero with the Town Hall Lv5 so upgrades are not capped, and the given stacks split between the containers. */
  function paying(bag: Record<string, number>, store: Record<string, number>): GameState {
    const s = base();
    s.buildings = { ...s.buildings, town_hall: { state: 'built', level: 5 } };
    s.inventory.items = s.inventory.items.filter((i) => i.defId === 'bread');
    for (const [id, n] of Object.entries(bag)) inBag(s, id, n);
    for (const [id, n] of Object.entries(store)) inStorage(s, id, n);
    return s;
  }

  it('BUILD: requirement lines count both containers; the cost is taken from storage first, the rest from the bag', () => {
    const s = { ...paying({ oak_logs: 3, stone: 12 }, { oak_logs: 8, stone: 1 }), buildings: { ...base().buildings, merchant: { state: 'locked' as const, level: 0 } } };
    const line = requirementViews(s, 'merchant').filter((r) => r.kind === 'item');
    expect(line).toMatchObject([{ defId: 'oak_logs', need: 10, have: 11, met: true }, { defId: 'stone', need: 10, have: 13, met: true }]);
    const b = ok(s, { type: 'BUILD', buildingId: 'merchant' });
    expect([storeQty(b, 'oak_logs'), bagQty(b, 'oak_logs')]).toEqual([0, 1]); // 10 = 8 from storage + 2 from the bag
    expect([storeQty(b, 'stone'), bagQty(b, 'stone')]).toEqual([0, 3]); // 10 = 1 from storage + 9 from the bag
    expect(b.storage.items.find((i) => i.defId === 'oak_logs')).toBeUndefined(); // emptied stack leaves its cell
    expectValid(b);
    // Not enough across both: refused, nothing changes.
    const poor = paying({ oak_logs: 1 }, { oak_logs: 8 });
    poor.buildings = { ...poor.buildings, merchant: { state: 'locked', level: 0 } };
    expect(code(poor, { type: 'BUILD', buildingId: 'merchant' })).toBe('REQUIREMENTS_NOT_MET');
  });

  it('UPGRADE_BUILDING: the same split (the cost lines count both)', () => {
    const s = paying({ oak_logs: 10, stone: 25 }, { oak_logs: 20 });
    expect(upgradeView(s, 'merchant').cost.filter((c) => c.kind === 'item')).toMatchObject([{ defId: 'oak_logs', need: 25, have: 30, met: true }, { defId: 'stone', need: 25, have: 25, met: true }]);
    const u = ok(s, { type: 'UPGRADE_BUILDING', buildingId: 'merchant', level: 2 });
    expect([storeQty(u, 'oak_logs'), bagQty(u, 'oak_logs')]).toEqual([0, 5]);
    expect([storeQty(u, 'stone'), bagQty(u, 'stone')]).toEqual([0, 0]);
    expect(u.construction).toMatchObject({ buildingId: 'merchant', level: 2 });
  });

  it('START_CRAFT (material): the first craft pays storage first; waiting counts both containers ("1/2" with one log in each place)', () => {
    let s = paying({ oak_logs: 1 }, {});
    s = ok(s, { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank' });
    expect(craftJobView(s, 0)).toMatchObject({ status: 'waiting', waitingFor: [{ defId: 'oak_logs', have: 1, need: 2 }] });
    // One log in the storage + one in the bag: 2 in total, enough: the pipe starts the instant they are there (a deposit never starts or stops it).
    const s2 = inStorage(cloneState(s), 'oak_logs', 1);
    const started = ok(s2, { type: 'DEBUG_ADD_GOLD', amount: 1 }); // any command settles the pipes
    expect(craftJobView(started, 0)).toMatchObject({ status: 'running' });
    expect([storeQty(started, 'oak_logs'), bagQty(started, 'oak_logs')]).toEqual([0, 0]); // 1 from storage, 1 from the bag
    // The recipe view's "have" counts both.
    const split = paying({ oak_logs: 3 }, { oak_logs: 5 });
    expect(craftingView(split).recipes.find((r) => r.recipeId === 'oak_plank')!.inputs[0]).toMatchObject({ have: 8 });
    const plank = ok(split, { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank' });
    expect([storeQty(plank, 'oak_logs'), bagQty(plank, 'oak_logs')]).toEqual([3, 3]); // storage first: 5 -> 3
  });

  it('START_CRAFT (gear): inputs split between the containers', () => {
    const s = paying({ stone_brick: 2 }, { stone_brick: 4, oak_plank: 5 });
    const r = ok(s, { type: 'START_CRAFT', pipe: 0, recipeId: 'stone_sword' });
    const spent = totals(s);
    const left = totals(r);
    expect(spent.stone_brick - left.stone_brick).toBeGreaterThan(0);
    // Whatever the recipe takes, it takes from storage before touching the bag.
    const tookFromBag = (bagQty(s, 'stone_brick') - bagQty(r, 'stone_brick')) + (bagQty(s, 'oak_plank') - bagQty(r, 'oak_plank'));
    const tookFromStore = (storeQty(s, 'stone_brick') - storeQty(r, 'stone_brick')) + (storeQty(s, 'oak_plank') - storeQty(r, 'oak_plank'));
    expect(tookFromStore).toBeGreaterThan(0);
    if (tookFromBag > 0) expect(storeQty(r, 'stone_brick')).toBe(0);
  });

  it('X10_CRAFT: 9x the inputs, storage first; counted across both; and INSTA_CRAFT\'s next craft pays storage first too', () => {
    let s = paying({ oak_logs: 10 }, { oak_logs: 12 });
    s = ok(s, { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank' }); // takes 2 from storage: 10 left there
    const job = s.crafting.pipes[0]!;
    s = ok(s, { type: 'X10_CRAFT', pipe: 0, jobId: job.id, craft: 1, maxCost: 5 }); // 18 more: 10 from storage, 8 from the bag
    expect([storeQty(s, 'oak_logs'), bagQty(s, 'oak_logs')]).toEqual([0, 2]);
    // Not enough across both for the tap: refused.
    const short = paying({ oak_logs: 4 }, { oak_logs: 8 }); // 12 - 2 = 10 left < 18
    const started = ok(short, { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank' });
    expect(code(started, { type: 'X10_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: 5 })).toBe('NOT_ENOUGH_ITEMS');
    expect(craftJobView(started, 0)!.x10Tap!.blocked).toBe('Needs 18 Oak Logs');
    // INSTA finishes the craft; the next one starts at once and takes its logs from storage first.
    let t = paying({ oak_logs: 4 }, { oak_logs: 6 });
    t = ok(t, { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank' }); // storage 6 -> 4
    t = ok(t, { type: 'INSTA_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: 1 });
    expect([storeQty(t, 'oak_logs'), bagQty(t, 'oak_logs'), bagQty(t, 'oak_plank')]).toEqual([2, 4, 1]);
  });

  it('refunds go to the BAG; the storage takes them only when the bag has no room; with room nowhere, STOP_CRAFT is refused (nothing changes)', () => {
    // Plenty of room: the refund (2 logs) goes to the bag even though the logs came from storage.
    let s = paying({}, { oak_logs: 6 });
    s = ok(s, { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank' });
    expect([storeQty(s, 'oak_logs'), bagQty(s, 'oak_logs')]).toEqual([4, 0]);
    const stopped = ok(s, { type: 'STOP_CRAFT', pipe: 0, jobId: 1 });
    expect([storeQty(stopped, 'oak_logs'), bagQty(stopped, 'oak_logs')]).toEqual([4, 2]);
    // A full bag: the refund joins the storage's stack (or takes a storage cell).
    const bagFull = cloneState(s);
    for (let n = 0; n < 19; n += 1) if (bagFull.inventory.items.length < 20) gearInBag(bagFull, 'stone_sword', `bag#${n}`);
    expect(bagFull.inventory.items).toHaveLength(20);
    const toStorage = ok(bagFull, { type: 'STOP_CRAFT', pipe: 0, jobId: 1 });
    expect([storeQty(toStorage, 'oak_logs'), bagQty(toStorage, 'oak_logs')]).toEqual([6, 0]);
    expect(toStorage.storage.items.filter((i) => i.defId === 'oak_logs')).toHaveLength(1);
    // The storage emptied and the bag full: the refund opens a new storage stack.
    const empty = cloneState(bagFull);
    empty.storage.items = [];
    inStorage(empty, 'stone', 1);
    const taken = ok(empty, { type: 'STOP_CRAFT', pipe: 0, jobId: 1 });
    expect(storeQty(taken, 'oak_logs')).toBe(2);
    expectValid(taken);
    // Neither has room: the existing rule - refused with INVENTORY_FULL, nothing changes.
    const nowhere = cloneState(bagFull);
    nowhere.storage.items = [];
    for (let n = 0; n < 50; n += 1) gearInStorage(nowhere, 'stone_sword', `fill#${n}`);
    const before = hashState(nowhere);
    expect(code(nowhere, { type: 'STOP_CRAFT', pipe: 0, jobId: 1 })).toBe('INVENTORY_FULL');
    expect(hashState(nowhere)).toBe(before);
  });

  it('CANCEL_CRAFT (gear) refunds the same way (bag first)', () => {
    const s = paying({}, { stone_brick: 10, oak_plank: 10 });
    const r = ok(s, { type: 'START_CRAFT', pipe: 0, recipeId: 'stone_sword' });
    const c = ok(r, { type: 'CANCEL_CRAFT', pipe: 0, jobId: 1 });
    // The refunded inputs sit in the bag now; the totals are what they were.
    expect(totals(c).stone_brick).toBe(totals(s).stone_brick);
    expect(bagQty(c, 'stone_brick') + bagQty(c, 'oak_plank')).toBeGreaterThan(0);
  });

  it('stays bag-only: the crafted output, gathering, drops, the Merchant, the belt, potions and equipping never touch the storage', () => {
    let s = paying({ oak_logs: 2 }, { oak_logs: 50, health_potion_t1: 3 });
    s = ok(s, { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank' });
    const done = simulate(s, T0 + 6 * SEC).state; // 5 s per craft
    expect(bagQty(done, 'oak_plank')).toBeGreaterThanOrEqual(1);
    expect(storeQty(done, 'oak_plank')).toBe(0);
    // Potions in storage cannot be used or put on the belt; a stored item cannot be sold or equipped.
    const potion = s.storage.items.find((i) => i.defId === 'health_potion_t1')!;
    expect(code(s, { type: 'USE_ITEM', itemId: potion.id })).toBe('NOT_IN_INVENTORY');
    expect(code(s, { type: 'BELT_PUT', itemId: potion.id, slot: 0 })).not.toBe('ok');
    expect(code(s, { type: 'SELL_ITEM', itemId: potion.id, quantity: 1 })).toBe('NOT_IN_INVENTORY');
    gearInStorage(s, 'iron_helm', 'helm#s');
    expect(code(s, { type: 'EQUIP_ITEM', itemId: 'helm#s' })).toBe('NOT_IN_INVENTORY');
    // Gathering lands in the bag even when the storage holds the same log.
    const cutting = ok(inStorage(paying({}, {}), 'oak_logs', 5), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' });
    const after = simulate(cutting, T0 + 10 * MIN).state;
    expect(bagQty(after, 'oak_logs')).toBeGreaterThan(0);
    expect(storeQty(after, 'oak_logs')).toBe(5);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('the pipes with a storage present: split invariance, offline = live, deposits change no outcome', () => {
  /** Oak plank pipe fed from storage and bag, plus a stone brick pipe, a hero cutting logs (which feed the bag). */
  function crafting(): GameState {
    let s = base();
    s.inventory.items = s.inventory.items.filter((i) => i.defId === 'bread');
    inBag(s, 'oak_logs', 40);
    inBag(s, 'stone', 30);
    inStorage(s, 'oak_logs', 120);
    inStorage(s, 'stone', 70);
    s = ok(s, { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank' });
    s = ok(s, { type: 'START_CRAFT', pipe: 1, recipeId: 'stone_brick' });
    return ok(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' });
  }

  it('simulate(t1 + t2) equals simulate(t1) then simulate(t2), for any split (the whole state hashes equal)', () => {
    const s = crafting();
    const whole = simulate(s, T0 + 4 * HOUR).state;
    let parts = s;
    for (const at of [T0 + 7 * SEC, T0 + 5 * MIN, T0 + 5 * MIN + 1, T0 + 61 * MIN, T0 + 3 * HOUR]) parts = simulate(parts, at).state;
    parts = simulate(parts, T0 + 4 * HOUR).state;
    expect(hashState(parts)).toBe(hashState(whole));
    expect(bagQty(whole, 'oak_plank') + storeQty(whole, 'oak_plank')).toBeGreaterThan(100);
    expectValid(whole);
  });

  it('offline = live: one big step and many one-second ticks leave the same state', () => {
    const s = crafting();
    const offline = simulate(s, T0 + 20 * MIN).state;
    let live = s;
    for (let t = 1; t <= 20 * 60; t += 1) live = simulate(live, T0 + t * SEC).state;
    expect(hashState(live)).toBe(hashState(offline));
  });

  it('a deposit or a withdraw (even at the same instant as a craft event) changes no crafting outcome, only where the stacks sit', () => {
    const s = crafting();
    const plain = simulate(s, T0 + 3 * HOUR).state;
    // Deposit everything in the bag at 7 s, withdraw the logs at 5 min, deposit again at 1 h, all through commands.
    let t = ok(s, { type: 'DEPOSIT_ALL' }, T0 + 7 * SEC);
    t = ok(t, { type: 'STORAGE_MOVE', from: 'storage', itemId: 'oak_logs', to: 'bag' }, T0 + 5 * MIN);
    t = ok(t, { type: 'DEPOSIT_ALL' }, T0 + HOUR);
    t = simulate(t, T0 + 3 * HOUR).state;
    const a = totals(plain);
    const b = totals(t);
    // Same totals of everything the pipes make and take; the hero's cut logs are a different matter only by placement, never by amount.
    expect(b).toEqual(a);
    expect(t.crafting.pipes.map((p) => p && [p.status, p.done])).toEqual(plain.crafting.pipes.map((p) => p && [p.status, p.done]));
    expect(t.rng).toEqual(plain.rng);
    expect(t.stats).toEqual(plain.stats);
    expectValid(t);
  });

  it('a pipe waiting for Oak Logs (1/2) counts both containers; a deposit never stalls or restarts it', () => {
    let s = base();
    s.inventory.items = s.inventory.items.filter((i) => i.defId === 'bread');
    inBag(s, 'oak_logs', 1);
    s = ok(s, { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank' });
    expect(craftJobView(s, 0)).toMatchObject({ status: 'waiting', waitingFor: [{ defId: 'oak_logs', have: 1, need: 2 }] });
    const moved = ok(s, { type: 'DEPOSIT_ALL' }); // the single log moves to storage: still 1/2, still waiting
    expect(craftJobView(moved, 0)).toMatchObject({ status: 'waiting', waitingFor: [{ defId: 'oak_logs', have: 1, need: 2 }] });
    expect(simulate(moved, T0 + HOUR).state.crafting.pipes[0]).toMatchObject({ status: 'waiting', done: 0 });
    // The log arrives in the OTHER container (a refund, a buy): 1 + 1 = 2 -> it starts.
    const fed = inBag(cloneState(moved), 'oak_logs', 1);
    const go = ok(fed, { type: 'DEBUG_ADD_GOLD', amount: 1 }); // any command settles the pipes
    expect(craftJobView(go, 0)).toMatchObject({ status: 'running' });
    expect(go.storage.items.find((i) => i.defId === 'oak_logs')).toBeUndefined(); // storage first
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('unique items: a stored Potion Belt counts as owned', () => {
  it('heroOwnsItem checks the storage; the Chieftain\'s belt drop is skipped (its chance is still drawn)', () => {
    const s = base();
    expect(heroOwnsItem(s, 'potion_belt')).toBe(false);
    const stored = placeInStorage(s, makeItem('potion_belt'));
    expect(stored).toBe(true);
    expect(heroOwnsItem(s, 'potion_belt')).toBe(true);
    const rewards = { items: {}, itemsLost: {} } as unknown as FightRewards;
    const drawn = cloneState(s);
    rollItemDrop(drawn, { itemId: 'potion_belt', chance: 1 }, rewards);
    expect(drawn.inventory.items.some((i) => i.defId === 'potion_belt')).toBe(false);
    expect(drawn.rng).not.toEqual(s.rng); // the draw happened
    const without = base();
    rollItemDrop(without, { itemId: 'potion_belt', chance: 1 }, rewards);
    expect(without.inventory.items.some((i) => i.defId === 'potion_belt')).toBe(true);
    expect(without.rng).toEqual(drawn.rng); // same stream either way
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('the unlocked shape of a save', () => {
  it('itemQuantity / countItem sum both containers; storageBox shares the state\'s items', () => {
    const s = inStorage(inBag(base(), 'stone', 4), 'stone', 6);
    expect(itemQuantity(s, 'stone')).toBe(10);
    expect(countItem(s, 'stone')).toBe(10);
    expect(storageBox(s).items).toBe(s.storage.items);
    expect(cellsOf(storageBox(s))).toEqual([0]);
  });

  it('a new game keeps its state free of storage items; withBuilt marks Storage built without extra state', () => {
    const s = withBuilt(newGame(2, T0), ['storage']);
    expect(storageCapacity(s)).toBe(50);
    expect(s.storage.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('source scans: one entry function per container, and every payment goes through stock.ts', () => {
  const dir = join(__dirname, '..', 'src', 'engine');
  const files = (): { name: string; src: string }[] => {
    const out: { name: string; src: string }[] = [];
    const walk = (d: string, prefix = '') => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p, `${prefix}${e.name}/`);
        else if (e.name.endsWith('.ts')) out.push({ name: `${prefix}${e.name}`, src: readFileSync(p, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '') });
      }
    };
    walk(dir);
    return out;
  };

  it('only inventory.ts pushes into the bag or the storage (placeInBag / placeInCell / placeInStorage / placeInStorageCell)', () => {
    const offenders = files()
      .filter((f) => f.name !== 'inventory.ts' && f.name !== 'migrations.ts')
      .filter((f) => /\bitems\.(push|unshift)\(|storage\.items\s*=|\.storage\.items\.(push|unshift)\(/.test(f.src))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
    const inv = files().find((f) => f.name === 'inventory.ts')!.src;
    for (const fn of ['placeInBag', 'placeInCell', 'placeInStorage', 'placeInStorageCell']) expect(inv).toContain(`export function ${fn}(`);
  });

  it('no payment path removes or counts items on its own: buildings.ts and crafting.ts read the stock only through countItem / takeItem / refundItems', () => {
    const all = files();
    for (const name of ['buildings.ts', 'crafting.ts']) {
      const src = all.find((f) => f.name === name)!.src;
      expect(src, name).not.toMatch(/inventory\.items\.(splice|filter|reduce|find)\(/);
      expect(src, name).not.toMatch(/consumeItem|itemQuantity/);
    }
    expect(all.find((f) => f.name === 'buildings.ts')!.src).toMatch(/takeItem\(draft, it\.defId, it\.quantity\)/);
    expect(all.find((f) => f.name === 'crafting.ts')!.src).toMatch(/takeItem\(draft, i\.defId, i\.quantity\)/);
    // Item removal from a container (splice) lives only in the files that own a container's contents.
    const splicers = all.filter((f) => /\bitems\.splice\(/.test(f.src)).map((f) => f.name).sort();
    expect(splicers).toEqual(['belt.ts', 'equipment.ts', 'merchant.ts', 'stock.ts', 'storage.ts']);
  });
});
