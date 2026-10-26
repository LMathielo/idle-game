// Dungeon runs (pure): run time, skip cost, resolving one run, and the auto-repeat loop used by
// simulate(). See docs/ENGINE.md ("Dungeon & combat").
import { cloneState } from './clone';
import { DUNGEON_RUN, DUNGEONS, ENEMIES } from './config/dungeons';
import { MAX_ACTIONS_PER_SIMULATION } from './config/time';
import { grantHeroXp } from './activities';
import { resolveFight } from './combat';
import { hpRegenPerMinute, maxHpOf, regenHp } from './hp';
import { addStackable } from './inventory';
import { chance, nextInt } from './rng';
import { getDerivedStats } from './stats';
import type { Attributes, DungeonActivity, DungeonId, FightRewards, GameEvent, GameState, SimulationSummary } from './types';

/** runMs = max(minMs, baseMs − perDexterityMs × DEX). */
export function runMsFor(attributes: Pick<Attributes, 'dexterity'>): number {
  const raw = DUNGEON_RUN.baseMs - DUNGEON_RUN.perDexterityMs * attributes.dexterity;
  return Math.max(DUNGEON_RUN.minMs, raw);
}

/** Stamina to skip the rest of a run: 1 per started minute left, at least 1. */
export function skipCost(remainingMs: number): number {
  const { stepMs, staminaPerStep } = DUNGEON_RUN.skip;
  const steps = Math.max(1, Math.ceil(Math.max(0, remainingMs) / stepMs));
  return steps * staminaPerStep;
}

function bump(map: Record<string, number>, key: string, by: number) {
  if (by !== 0) map[key] = (map[key] ?? 0) + by;
}

/**
 * Resolves the fight that ends one run, at the hero's current HP, and applies the outcome.
 * Mutates `draft`: its character, inventory, dungeon and rng must already be copies the caller owns.
 * Win: hero XP, gold (rolled), drops (rolled, lost when the inventory is full). Loss: nothing, 0 HP.
 */
export function completeRun(draft: GameState, dungeonId: DungeonId, summary: SimulationSummary | null, events: GameEvent[]): void {
  const dungeon = DUNGEONS[dungeonId];
  const enemy = ENEMIES[dungeon.enemyId];
  const stats = getDerivedStats(draft);
  const heroMaxHp = stats.maxHp.value;
  const heroHpStart = Math.max(0, Math.min(draft.character.hp, heroMaxHp));

  const fight = resolveFight(
    { hp: heroHpStart, damage: { min: stats.damage.min, max: stats.damage.max }, defense: stats.defense.value },
    { hp: enemy.hp, damage: enemy.damage, defense: enemy.defense },
    draft.rng,
  );
  draft.rng = fight.rng;
  draft.character.hp = fight.heroHp;

  const rewards: FightRewards = { heroXp: 0, gold: 0, items: {}, itemsLost: {} };
  if (fight.won) {
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

  const totals = draft.dungeon.totals;
  totals.runs += 1;
  if (fight.won) totals.wins += 1;
  else totals.losses += 1;
  draft.dungeon.lastFight = {
    dungeonId,
    enemyId: enemy.id,
    won: fight.won,
    rounds: fight.rounds,
    heroHpStart,
    heroHpEnd: fight.heroHp,
    heroMaxHp,
    enemyMaxHp: enemy.hp,
    enemyHpEnd: fight.enemyHp,
    rewards,
    log: fight.log,
  };
  events.push({ type: 'FIGHT_RESOLVED', dungeonId, won: fight.won });

  if (summary) {
    summary.dungeon.runs += 1;
    if (fight.won) summary.dungeon.wins += 1;
    else summary.dungeon.losses += 1;
    summary.goldGained += rewards.gold;
    for (const [id, n] of Object.entries(rewards.items)) bump(summary.itemsGained, id, n);
    for (const [id, n] of Object.entries(rewards.itemsLost)) bump(summary.itemsLost, id, n);
  }
}

/**
 * Auto-repeat inside simulate(). Walks the granted (capped) time run by run, in time order:
 * HP regenerates over each run's duration, then the fight resolves with the HP at that moment, and
 * the next run starts at once whatever the HP. Regen then continues over the rest of the sanitized,
 * uncapped time (`requestedMs`): the forfeited part of a capped absence counts for regen only.
 *
 * `draft` comes from simulate(): `draft.activity` is already a copy; character/inventory/dungeon/rng
 * may still be shared with the input, so they are copied once before the first fight.
 */
export function advanceDungeon(
  draft: GameState,
  activity: DungeonActivity,
  grantedMs: number,
  requestedMs: number,
  summary: SimulationSummary,
  events: GameEvent[],
): void {
  const rate = hpRegenPerMinute(draft.character.attributes);
  const runMs = runMsFor(draft.character.attributes);
  const efficiency = draft.offline.efficiency;
  let regenLeft = requestedMs;
  const regen = (ms: number) => {
    if (!(ms > 0)) return;
    draft.character = regenHp(draft.character, maxHpOf(draft), rate, ms);
    regenLeft -= ms;
  };

  let wallLeft = grantedMs;
  let owned = false;
  let guard = 0;
  while (efficiency > 0 && wallLeft > 0 && guard < MAX_ACTIONS_PER_SIMULATION) {
    const need = Math.max(0, runMs - activity.progressMs);
    const wallNeed = Math.ceil(need / efficiency);
    if (wallNeed > wallLeft) {
      activity.progressMs += wallLeft * efficiency;
      regen(wallLeft);
      wallLeft = 0;
      break;
    }
    regen(wallNeed);
    wallLeft -= wallNeed;
    activity.progressMs = 0;
    if (!owned) {
      draft.rng = { ...draft.rng };
      draft.character = { ...draft.character };
      draft.inventory = cloneState(draft.inventory);
      draft.dungeon = cloneState(draft.dungeon);
      owned = true;
    }
    completeRun(draft, activity.dungeonId, summary, events);
    guard += 1;
  }
  regen(regenLeft);
}

export type DungeonRunView = {
  kind: 'dungeon';
  dungeonId: DungeonId;
  runMs: number;
  /** Progress of the current run, 0..1. */
  fraction: number;
  remainingMs: number;
  /** Stamina a skip would cost right now. */
  skipCost: number;
};

export function dungeonRunView(state: GameState): DungeonRunView | null {
  const a = state.activity;
  if (!a || a.kind !== 'dungeon') return null;
  const runMs = runMsFor(state.character.attributes);
  const progress = Math.min(a.progressMs, runMs);
  const remainingMs = Math.max(0, runMs - progress);
  return { kind: 'dungeon', dungeonId: a.dungeonId, runMs, fraction: runMs > 0 ? progress / runMs : 0, remainingMs, skipCost: skipCost(remainingMs) };
}
