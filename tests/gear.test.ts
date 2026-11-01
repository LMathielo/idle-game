// Gear quality and rarity (engine 1.14.0): the stat formula (quality = integer percent), the rarity price multipliers,
// the catalog-wide quality-25 equivalence, the price invariants, instance-scaled stats in every reader (damage, defense,
// WS / MS and the tree / rock gates), and the Merchant's gear rolls (0–50, common / uncommon / rare, own stream).
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  baseSellPrice,
  GEAR,
  GEAR_PIECE_IDS,
  GEAR_PIECES,
  GEAR_SETS,
  type GameState,
  getDerivedStats,
  getItemDef,
  type Item,
  type ItemDef,
  ITEMS,
  isGearDef,
  MERCHANT,
  miningStrength,
  RECIPE_IDS,
  RECIPES,
  gearPrice,
  type ItemRarity,
  scaleGearStat,
  sellPriceOfItem,
  woodcuttingStrength,
} from '../src/engine';
import { cloneState } from '../src/engine/clone';
import { makeItem } from '../src/engine/inventory';
import { rollPoolListings, rollStock } from '../src/engine/merchant';
import { builtGame, cmd, T0 } from './helpers';

const ALL = Object.values(ITEMS) as ItemDef[];
const GEAR_DEFS = ALL.filter(isGearDef);

/**
 * The catalog numbers before 1.14.0 (frozen): every gear stat, so the 25% test proves nothing changed for old gear.
 * Damage [min, max]; armor, WS or MS a number.
 */
const PRE_114: Record<string, { damage?: [number, number]; armor?: number; ws?: number; ms?: number }> = {
  rusty_gladius: { damage: [2, 4] },
  linen_tunic: { armor: 2 },
  worn_sandals: { armor: 1 },
  wooden_axe: { ws: 1 },
  iron_axe: { ws: 40 },
  wooden_pickaxe: { ms: 1 },
  iron_pickaxe: { ms: 40 },
  iron_sword: { damage: [6, 9] },
  iron_helm: { armor: 4 },
  iron_chestplate: { armor: 6 },
  iron_shield: { armor: 5 },
  iron_gloves: { armor: 2 },
  iron_boots: { armor: 2 },
  steel_axe: { ws: 120 },
  steel_pickaxe: { ms: 120 },
  steel_sword: { damage: [10, 14] },
};

describe('formulas (config/gear.ts)', () => {
  it('stat = max(1, round(max × (100 + q) / 200)), half up, both ends of a range', () => {
    expect(scaleGearStat(10, 100)).toBe(10);
    expect(scaleGearStat(10, 0)).toBe(5);
    expect(scaleGearStat(3, 0)).toBe(2); // 1.5 → 2 (half up)
    expect(scaleGearStat(3, 25)).toBe(2); // 1.875
    expect(scaleGearStat(1, 0)).toBe(1); // 0.5 → 1, and never below 1
    expect(scaleGearStat(2, 0)).toBe(1);
    expect(scaleGearStat(14, 25)).toBe(9); // 8.75
    expect(scaleGearStat(6, 25)).toBe(4); // 3.75
    expect(scaleGearStat(64, 25)).toBe(40);
    expect(scaleGearStat(34, 73)).toBe(29); // 34 × 173 / 200 = 29.41
    expect(scaleGearStat(5, 50)).toBe(4); // 3.75 → 4
    for (let q = 0; q <= 100; q += 1) expect(scaleGearStat(34, q)).toBe(Math.max(1, Math.floor((34 * (100 + q) + 100) / 200)));
  });

  it('prices: floor(catalog price × rarity multiplier); common ×1, uncommon ×1.5, rare ×2, epic ×4; quality plays no part', () => {
    expect((['common', 'uncommon', 'rare', 'epic'] as ItemRarity[]).map((r) => gearPrice(500, r))).toEqual([500, 750, 1000, 2000]);
    expect(gearPrice(75, 'uncommon')).toBe(112); // 112.5 floored
    expect(baseSellPrice({ defId: 'iron_sword', rarity: 'rare' })).toBe(300);
    expect(baseSellPrice({ defId: 'iron_sword' })).toBe(150); // no instance rarity: the catalog's (common)
    expect(baseSellPrice({ defId: 'oak_logs', rarity: 'epic' })).toBe(1); // non-gear: catalog price
  });

  it('gear = every equippable item (tools included); config: Merchant 0–50 c70/u25/r5, crafting u75/r20/e5, drops 0–70', () => {
    expect(GEAR_DEFS.map((d) => d.id)).toEqual(expect.arrayContaining(Object.keys(PRE_114)));
    expect(GEAR_DEFS).toHaveLength(16 + 24);
    expect([GEAR.maxQuality, GEAR.defaultQuality, GEAR.merchant.maxQuality, GEAR.drops.maxQuality]).toEqual([100, 25, 50, 70]);
    expect(GEAR.merchant.rarityWeights).toEqual([
      { value: 'common', weight: 70 },
      { value: 'uncommon', weight: 25 },
      { value: 'rare', weight: 5 },
    ]);
    expect(GEAR.craft.rarityWeights).toEqual([
      { value: 'uncommon', weight: 75 },
      { value: 'rare', weight: 20 },
      { value: 'epic', weight: 5 },
    ]);
    expect([GEAR.craft.maxStamina, GEAR.craft.qualityPerStamina, GEAR.craft.minQuality]).toEqual([50, 1, 0]);
    expect(GEAR.rarityPricePct).toMatchObject({ common: 100, uncommon: 150, rare: 200, epic: 400 });
  });
});

describe('the catalog (100% maxima since 1.14.0)', () => {
  it('every old gear stat was rescaled to round(old × 1.6), and quality 25 gives exactly the old number back', () => {
    for (const [id, old] of Object.entries(PRE_114)) {
      const def = getItemDef(id)!;
      const r = (n: number) => Math.round(n * 1.6);
      if (old.damage) {
        expect(def.damage).toEqual({ min: r(old.damage[0]), max: r(old.damage[1]) });
        expect([scaleGearStat(def.damage!.min, 25), scaleGearStat(def.damage!.max, 25)]).toEqual(old.damage);
      }
      if (old.armor !== undefined) expect([def.armor, scaleGearStat(def.armor!, 25)]).toEqual([r(old.armor), old.armor]);
      if (old.ws !== undefined) expect([def.woodcuttingStrength, scaleGearStat(def.woodcuttingStrength!, 25)]).toEqual([r(old.ws), old.ws]);
      if (old.ms !== undefined) expect([def.miningStrength, scaleGearStat(def.miningStrength!, 25)]).toEqual([r(old.ms), old.ms]);
    }
  });

  it('a common piece keeps its catalog sell and buy price', () => {
    for (const def of GEAR_DEFS) {
      expect(baseSellPrice({ defId: def.id, rarity: 'common' })).toBe(def.sellPrice);
      if (def.buyPrice !== undefined) expect(gearPrice(def.buyPrice, 'common')).toBe(def.buyPrice);
    }
  });

  it('crafted sets: names, slots, T1–T5 maxima from the brief (T3 = the iron items), not sold by the Merchant', () => {
    const table: Record<string, (number | [number, number])[]> = {
      sword: [[4, 6], [7, 10], [10, 14], [16, 22], [24, 34]],
      helm: [2, 4, 6, 10, 15],
      chestplate: [3, 6, 10, 16, 24],
      shield: [3, 5, 8, 13, 20],
      gloves: [1, 2, 3, 5, 8],
      boots: [1, 2, 3, 5, 8],
    };
    for (const set of GEAR_SETS) {
      for (const piece of GEAR_PIECE_IDS) {
        const def = getItemDef(`${set.id}_${piece}`)!;
        expect(def.slot).toBe(GEAR_PIECES[piece].slot);
        const want = table[piece][set.tier - 1];
        if (Array.isArray(want)) expect(def.damage).toEqual({ min: want[0], max: want[1] });
        else expect(def.armor).toBe(want);
        if (set.id !== 'iron') {
          expect(def.name).toBe(`${set.name} ${GEAR_PIECES[piece].name}`);
          expect(def.buyPrice).toBeUndefined();
          expect(def.rarity).toBe('common');
          expect(MERCHANT.pool.some((e) => e.defId === def.id)).toBe(false);
        }
      }
    }
    expect(getItemDef('stone_sword')?.name).toBe('Stone Sword');
    expect(getItemDef('copper_helm')?.name).toBe('Copper Helm');
    expect(getItemDef('gold_boots')?.name).toBe('Gold Boots');
  });

  it('crafted pieces sell for max(1, floor(25% × the sell value of their inputs)); the iron items keep their prices', () => {
    for (const id of RECIPE_IDS) {
      const r = RECIPES[id];
      if (r.kind !== 'gear') continue;
      const value = r.inputs.reduce((n, i) => n + i.quantity * getItemDef(i.defId)!.sellPrice, 0);
      const def = getItemDef(r.output.defId)!;
      if (def.id.startsWith('iron_')) continue;
      expect(def.sellPrice).toBe(Math.max(1, Math.floor(value / 4)));
    }
    expect(['iron_sword', 'iron_helm', 'iron_chestplate', 'iron_shield', 'iron_gloves', 'iron_boots'].map((id) => getItemDef(id)!.sellPrice)).toEqual([150, 120, 210, 165, 75, 75]);
  });
});

describe('price invariants', () => {
  const thLv5 = (s: GameState): GameState => ({ ...s, buildings: { ...s.buildings, town_hall: { state: 'built', level: 5 } } });
  const RARITIES: ItemRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

  it('every gear item at every rarity sells (Town Hall +20%) for less than it costs', () => {
    const s = thLv5(builtGame(1, T0));
    for (const def of GEAR_DEFS) {
      if (def.buyPrice === undefined) continue;
      for (const rarity of RARITIES) expect(sellPriceOfItem(s, { defId: def.id, rarity })).toBeLessThan(gearPrice(def.buyPrice, rarity));
    }
  });

  it('every gear recipe: the expected sell value of its piece (its rarity odds × multipliers, Town Hall +20%) is below its inputs', () => {
    // Owner-accepted 2026-11-01: a single epic (×4) can sell above its inputs; on average a craft loses value.
    const s = thLv5(builtGame(1, T0));
    for (const id of RECIPE_IDS) {
      const r = RECIPES[id];
      if (r.kind !== 'gear') continue;
      const inputs = r.inputs.reduce((n, i) => n + i.quantity * sellPriceOfItem(s, { defId: i.defId }), 0);
      const weights = r.rarityWeights ?? GEAR.craft.rarityWeights;
      const total = weights.reduce((n, w) => n + w.weight, 0);
      const expected = weights.reduce((n, w) => n + (w.weight / total) * sellPriceOfItem(s, { defId: r.output.defId, rarity: w.value }), 0);
      expect(expected).toBeLessThan(inputs);
    }
  });
});

describe('every reader uses the instance-scaled stats', () => {
  const equip = (s: GameState, item: Item): GameState => {
    const d = cloneState(s);
    d.character.equipment[item.slot!] = item;
    return d;
  };

  it('damage and defense scale with the equipped pieces’ quality', () => {
    const s = builtGame(1, T0);
    const base = getDerivedStats(s);
    const low = equip(s, makeItem('gold_sword', 1, 'x', { quality: 0, rarity: 'rare' }));
    const high = equip(s, makeItem('gold_sword', 1, 'x', { quality: 100, rarity: 'rare' }));
    const strFlat = base.damage.min - 2; // the starting Rusty Gladius at 25% = 2–4
    expect(getDerivedStats(low).damage).toMatchObject({ min: 12 + strFlat, max: 17 + strFlat });
    expect(getDerivedStats(high).damage).toMatchObject({ min: 24 + strFlat, max: 34 + strFlat });
    const helm = equip(s, makeItem('gold_helm', 1, 'h', { quality: 73, rarity: 'epic' }));
    expect(getDerivedStats(helm).defense.value - base.defense.value).toBe(scaleGearStat(15, 73)); // 13
  });

  it('WS / MS scale with the tool’s quality, and the tree / rock gate follows (the stop rule reads the same WS)', () => {
    const s = builtGame(1, T0);
    expect(woodcuttingStrength(s).value).toBe(21); // 10 + STR 10 + Wooden Axe 1 (25%)
    const iron0 = equip(s, makeItem('iron_axe', 1, 'a', { quality: 0, rarity: 'common' }));
    const iron50 = equip(s, makeItem('iron_axe', 1, 'a', { quality: 50, rarity: 'common' }));
    expect(woodcuttingStrength(iron0).value).toBe(20 + 32);
    expect(woodcuttingStrength(iron50).value).toBe(20 + 48);
    const pick = equip(s, makeItem('steel_pickaxe', 1, 'p', { quality: 100, rarity: 'common' }));
    expect(miningStrength(pick).value).toBe(20 + 192);
    // Birch needs Woodcutting Lv5 and WS 100: Lv5 + STR 10 = 60, so a 0% Iron Axe (+32) is refused, a 50% one (+48) works.
    const lv = (x: GameState) => ({ ...x, character: { ...x.character, skills: { ...x.character.skills, woodcutting: { level: 5, xp: 0, xpToNext: 999_999 } } } });
    const birch = (x: GameState) => applyCommand(lv(x), cmd({ type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'birch' }), T0);
    const r0 = birch(iron0);
    expect(r0.ok ? 'ok' : r0.error.code).not.toBe('ok');
    const r50 = birch(iron50);
    if (!r50.ok) throw new Error(r50.error.message);
    // The stop rule: swapping in the 0% axe drops WS below 100 and woodcutting stops.
    const bag = cloneState(r50.state);
    bag.inventory.items.push(makeItem('iron_axe', 1, 'weak', { quality: 0, rarity: 'common' }));
    const swapped = applyCommand(bag, cmd({ type: 'EQUIP_ITEM', itemId: 'weak' }), T0 + 1000);
    if (!swapped.ok) throw new Error(swapped.error.message);
    expect(r50.state.activity).toMatchObject({ kind: 'woodcutting', treeId: 'birch' });
    expect(swapped.state.activity).toBeNull();
  });
});

describe('Merchant gear rolls', () => {
  it('gear listings: one piece, quality 0..50 (both ends), never epic or above, price = buy × rarity multiplier; others unchanged', () => {
    const counts: Record<string, number> = {};
    let n = 0;
    const seen = new Set<number>();
    let rng = { seed: 99 };
    for (let i = 0; i < 4000; i += 1) {
      const r = rollStock(rng, 13);
      rng = r.rng;
      for (const l of r.stock) {
        if (!l) continue;
        const def = getItemDef(l.defId)!;
        if (!isGearDef(def)) {
          expect(l).toEqual({ defId: l.defId, quantity: l.quantity, unitPrice: def.buyPrice });
          continue;
        }
        expect(l.quantity).toBe(1);
        expect(l.quality).toBeGreaterThanOrEqual(0);
        expect(l.quality).toBeLessThanOrEqual(50);
        expect(Number.isInteger(l.quality)).toBe(true);
        seen.add(l.quality!);
        expect(l.unitPrice).toBe(gearPrice(def.buyPrice!, l.rarity!));
        counts[l.rarity!] = (counts[l.rarity!] ?? 0) + 1;
        n += 1;
      }
    }
    expect(seen.size).toBe(51); // every integer 0..50
    expect(Object.keys(counts).sort()).toEqual(['common', 'rare', 'uncommon']);
    expect(counts.common / n).toBeCloseTo(0.7, 1);
    expect(counts.uncommon / n).toBeCloseTo(0.25, 1);
    expect(counts.rare / n).toBeCloseTo(0.05, 1);
  });

  it('the gear rolls never move the main RNG: the same picks and the same advanced RNG as without them', () => {
    const r = rollPoolListings({ seed: 5 }, 6);
    const again = rollPoolListings({ seed: 5 }, 6);
    expect(again).toEqual(r);
    // A pool without gear advances the RNG exactly as much: one draw per pick, nothing for the rolls.
    const potions = rollPoolListings({ seed: 5 }, 1, new Set(), [{ defId: 'greater_health_potion', quantity: 5 }]);
    const oneGear = rollPoolListings({ seed: 5 }, 1, new Set(), [{ defId: 'iron_axe', quantity: 1 }]);
    expect(oneGear.rng).toEqual(potions.rng);
    expect(oneGear.listings[0].quality).toBeDefined();
  });

  it('buying a rolled piece gives an instance with that roll; it sells by its rarity', () => {
    const s = cloneState(builtGame(3, T0));
    s.character.gold = 100_000;
    s.merchant.stock[1] = { defId: 'iron_sword', quantity: 1, unitPrice: 750, quality: 43, rarity: 'uncommon' };
    const r = applyCommand(s, cmd({ type: 'BUY_ITEM', slot: 1, defId: 'iron_sword', quantity: 1, maxUnitPrice: 750 }), T0);
    if (!r.ok) throw new Error(r.error.message);
    const item = r.state.inventory.items.find((i) => i.defId === 'iron_sword')!;
    expect(item).toMatchObject({ quality: 43, rarity: 'uncommon' });
    expect(r.state.character.gold).toBe(100_000 - 750); // 500 × 1.5
    const sold = applyCommand(r.state, cmd({ type: 'SELL_ITEM', itemId: item.id, quantity: 1 }), T0);
    if (!sold.ok) throw new Error(sold.error.message);
    expect(sold.state.character.gold - r.state.character.gold).toBe(sellPriceOfItem(r.state, item));
    expect(sellPriceOfItem(r.state, item)).toBe(225); // 150 × 1.5
  });
});
