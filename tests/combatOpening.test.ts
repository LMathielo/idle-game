// The combat opening (engine 1.25.0, save v23): every fight starts with the HERO's strike at t = 0 and each monster's first strike at
// 300 ms; after that every side strikes on its own interval. Normal stages, Hard / Extreme packs and the boss alike.
//   strike n of a side lands at  firstStrikeMs + (n - 1) x attackIntervalMs        (`strikeTimeMs`, config COMBAT)
// Covered here: the strike times of a 1v1, a pack and the boss; the stun and Heavy Bash counts; the time-limit edge (a strike due at
// exactly the limit still lands); the old opening (a fight stamped by a v22 save) still available; the RNG draws unchanged; live ==
// offline == any split, with boundaries at the fight start, at 0 and at 300 ms; no double-fired or skipped opening strike.
import { describe, expect, it } from 'vitest';
import {
  type ActiveFight,
  applyCommand,
  COMBAT,
  COMBAT_SKILLS,
  createRng,
  type Difficulty,
  DUNGEONS,
  type GameState,
  hashState,
  nextFloat,
  type RngState,
  searchMsFor,
  simulate,
  strikeTimeMs,
} from '../src/engine';
import { newPackFight, nextFightEvent, packDefeated, resolveFight, strike } from '../src/engine/combat';
import { bossHero, cmd, fightSide, MIN, SEC, T0 } from './helpers';

// ---------- helpers ----------

const tb = (wins: number) => ({ runs: wins, wins, losses: 0 });
const CHAIN = { rat_cellar: tb(10), bat_cave: tb(15), wolf_den: tb(25), forgotten_crypt: tb(40), troll_bridge: tb(50) };

/** A Lv 25 STR+END hero (Iron set, quality 50) with every stage open, Hard unlocked and the Chieftain once beaten on Normal. */
function openGame(level: number, seed: number): GameState {
  const s = structuredClone(bossHero(level, 'STR+END', 50, 'uncommon'));
  s.dungeon.byDungeon = { ...CHAIN };
  s.dungeon.totals = { runs: 140, wins: 140, losses: 0 };
  s.dungeon.bosses = { troll_chieftain: tb(1) };
  s.dungeon.harder.hard.bosses = { troll_chieftain: tb(1) };
  s.rng = createRng(seed);
  return s;
}

function ok(s: GameState, c: Parameters<typeof cmd>[0], now = T0): GameState {
  const r = applyCommand(s, cmd(c), now);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
}

const startRun = (s: GameState, id: keyof typeof DUNGEONS, difficulty: Difficulty) => ok(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: id, difficulty });
const fightOf = (s: GameState): ActiveFight | null => (s.activity?.kind === 'dungeon' || s.activity?.kind === 'boss' ? s.activity.fight : null);

function skip(rng: RngState, n: number): RngState {
  let r = rng;
  for (let i = 0; i < n; i++) r = nextFloat(r).rng;
  return r;
}

const mob = (hp: number, intervalMs = 1000, damage = 1, extra: Partial<Parameters<typeof fightSide>[0]> = {}) => ({
  side: fightSide({ damage: { min: damage, max: damage }, attackIntervalMs: intervalMs, ...extra }),
  hp,
});
const hero = (damage = 10, intervalMs = 1000) => fightSide({ damage: { min: damage, max: damage }, attackIntervalMs: intervalMs });

type Played = { events: { actor: string; mob: number; atMs: number }[]; heroHp: number; rng: RngState; reason: 'won' | 'lost' | 'time_limit' };

/** Plays a hand-built fight to its end with the engine's own event order, returning every strike in order. */
function play(fight: ActiveFight, heroHp: number, seed = 1): Played {
  let rng = createRng(seed);
  let hp = heroHp;
  const events: Played['events'] = [];
  for (let guard = 0; guard < 100_000; guard++) {
    const ev = nextFightEvent(fight);
    if (ev.type === 'time_limit') return { events, heroHp: hp, rng, reason: 'time_limit' };
    events.push({ actor: ev.actor, mob: ev.mob, atMs: ev.atMs });
    const r = strike(fight, ev.actor, ev.atMs, hp, rng, ev.mob);
    hp = r.heroHp;
    rng = r.rng;
    if (packDefeated(fight)) return { events, heroHp: hp, rng, reason: 'won' };
    if (hp === 0) return { events, heroHp: 0, rng, reason: 'lost' };
  }
  throw new Error('runaway fight');
}

// ---------- the formula and the tunables ----------

describe('the strike-time formula', () => {
  it('the tunables: the hero strikes at 0, every monster at 300 ms', () => {
    expect(COMBAT.heroFirstStrikeMs).toBe(0);
    expect(COMBAT.enemyFirstStrikeMs).toBe(300);
  });

  it('strike n lands at firstStrikeMs + (n - 1) x interval', () => {
    expect([1, 2, 3, 4].map((n) => strikeTimeMs(COMBAT.heroFirstStrikeMs, 1000, n))).toEqual([0, 1000, 2000, 3000]);
    expect([1, 2, 3, 4].map((n) => strikeTimeMs(COMBAT.enemyFirstStrikeMs, 1000, n))).toEqual([300, 1300, 2300, 3300]);
    expect(strikeTimeMs(300, 850, 3)).toBe(300 + 2 * 850);
    // The old rule is the same formula with the side's own interval as its offset.
    expect([1, 2, 3].map((n) => strikeTimeMs(1000, 1000, n))).toEqual([1000, 2000, 3000]);
  });

  it('a new fight carries the tunables; options override them (the old opening is still reachable)', () => {
    const f = newPackFight('rat', hero(), [mob(100)], 100, 100);
    expect([f.heroFirstStrikeMs, f.enemyFirstStrikeMs]).toEqual([0, 300]);
    const old = newPackFight('rat', hero(), [mob(100)], 100, 100, { heroFirstStrikeMs: 1000, enemyFirstStrikeMs: 1000 });
    expect([old.heroFirstStrikeMs, old.enemyFirstStrikeMs]).toEqual([1000, 1000]);
  });
});

// ---------- 1v1, pack, boss ----------

describe('the opening: 1v1', () => {
  it('hero at 0, monster at 300 ms, then each on its own interval (1 s each: 0, 300, 1000, 1300, 2000, 2300 ...)', () => {
    const f = newPackFight('rat', hero(1), [mob(1000, 1000, 1)], 1_000_000, 1_000_000, { maxFightMs: 4000 });
    const r = play(f, 1_000_000);
    expect(r.events.map((e) => `${e.actor[0]}${e.atMs}`)).toEqual(['h0', 'e300', 'h1000', 'e1300', 'h2000', 'e2300', 'h3000', 'e3300', 'h4000']);
    expect(f.log.map((e) => [e.actor, e.atMs, e.strike])).toEqual([
      ['hero', 0, 1], ['enemy', 300, 1], ['hero', 1000, 2], ['enemy', 1300, 2], ['hero', 2000, 3], ['enemy', 2300, 3],
      ['hero', 3000, 4], ['enemy', 3300, 4], ['hero', 4000, 5],
    ]);
  });

  it('different intervals keep their own rhythm after the opening', () => {
    const f = newPackFight('rat', hero(1, 700), [mob(1000, 1100)], 1_000_000, 1_000_000, { maxFightMs: 3000 });
    const r = play(f, 1_000_000);
    expect(r.events.map((e) => `${e.actor[0]}${e.atMs}`)).toEqual(['h0', 'e300', 'h700', 'h1400', 'e1400', 'h2100', 'e2500', 'h2800']);
  });

  it('a hero who kills a monster with his opening strike wins at t = 0: the monster never strikes', () => {
    const f = newPackFight('rat', hero(100), [mob(50, 1000, 999)], 100, 100);
    const r = play(f, 100);
    expect(r.reason).toBe('won');
    expect(r.events).toEqual([{ actor: 'hero', mob: 0, atMs: 0 }]);
    expect(r.heroHp).toBe(100);
  });

  it('a monster that kills the hero at 300 ms ends it there (the hero struck first, once)', () => {
    const f = newPackFight('rat', hero(1), [mob(1000, 1000, 999)], 100, 100);
    const r = play(f, 100);
    expect(r.reason).toBe('lost');
    expect(r.events).toEqual([{ actor: 'hero', mob: 0, atMs: 0 }, { actor: 'enemy', mob: 0, atMs: 300 }]);
  });

  it('draws per strike are unchanged: the hero 2 (roll, crit), a monster 1 -- in the order of the new times', () => {
    const f = newPackFight('rat', hero(1), [mob(1000, 1000)], 1_000_000, 1_000_000, { maxFightMs: 1300 });
    const r = play(f, 1_000_000, 9);
    // h0 (2), e300 (1), h1000 (2), e1300 (1)
    expect(r.rng).toEqual(skip(createRng(9), 6));
  });
});

describe('the opening: a pack', () => {
  it('every monster opens at 300 ms (in pack order, after the hero when they tie), then on its own interval', () => {
    const f = newPackFight('rat', hero(1, 50_000), [mob(1000, 700), mob(1000, 1100), mob(1000, 1300), mob(1000, 1000)], 1_000_000, 1_000_000, { maxFightMs: 2700 });
    const r = play(f, 1_000_000);
    expect(r.events.map((e) => `${e.actor[0]}${e.mob}@${e.atMs}`)).toEqual([
      'h0@0',
      'e0@300', 'e1@300', 'e2@300', 'e3@300',
      'e0@1000', 'e3@1300', 'e1@1400', 'e2@1600', 'e0@1700', 'e3@2300',
      'e0@2400', 'e1@2500',
    ]);
  });

  it('the hero hits the front-most alive monster at t = 0; the others are untouched until their turn', () => {
    const f = newPackFight('rat', hero(10), [mob(100), mob(100), mob(100)], 1_000_000, 1_000_000, { maxFightMs: 10 });
    play(f, 1_000_000);
    expect(f.mobs.map((m) => m.hp)).toEqual([90, 100, 100]);
    expect(f.mobs.map((m) => m.strikes)).toEqual([0, 0, 0]); // nobody struck back yet: the monsters open at 300 ms
    expect(f.heroStrikes).toBe(1);
  });

  it('a dead monster never gets its 300 ms strike', () => {
    // 4 hero strikes of 100 at 0 / 1 ms ... : the hero is fast (1 ms) and kills monsters 0 and 1 before 300 ms; only monster 2 strikes.
    const f = newPackFight('rat', hero(100, 1), [mob(100), mob(100), mob(100_000)], 1_000_000, 1_000_000, { maxFightMs: 300 });
    const r = play(f, 1_000_000);
    const enemy = r.events.filter((e) => e.actor === 'enemy');
    expect(enemy).toEqual([{ actor: 'enemy', mob: 2, atMs: 300 }]);
  });
});

describe('the opening: the boss, the stun and Heavy Bash', () => {
  const bossMob = (damage = 1, hp = 100_000) => mob(hp, 1000, damage, { skills: ['heavy_bash'] });

  /** A seed whose first Heavy Bash (the boss's 3rd strike, at 2300 ms) stuns, and one whose does not. */
  function seedWhere(stuns: boolean): number {
    for (let seed = 1; seed < 500; seed++) {
      const f = newPackFight('troll_chieftain', hero(1), [bossMob()], 1_000_000, 1_000_000, { maxFightMs: 2300 });
      play(f, 1_000_000, seed);
      const bash = f.log.find((e) => e.actor === 'enemy' && e.skill === 'heavy_bash');
      if (!bash) continue;
      if (Boolean(f.heroStunStrikes > 0) === stuns) return seed;
    }
    throw new Error('no seed');
  }

  it('Heavy Bash is cast on the boss\'s 3rd, 10th and 17th strikes: 2300, 9300 and 16300 ms', () => {
    const f = newPackFight('troll_chieftain', hero(1), [bossMob()], 1_000_000, 1_000_000, { maxFightMs: 17_000 });
    play(f, 1_000_000, 3);
    const casts = f.log.filter((e) => e.actor === 'enemy' && e.skill === 'heavy_bash');
    expect(casts.map((e) => [e.strike, e.atMs])).toEqual([[3, 2300], [10, 9300], [17, 16_300]]);
    expect(COMBAT_SKILLS.heavy_bash.firstReadyStrike).toBe(3);
    expect(COMBAT_SKILLS.heavy_bash.cooldownStrikes).toBe(7);
  });

  it('a stun costs the hero exactly his next 3 strikes: at 3000, 4000 and 5000 ms after the cast at 2300 (strike 3 at 2000 had landed)', () => {
    const f = newPackFight('troll_chieftain', hero(1), [bossMob()], 1_000_000, 1_000_000, { maxFightMs: 6000 });
    play(f, 1_000_000, seedWhere(true));
    const lost = f.log.filter((e) => e.actor === 'hero' && e.stunned);
    expect(lost.map((e) => [e.strike, e.atMs])).toEqual([[4, 3000], [5, 4000], [6, 5000]]);
    expect(lost.every((e) => e.dealt === 0)).toBe(true);
    const struck = f.log.filter((e) => e.actor === 'hero' && !e.stunned);
    expect(struck.map((e) => e.atMs)).toEqual([0, 1000, 2000, 6000]); // the opening, two more, then the 7th after the stun
  });

  it('a Heavy Bash that does not stun costs him nothing: every hero strike lands', () => {
    const f = newPackFight('troll_chieftain', hero(1), [bossMob()], 1_000_000, 1_000_000, { maxFightMs: 6000 });
    play(f, 1_000_000, seedWhere(false));
    expect(f.log.some((e) => e.actor === 'enemy' && e.skill === 'heavy_bash')).toBe(true);
    expect(f.log.filter((e) => e.actor === 'hero' && e.stunned)).toHaveLength(0);
    expect(f.log.filter((e) => e.actor === 'hero').map((e) => e.atMs)).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000]);
  });

  it('the real boss through the command: the opening strike lands inside ENTER_BOSS, the boss answers at 300 ms', () => {
    const s = structuredClone(openGame(25, 5));
    s.character.hp = 1_000_000_000;
    s.character.spentPoints = { ...s.character.spentPoints, strength: 0 };
    const e = ok(s, { type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10, difficulty: 'normal' });
    const f = fightOf(e)!;
    expect(f).toMatchObject({ heroStrikes: 1, elapsedMs: 0, heroFirstStrikeMs: 0, enemyFirstStrikeMs: 300 });
    expect(f.log[0]).toMatchObject({ actor: 'hero', atMs: 0, strike: 1 });
    const t = e.time.lastSimulatedAt;
    const at299 = fightOf(simulate(e, t + 299).state)!;
    expect(at299.mobs[0].strikes).toBe(0);
    const at300 = fightOf(simulate(e, t + 300).state)!;
    expect(at300.mobs[0].strikes).toBe(1);
    expect(at300.log[1]).toMatchObject({ actor: 'enemy', atMs: 300, strike: 1 });
    // The boss's 3rd strike (Heavy Bash) is at 2300 ms and the fight's 4th hero strike (3000 ms) is the first one a stun can take.
    const at2300 = fightOf(simulate(e, t + 2300).state)!;
    expect(at2300.log.find((x) => x.skill === 'heavy_bash')).toMatchObject({ strike: 3, atMs: 2300 });
  });
});

// ---------- the time limit ----------

describe('the time limit with the new opening', () => {
  it('a hero strike due at exactly 60 s lands (61 strikes: 0, 1 ... 60 s); the next, at 61 s, does not', () => {
    const f = newPackFight('rat', hero(1), [mob(1_000_000, 1000, 0)], 1_000_000, 1_000_000);
    const r = play(f, 1_000_000);
    expect(r.reason).toBe('time_limit');
    const heroAt = r.events.filter((e) => e.actor === 'hero').map((e) => e.atMs);
    expect(heroAt).toHaveLength(61);
    expect(heroAt[0]).toBe(0);
    expect(heroAt[60]).toBe(60_000);
  });

  it('a monster strike due at exactly the limit lands too: 300 ms on a 300 ms timer is 200 strikes, the 200th AT 60 s', () => {
    const f = newPackFight('rat', hero(1), [mob(1_000_000, 300, 0)], 1_000_000, 1_000_000);
    const r = play(f, 1_000_000);
    const enemyAt = r.events.filter((e) => e.actor === 'enemy').map((e) => e.atMs);
    expect(enemyAt).toHaveLength(200);
    expect(enemyAt[199]).toBe(60_000);
    // On the normal 1 s timer the last one is at 59.3 s: 60 strikes, the 61st (60.3 s) is past the limit.
    const g = newPackFight('rat', hero(1), [mob(1_000_000, 1000, 0)], 1_000_000, 1_000_000);
    const enemyAt1s = play(g, 1_000_000).events.filter((e) => e.actor === 'enemy').map((e) => e.atMs);
    expect(enemyAt1s).toHaveLength(60);
    expect(enemyAt1s[59]).toBe(59_300);
  });

  it('the boss limit is 120 s and works the same way', () => {
    const f = newPackFight('troll_chieftain', hero(1), [mob(1_000_000, 1000, 0)], 1_000_000, 1_000_000, { maxFightMs: 120_000 });
    const r = play(f, 1_000_000);
    expect(r.events.filter((e) => e.actor === 'hero')).toHaveLength(121);
    expect(r.events.filter((e) => e.actor === 'enemy')).toHaveLength(120);
  });
});

// ---------- the old opening, still working ----------

describe('a fight on the old opening (stamped by a v22 save) still plays the old way', () => {
  const OLD = { heroFirstStrikeMs: 1000, enemyFirstStrikeMs: 1000 };

  it('both sides first strike one interval in: 1000, 2000 ... with the hero first at every tie', () => {
    const f = newPackFight('rat', hero(1), [mob(1000, 1000, 1)], 1_000_000, 1_000_000, { ...OLD, maxFightMs: 3000 });
    const r = play(f, 1_000_000);
    expect(r.events.map((e) => `${e.actor[0]}${e.atMs}`)).toEqual(['h1000', 'e1000', 'h2000', 'e2000', 'h3000', 'e3000']);
  });

  it('the pack result of the old engine: 3 monsters of 30 HP, a 10-damage hero on 1 s -> 9 strikes, over at 9000 ms (the new opening: 8000)', () => {
    const pack = [mob(30), mob(30), mob(30)].map((m) => ({ ...m.side, hp: m.hp }));
    const old = resolveFight({ ...hero(10), hp: 1_000_000 }, pack, createRng(5), COMBAT.maxFightMs, OLD);
    expect(old.durationMs).toBe(9000);
    const now = resolveFight({ ...hero(10), hp: 1_000_000 }, pack, createRng(5));
    expect(now.durationMs).toBe(8000);
  });
});

// ---------- live == offline == any split ----------

describe('live = offline = any time split, with the opening', () => {
  /** [label, state at the run's start, the instant the search ends] for a Normal stage, a Hard pack and a boss. */
  const cases: [string, GameState, number][] = (() => {
    const normal = startRun(openGame(25, 101), 'forgotten_crypt', 'normal');
    const hard = startRun(openGame(25, 102), 'wolf_den', 'hard');
    return [
      ['Normal stage', normal, T0 + searchMsFor('forgotten_crypt', normal)],
      ['Hard pack', hard, T0 + searchMsFor('wolf_den', hard)],
    ];
  })();

  const offsets = [-1, 0, 1, 2, 150, 299, 300, 301, 999, 1000, 1299, 1300, 1301, 5000, 22_000];

  it('a split anywhere around the fight start (-1, 0, 1, 299, 300, 301 ms ...) gives the same state as one piece', () => {
    for (const [label, s, end] of cases) {
      const horizon = end + 3 * MIN;
      const once = simulate(s, horizon).state;
      for (const o of offsets) {
        const two = simulate(simulate(s, end + o).state, horizon).state;
        expect(hashState(two), `${label}: split at search end ${o >= 0 ? '+' : ''}${o} ms`).toBe(hashState(once));
      }
    }
  });

  it('many tiny steps (1 s ticks, like the live client) give the same state as one piece, hash for hash', () => {
    for (const [label, s, end] of cases) {
      const horizon = end + 90 * SEC;
      let live = s;
      for (let t = s.time.lastSimulatedAt + 1000; t <= horizon; t += 1000) live = simulate(live, t).state;
      live = simulate(live, horizon).state;
      expect(hashState(live), label).toBe(hashState(simulate(s, horizon).state));
    }
  });

  it('a boundary AT the fight start fires the hero\'s t = 0 strike exactly once (not twice, not skipped)', () => {
    for (const [label, s, end] of cases) {
      const a = simulate(s, end).state; // the fight has just begun
      const f = fightOf(a);
      const done = a.dungeon.lastFight;
      // Either the fight is in progress with exactly one hero strike at 0, or it was one-shot at t = 0 and the record has exactly one.
      const log = f ? f.log : done!.log;
      expect(log.filter((e) => e.actor === 'hero' && e.atMs === 0), `${label}: opening strikes`).toHaveLength(1);
      // Simulating zero or one ms more, or the same instant again, adds nothing.
      for (const dt of [0, 0, 1]) {
        const b = simulate(a, a.time.lastSimulatedAt + dt).state;
        const lb = fightOf(b) ? fightOf(b)!.log : b.dungeon.lastFight!.log;
        expect(lb.filter((e) => e.actor === 'hero' && e.atMs === 0), `${label}: dt ${dt}`).toHaveLength(1);
        expect(lb.filter((e) => e.actor === 'enemy' && e.atMs < 300)).toHaveLength(0);
      }
    }
  });

  it('a command at the exact instant the search ends settles the opening once; the run then plays on exactly as without it', () => {
    for (const [label, s, end] of cases) {
      // A harmless command (the Normal selection of tier 1) at the very instant of the fight start.
      const sel = applyCommand(s, cmd({ type: 'SET_DUNGEON_DIFFICULTY', tier: 1, difficulty: 'normal' }), end);
      if (!sel.ok) throw new Error(`${label}: ${sel.error.code}`);
      const f = fightOf(sel.state);
      const log = f ? f.log : sel.state.dungeon.lastFight!.log;
      expect(log.filter((e) => e.actor === 'hero' && e.atMs === 0), label).toHaveLength(1);
      // The same fight as the run without the command: the same fight state now and the same stream and last fight three minutes on.
      const plainNow = simulate(s, end).state;
      expect(fightOf(sel.state), label).toEqual(fightOf(plainNow));
      expect(sel.state.rng, label).toEqual(plainNow.rng);
      const horizon = end + 3 * MIN;
      const withCmd = simulate(sel.state, horizon).state;
      const plain = simulate(s, horizon).state;
      expect(withCmd.rng, label).toEqual(plain.rng);
      expect(withCmd.dungeon.lastFight, label).toEqual(plain.dungeon.lastFight);
      expect(withCmd.dungeon.totals, label).toEqual(plain.dungeon.totals);
    }
  });

  it('skipping the search with stamina starts the fight at once, and the hero\'s opening strike lands inside the command', () => {
    const s = startRun(openGame(25, 104), 'forgotten_crypt', 'normal');
    const r = applyCommand(s, cmd({ type: 'SKIP_DUNGEON_RUN', run: s.dungeon.totals.runs + 1, maxCost: 1000 }), T0 + 5 * SEC);
    if (!r.ok) throw new Error(r.error.code);
    const f = fightOf(r.state);
    const log = f ? f.log : r.state.dungeon.lastFight!.log;
    expect(log[0]).toMatchObject({ actor: 'hero', atMs: 0, strike: 1 });
    expect(log.filter((e) => e.actor === 'hero' && e.atMs === 0)).toHaveLength(1);
  });

  it('the boss, split anywhere around its start: the same state as one piece', () => {
    const s0 = structuredClone(openGame(25, 103));
    s0.character.hp = 1_000_000_000;
    s0.character.spentPoints = { ...s0.character.spentPoints, strength: 0 };
    const s = ok(s0, { type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10, difficulty: 'normal' });
    const t0 = s.time.lastSimulatedAt;
    const horizon = t0 + 3 * MIN;
    const once = simulate(s, horizon).state;
    for (const o of [0, 1, 299, 300, 301, 1000, 2299, 2300, 2301, 3000, 6000, 20_000]) {
      const two = simulate(simulate(s, t0 + o).state, horizon).state;
      expect(hashState(two), `boss split at +${o} ms`).toBe(hashState(once));
    }
  });
});
