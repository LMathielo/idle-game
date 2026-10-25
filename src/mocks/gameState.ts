import type { GameState } from '../engine/types';

// Mocked state used by the UI until the engine and save layer exist.
export const mockGameState: GameState = {
  saveVersion: 1,
  character: {
    name: 'Lucius',
    title: 'Gladiator of the Vale',
    level: 7,
    xp: 1240,
    xpToNext: 2000,
    hp: 84,
    maxHp: 120,
    gold: 1350,
    attributes: {
      strength: 18,
      dexterity: 14,
      agility: 11,
      constitution: 16,
      charisma: 8,
      intelligence: 6,
    },
    equipment: {
      helmet: { id: 'eq-helm', name: 'Iron Helm', icon: '⛑️', rarity: 'common', slot: 'helmet' },
      armor: { id: 'eq-armor', name: 'Chainmail', icon: '🥋', rarity: 'uncommon', slot: 'armor' },
      weapon: { id: 'eq-sword', name: 'Gladius', icon: '🗡️', rarity: 'rare', slot: 'weapon' },
      shield: { id: 'eq-shield', name: 'Oak Shield', icon: '🛡️', rarity: 'common', slot: 'shield' },
      boots: { id: 'eq-boots', name: 'Leather Boots', icon: '👢', rarity: 'common', slot: 'boots' },
      ring1: { id: 'eq-ring', name: 'Copper Ring', icon: '💍', rarity: 'uncommon', slot: 'ring1' },
    },
    skills: {
      woodcutting: { level: 5, xp: 340, xpToNext: 600 },
      mining: { level: 2, xp: 80, xpToNext: 200 },
      fishing: { level: 1, xp: 10, xpToNext: 100 },
      smithing: { level: 1, xp: 0, xpToNext: 100 },
    },
  },
  inventory: {
    capacity: 20,
    items: [
      { id: 'inv-logs', name: 'Oak Logs', icon: '🪵', rarity: 'common', stackable: true, quantity: 42 },
      { id: 'inv-potion', name: 'Health Potion', icon: '🧪', rarity: 'common', stackable: true, quantity: 5 },
      { id: 'inv-ore', name: 'Iron Ore', icon: '🪨', rarity: 'common', stackable: true, quantity: 12 },
      { id: 'inv-axe', name: 'Battle Axe', icon: '🪓', rarity: 'uncommon', slot: 'weapon' },
      { id: 'inv-bow', name: 'Short Bow', icon: '🏹', rarity: 'common', slot: 'weapon' },
      { id: 'inv-amulet', name: 'Amulet of Vigor', icon: '📿', rarity: 'epic', slot: 'amulet' },
      { id: 'inv-gloves', name: 'Wool Gloves', icon: '🧤', rarity: 'common', slot: 'gloves' },
      { id: 'inv-bread', name: 'Bread', icon: '🍞', rarity: 'common', stackable: true, quantity: 8 },
      { id: 'inv-key', name: 'Dungeon Key', icon: '🗝️', rarity: 'rare' },
    ],
  },
};
