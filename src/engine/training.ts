// Training (pure): gold-bought tiers and timed attribute training. See docs/ENGINE.md ("Training").
//
//   XP to reach training level n   = firstLevelXp + perLevelXp × (n − 1)      (5 + 10(n − 1) minutes)
//   cap of tier t                  = levelsPerTier × t                          (20t, tier 0 = nothing)
//   price of tier t                = tierPriceBase × t³                         (100 · t³ gold)
//   trained ms                     = granted ms × efficiency × rateMultiplier   (1 XP per trained minute)
//
// Training progress lives per attribute in state.training, never on the activity, so pausing, switching
// attribute or starting another activity keeps it. Integer math only; no RNG.
import { effectiveAttributes } from './attributes';
import { cloneState } from './clone';
import { MAX_ACTIONS_PER_SIMULATION } from './config/time';
import { TRAINING } from './config/training';
import { hpRegenPerMinute, maxHpOf, regenHp } from './hp';
import {
  ATTRIBUTE_KEYS,
  type AttributeKey,
  type AttributeTraining,
  type GameEvent,
  type GameState,
  type SimulationSummary,
  type TrainingActivity,
  type TrainingState,
} from './types';

/** Training XP to go from `level` to `level + 1` (= XP to reach level + 1). */
export function trainingXpToNext(level: number): number {
  if (!Number.isSafeInteger(level) || level < 0) throw new RangeError(`trainingXpToNext: invalid level ${level}`);
  return TRAINING.firstLevelXp + TRAINING.perLevelXp * level;
}

/** Training XP to reach level `n` (n ≥ 1) from n − 1: 5 + 10 × (n − 1). */
export function trainingXpToReach(n: number): number {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`trainingXpToReach: invalid level ${n}`);
  return trainingXpToNext(n - 1);
}

/** Highest training level a tier allows (0 at tier 0). */
export function trainingCap(tier: number): number {
  return TRAINING.levelsPerTier * Math.max(0, tier);
}

/** Gold price of tier `tier` (1..maxTier): tierPriceBase × t³. Integer math, no Math.pow. */
export function trainingTierPrice(tier: number): number {
  if (!Number.isSafeInteger(tier) || tier < 1 || tier > TRAINING.maxTier) throw new RangeError(`trainingTierPrice: invalid tier ${tier}`);
  return TRAINING.tierPriceBase * tier * tier * tier;
}

/**
 * Rate multiplier hook for training XP (a future INT effect plugs in here). Does nothing today: it is
 * TRAINING.rateMultiplier (1) for every attribute.
 */
export function trainingRateMultiplier(_state: Pick<GameState, 'character' | 'training'>, _attribute: AttributeKey): number {
  return TRAINING.rateMultiplier;
}

/** Trained ms per ms of granted time. */
function trainingSpeed(state: GameState, attribute: AttributeKey): number {
  return state.offline.efficiency * trainingRateMultiplier(state, attribute);
}

/** Fresh training state: tier 0 (nothing trainable), every attribute at level 0 with no XP. */
export function newTrainingState(): TrainingState {
  const attributes = {} as Record<AttributeKey, AttributeTraining>;
  for (const k of ATTRIBUTE_KEYS) attributes[k] = { level: 0, xp: 0, progressMs: 0 };
  return { tier: 0, attributes };
}

/** Trained ms still needed for the next level. */
function msToNextLevel(t: AttributeTraining): number {
  return (trainingXpToNext(t.level) - t.xp) * TRAINING.msPerXp - t.progressMs;
}

/** Adds trained time below the next level-up (`ms` < msToNextLevel). Mutates `t`. */
function bank(t: AttributeTraining, attribute: AttributeKey, ms: number, summary: SimulationSummary | null) {
  const total = t.progressMs + ms;
  const gained = Math.floor(total / TRAINING.msPerXp);
  t.xp += gained;
  t.progressMs = total - gained * TRAINING.msPerXp;
  if (summary && gained > 0) summary.trainingXpGained[attribute] = (summary.trainingXpGained[attribute] ?? 0) + gained;
}

/**
 * The attribute sits at its tier's cap: no XP is kept beyond it (the remainder is dropped) and training
 * stops by itself. Mutates `draft` (training must be the caller's copy).
 */
function stopAtCap(draft: GameState, attribute: AttributeKey, summary: SimulationSummary | null, events: GameEvent[]) {
  const t = draft.training.attributes[attribute];
  t.xp = 0;
  t.progressMs = 0;
  events.push({ type: 'TRAINING_MAXED', attribute });
  summary?.trainingMaxed.push(attribute);
  if (draft.activity?.kind === 'training' && draft.activity.attribute === attribute) {
    draft.activity = null;
    events.push({ type: 'ACTIVITY_STOPPED', kind: 'training' });
  }
}

/** Completes the current level (the time for it was already counted). Returns true when the cap was reached. */
function completeLevel(draft: GameState, attribute: AttributeKey, summary: SimulationSummary | null, events: GameEvent[]): boolean {
  const t = draft.training.attributes[attribute];
  if (summary) {
    summary.trainingXpGained[attribute] = (summary.trainingXpGained[attribute] ?? 0) + (trainingXpToNext(t.level) - t.xp);
    summary.trainingLevelsGained[attribute] = (summary.trainingLevelsGained[attribute] ?? 0) + 1;
  }
  t.level += 1;
  t.xp = 0;
  t.progressMs = 0;
  events.push({ type: 'TRAINING_LEVEL_UP', attribute, level: t.level });
  if (t.level < trainingCap(draft.training.tier)) return false;
  stopAtCap(draft, attribute, summary, events);
  return true;
}

/**
 * Training inside simulate(). Walks the granted (capped) time level by level, in time order: HP regenerates
 * at the rate of the moment, and a level-up (an END level raises the rate) applies at its exact instant, so
 * 1 s ticks and one big resume give the same state. Regen then continues over the rest of the uncapped
 * time, like dungeon runs. At the cap training stops and the rest of the time only counts for regen.
 *
 * `draft` comes from simulate(): `draft.training` may still be shared with the input, so it is copied here.
 */
export function advanceTraining(
  draft: GameState,
  activity: TrainingActivity,
  grantedMs: number,
  requestedMs: number,
  summary: SimulationSummary,
  events: GameEvent[],
): void {
  const { attribute } = activity;
  let regenLeft = requestedMs;
  const regen = (ms: number) => {
    if (!(ms > 0)) return;
    draft.character = regenHp(draft.character, maxHpOf(draft), hpRegenPerMinute(draft), ms);
    regenLeft -= ms;
  };

  const speed = trainingSpeed(draft, attribute);
  let wallLeft = grantedMs;
  if (speed > 0 && wallLeft > 0) draft.training = cloneState(draft.training);
  let guard = 0;
  while (speed > 0 && wallLeft > 0 && draft.activity?.kind === 'training' && guard < MAX_ACTIONS_PER_SIMULATION) {
    const t = draft.training.attributes[attribute];
    if (t.level >= trainingCap(draft.training.tier)) {
      stopAtCap(draft, attribute, summary, events); // only a save already at the cap gets here
      break;
    }
    const needMs = msToNextLevel(t);
    const wallNeed = Math.ceil(needMs / speed);
    if (wallNeed > wallLeft) {
      bank(t, attribute, wallLeft * speed, summary);
      regen(wallLeft);
      wallLeft = 0;
      break;
    }
    regen(wallNeed);
    wallLeft -= wallNeed;
    completeLevel(draft, attribute, summary, events); // at speed 1 the level used exactly wallNeed: nothing left over
    guard += 1;
  }
  regen(regenLeft);
}

/**
 * Adds `xp` training XP to one attribute right away (debug), with every level-up and the cap rule.
 * `draft` must be a full copy the caller owns (applyCommand's draft).
 */
export function grantTrainingXp(draft: GameState, attribute: AttributeKey, xp: number, events: GameEvent[]): void {
  let left = xp * TRAINING.msPerXp;
  let guard = 0;
  while (left > 0 && guard < MAX_ACTIONS_PER_SIMULATION) {
    const t = draft.training.attributes[attribute];
    if (t.level >= trainingCap(draft.training.tier)) {
      stopAtCap(draft, attribute, null, events);
      return;
    }
    const need = msToNextLevel(t);
    if (left < need) {
      bank(t, attribute, left, null);
      return;
    }
    left -= need;
    if (completeLevel(draft, attribute, null, events)) return;
    guard += 1;
  }
}

export type TrainBlock = 'TRAINING_LOCKED' | 'TRAINING_MAXED';

/** Why an attribute can't be trained right now (null = it can). */
export function trainingBlock(state: Pick<GameState, 'training'>, attribute: AttributeKey): TrainBlock | null {
  if (state.training.tier <= 0) return 'TRAINING_LOCKED';
  if (state.training.attributes[attribute].level >= trainingCap(state.training.tier)) return 'TRAINING_MAXED';
  return null;
}

// ---------- read-only views for the UI ----------

export type AttributeTrainingView = {
  attribute: AttributeKey;
  /** Stored attribute (10 for a new hero, plus debug points). */
  base: number;
  /** Training level = points added by training. */
  trained: number;
  effective: number;
  /** Highest level the current tier allows. */
  cap: number;
  /** Whole XP toward the next level, and the XP that level needs. */
  xp: number;
  xpToNext: number;
  /** Progress toward the next level, 0..1, remainder included. 1 when maxed. */
  fraction: number;
  /** Time to the next level while training at the current rate (0 when maxed). */
  remainingMs: number;
  /** At the tier's cap (tier ≥ 1). */
  maxed: boolean;
  /** Being trained right now. */
  active: boolean;
};

export type TrainingView = {
  tier: number;
  maxTier: number;
  cap: number;
  /** The tier the player can buy next, or null at the max tier. */
  nextTier: { tier: number; price: number; cap: number; affordable: boolean; missing: number } | null;
  /** The attribute being trained, if any. */
  active: AttributeKey | null;
  /** In ATTRIBUTE_KEYS order. */
  attributes: AttributeTrainingView[];
};

export function attributeTrainingView(state: GameState, attribute: AttributeKey): AttributeTrainingView {
  const t = state.training.attributes[attribute];
  const cap = trainingCap(state.training.tier);
  const base = state.character.attributes[attribute];
  const maxed = state.training.tier > 0 && t.level >= cap;
  const xpToNext = trainingXpToNext(t.level);
  const needMs = maxed ? 0 : msToNextLevel(t);
  const speed = trainingSpeed(state, attribute);
  return {
    attribute,
    base,
    trained: t.level,
    effective: effectiveAttributes(state)[attribute],
    cap,
    xp: maxed ? 0 : t.xp,
    xpToNext,
    fraction: maxed ? 1 : Math.min(1, (t.xp * TRAINING.msPerXp + t.progressMs) / (xpToNext * TRAINING.msPerXp)),
    remainingMs: maxed ? 0 : speed > 0 ? Math.ceil(needMs / speed) : Number.POSITIVE_INFINITY,
    maxed,
    active: state.activity?.kind === 'training' && state.activity.attribute === attribute,
  };
}

export function trainingView(state: GameState): TrainingView {
  const { tier } = state.training;
  const gold = state.character.gold;
  let nextTier: TrainingView['nextTier'] = null;
  if (tier < TRAINING.maxTier) {
    const price = trainingTierPrice(tier + 1);
    nextTier = { tier: tier + 1, price, cap: trainingCap(tier + 1), affordable: gold >= price, missing: Math.max(0, price - gold) };
  }
  return {
    tier,
    maxTier: TRAINING.maxTier,
    cap: trainingCap(tier),
    nextTier,
    active: state.activity?.kind === 'training' ? state.activity.attribute : null,
    attributes: ATTRIBUTE_KEYS.map((k) => attributeTrainingView(state, k)),
  };
}
