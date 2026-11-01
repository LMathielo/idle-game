// Crafting house (data): pipes, recipes, craft time and stamina rules. Rules in src/engine/crafting.ts; tables in
// docs/ENGINE.md ("Crafting") and docs/PRODUCT.md. Owner-approved 2026-11-01 (engine 1.13.0, save v13).
//
//   craft time  = max(minCraftMs, ceil(baseMs × house time bp / 10 000 × (1 − INT reduction)))    (integer ms)
//   INT reduction = diminishing(effective INT, STAT_EFFECTS.intelligence.craftTime)               (config/stats.ts)
//   output / craft = output × mode multiplier × (10 000 + house yield bp) / 10 000; the fraction goes to a ledger
//   x10 stamina / craft = max(1, ceil(x10.staminaPerMinute × craft time / 1 min)), paid for the whole job up front
//   insta = ceil(remaining minutes) stamina, at least 1 (the rule of every skip)

import type { CraftMode } from '../types';

const SEC = 1000;
const MIN_MS = 60 * SEC;

/** Crafting modes: x1 crafts the recipe as written; x10 crafts ten times the inputs and output in the same time. */
export const CRAFT_MODES = ['x1', 'x10'] as const satisfies readonly CraftMode[];

export const CRAFTING = {
  /** Pipe slots shown in the Crafting house (and stored in the save). */
  pipeSlots: 8,
  /** Pipes open on a new save. */
  startPipes: 2,
  /** Pipes up to this index (1-based) unlock later by play; the ones above are premium (neither exists yet). */
  freePipes: 4,
  /** No craft is ever faster than this. */
  minCraftMs: 1 * SEC,
  /** Most crafts in one job (keeps every product far below 2^53). */
  maxJobQuantity: 100_000,
  /** Output and input multiplier per mode. */
  modeMultiplier: { x1: 1, x10: 10 } satisfies Record<CraftMode, number>,
  /** x10 mode: stamina per craft = max(1, ceil(staminaPerMinute × craft ms ÷ 1 min)). Normal items only. */
  x10: { staminaPerMinute: 9 },
  /** Insta (finish the current craft now): staminaPerStep per started step left, at least one step. */
  insta: { stepMs: 1 * MIN_MS, staminaPerStep: 1 },
  /** The yield fraction ledger counts thousandths of an item: one more item per 1000. */
  remainderUnit: 1000,
} as const;

/** `material`: a normal stackable item (planks, bricks, ingots). PR B adds gear recipes (single rolled item). */
export type RecipeKind = 'material';

export type RecipeDef = {
  id: string;
  name: string;
  kind: RecipeKind;
  /** 1–5: inputs and time double every tier. */
  tier: number;
  /** Consumed per craft (× the mode multiplier). */
  inputs: readonly { defId: string; quantity: number }[];
  /** Produced per craft (× the mode multiplier, × the house yield). */
  output: { defId: string; quantity: number };
  /** Craft time before the house level and INT. */
  baseMs: number;
};

const material = (id: string, name: string, tier: number, input: string, output: string): RecipeDef => {
  const scale = 1 << (tier - 1); // 1, 2, 4, 8, 16
  return { id, name, kind: 'material', tier, inputs: [{ defId: input, quantity: 2 * scale }], output: { defId: output, quantity: 1 }, baseMs: 5 * SEC * scale };
};

/** Every recipe, in picker order (by tier, planks before bricks / ingots). */
export const RECIPE_IDS = [
  'oak_plank',
  'stone_brick',
  'birch_plank',
  'copper_ingot',
  'maple_plank',
  'iron_ingot',
  'yew_plank',
  'silver_ingot',
  'ironwood_plank',
  'gold_ingot',
] as const;

export type RecipeId = (typeof RECIPE_IDS)[number];

/** Owner-approved 2026-11-01: 2 / 4 / 8 / 16 / 32 inputs and 5 / 10 / 20 / 40 / 80 s by tier, one output. */
export const RECIPES: Record<RecipeId, RecipeDef> = {
  oak_plank: material('oak_plank', 'Oak Plank', 1, 'oak_logs', 'oak_plank'),
  stone_brick: material('stone_brick', 'Stone Brick', 1, 'stone', 'stone_brick'),
  birch_plank: material('birch_plank', 'Birch Plank', 2, 'birch_logs', 'birch_plank'),
  copper_ingot: material('copper_ingot', 'Copper Ingot', 2, 'copper_ore', 'copper_ingot'),
  maple_plank: material('maple_plank', 'Maple Plank', 3, 'maple_logs', 'maple_plank'),
  iron_ingot: material('iron_ingot', 'Iron Ingot', 3, 'iron_ore', 'iron_ingot'),
  yew_plank: material('yew_plank', 'Yew Plank', 4, 'yew_logs', 'yew_plank'),
  silver_ingot: material('silver_ingot', 'Silver Ingot', 4, 'silver_ore', 'silver_ingot'),
  ironwood_plank: material('ironwood_plank', 'Ironwood Plank', 5, 'ironwood_logs', 'ironwood_plank'),
  gold_ingot: material('gold_ingot', 'Gold Ingot', 5, 'gold_ore', 'gold_ingot'),
};

export function isRecipeId(id: unknown): id is RecipeId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(RECIPES, id);
}

export function isCraftMode(mode: unknown): mode is CraftMode {
  return typeof mode === 'string' && (CRAFT_MODES as readonly string[]).includes(mode);
}
