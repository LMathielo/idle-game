// Merchant (data). Rules in src/engine/merchant.ts and docs/ENGINE.md ("Merchant").
// Random stock pool owner-approved 2026-10-28 (engine 1.10.0).

const HOUR_MS = 60 * 60 * 1000;

/** One stock entry. `quantity` units of `defId`, priced per unit at the item's catalog buyPrice. */
export type MerchantPoolEntry = { defId: string; quantity: number };

export const MERCHANT = {
  /** Refresh charges stored at most. Charges beyond this are lost. */
  maxCharges: 5,
  /** +1 refresh charge per interval while below max (uncapped by the 8 h offline cap; max bounds it). */
  chargeIntervalMs: 2 * HOUR_MS,
  /** Stock slot 1 on every refresh. */
  fixed: { defId: 'health_potion_t1', quantity: 10 } as const satisfies MerchantPoolEntry,
  /**
   * The other slots are rolled from this pool on every refresh (seeded RNG, no duplicates). The number of slots
   * comes from the Merchant building's level (config/buildings.ts: 5 at Lv1 … 13 at Lv5, so Lv5 shows every entry).
   */
  pool: [
    { defId: 'iron_axe', quantity: 1 },
    { defId: 'iron_pickaxe', quantity: 1 },
    { defId: 'iron_sword', quantity: 1 },
    { defId: 'iron_helm', quantity: 1 },
    { defId: 'iron_chestplate', quantity: 1 },
    { defId: 'iron_shield', quantity: 1 },
    { defId: 'iron_gloves', quantity: 1 },
    { defId: 'iron_boots', quantity: 1 },
    { defId: 'greater_health_potion', quantity: 5 },
    { defId: 'steel_axe', quantity: 1 },
    { defId: 'steel_pickaxe', quantity: 1 },
    { defId: 'steel_sword', quantity: 1 },
  ] as const satisfies readonly MerchantPoolEntry[],
  /**
   * A new save's stock, before any refresh (not rolled, so a new hero always finds the iron tools that open the
   * second tree and rock): slot 1, then these, in order.
   */
  starter: [
    { defId: 'iron_axe', quantity: 1 },
    { defId: 'iron_pickaxe', quantity: 1 },
    { defId: 'iron_sword', quantity: 1 },
    { defId: 'iron_helm', quantity: 1 },
  ] as const satisfies readonly MerchantPoolEntry[],
} as const;
