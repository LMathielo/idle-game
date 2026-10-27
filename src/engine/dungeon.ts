// Dungeon runs (pure): search time, skip cost, the live fight, and the auto-repeat loop used by simulate().
// A run = a search for an opponent, then a fight that plays out in engine time. See docs/ENGINE.md
// ("Dungeon & combat").
import { cloneState } from './clone';
import { COMBAT, DUNGEON_IDS, DUNGEON_RUN, DUNGEONS, ENEMIES, type EnemyDef } from './config/dungeons';
import { MAX_ACTIONS_PER_SIMULATION } from './config/time';
import { grantHeroXp } from './activities';
import { type FightEvent, newFight, nextFightEvent, strike } from './combat';
import { hpRegenPerMinute, maxHpOf, regenHp } from './hp';
import { addStackable } from './inventory';
import { chance, nextInt } from './rng';
import { effectiveAttributes } from './attributes';
import { type DerivedStats, getDerivedStats } from './stats';
import type {
  ActiveFight,
  Attributes,
  CombatSide,
  DungeonActivity,
  DungeonId,
  DungeonPhase,
  DungeonTotals,
  EnemyId,
  FightEndReason,
  FightLogEntry,
  FightRewards,
  GameEvent,
  GameState,
  SimulationSummary,
} from './types';

/** searchMs = max(minMs, baseMs − perDexterityMs × DEX), with the dungeon's own timing. Pass EFFECTIVE attributes. */
export function searchMsFor(dungeonId: DungeonId, attributes: Pick<Attributes, 'dexterity'>): number {
  const t = DUNGEONS[dungeonId].search;
  return Math.max(t.minMs, t.baseMs - t.perDexterityMs * attributes.dexterity);
}

/** Stamina to skip the rest of a search: 1 per started minute left, at least 1. */
export function skipCost(remainingMs: number): number {
  const { stepMs, staminaPerStep } = DUNGEON_RUN.skip;
  const steps = Math.max(1, Math.ceil(Math.max(0, remainingMs) / stepMs));
  return steps * staminaPerStep;
}

function bump(map: Record<string, number>, key: string, by: number) {
  if (by !== 0) map[key] = (map[key] ?? 0) + by;
}

// ---------- per-dungeon counters and unlocks ----------

const ZERO_TOTALS: DungeonTotals = { runs: 0, wins: 0, losses: 0 };

/** Lifetime runs / wins / losses in one dungeon (0/0/0 before its first run). Read-only. */
export function dungeonTotals(state: Pick<GameState, 'dungeon'>, dungeonId: DungeonId): DungeonTotals {
  return state.dungeon.byDungeon[dungeonId] ?? ZERO_TOTALS;
}

/** True when every condition of the dungeon's unlock rule is met. Permanent: wins never go down. */
export function isDungeonUnlocked(state: Pick<GameState, 'dungeon'>, dungeonId: DungeonId): boolean {
  const rule = DUNGEONS[dungeonId].unlock;
  return !rule || dungeonTotals(state, rule.dungeonId).wins >= rule.wins;
}

export type DungeonUnlockView = {
  unlocked: boolean;
  /** null for a dungeon that is open from the start. */
  requirement: { dungeonId: DungeonId; wins: number } | null;
  /** Wins so far toward the requirement, capped at the requirement (0 when there is none). */
  progress: number;
};

/** Read-only, for the UI: is it open, what opens it, how far along. */
export function dungeonUnlockView(state: Pick<GameState, 'dungeon'>, dungeonId: DungeonId): DungeonUnlockView {
  const rule = DUNGEONS[dungeonId].unlock;
  if (!rule) return { unlocked: true, requirement: null, progress: 0 };
  const wins = dungeonTotals(state, rule.dungeonId).wins;
  return { unlocked: wins >= rule.wins, requirement: { dungeonId: rule.dungeonId, wins: rule.wins }, progress: Math.min(wins, rule.wins) };
}

/**
 * Adds to one dungeon's counters (and the global ones), then emits DUNGEON_UNLOCKED for every dungeon that
 * was locked before and is unlocked after. Compared through isDungeonUnlocked(), so any future unlock
 * condition is covered without changing this. Mutates `draft.dungeon`, which the caller must own.
 */
export function recordDungeonResults(
  draft: GameState,
  dungeonId: DungeonId,
  wins: number,
  losses: number,
  summary: SimulationSummary | null,
  events: GameEvent[],
): void {
  const lockedBefore = DUNGEON_IDS.filter((id) => !isDungeonUnlocked(draft, id));
  const before = dungeonTotals(draft, dungeonId);
  const after = { runs: before.runs + wins + losses, wins: before.wins + wins, losses: before.losses + losses };
  draft.dungeon.byDungeon = { ...draft.dungeon.byDungeon, [dungeonId]: after };
  const totals = draft.dungeon.totals;
  draft.dungeon.totals = { runs: totals.runs + wins + losses, wins: totals.wins + wins, losses: totals.losses + losses };
  for (const id of lockedBefore) {
    if (!isDungeonUnlocked(draft, id)) continue;
    events.push({ type: 'DUNGEON_UNLOCKED', dungeonId: id });
    summary?.dungeonsUnlocked.push(id);
  }
}

// ---------- the fight ----------

/** The hero's side of a fight, from the derived stats at its start. */
export function heroCombatSide(stats: DerivedStats): CombatSide {
  return { damage: { min: stats.damage.min, max: stats.damage.max }, defense: stats.defense.value, attackIntervalMs: stats.attackIntervalMs.value };
}

export function enemyCombatSide(enemy: EnemyDef): CombatSide {
  return { damage: { ...enemy.damage }, defense: enemy.defense, attackIntervalMs: enemy.attackIntervalMs };
}

type FightOutcome = {
  endReason: FightEndReason;
  durationMs: number;
  enemyId: EnemyId;
  heroHpStart: number;
  heroMaxHp: number;
  enemyMaxHp: number;
  enemyHpEnd: number;
  log: FightLogEntry[];
};

/**
 * Ends the fight of the current run and applies its outcome, then starts the next search at once.
 * Win: hero XP, gold (rolled), drops (rolled, lost when the inventory is full); the hero keeps the HP left.
 * Loss (any reason): nothing, and the hero ends at 0 HP. Mutates `draft` (owned by the caller).
 */
function finishFight(draft: GameState, activity: DungeonActivity, outcome: FightOutcome, summary: SimulationSummary | null, events: GameEvent[]): void {
  const dungeonId = activity.dungeonId;
  const dungeon = DUNGEONS[dungeonId];
  const won = outcome.endReason === 'enemy_defeated';
  if (!won) draft.character.hp = 0;

  const rewards: FightRewards = { heroXp: 0, gold: 0, items: {}, itemsLost: {} };
  if (won) {
    const r = dungeon.rewards;
    if (r.heroXp > 0) {
      grantHeroXp(draft, r.heroXp, summary, events);
      rewards.heroXp = r.heroXp;
    }
    const gold = nextInt(draft.rng, r.gold.min, r.gold.max);
    draft.rng = gold.rng;
    draft.character.gold += gold.value;
    rewards.gold = gold.value;
    for (const drop of r.drops) {
      const roll = chance(draft.rng, drop.chance);
      draft.rng = roll.rng;
      if (!roll.value) continue;
      const { added, lost } = addStackable(draft.inventory, drop.itemId, 1);
      bump(rewards.items, drop.itemId, added);
      bump(rewards.itemsLost, drop.itemId, lost);
    }
  }

  draft.dungeon.lastFight = {
    dungeonId,
    enemyId: outcome.enemyId,
    won,
    endReason: outcome.endReason,
    durationMs: outcome.durationMs,
    heroHpStart: outcome.heroHpStart,
    heroHpEnd: draft.character.hp,
    heroMaxHp: outcome.heroMaxHp,
    enemyMaxHp: outcome.enemyMaxHp,
    enemyHpEnd: outcome.enemyHpEnd,
    rewards,
    log: outcome.log,
  };
  events.push({ type: 'FIGHT_RESOLVED', dungeonId, won });
  recordDungeonResults(draft, dungeonId, won ? 1 : 0, won ? 0 : 1, summary, events);

  if (summary) {
    summary.dungeon.runs += 1;
    if (won) summary.dungeon.wins += 1;
    else summary.dungeon.losses += 1;
    summary.goldGained += rewards.gold;
    for (const [id, n] of Object.entries(rewards.items)) bump(summary.itemsGained, id, n);
    for (const [id, n] of Object.entries(rewards.itemsLost)) bump(summary.itemsLost, id, n);
  }

  // Auto-repeat: the next run's search starts at once, whatever the HP.
  activity.phase = 'search';
  activity.progressMs = 0;
  activity.fight = null;
}

function outcomeOf(fight: ActiveFight, endReason: FightEndReason, durationMs: number): FightOutcome {
  return {
    endReason,
    durationMs,
    enemyId: fight.enemyId,
    heroHpStart: fight.heroHpStart,
    heroMaxHp: fight.heroMaxHp,
    enemyMaxHp: fight.enemyMaxHp,
    enemyHpEnd: fight.enemyHp,
    log: fight.log,
  };
}

/**
 * The search is over: the fight starts now, with the hero's current HP and stats (frozen for this fight).
 * A hero at 0 HP loses at once with no rolls (`no_hp`) and the next search starts. Mutates `draft` and
 * `activity` (owned by the caller).
 */
export function beginFight(draft: GameState, activity: DungeonActivity, summary: SimulationSummary | null, events: GameEvent[]): void {
  const enemy = ENEMIES[DUNGEONS[activity.dungeonId].enemyId];
  const stats = getDerivedStats(draft);
  const heroMaxHp = stats.maxHp.value;
  const hp = Math.max(0, Math.min(draft.character.hp, heroMaxHp));
  activity.progressMs = 0;
  if (hp <= 0) {
    const outcome: FightOutcome = {
      endReason: 'no_hp',
      durationMs: 0,
      enemyId: enemy.id,
      heroHpStart: 0,
      heroMaxHp,
      enemyMaxHp: enemy.hp,
      enemyHpEnd: enemy.hp,
      log: [],
    };
    finishFight(draft, activity, outcome, summary, events);
    return;
  }
  activity.phase = 'fight';
  activity.fight = newFight(enemy.id, heroCombatSide(stats), enemyCombatSide(enemy), hp, heroMaxHp, enemy.hp);
}

/**
 * Applies one fight event at its time: a strike, or the time limit. Ends the fight when a side reaches 0 HP or
 * time is up. A hero whose HP dropped to 0 outside the fight's strikes (debug) loses at the next event.
 */
function stepFight(draft: GameState, activity: DungeonActivity, fight: ActiveFight, ev: FightEvent, summary: SimulationSummary, events: GameEvent[]): void {
  if (ev.type === 'time_limit') {
    finishFight(draft, activity, outcomeOf(fight, 'time_limit', ev.atMs), summary, events);
    return;
  }
  if (draft.character.hp <= 0) {
    finishFight(draft, activity, outcomeOf(fight, 'hero_defeated', ev.atMs), summary, events);
    return;
  }
  const res = strike(fight, ev.actor, ev.atMs, draft.character.hp, draft.rng);
  draft.rng = res.rng;
  draft.character.hp = res.heroHp;
  if (fight.enemyHp === 0) finishFight(draft, activity, outcomeOf(fight, 'enemy_defeated', ev.atMs), summary, events);
  else if (res.heroHp === 0) finishFight(draft, activity, outcomeOf(fight, 'hero_defeated', ev.atMs), summary, events);
}

/**
 * Auto-repeat inside simulate(). Walks the granted (capped) time event by event, in time order: the end of a
 * search (the fight starts), each strike, the fight's end (outcome applied, the next search starts at once).
 * HP regenerates between events at the rate of the moment, during the search and during the fight. Every event
 * due at or before the end of the granted time happens. Time is split only at events, so many small ticks and
 * one big resume give the same state, also when a call ends in the middle of a fight. Regen then continues over
 * the rest of the sanitized, uncapped time (`requestedMs`): the forfeited part of a capped absence counts for
 * regen only (a fight in progress stays paused at the cap, like a search).
 *
 * `draft` comes from simulate(): `draft.activity` is already a copy; its fight, and character/inventory/dungeon/rng,
 * may still be shared with the input, so they are copied before the first change.
 */
export function advanceDungeon(
  draft: GameState,
  activity: DungeonActivity,
  grantedMs: number,
  requestedMs: number,
  summary: SimulationSummary,
  events: GameEvent[],
): void {
  const rate = hpRegenPerMinute(draft);
  const searchMs = searchMsFor(activity.dungeonId, effectiveAttributes(draft));
  const efficiency = draft.offline.efficiency;
  let regenLeft = requestedMs;
  const regen = (ms: number) => {
    if (!(ms > 0)) return;
    draft.character = regenHp(draft.character, maxHpOf(draft), rate, ms);
    regenLeft -= ms;
  };
  let owned = false;
  const own = () => {
    if (owned) return;
    draft.rng = { ...draft.rng };
    draft.character = { ...draft.character };
    draft.inventory = cloneState(draft.inventory);
    draft.dungeon = cloneState(draft.dungeon);
    owned = true;
  };
  if (activity.fight) activity.fight = cloneState(activity.fight);

  let wallLeft = grantedMs;
  let guard = 0;
  while (efficiency > 0 && guard < MAX_ACTIONS_PER_SIMULATION) {
    const fight = activity.phase === 'fight' ? activity.fight : null;
    const ev = fight ? nextFightEvent(fight, COMBAT.maxFightMs) : null;
    const need = fight && ev ? Math.max(0, ev.atMs - fight.elapsedMs) : Math.max(0, searchMs - activity.progressMs);
    const wallNeed = Math.ceil(need / efficiency);
    if (wallNeed > wallLeft) {
      if (fight) fight.elapsedMs += wallLeft * efficiency;
      else activity.progressMs += wallLeft * efficiency;
      regen(wallLeft);
      wallLeft = 0;
      break;
    }
    regen(wallNeed);
    wallLeft -= wallNeed;
    own();
    if (fight && ev) {
      fight.elapsedMs = ev.atMs;
      stepFight(draft, activity, fight, ev, summary, events);
    } else {
      beginFight(draft, activity, summary, events);
    }
    guard += 1;
  }
  regen(regenLeft);
}

// ---------- views ----------

/** The fight on screen, as it stands at the state's engine time. */
export type DungeonFightView = {
  enemyId: EnemyId;
  elapsedMs: number;
  maxFightMs: number;
  /** The hero's current HP (character.hp), which regenerates during the fight too. */
  heroHp: number;
  heroMaxHp: number;
  enemyHp: number;
  enemyMaxHp: number;
  /** Strikes that have landed so far, in time order. */
  log: readonly FightLogEntry[];
};

export type DungeonRunView = {
  kind: 'dungeon';
  dungeonId: DungeonId;
  /** 1-based number of the run in progress (lifetime runs + 1). A skip names it, so it can't hit a later run. */
  run: number;
  phase: DungeonPhase;
  searchMs: number;
  /** Search phase: progress of the search, 0..1. Fight phase: 1 (the search is done). */
  fraction: number;
  /** Search time left (0 during the fight). */
  remainingMs: number;
  /** Stamina a search skip would cost right now; null during the fight, which can't be skipped. */
  skipCost: number | null;
  fight: DungeonFightView | null;
};

export function dungeonRunView(state: GameState): DungeonRunView | null {
  const a = state.activity;
  if (!a || a.kind !== 'dungeon') return null;
  const searchMs = searchMsFor(a.dungeonId, effectiveAttributes(state));
  const base = { kind: 'dungeon' as const, dungeonId: a.dungeonId, run: state.dungeon.totals.runs + 1, searchMs };
  const f = a.phase === 'fight' ? a.fight : null;
  if (f) {
    const fight: DungeonFightView = {
      enemyId: f.enemyId,
      elapsedMs: f.elapsedMs,
      maxFightMs: COMBAT.maxFightMs,
      heroHp: Math.max(0, Math.min(state.character.hp, f.heroMaxHp)),
      heroMaxHp: f.heroMaxHp,
      enemyHp: f.enemyHp,
      enemyMaxHp: f.enemyMaxHp,
      log: f.log,
    };
    return { ...base, phase: 'fight', fraction: 1, remainingMs: 0, skipCost: null, fight };
  }
  const progress = Math.min(a.progressMs, searchMs);
  const remainingMs = Math.max(0, searchMs - progress);
  return { ...base, phase: 'search', fraction: searchMs > 0 ? progress / searchMs : 0, remainingMs, skipCost: skipCost(remainingMs), fight: null };
}
