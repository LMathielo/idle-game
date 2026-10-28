// Woodcutting (pure): woodcutting strength, tree requirements, cut time, cutting logs back-to-back inside
// simulate(), and read-only views. See docs/ENGINE.md ("Woodcutting").
//
//   WS            = wsPerLevel × woodcutting level + effective STR + axe bonus (item catalog)
//   cut time/log  = max(minLogMs, tree base − perDexterityMs × effective DEX)
//   unlocked      ⇔ woodcutting level ≥ tree reqLevel AND WS ≥ tree reqWs
//   skip cost     = ceil(remaining min) stamina, at least 1
import { effectiveAttributes, type TrainingLevels } from './attributes';
import { cloneState } from './clone';
import { getItemDef } from './config/items';
import { MAX_ACTIONS_PER_SIMULATION } from './config/time';
import { TREE_IDS, TREES, WOODCUTTING } from './config/woodcutting';
import { SKILL_XP_CURVE } from './config/xpCurve';
import { yieldMultiplierBp } from './bonuses';
import { rollYield, yieldBp } from './gathering';
import { addStackable } from './inventory';
import { addXp } from './progression';
import { chance } from './rng';
import type { Attributes, Character, GameEvent, GameState, SimulationSummary, TreeId, WoodcuttingActivity } from './types';

// ---------- woodcutting strength ----------

/** What woodcutting strength reads. A GameState fits. */
export type WsInput = { character: Pick<Character, 'attributes' | 'equipment' | 'skills'>; training: TrainingLevels };

export type WoodcuttingStrength = {
  value: number;
  /** The three parts add up to `value`. */
  breakdown: {
    /** wsPerLevel × woodcutting level. */
    level: number;
    /** Effective STR (base + trained). */
    strength: number;
    /** The equipped axe's bonus from the catalog (0 with no axe or an unknown one). */
    axe: number;
    /** The equipped axe's definition id, if any. */
    axeDefId: string | null;
  };
};

/** WS bonus of the equipped axe, read from the item catalog by defId. */
export function axeBonus(equipment: Character['equipment']): number {
  const axe = equipment.axe;
  if (!axe) return 0;
  const bonus = getItemDef(axe.defId)?.woodcuttingStrength ?? 0;
  return Number.isSafeInteger(bonus) && bonus > 0 ? bonus : 0;
}

export function woodcuttingStrength(state: WsInput): WoodcuttingStrength {
  const level = WOODCUTTING.wsPerLevel * state.character.skills.woodcutting.level;
  const strength = effectiveAttributes(state).strength;
  const axe = axeBonus(state.character.equipment);
  return { value: level + strength + axe, breakdown: { level, strength, axe, axeDefId: state.character.equipment.axe?.defId ?? null } };
}

// ---------- trees ----------

/** Cut time of one log: max(minLogMs, base − perDexterityMs × DEX). Pass EFFECTIVE attributes. */
export function logMsFor(treeId: TreeId, attributes: Pick<Attributes, 'dexterity'>): number {
  return Math.max(WOODCUTTING.minLogMs, TREES[treeId].baseMs - WOODCUTTING.perDexterityMs * attributes.dexterity);
}

/** Stamina to skip the rest of a log: staminaPerStep per started step left, at least one step. */
export function woodcutSkipCost(remainingMs: number): number {
  const { stepMs, staminaPerStep } = WOODCUTTING.skip;
  return Math.max(1, Math.ceil(Math.max(0, remainingMs) / stepMs)) * staminaPerStep;
}

export type TreeCheck = { levelOk: boolean; wsOk: boolean; unlocked: boolean };

/** Is the tree open for this hero (level and WS requirements). */
export function treeCheck(state: WsInput, treeId: TreeId): TreeCheck {
  const tree = TREES[treeId];
  const levelOk = state.character.skills.woodcutting.level >= tree.reqLevel;
  const wsOk = woodcuttingStrength(state).value >= tree.reqWs;
  return { levelOk, wsOk, unlocked: levelOk && wsOk };
}

function bump(map: Record<string, number>, key: string, by: number) {
  if (by !== 0) map[key] = (map[key] ?? 0) + by;
}

/**
 * Cuts one log on `draft` (mutated): the log item, the rare-drop rolls (seeded RNG), woodcutting XP with
 * every level-up. The caller owns draft.rng, draft.inventory, draft.stats and draft.character.skills.
 */
export function cutLog(draft: GameState, treeId: TreeId, summary: SimulationSummary | null, events: GameEvent[]): void {
  const tree = TREES[treeId];
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
  const y = rollYield(draft.rng, yieldBp(woodcuttingStrength(draft).value, tree.reqWs, yieldMultiplierBp(draft, 'woodcutting')));
  draft.rng = y.rng;
  gain(tree.logItemId, y.count);
  for (const drop of WOODCUTTING.rareDrops) {
    const roll = chance(draft.rng, drop.chance);
    draft.rng = roll.rng;
    if (roll.value) {
      gain(drop.itemId);
      events.push({ type: 'RARE_DROP', itemId: drop.itemId });
    }
  }

  const res = addXp(draft.character.skills.woodcutting, tree.xpPerLog, SKILL_XP_CURVE);
  draft.character.skills.woodcutting = res.progress;
  if (summary) {
    summary.skillXpGained.woodcutting = (summary.skillXpGained.woodcutting ?? 0) + tree.xpPerLog;
    summary.actions += 1;
    if (res.levelsGained > 0) summary.skillLevelsGained.woodcutting = (summary.skillLevelsGained.woodcutting ?? 0) + res.levelsGained;
  }
  if (res.levelsGained > 0) events.push({ type: 'SKILL_LEVEL_UP', skill: 'woodcutting', level: res.progress.level });
  draft.stats.totalActions += 1;
}

/**
 * Woodcutting inside simulate(): logs follow each other back-to-back over the granted (capped) time; the
 * remainder stays in progressMs. Cut time depends on DEX only, which woodcutting never changes, so it is
 * fixed for the whole call and many small ticks equal one big resume.
 *
 * `draft` comes from simulate(): `draft.activity` is already a copy; rng/stats/character/inventory may
 * still be shared with the input, so they are copied once before the first log.
 */
export function advanceWoodcutting(draft: GameState, activity: WoodcuttingActivity, grantedMs: number, summary: SimulationSummary, events: GameEvent[]): void {
  if (!(grantedMs > 0)) return;
  activity.progressMs += grantedMs * draft.offline.efficiency;
  const logMs = logMsFor(activity.treeId, effectiveAttributes(draft));
  let owned = false;
  let guard = 0;
  while (activity.progressMs >= logMs && guard < MAX_ACTIONS_PER_SIMULATION) {
    if (!owned) {
      draft.rng = { ...draft.rng };
      draft.stats = cloneState(draft.stats);
      // Logs change skills only; attributes and equipment keep their identity.
      draft.character = { ...draft.character, skills: cloneState(draft.character.skills) };
      draft.inventory = cloneState(draft.inventory);
      owned = true;
    }
    activity.progressMs -= logMs;
    cutLog(draft, activity.treeId, summary, events);
    guard += 1;
  }
}

// ---------- read-only views for the UI ----------

export type TreeView = TreeCheck & {
  treeId: TreeId;
  name: string;
  icon: string;
  reqLevel: number;
  reqWs: number;
  /** Cut time per log for this hero (DEX applied). */
  logMs: number;
  xpPerLog: number;
  logItemId: string;
  /** Rare drops per log, with their chance (0..1). */
  rareDrops: readonly { itemId: string; chance: number }[];
  /** Expected items per action for this hero right now, in basis points (10 000 = 1 item; power ÷ requirement × bonus). */
  yieldBp: number;
  /** This tree is being cut right now. */
  active: boolean;
};

export type WoodcutActivityView = {
  kind: 'woodcutting';
  treeId: TreeId;
  skillLevel: number;
  logMs: number;
  /** Progress of the current log, 0..1. */
  fraction: number;
  remainingMs: number;
  /** 1-based number of the log being cut (lifetime logs + 1). A skip names it, so it can't hit a later log. */
  log: number;
  /** Stamina a skip would cost right now. */
  skipCost: number;
};

export type WoodcuttingView = {
  level: number;
  xp: number;
  xpToNext: number;
  ws: WoodcuttingStrength;
  /** In TREE_IDS order. */
  trees: TreeView[];
  /** The tree being cut, or null. */
  activeTreeId: TreeId | null;
  /** The tree the UI should open on: the active one, else the highest unlocked one. */
  focusTreeId: TreeId;
  /** The log in progress, or null when not woodcutting. */
  current: WoodcutActivityView | null;
};

export function treeView(state: GameState, treeId: TreeId): TreeView {
  const tree = TREES[treeId];
  return {
    ...treeCheck(state, treeId),
    treeId,
    name: tree.name,
    icon: tree.icon,
    reqLevel: tree.reqLevel,
    reqWs: tree.reqWs,
    logMs: logMsFor(treeId, effectiveAttributes(state)),
    xpPerLog: tree.xpPerLog,
    logItemId: tree.logItemId,
    rareDrops: WOODCUTTING.rareDrops,
    yieldBp: yieldBp(woodcuttingStrength(state).value, tree.reqWs, yieldMultiplierBp(state, 'woodcutting')),
    active: state.activity?.kind === 'woodcutting' && state.activity.treeId === treeId,
  };
}

export function woodcutActivityView(state: GameState): WoodcutActivityView | null {
  const a = state.activity;
  if (a?.kind !== 'woodcutting') return null;
  const logMs = logMsFor(a.treeId, effectiveAttributes(state));
  const progress = Math.min(a.progressMs, logMs);
  const remainingMs = Math.max(0, logMs - progress);
  return {
    kind: 'woodcutting',
    treeId: a.treeId,
    skillLevel: state.character.skills.woodcutting.level,
    logMs,
    fraction: logMs > 0 ? progress / logMs : 0,
    remainingMs,
    log: state.stats.totalActions + 1,
    skipCost: woodcutSkipCost(remainingMs),
  };
}

export function woodcuttingView(state: GameState): WoodcuttingView {
  const skill = state.character.skills.woodcutting;
  const trees = TREE_IDS.map((id) => treeView(state, id));
  const activeTreeId = state.activity?.kind === 'woodcutting' ? state.activity.treeId : null;
  let focusTreeId: TreeId = TREE_IDS[0];
  for (const t of trees) if (t.unlocked) focusTreeId = t.treeId;
  return {
    level: skill.level,
    xp: skill.xp,
    xpToNext: skill.xpToNext,
    ws: woodcuttingStrength(state),
    trees,
    activeTreeId,
    focusTreeId: activeTreeId ?? focusTreeId,
    current: woodcutActivityView(state),
  };
}
