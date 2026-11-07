// Equip, unequip, move and use (pure rules on a draft copy). Derived stats, woodcutting strength and run times
// read the equipment, so they follow automatically. An item is always in exactly one place: a swap puts
// the old item where the new one was (the same bag CELL, 1.28.0), so it never needs a free slot and never loses an item.
import { potionCooldownLeftMs, startPotionCooldown } from './belt';
import { getItemDef } from './config/items';
import { maxHpOf } from './hp';
import { itemInCell, placeInBag, placeInCell, settleCells } from './inventory';
import { maxManaOf } from './mana';
import type { ItemError } from './merchant';
import { EQUIPMENT_SLOTS, type EquipmentSlot, type GameState } from './types';

/**
 * Gear can carry END / INT bonuses (1.22.0), so an equipment change can lower max HP or mana: current HP and mana are brought down
 * to the new max at once (and the banked regen cleared while full), keeping the invariant that nothing is above max. Raising the max
 * never raises the current value (as a level-up or a point).
 */
function clampPools(draft: GameState): void {
  const c = draft.character;
  const maxHp = maxHpOf(draft);
  if (c.hp >= maxHp) {
    c.hp = maxHp;
    c.hpRegenProgress = 0;
  }
  const maxMana = maxManaOf(draft);
  if (c.mana >= maxMana) {
    c.mana = maxMana;
    c.manaRegenProgress = 0;
  }
}

const err = (code: NonNullable<ItemError>['code'], message: string): ItemError => ({ code, message });

export function isEquipmentSlot(slot: unknown): slot is EquipmentSlot {
  return typeof slot === 'string' && (EQUIPMENT_SLOTS as readonly string[]).includes(slot);
}

const RING_SLOTS: readonly EquipmentSlot[] = ['ring1', 'ring2'];

/** True when a piece made for `made` may be worn in `slot`: its own slot, or either ring slot for a ring. */
export function fitsSlot(made: EquipmentSlot, slot: EquipmentSlot): boolean {
  return made === slot || (RING_SLOTS.includes(made) && RING_SLOTS.includes(slot));
}

const isCell = (cell: unknown, capacity: number): cell is number => typeof cell === 'number' && Number.isSafeInteger(cell) && cell >= 0 && cell < capacity;

/**
 * Moves an inventory item into its catalog slot (or, when `toSlot` is given, into that slot: only a ring may pick between the two ring
 * slots); the item there (if any) takes the bag CELL the new one came from, and a cell left empty stays a gap. WRONG_SLOT when `toSlot`
 * does not fit the item. The drag in the Hero tab sends this same command.
 */
export function equipItem(draft: GameState, itemId: unknown, toSlot?: unknown): ItemError {
  settleCells(draft.inventory);
  const items = draft.inventory.items;
  const index = items.findIndex((i) => i.id === itemId);
  if (typeof itemId !== 'string' || index < 0) return err('NOT_IN_INVENTORY', 'That item is not in the inventory');
  const item = items[index];
  const def = getItemDef(item.defId);
  if (!def?.slot || def.stackable) return err('NOT_EQUIPPABLE', `${item.name} cannot be equipped`);
  let slot: EquipmentSlot = def.slot;
  if (toSlot !== undefined) {
    if (!isEquipmentSlot(toSlot)) return err('UNKNOWN_SLOT', `Unknown equipment slot ${String(toSlot)}`);
    if (!fitsSlot(def.slot, toSlot)) return err('WRONG_SLOT', `${item.name} does not fit ${toSlot}`);
    slot = toSlot;
  }
  const old = draft.character.equipment[slot];
  const cell = item.cell;
  draft.character.equipment[slot] = item;
  delete item.cell;
  if (old) {
    old.cell = cell;
    items[index] = old;
  } else items.splice(index, 1);
  clampPools(draft);
  return null;
}

/**
 * Moves the item in `slot` to the bag: the first empty cell, or (1.28.0) the cell `toCell` when given. A `toCell` that holds a piece
 * that fits `slot` swaps: that piece is worn and the unequipped one takes its cell; one that does not fit is CELL_TAKEN (nothing
 * changes). Without `toCell` the bag must have a free cell (INVENTORY_FULL). Unequipping the Potion Belt keeps its contents (they live on
 * the item).
 */
export function unequipItem(draft: GameState, slot: unknown, toCell?: unknown): ItemError {
  if (!isEquipmentSlot(slot)) return err('UNKNOWN_SLOT', `Unknown equipment slot ${String(slot)}`);
  const item = draft.character.equipment[slot];
  if (!item) return err('SLOT_EMPTY', `Nothing is equipped in ${slot}`);
  const inv = draft.inventory;
  settleCells(inv);
  if (toCell === undefined) {
    if (!placeInBag(inv, item)) return err('INVENTORY_FULL', 'The inventory is full');
  } else {
    if (!isCell(toCell, inv.capacity)) return err('INVALID_CELL', `Unknown inventory cell ${String(toCell)}`);
    const there = itemInCell(inv, toCell);
    if (there) {
      // The piece in that cell takes the slot if it fits (equipItem puts the unequipped one in its cell); else the drop is refused.
      const def = getItemDef(there.defId);
      if (!def?.slot || def.stackable || !fitsSlot(def.slot, slot)) return err('CELL_TAKEN', `${there.name} is in that cell`);
      return equipItem(draft, there.id, slot);
    }
    placeInCell(inv, item, toCell);
  }
  delete draft.character.equipment[slot];
  clampPools(draft);
  return null;
}

/**
 * MOVE_ITEM: moves bag item `itemId` to cell `toCell`. An empty cell: the item goes there and leaves a gap behind. A filled cell: the two
 * items swap cells. Refused (nothing changes): NOT_IN_INVENTORY, INVALID_CELL (not an integer 0..capacity-1), SAME_CELL.
 */
export function moveItem(draft: GameState, itemId: unknown, toCell: unknown): ItemError {
  const inv = draft.inventory;
  settleCells(inv);
  const item = typeof itemId === 'string' ? inv.items.find((i) => i.id === itemId) : undefined;
  if (!item) return err('NOT_IN_INVENTORY', 'That item is not in the inventory');
  if (!isCell(toCell, inv.capacity)) return err('INVALID_CELL', `Unknown inventory cell ${String(toCell)}`);
  if (item.cell === toCell) return err('SAME_CELL', 'The item is already in that cell');
  const other = itemInCell(inv, toCell);
  if (other) other.cell = item.cell;
  item.cell = toCell;
  return null;
}

/** SWAP_RINGS: Ring 1 and Ring 2 trade places (a ring next to an empty slot moves into it). SLOT_EMPTY when both are empty. */
export function swapRings(draft: GameState): ItemError {
  const eq = draft.character.equipment;
  const a = eq.ring1;
  const b = eq.ring2;
  if (!a && !b) return err('SLOT_EMPTY', 'No ring is equipped');
  delete eq.ring1;
  delete eq.ring2;
  if (b) eq.ring1 = b;
  if (a) eq.ring2 = a;
  return null;
}

/**
 * Uses one unit of a consumable. Potions heal their catalog amount, capped at max HP, and start their cooldown GROUP (1.27.0, from the
 * engine time `draft.time.lastSimulatedAt`, the command's time, for the drunk potion's cooldownMs); a potion whose group is still on
 * cooldown (any potion of it was drunk, the belt's too) is refused with ON_COOLDOWN, changing nothing.
 */
export function useItem(draft: GameState, itemId: unknown): ItemError {
  const items = draft.inventory.items;
  const index = items.findIndex((i) => i.id === itemId);
  if (typeof itemId !== 'string' || index < 0) return err('NOT_IN_INVENTORY', 'That item is not in the inventory');
  const item = items[index];
  const heal = getItemDef(item.defId)?.heal;
  if (!heal || heal <= 0) return err('NOT_USABLE', `${item.name} cannot be used`);
  const c = draft.character;
  const maxHp = maxHpOf(draft);
  if (c.hp >= maxHp) return err('HP_FULL', 'HP is already full');
  const at = draft.time.lastSimulatedAt;
  const waitMs = potionCooldownLeftMs(draft, item.defId, at);
  if (waitMs > 0) return err('ON_COOLDOWN', `${item.name} is on cooldown for ${Math.ceil(waitMs / 1000)} s`);
  startPotionCooldown(draft, item.defId, at);
  c.hp = Math.min(maxHp, Math.max(0, c.hp) + heal);
  // Invariant (hp.ts): no banked regen while full.
  if (c.hp >= maxHp) c.hpRegenProgress = 0;
  const left = (item.stackable ? (item.quantity ?? 1) : 1) - 1;
  if (left > 0) item.quantity = left;
  else items.splice(index, 1);
  return null;
}
