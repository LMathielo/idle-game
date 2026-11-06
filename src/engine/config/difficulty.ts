// Difficulties of a dungeon tier (data, 1.24.0). Rules in src/engine/difficulty.ts; product rules in docs/PRODUCT.md ("Difficulty");
// formulas, draw order and rounding in docs/ENGINE.md ("Difficulty and packs").
//
//   Normal   the original content: one mob per stage run, x1, the boss as is.
//   Hard     opens with the first win against the tier's boss on Normal.
//            Stage runs: a pack of 1-4 mobs, each x2 (x3 as a Veteran, 25%).
//            Boss: x2 stats, x2 XP and gold, better gear rarity, 100 Hard Troll Bridge wins to open it.
//   Extreme  opens with the first win against the tier's boss on Hard.
//            Stage runs: a pack of 7-10 mobs, each at least a Veteran (x12), 25% an Extreme (x16, replaces Veteran).
//            Boss: x8 stats, x8 XP and gold, better gear rarity, 400 Extreme Troll Bridge wins to open it.
//
// Every multiplier is in basis points of the Normal enemy (10 000 = x1) and applies to HP, damage min / max, armor and magic resist.
// Attack interval and the fight time limit are never scaled. ONE rounding rule everywhere: half up, integers only
// (scaleStat in src/engine/difficulty.ts: floor((value × bp + 5 000) / 10 000), like the gear code).
import type { Difficulty, EnemyId, MobVariant } from '../types';
import type { RarityWeight } from './gear';

export const DIFFICULTIES: readonly Difficulty[] = ['normal', 'hard', 'extreme'];

export function isDifficulty(x: unknown): x is Difficulty {
  return x === 'normal' || x === 'hard' || x === 'extreme';
}

/** One tier of a pack's mobs: which variant it is and its stat multiplier (bp of the Normal enemy). */
export type PackTier = { variant: MobVariant; bp: number };

export type PackRule = {
  /** Pack size, uniform in [min, max] (one draw on the main RNG when a stage search ends). */
  size: { min: number; max: number };
  /** What a mob is by default. */
  base: PackTier;
  /** What a mob becomes with `chanceBp` (one draw per mob, in pack order); it replaces the base, it does not stack. */
  upgrade: PackTier & { chanceBp: number };
};

export type DifficultyDef = {
  id: Difficulty;
  name: string;
  /**
   * The difficulty whose boss must be killed once to open this one (null = open from the start). Permanent: boss wins never go down.
   */
  unlockedBy: Difficulty | null;
  /** Stage runs: null = one plain mob (exactly the Normal behaviour, no extra RNG draws). */
  pack: PackRule | null;
  boss: {
    /** HP, damage, armor and magic resist of the boss, bp of the Normal boss. Regen keeps its % of max HP; skills and limit are unchanged. */
    statBp: number;
    /** Hero XP and gold of a boss win, bp of the Normal reward. The gear chance and the Tusk chance are unchanged. */
    rewardBp: number;
    /**
     * Wins in the boss's unlock stage dungeon (BossDef.unlock.dungeonId) on THIS difficulty that open the boss on it.
     * null = use BossDef.unlock.wins (Normal: 50).
     */
    unlockWins: number | null;
    /** The gear drop's colour table on this difficulty. null = the boss's own (BossGearDrop.rarityWeights). */
    rarityWeights: readonly RarityWeight[] | null;
  };
};

export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  normal: {
    id: 'normal',
    name: 'Normal',
    unlockedBy: null,
    pack: null,
    boss: { statBp: 10_000, rewardBp: 10_000, unlockWins: null, rarityWeights: null },
  },
  hard: {
    id: 'hard',
    name: 'Hard',
    unlockedBy: 'normal',
    pack: {
      size: { min: 1, max: 4 },
      base: { variant: 'base', bp: 20_000 }, // x2
      upgrade: { variant: 'veteran', bp: 30_000, chanceBp: 2_500 }, // x3 (= 2 x 1.5), 25%
    },
    boss: {
      statBp: 20_000,
      rewardBp: 20_000,
      unlockWins: 100,
      rarityWeights: [
        { value: 'rare', weight: 75 }, // blue
        { value: 'epic', weight: 25 }, // purple
      ],
    },
  },
  extreme: {
    id: 'extreme',
    name: 'Extreme',
    unlockedBy: 'hard',
    pack: {
      size: { min: 7, max: 10 },
      base: { variant: 'veteran', bp: 120_000 }, // x12 (= 8 x 1.5): every mob is at least a Veteran
      upgrade: { variant: 'extreme', bp: 160_000, chanceBp: 2_500 }, // x16 (= 8 x 2), 25%
    },
    boss: {
      statBp: 80_000,
      rewardBp: 80_000,
      unlockWins: 400,
      rarityWeights: [
        { value: 'rare', weight: 25 }, // blue
        { value: 'epic', weight: 75 }, // purple
      ],
    },
  },
};

/** A variant creature: `id` names its sprite (assets/images/enemies/variants/<id>.png, built by tools/art/monsters.py), `name` is shown everywhere. */
export type VariantCreature = { id: string; name: string };

/**
 * The creature a pack mob IS on Hard and Extreme (1.25.0, owner decision 2026-11-06), per enemy: the "veteran" variant (Hard 25%, every
 * Extreme mob) is the Hard creature, the "extreme" variant (Extreme 25%) the Extreme creature. The plain Hard mob ("base") keeps the
 * enemy's own sprite and name, and the boss has none (it never comes in a pack). Names are data: nothing in the UI builds one.
 */
export const ENEMY_VARIANTS: Partial<Record<EnemyId, Record<Exclude<MobVariant, 'base'>, VariantCreature>>> = {
  rat: { veteran: { id: 'giant_rat', name: 'Giant Rat' }, extreme: { id: 'blight_rat', name: 'Blight Rat' } },
  bat: { veteran: { id: 'vampire_bat', name: 'Vampire Bat' }, extreme: { id: 'plague_bat', name: 'Plague Bat' } },
  wolf: { veteran: { id: 'dire_wolf', name: 'Dire Wolf' }, extreme: { id: 'shadow_wolf', name: 'Shadow Wolf' } },
  skeleton: { veteran: { id: 'skeleton_knight', name: 'Skeleton Knight' }, extreme: { id: 'bone_champion', name: 'Bone Champion' } },
  troll: { veteran: { id: 'stone_troll', name: 'Stone Troll' }, extreme: { id: 'magma_troll', name: 'Magma Troll' } },
};

/** The variant creature of `enemyId` for `variant`, or null for the plain mob (and for an enemy without variants: the boss). */
export function variantCreature(enemyId: EnemyId, variant: MobVariant): VariantCreature | null {
  return variant === 'base' ? null : (ENEMY_VARIANTS[enemyId]?.[variant] ?? null);
}
