// Turn-based fight resolution (pure, deterministic). The engine produces the log; the UI replays it.
//
//   turns alternate, the hero strikes first; each strike rolls a whole number in [min, max]
//   dealt = max(minDamage, round(roll × K / (defense + K)))       K = COMBAT.defenseK
//   the fight ends when either side reaches 0 HP, or after maxRounds (a loss: hero HP is set to 0)
//   a hero who starts at 0 HP loses at once (no rolls)
import { COMBAT } from './config/dungeons';
import { nextInt } from './rng';
import type { FightLogEntry, RngState } from './types';

export type Combatant = {
  hp: number;
  damage: { min: number; max: number };
  defense: number;
};

export type FightResult = {
  won: boolean;
  rounds: number;
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

export function resolveFight(hero: Combatant, enemy: Combatant, rng: RngState, maxRounds: number = COMBAT.maxRounds): FightResult {
  let heroHp = Math.max(0, hero.hp);
  let enemyHp = Math.max(0, enemy.hp);
  let r = rng;
  const log: FightLogEntry[] = [];
  if (heroHp <= 0) return { won: false, rounds: 0, heroHp: 0, enemyHp, log, rng: r };

  let round = 0;
  while (round < maxRounds) {
    round += 1;
    const h = rollDamage(r, hero.damage);
    r = h.rng;
    const toEnemy = dealtDamage(h.value, enemy.defense);
    enemyHp = Math.max(0, enemyHp - toEnemy);
    log.push({ round, actor: 'hero', roll: h.value, dealt: toEnemy, targetHpAfter: enemyHp });
    if (enemyHp === 0) return { won: true, rounds: round, heroHp, enemyHp, log, rng: r };

    const e = rollDamage(r, enemy.damage);
    r = e.rng;
    const toHero = dealtDamage(e.value, hero.defense);
    heroHp = Math.max(0, heroHp - toHero);
    log.push({ round, actor: 'enemy', roll: e.value, dealt: toHero, targetHpAfter: heroHp });
    if (heroHp === 0) return { won: false, rounds: round, heroHp, enemyHp, log, rng: r };
  }
  // Round cap: counted as a loss, and every loss leaves the hero at 0 HP (brief 2026-10-26).
  return { won: false, rounds: round, heroHp: 0, enemyHp, log, rng: r };
}
