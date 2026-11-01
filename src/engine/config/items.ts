// Item catalog (data), keyed by item definition id. Stackable items are stored in the inventory with
// id = definition id; every stored item carries `defId`. Gear stats here are the 100% maxima (since 1.14.0): each gear
// instance carries its own `qualityBp` and `rarity`, and every reader scales the catalog stat by the instance quality
// (src/engine/gear.ts), so changing a number here rebalances every save without a migration. Rolled affixes (later)
// will be stored on the instance too; see docs/ENGINE.md for where they enter the stat pipeline.
import type { EquipmentSlot, ItemRarity } from '../types';
import { GEAR, GEAR_PIECES, type GearPieceId, type GearSetId, GEAR_SETS } from './gear';

export type ItemDef = {
  id: string;
  name: string;
  icon: string;
  /**
   * junk = sell-only; common = has a game use; uncommon..legendary = rarity tiers. Drives the name color. A gear
   * instance's own `rarity` overrides it (since 1.14.0).
   */
  rarity: ItemRarity;
  /** One short line for the item info sheet. */
  description: string;
  /** Gold the merchant pays per unit. Integer ≥ 1; always below buyPrice. Gear: at 25% quality (scaled per instance). */
  sellPrice: number;
  /** Gold per unit when the merchant sells it. Only items the merchant can stock have one. Gear: at 25% quality. */
  buyPrice?: number;
  stackable: boolean;
  slot?: EquipmentSlot;
  /** Weapons: damage range at 100% quality, before percent bonuses and attributes. Integers, min <= max. */
  damage?: { min: number; max: number };
  /** Armor added to base defense while equipped, at 100% quality. Integer. */
  armor?: number;
  /** Axes: woodcutting strength added while equipped, at 100% quality. Integer. */
  woodcuttingStrength?: number;
  /** Pickaxes: mining strength added while equipped, at 100% quality. Integer. */
  miningStrength?: number;
  /** Usable consumables (USE_ITEM): HP restored, capped at max HP. Integer. */
  heal?: number;
  /**
   * Gear: ms added to the hero's attack interval while equipped (negative = faster strikes). Integer. Not scaled by quality.
   * No item sets one yet; see STATS.attackInterval for the base and the floor.
   */
  attackIntervalModMs?: number;
};

const log = (id: string, name: string, sellPrice: number, tree: string) =>
  ({ id, name, icon: '🪵', rarity: 'common', description: `Logs cut from ${tree} trees. Used for crafting.`, sellPrice, stackable: true }) as const;

const ore = (id: string, name: string, icon: string, sellPrice: number, description: string) =>
  ({ id, name, icon, rarity: 'common', description, sellPrice, stackable: true }) as const;

const crafted = (id: string, name: string, icon: string, sellPrice: number, description: string) =>
  ({ id, name, icon, rarity: 'common', description, sellPrice, stackable: true }) as const;

const junk = (id: string, name: string, icon: string, sellPrice: number, description: string) =>
  ({ id, name, icon, rarity: 'junk', description, sellPrice, stackable: true }) as const;

/** Crafted materials (Crafting house, 1.13.0): sell price = the sell value of the inputs (config/crafting.ts). */
const MATERIALS = {
  oak_plank: crafted('oak_plank', 'Oak Plank', '🪚', 2, 'Planks sawn from oak logs. Used for crafting.'),
  stone_brick: crafted('stone_brick', 'Stone Brick', '🧱', 2, 'Squared stone blocks. Used for crafting.'),
  birch_plank: crafted('birch_plank', 'Birch Plank', '🪚', 12, 'Planks sawn from birch logs. Used for crafting.'),
  copper_ingot: crafted('copper_ingot', 'Copper Ingot', '🟧', 12, 'Smelted copper. Used for crafting.'),
  maple_plank: crafted('maple_plank', 'Maple Plank', '🪚', 64, 'Planks sawn from maple logs. Used for crafting.'),
  iron_ingot: crafted('iron_ingot', 'Iron Ingot', '⬛', 64, 'Smelted iron. Used for crafting.'),
  yew_plank: crafted('yew_plank', 'Yew Plank', '🪚', 320, 'Planks sawn from yew logs. Used for crafting.'),
  silver_ingot: crafted('silver_ingot', 'Silver Ingot', '⬜', 320, 'Smelted silver. Used for crafting.'),
  ironwood_plank: crafted('ironwood_plank', 'Ironwood Plank', '🪚', 1600, 'Planks sawn from ironwood logs. Used for crafting.'),
  gold_ingot: crafted('gold_ingot', 'Gold Ingot', '🟨', 1600, 'Smelted gold. Used for crafting.'),
} as const;

/**
 * A crafted gear piece (1.14.0): `<set>_<piece>`, common in the catalog (each instance rolls its own rarity), not sold by
 * the Merchant, sell price = max(1, floor(25% × the sell value of its inputs)) at 25% quality.
 */
function craftedGear(setId: GearSetId, pieceId: GearPieceId) {
  const set = GEAR_SETS.find((x) => x.id === setId)!;
  const piece = GEAR_PIECES[pieceId];
  const bar = MATERIALS[set.bar as keyof typeof MATERIALS];
  const plank = MATERIALS[set.plank as keyof typeof MATERIALS];
  const inputsValue = piece.bars * bar.sellPrice + piece.planks * plank.sellPrice;
  const def: ItemDef = {
    id: `${setId}_${pieceId}`,
    name: `${set.name} ${piece.name}`,
    icon: piece.icon,
    rarity: 'common',
    description: `Crafted from ${bar.name}s and ${plank.name}s.`,
    sellPrice: Math.max(1, Math.floor((inputsValue * GEAR.craft.sellRatioBp) / 10_000)),
    stackable: false,
    slot: piece.slot,
  };
  const i = set.tier - 1;
  if (piece.damage) def.damage = { min: piece.damage[i][0], max: piece.damage[i][1] };
  if (piece.armor) def.armor = piece.armor[i];
  return def;
}

export const ITEMS = {
  oak_logs: log('oak_logs', 'Oak Logs', 1, 'oak'),
  birch_logs: log('birch_logs', 'Birch Logs', 3, 'birch'),
  maple_logs: log('maple_logs', 'Maple Logs', 8, 'maple'),
  yew_logs: log('yew_logs', 'Yew Logs', 20, 'yew'),
  ironwood_logs: log('ironwood_logs', 'Ironwood Logs', 50, 'ironwood'),
  bird_nest: {
    id: 'bird_nest',
    name: 'Bird Nest',
    icon: '🪺',
    rarity: 'uncommon',
    description: 'Sometimes falls from a tree you cut. Worth a fair price.',
    sellPrice: 30,
    stackable: true,
  },
  stone: ore('stone', 'Stone', '🪨', 1, 'Rough stone from the Mine Shaft. Used for building.'),
  copper_ore: ore('copper_ore', 'Copper Ore', '🟠', 3, 'Copper ore from the Mine Shaft. Used for crafting.'),
  iron_ore: ore('iron_ore', 'Iron Ore', '⚫', 8, 'Iron ore from the Mine Shaft. Used for crafting.'),
  silver_ore: ore('silver_ore', 'Silver Ore', '⚪', 20, 'Silver ore from the Mine Shaft. Used for crafting.'),
  gold_ore: ore('gold_ore', 'Gold Ore', '🟡', 50, 'Gold ore from the Mine Shaft. Used for crafting.'),
  geode: {
    id: 'geode',
    name: 'Geode',
    icon: '🔮',
    rarity: 'uncommon',
    description: 'Sometimes found in a rock you mine. Worth a fair price.',
    sellPrice: 30,
    stackable: true,
  },
  // Crafted materials (Crafting house, 1.13.0): sell price = the sell value of the inputs (config/crafting.ts).
  ...MATERIALS,
  bread: junk('bread', 'Bread', '🍞', 1, 'Stale bread. Not much use to a gladiator.'),
  rat_skin: junk('rat_skin', 'Rat Skin', '🐾', 2, 'A mangy hide from the Rat Cellar.'),
  bat_wing: junk('bat_wing', 'Bat Wing', '🪽', 5, 'Leathery wing from the Bat Cave.'),
  wolf_pelt: junk('wolf_pelt', 'Wolf Pelt', '🧥', 12, 'Thick fur from the Wolf Den.'),
  old_bone: junk('old_bone', 'Old Bone', '🦴', 25, 'Dug out of the Forgotten Crypt.'),
  troll_hide: junk('troll_hide', 'Troll Hide', '🟫', 60, 'Tough hide from under the Troll Bridge.'),
  health_potion_t1: {
    id: 'health_potion_t1',
    name: 'Health Potion (T1)',
    icon: '🧪',
    rarity: 'common',
    description: 'A small red draught. Heals wounds, up to your max HP.',
    sellPrice: 5,
    buyPrice: 12,
    stackable: true,
    heal: 50,
  },
  rusty_gladius: {
    id: 'rusty_gladius',
    name: 'Rusty Gladius',
    icon: '🗡️',
    rarity: 'common',
    description: 'A short blade, more rust than steel.',
    sellPrice: 3,
    stackable: false,
    slot: 'weapon',
    damage: { min: 3, max: 6 },
  },
  linen_tunic: {
    id: 'linen_tunic',
    name: 'Linen Tunic',
    icon: '🥋',
    rarity: 'common',
    description: 'Plain cloth. Better than nothing.',
    sellPrice: 2,
    stackable: false,
    slot: 'armor',
    armor: 3,
  },
  worn_sandals: {
    id: 'worn_sandals',
    name: 'Worn Sandals',
    icon: '👢',
    rarity: 'common',
    description: 'Thin soles, many miles.',
    sellPrice: 1,
    stackable: false,
    slot: 'boots',
    armor: 2,
  },
  wooden_axe: {
    id: 'wooden_axe',
    name: 'Wooden Axe',
    icon: '🪓',
    rarity: 'common',
    description: 'A blunt beginner axe.',
    sellPrice: 1,
    stackable: false,
    slot: 'axe',
    woodcuttingStrength: 2,
  },
  iron_axe: {
    id: 'iron_axe',
    name: 'Iron Axe',
    icon: '🪓',
    rarity: 'common',
    description: 'A heavy iron head. Bites deep into hard wood.',
    sellPrice: 180,
    buyPrice: 600,
    stackable: false,
    slot: 'axe',
    woodcuttingStrength: 64,
  },
  wooden_pickaxe: {
    id: 'wooden_pickaxe',
    name: 'Wooden Pickaxe',
    icon: '⛏️',
    rarity: 'common',
    description: 'A blunt beginner pickaxe.',
    sellPrice: 1,
    stackable: false,
    slot: 'pickaxe',
    miningStrength: 2,
  },
  iron_pickaxe: {
    id: 'iron_pickaxe',
    name: 'Iron Pickaxe',
    icon: '⛏️',
    rarity: 'common',
    description: 'A heavy iron head. Cracks the hardest rock.',
    sellPrice: 180,
    buyPrice: 600,
    stackable: false,
    slot: 'pickaxe',
    miningStrength: 64,
  },
  iron_sword: {
    id: 'iron_sword',
    name: 'Iron Sword',
    icon: '⚔️',
    rarity: 'common',
    description: 'A soldier\'s sword, well balanced.',
    sellPrice: 150,
    buyPrice: 500,
    stackable: false,
    slot: 'weapon',
    damage: { min: 10, max: 14 },
  },
  iron_helm: {
    id: 'iron_helm',
    name: 'Iron Helm',
    icon: '🪖',
    rarity: 'common',
    description: 'Keeps your head on your shoulders.',
    sellPrice: 120,
    buyPrice: 400,
    stackable: false,
    slot: 'helmet',
    armor: 6,
  },
  iron_chestplate: {
    id: 'iron_chestplate',
    name: 'Iron Chestplate',
    icon: '🦺',
    rarity: 'common',
    description: 'Riveted iron plates over a padded vest.',
    sellPrice: 210,
    buyPrice: 700,
    stackable: false,
    slot: 'armor',
    armor: 10,
  },
  iron_shield: {
    id: 'iron_shield',
    name: 'Iron Shield',
    icon: '🛡️',
    rarity: 'common',
    description: 'A round shield with an iron rim.',
    sellPrice: 165,
    buyPrice: 550,
    stackable: false,
    slot: 'shield',
    armor: 8,
  },
  iron_gloves: {
    id: 'iron_gloves',
    name: 'Iron Gloves',
    icon: '🧤',
    rarity: 'common',
    description: 'Leather gloves with iron knuckles.',
    sellPrice: 75,
    buyPrice: 250,
    stackable: false,
    slot: 'gloves',
    armor: 3,
  },
  iron_boots: {
    id: 'iron_boots',
    name: 'Iron Boots',
    icon: '🥾',
    rarity: 'common',
    description: 'Heavy boots with iron toe caps.',
    sellPrice: 75,
    buyPrice: 250,
    stackable: false,
    slot: 'boots',
    armor: 3,
  },
  greater_health_potion: {
    id: 'greater_health_potion',
    name: 'Greater Health Potion',
    icon: '⚗️',
    rarity: 'common',
    description: 'A large red draught. Heals more, up to your max HP.',
    sellPrice: 9,
    buyPrice: 30,
    stackable: true,
    heal: 60,
  },
  steel_axe: {
    id: 'steel_axe',
    name: 'Steel Axe',
    icon: '🪓',
    rarity: 'common',
    description: 'A tempered steel head. Fells the oldest trees.',
    sellPrice: 750,
    buyPrice: 2500,
    stackable: false,
    slot: 'axe',
    woodcuttingStrength: 192,
  },
  steel_pickaxe: {
    id: 'steel_pickaxe',
    name: 'Steel Pickaxe',
    icon: '⛏️',
    rarity: 'common',
    description: 'A tempered steel point. Splits any vein.',
    sellPrice: 750,
    buyPrice: 2500,
    stackable: false,
    slot: 'pickaxe',
    miningStrength: 192,
  },
  steel_sword: {
    id: 'steel_sword',
    name: 'Steel Sword',
    icon: '🗡️',
    rarity: 'common',
    description: 'A keen steel blade.',
    sellPrice: 600,
    buyPrice: 2000,
    stackable: false,
    slot: 'weapon',
    damage: { min: 16, max: 22 },
  },
  // Crafted gear (Crafting house, 1.14.0). Tier 3 is the iron set above.
  stone_sword: craftedGear('stone', 'sword'),
  stone_helm: craftedGear('stone', 'helm'),
  stone_chestplate: craftedGear('stone', 'chestplate'),
  stone_shield: craftedGear('stone', 'shield'),
  stone_gloves: craftedGear('stone', 'gloves'),
  stone_boots: craftedGear('stone', 'boots'),
  copper_sword: craftedGear('copper', 'sword'),
  copper_helm: craftedGear('copper', 'helm'),
  copper_chestplate: craftedGear('copper', 'chestplate'),
  copper_shield: craftedGear('copper', 'shield'),
  copper_gloves: craftedGear('copper', 'gloves'),
  copper_boots: craftedGear('copper', 'boots'),
  silver_sword: craftedGear('silver', 'sword'),
  silver_helm: craftedGear('silver', 'helm'),
  silver_chestplate: craftedGear('silver', 'chestplate'),
  silver_shield: craftedGear('silver', 'shield'),
  silver_gloves: craftedGear('silver', 'gloves'),
  silver_boots: craftedGear('silver', 'boots'),
  gold_sword: craftedGear('gold', 'sword'),
  gold_helm: craftedGear('gold', 'helm'),
  gold_chestplate: craftedGear('gold', 'chestplate'),
  gold_shield: craftedGear('gold', 'shield'),
  gold_gloves: craftedGear('gold', 'gloves'),
  gold_boots: craftedGear('gold', 'boots'),
} as const satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;

export function getItemDef(id: string): ItemDef | undefined {
  return Object.prototype.hasOwnProperty.call(ITEMS, id) ? (ITEMS as Record<string, ItemDef>)[id] : undefined;
}

export const INVENTORY_CAPACITY = 20;
