// Live fight rules (pure, deterministic). The engine produces the log; the UI shows it as it lands.
//
//   each side strikes on its own timer from the fight's start: strike n of a side lands at n × its attackIntervalMs
//   on a tie the hero strikes first; each strike rolls a whole number in [min, max] (seeded RNG)
//   dealt = max(minDamage, round(roll × K / (defense + K)))       K = COMBAT.defenseK
//   the fight ends when either side reaches 0 HP, or at maxFightMs (strikes due at exactly that time still
//   land; both alive after them = a `time_limit` loss, hero HP set to 0)
//   a hero who starts at 0 HP loses at once (no rolls; the caller never opens a fight for it)
//
// The dungeon loop (src/engine/dungeon.ts) walks these events in engine time and regenerates HP between
// them. resolveFight() runs a whole fight at once with no regen, for tests and balance sims.
import { COMBAT } from './config/dungeons';
import { nextInt } from './rng';
import type { ActiveFight, CombatSide, EnemyId, FightEndReason, FightLogEntry, RngState } from './types';

export type Combatant = CombatSide & { hp: number };

export type FightResult = {
  won: boolean;
  endReason: FightEndReason;
  durationMs: number;
  heroHp: number;
  enemyHp: number;
  log: FightLogEntry[];
  rng: RngState;
};

/**
 * round(roll × K / (defense + K)) half-up, at least minDamage. Integer math only: no Math.pow, no
 * floating division of large values, so Hermes and V8 agree.
 */
export function dealtDamage(roll: number, defense: number, k: number = COMBAT.defenseK, minDamage: number = COMBAT.minDamage): number {
  const def = Math.max(0, Math.floor(defense));
  const denom = def + k;
  const rounded = Math.floor((2 * roll * k + denom) / (2 * denom));
  return Math.max(minDamage, rounded);
}

function rollDamage(rng: RngState, range: { min: number; max: number }) {
  const min = Math.floor(range.min);
  const max = Math.max(min, Math.floor(range.max));
  return nextInt(rng, min, max);
}

/** A whole number of ms ≥ 1, so strike times always move forward. */
export function safeInterval(ms: number): number {
  return Number.isFinite(ms) ? Math.max(1, Math.floor(ms)) : COMBAT.maxFightMs;
}

/** A fresh fight at time 0. `heroHp` must be > 0 (a 0 HP hero loses with no fight). */
export function newFight(enemyId: EnemyId, hero: CombatSide, enemy: CombatSide, heroHp: number, heroMaxHp: number, enemyHp: number): ActiveFight {
  return {
    enemyId,
    elapsedMs: 0,
    heroHpStart: heroHp,
    heroMaxHp,
    enemyHp: Math.max(0, enemyHp),
    enemyMaxHp: Math.max(0, enemyHp),
    hero: { damage: { ...hero.damage }, defense: hero.defense, attackIntervalMs: safeInterval(hero.attackIntervalMs) },
    enemy: { damage: { ...enemy.damage }, defense: enemy.defense, attackIntervalMs: safeInterval(enemy.attackIntervalMs) },
    heroStrikes: 0,
    enemyStrikes: 0,
    log: [],
  };
}

export type FightEvent = { type: 'strike'; actor: 'hero' | 'enemy'; atMs: number } | { type: 'time_limit'; atMs: number };

/** The next thing that happens in this fight, by fight time. Ties go to the hero. */
export function nextFightEvent(fight: ActiveFight, maxFightMs: number = COMBAT.maxFightMs): FightEvent {
  const heroAt = (fight.heroStrikes + 1) * fight.hero.attackIntervalMs;
  const enemyAt = (fight.enemyStrikes + 1) * fight.enemy.attackIntervalMs;
  const actor = heroAt <= enemyAt ? 'hero' : 'enemy';
  const atMs = Math.min(heroAt, enemyAt);
  return atMs <= maxFightMs ? { type: 'strike', actor, atMs } : { type: 'time_limit', atMs: maxFightMs };
}

/**
 * One strike at `atMs` (fight time). Mutates `fight` (the caller owns it): the strike counter, the log and,
 * for a hero strike, the enemy's HP. Returns the hero's HP after it and the advanced RNG.
 */
export function strike(fight: ActiveFight, actor: 'hero' | 'enemy', atMs: number, heroHp: number, rng: RngState): { heroHp: number; rng: RngState } {
  if (actor === 'hero') {
    const h = rollDamage(rng, fight.hero.damage);
    const dealt = dealtDamage(h.value, fight.enemy.defense);
    fight.heroStrikes += 1;
    fight.enemyHp = Math.max(0, fight.enemyHp - dealt);
    fight.log.push({ atMs, actor, strike: fight.heroStrikes, roll: h.value, dealt, targetHpAfter: fight.enemyHp });
    return { heroHp, rng: h.rng };
  }
  const e = rollDamage(rng, fight.enemy.damage);
  const dealt = dealtDamage(e.value, fight.hero.defense);
  fight.enemyStrikes += 1;
  const hp = Math.max(0, heroHp - dealt);
  fight.log.push({ atMs, actor, strike: fight.enemyStrikes, roll: e.value, dealt, targetHpAfter: hp });
  return { heroHp: hp, rng: e.rng };
}

/**
 * A whole fight at once, with no HP regen between strikes (tests, balance sims). The dungeon loop plays the same
 * events in engine time instead, with regen.
 */
export function resolveFight(hero: Combatant, enemy: Combatant, rng: RngState, maxFightMs: number = COMBAT.maxFightMs): FightResult {
  let heroHp = Math.max(0, hero.hp);
  const enemyStartHp = Math.max(0, enemy.hp);
  if (heroHp <= 0) return { won: false, endReason: 'no_hp', durationMs: 0, heroHp: 0, enemyHp: enemyStartHp, log: [], rng };
  const fight = newFight('rat', hero, enemy, heroHp, heroHp, enemyStartHp);
  let r = rng;
  for (;;) {
    const ev = nextFightEvent(fight, maxFightMs);
    if (ev.type === 'time_limit') {
      // Time limit: a loss, and every loss leaves the hero at 0 HP.
      return { won: false, endReason: 'time_limit', durationMs: ev.atMs, heroHp: 0, enemyHp: fight.enemyHp, log: fight.log, rng: r };
    }
    const res = strike(fight, ev.actor, ev.atMs, heroHp, r);
    heroHp = res.heroHp;
    r = res.rng;
    if (fight.enemyHp === 0) return { won: true, endReason: 'enemy_defeated', durationMs: ev.atMs, heroHp, enemyHp: 0, log: fight.log, rng: r };
    if (heroHp === 0) return { won: false, endReason: 'hero_defeated', durationMs: ev.atMs, heroHp: 0, enemyHp: fight.enemyHp, log: fight.log, rng: r };
  }
}

/** Damage one enemy strike can deal to this defense: [dealt(min roll), dealt(max roll)]. Read-only, for UIs. */
export function strikeRange(damage: { min: number; max: number }, defense: number): { min: number; max: number } {
  return { min: dealtDamage(damage.min, defense), max: dealtDamage(damage.max, defense) };
}
