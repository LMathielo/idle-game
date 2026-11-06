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
  type Difficulty,
  DIFFICULTIES,
  DIFFICULTY,
  difficultyLockReason,
  difficultyViews,
  dungeonRunView,
  dungeonUnlockView,
  DUNGEONS,
  ENEMIES,
  type GameState,
  getDerivedStats,
  isDungeonUnlocked,
  mobName,
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
    expect(DIFFICULTY.normal).toMatchObject({ unlockedBy: null, pack: null, boss: { statBp: 10_000, rewardBp: 10_000, unlockWins: null, rarityWeights: null } });
    expect(DIFFICULTY.hard.pack).toEqual({ size: { min: 1, max: 4 }, base: { variant: 'base', bp: 20_000 }, upgrade: { variant: 'veteran', bp: 30_000, chanceBp: 2500 } });
    expect(DIFFICULTY.extreme.pack).toEqual({ size: { min: 7, max: 10 }, base: { variant: 'veteran', bp: 120_000 }, upgrade: { variant: 'extreme', bp: 160_000, chanceBp: 2500 } });
    expect(DIFFICULTY.hard.unlockedBy).toBe('normal');
    expect(DIFFICULTY.extreme.unlockedBy).toBe('hard');
    expect(DIFFICULTY.hard.boss).toMatchObject({ statBp: 20_000, rewardBp: 20_000, unlockWins: 100 });
    expect(DIFFICULTY.extreme.boss).toMatchObject({ statBp: 80_000, rewardBp: 80_000, unlockWins: 400 });
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

  it('labels: "Troll" (plain), "Veteran Troll", "Extreme Troll"', () => {
    expect(mobName('Troll', 'base')).toBe('Troll');
    expect(mobName('Troll', 'veteran')).toBe('Veteran Troll');
    expect(mobName('Troll', 'extreme')).toBe('Extreme Troll');
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
    const won = simulate(ok(strong, { type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10 }), T0 + 5 * SEC);
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
  it('open when the difficulty is unlocked AND the stage is open on Normal; no separate chain', () => {
    // Hard is open, but only Rat Cellar and Bat Cave are open on Normal.
    const s = structuredClone(heroGame('hard'));
    s.dungeon.byDungeon = { rat_cellar: tb(10), bat_cave: tb(14) };
    s.dungeon.totals = { runs: 24, wins: 24, losses: 0 };
    expect(['rat_cellar', 'bat_cave', 'wolf_den', 'forgotten_crypt', 'troll_bridge'].map((id) => isDungeonUnlocked(s, id as never, 'hard'))).toEqual([true, true, false, false, false]);
    // Hard wins do not open anything on Hard: the Hard chain does not exist.
    s.dungeon.harder.hard.byDungeon = { bat_cave: tb(99), wolf_den: tb(99) };
    expect(isDungeonUnlocked(s, 'wolf_den', 'hard')).toBe(false);
    // Normal wins open the stage on Normal and on Hard at once.
    s.dungeon.byDungeon = { rat_cellar: tb(10), bat_cave: tb(15) };
    expect(isDungeonUnlocked(s, 'wolf_den', 'normal')).toBe(true);
    expect(isDungeonUnlocked(s, 'wolf_den', 'hard')).toBe(true);
    // A locked difficulty opens nothing, even for a stage open on Normal.
    expect(isDungeonUnlocked(heroGame('normal'), 'rat_cellar', 'hard')).toBe(false);
    expect(isDungeonUnlocked(heroGame('hard'), 'rat_cellar', 'extreme')).toBe(false);
    expect(isDungeonUnlocked(heroGame('extreme'), 'troll_bridge', 'extreme')).toBe(true);
  });

  it('START_ACTIVITY on a stage that is closed on Normal fails DUNGEON_LOCKED on Hard too; the unlock view says why', () => {
    const s = structuredClone(heroGame('hard'));
    s.dungeon.byDungeon = { rat_cellar: tb(10) };
    s.dungeon.totals = { runs: 10, wins: 10, losses: 0 };
    expect(errorOf(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'wolf_den', difficulty: 'hard' }).code).toBe('DUNGEON_LOCKED');
    expect(dungeonUnlockView(s, 'wolf_den', 'hard')).toEqual({ unlocked: false, requirement: { dungeonId: 'bat_cave', wins: 15 }, progress: 0, difficultyLocked: false });
    expect(dungeonUnlockView(heroGame('normal'), 'rat_cellar', 'hard')).toEqual({ unlocked: false, requirement: null, progress: 0, difficultyLocked: true });
    expect(dungeonUnlockView(heroGame('hard'), 'rat_cellar', 'hard')).toMatchObject({ unlocked: true, difficultyLocked: false });
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
