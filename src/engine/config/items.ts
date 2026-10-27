// Item catalog (data), keyed by item definition id. Stackable items are stored in the inventory with
// id = definition id; every stored item carries `defId`. BASE combat stats live only here, never on
// item instances, so changing a number here rebalances every save without a migration. Rolled affixes
// (M4 loot: "+3 damage", "+5% armor") will be stored on the instance because each drop differs; see
// docs/ENGINE.md for where they enter the stat pipeline.
import type { EquipmentSlot, ItemRarity } from '../types';

export type ItemDef = {
  id: string;
  name: string;
  icon: string;
  rarity: ItemRarity;
  stackable: boolean;
  slot?: EquipmentSlot;
  /** Weapons: base damage range before percent bonuses and attributes. Integers, min <= max. */
  damage?: { min: number; max: number };
  /** Armor value added to base defense while equipped. Integer. */
  armor?: number;
  /** Axes: woodcutting strength added while equipped. Integer. */
  woodcuttingStrength?: number;
};

export const ITEMS = {
  oak_logs: { id: 'oak_logs', name: 'Oak Logs', icon: '🪵', rarity: 'common', stackable: true },
  birch_logs: { id: 'birch_logs', name: 'Birch Logs', icon: '🪵', rarity: 'common', stackable: true },
  maple_logs: { id: 'maple_logs', name: 'Maple Logs', icon: '🪵', rarity: 'common', stackable: true },
  yew_logs: { id: 'yew_logs', name: 'Yew Logs', icon: '🪵', rarity: 'common', stackable: true },
  ironwood_logs: { id: 'ironwood_logs', name: 'Ironwood Logs', icon: '🪵', rarity: 'common', stackable: true },
  bird_nest: { id: 'bird_nest', name: 'Bird Nest', icon: '🪺', rarity: 'rare', stackable: true },
  bread: { id: 'bread', name: 'Bread', icon: '🍞', rarity: 'common', stackable: true },
  rat_skin: { id: 'rat_skin', name: 'Rat Skin', icon: '🐾', rarity: 'common', stackable: true },
  bat_wing: { id: 'bat_wing', name: 'Bat Wing', icon: '🪽', rarity: 'common', stackable: true },
  wolf_pelt: { id: 'wolf_pelt', name: 'Wolf Pelt', icon: '🧥', rarity: 'common', stackable: true },
  old_bone: { id: 'old_bone', name: 'Old Bone', icon: '🦴', rarity: 'common', stackable: true },
  troll_hide: { id: 'troll_hide', name: 'Troll Hide', icon: '🟫', rarity: 'common', stackable: true },
  rusty_gladius: {
    id: 'rusty_gladius',
    name: 'Rusty Gladius',
    icon: '🗡️',
    rarity: 'common',
    stackable: false,
    slot: 'weapon',
    damage: { min: 2, max: 4 },
  },
  linen_tunic: { id: 'linen_tunic', name: 'Linen Tunic', icon: '🥋', rarity: 'common', stackable: false, slot: 'armor', armor: 2 },
  worn_sandals: { id: 'worn_sandals', name: 'Worn Sandals', icon: '👢', rarity: 'common', stackable: false, slot: 'boots', armor: 1 },
  wooden_axe: { id: 'wooden_axe', name: 'Wooden Axe', icon: '🪓', rarity: 'common', stackable: false, slot: 'axe', woodcuttingStrength: 1 },
} as const satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;

export function getItemDef(id: string): ItemDef | undefined {
  return (ITEMS as Record<string, ItemDef>)[id];
}

export const INVENTORY_CAPACITY = 20;
