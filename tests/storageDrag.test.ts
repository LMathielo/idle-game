// The Storage modal's drag mapping (components/storage/storageDrag.ts): drop box indexes, clip slots, the accepting mask, the drag id; plus
// the kit's viewport clipping (dropTargets.clipRect), the bonus line ("Lv2 · 70 slots") and the ITEMS_DEPOSITED reader.
import { describe, expect, it } from 'vitest';
import { depositedOf } from '../src/client/dispatchEvents';
import { currentBonusLine } from '../src/components/buildings/bonusText';
import { acceptingBoxes, bagCellBox, boxTarget, CLIP_BAG, CLIP_STORAGE, clipSlotOf, dragIdOf, dropBoxCount, noBoxes, parseDragId, sectionBox, storageCellBox } from '../src/components/storage/storageDrag';
import { clipRect, slotAt } from '../src/components/ui/drag/dropTargets';
import { BUILDINGS, type GameState, levelBonuses } from '../src/engine';
import { cloneState } from '../src/engine/clone';
import { makeItem, placeInBag, placeInStorage, placeInStorageCell } from '../src/engine/inventory';
import { builtGame, T0 } from './helpers';

const S = 50;
const B = 20;

function game(): GameState {
  const s = cloneState(builtGame(1, T0));
  placeInBag(s.inventory, makeItem('bread', 4));
  placeInBag(s.inventory, makeItem('iron_helm', 1, 'iron_helm#a', { quality: 50, rarity: 'common' }));
  placeInStorage(s, makeItem('bread', 9));
  placeInStorageCell(s, makeItem('stone', 3), 7);
  return s;
}

describe('drop boxes', () => {
  it('storage cells, bag cells, then the two sections; both directions agree', () => {
    expect(dropBoxCount(S, B)).toBe(S + B + 2);
    expect(boxTarget(0, S, B)).toEqual({ kind: 'storage_cell', cell: 0 });
    expect(boxTarget(S - 1, S, B)).toEqual({ kind: 'storage_cell', cell: S - 1 });
    expect(boxTarget(S, S, B)).toEqual({ kind: 'cell', cell: 0 });
    expect(boxTarget(S + B - 1, S, B)).toEqual({ kind: 'cell', cell: B - 1 });
    expect(boxTarget(S + B, S, B)).toEqual({ kind: 'area', side: 'storage' });
    expect(boxTarget(S + B + 1, S, B)).toEqual({ kind: 'area', side: 'bag' });
    expect(boxTarget(S + B + 2, S, B)).toBeNull();
    expect(boxTarget(-1, S, B)).toBeNull();
    expect(boxTarget(2.5, S, B)).toBeNull();
    for (const c of [0, 13, S - 1]) expect(boxTarget(storageCellBox(c), S, B)).toEqual({ kind: 'storage_cell', cell: c });
    for (const c of [0, 5, B - 1]) expect(boxTarget(bagCellBox(c, S), S, B)).toEqual({ kind: 'cell', cell: c });
    expect(boxTarget(sectionBox('storage', S, B), S, B)).toEqual({ kind: 'area', side: 'storage' });
    expect(boxTarget(sectionBox('bag', S, B), S, B)).toEqual({ kind: 'area', side: 'bag' });
  });

  it('cells are cut by their own grid viewport, the sections are not cut', () => {
    expect(clipSlotOf(0, S, B)).toBe(CLIP_STORAGE);
    expect(clipSlotOf(S - 1, S, B)).toBe(CLIP_STORAGE);
    expect(clipSlotOf(S, S, B)).toBe(CLIP_BAG);
    expect(clipSlotOf(S + B - 1, S, B)).toBe(CLIP_BAG);
    expect(clipSlotOf(sectionBox('storage', S, B), S, B)).toBe(-1);
    expect(clipSlotOf(sectionBox('bag', S, B), S, B)).toBe(-1);
  });

  it('a drag id keeps the side (stackable ids are the same in both containers) and round-trips', () => {
    expect(dragIdOf('bag', 'bread')).not.toBe(dragIdOf('storage', 'bread'));
    expect(parseDragId(dragIdOf('bag', 'bread'))).toEqual({ kind: 'bag', itemId: 'bread' });
    expect(parseDragId(dragIdOf('storage', 'bread'))).toEqual({ kind: 'storage', itemId: 'bread' });
    expect(parseDragId(dragIdOf('storage', 'iron_helm#a'))).toEqual({ kind: 'storage', itemId: 'iron_helm#a' });
  });
});

describe('acceptingBoxes (the boxes that light up)', () => {
  it('a bag stack of bread: the storage section, its bread stack cell (merge) and free storage cells; not its own bag cell nor the bag section', () => {
    const s = game();
    const mask = acceptingBoxes(s, { kind: 'bag', itemId: 'bread' }, S, B);
    expect(mask).toHaveLength(dropBoxCount(S, B));
    const bread = s.storage.items.find((i) => i.defId === 'bread')!.cell!;
    expect(mask[storageCellBox(bread)]).toBe(1); // merge
    expect(mask[sectionBox('storage', S, B)]).toBe(1);
    expect(mask[sectionBox('bag', S, B)]).toBe(0);
    const own = s.inventory.items.find((i) => i.id === 'bread')!.cell!;
    expect(mask[bagCellBox(own, S)]).toBe(0);
    expect(mask[storageCellBox(7)]).toBe(1); // a different item there: a swap (the stone comes back to the bread's bag cell)
  });

  it('a storage item: every bag cell (move / swap), other storage cells, and the bag section', () => {
    const s = game();
    const mask = acceptingBoxes(s, { kind: 'storage', itemId: 'stone' }, S, B);
    expect(mask[sectionBox('bag', S, B)]).toBe(1);
    expect(mask[sectionBox('storage', S, B)]).toBe(0);
    expect(mask[storageCellBox(7)]).toBe(0); // its own cell
    expect(mask[storageCellBox(8)]).toBe(1);
    const emptyBag = Array.from({ length: B }, (_, c) => c).find((c) => !s.inventory.items.some((i) => i.cell === c))!;
    expect(mask[bagCellBox(emptyBag, S)]).toBe(1);
  });

  it('the storage section refuses a bag item while the storage is locked, and noBoxes is all zeros', () => {
    const s = cloneState(builtGame(1, T0));
    s.buildings.storage = { level: 0 } as never;
    expect(noBoxes(4)).toEqual([0, 0, 0, 0]);
    const mask = acceptingBoxes(s, { kind: 'bag', itemId: 'bread' }, 0, B);
    expect(mask[sectionBox('storage', 0, B)]).toBe(0);
  });
});

describe('clipRect and slotAt', () => {
  const view = { x: 0, y: 100, width: 300, height: 200 };
  it('keeps the visible part of a cell, drops a scrolled-away one', () => {
    expect(clipRect({ x: 10, y: 120, width: 52, height: 52 }, view)).toEqual({ x: 10, y: 120, width: 52, height: 52 });
    expect(clipRect({ x: 10, y: 80, width: 52, height: 52 }, view)).toEqual({ x: 10, y: 100, width: 52, height: 32 });
    expect(clipRect({ x: 10, y: 20, width: 52, height: 52 }, view)).toBeNull();
    expect(clipRect({ x: 10, y: 300, width: 52, height: 52 }, view)).toBeNull();
  });

  it('a point over the bag section but under a scrolled-away storage cell hits the section, not the cell', () => {
    const storageView = { x: 0, y: 100, width: 300, height: 200 };
    const hiddenCell = clipRect({ x: 10, y: 340, width: 52, height: 52 }, storageView); // scrolled below the viewport, drawn "under" the bag
    expect(hiddenCell).toBeNull();
    const rects = [{ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 100, width: 300, height: 200 }, { x: 0, y: 340, width: 300, height: 150 }];
    expect(slotAt(rects, 30, 360)).toBe(2);
  });
});

describe('the bonus line and the deposit event', () => {
  it('shows the slots of the level', () => {
    expect(currentBonusLine(1, levelBonuses(cloneState(builtGame(1, T0)), 'storage'))).toBe('Lv1 · 50 slots');
    expect(currentBonusLine(2, BUILDINGS.storage.levels[1])).toBe('Lv2 · 70 slots');
    expect(currentBonusLine(5, BUILDINGS.storage.levels[4])).toBe('Lv5 · 130 slots');
  });

  it('reads moved / stayed from the ITEMS_DEPOSITED event, null for a refusal or another result', () => {
    const base = { ok: true as const, state: {} as never, duplicate: false };
    expect(depositedOf({ ...base, events: [{ type: 'ITEMS_DEPOSITED', mode: 'all', moved: 4, stayed: 3 }] } as never)).toEqual({ moved: 4, stayed: 3 });
    expect(depositedOf({ ...base, events: [] } as never)).toBeNull();
    expect(depositedOf({ ok: false, error: { code: 'CONTAINER_FULL', message: 'x' } } as never)).toBeNull();
  });
});
