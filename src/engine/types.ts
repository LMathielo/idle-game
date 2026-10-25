// Core game data model. Pure TypeScript: no React, no I/O.
// These shapes are what the engine (and later the server) will own.

export type AttributeKey = 'strength' | 'dexterity' | 'agility' | 'constitution' | 'charisma' | 'intelligence';

export type Attributes = Record<AttributeKey, number>;

export type EquipmentSlot = 'helmet' | 'amulet' | 'armor' | 'weapon' | 'shield' | 'gloves' | 'ring1' | 'ring2' | 'boots';

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic';

export type Item = {
  id: string;
  name: string;
  icon: string; // placeholder glyph until we have pixel sprites
  rarity: ItemRarity;
  slot?: EquipmentSlot; // equippable items only
  stackable?: boolean;
  quantity?: number;
};

export type SkillKey = 'woodcutting' | 'mining' | 'fishing' | 'smithing';

export type Skill = { level: number; xp: number; xpToNext: number };

export type Character = {
  name: string;
  title: string;
  level: number;
  xp: number;
  xpToNext: number;
  hp: number;
  maxHp: number;
  gold: number;
  attributes: Attributes;
  equipment: Partial<Record<EquipmentSlot, Item>>;
  skills: Record<SkillKey, Skill>;
};

export type Inventory = {
  capacity: number;
  items: Item[];
};

export type GameState = {
  saveVersion: 1;
  character: Character;
  inventory: Inventory;
};
