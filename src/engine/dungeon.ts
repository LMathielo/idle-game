// Dungeon runs (pure): search time, skip cost, the live fight, and the auto-repeat loop used by simulate().
// A run = a search for an opponent, then a fight that plays out in engine time. See docs/ENGINE.md
// ("Dungeon & combat").
import { cloneState } from './clone';
import { DUNGEON_RUN, DUNGEONS, ENEMIES } from './config/dungeons';
import { MAX_ACTIONS_PER_SIMULATION } from './config/time';
import { grantHeroXp } from './activities';
import { finishBossFight } from './boss';
import {
  type DungeonFightView,
  enemyCombatSide,
  enemyFightOptions,
  type FightEvent,
  type FightOutcome,
  fightView,
  heroCombatSide,
  newPackFight,
  nextFightEvent,
  outcomeOf,
  packDefeated,
  strike,
} from './combat';
import { emitNewUnlocks, isDifficultyUnlocked, isStageUnlocked, plainMob, rollPack, scaleStat, setStageTotals, snapshotUnlocks, stageTotalsAt } from './difficulty';
import { regenHeroPools } from './hp';
import { addStackable } from './inventory';
import { chance, nextInt } from './rng';
import { activityTimeMs, type CoreInput, dexActivityReductionBp } from './attributes';
import { getDerivedStats } from './stats';
import type {
  ActiveFight,
  BossActivity,
  DungeonActivity,
  Difficulty,
  DungeonId,
  DungeonPhase,
  DungeonTotals,
  EnemyId,
  FightRewards,
  GameEvent,
  GameState,
  SimulationSummary,
} from './types';

export { enemyCombatSide, heroCombatSide, type DungeonFightView };

/** searchMs = max(minMs, ceil(baseMs × (1 − core DEX reduction))), with the dungeon's own timing (1.16.0). */
export function searchMsFor(dungeonId: DungeonId, state: CoreInput): number {
  const t = DUNGEONS[dungeonId].search;
  return activityTimeMs(t.baseMs, t.minMs, dexActivityReductionBp(state));
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

/** Lifetime runs / wins / losses in one dungeon on a difficulty (Normal by default; 0/0/0 before its first run). Read-only. */
export function dungeonTotals(state: Pick<GameState, 'dungeon'>, dungeonId: DungeonId, difficulty: Difficulty = 'normal'): DungeonTotals {
  return stageTotalsAt(state, dungeonId, difficulty);
}

/**
 * True when every condition of the dungeon's unlock rule is met. On Hard / Extreme the stage is open when that difficulty is unlocked AND
 * the stage is open on Normal (there is no separate chain). Permanent: wins never go down.
 */
export function isDungeonUnlocked(state: Pick<GameState, 'dungeon'>, dungeonId: DungeonId, difficulty: Difficulty = 'normal'): boolean {
  return isStageUnlocked(state, dungeonId, difficulty);
}

export type DungeonUnlockView = {
  unlocked: boolean;
  /** null for a dungeon that is open from the start. */
  requirement: { dungeonId: DungeonId; wins: number } | null;
  /** Wins so far toward the requirement, capped at the requirement (0 when there is none). */
  progress: number;
  /** The stage's own rule is met but the difficulty is not unlocked yet (Hard / Extreme only). */
  difficultyLocked: boolean;
};

/** Read-only, for the UI: is it open on the difficulty, what opens it, how far along (the requirement is always the Normal one). */
export function dungeonUnlockView(state: Pick<GameState, 'dungeon'>, dungeonId: DungeonId, difficulty: Difficulty = 'normal'): DungeonUnlockView {
  const rule = DUNGEONS[dungeonId].unlock;
  const difficultyLocked = !isDifficultyUnlocked(state, DUNGEONS[dungeonId].tier, difficulty);
  if (!rule) return { unlocked: !difficultyLocked, requirement: null, progress: 0, difficultyLocked };
  const wins = stageTotalsAt(state, rule.dungeonId, 'normal').wins;
  return { unlocked: !difficultyLocked && wins >= rule.wins, requirement: { dungeonId: rule.dungeonId, wins: rule.wins }, progress: Math.min(wins, rule.wins), difficultyLocked };
}

/**
 * Adds to one dungeon's counters on a difficulty (and the global ones), then emits DUNGEON_UNLOCKED / DIFFICULTY_UNLOCKED for everything
 * that was locked before and is unlocked after. Compared through the unlock predicates, so any future unlock condition is covered
 * without changing this. Mutates `draft.dungeon`, which the caller must own.
 */
export function recordDungeonResults(
  draft: GameState,
  dungeonId: DungeonId,
  difficulty: Difficulty,
  wins: number,
  losses: number,
  summary: SimulationSummary | null,
  events: GameEvent[],
): void {
  const before = snapshotUnlocks(draft);
  const prev = stageTotalsAt(draft, dungeonId, difficulty);
  setStageTotals(draft.dungeon, difficulty, dungeonId, { runs: prev.runs + wins + losses, wins: prev.wins + wins, losses: prev.losses + losses });
  const totals = draft.dungeon.totals;
  draft.dungeon.totals = { runs: totals.runs + wins + losses, wins: totals.wins + wins, losses: totals.losses + losses };
  emitNewUnlocks(before, draft, summary, events);
}

// ---------- the fight ----------

/**
 * Ends the fight of the current run and applies its outcome, then starts the next search at once.
 * Win (the whole pack killed): for each mob in pack order, its hero XP (stage XP × its multiplier), its gold (one roll × its multiplier)
 * and then each of the stage's drop rolls; a drop is lost when the inventory is full. The hero keeps the HP left.
 * Loss (any reason): nothing, kills made before it included, and the hero ends at 0 HP. Mutates `draft` (owned by the caller).
 */
function finishFight(draft: GameState, activity: DungeonActivity, outcome: FightOutcome, summary: SimulationSummary | null, events: GameEvent[]): void {
  const dungeonId = activity.dungeonId;
  const difficulty = activity.difficulty;
  const dungeon = DUNGEONS[dungeonId];
  const won = outcome.endReason === 'enemy_defeated';
  if (!won) draft.character.hp = 0;

  const rewards: FightRewards = { heroXp: 0, gold: 0, items: {}, itemsLost: {} };
  if (won) {
    const r = dungeon.rewards;
    // Per mob, in pack order: gold (one draw), then the drops (one draw each, in config order). XP needs no draw.
    for (const mob of outcome.mobs) {
      rewards.heroXp += scaleStat(r.heroXp, mob.multBp);
      const gold = nextInt(draft.rng, r.gold.min, r.gold.max);
      draft.rng = gold.rng;
      rewards.gold += scaleStat(gold.value, mob.multBp);
      for (const drop of r.drops) {
        const roll = chance(draft.rng, drop.chance);
        draft.rng = roll.rng;
        if (!roll.value) continue;
        const { added, lost } = addStackable(draft.inventory, drop.itemId, 1);
        bump(rewards.items, drop.itemId, added);
        bump(rewards.itemsLost, drop.itemId, lost);
      }
    }
    if (rewards.heroXp > 0) grantHeroXp(draft, rewards.heroXp, summary, events);
    draft.character.gold += rewards.gold;
  }

  draft.dungeon.lastFight = {
    dungeonId,
    difficulty,
    enemyId: outcome.enemyId,
    won,
    endReason: outcome.endReason,
    durationMs: outcome.durationMs,
    heroHpStart: outcome.heroHpStart,
    heroHpEnd: draft.character.hp,
    heroMaxHp: outcome.heroMaxHp,
    enemyMaxHp: outcome.enemyMaxHp,
    enemyHpEnd: outcome.enemyHpEnd,
    mobs: outcome.mobs,
    rewards,
    log: outcome.log,
  };
  events.push({ type: 'FIGHT_RESOLVED', dungeonId, won });
  recordDungeonResults(draft, dungeonId, difficulty, won ? 1 : 0, won ? 0 : 1, summary, events);

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

/**
 * The search is over: the fight starts now, with the hero's current HP and stats (frozen for this fight). On Hard / Extreme the pack is
 * rolled first (pack size, then each mob's variant: ONE main-RNG draw each, in that order; Normal draws nothing). A hero at 0 HP loses
 * at once with no rolls (`no_hp`, no pack either: the record shows the difficulty's plain mob) and the next search starts.
 * Mutates `draft` and `activity` (owned by the caller).
 */
export function beginFight(draft: GameState, activity: DungeonActivity, summary: SimulationSummary | null, events: GameEvent[]): void {
  const enemy = ENEMIES[DUNGEONS[activity.dungeonId].enemyId];
  const stats = getDerivedStats(draft);
  const heroMaxHp = stats.maxHp.value;
  const hp = Math.max(0, Math.min(draft.character.hp, heroMaxHp));
  activity.progressMs = 0;
  if (hp <= 0) {
    const mob = plainMob(enemy, activity.difficulty);
    const outcome: FightOutcome = {
      endReason: 'no_hp',
      durationMs: 0,
      enemyId: enemy.id,
      heroHpStart: 0,
      heroMaxHp,
      enemyMaxHp: mob.enemy.hp,
      enemyHpEnd: mob.enemy.hp,
      mobs: [{ variant: mob.variant, multBp: mob.multBp, maxHp: mob.enemy.hp, hpEnd: mob.enemy.hp }],
      log: [],
    };
    finishFight(draft, activity, outcome, summary, events);
    return;
  }
  const pack = rollPack(draft.rng, enemy, activity.difficulty);
  draft.rng = pack.rng;
  const options = enemyFightOptions(enemy);
  activity.phase = 'fight';
  activity.fight = newPackFight(
    enemy.id,
    heroCombatSide(stats),
    pack.mobs.map((m) => ({ variant: m.variant, multBp: m.multBp, side: enemyCombatSide(m.enemy), hp: m.enemy.hp, regenBp: options.enemyRegenBp })),
    hp,
    heroMaxHp,
    options,
  );
}

/**
 * The player leaves during the fight (STOP_ACTIVITY, or starting another activity): the fight ends now as a loss
 * (`forfeit`) with the normal loss rules (0 HP, no rewards, a loss on the counters, `lastFight` recorded). A boss fight is
 * forfeited the same way (the activity is cleared; nothing is refunded).
 * Returns false (and changes nothing) when the run is still in its search: the caller then cancels it as before.
 * Mutates `draft` (a full copy owned by the caller).
 */
export function forfeitFight(draft: GameState, events: GameEvent[]): boolean {
  const a = draft.activity;
  if (a?.kind === 'boss') {
    // Leaving a boss fight is a loss too; the entry stamina stays spent. finishBossFight clears the activity.
    finishBossFight(draft, a, outcomeOf(a.fight, 'forfeit', a.fight.elapsedMs), null, events);
    return true;
  }
  if (a?.kind !== 'dungeon' || a.phase !== 'fight' || !a.fight) return false;
  finishFight(draft, a, outcomeOf(a.fight, 'forfeit', a.fight.elapsedMs), null, events);
  return true;
}

/**
 * Applies one fight event at its time: a strike, or the time limit. Ends the fight when a side reaches 0 HP or
 * time is up. A hero whose HP dropped to 0 outside the fight's strikes (debug) loses at the next event.
 * A boss fight ends the activity (the hero is idle); a dungeon fight starts the next search.
 */
function stepFight(draft: GameState, activity: DungeonActivity | BossActivity, fight: ActiveFight, ev: FightEvent, summary: SimulationSummary, events: GameEvent[]): void {
  const end = (reason: 'enemy_defeated' | 'hero_defeated' | 'time_limit', atMs: number) => {
    const outcome = outcomeOf(fight, reason, atMs);
    if (activity.kind === 'boss') {
      finishBossFight(draft, activity, outcome, summary, events);
      events.push({ type: 'ACTIVITY_STOPPED', kind: 'boss' });
    } else {
      finishFight(draft, activity, outcome, summary, events);
    }
  };
  if (ev.type === 'time_limit') {
    end('time_limit', ev.atMs);
    return;
  }
  if (draft.character.hp <= 0) {
    end('hero_defeated', ev.atMs);
    return;
  }
  const res = strike(fight, ev.actor, ev.atMs, draft.character.hp, draft.rng, ev.mob);
  draft.rng = res.rng;
  draft.character.hp = res.heroHp;
  if (packDefeated(fight)) end('enemy_defeated', ev.atMs);
  else if (res.heroHp === 0) end('hero_defeated', ev.atMs);
}

/**
 * Auto-repeat inside simulate(). Walks the granted (capped) time event by event, in time order: the end of a
 * search (the fight starts), each strike, the fight's end (outcome applied, the next search starts at once).
 * HP regenerates between events at the rate of the moment, during the search and during the fight. Every event
 * due at or before the end of the granted time happens. Time is split only at events, so many small ticks and
 * one big resume give the same state, also when a call ends in the middle of a fight.
 *
 * **Offline cap mid-fight (1.9.0):** when the cap ends the granted time while a fight is active (phase `fight`),
 * that fight is finished with the time beyond the cap: its strikes keep landing at their exact times until it
 * ends (at most `COMBAT.maxFightMs`, and never past the time that really passed). Nothing else progresses: the
 * next search starts and stays at 0. A search in progress at the cap still pauses there. The fight plays the
 * same events and RNG draws as live play, so its outcome does not depend on where the cap fell.
 *
 * Regen then continues over the rest of the sanitized, uncapped time (`requestedMs`): the forfeited part of a
 * capped absence counts for regen only.
 *
 * `draft` comes from simulate(): `draft.activity` is already a copy; its fight, and character/inventory/dungeon/rng,
 * may still be shared with the input, so they are copied before the first change.
 */
export function advanceDungeon(
  draft: GameState,
  activity: DungeonActivity | BossActivity,
  grantedMs: number,
  requestedMs: number,
  summary: SimulationSummary,
  events: GameEvent[],
): void {
  const searchMs = activity.kind === 'dungeon' ? searchMsFor(activity.dungeonId, draft) : 0;
  const efficiency = draft.offline.efficiency;
  let regenLeft = requestedMs;
  // Rates and maxima are read at each regen, not once: a win can level the hero up (max HP and mana rise, 1.17.0).
  const regen = (ms: number) => {
    if (!(ms > 0)) return;
    regenHeroPools(draft, ms); // HP and mana (1.17.0)
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

  let guard = 0;
  /**
   * Walks up to `wallBudget` ms of wall time event by event. With `fightOnly`, stops as soon as no fight is
   * active (a search never starts or progresses). Returns the wall time left unused.
   */
  const walk = (wallBudget: number, fightOnly: boolean): number => {
    let wallLeft = wallBudget;
    while (efficiency > 0 && guard < MAX_ACTIONS_PER_SIMULATION) {
      // A boss fight ends the activity (the hero is idle): nothing more to walk, the rest of the time is plain regen.
      if (activity.kind === 'boss' && draft.activity !== activity) break;
      const fight = activity.kind === 'boss' ? activity.fight : activity.phase === 'fight' ? activity.fight : null;
      if (fightOnly && !fight) break;
      const ev = fight ? nextFightEvent(fight) : null;
      const need = fight && ev ? Math.max(0, ev.atMs - fight.elapsedMs) : Math.max(0, searchMs - activity.progressMs);
      const wallNeed = Math.ceil(need / efficiency);
      if (wallNeed > wallLeft) {
        if (fight) fight.elapsedMs += wallLeft * efficiency;
        else activity.progressMs += wallLeft * efficiency;
        regen(wallLeft);
        return 0;
      }
      regen(wallNeed);
      wallLeft -= wallNeed;
      own();
      if (fight && ev) {
        fight.elapsedMs = ev.atMs;
        stepFight(draft, activity, fight, ev, summary, events);
      } else if (activity.kind === 'dungeon') {
        beginFight(draft, activity, summary, events);
      } else {
        break; // a boss activity always holds its fight; nothing to begin
      }
      guard += 1;
    }
    return wallLeft;
  };

  walk(grantedMs, false);
  // The cap fell inside a fight: finish it with the time beyond the cap (bounded by the time that really passed).
  const beyondCap = requestedMs - grantedMs;
  if (beyondCap > 0 && (activity.kind === 'boss' ? draft.activity === activity : activity.phase === 'fight')) walk(beyondCap, true);
  regen(regenLeft);
}

/**
 * Wall ms until the dungeon's next event (the search ends, a strike, the fight's end), the same `need` the event walk
 * uses, or Infinity when no dungeon runs or no time counts. Used by the world walk to stop at hero events.
 */
export function dungeonNextEventMs(state: GameState): number {
  const a = state.activity;
  const efficiency = state.offline.efficiency;
  if ((a?.kind !== 'dungeon' && a?.kind !== 'boss') || !(efficiency > 0)) return Number.POSITIVE_INFINITY;
  const fight = a.kind === 'boss' ? a.fight : a.phase === 'fight' ? a.fight : null;
  const need = fight
    ? Math.max(0, nextFightEvent(fight).atMs - fight.elapsedMs)
    : a.kind === 'dungeon'
      ? Math.max(0, searchMsFor(a.dungeonId, state) - a.progressMs)
      : 0;
  return Math.ceil(need / efficiency);
}

// ---------- views ----------

export type DungeonRunView = {
  kind: 'dungeon';
  dungeonId: DungeonId;
  /** The difficulty this run plays on (fixed when it started). */
  difficulty: Difficulty;
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
  const searchMs = searchMsFor(a.dungeonId, state);
  const base = { kind: 'dungeon' as const, dungeonId: a.dungeonId, difficulty: a.difficulty, run: state.dungeon.totals.runs + 1, searchMs };
  const f = a.phase === 'fight' ? a.fight : null;
  if (f) {
    return { ...base, phase: 'fight', fraction: 1, remainingMs: 0, skipCost: null, fight: fightView(state.character.hp, f) };
  }
  const progress = Math.min(a.progressMs, searchMs);
  const remainingMs = Math.max(0, searchMs - progress);
  return { ...base, phase: 'search', fraction: searchMs > 0 ? progress / searchMs : 0, remainingMs, skipCost: skipCost(remainingMs), fight: null };
}
