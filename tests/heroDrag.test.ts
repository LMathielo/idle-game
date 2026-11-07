// The Hero tab's drag mapping (components/items/heroDrag.ts): drop box indexes, the accepting mask, the slot drag id, the tab of a slot.
import { describe, expect, it } from 'vitest';
import { EQUIPMENT_SLOTS, type GameState } from '../src/engine';
import { cloneState } from '../src/engine/clone';
import { makeItem, placeInBag } from '../src/engine/inventory';
import { acceptingBoxes, boxTarget, COMBAT_GRID, dropBoxCount, noBoxes, parseDragId, slotBox, slotDragId, tabOfSlot, TOOLS_GRID } from '../src/components/items/heroDrag';
import { builtGame, T0 } from './helpers';

function game(): GameState {
  const s = cloneState(builtGame(1, T0));
  placeInBag(s.inventory, makeItem('iron_helm', 1, 'iron_helm#a', { quality: 50, rarity: 'common' }));
  placeInBag(s.inventory, makeItem('iron_axe', 1, 'iron_axe#a', { quality: 50, rarity: 'common' }));
  return s;
}

describe('the equipment grids and tabs', () => {
  it('every slot is in exactly one grid, and tabOfSlot says which', () => {
    const shown = [...COMBAT_GRID.flat(), ...TOOLS_GRID.flat()].filter((s) => s !== null);
    expect([...shown].sort()).toEqual([...EQUIPMENT_SLOTS].sort());
    expect(tabOfSlot('axe')).toBe('tools');
    expect(tabOfSlot('pickaxe')).toBe('tools');
    for (const slot of ['helmet', 'weapon', 'ring1', 'ring2', 'accessory', 'boots'] as const) expect(tabOfSlot(slot)).toBe('combat');
  });
});

describe('drop boxes', () => {
  it('bag cells first, then the equipment slots in EQUIPMENT_SLOTS order; both directions agree', () => {
    expect(dropBoxCount(20)).toBe(20 + EQUIPMENT_SLOTS.length);
    expect(boxTarget(0, 20)).toEqual({ kind: 'cell', cell: 0 });
    expect(boxTarget(19, 20)).toEqual({ kind: 'cell', cell: 19 });
    expect(boxTarget(20, 20)).toEqual({ kind: 'slot', slot: EQUIPMENT_SLOTS[0] });
    for (const slot of EQUIPMENT_SLOTS) expect(boxTarget(slotBox(slot, 20), 20)).toEqual({ kind: 'slot', slot });
    expect(boxTarget(-1, 20)).toBeNull();
    expect(boxTarget(20 + EQUIPMENT_SLOTS.length, 20)).toBeNull();
    expect(boxTarget(1.5, 20)).toBeNull();
  });

  it('a slot drag id round-trips; an item id (never "slot:...") is a bag source', () => {
    expect(parseDragId(slotDragId('ring2'))).toEqual({ kind: 'slot', slot: 'ring2' });
    expect(parseDragId('iron_helm#a')).toEqual({ kind: 'bag', itemId: 'iron_helm#a' });
    expect(parseDragId('bread')).toEqual({ kind: 'bag', itemId: 'bread' });
  });
});

describe('acceptingBoxes (the boxes that light up)', () => {
  it('a helm from the bag: every other bag cell, and the helmet slot; nothing else', () => {
    const s = game();
    const mask = acceptingBoxes(s, { kind: 'bag', itemId: 'iron_helm#a' });
    const own = s.inventory.items.find((i) => i.id === 'iron_helm#a')!.cell!;
    expect(mask).toHaveLength(dropBoxCount(20));
    expect(mask.slice(0, 20).filter((m) => m === 1)).toHaveLength(19);
    expect(mask[own]).toBe(0);
    expect(mask[slotBox('helmet', 20)]).toBe(1);
    expect(mask.filter((m, i) => m === 1 && i >= 20)).toHaveLength(1);
  });

  it('a worn weapon: empty cells accept it; cells holding other things do not; a cell holding a weapon does (it swaps)', () => {
    const s = game();
    const mask = acceptingBoxes(s, { kind: 'slot', slot: 'weapon' });
    expect(mask[15]).toBe(1);
    expect(mask[s.inventory.items.find((i) => i.id === 'iron_helm#a')!.cell!]).toBe(0);
    expect(mask.slice(20).every((m) => m === 0)).toBe(true);
    const withSword = cloneState(s);
    placeInBag(withSword.inventory, makeItem('iron_sword', 1, 'iron_sword#a', { quality: 50, rarity: 'common' }));
    const m2 = acceptingBoxes(withSword, { kind: 'slot', slot: 'weapon' });
    expect(m2[withSword.inventory.items.find((i) => i.id === 'iron_sword#a')!.cell!]).toBe(1);
  });

  it('a stale source accepts nothing; noBoxes is all zeros', () => {
    const s = game();
    expect(acceptingBoxes(s, { kind: 'bag', itemId: 'nope' }).every((m) => m === 0)).toBe(true);
    expect(acceptingBoxes(s, { kind: 'slot', slot: 'gloves' }).every((m) => m === 0)).toBe(true);
    expect(noBoxes(3)).toEqual([0, 0, 0]);
  });
});
