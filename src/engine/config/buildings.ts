// Buildings (data). Rules in src/engine/buildings.ts; the tables in docs/ENGINE.md ("Buildings").
// Owner-approved 2026-10-28 (build requirements; upgrades, the builder and bonuses in 1.10.0). Every requirement and
// cost is data: adding a building or changing a cost needs no code.
import type { BuildingId } from '../types';

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;

/** Every building upgrades up to this level. Other buildings never go above the Town Hall's level. */
export const BUILDING_MAX_LEVEL = 5;

/** What one upgrade costs, paid up front when it starts, and how long the builder takes. */
export type UpgradeCost = {
  gold: number;
  /** Stackable items consumed from the inventory. */
  items: readonly { defId: string; quantity: number }[];
  durationMs: number;
};

/** Town Hall upgrades, in order: the cost to reach level 2, 3, 4 and 5 (owner-approved 2026-10-28). */
export const TOWN_HALL_UPGRADES: readonly UpgradeCost[] = [
  { gold: 500, items: [{ defId: 'oak_logs', quantity: 50 }, { defId: 'stone', quantity: 50 }], durationMs: 30 * MIN_MS },
  { gold: 2_000, items: [{ defId: 'birch_logs', quantity: 100 }, { defId: 'copper_ore', quantity: 100 }], durationMs: 2 * HOUR_MS },
  { gold: 8_000, items: [{ defId: 'maple_logs', quantity: 200 }, { defId: 'iron_ore', quantity: 200 }], durationMs: 8 * HOUR_MS },
  { gold: 32_000, items: [{ defId: 'yew_logs', quantity: 400 }, { defId: 'silver_ore', quantity: 400 }], durationMs: 24 * HOUR_MS },
];

/**
 * Every other building: half the Town Hall's gold, items and time for the same target level, rounded up (stored
 * precomputed; tests/upgrades.test.ts checks it against TOWN_HALL_UPGRADES).
 */
export const BUILDING_UPGRADES: readonly UpgradeCost[] = [
  { gold: 250, items: [{ defId: 'oak_logs', quantity: 25 }, { defId: 'stone', quantity: 25 }], durationMs: 15 * MIN_MS },
  { gold: 1_000, items: [{ defId: 'birch_logs', quantity: 50 }, { defId: 'copper_ore', quantity: 50 }], durationMs: 1 * HOUR_MS },
  { gold: 4_000, items: [{ defId: 'maple_logs', quantity: 100 }, { defId: 'iron_ore', quantity: 100 }], durationMs: 4 * HOUR_MS },
  { gold: 16_000, items: [{ defId: 'yew_logs', quantity: 200 }, { defId: 'silver_ore', quantity: 200 }], durationMs: 12 * HOUR_MS },
];

/** Everything a building needs before BUILD succeeds. Missing fields mean "no requirement of that kind". */
export type BuildingRequirements = {
  /** Hero level at least this. */
  heroLevel?: number;
  /** Other buildings at least at this level (built = level 1). */
  buildings?: readonly { buildingId: BuildingId; level: number }[];
  /** Stackable items consumed from the inventory. */
  items?: readonly { defId: string; quantity: number }[];
  /** Gold consumed. */
  gold?: number;
};

export type BuildingDef = {
  id: BuildingId;
  name: string;
  /** Sign icon. */
  icon: string;
  /** One line for the Build sheet. */
  description: string;
  requirements: BuildingRequirements;
  /** Built at once: the training tier is raised to at least this (Training Grounds: Tier 1 comes with the building). */
  grantsTrainingTier?: number;
  /** Built (level 1) on every save from the start: BUILD never applies (the Merchant). */
  startsBuilt?: boolean;
  /** upgrades[i] = the cost to reach level i + 2 (so its length is BUILDING_MAX_LEVEL − 1). */
  upgrades: readonly UpgradeCost[];
  /** Its level can never go above the Town Hall's (every building but the Town Hall itself). */
  cappedByTownHall: boolean;
};

/**
 * Every stored building, in the order the Build sheets and docs list them. Dungeon and Storage are not buildings
 * in the engine (always there, nothing to build or upgrade).
 */
export const BUILDING_IDS = ['woodcutting', 'mine_shaft', 'town_hall', 'training_grounds', 'merchant'] as const satisfies readonly BuildingId[];

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  woodcutting: {
    id: 'woodcutting',
    name: 'Woodcutting',
    icon: '🪓',
    description: 'A woodcutter\'s camp at the edge of the forest. Cut logs from the trees.',
    requirements: { gold: 50 },
    upgrades: BUILDING_UPGRADES,
    cappedByTownHall: true,
  },
  mine_shaft: {
    id: 'mine_shaft',
    name: 'Mine Shaft',
    icon: '⛏️',
    description: 'A shaft into the mountain. Mine stone and ore from the rocks.',
    requirements: { gold: 50 },
    upgrades: BUILDING_UPGRADES,
    cappedByTownHall: true,
  },
  town_hall: {
    id: 'town_hall',
    name: 'Town Hall',
    icon: '🏛️',
    description: 'The heart of the village. Hire workers here; its level caps every other building.',
    requirements: {
      heroLevel: 5,
      items: [
        { defId: 'oak_logs', quantity: 20 },
        { defId: 'stone', quantity: 20 },
      ],
      gold: 100,
    },
    upgrades: TOWN_HALL_UPGRADES,
    cappedByTownHall: false,
  },
  training_grounds: {
    id: 'training_grounds',
    name: 'Training Grounds',
    icon: '⚔️',
    description: 'A fenced yard to train your attributes. Comes with Training Tier 1.',
    requirements: {
      heroLevel: 10,
      buildings: [{ buildingId: 'town_hall', level: 1 }],
      items: [
        { defId: 'oak_logs', quantity: 50 },
        { defId: 'stone', quantity: 50 },
      ],
      gold: 250,
    },
    grantsTrainingTier: 1,
    upgrades: BUILDING_UPGRADES,
    cappedByTownHall: true,
  },
  merchant: {
    id: 'merchant',
    name: 'Merchant',
    icon: '💰',
    description: 'A trader\'s stall. Upgrades add stock slots.',
    requirements: {},
    startsBuilt: true,
    upgrades: BUILDING_UPGRADES,
    cappedByTownHall: true,
  },
};

export function isBuildingId(id: unknown): id is BuildingId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(BUILDINGS, id);
}
