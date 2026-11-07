// The Storage modal's drag, as pure functions (no React Native, so a test reads them): which drop box index means which storage cell, bag
// cell or whole section, the mask of boxes that accept what is in hand, and the id a dragged item carries. The drag kit
// (ui/drag/dragKit.tsx) works on box INDEXES; this maps them. What a drop DOES is the engine's `dropCommand` (one rule: storage.ts
// `planMove`); nothing here decides one.
//
// Box order: storage cells 0..storageCap-1, bag cells next, then the storage SECTION, then the bag section (a drop on a section but not on
// a cell sends the whole stack to the other container: onto its stack, else its first free cell).
import { type DragSource, type DragTarget, dropCommand, type GameState, type Side } from '../../engine';

export type StorageDragState = Pick<GameState, 'inventory' | 'character' | 'storage' | 'buildings'>;

/** Clip slots (drag kit `setClip`): the two scroll viewports. A cell scrolled out of its viewport is not a drop box. */
export const CLIP_STORAGE = 0;
export const CLIP_BAG = 1;
export const CLIP_COUNT = 2;

export const dropBoxCount = (storageCap: number, bagCap: number): number => storageCap + bagCap + 2;

export const storageCellBox = (cell: number): number => cell;
export const bagCellBox = (cell: number, storageCap: number): number => storageCap + cell;
export const sectionBox = (side: Side, storageCap: number, bagCap: number): number => storageCap + bagCap + (side === 'storage' ? 0 : 1);

/** The clip slot that cuts box `index` (cells are cut by their section's viewport, the sections themselves are not), or -1. */
export function clipSlotOf(index: number, storageCap: number, bagCap: number): number {
  if (index < 0) return -1;
  if (index < storageCap) return CLIP_STORAGE;
  return index < storageCap + bagCap ? CLIP_BAG : -1;
}

/** What a drop box index means, or null for an index outside all of them. */
export function boxTarget(index: number, storageCap: number, bagCap: number): DragTarget | null {
  if (!Number.isInteger(index) || index < 0) return null;
  if (index < storageCap) return { kind: 'storage_cell', cell: index };
  if (index < storageCap + bagCap) return { kind: 'cell', cell: index - storageCap };
  if (index === storageCap + bagCap) return { kind: 'area', side: 'storage' };
  if (index === storageCap + bagCap + 1) return { kind: 'area', side: 'bag' };
  return null;
}

const SEP = ':';

/** The id a dragged item carries. Stackable ids are their defId in BOTH containers, so the side is part of it. */
export const dragIdOf = (side: Side, itemId: string): string => `${side}${SEP}${itemId}`;

export function parseDragId(id: string): DragSource {
  const at = id.indexOf(SEP);
  const side = id.slice(0, at);
  const itemId = id.slice(at + 1);
  return side === 'storage' ? { kind: 'storage', itemId } : { kind: 'bag', itemId };
}

/** 1 for every drop box that accepts `source` (the engine's `dropCommand` says so), else 0. */
export function acceptingBoxes(state: StorageDragState, source: DragSource, storageCap: number, bagCap: number): number[] {
  return Array.from({ length: dropBoxCount(storageCap, bagCap) }, (_, i) => {
    const target = boxTarget(i, storageCap, bagCap);
    return target && dropCommand(state, source, target) ? 1 : 0;
  });
}

/** Nothing accepts (the mask between drags). */
export const noBoxes = (count: number): number[] => Array.from({ length: count }, () => 0);
