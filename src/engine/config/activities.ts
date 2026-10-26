// Acted skills (data). Each action: fixed rewards + skill XP + independent rare-drop rolls.
import type { GatheringKind, SkillKey } from '../types';

export type ActivityConfig = {
  kind: GatheringKind;
  skill: SkillKey;
  /** Action interval at skill level 1. */
  baseIntervalMs: number;
  /** Interval shrinks by this fraction of the base per skill level above 1. */
  intervalReductionPerLevel: number;
  minIntervalMs: number;
  /** Guaranteed items per action. */
  rewards: readonly { itemId: string; quantity: number }[];
  skillXpPerAction: number;
  /** Owner decision: hero XP comes from combat only, so gathering gives 0. */
  heroXpPerAction: number;
  /** Independent rolls per action, in this order, using the seeded RNG. */
  rareDrops: readonly { itemId: string; chance: number }[];
};

export const ACTIVITIES: Record<GatheringKind, ActivityConfig> = {
  woodcutting: {
    kind: 'woodcutting',
    skill: 'woodcutting',
    baseIntervalMs: 3000,
    intervalReductionPerLevel: 0.01,
    minIntervalMs: 1200,
    rewards: [{ itemId: 'oak_logs', quantity: 1 }],
    skillXpPerAction: 10,
    heroXpPerAction: 0,
    rareDrops: [{ itemId: 'bird_nest', chance: 1 / 200 }],
  },
};

/** Gathering kinds only. Dungeon runs have their own config (config/dungeons.ts). */
export function isGatheringKind(kind: unknown): kind is GatheringKind {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(ACTIVITIES, kind);
}
