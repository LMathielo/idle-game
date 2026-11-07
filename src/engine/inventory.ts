// Inventory rules. Stackable items merge into one stack per definition id;
// a new stack needs a free slot, otherwise the item is lost.
import { GEAR } from './config/gear';
import { getItemDef } from './config/items';
import { copyAffixes } from './gear';
import type { GameState, GearRoll, Inventory, Item } from './types';

/**
 * A new item instance. Gear (an item with a slot) carries `roll` (its quality, rarity and, for rare / epic, its affixes), by default
 * 25% / common without affixes: a new hero's starting gear and the starter stock.
 */
export function makeItem(defId: string, quantity = 1, instanceId?: string, roll?: GearRoll): Item {
  const def = getItemDef(defId);
  if (!def) throw new Error(`Unknown item ${defId}`);
  const item: Item = { id: instanceId ?? def.id, defId: def.id, name: def.name, icon: def.icon };
  if (def.slot) {
    item.slot = def.slot;
    item.rarity = roll?.rarity ?? GEAR.defaultRarity;
    item.quality = roll?.quality ?? GEAR.defaultQuality;
    const affixes = copyAffixes(roll?.affixes);
    if (affixes) item.affixes = affixes;
  }
  if (def.stackable) {
    item.stackable = true;
    item.quantity = quantity;
  }
  return item;
}

/**
 * Adds a stackable item. Mutates `inventory` (callers pass a draft copy).
 * Returns how many were added and how many were lost because no slot was free.
 */
export function addStackable(inventory: Inventory, defId: string, quantity: number): { added: number; lost: number } {
  const existing = inventory.items.find((i) => i.stackable && i.defId === defId);
  if (existing) {
    existing.quantity = (existing.quantity ?? 0) + quantity;
    return { added: quantity, lost: 0 };
  }
  if (inventory.items.length >= inventory.capacity) return { added: 0, lost: quantity };
  inventory.items.push(makeItem(defId, quantity));
  return { added: quantity, lost: 0 };
}

/**
 * True when the hero owns at least one of the item. The single ownership check of unique items (ItemDef.unique, e.g. the Potion Belt):
 * today items live only in the inventory, so it looks only there. A future equipment slot or storage extends THIS function and
 * nothing else (the drop roll, the loot list and the tests all call it). Read-only.
 */
export function heroOwnsItem(state: Pick<GameState, 'inventory'>, defId: string): boolean {
  return state.inventory.items.some((i) => i.defId === defId);
}

/** Inventory slots still free (never negative). */
export function freeSlots(inventory: Inventory): number {
  return Math.max(0, inventory.capacity - inventory.items.length);
}
