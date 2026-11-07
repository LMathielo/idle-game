// Item stock across the two containers that can pay a cost (1.29.0, owner decision 2026-11-07): the STORAGE first, then the bag.
//
// ONE place counts and takes: every payment (BUILD, UPGRADE_BUILDING, START_CRAFT, a craft's inputs in the walk, X10_CRAFT, the have / need
// lines of every view) goes through `countItem` and `takeItem`, so a cost can be split across both containers and a deposit or withdraw
// never changes a total. tests/storage.test.ts scans the engine for item removals outside this file. Refunds go the other way round (the
// bag first; `refundItems`). Everything else stays bag-only on purpose: gathering and crafted output, drops, the Merchant, the Potion Belt,
// potions and equipping.
import { cloneState } from './clone';
import { firstEmptyCell, makeItem, placeInBag, placeInStorage, storageBox } from './inventory';
import type { GameState, Inventory, Item } from './types';

type Stock = Pick<GameState, 'inventory' | 'storage'>;

const unitsOf = (i: Item) => (i.stackable ? (i.quantity ?? 1) : 1);

const sumOf = (items: readonly Item[], defId: string) => items.reduce((n, i) => (i.defId === defId ? n + unitsOf(i) : n), 0);

/** How many of `defId` the bag holds. */
export function bagCount(state: Pick<GameState, 'inventory'>, defId: string): number {
  return sumOf(state.inventory.items, defId);
}

/** How many of `defId` the storage holds. */
export function storageCount(state: Pick<GameState, 'storage'>, defId: string): number {
  return sumOf(state.storage.items, defId);
}

/** How many of `defId` the hero can pay with: storage + bag. The one number behind every have / need line and every cost check. */
export function countItem(state: Stock, defId: string): number {
  return storageCount(state, defId) + bagCount(state, defId);
}

/** Removes up to `quantity` from one item list, in list order; returns what is still owed. */
function takeFrom(items: Item[], defId: string, quantity: number): number {
  let left = quantity;
  for (let i = 0; i < items.length && left > 0; ) {
    const it = items[i];
    if (it.defId !== defId) {
      i += 1;
      continue;
    }
    const have = unitsOf(it);
    const take = Math.min(have, left);
    left -= take;
    if (have - take > 0) {
      it.quantity = have - take;
      i += 1;
    } else {
      items.splice(i, 1); // the cell stays a gap
    }
  }
  return left;
}

/**
 * Takes `quantity` of `defId`: the storage first, then the bag for the rest (the caller checked `countItem`). Emptied stacks leave gaps.
 * Mutates `draft`'s two item lists (a copy the caller owns).
 */
export function takeItem(draft: Stock, defId: string, quantity: number): void {
  const left = takeFrom(draft.storage.items, defId, quantity);
  if (left > 0) takeFrom(draft.inventory.items, defId, left);
}

/** Can a stackable go into this box (its stack, or a free cell)? */
function fits(box: Inventory, defId: string): boolean {
  return box.items.some((i) => i.stackable && i.defId === defId) || firstEmptyCell(box) >= 0;
}

/** Adds stackable units to a box (its stack, else a new one in the box's `place`). False (nothing changes) when there is no room. */
function addTo(box: Inventory, defId: string, quantity: number, place: (item: Item) => boolean): boolean {
  const stack = box.items.find((i) => i.stackable && i.defId === defId);
  if (stack) {
    stack.quantity = (stack.quantity ?? 0) + quantity;
    return true;
  }
  return place(makeItem(defId, quantity));
}

/**
 * Gives refunded stackables back (STOP_CRAFT, CANCEL_CRAFT; owner decision 2026-11-07): into the BAG, and into the storage only for what
 * the bag has no room for (no stack of it and no free cell; a stack in either container is always joined first, the bag's before the
 * storage's). Returns how many item types fit nowhere. 0 = everything was placed. Otherwise NOTHING changed, so the caller refuses with
 * INVENTORY_FULL as that command always did. Mutates `draft` (a copy the caller owns) only on success.
 */
export function refundItems(draft: Pick<GameState, 'inventory' | 'storage' | 'buildings'>, items: readonly { defId: string; quantity: number }[]): number {
  const trial = { buildings: draft.buildings, inventory: cloneState(draft.inventory), storage: cloneState(draft.storage) };
  const bag = trial.inventory;
  const store = storageBox(trial);
  let short = 0;
  for (const { defId, quantity } of items) {
    if (quantity <= 0) continue;
    if (fits(bag, defId)) addTo(bag, defId, quantity, (item) => placeInBag(bag, item));
    else if (fits(store, defId)) addTo(store, defId, quantity, (item) => placeInStorage(trial, item));
    else short += 1;
  }
  if (short > 0) return short;
  draft.inventory = trial.inventory;
  draft.storage = trial.storage;
  return 0;
}
