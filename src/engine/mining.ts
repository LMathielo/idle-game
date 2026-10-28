// Mining (pure): mining strength, rock requirements, time per ore, mining ores back-to-back inside simulate(),
// and read-only views. Mirrors woodcutting.ts rule for rule, but reads only config/mining.ts, so the two skills
// can diverge later. See docs/ENGINE.md ("Mining").
//
//   MS            = msPerLevel × mining level + effective STR + pickaxe bonus (item catalog)
//   time / ore    = max(minOreMs, rock base − perDexterityMs × effective DEX)
//   unlocked      ⇔ mining level ≥ rock reqLevel AND MS ≥ rock reqMs
//   skip cost     = ceil(remaining min) stamina, at least 1
import { effectiveAttributes, type TrainingLevels } from './attributes';
import { cloneState } from './clone';
import { getItemDef } from './config/items';
import { MINING, ROCK_IDS, ROCKS } from './config/mining';
import { MAX_ACTIONS_PER_SIMULATION } from './config/time';
import { SKILL_XP_CURVE } from './config/xpCurve';
import { yieldMultiplierBp } from './bonuses';
import { rollYield, yieldBp } from './gathering';
import { addStackable } from './inventory';
import { addXp } from './progression';
import { chance } from './rng';
import type { Attributes, Character, GameEvent, GameState, MiningActivity, RockId, SimulationSummary } from './types';

// ---------- mining strength ----------

/** What mining strength reads. A GameState fits. */
export type MsInput = { character: Pick<Character, 'attributes' | 'equipment' | 'skills'>; training: TrainingLevels };

export type MiningStrength = {
  value: number;
  /** The three parts add up to `value`. */
  breakdown: {
    /** msPerLevel × mining level. */
    level: number;
    /** Effective STR (base + trained). */
    strength: number;
    /** The equipped pickaxe's bonus from the catalog (0 with no pickaxe or an unknown one). */
    pickaxe: number;
    /** The equipped pickaxe's definition id, if any. */
    pickaxeDefId: string | null;
  };
};

/** MS bonus of the equipped pickaxe, read from the item catalog by defId. */
export function pickaxeBonus(equipment: Character['equipment']): number {
  const pickaxe = equipment.pickaxe;
  if (!pickaxe) return 0;
  const bonus = getItemDef(pickaxe.defId)?.miningStrength ?? 0;
  return Number.isSafeInteger(bonus) && bonus > 0 ? bonus : 0;
}

export function miningStrength(state: MsInput): MiningStrength {
  const level = MINING.msPerLevel * state.character.skills.mining.level;
  const strength = effectiveAttributes(state).strength;
  const pickaxe = pickaxeBonus(state.character.equipment);
  return { value: level + strength + pickaxe, breakdown: { level, strength, pickaxe, pickaxeDefId: state.character.equipment.pickaxe?.defId ?? null } };
}

// ---------- rocks ----------

/** Time to mine one ore: max(minOreMs, base − perDexterityMs × DEX). Pass EFFECTIVE attributes. */
export function oreMsFor(rockId: RockId, attributes: Pick<Attributes, 'dexterity'>): number {
  return Math.max(MINING.minOreMs, ROCKS[rockId].baseMs - MINING.perDexterityMs * attributes.dexterity);
}

/** Stamina to skip the rest of an ore: staminaPerStep per started step left, at least one step. */
export function mineSkipCost(remainingMs: number): number {
  const { stepMs, staminaPerStep } = MINING.skip;
  return Math.max(1, Math.ceil(Math.max(0, remainingMs) / stepMs)) * staminaPerStep;
}

export type RockCheck = { levelOk: boolean; msOk: boolean; unlocked: boolean };

/** Is the rock open for this hero (level and MS requirements). */
export function rockCheck(state: MsInput, rockId: RockId): RockCheck {
  const rock = ROCKS[rockId];
  const levelOk = state.character.skills.mining.level >= rock.reqLevel;
  const msOk = miningStrength(state).value >= rock.reqMs;
  return { levelOk, msOk, unlocked: levelOk && msOk };
}

function bump(map: Record<string, number>, key: string, by: number) {
  if (by !== 0) map[key] = (map[key] ?? 0) + by;
}

/**
 * Mines one ore on `draft` (mutated): the ore item, the rare-drop rolls (seeded RNG), mining XP with every
 * level-up. The caller owns draft.rng, draft.inventory, draft.stats and draft.character.skills.
 */
export function mineOre(draft: GameState, rockId: RockId, summary: SimulationSummary | null, events: GameEvent[]): void {
  const rock = ROCKS[rockId];
  const gain = (itemId: string, quantity = 1) => {
    if (quantity <= 0) return;
    const { added, lost } = addStackable(draft.inventory, itemId, quantity);
    if (summary) {
      bump(summary.itemsGained, itemId, added);
      bump(summary.itemsLost, itemId, lost);
    }
    bump(draft.stats.itemsGathered, itemId, added);
  };

  // Power-based yield (1.10.0): power ÷ requirement × bonus multiplier; the fraction is the chance of one more.
  const y = rollYield(draft.rng, yieldBp(miningStrength(draft).value, rock.reqMs, yieldMultiplierBp(draft, 'mining')));
  draft.rng = y.rng;
  gain(rock.oreItemId, y.count);
  for (const drop of MINING.rareDrops) {
    const roll = chance(draft.rng, drop.chance);
    draft.rng = roll.rng;
    if (roll.value) {
      gain(drop.itemId);
      events.push({ type: 'RARE_DROP', itemId: drop.itemId });
    }
  }

  const res = addXp(draft.character.skills.mining, rock.xpPerOre, SKILL_XP_CURVE);
  draft.character.skills.mining = res.progress;
  if (summary) {
    summary.skillXpGained.mining = (summary.skillXpGained.mining ?? 0) + rock.xpPerOre;
    summary.oresMined += 1;
    if (res.levelsGained > 0) summary.skillLevelsGained.mining = (summary.skillLevelsGained.mining ?? 0) + res.levelsGained;
  }
  if (res.levelsGained > 0) events.push({ type: 'SKILL_LEVEL_UP', skill: 'mining', level: res.progress.level });
  // Lifetime gathering actions (logs and ores): numbers the item in progress for the skip binding.
  draft.stats.totalActions += 1;
}

/**
 * Mining inside simulate(): ores follow each other back-to-back over the granted (capped) time; the remainder
 * stays in progressMs. Time per ore depends on DEX only, which mining never changes, so it is fixed for the
 * whole call and many small ticks equal one big resume.
 *
 * `draft` comes from simulate(): `draft.activity` is already a copy; rng/stats/character/inventory may still be
 * shared with the input, so they are copied once before the first ore.
 */
export function advanceMining(draft: GameState, activity: MiningActivity, grantedMs: number, summary: SimulationSummary, events: GameEvent[]): void {
  if (!(grantedMs > 0)) return;
  activity.progressMs += grantedMs * draft.offline.efficiency;
  const oreMs = oreMsFor(activity.rockId, effectiveAttributes(draft));
  let owned = false;
  let guard = 0;
  while (activity.progressMs >= oreMs && guard < MAX_ACTIONS_PER_SIMULATION) {
    if (!owned) {
      draft.rng = { ...draft.rng };
      draft.stats = cloneState(draft.stats);
      // Ores change skills only; attributes and equipment keep their identity.
      draft.character = { ...draft.character, skills: cloneState(draft.character.skills) };
      draft.inventory = cloneState(draft.inventory);
      owned = true;
    }
    activity.progressMs -= oreMs;
    mineOre(draft, activity.rockId, summary, events);
    guard += 1;
  }
}

// ---------- read-only views for the UI ----------

export type RockView = RockCheck & {
  rockId: RockId;
  name: string;
  icon: string;
  reqLevel: number;
  reqMs: number;
  /** Time per ore for this hero (DEX applied). */
  oreMs: number;
  xpPerOre: number;
  oreItemId: string;
  /** Rare drops per ore, with their chance (0..1). */
  rareDrops: readonly { itemId: string; chance: number }[];
  /** Expected items per action for this hero right now, in basis points (10 000 = 1 item; power ÷ requirement × bonus). */
  yieldBp: number;
  /** This rock is being mined right now. */
  active: boolean;
};

export type MineActivityView = {
  kind: 'mining';
  rockId: RockId;
  skillLevel: number;
  oreMs: number;
  /** Progress of the current ore, 0..1. */
  fraction: number;
  remainingMs: number;
  /** 1-based number of the ore being mined (lifetime gathering actions + 1). A skip names it, so it can't hit a later ore. */
  ore: number;
  /** Stamina a skip would cost right now. */
  skipCost: number;
};

export type MiningView = {
  level: number;
  xp: number;
  xpToNext: number;
  ms: MiningStrength;
  /** In ROCK_IDS order. */
  rocks: RockView[];
  /** The rock being mined, or null. */
  activeRockId: RockId | null;
  /** The rock the UI should open on: the active one, else the highest unlocked one. */
  focusRockId: RockId;
  /** The ore in progress, or null when not mining. */
  current: MineActivityView | null;
};

export function rockView(state: GameState, rockId: RockId): RockView {
  const rock = ROCKS[rockId];
  return {
    ...rockCheck(state, rockId),
    rockId,
    name: rock.name,
    icon: rock.icon,
    reqLevel: rock.reqLevel,
    reqMs: rock.reqMs,
    oreMs: oreMsFor(rockId, effectiveAttributes(state)),
    xpPerOre: rock.xpPerOre,
    oreItemId: rock.oreItemId,
    rareDrops: MINING.rareDrops,
    yieldBp: yieldBp(miningStrength(state).value, rock.reqMs, yieldMultiplierBp(state, 'mining')),
    active: state.activity?.kind === 'mining' && state.activity.rockId === rockId,
  };
}

export function mineActivityView(state: GameState): MineActivityView | null {
  const a = state.activity;
  if (a?.kind !== 'mining') return null;
  const oreMs = oreMsFor(a.rockId, effectiveAttributes(state));
  const progress = Math.min(a.progressMs, oreMs);
  const remainingMs = Math.max(0, oreMs - progress);
  return {
    kind: 'mining',
    rockId: a.rockId,
    skillLevel: state.character.skills.mining.level,
    oreMs,
    fraction: oreMs > 0 ? progress / oreMs : 0,
    remainingMs,
    ore: state.stats.totalActions + 1,
    skipCost: mineSkipCost(remainingMs),
  };
}

export function miningView(state: GameState): MiningView {
  const skill = state.character.skills.mining;
  const rocks = ROCK_IDS.map((id) => rockView(state, id));
  const activeRockId = state.activity?.kind === 'mining' ? state.activity.rockId : null;
  let focusRockId: RockId = ROCK_IDS[0];
  for (const r of rocks) if (r.unlocked) focusRockId = r.rockId;
  return {
    level: skill.level,
    xp: skill.xp,
    xpToNext: skill.xpToNext,
    ms: miningStrength(state),
    rocks,
    activeRockId,
    focusRockId: activeRockId ?? focusRockId,
    current: mineActivityView(state),
  };
}
