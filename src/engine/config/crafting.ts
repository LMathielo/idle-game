// Crafting house (data): pipes, recipes, craft time and stamina rules. Rules in src/engine/crafting.ts; tables in
// docs/ENGINE.md ("Crafting") and docs/PRODUCT.md. Owner-approved 2026-11-01 (engine 1.13.0, save v13).
//
//   craft time  = max(minCraftMs, ceil(baseMs × house time bp / 10 000 × (1 − INT reduction)))    (integer ms)
//   INT reduction = diminishing(core INT, STAT_EFFECTS.intelligence.craftTime)               (config/stats.ts)
//   output / craft = output × (1, or x10.multiplier for a ×10 craft) × (10 000 + house yield bp) / 10 000; the fraction
//                    goes to a ledger
//   x10 tap        = (x10.multiplier − 1) × the inputs now + max(1, ceil(x10.staminaPerMinute × craft time / 1 min))
//                    stamina, on the craft in progress only (1.15.0)
//   insta = ceil(remaining minutes) stamina, at least 1 (the rule of every skip)
//
// Continuous material pipes (1.15.0, owner-approved 2026-11-01): a material job has no quantity and no mode. Each craft
// takes its inputs when it starts; with too few the pipe waits (no time passes) and starts the instant they are there.
//
// Gear recipes (1.14.0, owner-approved 2026-11-01): one piece per job (x1 only, no yield bonus), made from its tier's
// bricks / ingots and planks (config/gear.ts); stamina invested at start raises the quality floor; the piece's quality
// and rarity are rolled at start and it waits in the pipe (`ready`) until Done.

import { GEAR_PIECE_IDS, GEAR_PIECES, GEAR_SETS, type RarityWeight } from './gear';

const SEC = 1000;
const MIN_MS = 60 * SEC;

export const CRAFTING = {
  /** Pipe slots shown in the Crafting house (and stored in the save). */
  pipeSlots: 8,
  /** Pipes open on a new save. */
  startPipes: 2,
  /** Pipes up to this index (1-based) unlock later by play; the ones above are premium (neither exists yet). */
  freePipes: 4,
  /** No craft is ever faster than this. */
  minCraftMs: 1 * SEC,
  /**
   * ×10 tap on a material craft in progress (1.15.0): the craft makes `multiplier`× its output in the same time; the tap
   * takes the (multiplier − 1)× extra inputs and max(1, ceil(staminaPerMinute × craft ms ÷ 1 min)) stamina. Normal items only.
   */
  x10: { multiplier: 10, staminaPerMinute: 9 },
  /** Insta (finish the current craft now): staminaPerStep per started step left, at least one step. */
  insta: { stepMs: 1 * MIN_MS, staminaPerStep: 1 },
  /** The yield fraction ledger counts thousandths of an item: one more item per 1000. */
  remainderUnit: 1000,
} as const;

/** `material`: a normal stackable item (planks, bricks, ingots). `gear`: one equippable piece with a rolled quality and rarity. */
export type RecipeKind = 'material' | 'gear';

export type RecipeDef = {
  id: string;
  name: string;
  kind: RecipeKind;
  /** 1–5: inputs and time double every tier. */
  tier: number;
  /** Consumed per craft (× 10 for a ×10 craft). */
  inputs: readonly { defId: string; quantity: number }[];
  /** Produced per craft (× 10 for a ×10 craft, × the house yield). */
  output: { defId: string; quantity: number };
  /** Craft time before the house level and INT. */
  baseMs: number;
  /** Gear only: this recipe's rarity odds, instead of GEAR.craft.rarityWeights. None sets one yet. */
  rarityWeights?: readonly RarityWeight[];
};

const material = (id: string, name: string, tier: number, input: string, output: string): RecipeDef => {
  const scale = 1 << (tier - 1); // 1, 2, 4, 8, 16
  return { id, name, kind: 'material', tier, inputs: [{ defId: input, quantity: 2 * scale }], output: { defId: output, quantity: 1 }, baseMs: 5 * SEC * scale };
};

/** A gear recipe: `<set>_<piece>` from the set's bar and plank; inputs fixed per piece, time doubling per tier. */
const gear = (setId: string, pieceId: (typeof GEAR_PIECE_IDS)[number]): RecipeDef => {
  const set = GEAR_SETS.find((x) => x.id === setId)!;
  const piece = GEAR_PIECES[pieceId];
  const id = `${set.id}_${pieceId}`;
  return {
    id,
    name: `${set.name} ${piece.name}`,
    kind: 'gear',
    tier: set.tier,
    inputs: [
      { defId: set.bar, quantity: piece.bars },
      { defId: set.plank, quantity: piece.planks },
    ],
    output: { defId: id, quantity: 1 },
    baseMs: piece.t1Ms * (1 << (set.tier - 1)),
  };
};

/** Every recipe, in picker order: materials (by tier, planks before bricks / ingots), then gear (by tier, then piece). */
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
  'stone_sword',
  'stone_helm',
  'stone_chestplate',
  'stone_shield',
  'stone_gloves',
  'stone_boots',
  'copper_sword',
  'copper_helm',
  'copper_chestplate',
  'copper_shield',
  'copper_gloves',
  'copper_boots',
  'iron_sword',
  'iron_helm',
  'iron_chestplate',
  'iron_shield',
  'iron_gloves',
  'iron_boots',
  'silver_sword',
  'silver_helm',
  'silver_chestplate',
  'silver_shield',
  'silver_gloves',
  'silver_boots',
  'gold_sword',
  'gold_helm',
  'gold_chestplate',
  'gold_shield',
  'gold_gloves',
  'gold_boots',
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
  stone_sword: gear('stone', 'sword'),
  stone_helm: gear('stone', 'helm'),
  stone_chestplate: gear('stone', 'chestplate'),
  stone_shield: gear('stone', 'shield'),
  stone_gloves: gear('stone', 'gloves'),
  stone_boots: gear('stone', 'boots'),
  copper_sword: gear('copper', 'sword'),
  copper_helm: gear('copper', 'helm'),
  copper_chestplate: gear('copper', 'chestplate'),
  copper_shield: gear('copper', 'shield'),
  copper_gloves: gear('copper', 'gloves'),
  copper_boots: gear('copper', 'boots'),
  iron_sword: gear('iron', 'sword'),
  iron_helm: gear('iron', 'helm'),
  iron_chestplate: gear('iron', 'chestplate'),
  iron_shield: gear('iron', 'shield'),
  iron_gloves: gear('iron', 'gloves'),
  iron_boots: gear('iron', 'boots'),
  silver_sword: gear('silver', 'sword'),
  silver_helm: gear('silver', 'helm'),
  silver_chestplate: gear('silver', 'chestplate'),
  silver_shield: gear('silver', 'shield'),
  silver_gloves: gear('silver', 'gloves'),
  silver_boots: gear('silver', 'boots'),
  gold_sword: gear('gold', 'sword'),
  gold_helm: gear('gold', 'helm'),
  gold_chestplate: gear('gold', 'chestplate'),
  gold_shield: gear('gold', 'shield'),
  gold_gloves: gear('gold', 'gloves'),
  gold_boots: gear('gold', 'boots'),
};

export function isRecipeId(id: unknown): id is RecipeId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(RECIPES, id);
}
