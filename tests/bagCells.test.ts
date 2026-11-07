// The bag is a grid with gaps (engine 1.28.0, save v25; owner decisions 2026-11-07): every inventory item sits in its own cell, a new item
// takes the first empty cell, a stackable joins its stack, selling / using up leaves a gap, MOVE_ITEM moves or swaps, equipping hands the
// bag cell to the piece it replaces, UNEQUIP_ITEM can aim at a cell, SWAP_RINGS trades the ring slots. The UI's drag sends exactly these
// commands.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import {
  applyCommand,
  bagCells,
  type EquipmentSlot,
  firstEmptyCell,
  freeSlots,
  type GameState,
  hashState,
  ITEMS,
  itemInCell,
  newGame,
  replayLogReport,
  type ReplayEntry,
  simulate,
} from '../src/engine';
import { cloneState } from '../src/engine/clone';
import { rollGearDrop, rollItemDrop } from '../src/engine/drops';
import { addStackable, cellsOf, makeItem, placeInBag, settleCells } from '../src/engine/inventory';
import type { FightRewards } from '../src/engine/types';
import { asV24, builtGame, cmd, HOUR, makeClient, MIN, SEC, T0 } from './helpers';

type Input = Parameters<typeof cmd>[0];

const ok = (s: GameState, c: Input, at = T0): GameState => {
  const r = applyCommand(s, cmd(c), at);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
};
const code = (s: GameState, c: Input, at = T0): string => {
  const r = applyCommand(s, cmd(c), at);
  return r.ok ? 'ok' : r.error.code;
};

/** The grid as ids (null = empty cell). */
const grid = (s: GameState): (string | null)[] => bagCells(s.inventory).map((i) => i?.id ?? null);
const cellOf = (s: GameState, id: string): number | undefined => s.inventory.items.find((i) => i.id === id)?.cell;
const ids = (s: GameState): string[] => s.inventory.items.map((i) => i.id);

/** The bag invariant: every item in its own integer cell of 0..capacity-1, the worn pieces carry none, no id twice. */
function expectBagValid(s: GameState): void {
  const { items, capacity } = s.inventory;
  const cells = items.map((i) => i.cell);
  for (const c of cells) {
    expect(Number.isInteger(c)).toBe(true);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThan(capacity);
  }
  expect(new Set(cells).size).toBe(cells.length);
  for (const worn of Object.values(s.character.equipment)) expect(worn!.cell).toBeUndefined();
  const all = [...items.map((i) => i.id), ...Object.values(s.character.equipment).map((i) => i!.id)];
  expect(new Set(all).size).toBe(all.length);
}

/** A built game with a rich hero and a bag: bread 0, Iron Sword 1, Iron Helm 2, Copper Helm 3, Iron Axe 4, Health Potion x5 at 5. */
function bag(): GameState {
  const s = cloneState(builtGame(1, T0));
  s.character.gold = 100_000;
  for (const [defId, id] of [['iron_sword', 'iron_sword#a'], ['iron_helm', 'iron_helm#a'], ['copper_helm', 'copper_helm#a'], ['iron_axe', 'iron_axe#a']] as const) {
    placeInBag(s.inventory, makeItem(defId, 1, id, { quality: 50, rarity: 'common' }));
  }
  addStackable(s.inventory, 'health_potion_t1', 5);
  return s;
}

const BAG_IDS = ['bread', 'iron_sword#a', 'iron_helm#a', 'copper_helm#a', 'iron_axe#a', 'health_potion_t1'];
const EMPTY = null;

describe('the layout', () => {
  it('a new game: the starting bread in cell 0, the other 19 cells empty', () => {
    const s = newGame(1, T0);
    expect(s.saveVersion).toBe(25);
    expect(grid(s)).toEqual(['bread', ...Array(19).fill(EMPTY)]);
    expectBagValid(s);
  });

  it('the grid is cell-ordered whatever the list order is; items.length is the used count', () => {
    const s = bag();
    expect(grid(s).slice(0, 7)).toEqual([...BAG_IDS, EMPTY]);
    const shuffled = { ...s, inventory: { ...s.inventory, items: [...s.inventory.items].reverse() } };
    expect(grid(shuffled)).toEqual(grid(s));
    expect(itemInCell(s.inventory, 2)?.id).toBe('iron_helm#a');
    expect(itemInCell(s.inventory, 9)).toBeUndefined();
    expect(itemInCell(s.inventory, 99)).toBeUndefined();
    expect(freeSlots(s.inventory)).toBe(14);
  });

  it('a bag the engine did not build (no cells, duplicates, out of range) lays out in list order and loses nothing; settle writes it', () => {
    const inv = {
      capacity: 6,
      items: [
        { ...makeItem('bread', 1, 'a'), cell: 3 },
        makeItem('iron_helm', 1, 'b'), // no cell
        { ...makeItem('iron_sword', 1, 'c'), cell: 3 }, // duplicate of a
        { ...makeItem('iron_axe', 1, 'd'), cell: 99 }, // out of range
        { ...makeItem('copper_helm', 1, 'e'), cell: 1.5 }, // not an integer
      ],
    };
    expect(cellsOf(inv)).toEqual([3, 0, 1, 2, 4]);
    expect(bagCells(inv).map((i) => i?.id ?? null)).toEqual(['b', 'c', 'd', 'a', 'e', null]);
    const copy = cloneState(inv);
    settleCells(copy);
    expect(copy.items.map((i) => i.cell)).toEqual([3, 0, 1, 2, 4]);
    settleCells(copy); // idempotent
    expect(copy.items.map((i) => i.cell)).toEqual([3, 0, 1, 2, 4]);
    // More items than cells: the extra one has no cell and is not shown, but is still in the list.
    const over = { capacity: 2, items: [makeItem('bread', 1, 'a'), makeItem('iron_helm', 1, 'b'), makeItem('iron_sword', 1, 'c')] };
    expect(cellsOf(over)).toEqual([0, 1, undefined]);
    expect(bagCells(over).map((i) => i?.id)).toEqual(['a', 'b']);
  });

  it('firstEmptyCell: the lowest gap; -1 when full', () => {
    const s = bag();
    expect(firstEmptyCell(s.inventory)).toBe(6);
    const gap = ok(s, { type: 'MOVE_ITEM', itemId: 'iron_helm#a', toCell: 10 });
    expect(firstEmptyCell(gap.inventory)).toBe(2);
    const full = cloneState(s);
    while (placeInBag(full.inventory, makeItem('bread', 1, `junk${full.inventory.items.length}`))) {
      /* fill */
    }
    expect(full.inventory.items).toHaveLength(20);
    expect(firstEmptyCell(full.inventory)).toBe(-1);
    expect(placeInBag(full.inventory, makeItem('bread', 1, 'one-more'))).toBe(false);
    expect(full.inventory.items).toHaveLength(20);
  });
});

describe('MOVE_ITEM', () => {
  it('to an empty cell: the item moves and leaves a gap; nothing else changes (not even the list order)', () => {
    const s = bag();
    const m = ok(s, { type: 'MOVE_ITEM', itemId: 'iron_helm#a', toCell: 12 });
    expect(grid(m)[2]).toBeNull();
    expect(grid(m)[12]).toBe('iron_helm#a');
    expect(ids(m)).toEqual(ids(s));
    expect(hashState(asV24(m))).toBe(hashState(asV24(s)));
    expectBagValid(m);
  });

  it('to a filled cell: the two swap cells', () => {
    const s = bag();
    const m = ok(s, { type: 'MOVE_ITEM', itemId: 'iron_helm#a', toCell: 4 });
    expect(grid(m).slice(0, 6)).toEqual(['bread', 'iron_sword#a', 'iron_axe#a', 'copper_helm#a', 'iron_helm#a', 'health_potion_t1']);
    expect(ids(m)).toEqual(ids(s));
    expect(hashState(asV24(m))).toBe(hashState(asV24(s)));
    // Stacks swap like anything else (no merging, no splitting).
    const p = ok(s, { type: 'MOVE_ITEM', itemId: 'health_potion_t1', toCell: 0 });
    expect(grid(p).slice(0, 2)).toEqual(['health_potion_t1', 'iron_sword#a']);
    expect(grid(p)[5]).toBe('bread');
    expect(p.inventory.items.find((i) => i.id === 'health_potion_t1')!.quantity).toBe(5);
  });

  it('the last cell and cell 0 are cells like any other', () => {
    const s = bag();
    expect(grid(ok(s, { type: 'MOVE_ITEM', itemId: 'bread', toCell: 19 }))[19]).toBe('bread');
    expect(grid(ok(s, { type: 'MOVE_ITEM', itemId: 'iron_axe#a', toCell: 0 }))[0]).toBe('iron_axe#a');
  });

  it('refusals change nothing: unknown item, a worn item, bad cells, the same cell', () => {
    const s = bag();
    expect(code(s, { type: 'MOVE_ITEM', itemId: 'nope', toCell: 3 })).toBe('NOT_IN_INVENTORY');
    expect(code(s, { type: 'MOVE_ITEM', itemId: 'start-rusty_gladius', toCell: 3 })).toBe('NOT_IN_INVENTORY'); // worn
    for (const bad of [-1, 20, 1.5, Number.NaN, Infinity, '3', null, undefined]) {
      expect(code(s, { type: 'MOVE_ITEM', itemId: 'bread', toCell: bad as never })).toBe('INVALID_CELL');
    }
    expect(code(s, { type: 'MOVE_ITEM', itemId: 'bread', toCell: 0 })).toBe('SAME_CELL');
    expect(code(s, { type: 'MOVE_ITEM', itemId: 5 as never, toCell: 0 })).toBe('NOT_IN_INVENTORY');
  });

  it('works on a full bag (swap) and on a bag that was never laid out (cell-less items are placed first)', () => {
    const full = cloneState(bag());
    while (placeInBag(full.inventory, makeItem('bread', 1, `junk${full.inventory.items.length}`))) {
      /* fill */
    }
    const m = ok(full, { type: 'MOVE_ITEM', itemId: 'bread', toCell: 7 });
    expect(grid(m)[0]).toBe(grid(full)[7]);
    expect(grid(m)[7]).toBe('bread');
    expectBagValid(m);
    const raw = cloneState(bag());
    for (const i of raw.inventory.items) delete i.cell;
    const r = ok(raw, { type: 'MOVE_ITEM', itemId: 'iron_helm#a', toCell: 15 });
    expect(grid(r).slice(0, 6)).toEqual(['bread', 'iron_sword#a', EMPTY, 'copper_helm#a', 'iron_axe#a', 'health_potion_t1']);
    expect(grid(r)[15]).toBe('iron_helm#a');
    expectBagValid(r);
  });
});

describe('new items take the first empty cell; a stackable joins its stack', () => {
  const gapped = () => ok(ok(bag(), { type: 'MOVE_ITEM', itemId: 'iron_helm#a', toCell: 9 }), { type: 'MOVE_ITEM', itemId: 'bread', toCell: 8 }); // gaps at 0 and 2

  it('addStackable: an existing stack grows in place; a new stack fills the lowest gap; a full bag loses the item', () => {
    const s = gapped();
    const joined = cloneState(s);
    expect(addStackable(joined.inventory, 'health_potion_t1', 3)).toEqual({ added: 3, lost: 0 });
    expect(grid(joined)).toEqual(grid(s));
    expect(joined.inventory.items.find((i) => i.id === 'health_potion_t1')!.quantity).toBe(8);
    const fresh = cloneState(s);
    addStackable(fresh.inventory, 'wild_sage', 2);
    expect(cellOf(fresh, 'wild_sage')).toBe(0);
    addStackable(fresh.inventory, 'oak_logs', 2);
    expect(cellOf(fresh, 'oak_logs')).toBe(2);
    const full = cloneState(s);
    while (placeInBag(full.inventory, makeItem('bread', 1, `junk${full.inventory.items.length}`))) {
      /* fill */
    }
    expect(addStackable(full.inventory, 'wild_sage', 1)).toEqual({ added: 0, lost: 1 });
    expect(addStackable(full.inventory, 'health_potion_t1', 1)).toEqual({ added: 1, lost: 0 }); // a stack that exists still takes more
  });

  it('gathering: the first Bird Nest of a cut lands in the first gap, the logs join their stack (split-invariant, with gaps)', () => {
    let s = gapped();
    s = ok(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' });
    const whole = simulate(s, T0 + 3 * HOUR).state;
    const split = simulate(simulate(s, T0 + 47 * MIN + 13 * SEC).state, T0 + 3 * HOUR).state;
    expect(hashState(split)).toBe(hashState(whole));
    expect(cellOf(whole, 'oak_logs')).toBe(0);
    expect(whole.inventory.items.filter((i) => i.defId === 'oak_logs')).toHaveLength(1);
    expectBagValid(whole);
    // Without the gaps the same cut produced the same list; the cells are the only difference (asV24 strips them).
    expect(whole.inventory.items.map((i) => [i.id, i.quantity ?? 1])).toEqual(simulate(ok(bag(), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }), T0 + 3 * HOUR).state.inventory.items.map((i) => [i.id, i.quantity ?? 1]));
  });

  it('mob drops: a gear piece (rollGearDrop, which every stage kill, pack mob and boss uses) and a unique item (rollItemDrop) fill the lowest gap, in draw order', () => {
    const s = cloneState(gapped());
    const rewards = (): FightRewards => ({ heroXp: 0, gold: 0, items: {}, itemsLost: {} });
    const r = rewards();
    const drop = { chance: 1, pieces: [{ itemId: 'copper_sword', weight: 1 }], quality: { min: 10, max: 10 } } as never;
    const first = rollGearDrop(s, drop, [{ value: 'common', weight: 1 }], r);
    expect(first).not.toBeNull();
    expect(cellOf(s, first!.itemId)).toBe(0);
    const second = rollGearDrop(s, drop, [{ value: 'common', weight: 1 }], r);
    expect(cellOf(s, second!.itemId)).toBe(2);
    rollItemDrop(s, { itemId: 'potion_belt', chance: 1 }, r);
    expect(cellOf(s, 'potion_belt')).toBe(grid(s).indexOf('potion_belt'));
    expect(firstEmptyCell(s.inventory)).toBe(grid(s).indexOf(null));
    expect(r.items).toMatchObject({ copper_sword: 2, potion_belt: 1 });
    rollItemDrop(s, { itemId: 'wild_sage', chance: 1 }, r);
    rollItemDrop(s, { itemId: 'wild_sage', chance: 1 }, r);
    expect(s.inventory.items.filter((i) => i.defId === 'wild_sage')).toHaveLength(1); // the herb joins its stack
    expectBagValid(s);
    // A full bag loses the drop and changes nothing.
    const full = cloneState(s);
    while (placeInBag(full.inventory, makeItem('bread', 1, `junk${full.inventory.items.length}`))) {
      /* fill */
    }
    const lost = rewards();
    expect(rollGearDrop(full, drop, [{ value: 'common', weight: 1 }], lost)).toBeNull();
    expect(lost.itemsLost).toEqual({ copper_sword: 1 });
    expect(full.inventory.items).toHaveLength(20);
  });

  it('a real dungeon run (Troll Bridge, gear and herb drops) keeps the bag valid and fills gaps first', () => {
    let s = cloneState(builtGame(7, T0));
    const tb = (wins: number) => ({ runs: wins, wins, losses: 0 });
    s.dungeon.byDungeon = { rat_cellar: tb(10), bat_cave: tb(15), wolf_den: tb(25), forgotten_crypt: tb(40), troll_bridge: tb(50) };
    s.character.spentPoints = { ...s.character.spentPoints, strength: 5000 };
    s.character.hp = 1_000_000;
    for (const [defId, id] of [['iron_sword', 'iron_sword#a'], ['iron_helm', 'iron_helm#a']] as const) placeInBag(s.inventory, makeItem(defId, 1, id, { quality: 50, rarity: 'common' }));
    s = ok(s, { type: 'MOVE_ITEM', itemId: 'iron_sword#a', toCell: 6 }); // gaps at 1 and 3..5
    s = ok(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'troll_bridge' });
    const after = simulate(s, T0 + 90 * MIN).state;
    expectBagValid(after);
    const gear = after.inventory.items.filter((i) => i.defId.startsWith('copper_'));
    expect(gear.length).toBeGreaterThan(0);
    // Everything that arrived sits in the cells the first-empty rule gives in arrival (list) order.
    const replay = cloneState(s);
    for (const i of after.inventory.items.filter((x) => !s.inventory.items.some((o) => o.id === x.id))) {
      const expected = firstEmptyCell(replay.inventory);
      expect(i.cell).toBe(expected);
      placeInBag(replay.inventory, { ...i });
    }
  });
});

describe('selling, using and belts leave gaps; the gaps fill first', () => {
  it('SELL_ITEM leaves a gap (a part of a stack leaves the cell as it is)', () => {
    const s = bag();
    const sold = ok(s, { type: 'SELL_ITEM', itemId: 'iron_helm#a', quantity: 1 });
    expect(grid(sold)[2]).toBeNull();
    expect(grid(sold)[3]).toBe('copper_helm#a');
    expect(firstEmptyCell(sold.inventory)).toBe(2);
    const part = ok(s, { type: 'SELL_ITEM', itemId: 'health_potion_t1', quantity: 2 });
    expect(grid(part)).toEqual(grid(s));
    const all = ok(s, { type: 'SELL_ITEM', itemId: 'health_potion_t1', quantity: 5 });
    expect(grid(all)[5]).toBeNull();
  });

  it('USE_ITEM on the last potion leaves a gap, and the next arrival takes it', () => {
    let s = bag();
    s = ok(s, { type: 'SELL_ITEM', itemId: 'health_potion_t1', quantity: 4 });
    s.character.hp = 10;
    const used = ok(s, { type: 'USE_ITEM', itemId: 'health_potion_t1' });
    expect(grid(used)[5]).toBeNull();
    const again = cloneState(used);
    addStackable(again.inventory, 'wild_sage', 1);
    expect(cellOf(again, 'wild_sage')).toBe(5);
  });

  it('BUY_ITEM: gear goes to the first empty cell, a potion stack joins its stack, a new stack takes the first gap', () => {
    let s = ok(bag(), { type: 'SELL_ITEM', itemId: 'iron_helm#a', quantity: 1 }); // gap at 2
    const stock = (defId: string) => s.merchant.stock.findIndex((l) => l?.defId === defId);
    const buy = (defId: string, quantity: number) => {
      const slot = stock(defId);
      const l = s.merchant.stock[slot]!;
      return ok(s, { type: 'BUY_ITEM', slot, defId, quantity, maxUnitPrice: l.unitPrice });
    };
    const gear = buy('iron_axe', 1);
    expect(gear.inventory.items.at(-1)!.cell).toBe(2);
    const potions = buy('health_potion_t1', 3);
    expect(grid(potions)).toEqual(grid(s));
    expect(potions.inventory.items.find((i) => i.id === 'health_potion_t1')!.quantity).toBe(8);
    s = ok(s, { type: 'SELL_ITEM', itemId: 'health_potion_t1', quantity: 5 }); // gaps at 2 and 5
    const fresh = buy('health_potion_t1', 2);
    expect(cellOf(fresh, 'health_potion_t1')).toBe(2);
    expectBagValid(fresh);
  });

  it('BELT_TAKE: potions back into a new stack take the first empty cell; into an existing stack they join it', () => {
    let s = bag();
    placeInBag(s.inventory, makeItem('potion_belt'));
    s = ok(s, { type: 'EQUIP_ITEM', itemId: 'potion_belt' });
    expect(cellOf(s, 'potion_belt')).toBeUndefined();
    s = ok(s, { type: 'BELT_PUT', itemId: 'health_potion_t1', slot: 0 }); // the whole stack goes in: a gap at 5
    expect(grid(s)[5]).toBeNull();
    s = ok(s, { type: 'MOVE_ITEM', itemId: 'bread', toCell: 9 }); // a second gap, at 0
    const back = ok(s, { type: 'BELT_TAKE', slot: 0 });
    expect(cellOf(back, 'health_potion_t1')).toBe(0);
    expect(back.inventory.items.find((i) => i.id === 'health_potion_t1')!.quantity).toBe(5);
    const withStack = cloneState(s);
    addStackable(withStack.inventory, 'health_potion_t1', 2);
    const cell = cellOf(withStack, 'health_potion_t1');
    const joined = ok(withStack, { type: 'BELT_TAKE', slot: 0 });
    expect(cellOf(joined, 'health_potion_t1')).toBe(cell);
    expect(joined.inventory.items.find((i) => i.id === 'health_potion_t1')!.quantity).toBe(7);
  });
});

describe('crafting delivers into the first empty cell', () => {
  const crafter = () => {
    const s = cloneState(bag());
    addStackable(s.inventory, 'oak_logs', 50);
    addStackable(s.inventory, 'stone_brick', 10);
    addStackable(s.inventory, 'oak_plank', 10);
    return ok(ok(s, { type: 'MOVE_ITEM', itemId: 'iron_helm#a', toCell: 14 }), { type: 'MOVE_ITEM', itemId: 'oak_logs', toCell: 12 }); // gaps at 2 and 5..
  };

  it('a gear piece (COLLECT_CRAFT) takes the first gap; a material craft joins its stack or opens one in the first gap; Stop refunds the same way', () => {
    let s = crafter();
    const gap = firstEmptyCell(s.inventory);
    expect(gap).toBe(2);
    s = ok(s, { type: 'START_CRAFT', pipe: 0, recipeId: 'stone_sword', maxCost: 20, stamina: 20 });
    const done = simulate(s, T0 + 8 * HOUR).state;
    expect(done.crafting.pipes[0]!.status).toBe('ready');
    const collected = ok(done, { type: 'COLLECT_CRAFT', pipe: 0, jobId: done.crafting.pipes[0]!.id }, T0 + 8 * HOUR);
    const piece = collected.inventory.items.find((i) => i.defId === 'stone_sword')!;
    expect(piece.cell).toBe(gap);
    expectBagValid(collected);
    // A material pipe: planks join the existing stack of planks (no new cell) ...
    let m = ok(crafter(), { type: 'START_CRAFT', pipe: 1, recipeId: 'oak_plank', maxCost: 0, stamina: 0 });
    const planks = m.inventory.items.find((i) => i.defId === 'oak_plank')!.cell;
    m = simulate(m, T0 + 2 * HOUR).state;
    expect(m.inventory.items.filter((i) => i.defId === 'oak_plank')).toHaveLength(1);
    expect(m.inventory.items.find((i) => i.defId === 'oak_plank')!.cell).toBe(planks);
    expect(m.inventory.items.find((i) => i.defId === 'oak_plank')!.quantity).toBeGreaterThan(10);
    // ... and with no plank stack, the first output opens one in the first gap.
    const bare = crafter();
    bare.inventory.items = bare.inventory.items.filter((i) => i.defId !== 'oak_plank');
    const cooked = simulate(ok(bare, { type: 'START_CRAFT', pipe: 1, recipeId: 'oak_plank', maxCost: 0, stamina: 0 }), T0 + 2 * HOUR).state;
    expect(cooked.inventory.items.find((i) => i.defId === 'oak_plank')!.cell).toBe(firstEmptyCell(bare.inventory));
    expectBagValid(cooked);
    // Stop gives back the inputs of the craft in progress as a stack in the first gap when there is none.
    const running = ok(bare, { type: 'START_CRAFT', pipe: 1, recipeId: 'oak_plank', maxCost: 0, stamina: 0 });
    const stopped = ok(ok(running, { type: 'MOVE_ITEM', itemId: 'oak_logs', toCell: 19 }), { type: 'STOP_CRAFT', pipe: 1, jobId: running.crafting.pipes[1]!.id });
    expectBagValid(stopped);
  });
});

describe('EQUIP_ITEM (drag a bag item onto a slot)', () => {
  it('into an empty slot: the cell it leaves is a gap', () => {
    const s = bag();
    const e = ok(s, { type: 'EQUIP_ITEM', itemId: 'iron_helm#a' });
    expect(e.character.equipment.helmet!.id).toBe('iron_helm#a');
    expect(e.character.equipment.helmet!.cell).toBeUndefined();
    expect(grid(e)[2]).toBeNull();
    expectBagValid(e);
  });

  it('onto a filled slot: the old piece takes the cell the new one came from (not the first empty cell)', () => {
    const s = bag();
    const e = ok(s, { type: 'EQUIP_ITEM', itemId: 'iron_axe#a' });
    expect(e.character.equipment.axe!.id).toBe('iron_axe#a');
    expect(grid(e)[4]).toBe('start-wooden_axe');
    expect(grid(e).slice(0, 6)).toEqual(['bread', 'iron_sword#a', 'iron_helm#a', 'copper_helm#a', 'start-wooden_axe', 'health_potion_t1']);
    expectBagValid(e);
    // Far from the front, with a gap before it: still its cell.
    const far = ok(s, { type: 'MOVE_ITEM', itemId: 'iron_sword#a', toCell: 17 });
    const sw = ok(far, { type: 'EQUIP_ITEM', itemId: 'iron_sword#a' });
    expect(grid(sw)[17]).toBe('start-rusty_gladius');
    expectBagValid(sw);
  });

  it('works with a full bag', () => {
    const full = cloneState(bag());
    while (placeInBag(full.inventory, makeItem('bread', 1, `junk${full.inventory.items.length}`))) {
      /* fill */
    }
    const e = ok(full, { type: 'EQUIP_ITEM', itemId: 'iron_axe#a' });
    expect(grid(e)[4]).toBe('start-wooden_axe');
    expectBagValid(e);
  });

  it('a slot that does not fit the item is WRONG_SLOT, nothing changes; the same slot is fine', () => {
    const s = bag();
    expect(code(s, { type: 'EQUIP_ITEM', itemId: 'iron_helm#a', slot: 'weapon' })).toBe('WRONG_SLOT');
    expect(code(s, { type: 'EQUIP_ITEM', itemId: 'iron_helm#a', slot: 'ring1' })).toBe('WRONG_SLOT');
    expect(code(s, { type: 'EQUIP_ITEM', itemId: 'iron_helm#a', slot: 'tail' as never })).toBe('UNKNOWN_SLOT');
    expect(code(s, { type: 'EQUIP_ITEM', itemId: 'bread', slot: 'helmet' })).toBe('NOT_EQUIPPABLE');
    expect(ok(s, { type: 'EQUIP_ITEM', itemId: 'iron_helm#a', slot: 'helmet' }).character.equipment.helmet!.id).toBe('iron_helm#a');
  });
});

describe('UNEQUIP_ITEM (drag a worn piece onto a bag cell)', () => {
  const worn = () => ok(bag(), { type: 'EQUIP_ITEM', itemId: 'iron_helm#a' }); // helmet worn, gap at 2

  it('without a target: the first empty cell (a gap before the end of the list counts)', () => {
    const u = ok(worn(), { type: 'UNEQUIP_ITEM', slot: 'helmet' });
    expect(cellOf(u, 'iron_helm#a')).toBe(2);
    expect(u.character.equipment.helmet).toBeUndefined();
    expectBagValid(u);
    const full = cloneState(bag());
    while (placeInBag(full.inventory, makeItem('bread', 1, `junk${full.inventory.items.length}`))) {
      /* fill */
    }
    expect(code(ok(full, { type: 'EQUIP_ITEM', itemId: 'iron_helm#a' }), { type: 'UNEQUIP_ITEM', slot: 'axe' })).toBe('ok'); // that one frees a cell
    expect(code(full, { type: 'UNEQUIP_ITEM', slot: 'axe' })).toBe('INVENTORY_FULL');
  });

  it('onto an empty cell: it goes exactly there', () => {
    const u = ok(worn(), { type: 'UNEQUIP_ITEM', slot: 'helmet', toCell: 13 });
    expect(grid(u)[13]).toBe('iron_helm#a');
    expect(grid(u)[2]).toBeNull();
    expect(u.character.equipment.helmet).toBeUndefined();
    expectBagValid(u);
  });

  it('onto a cell that holds a piece that fits the slot: that piece is worn and the unequipped one takes its cell', () => {
    const s = ok(bag(), { type: 'EQUIP_ITEM', itemId: 'iron_helm#a' });
    const u = ok(s, { type: 'UNEQUIP_ITEM', slot: 'helmet', toCell: 3 }); // Copper Helm is in cell 3
    expect(u.character.equipment.helmet!.id).toBe('copper_helm#a');
    expect(u.character.equipment.helmet!.cell).toBeUndefined();
    expect(grid(u)[3]).toBe('iron_helm#a');
    expect(grid(u)[2]).toBeNull(); // the gap stays where it was
    expectBagValid(u);
  });

  it('the swap also works with a full bag', () => {
    let s = ok(bag(), { type: 'EQUIP_ITEM', itemId: 'iron_helm#a' });
    placeInBag(s.inventory, makeItem('bread', 1, 'fill'));
    while (placeInBag(s.inventory, makeItem('bread', 1, `junk${s.inventory.items.length}`))) {
      /* fill */
    }
    s = ok(s, { type: 'UNEQUIP_ITEM', slot: 'helmet', toCell: 3 });
    expect(s.character.equipment.helmet!.id).toBe('copper_helm#a');
    expect(grid(s)[3]).toBe('iron_helm#a');
  });

  it('onto a cell that holds something that does not fit: CELL_TAKEN, nothing changes (the spring-back)', () => {
    const s = worn();
    for (const cell of [0, 1, 4, 5]) expect(code(s, { type: 'UNEQUIP_ITEM', slot: 'helmet', toCell: cell })).toBe('CELL_TAKEN'); // bread, sword, axe, potions
    const r = applyCommand(s, cmd({ type: 'UNEQUIP_ITEM', slot: 'helmet', toCell: 1 }), T0);
    expect(r.ok).toBe(false);
  });

  it('bad cells, empty or unknown slots', () => {
    const s = worn();
    for (const bad of [-1, 20, 2.5, Number.NaN, '3', null]) expect(code(s, { type: 'UNEQUIP_ITEM', slot: 'helmet', toCell: bad as never })).toBe('INVALID_CELL');
    expect(code(s, { type: 'UNEQUIP_ITEM', slot: 'gloves', toCell: 9 })).toBe('SLOT_EMPTY');
    expect(code(s, { type: 'UNEQUIP_ITEM', slot: 'tail' as never, toCell: 9 })).toBe('UNKNOWN_SLOT');
  });

  it('the Potion Belt keeps its contents when it is dragged off', () => {
    let s = bag();
    placeInBag(s.inventory, makeItem('potion_belt'));
    s = ok(s, { type: 'EQUIP_ITEM', itemId: 'potion_belt' });
    s = ok(s, { type: 'BELT_PUT', itemId: 'health_potion_t1', slot: 2 });
    const u = ok(s, { type: 'UNEQUIP_ITEM', slot: 'accessory', toCell: 11 });
    expect(cellOf(u, 'potion_belt')).toBe(11);
    expect(u.inventory.items.find((i) => i.id === 'potion_belt')!.belt![2]).toEqual({ defId: 'health_potion_t1', count: 5, rule: 'hp_below_50' });
  });

  it('a belt cannot be swapped onto a cell holding other gear (wrong slot), but can onto another accessory-fitting piece (none exist)', () => {
    let s = bag();
    placeInBag(s.inventory, makeItem('potion_belt'));
    s = ok(s, { type: 'EQUIP_ITEM', itemId: 'potion_belt' });
    expect(code(s, { type: 'UNEQUIP_ITEM', slot: 'accessory', toCell: 2 })).toBe('CELL_TAKEN');
  });
});

describe('the existing equipment rules still run on the drag path', () => {
  /** Birch needs WC 5 and 100 WS: WC 5 + STR 10 + Iron Axe 40 = 100. */
  const birch = () => {
    let s = bag();
    s.character.skills.woodcutting = { ...s.character.skills.woodcutting, level: 5 };
    s = ok(s, { type: 'EQUIP_ITEM', itemId: 'iron_axe#a' });
    return ok(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'birch' });
  };

  it('dragging the axe into the bag stops woodcutting when the tool is needed, banking what was cut (UNEQUIP_ITEM with a cell)', () => {
    const s = birch();
    const r = applyCommand(s, cmd({ type: 'UNEQUIP_ITEM', slot: 'axe', toCell: 15 }), T0 + 2 * 290 * SEC + MIN);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.activity).toBeNull();
    expect(r.events).toContainEqual({ type: 'ACTIVITY_STOPPED', kind: 'woodcutting' });
    expect(cellOf(r.state, 'iron_axe#a')).toBe(15);
    expect(r.state.inventory.items.find((i) => i.id === 'birch_logs')!.quantity).toBe(2);
  });

  it('a swap onto a weaker axe by dragging the old one onto its cell stops it too', () => {
    let s = birch();
    s = ok(s, { type: 'MOVE_ITEM', itemId: 'start-wooden_axe', toCell: 8 });
    const r = applyCommand(s, cmd({ type: 'UNEQUIP_ITEM', slot: 'axe', toCell: 8 }), T0 + MIN);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.character.equipment.axe!.id).toBe('start-wooden_axe');
    expect(r.state.activity).toBeNull();
    expect(grid(r.state)[8]).toBe('iron_axe#a');
  });
});

describe('SWAP_RINGS (the ring slots trade places)', () => {
  beforeAll(() => {
    Object.assign(ITEMS, {
      test_ring_a: { ...ITEMS.iron_helm, id: 'test_ring_a', name: 'Test Ring A', slot: 'ring1', armor: 0 },
      test_ring_b: { ...ITEMS.iron_helm, id: 'test_ring_b', name: 'Test Ring B', slot: 'ring2', armor: 0 },
    });
  });
  afterAll(() => {
    delete (ITEMS as Record<string, unknown>).test_ring_a;
    delete (ITEMS as Record<string, unknown>).test_ring_b;
  });

  const rings = (a: boolean, b: boolean): GameState => {
    const s = bag();
    placeInBag(s.inventory, makeItem('test_ring_a', 1, 'ringA', { quality: 50, rarity: 'common' }));
    placeInBag(s.inventory, makeItem('test_ring_b', 1, 'ringB', { quality: 50, rarity: 'common' }));
    let w = s;
    if (a) w = ok(w, { type: 'EQUIP_ITEM', itemId: 'ringA' });
    if (b) w = ok(w, { type: 'EQUIP_ITEM', itemId: 'ringB' });
    return w;
  };

  it('both filled: swapped; one filled: it moves to the other slot; both empty: SLOT_EMPTY', () => {
    const both = ok(rings(true, true), { type: 'SWAP_RINGS' });
    expect([both.character.equipment.ring1!.id, both.character.equipment.ring2!.id]).toEqual(['ringB', 'ringA']);
    const one = ok(rings(true, false), { type: 'SWAP_RINGS' });
    expect(one.character.equipment.ring1).toBeUndefined();
    expect(one.character.equipment.ring2!.id).toBe('ringA');
    const back = ok(one, { type: 'SWAP_RINGS' });
    expect(back.character.equipment.ring1!.id).toBe('ringA');
    expect(back.character.equipment.ring2).toBeUndefined();
    expect(code(bag(), { type: 'SWAP_RINGS' })).toBe('SLOT_EMPTY');
  });

  it('touches nothing in the bag; no cell is created on a worn ring', () => {
    const s = rings(true, true);
    const w = ok(s, { type: 'SWAP_RINGS' });
    expect(grid(w)).toEqual(grid(s));
    expectBagValid(w);
  });

  it('EQUIP_ITEM picks the ring slot a ring was aimed at; any other item is still WRONG_SLOT', () => {
    const s = rings(false, false);
    const into2 = ok(s, { type: 'EQUIP_ITEM', itemId: 'ringA', slot: 'ring2' });
    expect(into2.character.equipment.ring2!.id).toBe('ringA');
    expect(into2.character.equipment.ring1).toBeUndefined();
    const cellB = cellOf(s, 'ringB')!;
    const over = ok(into2, { type: 'EQUIP_ITEM', itemId: 'ringB', slot: 'ring2' });
    expect(over.character.equipment.ring2!.id).toBe('ringB');
    expect(grid(over)[cellB]).toBe('ringA'); // the old ring takes the new one's cell
    expect(code(s, { type: 'EQUIP_ITEM', itemId: 'ringA', slot: 'helmet' })).toBe('WRONG_SLOT');
    // Dragging a worn ring onto a bag cell holding the other ring swaps them, in either ring slot.
    const worn = ok(s, { type: 'EQUIP_ITEM', itemId: 'ringA', slot: 'ring2' });
    const swapped = ok(worn, { type: 'UNEQUIP_ITEM', slot: 'ring2', toCell: cellB });
    expect(swapped.character.equipment.ring2!.id).toBe('ringB');
    expect(grid(swapped)[cellB]).toBe('ringA');
  });
});

describe('the single entry point', () => {
  it('no engine file but inventory.ts pushes into the bag (placeInBag / placeInCell are the ways in; migrations.ts works on frozen raw documents)', () => {
    const dir = join(__dirname, '..', 'src', 'engine');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts') && e.name !== 'inventory.ts' && e.name !== 'migrations.ts') {
          const src = readFileSync(p, 'utf8');
          if (/inventory\.items\.(push|unshift)\(|\bitems\.(push|unshift)\(/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) offenders.push(e.name);
        }
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });
});

describe('a long random game of moves, equips, unequips, sales, buys and drinks', () => {
  it('keeps the bag valid, never loses or duplicates an item, and a move changes nothing but cells', () => {
    let seed = 987654321;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    let s = bag();
    for (const [defId, id] of [['iron_boots', 'iron_boots#a'], ['iron_gloves', 'iron_gloves#a'], ['iron_shield', 'iron_shield#a'], ['iron_pickaxe', 'iron_pickaxe#a']] as const) {
      placeInBag(s.inventory, makeItem(defId, 1, id, { quality: 40, rarity: 'common' }));
    }
    const SLOTS: EquipmentSlot[] = ['helmet', 'weapon', 'axe', 'pickaxe', 'boots', 'gloves', 'shield', 'armor', 'legs'];
    const everything = (x: GameState) => [...x.inventory.items.map((i) => i.id), ...Object.values(x.character.equipment).map((i) => i!.id)].sort();
    let moves = 0;
    let swaps = 0;
    for (let step = 0; step < 400; step += 1) {
      const before = s;
      const gear = s.inventory.items.filter((i) => i.slot);
      const pick = rnd(8);
      let c: Input;
      if (pick <= 2 && s.inventory.items.length) c = { type: 'MOVE_ITEM', itemId: s.inventory.items[rnd(s.inventory.items.length)].id, toCell: rnd(20) };
      else if (pick === 3 && gear.length) c = { type: 'EQUIP_ITEM', itemId: gear[rnd(gear.length)].id };
      else if (pick === 4) c = { type: 'UNEQUIP_ITEM', slot: SLOTS[rnd(SLOTS.length)] };
      else if (pick === 5) c = { type: 'UNEQUIP_ITEM', slot: SLOTS[rnd(SLOTS.length)], toCell: rnd(20) };
      else if (pick === 6 && s.inventory.items.length) c = { type: 'SELL_ITEM', itemId: s.inventory.items[rnd(s.inventory.items.length)].id, quantity: 1 };
      else {
        const slot = rnd(s.merchant.stock.length);
        const l = s.merchant.stock[slot];
        if (!l) continue;
        c = { type: 'BUY_ITEM', slot, defId: l.defId, quantity: 1, maxUnitPrice: l.unitPrice };
      }
      const r = applyCommand(s, cmd(c), T0);
      if (!r.ok) continue; // a refusal returns no state: the one we hold is untouched
      s = r.state;
      expectBagValid(s);
      if (c.type === 'MOVE_ITEM') {
        moves += 1;
        expect(ids(s)).toEqual(ids(before));
        expect(hashState(asV24(s))).toBe(hashState(asV24(before)));
      } else if (c.type === 'EQUIP_ITEM' || c.type === 'UNEQUIP_ITEM') {
        if (c.type === 'UNEQUIP_ITEM' && c.toCell !== undefined) swaps += 1;
        expect(everything(s)).toEqual(everything(before));
      }
    }
    expect(moves).toBeGreaterThan(30);
    expect(swaps).toBeGreaterThan(5);
  });
});

describe('through the client: logged, persisted and replayed', () => {
  it('MOVE_ITEM / EQUIP_ITEM / UNEQUIP_ITEM with a cell / SWAP_RINGS are logged commands; the log replays to the same state', async () => {
    const repo = new MemoryGameRepository();
    const clock = new FakeClock(T0);
    const { client } = makeClient({ repo, clock, prefix: 'bag' });
    await client.load();
    expect((await client.debug.build('merchant')).ok).toBe(true);
    expect((await client.debug.addGold(5000)).ok).toBe(true);
    expect((await client.dispatch({ type: 'MOVE_ITEM', itemId: 'bread', toCell: 6 })).ok).toBe(true);
    expect((await client.dispatch({ type: 'UNEQUIP_ITEM', slot: 'weapon', toCell: 2 })).ok).toBe(true);
    expect((await client.dispatch({ type: 'EQUIP_ITEM', itemId: 'start-rusty_gladius' })).ok).toBe(true);
    expect((await client.dispatch({ type: 'UNEQUIP_ITEM', slot: 'axe' })).ok).toBe(true);
    expect((await client.dispatch({ type: 'MOVE_ITEM', itemId: 'bread', toCell: 6 })).ok).toBe(false); // same cell: refused, not logged
    expect((await client.dispatch({ type: 'SWAP_RINGS' })).ok).toBe(false); // no ring: refused
    const state = client.getState();
    expect(grid(state).slice(0, 8)).toEqual(['start-wooden_axe', EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, 'bread', EMPTY]);
    const rows = await repo.getAllLog();
    expect(rows.filter((r) => r.type === 'MOVE_ITEM')).toHaveLength(1);
    const entries: ReplayEntry[] = rows.map(({ seq: _s, synced: _y, ...r }) => r);
    const report = replayLogReport(entries);
    expect(hashState(report.state!)).toBe(hashState(state));
    // A save and reload keep the cells.
    const again = makeClient({ repo, clock, prefix: 'bag2' });
    await again.client.load();
    expect(grid(again.client.getState())).toEqual(grid(state));
  });
});
