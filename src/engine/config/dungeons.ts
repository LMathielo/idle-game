// Dungeons, enemies and combat (data). Rules in src/engine/combat.ts and src/engine/dungeon.ts;
// formulas in docs/ENGINE.md ("Dungeon & combat").
import type { DungeonId, EnemyId } from '../types';

const SEC_MS = 1000;
const MIN_MS = 60 * SEC_MS;

/** Rules shared by every dungeon. Run timing is per dungeon (DungeonDef.run). */
export const DUNGEON_RUN = {
  /** Skip cost: `staminaPerStep` per started `stepMs` of the run left (rounded up, at least one step). */
  skip: { stepMs: 1 * MIN_MS, staminaPerStep: 1 },
} as const;

/** runMs = max(minMs, baseMs − perDexterityMs × DEX). */
export type RunTiming = { baseMs: number; perDexterityMs: number; minMs: number };

export const COMBAT = {
  /** dealt = max(minDamage, round(roll × K / (defense + K))). 13 defense blocks ~21%. */
  defenseK: 50,
  minDamage: 1,
  /** A fight still going after this many rounds is a loss. */
  maxRounds: 50,
} as const;

export type EnemyDef = {
  id: EnemyId;
  name: string;
  icon: string;
  hp: number;
  damage: { min: number; max: number };
  defense: number;
};

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  rat: { id: 'rat', name: 'Rat', icon: '🐀', hp: 30, damage: { min: 3, max: 5 }, defense: 2 },
};

export type DungeonDef = {
  id: DungeonId;
  name: string;
  level: number;
  icon: string;
  enemyId: EnemyId;
  run: RunTiming;
  /** Win only. A loss gives nothing. Rolled in this order: gold, then each drop. */
  rewards: {
    heroXp: number;
    gold: { min: number; max: number };
    drops: readonly { itemId: string; chance: number }[];
  };
};

export const DUNGEONS: Record<DungeonId, DungeonDef> = {
  rat_cellar_1: {
    id: 'rat_cellar_1',
    name: 'Rat Cellar',
    level: 1,
    icon: '💀',
    enemyId: 'rat',
    run: { baseMs: 5 * MIN_MS, perDexterityMs: 1 * SEC_MS, minMs: 1 * MIN_MS }, // DEX 10 → 4:50
    rewards: { heroXp: 25, gold: { min: 2, max: 5 }, drops: [{ itemId: 'rat_skin', chance: 0.5 }] },
  },
};

export const DUNGEON_IDS = Object.keys(DUNGEONS) as DungeonId[];

export function isDungeonId(id: unknown): id is DungeonId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(DUNGEONS, id);
}
