// Live fight rules (pure, deterministic). The engine produces the log; the UI shows it as it lands.
//
//   each side strikes on its own timer from the fight's start: strike n of a side lands at n × its attackIntervalMs
//   on a tie the hero strikes first
//   hero strike (1.19.0): physical roll in [min, max] (seeded) → ONE crit draw (every hero strike, even at 0%) → on a crit the
//     roll × critMultBp → reduced by the target's armor; magic part = magicDamage reduced by the target's magic resist
//     (no roll, no crit); dealt = max(minDamage, physical + magic)
//   enemy strike: physical roll, no crit draw, reduced by the hero's armor (+ its magicDamage against the hero's magic resist, 0 today)
//   reduced(raw, resist) = round(raw × K / (resist + K)), K = COMBAT.armorK
//   the fight ends when either side reaches 0 HP, or at maxFightMs (strikes due at exactly that time still
//   land; both alive after them = a `time_limit` loss, hero HP set to 0)
//   a hero who starts at 0 HP loses at once (no rolls; the caller never opens a fight for it)
//
// The dungeon loop (src/engine/dungeon.ts) walks these events in engine time and regenerates HP between
// them. resolveFight() runs a whole fight at once with no regen, for tests and balance sims.
import { COMBAT } from './config/dungeons';
import { BASIS_POINTS } from './config/stats';
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
 * round(raw × K / (resist + K)) half-up, 0 for raw ≤ 0 (no minimum: the strike's total has one). Integer math only: no
 * Math.pow, no floating division of large values, so Hermes and V8 agree. Armor and magic resist both use it.
 */
export function reducedDamage(raw: number, resist: number, k: number = COMBAT.armorK): number {
  if (!(raw > 0)) return 0;
  const r = Math.max(0, Math.floor(resist));
  const denom = r + k;
  return Math.floor((2 * raw * k + denom) / (2 * denom));
}

/** reducedDamage, but at least minDamage: what one physical-only strike deals. */
export function dealtDamage(roll: number, armor: number, k: number = COMBAT.armorK, minDamage: number = COMBAT.minDamage): number {
  return Math.max(minDamage, reducedDamage(roll, armor, k));
}

/** A crit: roll × multiplierBp ÷ 10 000, half-up (15 000 = 1.5x). Integer math. */
export function critDamage(roll: number, multiplierBp: number): number {
  return Math.floor((roll * multiplierBp + BASIS_POINTS / 2) / BASIS_POINTS);
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
    hero: { ...hero, damage: { ...hero.damage }, attackIntervalMs: safeInterval(hero.attackIntervalMs) },
    enemy: { ...enemy, damage: { ...enemy.damage }, attackIntervalMs: safeInterval(enemy.attackIntervalMs) },
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
 *
 * RNG: a hero strike draws twice, always in this order: the physical roll, then the crit check (drawn even at 0% chance, so
 * the stream never depends on the chance). An enemy strike draws once (its roll); enemies cannot crit.
 */
export function strike(fight: ActiveFight, actor: 'hero' | 'enemy', atMs: number, heroHp: number, rng: RngState): { heroHp: number; rng: RngState } {
  if (actor === 'hero') {
    const h = rollDamage(rng, fight.hero.damage);
    const c = nextInt(h.rng, 0, BASIS_POINTS - 1);
    const crit = c.value < Math.min(BASIS_POINTS, Math.max(0, fight.hero.critChanceBp));
    const physical = reducedDamage(crit ? critDamage(h.value, fight.hero.critMultBp) : h.value, fight.enemy.armor);
    const magic = reducedDamage(fight.hero.magicDamage, fight.enemy.magicResist);
    const dealt = Math.max(COMBAT.minDamage, physical + magic);
    fight.heroStrikes += 1;
    fight.enemyHp = Math.max(0, fight.enemyHp - dealt);
    fight.log.push({ atMs, actor, strike: fight.heroStrikes, roll: h.value, crit, physical, magic, dealt, targetHpAfter: fight.enemyHp });
    return { heroHp, rng: c.rng };
  }
  const e = rollDamage(rng, fight.enemy.damage);
  const physical = reducedDamage(e.value, fight.hero.armor);
  const magic = reducedDamage(fight.enemy.magicDamage, fight.hero.magicResist);
  const dealt = Math.max(COMBAT.minDamage, physical + magic);
  fight.enemyStrikes += 1;
  const hp = Math.max(0, heroHp - dealt);
  fight.log.push({ atMs, actor, strike: fight.enemyStrikes, roll: e.value, crit: false, physical, magic, dealt, targetHpAfter: hp });
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

/** Damage one physical enemy strike can deal to this armor: [dealt(min roll), dealt(max roll)]. Read-only, for UIs. */
export function strikeRange(damage: { min: number; max: number }, armor: number): { min: number; max: number } {
  return { min: dealtDamage(damage.min, armor), max: dealtDamage(damage.max, armor) };
}
