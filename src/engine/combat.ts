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
// Bosses and combat skills (1.20.0, docs/ENGINE.md "Bosses and combat skills"):
//   enemy regen: before every strike (and when a fight ends) the enemy regains enemyRegenBp of its max HP per second for the fight
//     time since it was last applied, exact integer banking (regenEnemyTo), never above max, nothing once it is at 0. No RNG.
//   enemy skill: an enemy strike on which a skill is ready is that skill's cast INSTEAD of a normal strike (the strike counts as
//     one of its strikes). Heavy Bash = roll × 1.4, armor / magic resist as usual, then a stun check; a stun makes the hero lose
//     his next N strikes (his timer keeps running; each lost strike is logged as `stunned`, deals 0 and draws no RNG).
//   RNG draws per strike, always in this order, never depending on HP or the chance:
//     hero strike (not stunned): physical roll, crit check              (2 draws; a stunned hero strike: none)
//     enemy normal strike:       physical roll                          (1 draw)
//     enemy skill cast:          physical roll, then one stun check per stun effect, in listed order   (Heavy Bash: 2 draws)
//   A fight against an enemy with no skills and no regen draws exactly as before 1.20.0.
//
// The dungeon loop (src/engine/dungeon.ts) walks these events in engine time and regenerates HP between
// them. resolveFight() runs a whole fight at once with no regen, for tests and balance sims.
import { COMBAT, type EnemyDef } from './config/dungeons';
import { COMBAT_SKILLS, type CombatSkillDef } from './config/skills';
import { BASIS_POINTS } from './config/stats';
import { nextInt } from './rng';
import type { DerivedStats } from './stats';
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

/** What a fight needs besides the two sides: set for a boss (1.20.0), all defaults for a dungeon enemy. */
export type FightOptions = {
  /** Time limit, ms (default COMBAT.maxFightMs). */
  maxFightMs?: number;
  /** Enemy HP regeneration, basis points of its max HP per second (default 0). */
  enemyRegenBp?: number;
};

/** One enemy HP in enemy-regen units: bp (10 000) × ms per second (1 000). */
export const ENEMY_REGEN_UNIT = BASIS_POINTS * 1000;

function copySide(side: CombatSide): CombatSide {
  return { ...side, damage: { ...side.damage }, skills: [...(side.skills ?? [])], attackIntervalMs: safeInterval(side.attackIntervalMs) };
}

/** A fresh fight at time 0. `heroHp` must be > 0 (a 0 HP hero loses with no fight). */
export function newFight(
  enemyId: EnemyId,
  hero: CombatSide,
  enemy: CombatSide,
  heroHp: number,
  heroMaxHp: number,
  enemyHp: number,
  options: FightOptions = {},
): ActiveFight {
  const enemySide = copySide(enemy);
  const enemySkillReady: ActiveFight['enemySkillReady'] = {};
  for (const id of enemySide.skills) {
    const def = COMBAT_SKILLS[id];
    if (def) enemySkillReady[id] = def.firstReadyStrike;
  }
  return {
    enemyId,
    elapsedMs: 0,
    heroHpStart: heroHp,
    heroMaxHp,
    enemyHp: Math.max(0, enemyHp),
    enemyMaxHp: Math.max(0, enemyHp),
    hero: copySide(hero),
    enemy: enemySide,
    heroStrikes: 0,
    enemyStrikes: 0,
    maxFightMs: Number.isFinite(options.maxFightMs) ? Math.max(1, Math.floor(options.maxFightMs!)) : COMBAT.maxFightMs,
    enemyRegenBp: Math.max(0, Math.floor(options.enemyRegenBp ?? 0)),
    enemyRegenProgress: 0,
    enemyRegenAtMs: 0,
    enemySkillReady,
    heroStunStrikes: 0,
    log: [],
  };
}

export type FightEvent = { type: 'strike'; actor: 'hero' | 'enemy'; atMs: number } | { type: 'time_limit'; atMs: number };

/** The next thing that happens in this fight, by fight time. Ties go to the hero. The limit is the fight's own (frozen at its start). */
export function nextFightEvent(fight: ActiveFight, maxFightMs: number = fight.maxFightMs): FightEvent {
  const heroAt = (fight.heroStrikes + 1) * fight.hero.attackIntervalMs;
  const enemyAt = (fight.enemyStrikes + 1) * fight.enemy.attackIntervalMs;
  const actor = heroAt <= enemyAt ? 'hero' : 'enemy';
  const atMs = Math.min(heroAt, enemyAt);
  return atMs <= maxFightMs ? { type: 'strike', actor, atMs } : { type: 'time_limit', atMs: maxFightMs };
}

/**
 * Enemy regen over `dtMs` of fight time (pure): the new HP and banked remainder. HP gained = floor((progress + dt × max × bp) ÷
 * ENEMY_REGEN_UNIT); never above max (the remainder is then 0, time at full is not banked); nothing at 0 HP or without regen.
 * Exact for any split of the time: regen(a) then regen(b) = regen(a + b).
 */
export function enemyRegen(hp: number, progress: number, maxHp: number, regenBp: number, dtMs: number): [hp: number, progress: number] {
  if (hp >= maxHp) return [Math.min(hp, maxHp), 0];
  if (hp <= 0 || !(regenBp > 0) || !(dtMs > 0)) return [hp, progress];
  const banked = progress + dtMs * maxHp * regenBp;
  const gained = Math.floor(banked / ENEMY_REGEN_UNIT);
  if (hp + gained >= maxHp) return [maxHp, 0];
  return [hp + gained, banked - gained * ENEMY_REGEN_UNIT];
}

/** Applies the enemy's regen up to fight time `atMs` (mutates `fight`, which the caller owns). Idempotent for the same time. */
export function regenEnemyTo(fight: ActiveFight, atMs: number): void {
  const dt = atMs - fight.enemyRegenAtMs;
  if (!(dt > 0)) return;
  fight.enemyRegenAtMs = atMs;
  if (!(fight.enemyRegenBp > 0)) return;
  const [hp, progress] = enemyRegen(fight.enemyHp, fight.enemyRegenProgress, fight.enemyMaxHp, fight.enemyRegenBp, dt);
  fight.enemyHp = hp;
  fight.enemyRegenProgress = progress;
}

/** The enemy's HP at fight time `atMs` without changing the fight (read-only, for the live bar). */
export function enemyHpAt(fight: Pick<ActiveFight, 'enemyHp' | 'enemyMaxHp' | 'enemyRegenBp' | 'enemyRegenProgress' | 'enemyRegenAtMs'>, atMs: number): number {
  const dt = atMs - fight.enemyRegenAtMs;
  if (!(fight.enemyRegenBp > 0) || !(dt > 0)) return fight.enemyHp;
  return enemyRegen(fight.enemyHp, fight.enemyRegenProgress, fight.enemyMaxHp, fight.enemyRegenBp, dt)[0];
}

/** The first skill of the enemy that is ready for its next strike, or null. */
function readyEnemySkill(fight: ActiveFight): CombatSkillDef | null {
  const next = fight.enemyStrikes + 1;
  for (const id of fight.enemy.skills) {
    const ready = fight.enemySkillReady[id];
    const def = COMBAT_SKILLS[id];
    if (def && ready !== undefined && next >= ready) return def;
  }
  return null;
}

/**
 * One strike at `atMs` (fight time). Mutates `fight` (the caller owns it): the strike counter, the log, the enemy's regen and,
 * for a hero strike, the enemy's HP, a cast's cooldown and a stun. Returns the hero's HP after it and the advanced RNG.
 *
 * RNG (see the header): a hero strike draws twice, always in this order: the physical roll, then the crit check (drawn even at 0%
 * chance, so the stream never depends on the chance); a stunned hero strike draws nothing. An enemy strike draws once (its roll;
 * enemies cannot crit); a skill cast draws its roll, then one stun check per stun effect in listed order, always.
 */
export function strike(fight: ActiveFight, actor: 'hero' | 'enemy', atMs: number, heroHp: number, rng: RngState): { heroHp: number; rng: RngState } {
  // The enemy regenerates up to this instant first (before it is hit or acts). Without regen this changes nothing.
  regenEnemyTo(fight, atMs);
  const regens = fight.enemyRegenBp > 0;
  if (actor === 'hero') {
    if (fight.heroStunStrikes > 0) {
      // Stunned: the strike is lost (the timer keeps running), no roll, no crit check.
      fight.heroStunStrikes -= 1;
      fight.heroStrikes += 1;
      const lost: FightLogEntry = {
        atMs,
        actor,
        strike: fight.heroStrikes,
        roll: 0,
        crit: false,
        physical: 0,
        magic: 0,
        dealt: 0,
        targetHpAfter: fight.enemyHp,
        stunned: true,
      };
      if (regens) lost.enemyHpAfter = fight.enemyHp;
      fight.log.push(lost);
      return { heroHp, rng };
    }
    const h = rollDamage(rng, fight.hero.damage);
    const c = nextInt(h.rng, 0, BASIS_POINTS - 1);
    const crit = c.value < Math.min(BASIS_POINTS, Math.max(0, fight.hero.critChanceBp));
    const physical = reducedDamage(crit ? critDamage(h.value, fight.hero.critMultBp) : h.value, fight.enemy.armor);
    const magic = reducedDamage(fight.hero.magicDamage, fight.enemy.magicResist);
    const dealt = Math.max(COMBAT.minDamage, physical + magic);
    fight.heroStrikes += 1;
    fight.enemyHp = Math.max(0, fight.enemyHp - dealt);
    const entry: FightLogEntry = { atMs, actor, strike: fight.heroStrikes, roll: h.value, crit, physical, magic, dealt, targetHpAfter: fight.enemyHp };
    if (regens) entry.enemyHpAfter = fight.enemyHp;
    fight.log.push(entry);
    return { heroHp, rng: c.rng };
  }
  const skill = readyEnemySkill(fight);
  const e = rollDamage(rng, fight.enemy.damage);
  let r = e.rng;
  const raw = skill ? critDamage(e.value, skill.damageMultBp) : e.value;
  const physical = reducedDamage(raw, fight.hero.armor);
  const magic = reducedDamage(fight.enemy.magicDamage, fight.hero.magicResist);
  const dealt = Math.max(COMBAT.minDamage, physical + magic);
  fight.enemyStrikes += 1;
  const hp = Math.max(0, heroHp - dealt);
  const entry: FightLogEntry = { atMs, actor, strike: fight.enemyStrikes, roll: e.value, crit: false, physical, magic, dealt, targetHpAfter: hp };
  if (skill) {
    entry.skill = skill.id;
    fight.enemySkillReady[skill.id] = fight.enemyStrikes + skill.cooldownStrikes;
    for (const effect of skill.effects) {
      if (effect.type === 'stun') {
        const check = nextInt(r, 0, BASIS_POINTS - 1);
        r = check.rng;
        const landed = check.value < Math.min(BASIS_POINTS, Math.max(0, effect.chanceBp));
        // Stuns never stack: a new one only raises the strikes still to lose.
        if (landed) fight.heroStunStrikes = Math.max(fight.heroStunStrikes, effect.strikes);
        entry.stun = (entry.stun ?? 0) + (landed ? effect.strikes : 0);
      }
    }
  }
  if (regens) entry.enemyHpAfter = fight.enemyHp;
  fight.log.push(entry);
  return { heroHp: hp, rng: r };
}

/**
 * A whole fight at once, with no HP regen between strikes (tests, balance sims). The dungeon loop plays the same
 * events in engine time instead, with regen.
 */
export function resolveFight(
  hero: Combatant,
  enemy: Combatant,
  rng: RngState,
  maxFightMs: number = COMBAT.maxFightMs,
  options: Omit<FightOptions, 'maxFightMs'> = {},
): FightResult {
  let heroHp = Math.max(0, hero.hp);
  const enemyStartHp = Math.max(0, enemy.hp);
  if (heroHp <= 0) return { won: false, endReason: 'no_hp', durationMs: 0, heroHp: 0, enemyHp: enemyStartHp, log: [], rng };
  const fight = newFight('rat', hero, enemy, heroHp, heroHp, enemyStartHp, { ...options, maxFightMs });
  let r = rng;
  for (;;) {
    const ev = nextFightEvent(fight, maxFightMs);
    if (ev.type === 'time_limit') {
      // Time limit: a loss, and every loss leaves the hero at 0 HP.
      regenEnemyTo(fight, ev.atMs);
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

// ---------- the sides of a fight ----------

/** The hero's side of a fight, from the derived stats at its start. */
export function heroCombatSide(stats: DerivedStats): CombatSide {
  return {
    damage: { min: stats.damage.min, max: stats.damage.max },
    armor: stats.armor.value,
    magicDamage: stats.magicDamage.value,
    magicResist: stats.magicResist.value,
    critChanceBp: stats.critChanceBp.value,
    critMultBp: stats.critMultiplierBp.value,
    attackIntervalMs: stats.attackIntervalMs.value,
    skills: [],
  };
}

/** An enemy's side: physical only today (no magic damage, no crits); its magic resist works against the hero's magic. */
export function enemyCombatSide(enemy: EnemyDef): CombatSide {
  return {
    damage: { ...enemy.damage },
    armor: enemy.armor,
    magicDamage: 0,
    magicResist: enemy.magicResist,
    critChanceBp: 0,
    critMultBp: BASIS_POINTS,
    attackIntervalMs: enemy.attackIntervalMs,
    skills: [...(enemy.skills ?? [])],
  };
}

/** The extra fight settings an enemy brings (its own time limit and regen); all defaults for a dungeon enemy. */
export function enemyFightOptions(enemy: EnemyDef): FightOptions {
  return { maxFightMs: enemy.maxFightMs ?? COMBAT.maxFightMs, enemyRegenBp: enemy.regenBpPerSec ?? 0 };
}

// ---------- how a fight ended ----------

/** What a finished fight hands to the code that applies its result (dungeon.ts for a stage run, boss.ts for a boss). */
export type FightOutcome = {
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
 * The outcome of `fight` ending at fight time `durationMs`. An enemy that regenerates gets its regen up to that instant first
 * (a time-limit loss or a flee shows the HP it really had); a defeated enemy stays at 0. Mutates `fight` (regen only).
 */
export function outcomeOf(fight: ActiveFight, endReason: FightEndReason, durationMs: number): FightOutcome {
  if (endReason !== 'enemy_defeated') regenEnemyTo(fight, durationMs);
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

// ---------- the fight on screen ----------

/** The fight on screen, as it stands at the state's engine time (read-only). */
export type DungeonFightView = {
  enemyId: EnemyId;
  elapsedMs: number;
  /** This fight's time limit (60 s for a dungeon, the boss's own for a boss). */
  maxFightMs: number;
  /** The hero's current HP (character.hp), which regenerates during the fight too. */
  heroHp: number;
  heroMaxHp: number;
  /** The enemy's HP at `elapsedMs`: for a regenerating enemy this includes the regen since its last strike. */
  enemyHp: number;
  enemyMaxHp: number;
  /** Enemy regen, basis points of its max HP per second (0 = none). */
  enemyRegenBp: number;
  /** Hero strikes still to be lost to a stun. */
  heroStunStrikes: number;
  /** Strikes that have landed so far, in time order. */
  log: readonly FightLogEntry[];
};

export function fightView(heroHp: number, fight: ActiveFight): DungeonFightView {
  return {
    enemyId: fight.enemyId,
    elapsedMs: fight.elapsedMs,
    maxFightMs: fight.maxFightMs,
    heroHp: Math.max(0, Math.min(heroHp, fight.heroMaxHp)),
    heroMaxHp: fight.heroMaxHp,
    enemyHp: enemyHpAt(fight, fight.elapsedMs),
    enemyMaxHp: fight.enemyMaxHp,
    enemyRegenBp: fight.enemyRegenBp,
    heroStunStrikes: fight.heroStunStrikes,
    log: fight.log,
  };
}
