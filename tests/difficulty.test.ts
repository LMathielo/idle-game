// Difficulties and pack fights (engine 1.24.0, save v22): the unlock rules (Hard / Extreme, stage gating, the scaled boss unlock),
// SET_DUNGEON_DIFFICULTY and the other command validation, per-difficulty counters, the data and the one rounding rule, the pack roll
// (size and variant distributions, the fixed draw order), pack combat (targeting, tie order, no overkill, the 60 s limit), rewards on a
// full clear only (per-mob scaling and draw order), the scaled boss (stats, rewards, rarity weights), the danger hint for packs, live ==
// offline == any split, the offline cap, a golden Hard fight and a golden Extreme fight. The balance numbers are NOT pinned here
// (tests/balanceSimDifficulty.test.ts reports them); the rules are.
import { describe, expect, it } from 'vitest';
import {
  type ActiveFight,
  applyCommand,
  BOSSES,
  bossEnemyAt,
  COMBAT,
  bossUnlockWins,
  type Difficulty,
  DIFFICULTIES,
  DIFFICULTY,
  difficultyLockReason,
  difficultyViews,
  dungeonRunView,
  dungeonUnlockView,
  DUNGEONS,
  ENEMIES,
  ENEMY_VARIANTS,
  type EnemyId,
  type GameState,
  getDerivedStats,
  isDungeonUnlocked,
  mobName,
  mobTypes,
  packSizeRange,
  bossRewardsAt,
  scaledEnemy,
  scaleStat,
  searchMsFor,
  selectedDifficulty,
  simulate,
} from '../src/engine';
import { bossHero, builtGame, cmd, MIN, SEC, T0 } from './helpers';

// ---------- helpers ----------

const tb = (wins: number) => ({ runs: wins, wins, losses: 0 });
/** Every Normal stage open (the Troll Bridge too), as the unlock chain leaves it. */
const CHAIN = { rat_cellar: tb(10), bat_cave: tb(15), wolf_den: tb(25), forgotten_crypt: tb(40), troll_bridge: tb(50) };

/**
 * A strong hero (Lv 25, STR+END, the Iron set at quality 50) whose Normal stages are all open. `open` says how far the difficulties are
 * unlocked: 'normal' = none, 'hard' = the Normal boss was killed once, 'extreme' = the Hard boss was killed once too.
 */
function heroGame(open: Difficulty = 'normal', level = 25): GameState {
  const h = bossHero(level, 'STR+END', 50, 'uncommon');
  const s = structuredClone(h);
  s.dungeon.byDungeon = { ...CHAIN };
  s.dungeon.totals = { runs: 140, wins: 140, losses: 0 };
  if (open !== 'normal') s.dungeon.bosses = { troll_chieftain: tb(1) };
  if (open === 'extreme') s.dungeon.harder.hard.bosses = { troll_chieftain: tb(1) };
  return s;
}

function ok(s: GameState, c: Parameters<typeof cmd>[0], now = T0): GameState {
  const r = applyCommand(s, cmd(c), now);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
}

function errorOf(s: GameState, c: Parameters<typeof cmd>[0], now = T0): { code: string; message: string } {
  const r = applyCommand(s, cmd(c), now);
  if (r.ok) throw new Error('expected an error');
  return r.error;
}

const fightOf = (s: GameState): ActiveFight | null => (s.activity?.kind === 'dungeon' || s.activity?.kind === 'boss' ? s.activity.fight : null);

/** Runs `id` on `difficulty` from T0 and plays to the instant its search ends: the fight has just begun (no strike yet). */
function atFightStart(s: GameState, id: keyof typeof DUNGEONS, difficulty: Difficulty): { before: GameState; at: GameState } {
  const started = ok(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: id, difficulty });
  const end = T0 + searchMsFor(id, started);
  return { before: simulate(started, end - 1).state, at: simulate(started, end).state };
}

// ---------- data and the rounding rule ----------

describe('difficulty data (config/difficulty.ts)', () => {
  it('the three difficulties, the owner-approved numbers (2026-11-06)', () => {
    expect(DIFFICULTIES).toEqual(['normal', 'hard', 'extreme']);
    expect(DIFFICULTY.normal).toMatchObject({ unlockedBy: null, pack: null, unlockScale: 1, boss: { statBp: 10_000, rewardBp: 10_000, rarityWeights: null } });
    expect(DIFFICULTY.hard.pack).toEqual({ size: { min: 1, max: 4 }, base: { variant: 'base', bp: 20_000 }, upgrade: { variant: 'veteran', bp: 30_000, chanceBp: 2500 } });
    expect(DIFFICULTY.extreme.pack).toEqual({ size: { min: 7, max: 10 }, base: { variant: 'veteran', bp: 120_000 }, upgrade: { variant: 'extreme', bp: 160_000, chanceBp: 2500 } });
    expect(DIFFICULTY.hard.unlockedBy).toBe('normal');
    expect(DIFFICULTY.extreme.unlockedBy).toBe('hard');
    expect(DIFFICULTY.hard.boss).toMatchObject({ statBp: 20_000, rewardBp: 20_000 });
    expect(DIFFICULTY.hard.unlockScale).toBe(2);
    expect(bossUnlockWins('troll_chieftain', 'hard')).toBe(100); // 50 x 2, from the one scale
    expect(DIFFICULTY.extreme.boss).toMatchObject({ statBp: 80_000, rewardBp: 80_000 });
    expect(DIFFICULTY.extreme.unlockScale).toBe(8);
    expect(bossUnlockWins('troll_chieftain', 'extreme')).toBe(400); // 50 x 8
    expect(bossUnlockWins('troll_chieftain', 'normal')).toBe(50);
    expect(DIFFICULTY.hard.boss.rarityWeights).toEqual([{ value: 'rare', weight: 75 }, { value: 'epic', weight: 25 }]); // blue 75 / purple 25
    expect(DIFFICULTY.extreme.boss.rarityWeights).toEqual([{ value: 'rare', weight: 25 }, { value: 'epic', weight: 75 }]); // blue 25 / purple 75
    // Normal keeps the boss's own table (green 75 / blue 25) and its 50 Troll Bridge wins.
    expect(BOSSES.troll_chieftain.rewards.gear.rarityWeights).toEqual([{ value: 'uncommon', weight: 75 }, { value: 'rare', weight: 25 }]);
    expect(BOSSES.troll_chieftain.unlock).toEqual({ dungeonId: 'troll_bridge', wins: 50 });
  });

  it('every multiplier is an integer in basis points and follows the product rule (x2 / x3 = 2 x 1.5; x12 = 8 x 1.5 / x16 = 8 x 2)', () => {
    for (const d of DIFFICULTIES) {
      const rule = DIFFICULTY[d].pack;
      for (const bp of rule ? [rule.base.bp, rule.upgrade.bp, rule.upgrade.chanceBp] : []) expect(Number.isInteger(bp)).toBe(true);
      expect(Number.isInteger(DIFFICULTY[d].boss.statBp)).toBe(true);
    }
    expect((DIFFICULTY.hard.pack!.upgrade.bp * 2) / 3).toBe(DIFFICULTY.hard.pack!.base.bp); // veteran = base x 1.5
    expect(DIFFICULTY.extreme.pack!.base.bp).toBe(8 * 1.5 * 10_000);
    expect(DIFFICULTY.extreme.pack!.upgrade.bp).toBe(8 * 2 * 10_000);
  });

  it('the fight time limit is 60 s whatever the difficulty or the pack (never scaled); the Normal boss is 120 s', () => {
    expect(COMBAT.maxFightMs).toBe(60_000);
    for (const d of ['hard', 'extreme'] as const) {
      const { at } = atFightStart(heroGame('extreme'), 'rat_cellar', d);
      expect(fightOf(at)!.maxFightMs).toBe(60_000);
    }
  });
});

describe('scaling and the one rounding rule (half up, integers)', () => {
  it('scaleStat = floor((value x bp + 5000) / 10000)', () => {
    expect(scaleStat(30, 10_000)).toBe(30); // the identity
    expect(scaleStat(30, 20_000)).toBe(60);
    expect(scaleStat(7, 5_000)).toBe(4); // 3.5 rounds up
    expect(scaleStat(7, 4_999)).toBe(3); // 3.4993 rounds down
    expect(scaleStat(15, 25_000)).toBe(38); // 37.5
    expect(scaleStat(1, 4_999)).toBe(0);
    expect(scaleStat(3, 30_000)).toBe(9);
    expect(scaleStat(5, 12_500)).toBe(6); // 6.25 -> 6
    expect(scaleStat(5, 13_000)).toBe(7); // 6.5 -> 7
  });

  it('HP, damage min / max, armor and magic resist scale; the attack interval, regen and skills do not', () => {
    const troll = ENEMIES.troll;
    expect(scaledEnemy(troll, 10_000)).toBe(troll); // Normal is the very same object: nothing to round
    expect(scaledEnemy(troll, 20_000)).toMatchObject({ hp: 600, damage: { min: 44, max: 60 }, armor: 60, magicResist: 60, attackIntervalMs: 1000 }); // Hard Troll
    expect(scaledEnemy(troll, 30_000)).toMatchObject({ hp: 900, damage: { min: 66, max: 90 }, armor: 90, magicResist: 90 }); // Hard Veteran
    expect(scaledEnemy(troll, 120_000)).toMatchObject({ hp: 3600, damage: { min: 264, max: 360 }, armor: 360, magicResist: 360 }); // Extreme Veteran
    expect(scaledEnemy(troll, 160_000)).toMatchObject({ hp: 4800, damage: { min: 352, max: 480 }, armor: 480, magicResist: 480 }); // Extreme variant
    const chief = bossEnemyAt('troll_chieftain', 'hard');
    expect(chief).toMatchObject({ hp: 2000, damage: { min: 52, max: 72 }, armor: 80, magicResist: 80, regenBpPerSec: 50, maxFightMs: 120_000, skills: ['heavy_bash'], attackIntervalMs: 1000 });
    expect(bossEnemyAt('troll_chieftain', 'extreme')).toMatchObject({ hp: 8000, damage: { min: 208, max: 288 }, armor: 320, magicResist: 320, regenBpPerSec: 50, maxFightMs: 120_000 });
    expect(bossEnemyAt('troll_chieftain', 'normal')).toBe(ENEMIES.troll_chieftain);
    // Magic resist still equals armor on every scaled enemy.
    for (const bp of [20_000, 30_000, 120_000, 160_000]) for (const e of Object.values(ENEMIES)) expect(scaledEnemy(e, bp).magicResist).toBe(scaledEnemy(e, bp).armor);
  });

  it('a rounding case on a real enemy: the Rat (damage 3-5, armor 2) at x2.25 and x13', () => {
    const rat = ENEMIES.rat;
    expect(scaledEnemy(rat, 22_500)).toMatchObject({ hp: 68, damage: { min: 7, max: 11 }, armor: 5 }); // 67.5, 6.75, 11.25, 4.5
    expect(scaledEnemy(rat, 130_000)).toMatchObject({ hp: 390, damage: { min: 39, max: 65 }, armor: 26 });
  });

  it('names: the plain mob keeps the enemy name; the variants are their own creatures (1.25.0), from the data table, never "Veteran X"', () => {
    const want = {
      rat: ['Rat', 'Giant Rat', 'Blight Rat'],
      bat: ['Bat', 'Vampire Bat', 'Plague Bat'],
      wolf: ['Wolf', 'Dire Wolf', 'Shadow Wolf'],
      skeleton: ['Skeleton', 'Skeleton Knight', 'Bone Champion'],
      troll: ['Troll', 'Stone Troll', 'Magma Troll'],
    } as const;
    for (const [id, [base, veteran, extreme]] of Object.entries(want)) {
      expect([mobName(id as EnemyId, 'base'), mobName(id as EnemyId, 'veteran'), mobName(id as EnemyId, 'extreme')], id).toEqual([base, veteran, extreme]);
      expect(ENEMY_VARIANTS[id as EnemyId]).toEqual({ veteran: { id: veteran.toLowerCase().replace(' ', '_'), name: veteran }, extreme: { id: extreme.toLowerCase().replace(' ', '_'), name: extreme } });
    }
    // The boss never comes in a pack: no variants, its own name whatever is asked.
    expect(ENEMY_VARIANTS.troll_chieftain).toBeUndefined();
    expect(mobName('troll_chieftain', 'base')).toBe('Troll Chieftain');
    expect(mobName('troll_chieftain', 'veteran')).toBe('Troll Chieftain');
    // No name anywhere is a built "Veteran X" / "Extreme X" string.
    for (const v of Object.values(ENEMY_VARIANTS)) for (const c of Object.values(v!)) expect(c.name).not.toMatch(/^(Veteran|Extreme) /);
  });
});

describe('read-only views for the stage and boss detail', () => {
  it('packSizeRange and mobTypes: what a difficulty sends and how often', () => {
    expect(packSizeRange('normal')).toEqual({ min: 1, max: 1 });
    expect(packSizeRange('hard')).toEqual({ min: 1, max: 4 });
    expect(packSizeRange('extreme')).toEqual({ min: 7, max: 10 });
    const names = (d: Difficulty) => mobTypes(ENEMIES.troll, d).map((m) => [m.name, m.multBp, m.chanceBp]);
    expect(names('normal')).toEqual([['Troll', 10_000, 10_000]]);
    expect(names('hard')).toEqual([['Troll', 20_000, 7500], ['Stone Troll', 30_000, 2500]]);
    expect(names('extreme')).toEqual([['Stone Troll', 120_000, 7500], ['Magma Troll', 160_000, 2500]]);
    expect(mobTypes(ENEMIES.troll, 'hard')[1].enemy).toEqual(scaledEnemy(ENEMIES.troll, 30_000));
  });

  it('bossRewardsAt: XP and gold scaled (x2 / x8), the difficulty rarity table', () => {
    expect(bossRewardsAt('troll_chieftain', 'normal')).toEqual({ heroXp: 2000, gold: { min: 300, max: 450 }, rarityWeights: BOSSES.troll_chieftain.rewards.gear.rarityWeights });
    expect(bossRewardsAt('troll_chieftain', 'hard')).toMatchObject({ heroXp: 4000, gold: { min: 600, max: 900 } });
    expect(bossRewardsAt('troll_chieftain', 'extreme')).toMatchObject({ heroXp: 16_000, gold: { min: 2400, max: 3600 }, rarityWeights: DIFFICULTY.extreme.boss.rarityWeights });
  });
});

// ---------- unlock rules ----------

describe('unlocking Hard and Extreme', () => {
  it('a fresh game: only Normal is open; the reasons name the boss and the difficulty to beat', () => {
    const s = heroGame('normal');
    expect(difficultyViews(s, 1).map((v) => [v.difficulty, v.unlocked, v.selected])).toEqual([['normal', true, true], ['hard', false, false], ['extreme', false, false]]);
    expect(difficultyLockReason(s, 1, 'hard')).toBe('Kill the Troll Chieftain on Normal to unlock Hard');
    expect(difficultyLockReason(s, 1, 'extreme')).toBe('Kill the Troll Chieftain on Hard to unlock Extreme');
    expect(difficultyLockReason(s, 1, 'normal')).toBeNull();
  });

  it('the first boss win on Normal opens Hard (not Extreme); the first on Hard opens Extreme; permanent', () => {
    const hard = heroGame('hard');
    expect(difficultyViews(hard, 1).map((v) => v.unlocked)).toEqual([true, true, false]);
    const ext = heroGame('extreme');
    expect(difficultyViews(ext, 1).map((v) => v.unlocked)).toEqual([true, true, true]);
    // A Hard boss win does nothing while Hard is locked? It cannot even be recorded: Extreme needs the Hard boss kill itself.
    const onlyExtremeCounter = structuredClone(heroGame('normal'));
    onlyExtremeCounter.dungeon.harder.extreme.bosses = { troll_chieftain: tb(5) };
    expect(difficultyViews(onlyExtremeCounter, 1).map((v) => v.unlocked)).toEqual([true, false, false]);
    // Wins never go down: unlocks hold after any number of later losses.
    const later = structuredClone(ext);
    later.dungeon.bosses = { troll_chieftain: { runs: 9, wins: 1, losses: 8 } };
    expect(difficultyViews(later, 1).every((v) => v.unlocked)).toBe(true);
  });

  it('losing to the boss opens nothing; the kill does, with DIFFICULTY_UNLOCKED and the summary entry', () => {
    // A hero that cannot beat the Chieftain: Lv 1.
    const weak = structuredClone(builtGame(3, T0));
    weak.dungeon.byDungeon = { ...CHAIN };
    weak.dungeon.totals = { runs: 140, wins: 140, losses: 0 };
    const lost = simulate(ok(weak, { type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10 }), T0 + 130 * SEC);
    expect(lost.state.dungeon.lastFight).toMatchObject({ dungeonId: 'troll_chieftain', won: false, difficulty: 'normal' });
    expect(lost.state.dungeon.bosses.troll_chieftain).toMatchObject({ losses: 1, wins: 0 });
    expect(difficultyViews(lost.state, 1)[1].unlocked).toBe(false);
    expect(lost.events.some((e) => e.type === 'DIFFICULTY_UNLOCKED')).toBe(false);
    // A win: a hero who one-shots it.
    const strong = structuredClone(heroGame('normal'));
    strong.character.spentPoints = { ...strong.character.spentPoints, strength: 5000 };
    strong.character.hp = getDerivedStats(strong).maxHp.value;
    // 1.25.0: the hero's strike at fight time 0 is played by the command itself, so the one-shot kill (and its unlock) is in ENTER_BOSS's result.
    const entered = applyCommand(strong, cmd({ type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10 }), T0 + 5 * SEC);
    if (!entered.ok) throw new Error(entered.error.message);
    const won = { state: entered.state, events: entered.events, summary: entered.summary };
    expect(won.state.activity).toBeNull();
    expect(won.state.dungeon.lastFight).toMatchObject({ won: true, difficulty: 'normal' });
    expect(won.events).toContainEqual({ type: 'DIFFICULTY_UNLOCKED', tier: 1, difficulty: 'hard' });
    expect(won.events.filter((e) => e.type === 'DIFFICULTY_UNLOCKED')).toHaveLength(1);
    expect(won.summary.harderUnlocks).toEqual([{ kind: 'difficulty', tier: 1, difficulty: 'hard' }]);
    expect(difficultyViews(won.state, 1).map((v) => v.unlocked)).toEqual([true, true, false]);
    // A second win does not announce it again.
    const again = simulate(ok(won.state, { type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10 }, T0 + 6 * SEC), T0 + 12 * SEC);
    expect(again.events.some((e) => e.type === 'DIFFICULTY_UNLOCKED')).toBe(false);
  });

  it('DEBUG_ADD_BOSS_WINS: a Normal win opens Hard, a Hard win opens Extreme; refused while the difficulty is locked', () => {
    let s = heroGame('normal');
    expect(errorOf(s, { type: 'DEBUG_ADD_BOSS_WINS', bossId: 'troll_chieftain', amount: 1, difficulty: 'hard' }).code).toBe('DIFFICULTY_LOCKED');
    const r1 = applyCommand(s, cmd({ type: 'DEBUG_ADD_BOSS_WINS', bossId: 'troll_chieftain', amount: 1 }), T0);
    if (!r1.ok) throw new Error(r1.error.message);
    expect(r1.events.map((e) => e.type)).toContain('DIFFICULTY_UNLOCKED');
    expect(r1.state.flags.debugUsed).toBe(true);
    s = r1.state;
    expect(errorOf(s, { type: 'DEBUG_ADD_BOSS_WINS', bossId: 'troll_chieftain', amount: 1, difficulty: 'extreme' }).code).toBe('DIFFICULTY_LOCKED');
    const r2 = applyCommand(s, cmd({ type: 'DEBUG_ADD_BOSS_WINS', bossId: 'troll_chieftain', amount: 1, difficulty: 'hard' }), T0);
    if (!r2.ok) throw new Error(r2.error.message);
    expect(r2.events).toContainEqual({ type: 'DIFFICULTY_UNLOCKED', tier: 1, difficulty: 'extreme' });
    expect(r2.state.dungeon.harder.hard.bosses.troll_chieftain).toEqual({ runs: 1, wins: 1, losses: 0 });
    expect(r2.state.dungeon.bosses.troll_chieftain).toEqual({ runs: 1, wins: 1, losses: 0 }); // Normal untouched
    expect(errorOf(s, { type: 'DEBUG_ADD_BOSS_WINS', bossId: 'nope' as never, amount: 1 }).code).toBe('UNKNOWN_BOSS');
    expect(errorOf(s, { type: 'DEBUG_ADD_BOSS_WINS', bossId: 'troll_chieftain', amount: 0 }).code).toBe('INVALID_AMOUNT');
    expect(errorOf(s, { type: 'DEBUG_ADD_BOSS_WINS', bossId: 'troll_chieftain', amount: 1, difficulty: 'nightmare' as never }).code).toBe('UNKNOWN_DIFFICULTY');
    // Debug can be switched off.
    const off = applyCommand(s, cmd({ type: 'DEBUG_ADD_BOSS_WINS', bossId: 'troll_chieftain', amount: 1 }), T0, { allowDebug: false });
    expect(off.ok).toBe(false);
  });

  it('DEBUG_ADD_DUNGEON_WINS takes a difficulty: Hard wins are counted apart, refused while Hard is locked', () => {
    const locked = heroGame('normal');
    expect(errorOf(locked, { type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'rat_cellar', amount: 5, difficulty: 'hard' }).code).toBe('DIFFICULTY_LOCKED');
    const hard = ok(heroGame('hard'), { type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'rat_cellar', amount: 5, difficulty: 'hard' });
    expect(hard.dungeon.harder.hard.byDungeon.rat_cellar).toEqual({ runs: 5, wins: 5, losses: 0 });
    expect(hard.dungeon.byDungeon.rat_cellar).toEqual(CHAIN.rat_cellar);
    expect(hard.dungeon.totals.runs).toBe(145); // totals stay the sum over every difficulty
    const plain = ok(heroGame('hard'), { type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'rat_cellar', amount: 5 });
    expect(plain.dungeon.byDungeon.rat_cellar).toEqual({ runs: 15, wins: 15, losses: 0 });
  });
});

describe('stages inside Hard / Extreme', () => {
  const IDS = ['rat_cellar', 'bat_cave', 'wolf_den', 'forgotten_crypt', 'troll_bridge'] as const;
  const open = (s: GameState, d: Difficulty) => IDS.map((id) => isDungeonUnlocked(s, id, d));
  /** The previous stage's wins on a harder difficulty. */
  const setWins = (s: GameState, d: 'hard' | 'extreme', wins: Partial<Record<(typeof IDS)[number], number>>) => {
    const c = structuredClone(s);
    c.dungeon.harder[d].byDungeon = Object.fromEntries(Object.entries(wins).map(([id, w]) => [id, tb(w)]));
    return c;
  };

  it('each difficulty has its own chain: the first stage opens with the difficulty, nothing else does (Normal wins never count)', () => {
    // Normal is fully open (CHAIN), yet on Hard only Rat Cellar is.
    expect(open(heroGame('hard'), 'hard')).toEqual([true, false, false, false, false]);
    expect(open(heroGame('extreme'), 'extreme')).toEqual([true, false, false, false, false]);
    expect(open(heroGame('hard'), 'normal')).toEqual([true, true, true, true, true]);
    // A locked difficulty opens nothing, not even its first stage.
    expect(open(heroGame('normal'), 'hard')).toEqual([false, false, false, false, false]);
    expect(open(heroGame('hard'), 'extreme')).toEqual([false, false, false, false, false]);
  });

  it('Hard thresholds are the Normal count x2: 20 / 30 / 50 / 80, one below stays locked, the line opens', () => {
    const base = heroGame('hard');
    const needs = [['rat_cellar', 20], ['bat_cave', 30], ['wolf_den', 50], ['forgotten_crypt', 80]] as const;
    needs.forEach(([prev, need], i) => {
      const next = IDS[i + 1];
      expect(isDungeonUnlocked(setWins(base, 'hard', { [prev]: need - 1 }), next, 'hard')).toBe(false);
      expect(isDungeonUnlocked(setWins(base, 'hard', { [prev]: need }), next, 'hard')).toBe(true);
    });
    // Only the previous stage counts, and only wins (losses do not).
    expect(isDungeonUnlocked(setWins(base, 'hard', { rat_cellar: 19, wolf_den: 99 }), 'bat_cave', 'hard')).toBe(false);
    const lossy = setWins(base, 'hard', {});
    lossy.dungeon.harder.hard.byDungeon.rat_cellar = { runs: 40, wins: 19, losses: 21 };
    expect(isDungeonUnlocked(lossy, 'bat_cave', 'hard')).toBe(false);
  });

  it('Extreme thresholds are x8: 80 / 120 / 200 / 320; Hard wins do not count on Extreme', () => {
    const base = heroGame('extreme');
    const needs = [['rat_cellar', 80], ['bat_cave', 120], ['wolf_den', 200], ['forgotten_crypt', 320]] as const;
    needs.forEach(([prev, need], i) => {
      const next = IDS[i + 1];
      expect(isDungeonUnlocked(setWins(base, 'extreme', { [prev]: need - 1 }), next, 'extreme')).toBe(false);
      expect(isDungeonUnlocked(setWins(base, 'extreme', { [prev]: need }), next, 'extreme')).toBe(true);
    });
    const hardOnly = setWins(base, 'hard', { rat_cellar: 500, bat_cave: 500, wolf_den: 500, forgotten_crypt: 500 });
    expect(open(hardOnly, 'extreme')).toEqual([true, false, false, false, false]);
    expect(open(hardOnly, 'hard')).toEqual([true, true, true, true, true]);
    // And Extreme wins do not open Hard stages.
    expect(open(setWins(base, 'extreme', { rat_cellar: 500, bat_cave: 500 }), 'hard')).toEqual([true, false, false, false, false]);
  });

  it('the boss keeps its numbers (50 / 100 / 400) and follows the same scale', () => {
    expect(['normal', 'hard', 'extreme'].map((d) => bossUnlockWins('troll_chieftain', d as Difficulty))).toEqual([50, 100, 400]);
    // Every stage count is Normal x scale.
    for (const id of IDS.slice(1)) {
      const normal = DUNGEONS[id].unlock!.wins;
      expect(dungeonUnlockView(heroGame('extreme'), id, 'hard').requirement?.wins).toBe(normal * 2);
      expect(dungeonUnlockView(heroGame('extreme'), id, 'extreme').requirement?.wins).toBe(normal * 8);
    }
  });

  it('START_ACTIVITY on a locked Hard stage fails DUNGEON_LOCKED even when it is open on Normal; the unlock view shows its own progress', () => {
    const s = setWins(heroGame('hard'), 'hard', { rat_cellar: 3 });
    const err = errorOf(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'bat_cave', difficulty: 'hard' });
    expect(err.code).toBe('DUNGEON_LOCKED');
    expect(isDungeonUnlocked(s, 'bat_cave', 'normal')).toBe(true);
    expect(dungeonUnlockView(s, 'bat_cave', 'hard')).toEqual({ unlocked: false, requirement: { dungeonId: 'rat_cellar', wins: 20 }, progress: 3, difficultyLocked: false });
    expect(dungeonUnlockView(s, 'bat_cave', 'normal')).toMatchObject({ unlocked: true });
    expect(dungeonUnlockView(heroGame('normal'), 'rat_cellar', 'hard')).toEqual({ unlocked: false, requirement: null, progress: 0, difficultyLocked: true });
    expect(dungeonUnlockView(heroGame('hard'), 'rat_cellar', 'hard')).toMatchObject({ unlocked: true, difficultyLocked: false });
    // The first stage starts at once; the selected tier difficulty (no explicit one) is checked the same way.
    expect(ok(heroGame('hard'), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar', difficulty: 'hard' }).activity).toMatchObject({ kind: 'dungeon', difficulty: 'hard' });
    const sel = ok(s, { type: 'SET_DUNGEON_DIFFICULTY', tier: 1, difficulty: 'hard' });
    expect(errorOf(sel, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'wolf_den' }).code).toBe('DUNGEON_LOCKED');
  });

  it('crossing a Hard stage line emits DUNGEON_UNLOCKED with the difficulty, once; Normal wins emit nothing for Hard', () => {
    const base = setWins(heroGame('hard'), 'hard', { rat_cellar: 19 });
    const r = applyCommand(base, cmd({ type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'rat_cellar', amount: 1, difficulty: 'hard' }), T0);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events.filter((e) => e.type === 'DUNGEON_UNLOCKED')).toEqual([{ type: 'DUNGEON_UNLOCKED', dungeonId: 'bat_cave', difficulty: 'hard' }]);
    const again = applyCommand(r.state, cmd({ type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'rat_cellar', amount: 1, difficulty: 'hard' }), T0);
    if (!again.ok) throw new Error(again.error.message);
    expect(again.events.filter((e) => e.type === 'DUNGEON_UNLOCKED')).toEqual([]);
    // Normal wins: no event for the harder chain.
    const n = applyCommand(base, cmd({ type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'rat_cellar', amount: 50 }), T0);
    if (!n.ok) throw new Error(n.error.message);
    expect(n.events.filter((e) => e.type === 'DUNGEON_UNLOCKED')).toEqual([]);
  });

  it('a Hard run on a stage the chain now closes finishes ONE run, then the hero is idle; new starts are refused', () => {
    // A save from before the per-difficulty chain: Hard Wolf Den running, no Hard Bat Cave wins.
    const run = ok(setWins(heroGame('hard'), 'hard', { bat_cave: 30 }), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'wolf_den', difficulty: 'hard' });
    const old = structuredClone(run);
    old.dungeon.harder.hard.byDungeon = {};
    expect(isDungeonUnlocked(old, 'wolf_den', 'hard')).toBe(false);
    // The search in progress finishes into its fight (the run in progress); the fight is not interrupted.
    const mid = simulate(old, T0 + searchMsFor('wolf_den', old) + 1);
    expect(mid.state.activity).toMatchObject({ kind: 'dungeon', dungeonId: 'wolf_den', difficulty: 'hard', phase: 'fight' });
    const end = simulate(old, T0 + 12 * MIN);
    // Exactly one run was played and counted, and the hero went idle instead of repeating (no farming of the wins that open the next stage).
    expect(end.state.activity).toBeNull();
    expect(end.state.dungeon.harder.hard.byDungeon.wolf_den!.runs).toBe(1);
    expect(end.summary.dungeon.runs).toBe(1);
    expect(end.events.filter((e) => e.type === 'ACTIVITY_STOPPED')).toEqual([{ type: 'ACTIVITY_STOPPED', kind: 'dungeon' }]);
    expect(simulate(end.state, T0 + 60 * MIN).state.dungeon.harder.hard.byDungeon.wolf_den!.runs).toBe(1);
    // Live == offline == any split: many small steps, and a split inside the search and inside the fight, give the same state.
    const split = (cuts: number[]) => cuts.reduce((st, t) => simulate(st, T0 + t).state, old);
    const search = searchMsFor('wolf_den', old);
    const steps = Array.from({ length: 12 * 60 }, (_, i) => (i + 1) * 1000);
    for (const cuts of [steps, [search - 1, search, search + 1, search + 2000, 12 * MIN], [30 * SEC, search + 7000, 12 * MIN]]) {
      const got = split(cuts);
      expect(got.activity).toBeNull();
      expect(got.dungeon).toEqual(end.state.dungeon);
      expect(got.character).toEqual(end.state.character);
    }
    // New starts on the closed stage are refused (idle and from another activity).
    expect(errorOf(end.state, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'wolf_den', difficulty: 'hard' }, T0 + 12 * MIN).code).toBe('DUNGEON_LOCKED');
    // Open stages still repeat.
    const open = simulate(ok(heroGame('hard'), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar', difficulty: 'hard' }), T0 + 12 * MIN);
    expect(open.state.activity).toMatchObject({ kind: 'dungeon' });
    expect(open.summary.dungeon.runs).toBeGreaterThan(1);
  });

  it('counters are kept per difficulty (stages and boss); existing counters are the Normal ones', () => {
    const s = heroGame('hard');
    expect(s.dungeon.byDungeon.rat_cellar).toEqual(tb(10)); // Normal
    expect(s.dungeon.harder.hard.byDungeon).toEqual({});
    expect(s.dungeon.harder.extreme).toEqual({ byDungeon: {}, bosses: {} });
    const hard = simulate(ok(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar', difficulty: 'hard' }), T0 + 10 * MIN);
    const h = hard.state.dungeon.harder.hard.byDungeon.rat_cellar!;
    expect(h.runs).toBeGreaterThan(0);
    expect(h.runs).toBe(h.wins + h.losses);
    expect(hard.state.dungeon.byDungeon.rat_cellar).toEqual(tb(10)); // Normal untouched
    expect(hard.state.dungeon.totals.runs).toBe(140 + h.runs); // totals = every difficulty
  });
});

describe('boss unlock inside a difficulty (data, not code): Normal 50, Hard 100, Extreme 400 wins at Troll Bridge on that difficulty', () => {
  const enter = (d: Difficulty) => ({ type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10, difficulty: d }) as const;
  const withStageWins = (s: GameState, d: 'hard' | 'extreme', wins: number) => {
    const c = structuredClone(s);
    c.dungeon.harder[d].byDungeon = { troll_bridge: tb(wins) };
    return c;
  };

  it('Hard: 99 Hard Troll Bridge wins is locked ("99/100"), 100 opens it; 50 Normal wins do not count', () => {
    const base = heroGame('hard');
    expect(errorOf(base, enter('hard'))).toMatchObject({ code: 'BOSS_LOCKED' });
    expect(errorOf(base, enter('hard')).message).toContain('0/100');
    const at99 = withStageWins(base, 'hard', 99);
    expect(errorOf(at99, enter('hard')).code).toBe('BOSS_LOCKED');
    expect(errorOf(at99, enter('hard')).message).toContain('99/100');
    const s = ok(withStageWins(base, 'hard', 100), enter('hard'));
    expect(s.activity).toMatchObject({ kind: 'boss', difficulty: 'hard' });
  });

  it('Extreme: 399 locked, 400 opens it (only once Extreme itself is unlocked)', () => {
    const base = heroGame('extreme');
    expect(errorOf(withStageWins(base, 'extreme', 399), enter('extreme'))).toMatchObject({ code: 'BOSS_LOCKED' });
    expect(errorOf(withStageWins(base, 'extreme', 399), enter('extreme')).message).toContain('399/400');
    expect(ok(withStageWins(base, 'extreme', 400), enter('extreme')).activity).toMatchObject({ kind: 'boss', difficulty: 'extreme' });
    // Hard wins are not Extreme wins.
    expect(errorOf(withStageWins(base, 'hard', 400), enter('extreme')).code).toBe('BOSS_LOCKED');
    // Extreme itself locked: DIFFICULTY_LOCKED comes first.
    expect(errorOf(withStageWins(heroGame('hard'), 'extreme', 400), enter('extreme')).code).toBe('DIFFICULTY_LOCKED');
  });

  it('crossing the requirement emits DUNGEON_UNLOCKED for the boss on that difficulty', () => {
    const base = withStageWins(heroGame('hard'), 'hard', 99);
    base.dungeon.harder.hard.byDungeon.forgotten_crypt = tb(80); // Troll Bridge is open on Hard
    const r = applyCommand(base, cmd({ type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'troll_bridge', amount: 1, difficulty: 'hard' }), T0);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events).toContainEqual({ type: 'DUNGEON_UNLOCKED', dungeonId: 'troll_chieftain', difficulty: 'hard' });
  });
});

// ---------- commands ----------

describe('SET_DUNGEON_DIFFICULTY and the difficulty on START_ACTIVITY / ENTER_BOSS', () => {
  const set = (tier: unknown, difficulty: unknown) => ({ type: 'SET_DUNGEON_DIFFICULTY', tier, difficulty }) as never;

  it('selects a difficulty per tier; Normal is the default for every tier', () => {
    const s = heroGame('hard');
    expect(selectedDifficulty(s, 1)).toBe('normal');
    expect(s.dungeon.difficulty).toEqual({ '1': 'normal' });
    const h = ok(s, set(1, 'hard'));
    expect(selectedDifficulty(h, 1)).toBe('hard');
    expect(h.dungeon.difficulty).toEqual({ '1': 'hard' });
    expect(difficultyViews(h, 1).map((v) => v.selected)).toEqual([false, true, false]);
    expect(selectedDifficulty(ok(h, set(1, 'normal')), 1)).toBe('normal');
    expect(selectedDifficulty(ok(h, set(1, 'hard')), 1)).toBe('hard'); // the same again is fine
  });

  it('typed errors, nothing changes: UNKNOWN_TIER, UNKNOWN_DIFFICULTY, DIFFICULTY_LOCKED', () => {
    const s = heroGame('hard');
    expect(errorOf(s, set(2, 'hard')).code).toBe('UNKNOWN_TIER');
    expect(errorOf(s, set('1', 'hard')).code).toBe('UNKNOWN_TIER');
    expect(errorOf(s, set(0, 'normal')).code).toBe('UNKNOWN_TIER');
    expect(errorOf(s, set(1, 'nightmare')).code).toBe('UNKNOWN_DIFFICULTY');
    expect(errorOf(s, set(1, undefined)).code).toBe('UNKNOWN_DIFFICULTY');
    const locked = errorOf(s, set(1, 'extreme'));
    expect(locked).toEqual({ code: 'DIFFICULTY_LOCKED', message: 'Kill the Troll Chieftain on Hard to unlock Extreme' });
    expect(errorOf(heroGame('normal'), set(1, 'hard')).code).toBe('DIFFICULTY_LOCKED');
    // A refused command changes nothing.
    const r = applyCommand(s, cmd(set(1, 'extreme')), T0);
    expect(r.ok).toBe(false);
    expect(selectedDifficulty(s, 1)).toBe('normal');
  });

  it('START_ACTIVITY uses the named difficulty, else the selected one; a locked or unknown one is refused', () => {
    const s = ok(heroGame('hard'), set(1, 'hard'));
    expect(ok(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }).activity).toMatchObject({ kind: 'dungeon', difficulty: 'hard' });
    expect(ok(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar', difficulty: 'normal' }).activity).toMatchObject({ difficulty: 'normal' });
    expect(selectedDifficulty(ok(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar', difficulty: 'normal' }), 1)).toBe('hard'); // the selection is not touched
    expect(errorOf(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar', difficulty: 'extreme' }).code).toBe('DIFFICULTY_LOCKED');
    expect(errorOf(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar', difficulty: 'bad' as never }).code).toBe('UNKNOWN_DIFFICULTY');
    expect(errorOf(heroGame('normal'), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar', difficulty: 'hard' }).code).toBe('DIFFICULTY_LOCKED');
  });

  it('a run keeps its own difficulty: changing the selection mid-run changes nothing; auto-repeat keeps it', () => {
    let s = ok(heroGame('hard'), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar', difficulty: 'hard' });
    expect(dungeonRunView(s)).toMatchObject({ dungeonId: 'rat_cellar', difficulty: 'hard' });
    const before = JSON.stringify(s.activity);
    s = ok(s, set(1, 'normal'), T0 + 1000);
    expect(selectedDifficulty(s, 1)).toBe('normal');
    expect(s.activity).toMatchObject({ kind: 'dungeon', difficulty: 'hard', progressMs: 1000 });
    expect(JSON.stringify({ ...(s.activity as object), progressMs: 0 })).toBe(JSON.stringify({ ...JSON.parse(before), progressMs: 0 }));
    // Many runs later it is still Hard, and every counter moved on Hard only.
    const later = simulate(s, T0 + 30 * MIN).state;
    expect(later.activity).toMatchObject({ kind: 'dungeon', difficulty: 'hard' });
    expect(later.dungeon.harder.hard.byDungeon.rat_cellar!.runs).toBeGreaterThan(3);
    expect(later.dungeon.byDungeon.rat_cellar).toEqual(CHAIN.rat_cellar);
  });

  it('starting the same stage on ANOTHER difficulty starts a new run; the same one again keeps the current run', () => {
    const hard = ok(heroGame('hard'), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar', difficulty: 'hard' });
    const same = ok(hard, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar', difficulty: 'hard' }, T0 + 30 * SEC);
    expect(same.activity).toMatchObject({ progressMs: 30 * SEC, difficulty: 'hard' });
    const other = applyCommand(hard, cmd({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar', difficulty: 'normal' }), T0 + 30 * SEC);
    if (!other.ok) throw new Error(other.error.message);
    expect(other.state.activity).toMatchObject({ kind: 'dungeon', difficulty: 'normal', phase: 'search', progressMs: 0 });
    expect(other.events.map((e) => e.type)).toContain('DUNGEON_RUN_CANCELLED');
  });

  it('ENTER_BOSS resolves the difficulty (the named one, else the selected one) and records it on the fight', () => {
    const base = structuredClone(heroGame('hard'));
    base.dungeon.harder.hard.byDungeon = { troll_bridge: tb(100) };
    expect(ok(base, { type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10 }).activity).toMatchObject({ kind: 'boss', difficulty: 'normal' });
    const sel = ok(base, set(1, 'hard'));
    expect(ok(sel, { type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10 }).activity).toMatchObject({ kind: 'boss', difficulty: 'hard' });
    expect(ok(sel, { type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10, difficulty: 'normal' }).activity).toMatchObject({ difficulty: 'normal' });
    expect(errorOf(base, { type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10, difficulty: 'weird' as never }).code).toBe('UNKNOWN_DIFFICULTY');
    expect(errorOf(base, { type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10, difficulty: 'extreme' }).code).toBe('DIFFICULTY_LOCKED');
  });
});
