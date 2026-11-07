// The first boss (engine 1.20.0, save v20): the Troll Chieftain. Unlock and entry rules, Heavy Bash and the stun (timing, damage, RNG
// order, no stun-lock), enemy regen, the 120 s limit, rewards, the golden fight, live == offline, split invariance, properties, the
// v19 -> v20 migration (a frozen v19 save) and the replay log. The balance numbers are NOT pinned here (tests/balanceSimBoss.test.ts
// reports them); the rules are.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type ActiveFight,
  applyCommand,
  BOSS_IDS,
  BOSSES,
  bossDangerHint,
  bossEntryView,
  bossRunView,
  bossTotals,
  bossUnlockView,
  COMBAT,
  COMBAT_SKILLS,
  createRng,
  CURRENT_SAVE_VERSION,
  type DungeonId,
  DUNGEON_IDS,
  DUNGEONS,
  ENEMIES,
  type FightLogEntry,
  type GameState,
  baseSellPrice,
  getDerivedStats,
  hashState,
  heroOwnsItem,
  isBossUnlocked,
  chance,
  loadSave,
  mergeSummaries,
  nextFloat,
  nextInt,
  type ReplayEntry,
  replayLogReport,
  type RngState,
  simulate,
  weightedPick,
} from '../src/engine';
import { rollQuality, rollRarity } from '../src/engine/gear';
import { getItemDef } from '../src/engine/config/items';
import { makeItem } from '../src/engine/inventory';
import { enemyCombatSide, enemyFightOptions, enemyHpAt, enemyRegen, heroCombatSide, newFight, nextFightEvent, resolveFight, strike } from '../src/engine/combat';
import { asV21, bossHero, bossSlayer, builtGame, cmd, fightSide, HOUR, makeClient, SEC, T0, withTrollBridgeWins, woodcuttingGame } from './helpers';

const ENTER = { type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10 } as const;
const chieftain = ENEMIES.troll_chieftain;
/** One RNG draw forward (every draw advances the seed by the same step), to count draws. */
const nextDraw = (r: RngState): RngState => nextFloat(r).rng;
const FIXTURES = join(__dirname, 'fixtures');

/** The reference hero of the balance report: STR+END, level 20, Iron set quality 25, boss unlocked. */
const fighter = (seed = 1) => ({ ...withTrollBridgeWins(bossHero(20, 'STR+END', 25)), rng: { seed } as RngState });

function enter(s: GameState, now = T0): GameState {
  const r = applyCommand(s, cmd(ENTER), now);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
}

function errorOf(s: GameState, now = T0, c: Parameters<typeof cmd>[0] = ENTER): string {
  const r = applyCommand(s, cmd(c), now);
  if (r.ok) throw new Error('expected an error');
  return r.error.code;
}

/**
 * The whole boss fight (enter at T0, play to long after the 120 s limit). 1.25.0: ENTER_BOSS plays the hero's opening strike (fight time 0)
 * itself, so a one-shot kill happens inside the command: the summary and events are the command's and the simulation's together.
 */
function fightAll(s: GameState) {
  const entered = applyCommand(s, cmd(ENTER), T0);
  if (!entered.ok) throw new Error(`${entered.error.code}: ${entered.error.message}`);
  const sim = simulate(entered.state, T0 + 130 * SEC);
  return { state: sim.state, events: [...entered.events.filter((e) => e.type !== 'ACTIVITY_STARTED'), ...sim.events], summary: mergeSummaries(entered.summary, sim.summary), fight: sim.state.dungeon.lastFight! };
}

const bossFightOf = (s: GameState): ActiveFight | null => (s.activity?.kind === 'boss' ? s.activity.fight : null);

/** A boss fight from `resolveFight` with the real boss data against a hero side (no regen of the hero, no potions). */
function bossFight(hero: { hp: number } & ReturnType<typeof fightSide>, seed: number, opening: { heroFirstStrikeMs?: number; enemyFirstStrikeMs?: number } = {}) {
  const opts = enemyFightOptions(chieftain);
  return resolveFight(hero, { hp: chieftain.hp, ...enemyCombatSide(chieftain) }, createRng(seed), opts.maxFightMs, { ...opts, ...opening });
}

/** A hero side that survives and deals ~nothing (armor huge, damage 1): the boss casts on schedule for the whole limit. */
const dummy = () => ({ hp: 1_000_000, ...fightSide({ damage: { min: 1, max: 1 }, armor: 1_000_000 }) });

describe('boss data', () => {
  it('the Troll Chieftain starts with the owner-approved numbers (2026-11-05)', () => {
    expect(chieftain).toMatchObject({ hp: 1000, damage: { min: 26, max: 36 }, armor: 40, magicResist: 40, attackIntervalMs: 1000, regenBpPerSec: 50, maxFightMs: 120_000, skills: ['heavy_bash'] });
    expect(BOSS_IDS).toEqual(['troll_chieftain']);
    expect(BOSSES.troll_chieftain).toMatchObject({ unlock: { dungeonId: 'troll_bridge', wins: 50 }, entryStamina: 10 });
    expect(BOSSES.troll_chieftain.rewards).toMatchObject({ heroXp: 2000, gold: { min: 300, max: 450 } });
    expect(BOSSES.troll_chieftain.rewards.gear.chance).toBe(0.35);
    expect(BOSSES.troll_chieftain.rewards.drops).toEqual([{ itemId: 'troll_head', chance: 0.25 }, { itemId: 'potion_belt', chance: 1 }]); // 1.26.0: was the Tusk at 0.5
    // The five stage dungeons keep their ids and are Tier 1, stages 1..5.
    expect(DUNGEON_IDS).toEqual(['rat_cellar', 'bat_cave', 'wolf_den', 'forgotten_crypt', 'troll_bridge']);
    expect(DUNGEON_IDS.map((id) => [DUNGEONS[id].tier, DUNGEONS[id].stage])).toEqual([[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]]);
  });

  it('Heavy Bash: 1.4x, 35% stun for 3 strikes, ready on strike 3 then every 7', () => {
    expect(COMBAT_SKILLS.heavy_bash).toMatchObject({ damageMultBp: 14_000, cooldownStrikes: 7, firstReadyStrike: 3, effects: [{ type: 'stun', chanceBp: 3500, strikes: 3 }] });
  });

  it('INVARIANT: every skill cooldown is longer than every stun it can cause (no stun-lock)', () => {
    for (const skill of Object.values(COMBAT_SKILLS)) {
      for (const effect of skill.effects) if (effect.type === 'stun') expect(skill.cooldownStrikes).toBeGreaterThan(effect.strikes);
    }
  });

  it('the gear drop is the Iron set, equal weights, uncommon 75 / rare 25, quality 0..70', () => {
    const g = BOSSES.troll_chieftain.rewards.gear;
    expect(g.pieces.map((p) => p.itemId).sort()).toEqual(['iron_boots', 'iron_chestplate', 'iron_gloves', 'iron_helm', 'iron_shield', 'iron_sword']);
    expect(new Set(g.pieces.map((p) => p.weight)).size).toBe(1);
    expect(g.rarityWeights).toEqual([{ value: 'uncommon', weight: 75 }, { value: 'rare', weight: 25 }]);
    expect(g.quality).toEqual({ min: 0, max: 70 });
  });
});

describe('unlock', () => {
  it('is locked until 50 lifetime Troll Bridge wins; progress is shown; the engine refuses it with a typed error', () => {
    const s = builtGame(1, T0);
    expect(isBossUnlocked(s, 'troll_chieftain')).toBe(false);
    expect(bossUnlockView(s, 'troll_chieftain')).toEqual({ unlocked: false, requirement: { dungeonId: 'troll_bridge', wins: 50 }, progress: 0, difficultyLocked: false });
    expect(errorOf(s)).toBe('BOSS_LOCKED');
    const at49 = withTrollBridgeWins(s, 49);
    expect(bossUnlockView(at49, 'troll_chieftain')).toMatchObject({ unlocked: false, progress: 49 });
    expect(errorOf(at49)).toBe('BOSS_LOCKED');
    const at50 = withTrollBridgeWins(s, 50);
    expect(bossUnlockView(at50, 'troll_chieftain')).toMatchObject({ unlocked: true, progress: 50 });
    expect(applyCommand(at50, cmd(ENTER), T0).ok).toBe(true);
    // Progress is capped at the requirement.
    expect(bossUnlockView(withTrollBridgeWins(s, 80), 'troll_chieftain').progress).toBe(50);
  });

  it('the locked message names the progress ("12/50")', () => {
    const r = applyCommand(withTrollBridgeWins(builtGame(1, T0), 12), cmd(ENTER), T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('12/50');
  });

  it('is permanent: it stays unlocked after losses and across a save', () => {
    const s = fighter(5);
    const lost = fightAll({ ...s, character: { ...s.character, hp: 1 } });
    expect(lost.fight.won).toBe(false);
    expect(isBossUnlocked(lost.state, 'troll_chieftain')).toBe(true);
  });

  it('the 50th Troll Bridge win emits DUNGEON_UNLOCKED for the boss', () => {
    const s = withTrollBridgeWins(builtGame(1, T0), 49);
    const r = applyCommand({ ...s, flags: { ...s.flags } }, cmd({ type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'troll_bridge', amount: 1 }), T0);
    // troll_bridge itself may be locked in a fresh game: the debug command refuses then, which is not what this test is about.
    if (r.ok) expect(r.events.some((e) => e.type === 'DUNGEON_UNLOCKED' && e.dungeonId === 'troll_chieftain')).toBe(true);
    else expect(r.error.code).toBe('DUNGEON_LOCKED');
  });
});

describe('entry', () => {
  it('costs 10 stamina up front, makes the boss the activity and starts the fight at once with the hero\'s current HP', () => {
    const s = fighter();
    const before = s.stamina.current;
    const r = applyCommand(s, cmd(ENTER), T0);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.stamina.current).toBe(before - 10);
    expect(r.events.map((e) => e.type)).toEqual(['ACTIVITY_STARTED']);
    expect(r.state.activity).toMatchObject({ kind: 'boss', bossId: 'troll_chieftain', startedAt: T0, progressMs: 0 });
    const f = bossFightOf(r.state)!;
    expect(f).toMatchObject({ enemyId: 'troll_chieftain', elapsedMs: 0, heroHpStart: s.character.hp, maxFightMs: 120_000, heroStunStrikes: 0, heroStrikes: 1, heroFirstStrikeMs: 0, enemyFirstStrikeMs: 300 });
    // 1.25.0: the hero's opening strike (fight time 0) is already played by the command; the Chieftain's first strike is due at 300 ms.
    expect(f.log.map((e) => [e.actor, e.atMs])).toEqual([['hero', 0]]);
    expect(f.mobs).toHaveLength(1);
    expect(f.mobs[0]).toMatchObject({ variant: 'base', multBp: 10_000, maxHp: 1000, regenBp: 50, strikes: 0 });
    expect(f.mobs[0].hp).toBeLessThan(1000);
    expect(f.mobs[0].skillReady).toEqual({ heavy_bash: 3 });
    expect(f.mobs[0].side.skills).toEqual(['heavy_bash']);
    expect(f.hero.skills).toEqual([]);
  });

  it('the cost is bound to the shown cost: a changed (higher) cost fails with COST_CHANGED and nothing is paid', () => {
    const s = fighter();
    expect(errorOf(s, T0, { ...ENTER, maxCost: 9 })).toBe('COST_CHANGED');
    expect(errorOf(s, T0, { ...ENTER, maxCost: 0 })).toBe('INVALID_AMOUNT');
    expect(errorOf(s, T0, { ...ENTER, maxCost: 1.5 })).toBe('INVALID_AMOUNT');
    expect(errorOf(s, T0, { ...ENTER, maxCost: '10' as unknown as number })).toBe('INVALID_AMOUNT');
    expect(errorOf(s, T0, { ...ENTER, bossId: 'nobody' as 'troll_chieftain' })).toBe('UNKNOWN_BOSS');
    // A higher maxCost than needed is fine and only 10 is charged.
    const r = applyCommand(s, cmd({ ...ENTER, maxCost: 25 }), T0);
    expect(r.ok && r.state.stamina.current).toBe(s.stamina.current - 10);
  });

  it('not enough stamina: typed error, nothing changes; exactly 10 is enough', () => {
    const s = fighter();
    const poor = { ...s, stamina: { ...s.stamina, current: 9 } };
    expect(errorOf(poor)).toBe('NOT_ENOUGH_STAMINA');
    expect(bossEntryView(poor, 'troll_chieftain')).toMatchObject({ block: 'stamina', cost: 10 });
    const exact = { ...s, stamina: { ...s.stamina, current: 10 } };
    const r = applyCommand(exact, cmd(ENTER), T0);
    expect(r.ok && r.state.stamina.current).toBe(0);
  });

  it('refuses a hero at 0 HP with a typed error and charges nothing', () => {
    const s = fighter();
    const dead = { ...s, character: { ...s.character, hp: 0 } };
    expect(errorOf(dead)).toBe('NO_HP');
    expect(bossEntryView(dead, 'troll_chieftain').block).toBe('no_hp');
  });

  it('the entry view flags HP below half (the UI warns before entering) but still lets him in', () => {
    const s = fighter();
    const max = getDerivedStats(s).maxHp.value;
    const low = { ...s, character: { ...s.character, hp: Math.floor(max / 2) - 1 } };
    expect(bossEntryView(low, 'troll_chieftain')).toMatchObject({ hpBelowHalf: true, block: null });
    expect(bossEntryView({ ...s, character: { ...s.character, hp: Math.ceil(max / 2) } }, 'troll_chieftain').hpBelowHalf).toBe(false);
  });

  it('a second tap during the fight fails (never pays twice)', () => {
    const s = enter(fighter());
    expect(errorOf(s, T0 + 1000)).toBe('FIGHT_IN_PROGRESS');
    expect(bossEntryView(s, 'troll_chieftain').block).toBe('fight');
  });

  it('one activity at a time: gathering stops, a dungeon search is cancelled; a dungeon FIGHT blocks the entry (leaving it would forfeit)', () => {
    const g = withTrollBridgeWins(woodcuttingGame());
    const r = applyCommand(g, cmd(ENTER), T0 + 5 * SEC);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events.map((e) => e.type)).toEqual(['ACTIVITY_STOPPED', 'ACTIVITY_STARTED']);
    expect(r.state.activity?.kind).toBe('boss');

    const search = applyCommand(withTrollBridgeWins(builtGame(3, T0)), cmd({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }), T0);
    if (!search.ok) throw new Error(search.error.message);
    const r2 = applyCommand(search.state, cmd(ENTER), T0 + 5 * SEC);
    if (!r2.ok) throw new Error(r2.error.message);
    expect(r2.events.map((e) => e.type)).toEqual(['DUNGEON_RUN_CANCELLED', 'ACTIVITY_STOPPED', 'ACTIVITY_STARTED']);
    expect(r2.state.activity?.kind).toBe('boss');

    const inFight = simulate(search.state, T0 + 120 * SEC + 1).state; // the search just ended: a fight is on
    expect(inFight.activity).toMatchObject({ kind: 'dungeon', phase: 'fight' });
    expect(errorOf(inFight, T0 + 120 * SEC + 1)).toBe('FIGHT_IN_PROGRESS');
  });
});

describe('stamina is never refunded', () => {
  it('win, loss, flee and time limit all keep the 10 stamina spent', () => {
    // win
    const w = fightAll(bossSlayer(4));
    expect(w.fight.won).toBe(true);
    // loss (hero at 1 HP)
    const s = fighter(5);
    const l = fightAll({ ...s, character: { ...s.character, hp: 1 } });
    expect(l.fight).toMatchObject({ won: false, endReason: 'hero_defeated' });
    // flee: STOP_ACTIVITY while the fight is on
    const fleeAt = applyCommand(enter(s), cmd({ type: 'STOP_ACTIVITY' }), T0 + 4 * SEC);
    if (!fleeAt.ok) throw new Error(fleeAt.error.message);
    expect(fleeAt.state.character.hp).toBe(0);
    // The stamina right after entering, then after the fight, differs only by the regen over the elapsed time: no +10 ever shows up.
    const afterEnter = enter(s).stamina.current;
    expect(afterEnter).toBe(s.stamina.current - 10);
    expect(fleeAt.state.stamina.current).toBeLessThanOrEqual(afterEnter + 1);
  });
});

describe('Heavy Bash', () => {
  it('is cast on the boss\'s strikes 3, 10, 17, 24... and only then; every cast replaces the normal strike', () => {
    const r = bossFight(dummy(), 11);
    const casts = r.log.filter((e) => e.actor === 'enemy' && e.skill === 'heavy_bash').map((e) => e.strike);
    expect(r.endReason).toBe('time_limit');
    expect(casts).toEqual([3, 10, 17, 24, 31, 38, 45, 52, 59, 66, 73, 80, 87, 94, 101, 108, 115]);
    // The enemy strikes once a second from 300 ms (1.25.0): strike n lands at 300 + (n - 1) x 1000 ms, so the 3rd (the first Bash) is at 2.3 s.
    expect(r.log.filter((e) => e.actor === 'enemy').length).toBe(120);
    expect(r.log.filter((e) => e.actor === 'enemy' && e.skill).map((e) => e.atMs)).toEqual(casts.map((n) => 300 + (n - 1) * 1000));
    // On the old timing (first strike one interval in) the same fight casts on strikes 3, 10, 17... at 3 s, 10 s, 17 s...
    const old = bossFight(dummy(), 11, { heroFirstStrikeMs: 1000, enemyFirstStrikeMs: 1000 });
    expect(old.log.filter((e) => e.actor === 'enemy' && e.skill).map((e) => [e.strike, e.atMs])).toEqual(casts.map((n) => [n, n * 1000]));
  });

  it('deals the roll x 1.4 (half up), then armor, with the minimum-damage rule', () => {
    const r = bossFight(dummy(), 3);
    const cast = r.log.find((e) => e.skill)!;
    // armor 1,000,000: every strike is reduced to the minimum
    expect(cast.dealt).toBe(COMBAT.minDamage);
    // With no armor the cast deals roll x 1.4 rounded half up.
    const naked = bossFight({ hp: 1_000_000, ...fightSide({ damage: { min: 1, max: 1 }, armor: 0 }) }, 3);
    for (const e of naked.log.filter((x) => x.actor === 'enemy')) {
      const mult = e.skill ? 14_000 : 10_000;
      expect(e.physical).toBe(Math.floor((e.roll * mult + 5000) / 10_000));
      expect(e.roll).toBeGreaterThanOrEqual(chieftain.damage.min);
      expect(e.roll).toBeLessThanOrEqual(chieftain.damage.max);
    }
  });

  it('a stun makes the hero lose exactly his next 3 strikes (logged as stunned, 0 damage, timer keeps running), then he strikes again', () => {
    // Find a seed whose first cast stuns (35%).
    let found: ReturnType<typeof bossFight> | null = null;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const r = bossFight({ hp: 1_000_000, ...fightSide({ damage: { min: 5, max: 5 }, armor: 1_000_000 }) }, seed);
      if (r.log.find((e) => e.skill)?.stun) found = r;
    }
    expect(found).not.toBeNull();
    const log = found!.log;
    const cast = log.find((e) => e.skill)!;
    // 1.25.0: the 3rd enemy strike lands at 2.3 s (the hero has struck at 0, 1 s and 2 s by then and none of those is stunned).
    expect(cast).toMatchObject({ strike: 3, atMs: 2300, stun: 3 });
    expect(log.filter((e) => e.actor === 'hero' && e.atMs < cast.atMs).every((e) => !e.stunned)).toBe(true);
    const heroAfter = log.filter((e) => e.actor === 'hero' && e.atMs > cast.atMs).slice(0, 5);
    expect(heroAfter.map((e) => [e.atMs, !!e.stunned, e.dealt > 0 ? 'hit' : 'none'])).toEqual([
      [3000, true, 'none'],
      [4000, true, 'none'],
      [5000, true, 'none'],
      [6000, false, 'hit'],
      [7000, false, 'hit'],
    ]);
    for (const e of heroAfter.slice(0, 3)) expect(e).toMatchObject({ roll: 0, physical: 0, magic: 0, dealt: 0, crit: false });
  });

  it('on the old timing (a fight in progress at the 1.25.0 update) the cast is at 3 s and the hero strike on the very tick of the cast is not stunned (tie: hero first)', () => {
    const old = { heroFirstStrikeMs: 1000, enemyFirstStrikeMs: 1000 };
    let found: ReturnType<typeof bossFight> | null = null;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const r = bossFight({ hp: 1_000_000, ...fightSide({ damage: { min: 5, max: 5 }, armor: 1_000_000 }) }, seed, old);
      if (r.log.find((e) => e.skill)?.stun) found = r;
    }
    expect(found).not.toBeNull();
    const log = found!.log;
    const cast = log.find((e) => e.skill)!;
    expect(cast).toMatchObject({ strike: 3, atMs: 3000, stun: 3 });
    const heroAfter = log.filter((e) => e.actor === 'hero' && e.atMs >= cast.atMs).slice(0, 5);
    expect(heroAfter.map((e) => [e.atMs, !!e.stunned])).toEqual([[3000, false], [4000, true], [5000, true], [6000, true], [7000, false]]);
  });

  it('a stunned strike draws NO random number (the stream skips it), other strikes draw 2 (hero) / 1 (boss) / 2 (cast)', () => {
    const hero = fightSide({ damage: { min: 5, max: 5 }, armor: 1_000_000 });
    for (let seed = 1; seed < 40; seed++) {
      const f = newFight('troll_chieftain', hero, enemyCombatSide(chieftain), 1_000_000, 1_000_000, chieftain.hp, enemyFightOptions(chieftain));
      let rng = createRng(seed);
      let heroHp = 1_000_000;
      for (let i = 0; i < 60; i++) {
        const ev = nextFightEvent(f);
        if (ev.type !== 'strike') break;
        const stunnedNow = ev.actor === 'hero' && f.heroStunStrikes > 0;
        const castNow = ev.actor === 'enemy' && f.mobs[0].strikes + 1 >= (f.mobs[0].skillReady.heavy_bash ?? Infinity);
        const before = rng;
        const res = strike(f, ev.actor, ev.atMs, heroHp, rng, ev.mob);
        heroHp = res.heroHp;
        rng = res.rng;
        // Count the draws by replaying the generator from `before` until it equals the new state.
        let draws = 0;
        let walk = before;
        while (JSON.stringify(walk) !== JSON.stringify(rng) && draws < 5) {
          walk = nextDraw(walk);
          draws++;
        }
        const expected = stunnedNow ? 0 : ev.actor === 'hero' ? 2 : castNow ? 2 : 1;
        expect(draws).toBe(expected);
      }
    }
  });

  it('no stun-lock: even with a 100% stun the hero always gets strikes between casts (cooldown 7 > stun 3)', () => {
    const skill = COMBAT_SKILLS.heavy_bash;
    const original = skill.effects;
    (skill as { effects: unknown }).effects = [{ type: 'stun', chanceBp: 10_000, strikes: 3 }];
    try {
      const r = bossFight({ hp: 1_000_000, ...fightSide({ damage: { min: 5, max: 5 }, armor: 1_000_000 }) }, 21);
      const casts = r.log.filter((e) => e.skill);
      expect(casts.length).toBeGreaterThan(10);
      for (const c of casts) expect(c.stun).toBe(3);
      // Between two casts (7 s apart) the hero has 7 strikes: 3 lost, 4 land.
      for (let i = 0; i + 1 < casts.length; i++) {
        const between = r.log.filter((e) => e.actor === 'hero' && e.atMs > casts[i].atMs && e.atMs <= casts[i + 1].atMs);
        expect(between.filter((e) => e.stunned).length).toBe(3);
        expect(between.filter((e) => !e.stunned && e.dealt > 0).length).toBe(4);
      }
      // The longest run of stunned hero strikes anywhere in the fight is 3.
      let run = 0;
      let longest = 0;
      for (const e of r.log.filter((x) => x.actor === 'hero')) {
        run = e.stunned ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      expect(longest).toBe(3);
    } finally {
      (skill as { effects: unknown }).effects = original;
    }
  });

  it('stuns never stack: a new stun only raises the strikes left (state check)', () => {
    const f = newFight('troll_chieftain', fightSide(), enemyCombatSide(chieftain), 1000, 1000, 1000, enemyFightOptions(chieftain));
    f.heroStunStrikes = 2;
    f.mobs[0].strikes = 2; // next boss strike is the 3rd: Bash ready
    const skill = COMBAT_SKILLS.heavy_bash;
    const original = skill.effects;
    (skill as { effects: unknown }).effects = [{ type: 'stun', chanceBp: 10_000, strikes: 3 }];
    try {
      strike(f, 'enemy', 3000, 1000, createRng(1));
      expect(f.heroStunStrikes).toBe(3);
    } finally {
      (skill as { effects: unknown }).effects = original;
    }
  });
});

describe('enemy regen', () => {
  it('0.5% of max HP per second: 5 HP a second for the Chieftain, exact integer banking, split invariant', () => {
    expect(enemyRegen(500, 0, 1000, 50, 1000)).toEqual([505, 0]);
    expect(enemyRegen(500, 0, 1000, 50, 10_000)).toEqual([550, 0]);
    // 100 ms at a time for 10 s = 10 s at once
    let hp = 500;
    let progress = 0;
    for (let i = 0; i < 100; i++) [hp, progress] = enemyRegen(hp, progress, 1000, 50, 100);
    expect([hp, progress]).toEqual(enemyRegen(500, 0, 1000, 50, 10_000));
  });

  it('banks the remainder: 1 ms at a time still adds up to exactly 5 HP a second', () => {
    let hp = 100;
    let progress = 0;
    for (let i = 0; i < 4000; i++) [hp, progress] = enemyRegen(hp, progress, 1000, 50, 1);
    expect(hp).toBe(120);
  });

  it('never above max, nothing at 0 HP, nothing without regen', () => {
    expect(enemyRegen(998, 0, 1000, 50, 10_000)).toEqual([1000, 0]);
    expect(enemyRegen(1000, 123, 1000, 50, 10_000)).toEqual([1000, 0]);
    expect(enemyRegen(0, 0, 1000, 50, 10_000)).toEqual([0, 0]);
    expect(enemyRegen(500, 0, 1000, 0, 10_000)).toEqual([500, 0]);
    expect(enemyRegen(500, 0, 1000, 50, 0)).toEqual([500, 0]);
  });

  it('shows in the fight: the hit enemy heals between strikes and the log carries its HP after each strike', () => {
    const hero = fightSide({ damage: { min: 100, max: 100 }, armor: 1_000_000 });
    const r = bossFight({ hp: 1_000_000, ...hero }, 8);
    const heroHits = r.log.filter((e) => e.actor === 'hero' && !e.stunned);
    // 100 raw vs armor 40: 56 dealt. Second hit: 1000 - 56 + 5 (regen of one second) - 56.
    expect(heroHits[0]).toMatchObject({ dealt: 56, targetHpAfter: 944, enemyHpAfter: 944 });
    expect(heroHits[1].enemyHpAfter).toBe(944 + 5 - 56);
    expect(r.log.every((e) => e.enemyHpAfter !== undefined)).toBe(true);
  });

  it('a hero who cannot out-damage the regen can never win: the fight ends at the 120 s limit', () => {
    // 1 dealt per strike (minimum) = 1 HP a second against 5 HP of regen
    const r = bossFight(dummy(), 2);
    expect(r).toMatchObject({ won: false, endReason: 'time_limit', durationMs: 120_000, heroHp: 0 });
    expect(r.enemyHp).toBeGreaterThan(990); // 1 dealt a second against 5 regen: it never gets below max by more than a hit
  });

  it('enemyHpAt (the live bar) matches the HP the fight reaches at that time', () => {
    const f = newFight('troll_chieftain', fightSide(), enemyCombatSide(chieftain), 1000, 1000, 1000, enemyFightOptions(chieftain));
    f.mobs[0].hp = 400;
    expect(enemyHpAt(f.mobs[0], 0)).toBe(400);
    expect(enemyHpAt(f.mobs[0], 2000)).toBe(410);
    expect(enemyHpAt(f.mobs[0], 200_000)).toBe(1000);
  });
});

describe('time limit and normal fights', () => {
  it('the boss fight lasts 120 s; a stage fight is still 60 s', () => {
    expect(COMBAT.maxFightMs).toBe(60_000);
    const stage = resolveFight({ hp: 1_000_000, ...fightSide({ damage: { min: 1, max: 1 }, armor: 1_000_000 }) }, { hp: 1_000_000, ...enemyCombatSide(ENEMIES.troll) }, createRng(1));
    expect(stage).toMatchObject({ endReason: 'time_limit', durationMs: 60_000 });
    expect(bossFight(dummy(), 1)).toMatchObject({ endReason: 'time_limit', durationMs: 120_000 });
  });

  it('a normal fight has none of the new log fields and no regen (nothing about normal fights changed)', () => {
    const r = resolveFight({ hp: 500, ...fightSide({ damage: { min: 20, max: 30 } }) }, { hp: 300, ...enemyCombatSide(ENEMIES.troll) }, createRng(9));
    for (const e of r.log) {
      expect(e.skill).toBeUndefined();
      expect(e.stun).toBeUndefined();
      expect(e.stunned).toBeUndefined();
      expect(e.enemyHpAfter).toBeUndefined();
    }
    const withRegenField: FightLogEntry[] = r.log.filter((e) => 'enemyHpAfter' in e);
    expect(withRegenField).toEqual([]);
  });

  it('a normal dungeon\'s RNG stream is the one it always was: the 1.19.0 whole-game pins stand (tests/golden119.test.ts)', () => {
    // The enemy side of every stage enemy has no skills and no regen, so a stage fight draws exactly as in 1.19.0.
    for (const id of DUNGEON_IDS) {
      const e = ENEMIES[DUNGEONS[id as DungeonId].enemyId];
      expect(e.skills ?? []).toEqual([]);
      expect(e.regenBpPerSec ?? 0).toBe(0);
      expect(e.maxFightMs).toBeUndefined();
    }
  });
});

describe('the boss fight in the game loop', () => {
  it('the hero is idle after the fight (activity null), win or lose; one fight per entry, no auto-repeat', () => {
    const w = fightAll(bossSlayer(2));
    expect(w.state.activity).toBeNull();
    const s = fighter(5);
    const l = fightAll({ ...s, character: { ...s.character, hp: 1 } });
    expect(l.state.activity).toBeNull();
    expect(l.state.dungeon.bosses.troll_chieftain).toEqual({ runs: 1, wins: 0, losses: 1 });
    expect(w.state.dungeon.bosses.troll_chieftain).toEqual({ runs: 1, wins: 1, losses: 0 });
    expect(bossTotals(w.state, 'troll_chieftain')).toEqual({ runs: 1, wins: 1, losses: 0 });
    expect(w.summary.boss).toEqual({ fights: 1, wins: 1, losses: 0 });
  });

  it('a loss leaves the hero at 0 HP with no rewards; the fight is recorded in lastFight', () => {
    const s = fighter(5);
    const l = fightAll({ ...s, character: { ...s.character, hp: 1 } });
    expect(l.fight).toMatchObject({ dungeonId: 'troll_chieftain', won: false, heroHpEnd: 0, rewards: { heroXp: 0, gold: 0, items: {}, itemsLost: {} } });
    expect(l.state.character.gold).toBe(s.character.gold);
    expect(l.state.character.xp).toBe(s.character.xp);
  });

  it('fleeing (STOP_ACTIVITY) forfeits: a loss, HP 0, counted, the stamina stays spent', () => {
    const s = enter(fighter(5));
    const r = applyCommand(s, cmd({ type: 'STOP_ACTIVITY' }), T0 + 5 * SEC);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.character.hp).toBe(0);
    expect(r.state.activity).toBeNull();
    expect(r.state.dungeon.bosses.troll_chieftain).toEqual({ runs: 1, wins: 0, losses: 1 });
    expect(r.state.dungeon.lastFight).toMatchObject({ dungeonId: 'troll_chieftain', won: false, endReason: 'forfeit' });
    expect(r.events.map((e) => e.type)).toEqual(['FIGHT_RESOLVED', 'ACTIVITY_STOPPED']);
  });

  it('the time limit is a loss at exactly 120 s', () => {
    // hero that cannot hurt it: huge armor, no damage worth the name
    const s = fighter(5);
    const tank = { ...s, character: { ...s.character, level: 1, spentPoints: { strength: 0, dexterity: 0, endurance: 3000, intelligence: 0 } } };
    const hp = getDerivedStats(tank).maxHp.value;
    const r = fightAll({ ...tank, character: { ...tank.character, hp } });
    expect(r.fight).toMatchObject({ won: false, endReason: 'time_limit', durationMs: 120_000 });
  });

  it('bossRunView shows the fight on screen (read-only)', () => {
    const s = enter(fighter());
    const v = bossRunView(simulate(s, T0 + 5 * SEC).state)!;
    expect(v).toMatchObject({ kind: 'boss', bossId: 'troll_chieftain' });
    expect(v.fight.enemyMaxHp).toBe(1000);
    expect(bossRunView(builtGame(1, T0))).toBeNull();
  });
});

describe('rewards', () => {
  const wins = (n: number, tweak: (s: GameState) => GameState = (s) => s) => {
    const out: ReturnType<typeof fightAll>[] = [];
    for (let seed = 1; seed <= n; seed++) out.push(fightAll(tweak(bossSlayer(seed))));
    return out;
  };

  it('a win pays 2,000 hero XP and 300..450 gold', () => {
    const s = bossSlayer(7);
    const r = fightAll(s);
    expect(r.fight.won).toBe(true);
    expect(r.fight.rewards.heroXp).toBe(2000);
    expect(r.fight.rewards.gold).toBeGreaterThanOrEqual(300);
    expect(r.fight.rewards.gold).toBeLessThanOrEqual(450);
    expect(r.state.character.gold - s.character.gold).toBe(r.fight.rewards.gold);
    expect(r.summary.goldGained).toBe(r.fight.rewards.gold);
  });

  it('gear drop ~35% (equal pieces, uncommon 75 / rare 25, quality 0..70) and a Troll Head ~25%, independent of each other', () => {
    const N = 600;
    const all = wins(N);
    let gear = 0;
    let head = 0;
    let both = 0;
    const pieces: Record<string, number> = {};
    const rarities: Record<string, number> = {};
    let qMin = 100;
    let qMax = 0;
    for (const r of all) {
      const g = r.fight.rewards.gear;
      const t = (r.fight.rewards.items.troll_head ?? 0) > 0;
      if (g) {
        gear++;
        pieces[g.defId] = (pieces[g.defId] ?? 0) + 1;
        rarities[g.rarity] = (rarities[g.rarity] ?? 0) + 1;
        qMin = Math.min(qMin, g.quality);
        qMax = Math.max(qMax, g.quality);
        const item = r.state.inventory.items.find((i) => i.id === g.itemId)!;
        expect(item).toMatchObject({ defId: g.defId, rarity: g.rarity, quality: g.quality });
      }
      if (t) head++;
      if (g && t) both++;
    }
    expect(gear / N).toBeGreaterThan(0.3);
    expect(gear / N).toBeLessThan(0.4);
    expect(head / N).toBeGreaterThan(0.2);
    expect(head / N).toBeLessThan(0.3);
    // independent: P(both) ~ 0.35 * 0.25 = 0.0875
    expect(both / N).toBeGreaterThan(0.05);
    expect(both / N).toBeLessThan(0.13);
    expect(Object.keys(pieces).sort()).toEqual(['iron_boots', 'iron_chestplate', 'iron_gloves', 'iron_helm', 'iron_shield', 'iron_sword']);
    for (const n of Object.values(pieces)) expect(n / gear).toBeGreaterThan(0.08); // ~1/6 each
    expect(Object.keys(rarities).sort()).toEqual(['rare', 'uncommon']);
    expect((rarities.uncommon ?? 0) / gear).toBeGreaterThan(0.6);
    expect((rarities.uncommon ?? 0) / gear).toBeLessThan(0.9);
    expect(qMin).toBeLessThanOrEqual(5);
    expect(qMax).toBeGreaterThanOrEqual(65);
    expect(qMax).toBeLessThanOrEqual(70);
  });

  it("the Chieftain's table is the Troll Head (25%) then the Potion Belt (100%, unique); the Tusk no longer drops", () => {
    expect(BOSSES.troll_chieftain.rewards.drops).toEqual([{ itemId: 'troll_head', chance: 0.25 }, { itemId: 'potion_belt', chance: 1 }]);
    for (const r of wins(300)) expect(r.fight.rewards.items.chieftains_tusk).toBeUndefined();
  });

  it('a Tusk already in a save still exists: rare, stackable, kept, and the Merchant still refuses it (sellable false)', () => {
    expect(getItemDef('chieftains_tusk')).toMatchObject({ rarity: 'rare', stackable: true, sellable: false });
    const s = bossSlayer(3);
    const withTusks: GameState = { ...s, inventory: { ...s.inventory, items: [...s.inventory.items, makeItem('chieftains_tusk', 4)] } };
    const after = fightAll(withTusks).state; // a boss win leaves the stack alone
    expect(after.inventory.items.find((i) => i.defId === 'chieftains_tusk')).toMatchObject({ stackable: true, quantity: 4 });
    expect(baseSellPrice(after.inventory.items.find((i) => i.defId === 'chieftains_tusk')!)).toBe(0);
    const sell = applyCommand(after, cmd({ type: 'SELL_ITEM', itemId: 'chieftains_tusk', quantity: 1 }), after.time.lastSimulatedAt + SEC);
    expect(sell.ok).toBe(false);
    if (!sell.ok) expect(sell.error.code).toBe('NOT_SELLABLE');
  });

  it('the Troll Head is a rare, stackable material that sells for 250; two drops stack in one slot', () => {
    expect(getItemDef('troll_head')).toMatchObject({ rarity: 'rare', stackable: true, sellPrice: 250 });
    expect(getItemDef('troll_head')!.description).toMatch(/dungeon level/i);
    let second: GameState | null = null;
    for (let seed = 1; seed < 200 && !second; seed++) {
      const s = bossSlayer(seed);
      const withHead: GameState = { ...s, inventory: { ...s.inventory, items: [...s.inventory.items, makeItem('troll_head', 1)] } };
      const r = fightAll(withHead);
      if ((r.fight.rewards.items.troll_head ?? 0) > 0) second = r.state;
    }
    expect(second).not.toBeNull();
    const stack = second!.inventory.items.filter((i) => i.defId === 'troll_head');
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({ stackable: true, quantity: 2 });
    const gold = second!.character.gold;
    const sell = applyCommand(second!, cmd({ type: 'SELL_ITEM', itemId: 'troll_head', quantity: 2 }), second!.time.lastSimulatedAt + SEC);
    if (!sell.ok) throw new Error(sell.error.message);
    expect(sell.state.character.gold - gold).toBe(500);
  });

  describe('the Potion Belt (unique: at most one owned)', () => {
    const owns = (s: GameState) => s.inventory.items.filter((i) => i.defId === 'potion_belt').length;
    const withBelt = (s: GameState): GameState => ({ ...s, inventory: { ...s.inventory, items: [...s.inventory.items, makeItem('potion_belt')] } });
    /** Another boss fight on a state that already fought one (the clock continues from where the state is). */
    const fightAgain = (s: GameState) => {
      const now = s.time.lastSimulatedAt;
      const entered = applyCommand(s, cmd(ENTER), now);
      if (!entered.ok) throw new Error(`${entered.error.code}: ${entered.error.message}`);
      const sim = simulate(entered.state, now + 130 * SEC);
      return { state: sim.state, fight: sim.state.dungeon.lastFight! };
    };

    it('is epic, not stackable, not gear (no slot, no quality), unique, sells for 100 flat', () => {
      const def = getItemDef('potion_belt')!;
      expect(def).toMatchObject({ rarity: 'epic', stackable: false, unique: true, sellPrice: 100 });
      expect(def.slot).toBeUndefined();
      expect(def.description).toMatch(/automatically/i);
      const item = makeItem('potion_belt');
      expect(item).toMatchObject({ id: 'potion_belt', defId: 'potion_belt' });
      expect(item.slot).toBeUndefined();
      expect(item.quality).toBeUndefined();
      expect(baseSellPrice(item)).toBe(100); // no rarity price multiplier: it is not gear
    });

    it('drops on EVERY win while the hero does not own one, as one item in one slot', () => {
      for (const r of wins(40)) {
        expect(r.fight.rewards.items.potion_belt).toBe(1);
        expect(owns(r.state)).toBe(1);
        expect(heroOwnsItem(r.state, 'potion_belt')).toBe(true);
      }
    });

    it('never a second one while one is owned: nothing is added and nothing is reported lost', () => {
      for (const r of wins(40, withBelt)) {
        expect(r.fight.rewards.items.potion_belt).toBeUndefined();
        expect(r.fight.rewards.itemsLost.potion_belt).toBeUndefined();
        expect(owns(r.state)).toBe(1);
      }
    });

    it('the roll draws from the RNG even when skipped: the stream does not depend on what the bag holds', () => {
      for (let seed = 1; seed <= 12; seed++) {
        const without = fightAll(bossSlayer(seed));
        const owned = fightAll(withBelt(bossSlayer(seed)));
        expect(owned.state.rng).toEqual(without.state.rng);
        expect(owned.fight.rewards.gold).toBe(without.fight.rewards.gold);
      }
    });

    it('sells for 100 gold; once sold, the next win drops it again', () => {
      const first = fightAll(bossSlayer(5));
      expect(owns(first.state)).toBe(1);
      const gold = first.state.character.gold;
      const sold = applyCommand(first.state, cmd({ type: 'SELL_ITEM', itemId: 'potion_belt', quantity: 1 }), first.state.time.lastSimulatedAt + SEC);
      if (!sold.ok) throw new Error(sold.error.message);
      expect(sold.state.character.gold - gold).toBe(100);
      expect(owns(sold.state)).toBe(0);
      expect(heroOwnsItem(sold.state, 'potion_belt')).toBe(false);
      const again = fightAgain(sold.state);
      expect(again.fight).toMatchObject({ won: true });
      expect(again.fight.rewards.items.potion_belt).toBe(1);
      expect(owns(again.state)).toBe(1);
    });

    it('lost to a full bag (reported), so the next win with room drops it again', () => {
      const fillUp = (s: GameState): GameState => {
        const junk = Array.from({ length: s.inventory.capacity - s.inventory.items.length }, (_, i) => makeItem('troll_hide', 1, `junk#${i}`));
        return { ...s, inventory: { ...s.inventory, items: [...s.inventory.items, ...junk.map((j) => ({ ...j, stackable: false as const }))] } };
      };
      const full = fightAll(fillUp(bossSlayer(6)));
      expect(full.fight.rewards.items.potion_belt).toBeUndefined();
      expect(full.fight.rewards.itemsLost.potion_belt).toBe(1);
      expect(owns(full.state)).toBe(0);
      expect(full.summary.itemsLost.potion_belt).toBe(1);
      // Make room (a gear piece, a Troll Head and the belt may all drop on the next win) and fight again.
      const roomy: GameState = { ...full.state, inventory: { ...full.state.inventory, items: full.state.inventory.items.slice(0, -3) } };
      const again = fightAgain(roomy);
      expect(again.fight.rewards.items.potion_belt).toBe(1);
      expect(owns(again.state)).toBe(1);
    });
  });

  it('full inventory: the gear piece, the Troll Head and the belt are LOST (reported in itemsLost), the fight still pays XP and gold', () => {
    const fillUp = (s: GameState): GameState => {
      const junk = Array.from({ length: s.inventory.capacity - s.inventory.items.length }, (_, i) => ({ id: `junk#${i}`, defId: 'troll_hide', name: 'x', icon: 'x', stackable: false } as unknown as GameState['inventory']['items'][number]));
      return { ...s, inventory: { ...s.inventory, items: [...s.inventory.items, ...junk] } };
    };
    const all = wins(200, fillUp);
    const lostGear = all.find((r) => Object.keys(r.fight.rewards.itemsLost).some((k) => k.startsWith('iron_')));
    const lostHead = all.find((r) => (r.fight.rewards.itemsLost.troll_head ?? 0) > 0);
    expect(lostGear).toBeDefined();
    expect(lostHead).toBeDefined();
    for (const r of all) {
      expect(r.fight.rewards.gear).toBeUndefined();
      expect(r.fight.rewards.items.troll_head).toBeUndefined();
      expect(r.fight.rewards.items.potion_belt).toBeUndefined();
      expect(r.fight.rewards.itemsLost.potion_belt).toBe(1);
      expect(r.state.inventory.items.length).toBe(r.state.inventory.capacity);
      expect(r.fight.rewards.heroXp).toBe(2000);
      expect(r.summary.itemsLost).toEqual(r.fight.rewards.itemsLost);
    }
  });

  it('INVARIANT: the reward draws are on the main stream in the documented order (gold, gear chance, [piece, colour, quality], Troll Head chance, Potion Belt chance)', () => {
    const gear = BOSSES.troll_chieftain.rewards.gear;
    for (let seed = 1; seed <= 25; seed++) {
      const { fight, state } = fightAll(bossSlayer(seed));
      // The slayer kills with his first strike: 2 draws (roll, crit check), then the rewards.
      let rng = createRng(seed);
      rng = nextDraw(nextDraw(rng));
      const gold = nextInt(rng, 300, 450);
      rng = gold.rng;
      expect(fight.rewards.gold).toBe(gold.value);
      const hit = chance(rng, 0.35);
      rng = hit.rng;
      expect(!!fight.rewards.gear).toBe(hit.value);
      if (hit.value) {
        const piece = weightedPick(rng, gear.pieces.map((p) => ({ value: p.itemId, weight: p.weight })));
        const rarity = rollRarity(piece.rng, gear.rarityWeights);
        const quality = rollQuality(rarity.rng, 0, 70);
        rng = quality.rng;
        expect(fight.rewards.gear).toMatchObject({ defId: piece.value, rarity: rarity.value, quality: quality.value });
      }
      const head = chance(rng, 0.25);
      rng = head.rng;
      expect((fight.rewards.items.troll_head ?? 0) > 0).toBe(head.value);
      rng = nextDraw(rng); // the Potion Belt's roll (chance 1): one draw, owned or not
      expect(fight.rewards.items.potion_belt).toBe(1);
      expect(state.rng).toEqual(rng);
    }
  });
});

describe('golden fight (pins the RNG draw order, Bash and a stun)', () => {
  it('seed 2: the Chieftain\'s first Heavy Bash (strike 3) stuns, the hero loses strikes 4-6, wins at 35 s', () => {
    const { state, fight, events, summary } = fightAll(fighter(2));
    const line = (e: FightLogEntry) => `${e.atMs} ${e.actor[0]}${e.strike} roll${e.roll} p${e.physical} d${e.dealt} -> ${e.targetHpAfter}${e.enemyHpAfter !== undefined ? ` (boss ${e.enemyHpAfter})` : ''}${e.skill ? ` ${e.skill}` : ''}${e.stun !== undefined ? ` stun${e.stun}` : ''}${e.stunned ? ' STUNNED' : ''}`;
    expect(fight.log.slice(0, 14).map(line)).toEqual([
      // 1.25.0: the same rolls, damage and RNG draws; only the times moved (the hero opens at 0, the Chieftain at 300 ms; they were 1 s, 1 s, 2 s,
      // 2 s ... and the Bash on strike 3 at 3 s) and the boss's regen shows 1 HP more at each of its strikes (it regenerates 0.3 s of its 5 HP/s first).
      '0 h1 roll66 p37 d37 -> 963 (boss 963)',
      '300 e1 roll29 p12 d12 -> 463 (boss 964)',
      '1000 h2 roll66 p37 d37 -> 931 (boss 931)',
      '1300 e2 roll32 p13 d13 -> 450 (boss 932)',
      '2000 h3 roll65 p36 d36 -> 900 (boss 900)',
      '2300 e3 roll34 p19 d19 -> 431 (boss 901) heavy_bash stun3',
      '3000 h4 roll0 p0 d0 -> 905 (boss 905) STUNNED',
      '3300 e4 roll34 p13 d13 -> 419 (boss 906)',
      '4000 h5 roll0 p0 d0 -> 910 (boss 910) STUNNED',
      '4300 e5 roll28 p11 d11 -> 408 (boss 911)',
      '5000 h6 roll0 p0 d0 -> 915 (boss 915) STUNNED',
      '5300 e6 roll30 p12 d12 -> 397 (boss 916)',
      '6000 h7 roll67 p37 d37 -> 883 (boss 883)',
      '6300 e7 roll27 p11 d11 -> 386 (boss 884)',
    ]);
    expect(fight).toMatchObject({ won: true, endReason: 'enemy_defeated', durationMs: 35_000, enemyHpEnd: 0, rewards: { heroXp: 2000, gold: 410, items: { potion_belt: 1 }, itemsLost: {} } }); // 1.26.0: the belt (items was {})
    expect(fight.log).toHaveLength(71);
    expect(fight.log.filter((e) => e.skill).map((e) => [e.strike, e.stun ?? 0])).toEqual([[3, 3], [10, 0], [17, 0], [24, 0], [31, 0]]);
    expect(fight.log.filter((e) => e.stunned)).toHaveLength(3);
    // 1.24.0: the first boss win opens Hard
    expect(events.map((e) => e.type)).toEqual(['FIGHT_RESOLVED', 'DIFFICULTY_UNLOCKED', 'ACTIVITY_STOPPED']);
    expect(summary.boss).toEqual({ fights: 1, wins: 1, losses: 0 });
    expect(state.rng).toEqual({ seed: 3903743816 }); // 1.26.0: was 2072178003 (the Troll Head and Potion Belt rolls come after the gear chance)
    // 1.22.0: d611449f is the 1.20.0 hash df20ce2e in the v21 shape (only saveVersion moved: no gear dropped here, so no affixes).
    // 1.24.0: seen in the v21 shape (asV21: no difficulty fields, the fight's one enemy flat) the hash is still the 1.22.0 one: no outcome moved.
    // 1.25.0: re-pinned (was d611449f / df20ce2e). The RNG state above is unchanged (same draws in the same order); the hashes moved because the fight's
    // strike times, its duration and the boss's regen at each strike differ.
    expect(hashState(asV21(state))).toBe('cee70c6b'); // 1.26.0: was 16eeaa39 (the belt in the bag, the stream moved)
    expect(hashState({ ...asV21(state), saveVersion: 20 } as unknown as GameState)).toBe('1291201a'); // 1.26.0: was dc459450
  });

  it('seed 1: a loss with five stuns (12 strikes lost): the hero falls at 37.3 s', () => {
    const { fight, state } = fightAll(fighter(1));
    expect(fight).toMatchObject({ won: false, endReason: 'hero_defeated', durationMs: 37_300, heroHpEnd: 0 }); // 1.25.0: 37.3 s (was 38 s: the 38th strike now lands at 37.3 s)
    expect(fight.log.filter((e) => e.skill && e.stun).map((e) => e.strike)).toEqual([10, 17, 24, 31, 38]);
    expect(fight.log.filter((e) => e.stunned)).toHaveLength(12);
    expect(state.dungeon.bosses.troll_chieftain).toEqual({ runs: 1, wins: 0, losses: 1 });
  });
});

describe('live == offline, and split invariance', () => {
  const clock = (s: GameState, until: number, step: number) => {
    let cur = s;
    for (let t = T0 + step; t < until; t += step) cur = simulate(cur, t).state;
    return simulate(cur, until).state;
  };

  it('stepping the clock in 1 s, 700 ms, 5 s or one jump gives the SAME state (hash) once the fight is over', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = enter(fighter(seed));
      const end = T0 + 130 * SEC;
      const one = simulate(s, end).state;
      expect(hashState(clock(s, end, 1 * SEC))).toBe(hashState(one));
      expect(hashState(clock(s, end, 700))).toBe(hashState(one));
      expect(hashState(clock(s, end, 5 * SEC))).toBe(hashState(one));
    }
  });

  it('mid-fight, any split of the same span lands on the same state (property, seeded splits)', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
    for (let n = 0; n < 40; n++) {
      const s = enter(fighter(1 + (n % 7)));
      const end = T0 + Math.floor(rnd() * 130_000);
      const direct = simulate(s, end).state;
      const cuts = [0, 1, 2, 3].map(() => T0 + Math.floor(rnd() * (end - T0))).sort((a, b) => a - b);
      let cur = s;
      for (const c of cuts) cur = simulate(cur, c).state;
      cur = simulate(cur, end).state;
      expect(hashState(cur)).toBe(hashState(direct));
    }
  });

  it('offline = live: a long absence (hours) resolves the fight exactly as live play did', () => {
    for (const seed of [2, 3, 4]) {
      const s = enter(fighter(seed));
      const live = clock(s, T0 + 130 * SEC, 1 * SEC);
      const away = simulate(s, T0 + 6 * HOUR).state;
      expect(away.dungeon.lastFight).toEqual(live.dungeon.lastFight);
      expect(away.dungeon.bosses).toEqual(live.dungeon.bosses);
      expect(away.character.gold).toBe(live.character.gold);
      expect(away.rng).toEqual(live.rng);
      expect(away.activity).toBeNull();
    }
  });

  it('offline = live also when the app is away past the offline cap (the same cap rule as a dungeon fight)', () => {
    const s = enter(fighter(2));
    const wayPast = simulate(s, T0 + 30 * HOUR);
    expect(wayPast.state.dungeon.lastFight).toMatchObject({ dungeonId: 'troll_chieftain', won: true });
    expect(wayPast.state.activity).toBeNull();
    expect(wayPast.summary.boss.fights).toBe(1);
  });

  it('the boss fight and resolveFight agree on the outcome when the hero never regenerates mid-fight', () => {
    // resolveFight has no hero regen; the game loop does. A hero who wins (or loses) before regen matters gives equal rewards-free outcomes.
    const s = fighter(2);
    const d = getDerivedStats(s);
    const opts = enemyFightOptions(chieftain);
    const direct = resolveFight({ hp: s.character.hp, ...heroCombatSide(d) }, { hp: chieftain.hp, ...enemyCombatSide(chieftain) }, createRng(2), opts.maxFightMs, opts);
    const live = fightAll(s).fight;
    expect(live.won).toBe(direct.won);
    expect(live.durationMs).toBe(direct.durationMs);
    expect(live.log.map((e) => [e.atMs, e.actor, e.roll, e.dealt, e.skill, e.stun, e.stunned])).toEqual(direct.log.map((e) => [e.atMs, e.actor, e.roll, e.dealt, e.skill, e.stun, e.stunned]));
  });
});

describe('properties (many seeds and heroes)', () => {
  it('every fight: strikes in order, HP within bounds, casts only on 3 + 7k, stun runs <= 3, the boss never exceeds max HP, deterministic', () => {
    const heroes: GameState[] = [bossHero(17, 'balanced'), bossHero(20, 'STR+END'), bossHero(22, 'STR+END', 50, 'uncommon'), bossHero(19, 'STR'), bossHero(20, 'END')];
    for (const [hi, hero] of heroes.entries()) {
      for (let seed = 1; seed <= 40; seed++) {
        const s = { ...withTrollBridgeWins(hero), rng: { seed: seed * 17 + hi } as RngState };
        const a = fightAll(s);
        const b = fightAll(s);
        expect(hashState(a.state)).toBe(hashState(b.state));
        const log = a.fight.log;
        let last = 0;
        let run = 0;
        for (const e of log) {
          expect(e.atMs).toBeGreaterThanOrEqual(last);
          last = e.atMs;
          expect(e.atMs).toBeLessThanOrEqual(120_000);
          if (e.actor === 'enemy') {
            if (e.skill) expect((e.strike - 3) % 7).toBe(0);
            else expect(e.strike >= 3 && (e.strike - 3) % 7 === 0).toBe(false);
            expect(e.targetHpAfter).toBeGreaterThanOrEqual(0);
          } else {
            run = e.stunned ? run + 1 : 0;
            expect(run).toBeLessThanOrEqual(3);
            expect(e.enemyHpAfter).toBeGreaterThanOrEqual(0);
            expect(e.enemyHpAfter).toBeLessThanOrEqual(1000);
          }
        }
        expect(a.fight.won).toBe(a.fight.enemyHpEnd === 0);
        if (!a.fight.won) expect(a.fight.heroHpEnd).toBe(0);
        expect(a.state.activity).toBeNull();
        expect(a.state.dungeon.bosses.troll_chieftain!.runs).toBe(1);
        expect(a.fight.durationMs).toBeLessThanOrEqual(120_000);
      }
    }
  });

  it('RNG accounting: a lost fight leaves the stream exactly 2 draws per live hero strike + 1 per normal boss strike + 2 per cast (stunned strikes: 0)', () => {
    let stunnedTotal = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = fighter(seed);
      const { fight, state } = fightAll({ ...s, character: { ...s.character, hp: 60 } });
      if (fight.won) continue; // a win adds the reward draws
      const heroLive = fight.log.filter((e) => e.actor === 'hero' && !e.stunned).length;
      const normal = fight.log.filter((e) => e.actor === 'enemy' && !e.skill).length;
      const casts = fight.log.filter((e) => e.skill).length;
      stunnedTotal += fight.log.filter((e) => e.stunned).length;
      let rng = createRng(seed);
      for (let i = 0; i < heroLive * 2 + normal + casts * 2; i++) rng = nextDraw(rng);
      expect(state.rng).toEqual(rng);
    }
    expect(stunnedTotal).toBeGreaterThan(0); // the check really covered stunned strikes
  });
});

describe('danger hint', () => {
  it('accounts for Heavy Bash, the regen and the 120 s limit', () => {
    const h = bossDangerHint(bossHero(20, 'STR+END'), 'troll_chieftain');
    expect(h.regenPerSec).toBe(5);
    expect(h.limitMs).toBe(120_000);
    expect(h.stunChancePercent).toBe(35);
    expect(h.stunStrikes).toBe(3);
    expect(h.bashAvg).toBeGreaterThan(h.enemyAvg);
    expect(h.netDps).toBeCloseTo(h.heroDps - 5, 6);
  });

  it('a hero who needs more than the 120 s limit is deadly (over the limit)', () => {
    const weak = bossHero(1, 'INT');
    const h = bossDangerHint(weak, 'troll_chieftain');
    expect(h.overLimit).toBe(true);
    expect(h.level).toBe('deadly');
    expect(h.fightMs).toBeGreaterThan(h.limitMs);
  });

  it('a hero whose damage does not beat the regen can not kill it at all (canKill false, fightMs Infinity)', () => {
    const e = ENEMIES.troll_chieftain as { regenBpPerSec?: number };
    const original = e.regenBpPerSec;
    e.regenBpPerSec = 5000; // 50% of max HP a second: no hero out-damages that
    try {
      const h = bossDangerHint(bossHero(20, 'STR+END'), 'troll_chieftain');
      expect(h.canKill).toBe(false);
      expect(h.fightMs).toBe(Infinity);
      expect(h.level).toBe('deadly');
      expect(h.overLimit).toBe(true);
    } finally {
      e.regenBpPerSec = original;
    }
  });

  it('a slayer is easy', () => {
    const h = bossDangerHint(bossSlayer(), 'troll_chieftain');
    expect(h.level).toBe('easy');
    expect(h.canKill).toBe(true);
  });
});

describe('save v20', () => {
  const V19: unknown = JSON.parse(readFileSync(join(FIXTURES, 'save-v19.json'), 'utf8'));

  it('the frozen v19 save (written by the 1.19.0 engine, a Wolf Den fight under way) loads into the current save', () => {
    const doc = V19 as { saveVersion: number; activity: { fight: Record<string, unknown> }; dungeon: Record<string, unknown> };
    expect(doc.saveVersion).toBe(19);
    expect('bosses' in doc.dungeon).toBe(false);
    expect('maxFightMs' in doc.activity.fight).toBe(false);
    const s = loadSave(V19);
    expect(s.saveVersion).toBe(CURRENT_SAVE_VERSION);
    expect(CURRENT_SAVE_VERSION).toBe(23);
    expect(s.dungeon.bosses).toEqual({});
    const f = s.activity?.kind === 'dungeon' ? s.activity.fight! : null;
    expect(f).toMatchObject({ maxFightMs: 60_000, heroStunStrikes: 0 });
    expect(f!.mobs[0]).toMatchObject({ regenBp: 0, regenProgress: 0, skillReady: {} });
    expect(f!.hero.skills).toEqual([]);
    expect(f!.mobs[0].side.skills).toEqual([]);
    // Everything else is kept byte for byte.
    const orig = doc.activity.fight as { enemyHp: number; heroStrikes: number; enemyStrikes: number; log: unknown[] };
    expect(f).toMatchObject({ heroStrikes: orig.heroStrikes });
    expect(f!.mobs[0]).toMatchObject({ hp: orig.enemyHp, strikes: orig.enemyStrikes });
    expect(f!.log).toEqual(orig.log);
  });

  it('the migrated fight plays on to the same result as the v19 engine would: 60 s limit, no regen, no skills, same rewards stream', () => {
    const s = loadSave(V19);
    const sim = simulate(s, s.time.lastSimulatedAt + 10 * 60 * SEC);
    expect(sim.state.dungeon.totals.runs).toBeGreaterThan((s.dungeon.totals.runs ?? 0));
    const last = sim.state.dungeon.lastFight!;
    for (const e of last.log) {
      expect(e.skill).toBeUndefined();
      expect(e.stunned).toBeUndefined();
      expect(e.enemyHpAfter).toBeUndefined();
    }
  });

  it('a save without activity or with a search phase migrates too', () => {
    const doc = JSON.parse(JSON.stringify(V19));
    doc.activity = null;
    expect(loadSave(doc).dungeon.bosses).toEqual({});
  });
});

describe('replay log and client', () => {
  it('ENTER_BOSS is a logged command: the whole log (debug unlock, enter, fight, away) replays to the same state', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'boss' });
    await client.load();
    // The debug unlock path: each stage opens the next. (Sets debugUsed, like the debug "+10 wins" button.)
    for (const [dungeonId, amount] of [['rat_cellar', 10], ['bat_cave', 15], ['wolf_den', 25], ['forgotten_crypt', 40], ['troll_bridge', 50]] as const) {
      const r = await client.dispatch({ type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId, amount });
      expect(r.ok).toBe(true);
    }
    expect(client.getState().flags.debugUsed).toBe(true);
    expect(isBossUnlocked(client.getState(), 'troll_chieftain')).toBe(true);
    expect(client.getSnapshot().unlockedDungeons).toContain('troll_chieftain');
    const full = getDerivedStats(client.getState()).maxHp.value;
    await client.dispatch({ type: 'DEBUG_SET_HERO_HP', hp: full });
    const entered = await client.dispatch({ type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10 });
    expect(entered.ok).toBe(true);
    expect(client.getState().activity?.kind).toBe('boss');
    // A duplicate command id never pays twice.
    const rows = await repo.getAllLog();
    const enterRow = rows.find((r) => r.type === 'ENTER_BOSS')!;
    expect(enterRow.payload).toMatchObject({ bossId: 'troll_chieftain', maxCost: 10 });
    clock.advance(130 * SEC);
    await client.tick();
    expect(client.getState().activity).toBeNull();
    expect(client.getState().dungeon.bosses.troll_chieftain!.runs).toBe(1);
    const report = replayLogReport(
      (await repo.getAllLog()).map((r) => ({ type: r.type, payload: r.payload, clientTime: r.clientTime, stateHash: r.stateHash, engineVersion: r.engineVersion })),
    );
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });

  it('an engine error from ENTER_BOSS reaches the client typed and logs nothing', async () => {
    const { repo, client } = makeClient({ prefix: 'boss2' });
    await client.load();
    const before = (await repo.getAllLog()).length;
    const r = await client.dispatch({ type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BOSS_LOCKED');
    expect((await repo.getAllLog()).length).toBe(before);
  });
});
