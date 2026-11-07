// What dropping a dragged item does (1.28.0), as a read-only question for the UI: `dropCommand(state, source, target)` is the command the
// drop sends, or null when the drop does nothing and the item springs back. It owns no rule of its own: every answer is one of the
// commands MOVE_ITEM / EQUIP_ITEM / UNEQUIP_ITEM / SWAP_RINGS, and tests/dragDrop.test.ts checks, for every pair of source and target in
// several states, that the answer is a command iff the engine would accept it. The UI never decides what is allowed: it asks here, and
// the engine validates again when the command runs.
import { getItemDef } from './config/items';
import { fitsSlot } from './equipment';
import { itemInCell } from './inventory';
import type { EquipmentSlot, GameState } from './types';

/** What the player picked up: a bag item (by id) or the piece worn in a slot. */
export type DragSource = { kind: 'bag'; itemId: string } | { kind: 'slot'; slot: EquipmentSlot };
/** Where the finger let go: a bag cell or an equipment slot. */
export type DragTarget = { kind: 'cell'; cell: number } | { kind: 'slot'; slot: EquipmentSlot };

/** The command a drop sends (the client adds the id). */
export type DropCommand =
  | { type: 'MOVE_ITEM'; itemId: string; toCell: number }
  | { type: 'EQUIP_ITEM'; itemId: string; slot: EquipmentSlot }
  | { type: 'UNEQUIP_ITEM'; slot: EquipmentSlot; toCell: number }
  | { type: 'SWAP_RINGS' };

const RINGS: readonly EquipmentSlot[] = ['ring1', 'ring2'];

/** True when a piece (item definition `defId`) may be worn in `slot`. */
function fits(defId: string, slot: EquipmentSlot): boolean {
  const def = getItemDef(defId);
  return !!def?.slot && !def.stackable && fitsSlot(def.slot, slot);
}

export function dropCommand(state: Pick<GameState, 'inventory' | 'character'>, source: DragSource, target: DragTarget): DropCommand | null {
  const { inventory, character } = state;
  const validCell = (cell: number) => Number.isInteger(cell) && cell >= 0 && cell < inventory.capacity;
  if (source.kind === 'bag') {
    const item = inventory.items.find((i) => i.id === source.itemId);
    if (!item) return null;
    if (target.kind === 'cell') {
      if (!validCell(target.cell) || itemInCell(inventory, target.cell)?.id === item.id) return null;
      return { type: 'MOVE_ITEM', itemId: item.id, toCell: target.cell };
    }
    return fits(item.defId, target.slot) ? { type: 'EQUIP_ITEM', itemId: item.id, slot: target.slot } : null;
  }
  const worn = character.equipment[source.slot];
  if (!worn) return null;
  if (target.kind === 'cell') {
    if (!validCell(target.cell)) return null;
    const there = itemInCell(inventory, target.cell);
    if (there && !fits(there.defId, source.slot)) return null;
    return { type: 'UNEQUIP_ITEM', slot: source.slot, toCell: target.cell };
  }
  const bothRings = RINGS.includes(source.slot) && RINGS.includes(target.slot) && source.slot !== target.slot;
  return bothRings ? { type: 'SWAP_RINGS' } : null;
}
