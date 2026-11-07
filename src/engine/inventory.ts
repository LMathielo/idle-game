// Inventory rules. Stackable items merge into one stack per definition id;
// a new stack needs a free slot, otherwise the item is lost.
//
// THE BAG IS A GRID WITH GAPS (1.28.0, save v25): every item sits in its own cell, 0..capacity-1 (`Item.cell`), and selling or using one up
// leaves a gap. `inventory.items` stays a plain list (its order is the order things arrived in, nothing reads it as a position); the cell is
// the position. A NEW item goes to the first empty cell, a stackable joins its stack's cell. `placeInBag` is the ONLY way an item enters the
// bag (with `placeInCell`, for an item aimed at a chosen empty cell; tests/bagCells.test.ts scans the engine for any other push), and `moveItem` (equipment.ts) is the only way a cell changes besides
// equip / unequip, which hand a cell from one piece to another.
//
// THE STORAGE (1.29.0, save v26) IS THE SAME GRID: `state.storage.items` with the same cell model, its capacity following the Storage level
// (`storageBox`). Every helper below that takes `Pick<Inventory, 'items' | 'capacity'>` works on either container. Its entries are
// `placeInStorage` / `placeInStorageCell` (the same two functions as the bag's, aimed at the storage box), also here: the source-scan test
// allows pushes into a container in this file only.
import { storageCapacity } from './bonuses';
import { BELT } from './config/belt';
import { GEAR } from './config/gear';
import { getItemDef } from './config/items';
import { copyAffixes, isGearDef } from './gear';
import type { BeltSlot, Character, GameState, GearRoll, Inventory, Item } from './types';

/** Either container: a bag-like grid (`capacity` cells and the items in them). */
export type Box = Pick<Inventory, 'items' | 'capacity'>;

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

/** A cell number this bag can hold. */
const validCell = (cell: unknown, capacity: number): cell is number => typeof cell === 'number' && Number.isInteger(cell) && cell >= 0 && cell < capacity;

/**
 * The cell of every item, in `items` order. An item keeps the cell it carries when that is a valid, unclaimed cell (the first claimant
 * wins); the others (no cell, out of range, a duplicate: documents and tests that were not built by the engine) are placed in the lowest
 * free cells in list order, so a damaged or hand-built bag still lays out the same way every time and never loses an item. `undefined` only
 * when there are more items than cells. Pure.
 */
export function cellsOf(inventory: Pick<Inventory, 'items' | 'capacity'>): (number | undefined)[] {
  const { items, capacity } = inventory;
  const taken = new Set<number>();
  const cells = items.map((item) => {
    if (!validCell(item.cell, capacity) || taken.has(item.cell)) return undefined;
    taken.add(item.cell);
    return item.cell;
  });
  let next = 0;
  return cells.map((cell) => {
    if (cell !== undefined) return cell;
    while (taken.has(next)) next += 1;
    if (next >= capacity) return undefined;
    taken.add(next);
    return next;
  });
}

/** A container as the grid the player sees (the bag; the storage via `storageBox`): `capacity` entries, the item in each cell or null. Read-only (the UI's single view of the bag). */
export function bagCells(inventory: Box): (Item | null)[] {
  const grid: (Item | null)[] = Array.from({ length: Math.max(0, inventory.capacity) }, () => null);
  const cells = cellsOf(inventory);
  inventory.items.forEach((item, i) => {
    const cell = cells[i];
    if (cell !== undefined) grid[cell] = item;
  });
  return grid;
}

/** The item in `cell`, or undefined when the cell is empty (or not a cell of this bag). Read-only. */
export function itemInCell(inventory: Pick<Inventory, 'items' | 'capacity'>, cell: number): Item | undefined {
  const cells = cellsOf(inventory);
  const at = cells.indexOf(cell);
  return at < 0 ? undefined : inventory.items[at];
}

/** Writes the layout `cellsOf` computes onto the items (a no-op for a bag the engine built). Mutates `inventory` (a draft copy). */
export function settleCells(inventory: Inventory): void {
  const cells = cellsOf(inventory);
  inventory.items.forEach((item, i) => {
    const cell = cells[i];
    if (cell !== undefined && item.cell !== cell) item.cell = cell;
  });
}

/** The lowest empty cell, or -1 when the bag is full. Read-only. */
export function firstEmptyCell(inventory: Pick<Inventory, 'items' | 'capacity'>): number {
  const taken = new Set(cellsOf(inventory));
  for (let cell = 0; cell < inventory.capacity; cell += 1) if (!taken.has(cell)) return cell;
  return -1;
}

/** First-empty-cell entry shared by both containers. False (nothing changes) when the box is full. */
function pushFirstEmpty(box: Inventory, item: Item): boolean {
  settleCells(box);
  const cell = firstEmptyCell(box);
  if (cell < 0) return false;
  item.cell = cell;
  box.items.push(item);
  return true;
}

/** Chosen-cell entry shared by both containers. False (nothing changes) unless `cell` is an empty cell of the box. */
function pushInCell(box: Inventory, item: Item, cell: number): boolean {
  settleCells(box);
  if (!validCell(cell, box.capacity) || box.items.some((i) => i.cell === cell)) return false;
  item.cell = cell;
  box.items.push(item);
  return true;
}

/**
 * THE way an item enters the bag: into the first empty cell. False (nothing changes) when the bag is full. Any `cell` the item carries
 * is replaced. Mutates `inventory` (callers pass a draft copy).
 */
export function placeInBag(inventory: Inventory, item: Item): boolean {
  return pushFirstEmpty(inventory, item);
}

/**
 * The other way in, for an item the player aims at a cell (UNEQUIP_ITEM with a target): into `cell`, which must be an empty cell of this
 * bag. False (nothing changes) when it is not. Mutates `inventory` (callers pass a draft copy).
 */
export function placeInCell(inventory: Inventory, item: Item, cell: number): boolean {
  return pushInCell(inventory, item, cell);
}

/**
 * The storage as a grid (1.29.0): its capacity (the Storage level's cells, 0 while locked) and the SAME items array as `state.storage`,
 * so what the grid helpers do to `box.items` (cells settled, items spliced or pushed) is done to the state. Read-only users get the view;
 * writers pass a draft copy they own.
 */
export function storageBox(state: Pick<GameState, 'storage' | 'buildings'>): Inventory {
  return { capacity: storageCapacity(state), items: state.storage.items };
}

/** The storage's way in: the first empty cell. False (nothing changes) when storage is full (or locked: no cells). Mutates `state.storage`. */
export function placeInStorage(state: Pick<GameState, 'storage' | 'buildings'>, item: Item): boolean {
  return pushFirstEmpty(storageBox(state), item);
}

/** The storage's way in for a chosen cell, which must be an empty cell of the storage. False (nothing changes) when it is not. Mutates `state.storage`. */
export function placeInStorageCell(state: Pick<GameState, 'storage' | 'buildings'>, item: Item, cell: number): boolean {
  return pushInCell(storageBox(state), item, cell);
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
  if (!placeInBag(inventory, makeItem(defId, quantity))) return { added: 0, lost: quantity };
  return { added: quantity, lost: 0 };
}

/**
 * True when the hero owns at least one of the item: in the inventory, in the storage (1.29.0) or worn (1.27.0: an equipped Potion Belt counts,
 * so the Chieftain does not drop a second one while it is worn or stored). The single ownership check of unique items (ItemDef.unique, e.g.
 * the Potion Belt): the drop roll, the loot list and the tests all call it. Read-only.
 */
export function heroOwnsItem(
  state: { inventory: Pick<Inventory, 'items'>; storage?: Pick<Inventory, 'items'>; character: Pick<Character, 'equipment'> },
  defId: string,
): boolean {
  return (
    state.inventory.items.some((i) => i.defId === defId) ||
    (state.storage?.items.some((i) => i.defId === defId) ?? false) ||
    Object.values(state.character.equipment).some((i) => i?.defId === defId)
  );
}

/** Inventory slots still free (never negative). */
export function freeSlots(inventory: Inventory): number {
  return Math.max(0, inventory.capacity - inventory.items.length);
}
