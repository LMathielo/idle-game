// Legs slot, greaves, and the crafted axes / pickaxes (engine 1.21.0, owner-approved 2026-11-05).
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  EQUIPMENT_SLOTS,
  type GameState,
  getDerivedStats,
  getItemDef,
  GEAR_PIECES,
  miningStrength,
  RECIPES,
  simulate,
  woodcuttingStrength,
} from '../src/engine';
import { cloneState } from '../src/engine/clone';
import { addStackable, makeItem } from '../src/engine/inventory';
import { builtGame, cmd, HOUR, T0 } from './helpers';

type Input = Parameters<typeof cmd>[0];

function ok(s: GameState, c: Input, at = T0): GameState {
  const r = applyCommand(s, cmd(c), at);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
}

/** Crafts `recipeId` with the stamina rule off, collects it and returns the state and the new item id. */
function craft(recipeId: keyof typeof RECIPES): { s: GameState; id: string } {
  let s = cloneState(builtGame(3, T0));
  for (const i of RECIPES[recipeId].inputs) addStackable(s.inventory, i.defId, i.quantity);
  s = ok(s, { type: 'START_CRAFT', pipe: 0, recipeId, maxCost: 0, stamina: 0 });
  s = simulate(s, T0 + 100 * HOUR).state;
  const before = new Set(s.inventory.items.map((i) => i.id));
  s = ok(s, { type: 'COLLECT_CRAFT', pipe: 0, jobId: s.crafting.pipes[0]!.id }, T0 + 100 * HOUR);
  const item = s.inventory.items.find((i) => !before.has(i.id))!;
  return { s, id: item.id };
}

describe('legs slot', () => {
  it('exists; greaves equip there, add armor, and unequip', () => {
    expect(EQUIPMENT_SLOTS).toContain('legs');
    expect(getItemDef('gold_greaves')).toMatchObject({ slot: 'legs', armor: 20, name: 'Gold Greaves' });
    const s0 = cloneState(builtGame(1, T0));
    const bare = getDerivedStats(s0).armor.value;
    s0.inventory.items.push(makeItem('iron_greaves', 1, 'g1', { quality: 100, rarity: 'common' }));
    const worn = ok(s0, { type: 'EQUIP_ITEM', itemId: 'g1' });
    expect(worn.character.equipment.legs?.id).toBe('g1');
    expect(getDerivedStats(worn).armor.value).toBe(bare + 8);
    expect(getDerivedStats(worn).armor.breakdown).toContainEqual({ source: 'armor', value: 8, defId: 'iron_greaves', slot: 'legs' });
    const off = ok(worn, { type: 'UNEQUIP_ITEM', slot: 'legs' });
    expect(off.character.equipment.legs).toBeUndefined();
    expect(off.inventory.items.some((i) => i.id === 'g1')).toBe(true);
    expect(getDerivedStats(off).armor.value).toBe(bare);
  });
});

describe('crafting greaves, axes and pickaxes', () => {
  it('a greaves recipe goes through the gear-job flow and equips into legs', () => {
    const r = RECIPES.copper_greaves;
    expect(r).toMatchObject({ kind: 'gear', tier: 2, baseMs: 10 * 60_000, output: { defId: 'copper_greaves', quantity: 1 } });
    expect(r.inputs).toEqual([{ defId: 'copper_ingot', quantity: 4 }, { defId: 'birch_plank', quantity: 2 }]);
    const { s, id } = craft('copper_greaves');
    expect(s.inventory.items.find((i) => i.id === id)).toMatchObject({ defId: 'copper_greaves' });
    expect(ok(s, { type: 'EQUIP_ITEM', itemId: id }).character.equipment.legs?.id).toBe(id);
  });

  it('a crafted axe raises woodcutting strength, a crafted pickaxe mining strength', () => {
    const axe = craft('silver_axe');
    const ws0 = woodcuttingStrength(axe.s).value;
    const eq = ok(axe.s, { type: 'EQUIP_ITEM', itemId: axe.id });
    expect(eq.character.equipment.axe?.defId).toBe('silver_axe');
    expect(woodcuttingStrength(eq).value).toBeGreaterThan(ws0);
    const pick = craft('gold_pickaxe');
    const ms0 = miningStrength(pick.s).value;
    const eq2 = ok(pick.s, { type: 'EQUIP_ITEM', itemId: pick.id });
    expect(eq2.character.equipment.pickaxe?.defId).toBe('gold_pickaxe');
    expect(miningStrength(eq2).value).toBeGreaterThan(ms0);
  });

  it('the Iron axe and pickaxe recipes make the existing items (same ids, prices, 64)', () => {
    expect(RECIPES.iron_axe.output.defId).toBe('iron_axe');
    expect(RECIPES.iron_pickaxe.output.defId).toBe('iron_pickaxe');
    expect(getItemDef('iron_axe')).toMatchObject({ sellPrice: 180, buyPrice: 600, woodcuttingStrength: 64 });
    expect(getItemDef('iron_pickaxe')).toMatchObject({ sellPrice: 180, buyPrice: 600, miningStrength: 64 });
    expect(craft('iron_axe').s.inventory.items.some((i) => i.defId === 'iron_axe')).toBe(true);
  });

  it('inputs and times: greaves 4+2 / 5 min, tools 3+2 / 3 min, doubling per tier; new pieces are not sold by the Merchant', () => {
    expect([GEAR_PIECES.greaves.bars, GEAR_PIECES.greaves.planks, GEAR_PIECES.axe.bars, GEAR_PIECES.axe.planks]).toEqual([4, 2, 3, 2]);
    expect(RECIPES.stone_axe.baseMs).toBe(3 * 60_000);
    expect(RECIPES.gold_pickaxe.baseMs).toBe(3 * 60_000 * 16);
    expect(RECIPES.gold_greaves.baseMs).toBe(5 * 60_000 * 16);
    for (const id of ['stone_axe', 'gold_pickaxe', 'iron_greaves']) expect(getItemDef(id)?.buyPrice).toBeUndefined();
  });
});
