// Item catalog (data), keyed by item definition id. Stackable items are stored in the inventory with
// id = definition id; every stored item carries `defId`. Combat stats live only here, never on item
// instances, so changing a number here rebalances every save without a migration.
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
};

export const ITEMS = {
  oak_logs: { id: 'oak_logs', name: 'Oak Logs', icon: '🪵', rarity: 'common', stackable: true },
  bird_nest: { id: 'bird_nest', name: 'Bird Nest', icon: '🪺', rarity: 'rare', stackable: true },
  bread: { id: 'bread', name: 'Bread', icon: '🍞', rarity: 'common', stackable: true },
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
} as const satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;

export function getItemDef(id: string): ItemDef | undefined {
  return (ITEMS as Record<string, ItemDef>)[id];
}

export const INVENTORY_CAPACITY = 20;
