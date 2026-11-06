// Packs on Hard / Extreme (engine 1.24.0): the pack roll and its fixed draw order, pack combat (targeting, tie order, no overkill, the 60 s
// limit), rewards on a full clear only (per-mob scaling and draw order), the scaled boss (rewards, rarity weights), the pack-aware danger
// hint and fight view, live == offline == any split, the offline cap, and a golden Hard fight and a golden Extreme fight.
import { describe, expect, it } from 'vitest';
import {
  type ActiveFight,
  applyCommand,
  bossDangerHint,
  BOSSES,
  chance,
  createRng,
  dangerHint,
  type Difficulty,
  DIFFICULTY,
  DUNGEONS,
  ENEMIES,
  fightView,
  getDerivedStats,
  type GameState,
  hashState,
  mobName,
  nextFloat,
  nextInt,
  rollPack,
  type RngState,
  scaledEnemy,
  scaleStat,
  searchMsFor,
  simulate,
} from '../src/engine';
import { makeItem } from '../src/engine/inventory';
import { newPackFight, nextFightEvent, packDefeated, resolveFight, strike } from '../src/engine/combat';
import { bossHero, cmd, fightSide, MIN, SEC, T0 } from './helpers';

// ---------- helpers ----------

const tb = (wins: number) => ({ runs: wins, wins, losses: 0 });
const CHAIN = { rat_cellar: tb(10), bat_cave: tb(15), wolf_den: tb(25), forgotten_crypt: tb(40), troll_bridge: tb(50) };

/** A strong hero (Lv 25, STR+END, Iron set at quality 50), every Normal stage open, Hard and Extreme unlocked. */
function openGame(level = 25, seed?: number): GameState {
  const s = structuredClone(bossHero(level, 'STR+END', 50, 'uncommon'));
  s.dungeon.byDungeon = { ...CHAIN };
  s.dungeon.totals = { runs: 140, wins: 140, losses: 0 };
  s.dungeon.bosses = { troll_chieftain: tb(1) };
  s.dungeon.harder.hard.bosses = { troll_chieftain: tb(1) };
  if (seed !== undefined) s.rng = createRng(seed);
  return s;
}

/** A hero no pack can stop: huge STR and END (kills a mob per strike, soaks anything), full HP. */
function godGame(seed: number): GameState {
  const s = openGame(30, seed);
  s.character.spentPoints = { ...s.character.spentPoints, strength: 3000, endurance: 3000 };
  s.character.hp = getDerivedStats(s).maxHp.value;
  return s;
}

function ok(s: GameState, c: Parameters<typeof cmd>[0], now = T0): GameState {
  const r = applyCommand(s, cmd(c), now);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
}

const start = (s: GameState, id: keyof typeof DUNGEONS, difficulty: Difficulty) => ok(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: id, difficulty });

/** Advances `rng` by n plain draws (every strike and roll is exactly one draw of the stream). */
function skip(rng: RngState, n: number): RngState {
  let r = rng;
  for (let i = 0; i < n; i++) r = nextFloat(r).rng;
  return r;
}

const fightOf = (s: GameState): ActiveFight | null => (s.activity?.kind === 'dungeon' || s.activity?.kind === 'boss' ? s.activity.fight : null);

/** The pack `rollPack` makes from `rng`, redone by hand with plain draws: ONE size draw, then ONE variant draw per mob in pack order. */
function manualPack(rng: RngState, d: 'hard' | 'extreme'): { variants: string[]; mults: number[]; rng: RngState } {
  const rule = DIFFICULTY[d].pack!;
  const size = nextInt(rng, rule.size.min, rule.size.max);
  let r = size.rng;
  const variants: string[] = [];
  const mults: number[] = [];
  for (let i = 0; i < size.value; i++) {
    const roll = nextInt(r, 0, 9999);
    r = roll.rng;
    const up = roll.value < rule.upgrade.chanceBp;
    variants.push(up ? rule.upgrade.variant : rule.base.variant);
    mults.push(up ? rule.upgrade.bp : rule.base.bp);
  }
  return { variants, mults, rng: r };
}

// ---------- the pack roll ----------

describe('rolling a pack', () => {
  it('Normal: one plain mob, the enemy itself, and not one RNG draw', () => {
    const rng = createRng(7);
    const p = rollPack(rng, ENEMIES.troll, 'normal');
    expect(p.mobs).toEqual([{ variant: 'base', multBp: 10_000, enemy: ENEMIES.troll }]);
    expect(p.mobs[0].enemy).toBe(ENEMIES.troll);
    expect(p.rng).toEqual(rng);
  });

  it('the draw order is fixed: pack size, then one variant roll per mob in pack order (nothing else), for 300 seeds', () => {
    for (const d of ['hard', 'extreme'] as const) {
      for (let seed = 1; seed <= 300; seed++) {
        const rng = createRng(seed);
        const real = rollPack(rng, ENEMIES.troll, d);
        const by = manualPack(rng, d);
        expect(real.mobs.map((m) => m.variant), `${d} seed ${seed}`).toEqual(by.variants);
        expect(real.mobs.map((m) => m.multBp)).toEqual(by.mults);
        expect(real.rng).toEqual(by.rng); // exactly 1 + size draws
        expect(real.mobs.map((m) => m.enemy)).toEqual(by.mults.map((bp) => scaledEnemy(ENEMIES.troll, bp)));
      }
    }
  });

  it('Hard: pack size uniform 1-4; each mob 25% Veteran (x3), the rest plain (x2) -- over 8000 seeds', () => {
    const N = 8000;
    const sizes = [0, 0, 0, 0, 0];
    let mobs = 0;
    let vets = 0;
    for (let seed = 1; seed <= N; seed++) {
      const p = rollPack(createRng(seed * 7919), ENEMIES.rat, 'hard');
      sizes[p.mobs.length] += 1;
      for (const m of p.mobs) {
        mobs += 1;
        expect(['base', 'veteran']).toContain(m.variant);
        expect(m.multBp).toBe(m.variant === 'veteran' ? 30_000 : 20_000);
        if (m.variant === 'veteran') vets += 1;
      }
    }
    expect(sizes[0]).toBe(0);
    for (let k = 1; k <= 4; k++) expect(Math.abs(sizes[k] / N - 0.25), `size ${k}`).toBeLessThan(0.02);
    expect(Math.abs(vets / mobs - 0.25)).toBeLessThan(0.015);
  });

  it('Extreme: pack size uniform 7-10; every mob at least Veteran (x12), 25% Extreme variant (x16) that replaces Veteran -- over 8000 seeds', () => {
    const N = 8000;
    const sizes: Record<number, number> = {};
    let mobs = 0;
    let ext = 0;
    for (let seed = 1; seed <= N; seed++) {
      const p = rollPack(createRng(seed * 104729), ENEMIES.rat, 'extreme');
      sizes[p.mobs.length] = (sizes[p.mobs.length] ?? 0) + 1;
      for (const m of p.mobs) {
        mobs += 1;
        expect(['veteran', 'extreme']).toContain(m.variant); // never a plain mob
        expect(m.multBp).toBe(m.variant === 'extreme' ? 160_000 : 120_000);
        if (m.variant === 'extreme') ext += 1;
      }
    }
    expect(Object.keys(sizes).map(Number).sort((a, b) => a - b)).toEqual([7, 8, 9, 10]);
    for (let k = 7; k <= 10; k++) expect(Math.abs(sizes[k] / N - 0.25), `size ${k}`).toBeLessThan(0.02);
    expect(Math.abs(ext / mobs - 0.25)).toBeLessThan(0.015);
  });

  it('the stage fight rolls the pack from the main RNG at the instant the search ends, and not before', () => {
    const s = start(openGame(25, 4242), 'rat_cellar', 'hard');
    const end = T0 + searchMsFor('rat_cellar', s);
    const before = simulate(s, end - 1).state;
    expect(before.rng).toEqual(s.rng); // the search draws nothing
    expect(fightOf(before)).toBeNull();
    const at = simulate(s, end).state;
    const by = manualPack(s.rng, 'hard');
    const f = fightOf(at)!;
    expect(f.mobs.map((m) => m.variant)).toEqual(by.variants);
    expect(f.mobs.map((m) => m.multBp)).toEqual(by.mults);
    expect(f.mobs.map((m) => m.maxHp)).toEqual(by.mults.map((bp) => scaleStat(ENEMIES.rat.hp, bp)));
    expect(at.rng).toEqual(by.rng);
    // Every mob starts at full HP, at fight time 0, on its own timer.
    expect(f.mobs.every((m) => m.hp === m.maxHp && m.strikes === 0)).toBe(true);
    expect(f.elapsedMs).toBe(0);
    expect(f.maxFightMs).toBe(60_000);
  });

  it('a Normal run of the same hero draws nothing at the start of the fight and plays one plain mob', () => {
    const s = start(openGame(25, 4242), 'rat_cellar', 'normal');
    const at = simulate(s, T0 + searchMsFor('rat_cellar', s)).state;
    expect(at.rng).toEqual(s.rng);
    expect(fightOf(at)!.mobs).toHaveLength(1);
    expect(fightOf(at)!.mobs[0]).toMatchObject({ variant: 'base', multBp: 10_000, maxHp: ENEMIES.rat.hp });
  });
});

// ---------- pack combat ----------

describe('pack combat (all mobs fight at once, the hero strikes the front-most alive mob)', () => {
  const mob = (hp: number, intervalMs = 1000, damage = 1) => ({ side: fightSide({ damage: { min: damage, max: damage }, attackIntervalMs: intervalMs }), hp });
  const hero = (damage = 10, intervalMs = 1000) => fightSide({ damage: { min: damage, max: damage }, attackIntervalMs: intervalMs });

  /** Plays a hand-built fight to its end, returning every event in order. */
  function play(fight: ActiveFight, heroHp: number, seed = 1): { events: { actor: string; mob: number; atMs: number }[]; heroHp: number; rng: RngState; reason: string } {
    let rng = createRng(seed);
    let hp = heroHp;
    const events: { actor: string; mob: number; atMs: number }[] = [];
    for (let guard = 0; guard < 10_000; guard++) {
      const ev = nextFightEvent(fight);
      if (ev.type === 'time_limit') return { events, heroHp: 0, rng, reason: 'time_limit' };
      events.push({ actor: ev.actor, mob: ev.mob, atMs: ev.atMs });
      const r = strike(fight, ev.actor, ev.atMs, hp, rng, ev.mob);
      hp = r.heroHp;
      rng = r.rng;
      if (packDefeated(fight)) return { events, heroHp: hp, rng, reason: 'won' };
      if (hp === 0) return { events, heroHp: 0, rng, reason: 'lost' };
    }
    throw new Error('runaway fight');
  }

  it('the hero strikes the front-most alive mob; a mob that dies is never struck again; no overkill carries over', () => {
    // Hero 10 per strike, mobs 15 HP each: 15 -> 5 -> dead (5 overkill wasted) -> the next strike is on the NEXT mob at full HP.
    const f = newPackFight('rat', hero(10), [mob(15), mob(15), mob(15)], 1_000_000, 1_000_000);
    const r = play(f, 1_000_000);
    expect(r.reason).toBe('won');
    const heroHits = f.log.filter((e) => e.actor === 'hero');
    expect(heroHits.map((e) => [e.mob, e.dealt, e.targetHpAfter])).toEqual([
      [0, 10, 5], [0, 10, 0],
      [1, 10, 5], [1, 10, 0],
      [2, 10, 5], [2, 10, 0],
    ]); // 6 strikes for 3 mobs of 15 HP: no carry-over of the 5 spare damage
    expect(f.mobs.map((m) => m.hp)).toEqual([0, 0, 0]);
  });

  it('every alive mob strikes on its own timer from the fight start; a dead mob falls silent', () => {
    // The hero is too slow to matter (50 s); mobs on 700 / 1100 / 1300 ms timers; mob 0 is killed (by hand) after its strike at 1400 ms.
    const f = newPackFight('rat', hero(1, 50_000), [mob(1000, 700), mob(1000, 1100), mob(1000, 1300)], 1_000_000, 1_000_000);
    const seen: [number, number][] = [];
    let rng = createRng(3);
    for (;;) {
      const ev = nextFightEvent(f);
      if (ev.type === 'time_limit' || ev.atMs > 4000) break;
      seen.push([ev.mob, ev.atMs]);
      rng = strike(f, ev.actor, ev.atMs, 1_000_000, rng, ev.mob).rng;
      if (ev.atMs === 1400) f.mobs[0].hp = 0;
    }
    expect(seen).toEqual([[0, 700], [1, 1100], [2, 1300], [0, 1400], [1, 2200], [2, 2600], [1, 3300], [2, 3900]]);
  });

  it('same-instant ties: the hero first, then the mobs in pack order', () => {
    const f = newPackFight('rat', hero(1), [mob(100), mob(100), mob(100)], 1_000_000, 1_000_000);
    const r = play(f, 1_000_000);
    const at1000 = r.events.filter((e) => e.atMs === 1000);
    expect(at1000).toEqual([
      { actor: 'hero', mob: 0, atMs: 1000 },
      { actor: 'enemy', mob: 0, atMs: 1000 },
      { actor: 'enemy', mob: 1, atMs: 1000 },
      { actor: 'enemy', mob: 2, atMs: 1000 },
    ]);
  });

  it('hero first at a tie: the hero kills the last mob before the one that would have killed him strikes', () => {
    // Mob 0 (1 HP) dies to the hero at 1000 ms; mob 1 (also 1 HP, behind it) strikes at 1000 ms for the hero's last HP: he is dead before
    // mob 1 is ever targeted, so it is a LOSS; but with ONE mob left the hero's kill at the tie wins the fight.
    const lose = newPackFight('rat', hero(10), [mob(1), mob(1, 1000, 99)], 50, 50);
    expect(play(lose, 50).reason).toBe('lost');
    const win = newPackFight('rat', hero(10), [mob(1, 1000, 99)], 50, 50);
    const w = play(win, 50);
    expect(w.reason).toBe('won');
    expect(w.heroHp).toBe(50); // he struck first and the dead mob never did
  });

  it('RNG per strike: the hero 2 draws (roll, crit), a mob 1 draw', () => {
    const f = newPackFight('rat', hero(10), [mob(1000, 5000), mob(1000, 5000)], 1_000_000, 1_000_000);
    const rng = createRng(11);
    const h = strike(f, 'hero', 1000, 1_000_000, rng, 0);
    expect(h.rng).toEqual(skip(rng, 2));
    const m = strike(f, 'enemy', 5000, 1_000_000, rng, 1);
    expect(m.rng).toEqual(skip(rng, 1));
  });

  it('time limit: 60 s on every pack (not scaled by the pack size); a win is ALL mobs dead', () => {
    // 10 mobs that cannot be killed in 60 s by a 10-damage hero on a 1000 ms timer: 60 strikes = 600 damage < 10 x 1000.
    const f = newPackFight('rat', hero(10), Array.from({ length: 10 }, () => mob(1000, 1000, 0)), 1_000_000, 1_000_000);
    const r = play(f, 1_000_000);
    expect(r.reason).toBe('time_limit');
    // A pack the hero CAN clear in time: 10 mobs x 5 strikes = 50 s.
    const g = newPackFight('rat', hero(10), Array.from({ length: 10 }, () => mob(50, 1000, 0)), 1_000_000, 1_000_000);
    const r2 = play(g, 1_000_000);
    expect(r2.reason).toBe('won');
    expect(g.mobs.every((m) => m.hp === 0)).toBe(true);
    expect(g.log.filter((e) => e.actor === 'hero')).toHaveLength(50);
    // One strike short at the 60 s limit (a strike AT 60 s still lands) is a loss.
    const h = newPackFight('rat', hero(10), [...Array.from({ length: 9 }, () => mob(50, 1000, 0)), mob(160, 1000, 0)], 1_000_000, 1_000_000);
    expect(play(h, 1_000_000).reason).toBe('time_limit');
  });

  it('resolveFight takes a pack too (tests / sims): the same result as the event walk', () => {
    const pack = [mob(30), mob(30), mob(30)].map((m) => ({ ...m.side, hp: m.hp }));
    const res = resolveFight({ ...hero(10), hp: 1_000_000 }, pack, createRng(5));
    expect(res.won).toBe(true);
    expect(res.endReason).toBe('enemy_defeated');
    expect(res.durationMs).toBe(9000); // 9 hero strikes, 3 per mob
    // One mob in a list behaves as a bare mob.
    const one = resolveFight({ ...hero(10), hp: 1000 }, [{ ...mob(30).side, hp: 30 }], createRng(5));
    const bare = resolveFight({ ...hero(10), hp: 1000 }, { ...mob(30).side, hp: 30 }, createRng(5));
    expect(one).toEqual(bare);
  });
});

// ---------- rewards ----------

describe('rewards: the whole run only, per mob, on a full clear', () => {
  /** A fight in progress for `s` with a hand-built pack (so a test controls who dies and when). */
  function withFight(s: GameState, fight: ActiveFight, difficulty: Difficulty = 'hard', id: keyof typeof DUNGEONS = 'rat_cellar'): GameState {
    const c = structuredClone(start(s, id, difficulty));
    if (c.activity?.kind !== 'dungeon') throw new Error('no dungeon run');
    c.activity.phase = 'fight';
    c.activity.progressMs = 0;
    c.activity.fight = fight;
    return c;
  }
  it('a full clear pays, per mob in pack order: XP = stage XP x mult, ONE gold roll x mult, then the stage drop rolls; verified by replaying the RNG', () => {
    for (const d of ['hard', 'extreme'] as const) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const s = start(godGame(seed), 'rat_cellar', d);
        // The very first run only: replay the stream from the state the fight began with.
        const begun = simulate(s, T0 + searchMsFor('rat_cellar', s)).state;
        const one = simulate(begun, T0 + searchMsFor('rat_cellar', s) + 60 * SEC); // the fight ends within 60 s, the next search has begun
        const f = one.state.dungeon.lastFight!;
        expect(f.won, `${d} ${seed} must be a win for this test`).toBe(true);
        expect(f.difficulty).toBe(d);
        const heroStrikes = f.log.filter((e) => e.actor === 'hero').length;
        const mobStrikes = f.log.length - heroStrikes;
        let rng = skip(begun.rng, 2 * heroStrikes + mobStrikes);
        let xp = 0;
        let gold = 0;
        let skins = 0;
        for (const m of f.mobs) {
          xp += scaleStat(DUNGEONS.rat_cellar.rewards.heroXp, m.multBp);
          const g = nextInt(rng, DUNGEONS.rat_cellar.rewards.gold.min, DUNGEONS.rat_cellar.rewards.gold.max);
          rng = g.rng;
          gold += scaleStat(g.value, m.multBp);
          const drop = chance(rng, 0.5);
          rng = drop.rng;
          if (drop.value) skins += 1;
        }
        expect(f.rewards.heroXp, `${d} ${seed} xp`).toBe(xp);
        expect(f.rewards.gold, `${d} ${seed} gold`).toBe(gold);
        expect(f.rewards.items.rat_skin ?? 0, `${d} ${seed} skins`).toBe(skins);
        expect(one.state.rng, `${d} ${seed} the stream ends exactly where the replay does`).toEqual(rng);
        expect(one.state.character.gold - begun.character.gold).toBe(gold);
      }
    }
  });

  it('XP per mob is the stage XP x multiplier (x2 / x3 on Hard, x12 / x16 on Extreme), summed over the pack', () => {
    const s = start(godGame(9), 'rat_cellar', 'extreme');
    const begun = simulate(s, T0 + searchMsFor('rat_cellar', s)).state;
    const done = simulate(begun, T0 + searchMsFor('rat_cellar', s) + 60 * SEC).state;
    const f = done.dungeon.lastFight!;
    expect(f.won).toBe(true);
    expect(f.mobs.length).toBeGreaterThanOrEqual(7);
    expect(f.rewards.heroXp).toBe(f.mobs.reduce((n, m) => n + (m.variant === 'extreme' ? 35 * 16 : 35 * 12), 0));
    expect(f.rewards.gold).toBeGreaterThanOrEqual(f.mobs.reduce((n, m) => n + scaleStat(2, m.multBp), 0));
    expect(f.rewards.gold).toBeLessThanOrEqual(f.mobs.reduce((n, m) => n + scaleStat(5, m.multBp), 0));
  });

  it('a loss pays nothing: kills made before it included; no gold / drop draws; the hero ends at 0 HP', () => {
    // Pack: a mob that dies at once, then a mob that kills the hero. Hero 60 HP.
    const s = openGame(30, 77);
    const hero = (() => {
      const base = fightOf(simulate(start(s, 'rat_cellar', 'normal'), T0 + searchMsFor('rat_cellar', start(s, 'rat_cellar', 'normal'))).state)!;
      return base.hero;
    })();
    const fight = newPackFight(
      'rat',
      { ...hero, damage: { min: 1000, max: 1000 }, attackIntervalMs: 1000, critChanceBp: 0 },
      [
        { variant: 'base', multBp: 20_000, side: fightSide({ damage: { min: 1, max: 1 }, attackIntervalMs: 50_000 }), hp: 1 },
        { variant: 'veteran', multBp: 30_000, side: fightSide({ damage: { min: 500_000, max: 500_000 }, attackIntervalMs: 1500 }), hp: 5_000_000 },
      ],
      s.character.hp,
      s.character.hp,
    );
    const run = withFight(s, fight);
    const out = simulate(run, T0 + 5 * SEC);
    const f = out.state.dungeon.lastFight!;
    expect(f.won).toBe(false);
    expect(f.endReason).toBe('hero_defeated');
    expect(f.mobs[0].hpEnd).toBe(0); // a kill was made...
    expect(f.rewards).toEqual({ heroXp: 0, gold: 0, items: {}, itemsLost: {} }); // ...and pays nothing
    expect(out.state.character.gold).toBe(s.character.gold);
    expect(f.heroHpEnd).toBe(0); // every loss leaves the hero at 0 HP (he then regenerates)
    expect(out.state.dungeon.harder.hard.byDungeon.rat_cellar).toEqual({ runs: 1, wins: 0, losses: 1 });
    // The stream: only strike draws, no gold or drop rolls.
    const strikes = f.log.filter((e) => e.actor === 'hero').length * 2 + f.log.filter((e) => e.actor === 'enemy').length;
    expect(out.state.rng).toEqual(skip(s.rng, strikes));
  });

  it('a time-limit loss pays nothing either, even with all but one mob dead', () => {
    const s = openGame(30, 78);
    const probe = start(s, 'rat_cellar', 'normal');
    const hero = fightOf(simulate(probe, T0 + searchMsFor('rat_cellar', probe)).state)!.hero;
    const fight = newPackFight(
      'rat',
      { ...hero, damage: { min: 100, max: 100 }, critChanceBp: 0, attackIntervalMs: 1000 },
      [
        { variant: 'base', multBp: 20_000, side: fightSide({ damage: { min: 1, max: 1 }, attackIntervalMs: 50_000 }), hp: 50 },
        { variant: 'base', multBp: 20_000, side: fightSide({ damage: { min: 1, max: 1 }, attackIntervalMs: 50_000 }), hp: 1_000_000_000 },
      ],
      s.character.hp,
      s.character.hp,
    );
    const out = simulate(withFight(s, fight), T0 + 70 * SEC);
    const f = out.state.dungeon.lastFight!;
    expect(f.endReason).toBe('time_limit');
    expect(f.durationMs).toBe(60_000);
    expect(f.won).toBe(false);
    expect(f.rewards).toEqual({ heroXp: 0, gold: 0, items: {}, itemsLost: {} });
    expect(out.state.character.gold).toBe(s.character.gold);
  });

  it('inventory full: the drops that do not fit are lost as before (itemsLost), the gold and XP still come', () => {
    const s = structuredClone(godGame(5));
    // Fill every slot with something that is not a rat skin, so no new stack fits.
    s.inventory.items = Array.from({ length: s.inventory.capacity }, (_, i) => makeItem('iron_sword', 1, `junk#${i}`));
    const run = start(s, 'rat_cellar', 'extreme');
    const begun = simulate(run, T0 + searchMsFor('rat_cellar', run)).state;
    const f = simulate(begun, T0 + searchMsFor('rat_cellar', run) + 60 * SEC).state.dungeon.lastFight!;
    expect(f.won).toBe(true);
    expect(f.rewards.items.rat_skin ?? 0).toBe(0);
    expect((f.rewards.itemsLost.rat_skin ?? 0)).toBeGreaterThan(0); // 7+ mobs at 50%: all but certain, and fixed by the seed
    expect(f.rewards.gold).toBeGreaterThan(0);
  });
});

// ---------- the boss ----------

describe('the Troll Chieftain on Hard and Extreme', () => {
  /** A hero who one-shots every boss (so the fight is decided on its first strike) with the boss open on `d`. */
  function slayer(d: Difficulty, seed: number): GameState {
    const s = structuredClone(openGame(25, seed));
    s.dungeon.harder.hard.byDungeon = { troll_bridge: tb(100) };
    s.dungeon.harder.extreme.byDungeon = { troll_bridge: tb(400) };
    s.dungeon.harder.hard.bosses = { troll_chieftain: tb(1) };
    s.character.spentPoints = { ...s.character.spentPoints, strength: 20_000 };
    s.character.hp = 1_000_000_000;
    void d;
    return s;
  }
  const enter = (s: GameState, d: Difficulty) => ok(s, { type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10, difficulty: d });

  it('entry is unchanged (10 stamina), the fight is a single Chieftain with scaled stats and its own 120 s limit', () => {
    for (const [d, hp] of [['normal', 1000], ['hard', 2000], ['extreme', 8000]] as const) {
      const s = slayer(d, 1);
      const e = enter(s, d);
      expect(e.stamina.current).toBe(s.stamina.current - 10);
      const f = fightOf(e)!;
      expect(f.mobs).toHaveLength(1);
      expect(f.mobs[0]).toMatchObject({ maxHp: hp, variant: 'base', regenBp: 50 });
      expect(f.maxFightMs).toBe(120_000);
      expect(f.mobs[0].side.skills).toEqual(['heavy_bash']);
    }
  });

  it('XP and gold are x2 / x8; the stats of the fight are the scaled ones', () => {
    for (const [d, bp] of [['hard', 20_000], ['extreme', 80_000]] as const) {
      const s = slayer(d, 3);
      const done = simulate(enter(s, d), T0 + 10 * SEC).state;
      const f = done.dungeon.lastFight!;
      expect(f).toMatchObject({ won: true, difficulty: d, dungeonId: 'troll_chieftain' });
      expect(f.rewards.heroXp).toBe(scaleStat(BOSSES.troll_chieftain.rewards.heroXp, bp));
      const g = BOSSES.troll_chieftain.rewards.gold;
      expect(f.rewards.gold).toBeGreaterThanOrEqual(scaleStat(g.min, bp));
      expect(f.rewards.gold).toBeLessThanOrEqual(scaleStat(g.max, bp));
      expect(done.dungeon.harder[d].bosses.troll_chieftain).toEqual({ runs: d === 'hard' ? 2 : 1, wins: d === 'hard' ? 2 : 1, losses: 0 });
    }
  });

  it('gear chance stays 35% and the rarity weights follow the difficulty (Normal green 75 / blue 25, Hard blue 75 / purple 25, Extreme blue 25 / purple 75)', () => {
    const N = 900;
    for (const d of ['normal', 'hard', 'extreme'] as const) {
      const counts: Record<string, number> = {};
      let gear = 0;
      for (let seed = 1; seed <= N; seed++) {
        const done = simulate(enter(slayer(d, seed * 31), d), T0 + 10 * SEC).state;
        const g = done.dungeon.lastFight!.rewards.gear;
        if (!g) continue;
        gear += 1;
        counts[g.rarity] = (counts[g.rarity] ?? 0) + 1;
      }
      expect(Math.abs(gear / N - 0.35), `${d} gear chance`).toBeLessThan(0.05);
      const share = (r: string) => (counts[r] ?? 0) / gear;
      if (d === 'normal') {
        expect(Object.keys(counts).sort()).toEqual(['rare', 'uncommon']);
        expect(Math.abs(share('uncommon') - 0.75)).toBeLessThan(0.08);
      } else if (d === 'hard') {
        expect(Object.keys(counts).sort()).toEqual(['epic', 'rare']);
        expect(Math.abs(share('rare') - 0.75)).toBeLessThan(0.08);
      } else {
        expect(Object.keys(counts).sort()).toEqual(['epic', 'rare']);
        expect(Math.abs(share('epic') - 0.75)).toBeLessThan(0.08);
      }
    }
  });

  it('the Chieftain stays one mob whatever the difficulty (no pack), and the Tusk drop is unchanged (50%)', () => {
    let tusks = 0;
    const N = 400;
    for (let seed = 1; seed <= N; seed++) {
      const done = simulate(enter(slayer('extreme', seed * 17), 'extreme'), T0 + 10 * SEC).state;
      expect(done.dungeon.lastFight!.mobs).toHaveLength(1);
      if (done.dungeon.lastFight!.rewards.items.chieftains_tusk) tusks += 1;
    }
    expect(Math.abs(tusks / N - 0.5)).toBeLessThan(0.08);
  });
});

// ---------- danger hint and the fight view ----------

describe('danger hint and fight view on packs', () => {
  it('Normal is the old hint (one mob, x1); Hard / Extreme use the average pack: sizes, mean multiplier, scaled mob', () => {
    const s = openGame(25);
    const n = dangerHint(s, 'wolf_den');
    expect(n).toEqual(dangerHint(s, 'wolf_den', 'normal'));
    expect(n).toMatchObject({ packMin: 1, packMax: 1, avgMultBp: 10_000, mob: { hp: 110, damageMin: 10, damageMax: 14, armor: 12 } });
    const h = dangerHint(s, 'wolf_den', 'hard');
    expect(h).toMatchObject({ packMin: 1, packMax: 4, avgMultBp: 22_500, mob: { hp: scaleStat(110, 22_500), armor: scaleStat(12, 22_500) } });
    const e = dangerHint(s, 'wolf_den', 'extreme');
    expect(e).toMatchObject({ packMin: 7, packMax: 10, avgMultBp: 130_000, mob: { hp: scaleStat(110, 130_000), damageMin: scaleStat(10, 130_000), damageMax: scaleStat(14, 130_000) } });
    // Harder means a bigger bill, in order.
    expect(h.expectedHpLoss).toBeGreaterThan(n.expectedHpLoss);
    expect(e.expectedHpLoss).toBeGreaterThan(h.expectedHpLoss);
    expect(e.fightMs).toBeGreaterThan(h.fightMs);
    expect(e.level).toBe('deadly');
  });

  it('pure: no RNG, no state change, the same answer every time', () => {
    const s = openGame(25, 99);
    const before = JSON.stringify(s);
    const a = dangerHint(s, 'rat_cellar', 'extreme');
    const b = dangerHint(s, 'rat_cellar', 'extreme');
    expect(a).toEqual(b);
    expect(JSON.stringify(s)).toBe(before);
    expect(bossDangerHint(s, 'troll_chieftain', 'hard')).toEqual(bossDangerHint(s, 'troll_chieftain', 'hard'));
  });

  it('the boss hint follows the difficulty: more HP and damage, a longer, costlier fight', () => {
    const s = openGame(30);
    const n = bossDangerHint(s, 'troll_chieftain');
    const h = bossDangerHint(s, 'troll_chieftain', 'hard');
    const e = bossDangerHint(s, 'troll_chieftain', 'extreme');
    expect(n).toEqual(bossDangerHint(s, 'troll_chieftain', 'normal'));
    expect(h.expectedHpLoss).toBeGreaterThan(n.expectedHpLoss);
    expect(e.expectedHpLoss).toBeGreaterThan(h.expectedHpLoss);
  });

  it('fightView lists the pack in order with the target (the first alive mob), dead mobs greyed (alive: false), summed HP', () => {
    const f = newPackFight('rat', fightSide({ damage: { min: 10, max: 10 } }), [
      { variant: 'base', side: fightSide({ attackIntervalMs: 50_000 }), hp: 15 },
      { variant: 'veteran', side: fightSide({ attackIntervalMs: 50_000 }), hp: 15 },
      { variant: 'extreme', side: fightSide({ attackIntervalMs: 50_000 }), hp: 15 },
    ], 100, 100);
    let rng = createRng(1);
    for (const at of [1000, 2000]) rng = strike(f, 'hero', at, 100, rng, 0).rng; // mob 0 dead (the 5 spare damage is lost)
    f.elapsedMs = 2000;
    const v = fightView(100, f);
    expect(v.mobs).toEqual([
      { variant: 'base', hp: 0, maxHp: 15, alive: false },
      { variant: 'veteran', hp: 15, maxHp: 15, alive: true },
      { variant: 'extreme', hp: 15, maxHp: 15, alive: true },
    ]);
    expect(v.targetIndex).toBe(1);
    expect(v.enemyHp).toBe(30);
    expect(v.enemyMaxHp).toBe(45);
    expect(mobName('Rat', v.mobs[2].variant)).toBe('Extreme Rat');
  });
});

// ---------- live == offline == any split ----------

describe('live, offline and any split give the same state', () => {
  const RUN = 12 * MIN;

  it.each([
    ['hard', 25],
    ['extreme', 25],
    ['extreme', 6],
  ] as const)('%s at Lv %i: one simulate == many small steps == splits at awkward points (inside the search, inside a pack fight)', (d, level) => {
    const s = start(openGame(level, 321), 'wolf_den', d);
    const once = simulate(s, T0 + RUN).state;
    const f = once.dungeon.harder[d].byDungeon.wolf_den;
    expect(f && f.runs).toBeGreaterThan(0);

    // "Live": a tick every 1.7 s.
    let live = s;
    for (let t = 1700; t < RUN; t += 1700) live = simulate(live, T0 + t).state;
    live = simulate(live, T0 + RUN).state;
    expect(hashState(live)).toBe(hashState(once));

    // Splits: around the end of the first search, and then every few hundred ms through the first fight.
    const search = searchMsFor('wolf_den', s);
    const splits = new Set<number>([1, search - 1, search, search + 1]);
    for (let t = search; t <= search + 30 * SEC; t += 733) splits.add(t);
    for (const at of splits) {
      const two = simulate(simulate(s, T0 + at).state, T0 + RUN).state;
      expect(hashState(two), `${d} split at ${at}`).toBe(hashState(once));
    }
  });

  it('the offline cap: a pack fight in progress at the cap is finished, whatever the offset; nothing else moves', () => {
    const base = start(openGame(25, 555), 'rat_cellar', 'extreme');
    const search = searchMsFor('rat_cellar', base);
    let finishedLate = 0;
    for (let offset = 1; offset <= 40 * SEC; offset += 977) {
      const capped = structuredClone(base);
      capped.offline.capMs = search + offset; // the cap falls `offset` ms into the pack fight
      const out = simulate(capped, T0 + capped.offline.capMs + 6 * 3_600_000);
      const a = out.state.activity;
      expect(a?.kind === 'dungeon' && a.fight, `offset ${offset}`).toBeNull(); // the fight is over...
      expect(a?.kind === 'dungeon' && a.phase, `offset ${offset}`).toBe('search'); // ...the next search is waiting at 0...
      const last = out.state.dungeon.lastFight!;
      // ...and has not moved past the cap: a fight cut by the cap leaves it at 0; one that ended inside the granted time went on searching.
      expect(a?.kind === 'dungeon' && a.progressMs, `offset ${offset}`).toBe(Math.max(0, offset - last.durationMs));
      expect(last.difficulty).toBe('extreme');
      expect(out.state.dungeon.harder.extreme.byDungeon.rat_cellar!.runs).toBe(1);
      if (last.durationMs > offset) finishedLate += 1;
      // The outcome does not depend on where the cap fell: it is the same fight an uncapped hero plays.
      const free = simulate(base, T0 + search + 90 * SEC).state.dungeon.lastFight!;
      expect(last.mobs).toEqual(free.mobs);
      expect(last.log).toEqual(free.log);
      expect(last.rewards).toEqual(free.rewards);
    }
    expect(finishedLate).toBeGreaterThan(0); // some offsets really did cut a fight short
  });
});

describe('the away summary says what was played on Hard / Extreme', () => {
  it('stage runs and boss fights are tallied per harder difficulty; Normal is the totals minus those', () => {
    const run = simulate(start(godGame(31), 'rat_cellar', 'hard'), T0 + 12 * MIN);
    const hard = run.summary.harder.hard;
    expect(hard.runs).toBeGreaterThan(2);
    expect(hard.wins + hard.losses).toBe(hard.runs);
    expect(run.summary.dungeon.runs).toBe(hard.runs); // every run of this absence was on Hard
    expect(run.summary.harder.extreme).toEqual({ runs: 0, wins: 0, losses: 0, bossFights: 0, bossWins: 0, bossLosses: 0 });
    const s = godGame(32);
    s.dungeon.harder.hard.byDungeon = { troll_bridge: tb(100) };
    const boss = simulate(ok(s, { type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10, difficulty: 'hard' }), T0 + 30 * SEC);
    expect(boss.summary.harder.hard).toMatchObject({ bossFights: 1, bossWins: 1, bossLosses: 0, runs: 0 });
    expect(boss.summary.boss.fights).toBe(1);
    // Normal play leaves both tallies empty.
    const normal = simulate(start(godGame(33), 'rat_cellar', 'normal'), T0 + 6 * MIN);
    expect(normal.summary.harder.hard.runs + normal.summary.harder.extreme.runs).toBe(0);
    expect(normal.summary.dungeon.runs).toBeGreaterThan(0);
  });
});

// ---------- goldens ----------

/** A short, stable text of a finished fight: the pack, how it ended, and the log (every strike) hashed. */
function fightFingerprint(s: GameState) {
  const f = s.dungeon.lastFight!;
  return {
    difficulty: f.difficulty,
    won: f.won,
    endReason: f.endReason,
    durationMs: f.durationMs,
    pack: f.mobs.map((m) => `${m.variant}:${m.maxHp}:${m.hpEnd}`),
    heroHpEnd: f.heroHpEnd,
    rewards: { heroXp: f.rewards.heroXp, gold: f.rewards.gold, items: f.rewards.items },
    strikes: f.log.length,
    logHash: hashState({ log: f.log } as unknown as GameState),
    rng: s.rng.seed,
  };
}

describe('golden pack fights (fixed seed, fixed hero: any change of the pack rules moves these)', () => {
  const play = (s: GameState, id: keyof typeof DUNGEONS, d: Difficulty) => {
    const run = start(s, id, d);
    return simulate(run, T0 + searchMsFor(id, run) + 60 * SEC).state;
  };

  it('a Hard Wolf Den pack of 4 (3 plain, 1 Veteran): the hero wins', () => {
    expect(fightFingerprint(play(openGame(25, 20261126), 'wolf_den', 'hard'))).toMatchInlineSnapshot(`
      {
        "difficulty": "hard",
        "durationMs": 23000,
        "endReason": "enemy_defeated",
        "heroHpEnd": 81,
        "logHash": "95eff8a3",
        "pack": [
          "base:220:0",
          "veteran:330:0",
          "base:220:0",
          "base:220:0",
        ],
        "rewards": {
          "gold": 183,
          "heroXp": 1260,
          "items": {
            "wolf_pelt": 2,
          },
        },
        "rng": 2660333600,
        "strikes": 78,
        "won": true,
      }
    `);
  });

  it('an Extreme Rat Cellar pack of 10 (8 Veteran, 2 Extreme): an unbeatable hero clears it', () => {
    expect(fightFingerprint(play(godGame(20261112), 'rat_cellar', 'extreme'))).toMatchInlineSnapshot(`
      {
        "difficulty": "extreme",
        "durationMs": 10000,
        "endReason": "enemy_defeated",
        "heroHpEnd": 15340,
        "logHash": "d1386011",
        "pack": [
          "veteran:360:0",
          "veteran:360:0",
          "veteran:360:0",
          "extreme:480:0",
          "extreme:480:0",
          "veteran:360:0",
          "veteran:360:0",
          "veteran:360:0",
          "veteran:360:0",
          "veteran:360:0",
        ],
        "rewards": {
          "gold": 452,
          "heroXp": 4480,
          "items": {
            "rat_skin": 1,
          },
        },
        "rng": 4051887320,
        "strikes": 55,
        "won": true,
      }
    `);
  });

  it('an Extreme Rat Cellar pack of 7: an ordinary Lv 30 hero is wiped out, with nothing paid (the wall)', () => {
    expect(fightFingerprint(play(openGame(30, 20261106), 'rat_cellar', 'extreme'))).toMatchInlineSnapshot(`
      {
        "difficulty": "extreme",
        "durationMs": 6000,
        "endReason": "hero_defeated",
        "heroHpEnd": 0,
        "logHash": "6e5a32c2",
        "pack": [
          "veteran:360:0",
          "veteran:360:360",
          "extreme:480:480",
          "veteran:360:360",
          "veteran:360:360",
          "veteran:360:360",
          "extreme:480:480",
        ],
        "rewards": {
          "gold": 0,
          "heroXp": 0,
          "items": {},
        },
        "rng": 76626003,
        "strikes": 47,
        "won": false,
      }
    `);
  });
});
