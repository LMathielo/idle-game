// The Hero tab's drag, as pure functions (no React Native, so a test reads them): the equipment grids, which drop box index means which
// bag cell or equipment slot, the mask of boxes that accept what is in hand, and the id a dragged slot carries. The drag kit
// (ui/drag/dragKit.tsx) works on box INDEXES; this maps them: bag cells are 0..capacity-1, the equipment slots follow in EQUIPMENT_SLOTS
// order. What a drop DOES is the engine's `dropCommand`; nothing here decides a rule.
import { type DragSource, type DragTarget, dropCommand, EQUIPMENT_SLOTS, type EquipmentSlot, type GameState } from '../../engine';

// Paper-doll layouts (1.21.0): 3 columns, null = empty cell. Combat is the paper doll, Tools the gathering tools.
export const COMBAT_GRID: (EquipmentSlot | null)[][] = [
  [null, 'helmet', 'amulet'],
  ['weapon', 'armor', 'shield'],
  ['ring1', 'legs', 'ring2'],
  ['gloves', 'boots', 'accessory'], // the accessory (the Potion Belt) sits directly under Ring 2
];
export const TOOLS_GRID: (EquipmentSlot | null)[][] = [['axe', 'pickaxe']];
export type EquipmentTab = 'combat' | 'tools';

/** The Equipment panel tab that shows `slot`. */
export function tabOfSlot(slot: EquipmentSlot): EquipmentTab {
  return TOOLS_GRID.some((row) => row.includes(slot)) ? 'tools' : 'combat';
}

const SLOT_PREFIX = 'slot:';

/** The id a worn piece's drag carries (bag items use their item id, which never starts with "slot:"). */
export const slotDragId = (slot: EquipmentSlot): string => `${SLOT_PREFIX}${slot}`;

export function parseDragId(id: string): DragSource {
  return id.startsWith(SLOT_PREFIX) ? { kind: 'slot', slot: id.slice(SLOT_PREFIX.length) as EquipmentSlot } : { kind: 'bag', itemId: id };
}

/** Number of drop boxes: every bag cell, then every equipment slot. */
export const dropBoxCount = (capacity: number): number => capacity + EQUIPMENT_SLOTS.length;

/** The drop box index of an equipment slot. */
export const slotBox = (slot: EquipmentSlot, capacity: number): number => capacity + EQUIPMENT_SLOTS.indexOf(slot);

/** What a drop box index means, or null for an index outside both. */
export function boxTarget(index: number, capacity: number): DragTarget | null {
  if (!Number.isInteger(index) || index < 0) return null;
  if (index < capacity) return { kind: 'cell', cell: index };
  const slot = EQUIPMENT_SLOTS[index - capacity];
  return slot ? { kind: 'slot', slot } : null;
}

/** 1 for every drop box that accepts `source` (the engine's `dropCommand` says so), else 0. */
export function acceptingBoxes(state: Pick<GameState, 'inventory' | 'character' | 'storage' | 'buildings'>, source: DragSource): number[] {
  const { capacity } = state.inventory;
  return Array.from({ length: dropBoxCount(capacity) }, (_, i) => {
    const target = boxTarget(i, capacity);
    return target && dropCommand(state, source, target) ? 1 : 0;
  });
}

/** Nothing accepts (the mask between drags). */
export const noBoxes = (count: number): number[] => Array.from({ length: count }, () => 0);
