// Dungeons, enemies and combat (data). Rules in src/engine/combat.ts and src/engine/dungeon.ts;
// formulas in docs/ENGINE.md ("Dungeon & combat").
import type { DungeonId, EnemyId } from '../types';

const SEC_MS = 1000;
const MIN_MS = 60 * SEC_MS;

/**
 * Rules shared by every dungeon. A run = a search for an opponent (timed per dungeon, DungeonDef.search),
 * then a live fight (COMBAT.maxFightMs at most).
 */
export const DUNGEON_RUN = {
  /**
   * Skip cost for the SEARCH: `staminaPerStep` per started `stepMs` of search left (rounded up, at least one
   * step). The fight is never skippable.
   */
  skip: { stepMs: 1 * MIN_MS, staminaPerStep: 1 },
} as const;

/** searchMs = max(minMs, ceil(baseMs × (1 − core DEX reduction))) (STAT_EFFECTS.dexterity.activityTime, 1.16.0). */
export type SearchTiming = { baseMs: number; minMs: number };

export const COMBAT = {
  /** dealt = max(minDamage, round(roll × K / (defense + K))). 13 defense blocks ~21%. */
  defenseK: 50,
  minDamage: 1,
  /**
   * Fight time limit (engine time from the fight's start). Strikes due at exactly this time still land;
   * a fight with both sides alive after them is a loss (`time_limit`), with the usual loss rules.
   */
  maxFightMs: 60 * SEC_MS,
} as const;

export type EnemyDef = {
  id: EnemyId;
  name: string;
  icon: string;
  hp: number;
  damage: { min: number; max: number };
  defense: number;
  /** Time between two of its strikes; the first lands this long after the fight starts. */
  attackIntervalMs: number;
};

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  rat: { id: 'rat', name: 'Rat', icon: '🐀', hp: 30, damage: { min: 3, max: 5 }, defense: 2, attackIntervalMs: 1000 },
  bat: { id: 'bat', name: 'Bat', icon: '🦇', hp: 60, damage: { min: 6, max: 9 }, defense: 6, attackIntervalMs: 1000 },
  wolf: { id: 'wolf', name: 'Wolf', icon: '🐺', hp: 110, damage: { min: 10, max: 14 }, defense: 12, attackIntervalMs: 1000 },
  skeleton: { id: 'skeleton', name: 'Skeleton', icon: '💀', hp: 180, damage: { min: 15, max: 20 }, defense: 20, attackIntervalMs: 1000 },
  troll: { id: 'troll', name: 'Troll', icon: '👹', hp: 300, damage: { min: 22, max: 30 }, defense: 30, attackIntervalMs: 1000 },
};

/**
 * What opens a dungeon. Today: a number of lifetime WINS in another dungeon (losses never count).
 * Wins never go down, so an unlock is permanent. More conditions (e.g. hero level) can be added here
 * as optional fields; isDungeonUnlocked() requires all of them.
 */
export type UnlockRule = { dungeonId: DungeonId; wins: number };

export type DungeonDef = {
  id: DungeonId;
  name: string;
  /** 1-based difficulty tier; the list is shown in this order. */
  tier: number;
  icon: string;
  enemyId: EnemyId;
  /** How long the search for an opponent takes (the first phase of a run). */
  search: SearchTiming;
  /** null = open from the start. */
  unlock: UnlockRule | null;
  /** Win only. A loss gives nothing. Rolled in this order: gold, then each drop. */
  rewards: {
    heroXp: number;
    gold: { min: number; max: number };
    drops: readonly { itemId: string; chance: number }[];
  };
};

/** Every tier: core DEX shortens it on the diminishing curve, never under 1:00. Only the base time differs. */
const searchFrom = (baseMinutes: number): SearchTiming => ({ baseMs: baseMinutes * MIN_MS, minMs: 1 * MIN_MS });

// Owner-approved tier table (2026-10-26; search times and Rat XP rebalanced 2026-10-27). Tiers 4–5 are out of reach until Training raises attributes.
// Insertion order is the display order (DUNGEON_IDS).
export const DUNGEONS: Record<DungeonId, DungeonDef> = {
  rat_cellar: {
    id: 'rat_cellar',
    name: 'Rat Cellar',
    tier: 1,
    icon: '🕳️',
    enemyId: 'rat',
    search: searchFrom(2), // core DEX 0 → 2:00, 10 → 1:51
    unlock: null,
    rewards: { heroXp: 35, gold: { min: 2, max: 5 }, drops: [{ itemId: 'rat_skin', chance: 0.5 }] },
  },
  bat_cave: {
    id: 'bat_cave',
    name: 'Bat Cave',
    tier: 2,
    icon: '⛰️',
    enemyId: 'bat',
    search: searchFrom(3), // core DEX 0 → 3:00
    unlock: { dungeonId: 'rat_cellar', wins: 10 },
    rewards: { heroXp: 60, gold: { min: 6, max: 12 }, drops: [{ itemId: 'bat_wing', chance: 0.4 }] },
  },
  wolf_den: {
    id: 'wolf_den',
    name: 'Wolf Den',
    tier: 3,
    icon: '🌲',
    enemyId: 'wolf',
    search: searchFrom(5), // core DEX 0 → 5:00
    unlock: { dungeonId: 'bat_cave', wins: 15 },
    rewards: { heroXp: 140, gold: { min: 15, max: 30 }, drops: [{ itemId: 'wolf_pelt', chance: 0.3 }] },
  },
  forgotten_crypt: {
    id: 'forgotten_crypt',
    name: 'Forgotten Crypt',
    tier: 4,
    icon: '⚰️',
    enemyId: 'skeleton',
    search: searchFrom(8), // core DEX 0 → 8:00
    unlock: { dungeonId: 'wolf_den', wins: 25 },
    rewards: { heroXp: 300, gold: { min: 35, max: 60 }, drops: [{ itemId: 'old_bone', chance: 0.25 }] },
  },
  troll_bridge: {
    id: 'troll_bridge',
    name: 'Troll Bridge',
    tier: 5,
    icon: '🌉',
    enemyId: 'troll',
    search: searchFrom(12), // core DEX 0 → 12:00
    unlock: { dungeonId: 'forgotten_crypt', wins: 40 },
    rewards: { heroXp: 650, gold: { min: 80, max: 130 }, drops: [{ itemId: 'troll_hide', chance: 0.2 }] },
  },
};

/**
 * Danger hint shown before a run (dangerHint in src/engine/danger.ts): expected HP lost per fight, with
 * average rolls, as a percent of max HP. Below `toughAtPercent` → Easy; below `deadlyAtPercent` → Tough;
 * otherwise (or when the hero can't win within the fight time limit) → Deadly.
 */
export const DANGER = { toughAtPercent: 40, deadlyAtPercent: 100 } as const;

/** All dungeons, by tier (the list order in the UI). */
export const DUNGEON_IDS = (Object.keys(DUNGEONS) as DungeonId[]).sort((a, b) => DUNGEONS[a].tier - DUNGEONS[b].tier);

export function isDungeonId(id: unknown): id is DungeonId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(DUNGEONS, id);
}
