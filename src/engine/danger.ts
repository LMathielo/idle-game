// Danger hint for a dungeon (pure, read-only, no RNG): a rough "how much will one fight hurt" estimate
// for the UI. It never simulates a fight and never affects outcomes.
//
//   heroAvg  = mean dealt per hero strike over every roll in [min, max] (after the enemy's defense)
//   enemyAvg = mean dealt per enemy strike (after the hero's defense)
//   heroHits = ceil(enemy HP / heroAvg)                 the hero strikes first, so the enemy gets
//   expectedHpLoss = (heroHits − 1) × enemyAvg          one strike fewer than the hero
//   percent  = expectedHpLoss / max HP
//   Easy < riskyAtPercent ≤ Risky < deadlyAtPercent ≤ Deadly; heroHits > maxRounds is always Deadly.
import { COMBAT, DANGER, DUNGEONS, ENEMIES } from './config/dungeons';
import { dealtDamage } from './combat';
import { getDerivedStats, type StatsInput } from './stats';
import type { DungeonId } from './types';

export type DangerLevel = 'easy' | 'risky' | 'deadly';

export type DangerHint = {
  level: DangerLevel;
  /** Expected HP lost in one fight, from full HP, with average rolls (rounded). */
  expectedHpLoss: number;
  maxHp: number;
  /** expectedHpLoss as a whole percent of max HP. */
  percent: number;
  /** Hero strikes expected to defeat the enemy. */
  heroHits: number;
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
  const expectedHpLoss = Math.round((heroHits - 1) * enemyAvg);
  const percent = maxHp > 0 ? Math.round((expectedHpLoss * 100) / maxHp) : 100;
  let level: DangerLevel = 'easy';
  if (heroHits > COMBAT.maxRounds || percent >= DANGER.deadlyAtPercent) level = 'deadly';
  else if (percent >= DANGER.riskyAtPercent) level = 'risky';
  return { level, expectedHpLoss, maxHp, percent, heroHits };
}
