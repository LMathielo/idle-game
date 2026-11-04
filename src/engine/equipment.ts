// Equip, unequip and use (pure rules on a draft copy). Derived stats, woodcutting strength and run times
// read the equipment, so they follow automatically. An item is always in exactly one place: a swap puts
// the old item where the new one was, so it never needs a free slot and never loses an item.
import { getItemDef } from './config/items';
import { maxHpOf } from './hp';
import { freeSlots } from './inventory';
import type { ItemError } from './merchant';
import { EQUIPMENT_SLOTS, type EquipmentSlot, type GameState } from './types';

const err = (code: NonNullable<ItemError>['code'], message: string): ItemError => ({ code, message });

export function isEquipmentSlot(slot: unknown): slot is EquipmentSlot {
  return typeof slot === 'string' && (EQUIPMENT_SLOTS as readonly string[]).includes(slot);
}

/** Moves an inventory item into its catalog slot; the item there (if any) takes its inventory place. */
export function equipItem(draft: GameState, itemId: unknown): ItemError {
  const items = draft.inventory.items;
  const index = items.findIndex((i) => i.id === itemId);
  if (typeof itemId !== 'string' || index < 0) return err('NOT_IN_INVENTORY', 'That item is not in the inventory');
  const item = items[index];
  const def = getItemDef(item.defId);
  if (!def?.slot || def.stackable) return err('NOT_EQUIPPABLE', `${item.name} cannot be equipped`);
  const old = draft.character.equipment[def.slot];
  draft.character.equipment[def.slot] = item;
  if (old) items[index] = old;
  else items.splice(index, 1);
  return null;
}

/** Moves the item in `slot` to the inventory. Needs a free slot. */
export function unequipItem(draft: GameState, slot: unknown): ItemError {
  if (!isEquipmentSlot(slot)) return err('UNKNOWN_SLOT', `Unknown equipment slot ${String(slot)}`);
  const item = draft.character.equipment[slot];
  if (!item) return err('SLOT_EMPTY', `Nothing is equipped in ${slot}`);
  if (freeSlots(draft.inventory) < 1) return err('INVENTORY_FULL', 'The inventory is full');
  draft.inventory.items.push(item);
  delete draft.character.equipment[slot];
  return null;
}

/** Uses one unit of a consumable. Potions heal their catalog amount, capped at max HP. */
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
  c.hp = Math.min(maxHp, Math.max(0, c.hp) + heal);
  // Invariant (hp.ts): no banked regen while full.
  if (c.hp >= maxHp) c.hpRegenProgress = 0;
  const left = (item.stackable ? (item.quantity ?? 1) : 1) - 1;
  if (left > 0) item.quantity = left;
  else items.splice(index, 1);
  return null;
}
