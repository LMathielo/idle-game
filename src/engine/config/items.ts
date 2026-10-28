// Item catalog (data), keyed by item definition id. Stackable items are stored in the inventory with
// id = definition id; every stored item carries `defId`. BASE combat stats live only here, never on
// item instances, so changing a number here rebalances every save without a migration. Rolled affixes
// (M4 loot: "+3 damage", "+5% armor") will be stored on the instance because each drop differs; see
// docs/ENGINE.md for where they enter the stat pipeline.
import type { EquipmentSlot, ItemQuality } from '../types';

export type ItemDef = {
  id: string;
  name: string;
  icon: string;
  /** junk = sell-only; common = has a game use; uncommon..legendary = rarity tiers. Drives the name color. */
  quality: ItemQuality;
  /** One short line for the item info sheet. */
  description: string;
  /** Gold the merchant pays per unit. Integer ≥ 1; always below buyPrice. */
  sellPrice: number;
  /** Gold per unit when the merchant sells it. Only items the merchant can stock have one. */
  buyPrice?: number;
  stackable: boolean;
  slot?: EquipmentSlot;
  /** Weapons: base damage range before percent bonuses and attributes. Integers, min <= max. */
  damage?: { min: number; max: number };
  /** Armor value added to base defense while equipped. Integer. */
  armor?: number;
  /** Axes: woodcutting strength added while equipped. Integer. */
  woodcuttingStrength?: number;
  /** Pickaxes: mining strength added while equipped. Integer. */
  miningStrength?: number;
  /** Usable consumables (USE_ITEM): HP restored, capped at max HP. Integer. */
  heal?: number;
  /**
   * Gear: ms added to the hero's attack interval while equipped (negative = faster strikes). Integer.
   * No item sets one yet; see STATS.attackInterval for the base and the floor.
   */
  attackIntervalModMs?: number;
};

const log = (id: string, name: string, sellPrice: number, tree: string) =>
  ({ id, name, icon: '🪵', quality: 'common', description: `Logs cut from ${tree} trees. Used for crafting.`, sellPrice, stackable: true }) as const;

const ore = (id: string, name: string, icon: string, sellPrice: number, description: string) =>
  ({ id, name, icon, quality: 'common', description, sellPrice, stackable: true }) as const;

const junk = (id: string, name: string, icon: string, sellPrice: number, description: string) =>
  ({ id, name, icon, quality: 'junk', description, sellPrice, stackable: true }) as const;

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
    quality: 'uncommon',
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
    quality: 'uncommon',
    description: 'Sometimes found in a rock you mine. Worth a fair price.',
    sellPrice: 30,
    stackable: true,
  },
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
    quality: 'common',
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
    quality: 'common',
    description: 'A short blade, more rust than steel.',
    sellPrice: 3,
    stackable: false,
    slot: 'weapon',
    damage: { min: 2, max: 4 },
  },
  linen_tunic: {
    id: 'linen_tunic',
    name: 'Linen Tunic',
    icon: '🥋',
    quality: 'common',
    description: 'Plain cloth. Better than nothing.',
    sellPrice: 2,
    stackable: false,
    slot: 'armor',
    armor: 2,
  },
  worn_sandals: {
    id: 'worn_sandals',
    name: 'Worn Sandals',
    icon: '👢',
    quality: 'common',
    description: 'Thin soles, many miles.',
    sellPrice: 1,
    stackable: false,
    slot: 'boots',
    armor: 1,
  },
  wooden_axe: {
    id: 'wooden_axe',
    name: 'Wooden Axe',
    icon: '🪓',
    quality: 'common',
    description: 'A blunt beginner axe.',
    sellPrice: 1,
    stackable: false,
    slot: 'axe',
    woodcuttingStrength: 1,
  },
  iron_axe: {
    id: 'iron_axe',
    name: 'Iron Axe',
    icon: '🪓',
    quality: 'common',
    description: 'A heavy iron head. Bites deep into hard wood.',
    sellPrice: 180,
    buyPrice: 600,
    stackable: false,
    slot: 'axe',
    woodcuttingStrength: 40,
  },
  wooden_pickaxe: {
    id: 'wooden_pickaxe',
    name: 'Wooden Pickaxe',
    icon: '⛏️',
    quality: 'common',
    description: 'A blunt beginner pickaxe.',
    sellPrice: 1,
    stackable: false,
    slot: 'pickaxe',
    miningStrength: 1,
  },
  iron_pickaxe: {
    id: 'iron_pickaxe',
    name: 'Iron Pickaxe',
    icon: '⛏️',
    quality: 'common',
    description: 'A heavy iron head. Cracks the hardest rock.',
    sellPrice: 180,
    buyPrice: 600,
    stackable: false,
    slot: 'pickaxe',
    miningStrength: 40,
  },
  iron_sword: {
    id: 'iron_sword',
    name: 'Iron Sword',
    icon: '⚔️',
    quality: 'common',
    description: 'A soldier\'s sword, well balanced.',
    sellPrice: 150,
    buyPrice: 500,
    stackable: false,
    slot: 'weapon',
    damage: { min: 6, max: 9 },
  },
  iron_helm: {
    id: 'iron_helm',
    name: 'Iron Helm',
    icon: '🪖',
    quality: 'common',
    description: 'Keeps your head on your shoulders.',
    sellPrice: 120,
    buyPrice: 400,
    stackable: false,
    slot: 'helmet',
    armor: 4,
  },
} as const satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;

export function getItemDef(id: string): ItemDef | undefined {
  return Object.prototype.hasOwnProperty.call(ITEMS, id) ? (ITEMS as Record<string, ItemDef>)[id] : undefined;
}

export const INVENTORY_CAPACITY = 20;
