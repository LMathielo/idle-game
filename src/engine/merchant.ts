// Merchant rules (pure). Not an activity: buying, selling and refreshing work while anything runs.
//
//   refresh charges: +1 per MERCHANT.chargeIntervalMs, at most maxCharges (extra charges are lost);
//                    regen in simulate() on the sanitized, UNCAPPED time, like stamina; remainder kept.
//   REFRESH_MERCHANT spends 1 charge and rolls a new stock (rollStock: Health Potion ×10, then the pool, seeded,
//                    no duplicates; as many slots as the Merchant's level gives).
//   BUY_ITEM / SELL_ITEM move gold and items; gold never goes negative, inventory never overflows.
import { merchantStockSlots, sellPriceOf } from './bonuses';
import { getItemDef } from './config/items';
import { MERCHANT, type MerchantPoolEntry } from './config/merchant';
import { addStackable, freeSlots, makeItem } from './inventory';
import { nextInt } from './rng';
import type { GameState, MerchantListing, MerchantState, RngState } from './types';

export type ItemErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_COMMAND'
  | 'UNKNOWN_SLOT'
  | 'SLOT_EMPTY'
  | 'STOCK_CHANGED'
  | 'PRICE_CHANGED'
  | 'NOT_ENOUGH_GOLD'
  | 'INVENTORY_FULL'
  | 'NOT_IN_INVENTORY'
  | 'ITEM_EQUIPPED'
  | 'NOT_SELLABLE'
  | 'NOT_EQUIPPABLE'
  | 'NOT_USABLE'
  | 'HP_FULL'
  | 'NO_REFRESH_CHARGES'
  | 'CHARGES_FULL';

/** null = done (the draft was changed); otherwise nothing changed. */
export type ItemError = { code: ItemErrorCode; message: string } | null;

const err = (code: ItemErrorCode, message: string): ItemError => ({ code, message });
const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);

function listingOf(entry: MerchantPoolEntry): MerchantListing {
  const def = getItemDef(entry.defId);
  if (!def || def.buyPrice === undefined) throw new Error(`Merchant pool item ${entry.defId} has no buyPrice`);
  return { defId: entry.defId, quantity: entry.quantity, unitPrice: def.buyPrice };
}

/**
 * Picks up to `count` pool entries without duplicates (and none whose defId is in `exclude`), in the order drawn:
 * one seeded draw per pick, from the entries still left. Pure: returns the advanced RNG.
 */
export function rollPoolListings(
  rng: RngState,
  count: number,
  exclude: ReadonlySet<string> = new Set(),
  pool: readonly MerchantPoolEntry[] = MERCHANT.pool,
): { listings: MerchantListing[]; rng: RngState } {
  const left = pool.filter((e) => !exclude.has(e.defId));
  const listings: MerchantListing[] = [];
  let r = rng;
  while (listings.length < count && left.length > 0) {
    const pick = nextInt(r, 0, left.length - 1);
    r = pick.rng;
    listings.push(listingOf(left[pick.value]));
    left.splice(pick.value, 1);
  }
  return { listings, rng: r };
}

/**
 * The stock a refresh produces: `slots` slots; slot 1 is always MERCHANT.fixed (Health Potion ×10), the others are
 * rolled from MERCHANT.pool with the seeded RNG, without duplicates (empty when the pool runs out).
 */
export function rollStock(rng: RngState, slots: number): { stock: (MerchantListing | null)[]; rng: RngState } {
  const n = Math.max(0, slots);
  const stock: (MerchantListing | null)[] = Array.from({ length: n }, () => null);
  if (n === 0) return { stock, rng };
  stock[0] = listingOf(MERCHANT.fixed);
  const rolled = rollPoolListings(rng, n - 1, new Set([MERCHANT.fixed.defId]));
  rolled.listings.forEach((l, i) => (stock[i + 1] = l));
  return { stock, rng: rolled.rng };
}

/** A new save's stock (not rolled): slot 1, then MERCHANT.starter in order, `slots` slots in all. */
export function starterStock(slots: number): (MerchantListing | null)[] {
  const n = Math.max(0, slots);
  const entries = [MERCHANT.fixed, ...MERCHANT.starter];
  return Array.from({ length: n }, (_, i) => (entries[i] ? listingOf(entries[i]) : null));
}

/** A new hero's merchant: full charges and the starter stock. */
export function newMerchantState(slots: number): MerchantState {
  return { charges: MERCHANT.maxCharges, chargeProgressMs: 0, stock: starterStock(slots) };
}

/**
 * The Merchant reached a level with more stock slots: the new slots are filled at once from the pool (seeded RNG,
 * no duplicate of a listing still in stock). A stock already that long (a pre-1.10.0 stock) is kept as it is.
 * Mutates the draft (draft.merchant and draft.rng are replaced).
 */
export function growStock(draft: GameState): void {
  const slots = merchantStockSlots(draft);
  const stock = draft.merchant.stock;
  if (stock.length >= slots) return;
  const present = new Set(stock.filter((l): l is MerchantListing => l !== null).map((l) => l.defId));
  present.add(MERCHANT.fixed.defId);
  const rolled = rollPoolListings(draft.rng, slots - stock.length, present);
  draft.rng = rolled.rng;
  const extra: (MerchantListing | null)[] = Array.from({ length: slots - stock.length }, (_, i) => rolled.listings[i] ?? null);
  draft.merchant = { ...draft.merchant, stock: [...stock, ...extra] };
}

/**
 * Adds charge regen for `elapsedMs` of accepted time (simulate passes the uncapped requestedMs). Never above
 * max; at max the remainder is 0, so time spent full is not banked. Same object when nothing changes.
 */
export function regenMerchantCharges(m: MerchantState, elapsedMs: number, intervalMs: number = MERCHANT.chargeIntervalMs, max: number = MERCHANT.maxCharges): MerchantState {
  if (m.charges >= max) return m.chargeProgressMs === 0 ? m : { ...m, chargeProgressMs: 0 };
  if (!(elapsedMs > 0)) return m;
  const banked = m.chargeProgressMs + elapsedMs;
  const gained = Math.floor(banked / intervalMs);
  const charges = Math.min(max, m.charges + gained);
  return { ...m, charges, chargeProgressMs: charges >= max ? 0 : banked - gained * intervalMs };
}

export type MerchantView = {
  charges: number;
  maxCharges: number;
  full: boolean;
  /** ms to the next charge (0 when full). */
  nextInMs: number;
  stock: readonly (MerchantListing | null)[];
};

/** Read-only view for UIs. */
export function merchantView(state: Pick<GameState, 'merchant'>): MerchantView {
  const { charges, chargeProgressMs, stock } = state.merchant;
  const full = charges >= MERCHANT.maxCharges;
  return { charges, maxCharges: MERCHANT.maxCharges, full, nextInMs: full ? 0 : Math.max(0, MERCHANT.chargeIntervalMs - chargeProgressMs), stock };
}

/** Spends one charge and restocks (rollStock with the Merchant level's slot count). Mutates the draft. */
export function refreshMerchant(draft: GameState): ItemError {
  const m = draft.merchant;
  if (m.charges <= 0) return err('NO_REFRESH_CHARGES', 'No refresh charges left');
  const rolled = rollStock(draft.rng, merchantStockSlots(draft));
  draft.rng = rolled.rng;
  draft.merchant = { charges: m.charges - 1, chargeProgressMs: m.chargeProgressMs, stock: rolled.stock };
  return null;
}

/** Debug: +1 charge (never above max). Mutates the draft. */
export function addMerchantCharge(draft: GameState): ItemError {
  const m = draft.merchant;
  if (m.charges >= MERCHANT.maxCharges) return err('CHARGES_FULL', `Refresh charges are already ${MERCHANT.maxCharges}/${MERCHANT.maxCharges}`);
  const charges = m.charges + 1;
  draft.merchant = { ...m, charges, chargeProgressMs: charges >= MERCHANT.maxCharges ? 0 : m.chargeProgressMs };
  return null;
}

/** Inventory slots a purchase of `quantity` units would take: a stackable merges into its stack. */
export function slotsNeeded(state: Pick<GameState, 'inventory'>, defId: string, quantity: number): number {
  const def = getItemDef(defId);
  if (!def) return quantity;
  if (def.stackable) return state.inventory.items.some((i) => i.stackable && i.defId === defId) ? 0 : 1;
  return quantity;
}

/** Most units of a stock slot the player can buy now: min(stock, affordable, fits). 0 when none. */
export function maxBuyable(state: Pick<GameState, 'inventory' | 'merchant' | 'character'>, slot: number): number {
  const listing = state.merchant.stock[slot];
  if (!listing) return 0;
  const affordable = listing.unitPrice > 0 ? Math.floor(state.character.gold / listing.unitPrice) : listing.quantity;
  const def = getItemDef(listing.defId);
  const free = freeSlots(state.inventory);
  const fits = def?.stackable ? (slotsNeeded(state, listing.defId, 1) <= free ? listing.quantity : 0) : free;
  return Math.max(0, Math.min(listing.quantity, affordable, fits));
}

/**
 * Buys `quantity` units from stock slot `slot`. Bound to what the player saw: `defId` must still be in that
 * slot (STOCK_CHANGED) and its unit price at most `maxUnitPrice` (PRICE_CHANGED). Mutates the draft.
 */
export function buyItem(draft: GameState, slot: unknown, defId: unknown, quantity: unknown, maxUnitPrice: unknown): ItemError {
  const stock = draft.merchant.stock;
  if (!isWhole(slot) || slot < 0 || slot >= stock.length) return err('UNKNOWN_SLOT', `Invalid stock slot ${String(slot)}`);
  if (!isWhole(maxUnitPrice) || maxUnitPrice < 0) return err('INVALID_AMOUNT', `Invalid maxUnitPrice ${String(maxUnitPrice)}`);
  const listing = stock[slot];
  if (!listing) return err('SLOT_EMPTY', 'That stock slot is empty');
  if (listing.defId !== defId) return err('STOCK_CHANGED', 'The merchant restocked that slot');
  if (!isWhole(quantity) || quantity < 1 || quantity > listing.quantity) {
    return err('INVALID_AMOUNT', `Quantity must be 1 to ${listing.quantity}`);
  }
  if (listing.unitPrice > maxUnitPrice) return err('PRICE_CHANGED', `The price is now ${listing.unitPrice}, more than the ${maxUnitPrice} shown`);
  const def = getItemDef(listing.defId);
  if (!def) return err('STOCK_CHANGED', `Unknown item ${listing.defId}`);
  const total = listing.unitPrice * quantity;
  const gold = draft.character.gold;
  if (!isWhole(gold) || gold < total) return err('NOT_ENOUGH_GOLD', `Costs ${total} gold, you have ${gold}`);
  if (slotsNeeded(draft, def.id, quantity) > freeSlots(draft.inventory)) return err('INVENTORY_FULL', 'Not enough free inventory slots');

  draft.character.gold = gold - total;
  if (def.stackable) {
    addStackable(draft.inventory, def.id, quantity);
  } else {
    for (let n = 0; n < quantity; n += 1) {
      draft.inventory.items.push(makeItem(def.id, 1, `${def.id}#${draft.nextItemSerial}`));
      draft.nextItemSerial += 1;
    }
  }
  const left = listing.quantity - quantity;
  stock[slot] = left > 0 ? { ...listing, quantity: left } : null;
  return null;
}

/** Sells `quantity` of inventory item `itemId` at sellPriceOf() (catalog price + building bonus). Equipped items are refused. Mutates the draft. */
export function sellItem(draft: GameState, itemId: unknown, quantity: unknown): ItemError {
  if (typeof itemId !== 'string') return err('INVALID_COMMAND', 'Missing itemId');
  const items = draft.inventory.items;
  const index = items.findIndex((i) => i.id === itemId);
  if (index < 0) {
    const equipped = Object.values(draft.character.equipment).some((i) => i?.id === itemId);
    return equipped ? err('ITEM_EQUIPPED', 'Unequip it first') : err('NOT_IN_INVENTORY', 'That item is not in the inventory');
  }
  const item = items[index];
  const def = getItemDef(item.defId);
  if (!def || !(def.sellPrice > 0)) return err('NOT_SELLABLE', 'The merchant does not buy that');
  const owned = item.stackable ? (item.quantity ?? 0) : 1;
  if (!isWhole(quantity) || quantity < 1 || quantity > owned) return err('INVALID_AMOUNT', `Quantity must be 1 to ${owned}`);
  // Town Hall Lv2+ adds to every sell price (floored); still below every buy price (tested).
  const gold = draft.character.gold + sellPriceOf(draft, def.id) * quantity;
  if (!isWhole(gold)) return err('INVALID_AMOUNT', 'Gold would overflow');
  draft.character.gold = gold;
  if (quantity === owned) items.splice(index, 1);
  else item.quantity = owned - quantity;
  return null;
}
