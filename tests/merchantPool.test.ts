// Merchant random stock pool (1.10.0): slot 1 = Health Potion ×10, the other slots rolled from the pool with the
// seeded RNG, no duplicates; slot count from the Merchant's level; new iron and steel items.
import { describe, expect, it } from 'vitest';
import {
  gearPrice,
  applyCommand,
  type BuildingId,
  type GameState,
  getDerivedStats,
  getItemDef,
  MERCHANT,
  newGame,
  rollStock,
  simulate,
} from '../src/engine';
import { apply, builtGame, cmd, HOUR, T0 } from './helpers';

function withLevels(s: GameState, levels: Partial<Record<BuildingId, number>>): GameState {
  const buildings = { ...s.buildings };
  for (const [id, level] of Object.entries(levels)) buildings[id as BuildingId] = { state: 'built', level: level! };
  return { ...s, buildings };
}

describe('new items (owner-approved table)', () => {
  it('stats, slots and buy prices; sell = 30% of buy, floored', () => {
    const table: [string, Record<string, unknown>, number][] = [
      ['iron_chestplate', { slot: 'armor', armor: 10 }, 700],
      ['iron_shield', { slot: 'shield', armor: 8 }, 550],
      ['iron_gloves', { slot: 'gloves', armor: 3 }, 250],
      ['iron_boots', { slot: 'boots', armor: 3 }, 250],
      ['greater_health_potion', { heal: 60, stackable: true }, 30],
      ['steel_axe', { slot: 'axe', woodcuttingStrength: 192 }, 2500],
      ['steel_pickaxe', { slot: 'pickaxe', miningStrength: 192 }, 2500],
      ['steel_sword', { slot: 'weapon', damage: { min: 16, max: 22 } }, 2000],
    ];
    for (const [id, stats, buy] of table) {
      const def = getItemDef(id)!;
      expect(def).toMatchObject({ ...stats, buyPrice: buy });
      expect(def.sellPrice).toBe(Math.floor((buy * 30) / 100));
      expect(def.sellPrice).toBeLessThan(buy);
    }
    expect(MERCHANT.pool.find((e) => e.defId === 'greater_health_potion')?.quantity).toBe(5);
  });

  it('armor from every equipped slot counts toward defense (armor, shield, helmet, gloves, boots)', () => {
    const s = builtGame(1, T0);
    const gear = (defId: string) => ({ id: `${defId}#1`, defId, name: defId, icon: '?', slot: getItemDef(defId)!.slot });
    const equipment = { ...s.character.equipment, armor: gear('iron_chestplate'), shield: gear('iron_shield'), helmet: gear('iron_helm'), gloves: gear('iron_gloves'), boots: gear('iron_boots') };
    const d = getDerivedStats({ ...s, character: { ...s.character, equipment } });
    expect(d.defense.value).toBe(6 + 5 + 4 + 2 + 2 + 10); // + END 10
    expect(d.defense.breakdown.filter((p) => p.source === 'armor').map((p) => p.slot).sort()).toEqual(['armor', 'boots', 'gloves', 'helmet', 'shield']);
  });
});

describe('rolled stock', () => {
  it('slot 1 is always Health Potion ×10; the rest come from the pool without duplicates', () => {
    let rng = { seed: 123 };
    for (let i = 0; i < 300; i += 1) {
      const slots = 5 + 2 * (i % 5);
      const r = rollStock(rng, slots);
      rng = r.rng;
      expect(r.stock).toHaveLength(slots);
      expect(r.stock[0]).toEqual({ defId: 'health_potion_t1', quantity: 10, unitPrice: 12 });
      const rest = r.stock.slice(1).map((l) => l!.defId);
      expect(new Set(rest).size).toBe(rest.length);
      for (const id of rest) expect(MERCHANT.pool.some((e) => e.defId === id)).toBe(true);
      // 1.14.0: gear prices follow the rolled rarity (tests/gear.test.ts); the rest are catalog prices.
      for (const l of r.stock) expect(l!.unitPrice).toBe(l!.quality === undefined ? getItemDef(l!.defId)!.buyPrice : gearPrice(getItemDef(l!.defId)!.buyPrice!, l!.rarity!));
    }
  });

  it('every pool item shows up over many refreshes; Lv5 (13 slots) shows the whole pool', () => {
    const seen = new Set<string>();
    let rng = { seed: 7 };
    for (let i = 0; i < 100; i += 1) {
      const r = rollStock(rng, 5);
      rng = r.rng;
      for (const l of r.stock) seen.add(l!.defId);
    }
    expect(seen.size).toBe(MERCHANT.pool.length + 1);
    const full = rollStock({ seed: 9 }, 13).stock.map((l) => l!.defId);
    expect(new Set(full)).toEqual(new Set(['health_potion_t1', ...MERCHANT.pool.map((e) => e.defId)]));
    // Asking for more slots than the pool holds leaves the extra slots empty.
    expect(rollStock({ seed: 9 }, 15).stock.slice(13)).toEqual([null, null]);
  });

  it('deterministic: the same seed gives the same stock', () => {
    expect(rollStock({ seed: 42 }, 9)).toEqual(rollStock({ seed: 42 }, 9));
  });

  it('REFRESH_MERCHANT rolls as many slots as the Merchant level gives: 5 / 7 / 9 / 11 / 13', () => {
    for (const [level, slots] of [[1, 5], [2, 7], [3, 9], [4, 11], [5, 13]] as const) {
      const s = withLevels(builtGame(level, T0), { town_hall: 5, merchant: level });
      const r = apply(s, { type: 'REFRESH_MERCHANT' }, T0);
      expect(r.merchant.stock).toHaveLength(slots);
    }
  });

  it('a new save keeps the fixed starter stock (not rolled), and newGame does not draw from the RNG', () => {
    const s = newGame(5, T0);
    expect(s.merchant.stock.map((l) => l?.defId)).toEqual(['health_potion_t1', 'iron_axe', 'iron_pickaxe', 'iron_sword', 'iron_helm']);
    expect(s.rng).toEqual({ seed: 5 });
  });

  it('a Merchant upgrade adds its new slots at once, rolled without duplicating what is still in stock', () => {
    const s = withLevels(builtGame(2, T0), { town_hall: 2 });
    const rich = { ...s, character: { ...s.character, gold: 10_000 }, inventory: { ...s.inventory, items: [
      { id: 'oak_logs', defId: 'oak_logs', name: 'Oak Logs', icon: '🪵', stackable: true, quantity: 25 },
      { id: 'stone', defId: 'stone', name: 'Stone', icon: '🪨', stackable: true, quantity: 25 },
    ] } };
    let u = apply(rich, { type: 'UPGRADE_BUILDING', buildingId: 'merchant', level: 2 }, T0);
    expect(u.merchant.stock).toHaveLength(5);
    u = simulate(u, T0 + HOUR).state;
    expect(u.buildings.merchant.level).toBe(2);
    expect(u.merchant.stock).toHaveLength(7);
    expect(u.merchant.stock.slice(0, 5)).toEqual(rich.merchant.stock);
    const ids = u.merchant.stock.map((l) => l!.defId);
    expect(new Set(ids).size).toBe(7);
  });

  it('a pre-1.10.0 stock (20 slots, 5 listings) is kept as it is until the next refresh', () => {
    const s = builtGame(3, T0);
    const legacy = { ...s, merchant: { ...s.merchant, stock: [...s.merchant.stock, ...Array.from({ length: 15 }, () => null)] } };
    const after = simulate(legacy, T0 + HOUR).state;
    expect(after.merchant.stock).toHaveLength(20);
    const r = applyCommand(legacy, cmd({ type: 'REFRESH_MERCHANT' }), T0 + HOUR);
    expect(r.ok && r.state.merchant.stock).toHaveLength(5);
  });
});
