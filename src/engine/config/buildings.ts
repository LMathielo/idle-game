// Buildings (data). Rules in src/engine/buildings.ts; the table in docs/ENGINE.md ("Buildings").
// Owner-approved 2026-10-28. Every requirement is data: adding a building or changing a cost needs no code.
import type { BuildingId } from '../types';

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
};

/** In the order the Build sheets and docs list them. */
export const BUILDING_IDS = ['woodcutting', 'mine_shaft', 'town_hall', 'training_grounds'] as const satisfies readonly BuildingId[];

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  woodcutting: {
    id: 'woodcutting',
    name: 'Woodcutting',
    icon: '🪓',
    description: 'A woodcutter\'s camp at the edge of the forest. Cut logs from the trees.',
    requirements: { gold: 50 },
  },
  mine_shaft: {
    id: 'mine_shaft',
    name: 'Mine Shaft',
    icon: '⛏️',
    description: 'A shaft into the mountain. Mine stone and ore from the rocks.',
    requirements: { gold: 50 },
  },
  town_hall: {
    id: 'town_hall',
    name: 'Town Hall',
    icon: '🏛️',
    description: 'The heart of the village. Workers and building upgrades will be run from here.',
    requirements: {
      heroLevel: 5,
      items: [
        { defId: 'oak_logs', quantity: 20 },
        { defId: 'stone', quantity: 20 },
      ],
      gold: 100,
    },
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
  },
};

export function isBuildingId(id: unknown): id is BuildingId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(BUILDINGS, id);
}
