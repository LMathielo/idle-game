// Mining (data). Rules in src/engine/mining.ts; formulas and the rock table in docs/ENGINE.md ("Mining").
// Owner-approved numbers (2026-10-28). Mining mirrors woodcutting today, but every number lives here and none
// is shared with config/woodcutting.ts, so the two skills can get different bonuses later.
import type { RockId } from '../types';

const SEC_MS = 1000;
const MIN_MS = 60 * SEC_MS;

export const MINING = {
  /**
   * Mining strength: MS = msPerLevel × mining level + msBase + CORE STR + pickaxe bonus (catalog). Normal STR does not
   * count (1.16.0): rocks stay gated by skill level, tools and training. msBase = the old starting 10 STR.
   */
  msPerLevel: 10,
  msBase: 10,
  /** Time per ore: max(minOreMs, ceil(rock base × (1 − core DEX reduction))), STAT_EFFECTS.dexterity.activityTime. */
  minOreMs: 10 * SEC_MS,
  /** Skip cost: staminaPerStep per started stepMs of the ore left (rounded up, at least one step). */
  skip: { stepMs: 1 * MIN_MS, staminaPerStep: 1 },
  /** Independent rolls per ore, on every rock, in this order (seeded RNG). */
  rareDrops: [{ itemId: 'geode', chance: 1 / 200 }],
  /**
   * Formula constants, documented here and asserted by tests/mining.test.ts against the stored per-rock values
   * (the engine never evaluates them: Math.pow is banned in src/engine).
   *   required MS  = max(reqMsFloor, reqMsPerLevel × reqLevel − reqMsOffset)  (Stone: 20, since 1.10.0; was 0)
   *   XP per ore   = round(xpPerBaseMinute × base minutes × reqLevel^xpLevelExponent)
   * The requirement is also the divisor of the yield (ores per action = MS ÷ required MS × bonus), so it is never 0.
   */
  formula: { reqMsFloor: 20, reqMsPerLevel: 35, reqMsOffset: 75, xpPerBaseMinute: 12.5, xpLevelExponent: 0.4 },
} as const;

export type RockDef = {
  id: RockId;
  name: string;
  /** Placeholder image until pixel sprites exist. */
  icon: string;
  /** Mining level needed to start this rock. */
  reqLevel: number;
  /** Mining strength needed to start this rock (precomputed from MINING.formula). Also the yield divisor: > 0. */
  reqMs: number;
  /** Time per ore before DEX. */
  baseMs: number;
  /** Mining XP per action, whatever the number of ores it yields (precomputed from MINING.formula). */
  xpPerOre: number;
  /** Stackable item every action gives (MS ÷ reqMs × bonus per action, see gathering.ts). */
  oreItemId: string;
};

/** In order, weakest first. */
export const ROCK_IDS = ['stone', 'copper', 'iron', 'silver', 'gold'] as const satisfies readonly RockId[];

export const ROCKS: Record<RockId, RockDef> = {
  stone: { id: 'stone', name: 'Stone', icon: '🪨', reqLevel: 1, reqMs: 20, baseMs: 2 * MIN_MS, xpPerOre: 25, oreItemId: 'stone' },
  copper: { id: 'copper', name: 'Copper', icon: '🟠', reqLevel: 5, reqMs: 100, baseMs: 5 * MIN_MS, xpPerOre: 119, oreItemId: 'copper_ore' },
  iron: { id: 'iron', name: 'Iron', icon: '⚫', reqLevel: 15, reqMs: 450, baseMs: 10 * MIN_MS, xpPerOre: 369, oreItemId: 'iron_ore' },
  silver: { id: 'silver', name: 'Silver', icon: '⚪', reqLevel: 28, reqMs: 905, baseMs: 18 * MIN_MS, xpPerOre: 853, oreItemId: 'silver_ore' },
  gold: { id: 'gold', name: 'Gold', icon: '🟡', reqLevel: 42, reqMs: 1395, baseMs: 30 * MIN_MS, xpPerOre: 1672, oreItemId: 'gold_ore' },
};

export function isRockId(id: unknown): id is RockId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(ROCKS, id);
}
