// Live fight rules (pure, deterministic). The engine produces the log; the UI shows it as it lands.
//
//   each side strikes on its own timer from the fight's start: strike n (1-based) of a side lands at
//     firstStrikeMs + (n - 1) × its attackIntervalMs        (1.25.0: hero first strike 0, every mob 300 ms; COMBAT, stored on the fight)
//   (before 1.25.0 the first strike landed one interval in, i.e. firstStrikeMs = the interval: a fight in progress keeps that)
//   on a tie the hero strikes first
//   PACKS (1.24.0, save v22): a fight has one or more mobs (Normal and bosses: one). Every ALIVE mob strikes on its own timer from the
//     fight's start; the hero strikes the FIRST alive mob in pack order (no overkill carry-over: a strike only hurts its target; when it
//     dies the next hero strike goes to the next mob). Same-instant ties: the hero first, then the mobs in pack order. A dead mob never
//     strikes again. The fight is won when every mob is dead; the time limit, a flee and the hero's death are losses as before.
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
import type { ActiveFight, CombatSide, EnemyId, FightEndReason, FightLogEntry, FightMob, MobVariant, RngState } from './types';

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

/** A whole number of ms ≥ 0: when a side's first strike lands. */
function safeOffset(ms: number | undefined, fallback: number): number {
  const v = ms === undefined ? fallback : ms;
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : fallback;
}

/**
 * Fight time of strike number `strikeNo` (1-based) of a side that opens at `firstStrikeMs` and strikes every `intervalMs`:
 * firstStrikeMs + (strikeNo - 1) × intervalMs. The one strike-time formula (docs/ENGINE.md "Fight").
 */
export function strikeTimeMs(firstStrikeMs: number, intervalMs: number, strikeNo: number): number {
  return firstStrikeMs + (strikeNo - 1) * intervalMs;
}

/** What a fight needs besides the two sides: set for a boss (1.20.0), all defaults for a dungeon enemy. */
export type FightOptions = {
  /** Time limit, ms (default COMBAT.maxFightMs). */
  maxFightMs?: number;
  /** When the hero's / every mob's first strike lands, fight ms (defaults COMBAT.heroFirstStrikeMs / enemyFirstStrikeMs; the old timing = one interval). */
  heroFirstStrikeMs?: number;
  enemyFirstStrikeMs?: number;
  /** Enemy HP regeneration, basis points of its max HP per second (default 0). */
  enemyRegenBp?: number;
};

/** One enemy HP in enemy-regen units: bp (10 000) × ms per second (1 000). */
export const ENEMY_REGEN_UNIT = BASIS_POINTS * 1000;

function copySide(side: CombatSide): CombatSide {
  return { ...side, damage: { ...side.damage }, skills: [...(side.skills ?? [])], attackIntervalMs: safeInterval(side.attackIntervalMs) };
}

/** What a mob is made from: its (frozen) side, HP and the extras only bosses have. */
export type MobInit = {
  variant?: MobVariant;
  /** Stat / reward multiplier it was made with, bp (default 10 000). */
  multBp?: number;
  side: CombatSide;
  hp: number;
  /** HP regeneration, bp of its max HP per second (default 0). */
  regenBp?: number;
};

function newMob(init: MobInit): FightMob {
  const side = copySide(init.side);
  const skillReady: FightMob['skillReady'] = {};
  for (const id of side.skills) {
    const def = COMBAT_SKILLS[id];
    if (def) skillReady[id] = def.firstReadyStrike;
  }
  const hp = Math.max(0, init.hp);
  return {
    variant: init.variant ?? 'base',
    multBp: init.multBp ?? BASIS_POINTS,
    hp,
    maxHp: hp,
    side,
    strikes: 0,
    regenBp: Math.max(0, Math.floor(init.regenBp ?? 0)),
    regenProgress: 0,
    regenAtMs: 0,
    skillReady,
  };
}

/** A fresh fight at time 0 against a pack (at least one mob, in pack order). `heroHp` must be > 0 (a 0 HP hero loses with no fight). */
export function newPackFight(
  enemyId: EnemyId,
  hero: CombatSide,
  mobs: readonly MobInit[],
  heroHp: number,
  heroMaxHp: number,
  options: Pick<FightOptions, 'maxFightMs' | 'heroFirstStrikeMs' | 'enemyFirstStrikeMs'> = {},
): ActiveFight {
  return {
    enemyId,
    elapsedMs: 0,
    heroHpStart: heroHp,
    heroMaxHp,
    hero: copySide(hero),
    heroStrikes: 0,
    heroFirstStrikeMs: safeOffset(options.heroFirstStrikeMs, COMBAT.heroFirstStrikeMs),
    enemyFirstStrikeMs: safeOffset(options.enemyFirstStrikeMs, COMBAT.enemyFirstStrikeMs),
    mobs: mobs.map(newMob),
    maxFightMs: Number.isFinite(options.maxFightMs) ? Math.max(1, Math.floor(options.maxFightMs!)) : COMBAT.maxFightMs,
    heroStunStrikes: 0,
    log: [],
  };
}

/** A fresh fight at time 0 against ONE enemy (a Normal stage fight, a boss). `heroHp` must be > 0 (a 0 HP hero loses with no fight). */
export function newFight(
  enemyId: EnemyId,
  hero: CombatSide,
  enemy: CombatSide,
  heroHp: number,
  heroMaxHp: number,
  enemyHp: number,
  options: FightOptions = {},
): ActiveFight {
  return newPackFight(enemyId, hero, [{ side: enemy, hp: enemyHp, regenBp: options.enemyRegenBp }], heroHp, heroMaxHp, options);
}

/** The first alive mob (the hero's target), or -1 when every mob is dead. */
export function frontMob(fight: Pick<ActiveFight, 'mobs'>): number {
  return fight.mobs.findIndex((m) => m.hp > 0);
}

/** True when every mob is dead. */
export function packDefeated(fight: Pick<ActiveFight, 'mobs'>): boolean {
  return fight.mobs.every((m) => m.hp <= 0);
}

/**
 * A strike (`mob` = the mob that strikes, or the one the hero's strike lands on) or the time limit. The hero's `mob` is the first alive
 * mob at the moment the event is read.
 */
export type FightEvent = { type: 'strike'; actor: 'hero' | 'enemy'; mob: number; atMs: number } | { type: 'time_limit'; atMs: number };

/**
 * The next thing that happens in this fight, by fight time. Ties: the hero first, then the mobs in pack order (dead mobs never strike).
 * The limit is the fight's own (frozen at its start).
 */
export function nextFightEvent(fight: ActiveFight, maxFightMs: number = fight.maxFightMs): FightEvent {
  let atMs = strikeTimeMs(fight.heroFirstStrikeMs, fight.hero.attackIntervalMs, fight.heroStrikes + 1);
  let actor: 'hero' | 'enemy' = 'hero';
  let mob = frontMob(fight);
  for (let i = 0; i < fight.mobs.length; i++) {
    const m = fight.mobs[i];
    if (m.hp <= 0) continue;
    const at = strikeTimeMs(fight.enemyFirstStrikeMs, m.side.attackIntervalMs, m.strikes + 1);
    if (at < atMs) {
      atMs = at;
      actor = 'enemy';
      mob = i;
    }
  }
  return atMs <= maxFightMs ? { type: 'strike', actor, mob, atMs } : { type: 'time_limit', atMs: maxFightMs };
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

/** Applies one mob's regen up to fight time `atMs` (mutates the mob, which the caller owns). Idempotent for the same time. */
export function regenMobTo(mob: FightMob, atMs: number): void {
  const dt = atMs - mob.regenAtMs;
  if (!(dt > 0)) return;
  mob.regenAtMs = atMs;
  if (!(mob.regenBp > 0)) return;
  const [hp, progress] = enemyRegen(mob.hp, mob.regenProgress, mob.maxHp, mob.regenBp, dt);
  mob.hp = hp;
  mob.regenProgress = progress;
}

/** Applies every mob's regen up to fight time `atMs` (mutates `fight`, which the caller owns). Without regen this changes nothing. */
export function regenEnemyTo(fight: Pick<ActiveFight, 'mobs'>, atMs: number): void {
  for (const m of fight.mobs) regenMobTo(m, atMs);
}

/** A mob's HP at fight time `atMs` without changing it (read-only, for the live bar). */
export function enemyHpAt(mob: Pick<FightMob, 'hp' | 'maxHp' | 'regenBp' | 'regenProgress' | 'regenAtMs'>, atMs: number): number {
  const dt = atMs - mob.regenAtMs;
  if (!(mob.regenBp > 0) || !(dt > 0)) return mob.hp;
  return enemyRegen(mob.hp, mob.regenProgress, mob.maxHp, mob.regenBp, dt)[0];
}

/** The first skill of the mob that is ready for its next strike, or null. */
function readyMobSkill(mob: FightMob): CombatSkillDef | null {
  const next = mob.strikes + 1;
  for (const id of mob.side.skills) {
    const ready = mob.skillReady[id];
    const def = COMBAT_SKILLS[id];
    if (def && ready !== undefined && next >= ready) return def;
  }
  return null;
}

/**
 * One strike at `atMs` (fight time). Mutates `fight` (the caller owns it): the strike counters, the log, the mobs' regen and, for a hero
 * strike, the target's HP, a cast's cooldown and a stun. Returns the hero's HP after it and the advanced RNG. A hero strike lands on the
 * first alive mob; an enemy strike is by mob `mobIndex` (default 0, a fight of one mob).
 *
 * RNG (see the header): a hero strike draws twice, always in this order: the physical roll, then the crit check (drawn even at 0%
 * chance, so the stream never depends on the chance); a stunned hero strike draws nothing. An enemy strike draws once (its roll;
 * enemies cannot crit); a skill cast draws its roll, then one stun check per stun effect in listed order, always.
 */
export function strike(
  fight: ActiveFight,
  actor: 'hero' | 'enemy',
  atMs: number,
  heroHp: number,
  rng: RngState,
  mobIndex: number = 0,
): { heroHp: number; rng: RngState } {
  // The mobs regenerate up to this instant first (before one is hit or acts). Without regen this changes nothing.
  regenEnemyTo(fight, atMs);
  const packed = fight.mobs.length > 1;
  if (actor === 'hero') {
    const index = Math.max(0, frontMob(fight));
    const target = fight.mobs[index];
    const regens = target.regenBp > 0;
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
        targetHpAfter: target.hp,
        stunned: true,
      };
      if (regens) lost.enemyHpAfter = target.hp;
      if (packed) lost.mob = index;
      fight.log.push(lost);
      return { heroHp, rng };
    }
    const h = rollDamage(rng, fight.hero.damage);
    const c = nextInt(h.rng, 0, BASIS_POINTS - 1);
    const crit = c.value < Math.min(BASIS_POINTS, Math.max(0, fight.hero.critChanceBp));
    const physical = reducedDamage(crit ? critDamage(h.value, fight.hero.critMultBp) : h.value, target.side.armor);
    const magic = reducedDamage(fight.hero.magicDamage, target.side.magicResist);
    const dealt = Math.max(COMBAT.minDamage, physical + magic);
    fight.heroStrikes += 1;
    target.hp = Math.max(0, target.hp - dealt);
    const entry: FightLogEntry = { atMs, actor, strike: fight.heroStrikes, roll: h.value, crit, physical, magic, dealt, targetHpAfter: target.hp };
    if (regens) entry.enemyHpAfter = target.hp;
    if (packed) entry.mob = index;
    fight.log.push(entry);
    return { heroHp, rng: c.rng };
  }
  const mob = fight.mobs[mobIndex];
  const skill = readyMobSkill(mob);
  const e = rollDamage(rng, mob.side.damage);
  let r = e.rng;
  const raw = skill ? critDamage(e.value, skill.damageMultBp) : e.value;
  const physical = reducedDamage(raw, fight.hero.armor);
  const magic = reducedDamage(mob.side.magicDamage, fight.hero.magicResist);
  const dealt = Math.max(COMBAT.minDamage, physical + magic);
  mob.strikes += 1;
  const hp = Math.max(0, heroHp - dealt);
  const entry: FightLogEntry = { atMs, actor, strike: mob.strikes, roll: e.value, crit: false, physical, magic, dealt, targetHpAfter: hp };
  if (skill) {
    entry.skill = skill.id;
    mob.skillReady[skill.id] = mob.strikes + skill.cooldownStrikes;
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
  if (mob.regenBp > 0) entry.enemyHpAfter = mob.hp;
  if (packed) entry.mob = mobIndex;
  fight.log.push(entry);
  return { heroHp: hp, rng: r };
}

/**
 * A whole fight at once, with no HP regen between strikes (tests, balance sims). The dungeon loop plays the same
 * events in engine time instead, with regen. `enemy` is one mob, or a pack in pack order (a Hard / Extreme stage fight).
 */
export function resolveFight(
  hero: Combatant,
  enemy: (CombatSide & { hp: number }) | readonly (CombatSide & { hp: number; regenBp?: number })[],
  rng: RngState,
  maxFightMs: number = COMBAT.maxFightMs,
  options: Omit<FightOptions, 'maxFightMs'> = {},
): FightResult {
  const single = !Array.isArray(enemy);
  const pack = (single ? [enemy] : enemy) as readonly (CombatSide & { hp: number; regenBp?: number })[];
  let heroHp = Math.max(0, hero.hp);
  const startHp = pack.reduce((n, m) => n + Math.max(0, m.hp), 0);
  if (heroHp <= 0) return { won: false, endReason: 'no_hp', durationMs: 0, heroHp: 0, enemyHp: startHp, log: [], rng };
  // `options.enemyRegenBp` is the regen of the one enemy; a pack lists each mob's own `regenBp`.
  const mobs: MobInit[] = pack.map((m) => ({ side: m, hp: m.hp, regenBp: single ? options.enemyRegenBp : m.regenBp }));
  const fight = newPackFight('rat', hero, mobs, heroHp, heroHp, { maxFightMs, heroFirstStrikeMs: options.heroFirstStrikeMs, enemyFirstStrikeMs: options.enemyFirstStrikeMs });
  const left = () => fight.mobs.reduce((n, m) => n + m.hp, 0);
  let r = rng;
  for (;;) {
    const ev = nextFightEvent(fight, maxFightMs);
    if (ev.type === 'time_limit') {
      // Time limit: a loss, and every loss leaves the hero at 0 HP.
      regenEnemyTo(fight, ev.atMs);
      return { won: false, endReason: 'time_limit', durationMs: ev.atMs, heroHp: 0, enemyHp: left(), log: fight.log, rng: r };
    }
    const res = strike(fight, ev.actor, ev.atMs, heroHp, r, ev.mob);
    heroHp = res.heroHp;
    r = res.rng;
    if (packDefeated(fight)) return { won: true, endReason: 'enemy_defeated', durationMs: ev.atMs, heroHp, enemyHp: 0, log: fight.log, rng: r };
    if (heroHp === 0) return { won: false, endReason: 'hero_defeated', durationMs: ev.atMs, heroHp: 0, enemyHp: left(), log: fight.log, rng: r };
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

/** One mob of a finished fight: what it was, its reward multiplier, and the HP it had at the start and at the end. */
export type OutcomeMob = { variant: MobVariant; multBp: number; maxHp: number; hpEnd: number };

/** What a finished fight hands to the code that applies its result (dungeon.ts for a stage run, boss.ts for a boss). */
export type FightOutcome = {
  endReason: FightEndReason;
  durationMs: number;
  enemyId: EnemyId;
  /** The fight's opening (1.25.0): when the first strikes of the hero and of the mobs landed, fight ms. */
  heroFirstStrikeMs: number;
  enemyFirstStrikeMs: number;
  heroHpStart: number;
  heroMaxHp: number;
  /** The whole pack's max HP and what was left (sums over `mobs`). */
  enemyMaxHp: number;
  enemyHpEnd: number;
  /** The pack in pack order. */
  mobs: OutcomeMob[];
  log: FightLogEntry[];
};

/**
 * The outcome of `fight` ending at fight time `durationMs`. Mobs that regenerate get their regen up to that instant first
 * (a time-limit loss or a flee shows the HP they really had); a defeated mob stays at 0. Mutates `fight` (regen only).
 */
export function outcomeOf(fight: ActiveFight, endReason: FightEndReason, durationMs: number): FightOutcome {
  if (endReason !== 'enemy_defeated') regenEnemyTo(fight, durationMs);
  const mobs = fight.mobs.map((m) => ({ variant: m.variant, multBp: m.multBp, maxHp: m.maxHp, hpEnd: m.hp }));
  return {
    endReason,
    durationMs,
    enemyId: fight.enemyId,
    heroFirstStrikeMs: fight.heroFirstStrikeMs,
    enemyFirstStrikeMs: fight.enemyFirstStrikeMs,
    heroHpStart: fight.heroHpStart,
    heroMaxHp: fight.heroMaxHp,
    enemyMaxHp: mobs.reduce((n, m) => n + m.maxHp, 0),
    enemyHpEnd: mobs.reduce((n, m) => n + m.hpEnd, 0),
    mobs,
    log: fight.log,
  };
}

// ---------- the fight on screen ----------

/** One mob on screen: its HP at the fight's current time. */
export type MobView = { variant: MobVariant; hp: number; maxHp: number; alive: boolean };

/** The fight on screen, as it stands at the state's engine time (read-only). */
export type DungeonFightView = {
  enemyId: EnemyId;
  elapsedMs: number;
  /** This fight's time limit (60 s for a dungeon, the boss's own for a boss). */
  maxFightMs: number;
  /** The hero's current HP (character.hp), which regenerates during the fight too. */
  heroHp: number;
  heroMaxHp: number;
  /** The pack's HP at `elapsedMs` (the sum over `mobs`; for a fight of one mob, that mob's, regen since its last strike included). */
  enemyHp: number;
  enemyMaxHp: number;
  /** The pack in pack order (1.24.0), and the position of the mob the hero strikes next (-1 when none is alive). */
  mobs: MobView[];
  targetIndex: number;
  /** Regen of the first mob, basis points of its max HP per second (0 = none; bosses only). */
  enemyRegenBp: number;
  /** Hero strikes still to be lost to a stun. */
  heroStunStrikes: number;
  /** Strikes that have landed so far, in time order. */
  log: readonly FightLogEntry[];
};

export function fightView(heroHp: number, fight: ActiveFight): DungeonFightView {
  const mobs = fight.mobs.map((m) => {
    const hp = enemyHpAt(m, fight.elapsedMs);
    return { variant: m.variant, hp, maxHp: m.maxHp, alive: hp > 0 };
  });
  return {
    enemyId: fight.enemyId,
    elapsedMs: fight.elapsedMs,
    maxFightMs: fight.maxFightMs,
    heroHp: Math.max(0, Math.min(heroHp, fight.heroMaxHp)),
    heroMaxHp: fight.heroMaxHp,
    enemyHp: mobs.reduce((n, m) => n + m.hp, 0),
    enemyMaxHp: mobs.reduce((n, m) => n + m.maxHp, 0),
    mobs,
    targetIndex: mobs.findIndex((m) => m.alive),
    enemyRegenBp: fight.mobs[0]?.regenBp ?? 0,
    heroStunStrikes: fight.heroStunStrikes,
    log: fight.log,
  };
}
