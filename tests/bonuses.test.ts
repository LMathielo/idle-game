// Building bonuses (1.10.0): data per building level; bonuses add together.
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  BUILDING_IDS,
  BUILDING_MAX_LEVEL,
  BUILDINGS,
  type BuildingId,
  type GameState,
  ITEMS,
  merchantStockSlots,
  sellPriceBonusBp,
  sellPriceOf,
  simulate,
  upgradeView,
  woodcuttingView,
  workerCap,
  yieldMultiplierBp,
} from '../src/engine';
import { apply, builtGame, cmd, MIN, SEC, T0 } from './helpers';

function at(levels: Partial<Record<BuildingId, number>>, seed = 4): GameState {
  const s = builtGame(seed, T0);
  const buildings = { ...s.buildings };
  for (const [id, level] of Object.entries(levels)) buildings[id as BuildingId] = { state: 'built', level: level! };
  return { ...s, buildings };
}

describe('bonus data', () => {
  it('every building has one bonus row per level', () => {
    for (const id of BUILDING_IDS) expect(BUILDINGS[id].levels).toHaveLength(BUILDING_MAX_LEVEL);
  });

  it('Town Hall Lv2+: +20% wood and stone/ore yield; Woodcutting and Mine Shaft: +20% of their skill per level above 1', () => {
    expect(yieldMultiplierBp(at({}), 'woodcutting')).toBe(10_000);
    expect(yieldMultiplierBp(at({ town_hall: 2 }), 'woodcutting')).toBe(12_000);
    expect(yieldMultiplierBp(at({ town_hall: 2 }), 'mining')).toBe(12_000);
    expect(yieldMultiplierBp(at({ town_hall: 5 }), 'mining')).toBe(12_000); // Lv3–5 add no new passive bonus yet
    expect([1, 2, 3, 4, 5].map((l) => yieldMultiplierBp(at({ town_hall: 5, woodcutting: l }), 'woodcutting'))).toEqual([12_000, 14_000, 16_000, 18_000, 20_000]);
    // The Woodcutting building never touches mining, nor the Mine Shaft woodcutting.
    expect(yieldMultiplierBp(at({ woodcutting: 5 }), 'mining')).toBe(10_000);
    expect(yieldMultiplierBp(at({ town_hall: 3, mine_shaft: 3 }), 'mining')).toBe(16_000);
    expect(yieldMultiplierBp(at({ town_hall: 3, mine_shaft: 3 }), 'woodcutting')).toBe(12_000);
  });

  it('a locked building gives nothing', () => {
    const s = at({});
    const locked = { ...s, buildings: { ...s.buildings, town_hall: { state: 'locked' as const, level: 0 } } };
    expect(workerCap(locked)).toBe(0);
    expect(yieldMultiplierBp(locked, 'woodcutting')).toBe(10_000);
  });

  it('worker cap by Town Hall level: 5 / 7 / 9 / 12 / 15', () => {
    expect([1, 2, 3, 4, 5].map((l) => workerCap(at({ town_hall: l })))).toEqual([5, 7, 9, 12, 15]);
  });

  it('merchant stock slots = 5 + 2 × (level − 1): 5 / 7 / 9 / 11 / 13', () => {
    expect([1, 2, 3, 4, 5].map((l) => merchantStockSlots(at({ merchant: l })))).toEqual([5, 7, 9, 11, 13]);
  });

  it('upgrade view shows current and next-level bonuses', () => {
    expect(upgradeView(at({ town_hall: 1 }), 'town_hall')).toMatchObject({ bonuses: { workerCap: 5 }, nextBonuses: { workerCap: 7, sellPriceBp: 2000 } });
    expect(upgradeView(at({ town_hall: 5, woodcutting: 5 }), 'woodcutting')).toMatchObject({ bonuses: { yieldBp: { woodcutting: 8000 } }, nextBonuses: null });
  });
});

describe('bonuses in play', () => {
  it('the hero yield follows the multiplier: WS 21 on Oak is 1.05 at TH1, 1.26 at TH2, 2.10 at TH5 + Woodcutting Lv5', () => {
    expect(woodcuttingView(at({})).trees[0].yieldBp).toBe(10_500);
    expect(woodcuttingView(at({ town_hall: 2 })).trees[0].yieldBp).toBe(12_600);
    expect(woodcuttingView(at({ town_hall: 5, woodcutting: 5 })).trees[0].yieldBp).toBe(21_000);
    // In play: 19 cuts (still WC Lv1) give 2 or 3 logs each.
    const s = apply(at({ town_hall: 5, woodcutting: 5 }), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0);
    const r = simulate(s, T0 + 19 * (2 * MIN - 10 * SEC));
    expect(r.summary.actions).toBe(19);
    expect(r.summary.itemsGained.oak_logs).toBeGreaterThanOrEqual(38);
    expect(r.summary.itemsGained.oak_logs).toBeLessThanOrEqual(57);
  });

  it('Town Hall Lv2+: +20% merchant sell prices, floored', () => {
    const s = at({ town_hall: 2 });
    expect(sellPriceBonusBp(s)).toBe(2000);
    expect(sellPriceOf(s, 'oak_logs')).toBe(1); // floor(1.2)
    expect(sellPriceOf(s, 'health_potion_t1')).toBe(6);
    expect(sellPriceOf(s, 'iron_axe')).toBe(216);
    expect(sellPriceOf(at({}), 'iron_axe')).toBe(180);
    const withAxe = { ...s, inventory: { ...s.inventory, items: [...s.inventory.items, { id: 'iron_axe#9', defId: 'iron_axe', name: 'Iron Axe', icon: '🪓', slot: 'axe' as const }] } };
    const r = applyCommand(withAxe, cmd({ type: 'SELL_ITEM', itemId: 'iron_axe#9', quantity: 1 }), T0);
    expect(r.ok && r.state.character.gold - s.character.gold).toBe(216);
  });

  it('no buy→sell loop: every sell price stays below its buy price with the largest sell bonus any level gives', () => {
    let maxBp = 0;
    for (const id of BUILDING_IDS) for (const l of BUILDINGS[id].levels) maxBp = Math.max(maxBp, l.sellPriceBp ?? 0);
    // Every building at its best sell bonus at once (an upper bound).
    let total = 0;
    for (const id of BUILDING_IDS) total += Math.max(0, ...BUILDINGS[id].levels.map((l) => l.sellPriceBp ?? 0));
    expect(maxBp).toBe(2000);
    const best = at({ town_hall: 5, woodcutting: 5, mine_shaft: 5, merchant: 5, training_grounds: 5 });
    expect(sellPriceBonusBp(best)).toBe(total);
    for (const def of Object.values(ITEMS)) {
      if (!('buyPrice' in def) || def.buyPrice === undefined) continue;
      expect(sellPriceOf(best, def.id)).toBeLessThan(def.buyPrice);
    }
  });
});
