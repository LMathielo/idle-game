// Merchant (data). Rules in src/engine/merchant.ts and docs/ENGINE.md ("Merchant").

const HOUR_MS = 60 * 60 * 1000;

/** One stock entry. `quantity` units of `defId`, priced per unit at the item's catalog buyPrice. */
export type MerchantPoolEntry = { defId: string; quantity: number };

export const MERCHANT = {
  /** Refresh charges stored at most. Charges beyond this are lost. */
  maxCharges: 5,
  /** +1 refresh charge per interval while below max (uncapped by the 8 h offline cap; max bounds it). */
  chargeIntervalMs: 2 * HOUR_MS,
  /**
   * What a refresh stocks (5 listings since 2026-10-28: the Iron Pickaxe follows the Iron Axe). Today every refresh fills the first slots with exactly these listings, in order
   * (the rest stay empty). A later seeded, rarity-tiered roll replaces rollStock() and reads a bigger pool.
   */
  pool: [
    { defId: 'health_potion_t1', quantity: 10 },
    { defId: 'iron_axe', quantity: 1 },
    { defId: 'iron_pickaxe', quantity: 1 },
    { defId: 'iron_sword', quantity: 1 },
    { defId: 'iron_helm', quantity: 1 },
  ] as const satisfies readonly MerchantPoolEntry[],
} as const;
