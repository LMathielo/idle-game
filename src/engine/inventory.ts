// Inventory rules. Stackable items merge into one stack per definition id;
// a new stack needs a free slot, otherwise the item is lost.
import { BELT } from './config/belt';
import { GEAR } from './config/gear';
import { getItemDef } from './config/items';
import { copyAffixes, isGearDef } from './gear';
import type { BeltSlot, Character, GameState, GearRoll, Inventory, Item } from './types';

/**
 * A new item instance. Gear (an item with a slot) carries `roll` (its quality, rarity and, for rare / epic, its affixes), by default
 * 25% / common without affixes: a new hero's starting gear and the starter stock.
 */
export function makeItem(defId: string, quantity = 1, instanceId?: string, roll?: GearRoll): Item {
  const def = getItemDef(defId);
  if (!def) throw new Error(`Unknown item ${defId}`);
  const item: Item = { id: instanceId ?? def.id, defId: def.id, name: def.name, icon: def.icon };
  if (def.slot) item.slot = def.slot;
  if (def.belt) item.belt = emptyBeltSlots();
  if (isGearDef(def)) {
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

/** A fresh set of empty Potion Belt slots (BELT.slots of them). */
export function emptyBeltSlots(): BeltSlot[] {
  return Array.from({ length: BELT.slots }, () => null);
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
 * True when the hero owns at least one of the item: in the inventory or worn (1.27.0: an equipped Potion Belt counts, so the Chieftain does not
 * drop a second one while it is worn). The single ownership check of unique items (ItemDef.unique, e.g. the Potion Belt); a future storage
 * extends THIS function and nothing else (the drop roll, the loot list and the tests all call it). Read-only.
 */
export function heroOwnsItem(state: { inventory: Pick<Inventory, 'items'>; character: Pick<Character, 'equipment'> }, defId: string): boolean {
  return state.inventory.items.some((i) => i.defId === defId) || Object.values(state.character.equipment).some((i) => i?.defId === defId);
}

/** Inventory slots still free (never negative). */
export function freeSlots(inventory: Inventory): number {
  return Math.max(0, inventory.capacity - inventory.items.length);
}
