// Danger hint for a dungeon (pure, read-only, no RNG): a rough "how much will one fight hurt" estimate
// for the UI. It never simulates a fight and never affects outcomes.
//
//   heroAvg  = mean dealt per hero strike over every roll in [min, max]:
//              physical part (after the enemy's armor) with the EXPECTED crit  (1 − chance) × hit + chance × crit hit
//              + the magic part (magic damage after the enemy's magic resist, no roll, no crit); at least COMBAT.minDamage
//   enemyAvg = mean dealt per enemy strike (after the hero's armor)
//   heroHits = ceil(enemy HP / heroAvg);  killAt = heroHits × hero attack interval
//   enemyHits = enemy strikes landing before killAt = ceil(killAt / enemy interval) − 1   (ties go to the hero)
//   expectedHpLoss = enemyHits × enemyAvg   (regen during the fight is ignored: a hint, not a sim)
//   percent  = expectedHpLoss / max HP
//   Easy < toughAtPercent ≤ Tough < deadlyAtPercent ≤ Deadly; killAt > COMBAT.maxFightMs is always Deadly.
//
// Packs (1.24.0, Hard / Extreme): the same estimate for the AVERAGE pack. Every mob has the stats of the average multiplier
// (base × (1 − p) + upgrade × p, in bp), the pack size is each whole size of the uniform range in turn (the mean of the results is the
// expectation), and the hero kills the mobs front to back while every alive mob keeps striking on its own timer:
//   mob j (0-based) dies at (j + 1) × heroHits × hero interval;  it lands ceil(that / its interval) − 1 strikes before (ties go to the hero)
//   loss(k) = enemyAvg × the sum of those over the k mobs;  fightMs(k) = k × heroHits × hero interval
//   expected loss and fight time = the mean over k = min..max;  Deadly also when the expected fight time passes the limit (60 s).
// Normal is the pack of one at x1, which is exactly the formula above.
import { DIFFICULTY } from './config/difficulty';
import { BOSSES, COMBAT, DANGER, DUNGEONS, ENEMIES } from './config/dungeons';
import { scaledEnemy } from './difficulty';
import { COMBAT_SKILLS } from './config/skills';
import { BASIS_POINTS } from './config/stats';
import { critDamage, dealtDamage, reducedDamage } from './combat';
import { getDerivedStats, type StatsInput } from './stats';
import type { BossId, Difficulty, DungeonId } from './types';

/** How much one fight costs in HP (not the chance to lose): Tough fights are usually won, at a price. */
export type DangerLevel = 'easy' | 'tough' | 'deadly';

export type DangerHint = {
  level: DangerLevel;
  /** Expected HP lost in one fight, from full HP, with average rolls (rounded). */
  expectedHpLoss: number;
  maxHp: number;
  /** expectedHpLoss as a whole percent of max HP. */
  percent: number;
  /** Average damage of one hero strike (after the enemy's armor and magic resist, with the expected crit). */
  heroAvg: number;
  /** Of which the average magic part (after the enemy's magic resist). */
  heroMagicAvg: number;
  /** The hero's crit chance (bp) and multiplier (bp), as used. */
  critChanceBp: number;
  critMultBp: number;
  /** Hero strikes expected to defeat one mob (of the average pack on Hard / Extreme). */
  heroHits: number;
  /** Enemy strikes expected to land before the fight ends (the mean over the pack sizes on Hard / Extreme). */
  enemyHits: number;
  /** Expected fight length with average rolls, ms (the mean over the pack sizes). */
  fightMs: number;
  /** The pack size range (1-1 on Normal) and the average mob multiplier in basis points (10 000 on Normal) the estimate used. */
  packMin: number;
  packMax: number;
  avgMultBp: number;
  /** The mob the estimate fights: the Normal enemy scaled by `avgMultBp` (HP, damage, armor, magic resist). */
  mob: { hp: number; damageMin: number; damageMax: number; armor: number };
};

/** Ranges wider than this are averaged from their two ends instead of every roll. */
const MAX_ENUMERATED_ROLLS = 1000;

/** Mean damage dealt per strike over every whole roll in [min, max], after `armor`. */
export function averageDealt(range: { min: number; max: number }, armor: number): number {
  const min = Math.floor(range.min);
  const max = Math.max(min, Math.floor(range.max));
  if (max - min + 1 > MAX_ENUMERATED_ROLLS) return (dealtDamage(min, armor) + dealtDamage(max, armor)) / 2;
  let sum = 0;
  for (let roll = min; roll <= max; roll++) sum += dealtDamage(roll, armor);
  return sum / (max - min + 1);
}

/**
 * Mean PHYSICAL damage of one hero strike after `armor`, with the expected crit: over every roll,
 * (1 − chance) × reduced(roll) + chance × reduced(roll × crit multiplier). Not clamped to a minimum (the strike's total is).
 */
export function averagePhysical(range: { min: number; max: number }, armor: number, critChanceBp: number, critMultBp: number): number {
  const min = Math.floor(range.min);
  const max = Math.max(min, Math.floor(range.max));
  const p = Math.min(BASIS_POINTS, Math.max(0, critChanceBp)) / BASIS_POINTS;
  const at = (roll: number) => (1 - p) * reducedDamage(roll, armor) + p * reducedDamage(critDamage(roll, critMultBp), armor);
  if (max - min + 1 > MAX_ENUMERATED_ROLLS) return (at(min) + at(max)) / 2;
  let sum = 0;
  for (let roll = min; roll <= max; roll++) sum += at(roll);
  return sum / (max - min + 1);
}

/** The average mob multiplier of a pack rule, basis points (10 000 on Normal): base × (1 − p) + upgrade × p, rounded half up. */
export function averageMobBp(difficulty: Difficulty): number {
  const rule = DIFFICULTY[difficulty].pack;
  if (!rule) return BASIS_POINTS;
  const p = rule.upgrade.chanceBp;
  return Math.floor((rule.base.bp * (BASIS_POINTS - p) + rule.upgrade.bp * p + BASIS_POINTS / 2) / BASIS_POINTS);
}

export function dangerHint(state: StatsInput, dungeonId: DungeonId, difficulty: Difficulty = 'normal'): DangerHint {
  const base = ENEMIES[DUNGEONS[dungeonId].enemyId];
  const rule = DIFFICULTY[difficulty].pack;
  const packMin = rule?.size.min ?? 1;
  const packMax = rule?.size.max ?? 1;
  const avgMultBp = averageMobBp(difficulty);
  const enemy = scaledEnemy(base, avgMultBp);
  const stats = getDerivedStats(state);
  const maxHp = stats.maxHp.value;
  const critChanceBp = stats.critChanceBp.value;
  const critMultBp = stats.critMultiplierBp.value;
  const heroMagicAvg = reducedDamage(stats.magicDamage.value, enemy.magicResist);
  const heroAvg = Math.max(COMBAT.minDamage, averagePhysical(stats.damage, enemy.armor, critChanceBp, critMultBp) + heroMagicAvg); // never 0
  const enemyAvg = averageDealt(enemy.damage, stats.armor.value);
  const heroHits = Math.ceil(enemy.hp / heroAvg);
  const heroInterval = Math.max(1, stats.attackIntervalMs.value);
  const enemyInterval = Math.max(1, enemy.attackIntervalMs);
  // Enemy strikes landing while the hero works through k mobs front to back (every alive mob strikes on its own timer).
  const strikesFor = (k: number) => {
    let n = 0;
    for (let j = 0; j < k; j++) n += Math.max(0, Math.ceil(((j + 1) * heroHits * heroInterval) / enemyInterval) - 1);
    return n;
  };
  let hitsSum = 0;
  let fightSum = 0;
  let sizes = 0;
  for (let k = packMin; k <= packMax; k++) {
    hitsSum += strikesFor(k);
    fightSum += k * heroHits * heroInterval;
    sizes += 1;
  }
  const enemyHits = hitsSum / sizes;
  const fightMs = fightSum / sizes;
  const expectedHpLoss = Math.round(enemyHits * enemyAvg);
  const percent = maxHp > 0 ? Math.round((expectedHpLoss * 100) / maxHp) : 100;
  let level: DangerLevel = 'easy';
  if (fightMs > COMBAT.maxFightMs || percent >= DANGER.deadlyAtPercent) level = 'deadly';
  else if (percent >= DANGER.toughAtPercent) level = 'tough';
  return {
    level,
    expectedHpLoss,
    maxHp,
    percent,
    heroAvg,
    heroMagicAvg,
    critChanceBp,
    critMultBp,
    heroHits,
    enemyHits,
    fightMs,
    packMin,
    packMax,
    avgMultBp,
    mob: { hp: enemy.hp, damageMin: enemy.damage.min, damageMax: enemy.damage.max, armor: enemy.armor },
  };
}

// ---------- bosses ----------

/**
 * Danger hint for a boss (pure, read-only, no RNG): an average-rolls RATE estimate, not a sim. It accounts for what makes a boss
 * different from a stage fight:
 *   regen     the boss heals regenBp of its max HP per second, so the hero's net damage rate is heroAvg ÷ interval − regen; if that is not
 *             positive the boss can never be killed
 *   Heavy Bash  one enemy strike in `cooldownStrikes` is the skill (roll × multiplier, then armor); each cast stuns with its chance for
 *             `strikes` hero strikes, which removes that many hero strikes (rate: chance × strikes per cooldown window)
 *   limit     the boss's time limit (BossDef enemy maxFightMs): killing it takes longer than that = Deadly
 *   fightMs   boss HP ÷ net rate; expectedHpLoss = enemy damage per second × fightMs; percent of max HP; same Tough/Deadly thresholds as stages.
 * The hero's own regen and potions are ignored (a hint).
 */
export type BossDangerHint = {
  level: DangerLevel;
  expectedHpLoss: number;
  maxHp: number;
  percent: number;
  /** Average damage of one hero strike (after the boss's armor and magic resist, expected crit). */
  heroAvg: number;
  /** Hero damage per second after the stun loss, before the boss's regen. */
  heroDps: number;
  /** The boss's regen, HP per second (whole HP, rounded down). */
  regenPerSec: number;
  /** Net damage per second on the boss (heroDps − regen); 0 or less means it can not be killed. */
  netDps: number;
  /** The boss can be killed at all (netDps > 0). */
  canKill: boolean;
  /** Expected time to kill with average rolls, ms (Infinity when it can not be killed). */
  fightMs: number;
  /** The time limit, ms; `overLimit` is true when fightMs exceeds it. */
  limitMs: number;
  overLimit: boolean;
  /** Average damage of a normal boss strike and of a Heavy Bash, after the hero's armor. */
  enemyAvg: number;
  bashAvg: number;
  /** Chance (percent) that a cast stuns, and for how many hero strikes. */
  stunChancePercent: number;
  stunStrikes: number;
  /** Boss damage per second on the hero, Bash included. */
  enemyDps: number;
};

export function bossDangerHint(state: StatsInput, bossId: BossId, difficulty: Difficulty = 'normal'): BossDangerHint {
  const enemy = scaledEnemy(ENEMIES[BOSSES[bossId].enemyId], DIFFICULTY[difficulty].boss.statBp);
  const skill = COMBAT_SKILLS.heavy_bash;
  const stun = skill.effects.find((e) => e.type === 'stun');
  const stats = getDerivedStats(state);
  const maxHp = stats.maxHp.value;
  const heroInterval = Math.max(1, stats.attackIntervalMs.value);
  const enemyInterval = Math.max(1, enemy.attackIntervalMs);
  const limitMs = enemy.maxFightMs ?? COMBAT.maxFightMs;

  const heroMagicAvg = reducedDamage(stats.magicDamage.value, enemy.magicResist);
  const heroAvg = Math.max(COMBAT.minDamage, averagePhysical(stats.damage, enemy.armor, stats.critChanceBp.value, stats.critMultiplierBp.value) + heroMagicAvg);

  // Hero strikes lost to stuns per second: chance × strikes per cooldown window (cooldownStrikes enemy strikes long).
  const windowSec = (skill.cooldownStrikes * enemyInterval) / 1000;
  const stunChance = stun ? stun.chanceBp / BASIS_POINTS : 0;
  const lostPerSec = stun ? (stunChance * stun.strikes) / windowSec : 0;
  const strikesPerSec = Math.max(0, 1000 / heroInterval - lostPerSec);
  const heroDps = heroAvg * strikesPerSec;
  const regenPerSec = Math.floor((enemy.hp * (enemy.regenBpPerSec ?? 0)) / BASIS_POINTS);
  const regenExact = (enemy.hp * (enemy.regenBpPerSec ?? 0)) / BASIS_POINTS;
  const netDps = heroDps - regenExact;
  const canKill = netDps > 0;
  const fightMs = canKill ? Math.ceil((enemy.hp / netDps) * 1000) : Infinity;

  const enemyAvg = averageDealt(enemy.damage, stats.armor.value);
  const bashRange = { min: Math.floor(enemy.damage.min), max: Math.floor(enemy.damage.max) };
  let bashSum = 0;
  for (let roll = bashRange.min; roll <= bashRange.max; roll++) bashSum += dealtDamage(critDamage(roll, skill.damageMultBp), stats.armor.value);
  const bashAvg = bashSum / (bashRange.max - bashRange.min + 1);
  const perWindow = (enemyAvg * (skill.cooldownStrikes - 1) + bashAvg) / skill.cooldownStrikes;
  const enemyDps = (perWindow * 1000) / enemyInterval;

  const lossMs = Number.isFinite(fightMs) ? fightMs : limitMs;
  const expectedHpLoss = Math.round((enemyDps * Math.min(lossMs, limitMs)) / 1000);
  const percent = maxHp > 0 ? Math.round((expectedHpLoss * 100) / maxHp) : 100;
  const overLimit = !canKill || fightMs > limitMs;
  let level: DangerLevel = 'easy';
  if (overLimit || percent >= DANGER.deadlyAtPercent) level = 'deadly';
  else if (percent >= DANGER.toughAtPercent) level = 'tough';
  return {
    level,
    expectedHpLoss,
    maxHp,
    percent,
    heroAvg,
    heroDps,
    regenPerSec,
    netDps,
    canKill,
    fightMs,
    limitMs,
    overLimit,
    enemyAvg,
    bashAvg,
    stunChancePercent: Math.round(stunChance * 100),
    stunStrikes: stun?.strikes ?? 0,
    enemyDps,
  };
}
