// Danger hint for a dungeon (pure, read-only, no RNG): a rough "how much will one fight hurt" estimate
// for the UI. It never simulates a fight and never affects outcomes.
//
//   heroAvg  = mean dealt per hero strike over every roll in [min, max] (after the enemy's defense)
//   enemyAvg = mean dealt per enemy strike (after the hero's defense)
//   heroHits = ceil(enemy HP / heroAvg);  killAt = heroHits × hero attack interval
//   enemyHits = enemy strikes landing before killAt = ceil(killAt / enemy interval) − 1   (ties go to the hero)
//   expectedHpLoss = enemyHits × enemyAvg   (regen during the fight is ignored: a hint, not a sim)
//   percent  = expectedHpLoss / max HP
//   Easy < toughAtPercent ≤ Tough < deadlyAtPercent ≤ Deadly; killAt > COMBAT.maxFightMs is always Deadly.
import { COMBAT, DANGER, DUNGEONS, ENEMIES } from './config/dungeons';
import { dealtDamage } from './combat';
import { getDerivedStats, type StatsInput } from './stats';
import type { DungeonId } from './types';

/** How much one fight costs in HP (not the chance to lose): Tough fights are usually won, at a price. */
export type DangerLevel = 'easy' | 'tough' | 'deadly';

export type DangerHint = {
  level: DangerLevel;
  /** Expected HP lost in one fight, from full HP, with average rolls (rounded). */
  expectedHpLoss: number;
  maxHp: number;
  /** expectedHpLoss as a whole percent of max HP. */
  percent: number;
  /** Hero strikes expected to defeat the enemy. */
  heroHits: number;
  /** Enemy strikes expected to land before that. */
  enemyHits: number;
  /** Expected fight length with average rolls, ms. */
  fightMs: number;
};

/** Ranges wider than this are averaged from their two ends instead of every roll. */
const MAX_ENUMERATED_ROLLS = 1000;

/** Mean damage dealt per strike over every whole roll in [min, max], after `defense`. */
export function averageDealt(range: { min: number; max: number }, defense: number): number {
  const min = Math.floor(range.min);
  const max = Math.max(min, Math.floor(range.max));
  if (max - min + 1 > MAX_ENUMERATED_ROLLS) return (dealtDamage(min, defense) + dealtDamage(max, defense)) / 2;
  let sum = 0;
  for (let roll = min; roll <= max; roll++) sum += dealtDamage(roll, defense);
  return sum / (max - min + 1);
}

export function dangerHint(state: StatsInput, dungeonId: DungeonId): DangerHint {
  const enemy = ENEMIES[DUNGEONS[dungeonId].enemyId];
  const stats = getDerivedStats(state);
  const maxHp = stats.maxHp.value;
  const heroAvg = averageDealt(stats.damage, enemy.defense); // ≥ COMBAT.minDamage, so never 0
  const enemyAvg = averageDealt(enemy.damage, stats.defense.value);
  const heroHits = Math.ceil(enemy.hp / heroAvg);
  const fightMs = heroHits * Math.max(1, stats.attackIntervalMs.value);
  const enemyHits = Math.max(0, Math.ceil(fightMs / Math.max(1, enemy.attackIntervalMs)) - 1);
  const expectedHpLoss = Math.round(enemyHits * enemyAvg);
  const percent = maxHp > 0 ? Math.round((expectedHpLoss * 100) / maxHp) : 100;
  let level: DangerLevel = 'easy';
  if (fightMs > COMBAT.maxFightMs || percent >= DANGER.deadlyAtPercent) level = 'deadly';
  else if (percent >= DANGER.toughAtPercent) level = 'tough';
  return { level, expectedHpLoss, maxHp, percent, heroHits, enemyHits, fightMs };
}
