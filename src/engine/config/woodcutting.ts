// Woodcutting (data). Rules in src/engine/woodcutting.ts; formulas and the tree table in docs/ENGINE.md
// ("Woodcutting"). Owner-approved numbers (2026-10-27). Every number the brief names lives here.
import type { GatheringKind, TreeId } from '../types';

const SEC_MS = 1000;
const MIN_MS = 60 * SEC_MS;

export const WOODCUTTING = {
  /** Woodcutting strength: WS = wsPerLevel × woodcutting level + effective STR + axe bonus (catalog). */
  wsPerLevel: 10,
  /** Cut time per log: max(minLogMs, tree base − perDexterityMs × effective DEX). Oak at DEX 10 = 1:50. */
  perDexterityMs: 1 * SEC_MS,
  minLogMs: 10 * SEC_MS,
  /** Skip cost: staminaPerStep per started stepMs of the log left (rounded up, at least one step). */
  skip: { stepMs: 1 * MIN_MS, staminaPerStep: 1 },
  /** Independent rolls per log, on every tree, in this order (seeded RNG). */
  rareDrops: [{ itemId: 'bird_nest', chance: 1 / 200 }],
  /**
   * Formula constants, documented here and asserted by tests/woodcutting.test.ts against the stored
   * per-tree values (the engine never evaluates them: Math.pow is banned in src/engine).
   *   required WS  = max(0, reqWsPerLevel × reqLevel − reqWsOffset)          (Oak: 0)
   *   XP per log   = round(xpPerBaseMinute × base minutes × reqLevel^xpLevelExponent)
   */
  formula: { reqWsPerLevel: 35, reqWsOffset: 75, xpPerBaseMinute: 12.5, xpLevelExponent: 0.4 },
} as const;

export type TreeDef = {
  id: TreeId;
  name: string;
  /** Placeholder image until pixel sprites exist. */
  icon: string;
  /** Woodcutting level needed to start this tree. */
  reqLevel: number;
  /** Woodcutting strength needed to start this tree (precomputed from WOODCUTTING.formula). */
  reqWs: number;
  /** Cut time per log before DEX. */
  baseMs: number;
  /** Woodcutting XP per log (precomputed from WOODCUTTING.formula). */
  xpPerLog: number;
  /** Stackable item every log gives (1 per log). */
  logItemId: string;
};

/** In order, weakest first. */
export const TREE_IDS = ['oak', 'birch', 'maple', 'yew', 'ironwood'] as const satisfies readonly TreeId[];

export const TREES: Record<TreeId, TreeDef> = {
  oak: { id: 'oak', name: 'Oak', icon: '🌳', reqLevel: 1, reqWs: 0, baseMs: 2 * MIN_MS, xpPerLog: 25, logItemId: 'oak_logs' },
  birch: { id: 'birch', name: 'Birch', icon: '🌿', reqLevel: 5, reqWs: 100, baseMs: 5 * MIN_MS, xpPerLog: 119, logItemId: 'birch_logs' },
  maple: { id: 'maple', name: 'Maple', icon: '🍁', reqLevel: 15, reqWs: 450, baseMs: 10 * MIN_MS, xpPerLog: 369, logItemId: 'maple_logs' },
  yew: { id: 'yew', name: 'Yew', icon: '🌲', reqLevel: 28, reqWs: 905, baseMs: 18 * MIN_MS, xpPerLog: 853, logItemId: 'yew_logs' },
  ironwood: { id: 'ironwood', name: 'Ironwood', icon: '🪨', reqLevel: 42, reqWs: 1395, baseMs: 30 * MIN_MS, xpPerLog: 1672, logItemId: 'ironwood_logs' },
};

export function isTreeId(id: unknown): id is TreeId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(TREES, id);
}

/** Gathering skills: woodcutting (this file) and mining (config/mining.ts). */
export const GATHERING_KINDS = ['woodcutting', 'mining'] as const satisfies readonly GatheringKind[];

export function isGatheringKind(kind: unknown): kind is GatheringKind {
  return typeof kind === 'string' && (GATHERING_KINDS as readonly string[]).includes(kind);
}
