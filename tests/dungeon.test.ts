// Dungeon runs, combat, HP regen, skip and the one-activity rule.
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  COMBAT,
  createRng,
  dealtDamage,
  DUNGEONS,
  dungeonRunView,
  type GameState,
  hashState,
  hpView,
  newGame,
  resolveFight,
  runMsFor,
  simulate,
  skipCost,
} from '../src/engine';
import { apply, HOUR, MIN, SEC, T0, progressMs } from './helpers';

const RAT_CELLAR = { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' } as const;
const RUN_MS = 290 * SEC; // DEX 10

function withCharacter(s: GameState, patch: Partial<GameState['character']>): GameState {
  return { ...s, character: { ...s.character, ...patch } };
}

function withAttributes(s: GameState, patch: Partial<GameState['character']['attributes']>): GameState {
  return withCharacter(s, { attributes: { ...s.character.attributes, ...patch } });
}

/** The skip the UI would send for the run it shows in `s` (run number + cost on the button). */
function skipFor(s: GameState, id = 'skip') {
  const v = dungeonRunView(s);
  if (!v) throw new Error('no run');
  return { id, type: 'SKIP_DUNGEON_RUN', run: v.run, maxCost: v.skipCost } as const;
}

/** A skip for the current run that accepts any cost up to a full 5:00 run. */
function skipAny(s: GameState, id = 'skip') {
  return { id, type: 'SKIP_DUNGEON_RUN', run: s.dungeon.totals.runs + 1, maxCost: 5 } as const;
}

/** New game at T0 with Rat Cellar running. */
function dungeonGame(seed = 7, tweak: (s: GameState) => GameState = (s) => s): GameState {
  return apply(tweak(newGame(seed, T0)), RAT_CELLAR, T0);
}

describe('run time', () => {
  it('runMs = max(60 s, 300 s − 1 s × DEX), from the dungeon timing in config', () => {
    expect(DUNGEONS.rat_cellar.run).toEqual({ baseMs: 300_000, perDexterityMs: 1_000, minMs: 60_000 });
    const rc = (dexterity: number) => runMsFor('rat_cellar', { dexterity });
    expect(rc(10)).toBe(290_000); // 4:50
    expect(rc(0)).toBe(300_000);
    expect(rc(239)).toBe(61_000);
    expect(rc(240)).toBe(60_000);
    expect(rc(1_000_000)).toBe(60_000); // floor
  });

  it('a run completes exactly at runMs, and the next one starts at once', () => {
    const s = dungeonGame();
    expect(simulate(s, T0 + RUN_MS - 1).state.dungeon.totals.runs).toBe(0);
    const done = simulate(s, T0 + RUN_MS).state;
    expect(done.dungeon.totals.runs).toBe(1);
    expect(done.activity).toMatchObject({ kind: 'dungeon', progressMs: 0 });
    expect(simulate(s, T0 + 3 * RUN_MS + 5 * SEC).state).toMatchObject({
      dungeon: { totals: { runs: 3 } },
      activity: { progressMs: 5 * SEC },
    });
  });
});

describe('skip', () => {
  it('costs 1 stamina per started minute left', () => {
    expect(skipCost(5 * MIN)).toBe(5);
    expect(skipCost(2 * MIN + 10 * SEC)).toBe(3);
    expect(skipCost(30 * SEC)).toBe(1);
    expect(skipCost(MIN)).toBe(1);
    expect(skipCost(MIN + 1)).toBe(2);
    expect(skipCost(1)).toBe(1);
    expect(skipCost(0)).toBe(1); // a skip always costs something
  });

  it('spends ceil(minutes) stamina, resolves the fight now, and auto-repeat continues', () => {
    const s = dungeonGame();
    const at = T0 + 2 * MIN + 40 * SEC; // 2:10 left → 3
    const r = applyCommand(s, skipFor(simulate(s, at).state), at);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.stamina.current).toBe(97);
    expect(r.state.dungeon.totals.runs).toBe(1);
    expect(r.state.dungeon.lastFight).not.toBeNull();
    expect(r.events).toContainEqual({ type: 'FIGHT_RESOLVED', dungeonId: 'rat_cellar', won: r.state.dungeon.lastFight!.won });
    expect(r.state.activity).toMatchObject({ kind: 'dungeon', progressMs: 0 });
    // Next run is a full one from the skip.
    expect(simulate(r.state, at + RUN_MS - 1).state.dungeon.totals.runs).toBe(1);
    expect(simulate(r.state, at + RUN_MS).state.dungeon.totals.runs).toBe(2);
  });

  it('a full 5:00 run costs 5; 0:30 left costs 1', () => {
    const slow = dungeonGame(7, (g) => withAttributes(g, { dexterity: 0 }));
    const full = applyCommand(slow, skipFor(slow, 'a'), T0);
    expect(full.ok && full.state.stamina.current).toBe(95);
    const late = applyCommand(dungeonGame(), skipAny(dungeonGame(), 'b'), T0 + RUN_MS - 30 * SEC);
    expect(late.ok && late.state.stamina.current).toBe(99);
  });

  it('typed error and no change when stamina is short or no run is going', () => {
    const s = dungeonGame(7, (g) => ({ ...g, stamina: { ...g.stamina, current: 4 } }));
    const r = applyCommand(s, skipFor(s, 'x'), T0); // 4:50 left → 5
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_STAMINA' } });
    expect(s.dungeon.totals.runs).toBe(0);
    expect(s.stamina.current).toBe(4);
    const idle = applyCommand(newGame(1, T0), { id: 'y', type: 'SKIP_DUNGEON_RUN', run: 1, maxCost: 5 }, T0);
    expect(idle).toMatchObject({ ok: false, error: { code: 'NO_DUNGEON_RUN' } });
  });

  it('counts stamina regen up to now before spending', () => {
    // 4 stamina, 1 s from the 5th point. A fresh run costs 5.
    const s = dungeonGame(7, (g) => ({ ...g, stamina: { current: 4, max: 100, progressMs: 299_000 } }));
    // Without that point: refused.
    expect(applyCommand(s, skipAny(s, 'a'), T0)).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_STAMINA' } });
    // 1 s later the regen gives the 5th point (4:49 left still costs 5), so the same skip succeeds.
    const r = applyCommand(s, skipAny(s, 'b'), T0 + SEC);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.stamina.current).toBe(0);
    expect(r.state.dungeon.totals.runs).toBe(1);
  });

  it('never charges more than the button showed', () => {
    const s = dungeonGame();
    const r = applyCommand(s, { id: 'a', type: 'SKIP_DUNGEON_RUN', run: 1, maxCost: 4 }, T0); // real cost 5
    expect(r).toMatchObject({ ok: false, error: { code: 'RUN_CHANGED' } });
    expect(s.stamina.current).toBe(100);
  });

  it('never resolves two runs: a skip for a run that finished meanwhile fails with RUN_CHANGED', () => {
    const s = dungeonGame();
    const seen = simulate(s, T0 + RUN_MS - 30 * SEC).state; // 0:30 left, button shows "Skip (1)"
    const cmdSeen = skipFor(seen);
    expect(cmdSeen).toMatchObject({ run: 1, maxCost: 1 });
    // The tap lands 40 s later: run 1 finished on its own (free), run 2 has 4:40 left (cost 5).
    const r = applyCommand(seen, cmdSeen, T0 + RUN_MS + 10 * SEC);
    expect(r).toMatchObject({ ok: false, error: { code: 'RUN_CHANGED' } });
    // Even with a generous maxCost, naming run 1 can't skip run 2.
    const r2 = applyCommand(seen, { ...cmdSeen, maxCost: 5 }, T0 + RUN_MS + 10 * SEC);
    expect(r2).toMatchObject({ ok: false, error: { code: 'RUN_CHANGED' } });
    // Exactly at the boundary the run also finished on its own.
    expect(applyCommand(seen, cmdSeen, T0 + RUN_MS)).toMatchObject({ ok: false, error: { code: 'RUN_CHANGED' } });
    // 1 ms before it, the skip still works and costs what was shown.
    const ok = applyCommand(seen, cmdSeen, T0 + RUN_MS - 1);
    expect(ok.ok && [ok.state.stamina.current, ok.state.dungeon.totals.runs]).toEqual([99, 1]);
  });

  it('rejects a malformed skip', () => {
    const s = dungeonGame();
    for (const maxCost of [0, -1, 1.5, Number.NaN]) {
      expect(applyCommand(s, { id: 'a', type: 'SKIP_DUNGEON_RUN', run: 1, maxCost }, T0)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT' },
      });
    }
    expect(applyCommand(s, { id: 'b', type: 'SKIP_DUNGEON_RUN', run: 0, maxCost: 5 }, T0)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_COMMAND' },
    });
  });
});

describe('combat', () => {
  it('dealt = max(1, round(roll × 50 / (defense + 50))), half-up, integer math', () => {
    expect(COMBAT).toMatchObject({ defenseK: 50, maxRounds: 50, minDamage: 1 });
    expect(dealtDamage(100, 13)).toBe(79); // 13 defense blocks ~21%
    expect(dealtDamage(12, 2)).toBe(12); // 11.54
    expect(dealtDamage(14, 2)).toBe(13); // 13.46
    expect(dealtDamage(3, 13)).toBe(2);
    expect(dealtDamage(5, 13)).toBe(4);
    expect(dealtDamage(3, 50)).toBe(2); // exactly 1.5 rounds up
    expect(dealtDamage(10, 0)).toBe(10);
    expect(dealtDamage(1, 1_000_000)).toBe(1); // minimum 1
    expect(dealtDamage(5, -20)).toBe(5); // negative defense counts as 0
  });

  it('fixed seed → fixed fight log (hero strikes first, turns alternate)', () => {
    const hero = { hp: 50, damage: { min: 12, max: 14 }, defense: 13 };
    const rat = { hp: 30, damage: { min: 3, max: 5 }, defense: 2 };
    const a = resolveFight(hero, rat, createRng(123));
    expect(resolveFight(hero, rat, createRng(123))).toEqual(a);
    expect(a.log.map((e) => e.actor)).toEqual(['hero', 'enemy', 'hero', 'enemy', 'hero']);
    expect(a.endReason).toBe('enemy_defeated');
    expect(a).toMatchInlineSnapshot(`
      {
        "endReason": "enemy_defeated",
        "enemyHp": 0,
        "heroHp": 46,
        "log": [
          {
            "actor": "hero",
            "dealt": 13,
            "roll": 14,
            "round": 1,
            "targetHpAfter": 17,
          },
          {
            "actor": "enemy",
            "dealt": 2,
            "roll": 3,
            "round": 1,
            "targetHpAfter": 48,
          },
          {
            "actor": "hero",
            "dealt": 13,
            "roll": 13,
            "round": 2,
            "targetHpAfter": 4,
          },
          {
            "actor": "enemy",
            "dealt": 2,
            "roll": 3,
            "round": 2,
            "targetHpAfter": 46,
          },
          {
            "actor": "hero",
            "dealt": 13,
            "roll": 13,
            "round": 3,
            "targetHpAfter": 0,
          },
        ],
        "rng": {
          "seed": 567894596,
        },
        "rounds": 3,
        "won": true,
      }
    `);
    for (const e of a.log) expect(e.dealt).toBe(dealtDamage(e.roll, e.actor === 'hero' ? rat.defense : hero.defense));
  });

  it('50-round cap: a stalemate is a loss and leaves the hero at 0 HP', () => {
    const tank = { hp: 1000, damage: { min: 1, max: 1 }, defense: 1_000_000 };
    const r = resolveFight(tank, tank, createRng(1));
    expect(r.rounds).toBe(50);
    expect(r.log).toHaveLength(100);
    expect(r.won).toBe(false);
    expect(r.endReason).toBe('round_cap');
    expect(r.heroHp).toBe(0);
    expect(r.log.at(-1)).toMatchObject({ round: 50, actor: 'enemy', targetHpAfter: 950 });
  });

  it('starting at 0 HP is an immediate loss with no rolls', () => {
    const rng = createRng(9);
    const r = resolveFight({ hp: 0, damage: { min: 12, max: 14 }, defense: 13 }, { hp: 30, damage: { min: 3, max: 5 }, defense: 2 }, rng);
    expect(r).toEqual({ won: false, endReason: 'no_hp', rounds: 0, heroHp: 0, enemyHp: 30, log: [], rng });
  });
});

describe('rewards', () => {
  /** Finds a seed whose first Rat Cellar run (full HP) wins with or without the Rat Skin drop. */
  function seedWhere(skin: boolean): number {
    for (let seed = 1; seed < 200; seed++) {
      const f = simulate(dungeonGame(seed), T0 + RUN_MS).state.dungeon.lastFight!;
      if (f.won && (f.rewards.items.rat_skin === 1) === skin) return seed;
    }
    throw new Error('no seed');
  }

  it('win: +25 hero XP, 2–5 gold, Rat Skin 50%; the hero keeps the HP left', () => {
    for (const skin of [true, false]) {
      const s = dungeonGame(seedWhere(skin));
      const r = simulate(s, T0 + RUN_MS);
      const f = r.state.dungeon.lastFight!;
      expect(f.won).toBe(true);
      expect(f.endReason).toBe('enemy_defeated');
      expect(f.rewards.heroXp).toBe(25);
      expect(f.rewards.gold).toBeGreaterThanOrEqual(2);
      expect(f.rewards.gold).toBeLessThanOrEqual(5);
      expect(r.state.character.xp).toBe(25);
      expect(r.state.character.gold).toBe(s.character.gold + f.rewards.gold);
      expect(r.state.inventory.items.some((i) => i.defId === 'rat_skin')).toBe(skin);
      expect(r.state.character.hp).toBe(f.heroHpEnd);
      expect(f.heroHpStart).toBe(50);
      expect(f.heroHpEnd).toBe(f.log.filter((e) => e.actor === 'enemy').reduce((hp, e) => hp - e.dealt, 50));
      expect(r.summary).toMatchObject({ heroXpGained: 25, goldGained: f.rewards.gold, dungeon: { runs: 1, wins: 1, losses: 0 } });
      expect(r.summary.itemsGained.rat_skin ?? 0).toBe(skin ? 1 : 0);
      expect(r.state.dungeon.totals).toEqual({ runs: 1, wins: 1, losses: 0 });
    }
  });

  it('XP goes through addXp: a win at the level threshold levels up and carries the excess', () => {
    const s = dungeonGame(seedWhere(false), (g) => withCharacter(g, { xp: 1490 }));
    const r = simulate(s, T0 + RUN_MS).state;
    expect([r.character.level, r.character.xp]).toEqual([2, 15]);
  });

  it('full inventory: the Rat Skin is lost, like woodcutting drops', () => {
    const s = dungeonGame(seedWhere(true), (g) => ({ ...g, inventory: { ...g.inventory, capacity: g.inventory.items.length } }));
    const r = simulate(s, T0 + RUN_MS);
    const f = r.state.dungeon.lastFight!;
    expect(f.rewards.items).toEqual({});
    expect(f.rewards.itemsLost).toEqual({ rat_skin: 1 });
    expect(r.summary.itemsLost).toEqual({ rat_skin: 1 });
    expect(r.state.inventory.items.some((i) => i.defId === 'rat_skin')).toBe(false);
    expect(f.rewards.gold).toBeGreaterThan(0); // gold and XP still count
  });

  it('loss: no XP, no gold, no loot; the hero ends at 0 HP', () => {
    // From 0 HP with END 0 (5/min, defense 3) and DEX 240 (60 s runs): the fight starts at 5 HP.
    // The rat needs 3 hero hits; its 2 strikes of 3–5 always kill 5 HP first.
    const s = dungeonGame(3, (g) => withAttributes(withCharacter(g, { hp: 0 }), { endurance: 0, dexterity: 240 }));
    const r = simulate(s, T0 + MIN);
    const f = r.state.dungeon.lastFight!;
    expect(f.heroHpStart).toBe(5);
    expect(f.won).toBe(false);
    expect(f.endReason).toBe('hero_defeated');
    expect(f.rewards).toEqual({ heroXp: 0, gold: 0, items: {}, itemsLost: {} });
    expect(r.state.character).toMatchObject({ hp: 0, xp: 0, gold: s.character.gold });
    expect(r.summary).toMatchObject({ heroXpGained: 0, goldGained: 0, dungeon: { runs: 1, wins: 0, losses: 1 } });
  });

  it('only the last fight is stored', () => {
    const s = simulate(dungeonGame(), T0 + 10 * RUN_MS).state;
    expect(s.dungeon.totals.runs).toBe(10);
    expect(Object.keys(s.dungeon).sort()).toEqual(['byDungeon', 'lastFight', 'totals']);
    expect(s.dungeon.byDungeon).toEqual({ rat_cellar: s.dungeon.totals }); // counters only, no per-run log
    expect(s.dungeon.lastFight?.log.length).toBeLessThanOrEqual(2 * COMBAT.maxRounds);
  });
});

describe('HP regen', () => {
  const hurt = (hp: number, tweak: (s: GameState) => GameState = (s) => s) => tweak(withCharacter(newGame(5, T0), { hp }));

  it('flat 5 + END per minute: 15/min at END 10, remainder kept', () => {
    expect(hpView(newGame(1, T0))).toMatchObject({ hp: 50, maxHp: 50, regenPerMin: 15, full: true });
    const s = hurt(10);
    expect(simulate(s, T0 + MIN).state.character).toMatchObject({ hp: 25, hpRegenProgress: 0 });
    expect(simulate(s, T0 + 4 * SEC).state.character.hp).toBe(11); // 1 HP every 4 s
    expect(simulate(s, T0 + 4 * SEC - 1).state.character).toMatchObject({ hp: 10, hpRegenProgress: 59_985 });
    expect(simulate(hurt(10, (g) => withAttributes(g, { endurance: 0 })), T0 + MIN).state.character.hp).toBe(15);
    expect(hpView(s)).toMatchObject({ hp: 10, regenPerMin: 15, full: false, fullInMs: 160 * SEC });
  });

  it('many small resumes equal one big resume', () => {
    const s = hurt(3);
    const once = simulate(s, T0 + 2 * MIN + 13 * SEC).state;
    let step = s;
    for (let t = 7 * SEC; t <= 2 * MIN + 13 * SEC; t += 7 * SEC) step = simulate(step, T0 + t).state;
    step = simulate(step, T0 + 2 * MIN + 13 * SEC).state;
    expect(step.character).toEqual(once.character);
    expect(hashState(step)).toBe(hashState(once));
  });

  it('caps at max HP with no banked remainder; full HP keeps its character object', () => {
    const full = simulate(hurt(49), T0 + HOUR).state;
    expect(full.character).toMatchObject({ hp: 50, hpRegenProgress: 0 });
    const s = newGame(1, T0);
    expect(simulate(s, T0 + HOUR).state.character).toBe(s.character);
  });

  it('runs while woodcutting and while idle', () => {
    const wood = apply(hurt(10), { type: 'START_ACTIVITY', kind: 'woodcutting' }, T0);
    const r = simulate(wood, T0 + MIN).state;
    expect(r.character.hp).toBe(25);
    expect(r.stats.totalActions).toBe(20);
  });

  it('clock moved back: no regen until real time passes the highest time seen', () => {
    const s = simulate(hurt(10), T0 + 10 * SEC).state; // +2 (8 s), 2 s banked
    expect(s.character.hp).toBe(12);
    const back = simulate(s, T0 + 10 * SEC - 2 * HOUR).state;
    expect(back.character).toEqual(s.character);
    expect(simulate(back, T0 + 5 * SEC).state.character).toEqual(s.character);
    expect(simulate(back, T0 + 14 * SEC).state.character.hp).toBe(13);
  });

  it('not limited by the 8h cap (max HP bounds it)', () => {
    // Level 500 → max 5040. END 0 → 5/min. 12h = 3600 HP; the 8h cap would give 2400.
    const s = hurt(0, (g) => withAttributes(withCharacter(g, { level: 500 }), { endurance: 0 }));
    const r = simulate(s, T0 + 12 * HOUR);
    expect(r.summary.grantedMs).toBe(8 * HOUR);
    expect(r.state.character.hp).toBe(3600);
    expect(simulate(s, T0 + 365 * 24 * HOUR).state.character).toMatchObject({ hp: 5040, hpRegenProgress: 0 });
  });

  it('invalid time is a no-op', () => {
    const s = hurt(10);
    expect(simulate(s, Number.NaN).state).toBe(s);
  });
});

describe('offline catch-up', () => {
  it('the 8h cap limits the number of runs', () => {
    const r = simulate(dungeonGame(), T0 + 20 * HOUR);
    expect(r.summary.grantedMs).toBe(8 * HOUR);
    expect(r.summary.dungeon.runs).toBe(Math.floor((8 * HOUR) / RUN_MS)); // 99
    expect(r.state.dungeon.totals.runs).toBe(99);
    expect(progressMs(r.state)).toBe(8 * HOUR - 99 * RUN_MS);
  });

  it('30 minutes away → 6 runs, rewards summed, HP consistent', () => {
    const s = dungeonGame();
    const r = simulate(s, T0 + 30 * MIN);
    expect(r.summary.dungeon).toEqual({ runs: 6, wins: 6, losses: 0 });
    expect(r.summary.heroXpGained).toBe(150);
    expect(r.state.character.gold - s.character.gold).toBe(r.summary.goldGained);
    // 30 − 6 × 4:50 = 1:00 of regen after the last fight: +15 or full.
    expect(r.state.character.hp).toBe(Math.min(50, r.state.dungeon.lastFight!.heroHpEnd + 15));
  });

  it('regen and runs interleave in time order: each fight sees the HP regenerated during its run', () => {
    // END 0 (5/min), DEX 240 (60 s runs): every run regens exactly 5 HP; every fight at 5 HP is lost → back to 0.
    const s = dungeonGame(3, (g) => withAttributes(withCharacter(g, { hp: 0 }), { endurance: 0, dexterity: 240 }));
    const r = simulate(s, T0 + 10 * MIN + 30 * SEC);
    expect(r.state.dungeon.totals).toEqual({ runs: 10, wins: 0, losses: 10 });
    expect(r.state.dungeon.lastFight?.heroHpStart).toBe(5);
    // After the 10th loss (0 HP), 30 s of regen at 5/min: 2 HP and 2.5 → 30 000 units banked.
    expect(r.state.character).toMatchObject({ hp: 2, hpRegenProgress: 30_000 });
    expect(progressMs(r.state)).toBe(30 * SEC);
  });

  it('a chain at low HP: the next run starts at once whatever the HP, and regen carries the hero back', () => {
    // From 1 HP with normal stats a 4:50 run regens 72 HP, so the first fight is at full HP and won.
    const s = dungeonGame(11, (g) => withCharacter(g, { hp: 1 }));
    const r = simulate(s, T0 + 3 * RUN_MS).state;
    expect(r.dungeon.totals.runs).toBe(3);
    expect(r.dungeon.lastFight?.heroHpStart).toBe(50);
  });

  it('1 s ticks give the same state as one resume (runs, fights, regen, rng)', () => {
    const s = dungeonGame(21, (g) => withCharacter(g, { hp: 7 }));
    const end = T0 + 17 * MIN + 3 * SEC;
    const once = simulate(s, end).state;
    let step = s;
    for (let t = T0 + SEC; t <= end; t += SEC) step = simulate(step, t).state;
    expect(hashState(step)).toBe(hashState(once));
    expect(once.dungeon.totals.runs).toBe(3);
  });

  it('clock moved back pauses runs and regen', () => {
    const s = simulate(dungeonGame(2, (g) => withCharacter(g, { hp: 20 })), T0 + 2 * MIN).state;
    const back = simulate(s, T0 + 2 * MIN - 2 * HOUR);
    expect(back.state).toBe(s);
    expect(back.summary.anomalies[0]).toMatchObject({ kind: 'backward' });
    // Real time catches up: only time after the highest seen counts.
    const later = simulate(back.state, T0 + 2 * MIN + 10 * SEC).state;
    expect(progressMs(later)).toBe(2 * MIN + 10 * SEC);
  });
});

describe('one activity at a time', () => {
  it('starting woodcutting cancels the run in progress: no fight, no rewards', () => {
    const s = dungeonGame();
    const r = applyCommand(s, { id: 'w', type: 'START_ACTIVITY', kind: 'woodcutting' }, T0 + 4 * MIN);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.activity).toMatchObject({ kind: 'woodcutting', progressMs: 0 });
    expect(r.state.dungeon).toEqual(s.dungeon);
    expect(r.state.character).toMatchObject({ xp: 0, gold: s.character.gold });
    expect(r.state.rng).toEqual(s.rng);
    expect(r.events).toContainEqual({ type: 'DUNGEON_RUN_CANCELLED', dungeonId: 'rat_cellar' });
    expect(r.events).toContainEqual({ type: 'ACTIVITY_STOPPED', kind: 'dungeon' });
  });

  it('runs that finished before the switch are kept; only the current one is lost', () => {
    const r = applyCommand(dungeonGame(), { id: 'w', type: 'START_ACTIVITY', kind: 'woodcutting' }, T0 + RUN_MS + 3 * MIN);
    expect(r.ok && r.state.dungeon.totals.runs).toBe(1);
  });

  it('stopping the dungeon also loses the current run', () => {
    const r = applyCommand(dungeonGame(), { id: 's', type: 'STOP_ACTIVITY' }, T0 + 4 * MIN);
    expect(r.ok && r.state.activity).toBeNull();
    expect(r.ok && r.state.dungeon.totals.runs).toBe(0);
    expect(r.ok && r.events).toContainEqual({ type: 'DUNGEON_RUN_CANCELLED', dungeonId: 'rat_cellar' });
  });

  it('starting a dungeon stops woodcutting (logs gathered so far are kept)', () => {
    const wood = apply(newGame(1, T0), { type: 'START_ACTIVITY', kind: 'woodcutting' }, T0);
    const r = applyCommand(wood, { id: 'd', ...RAT_CELLAR }, T0 + 10 * SEC);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.activity).toEqual({ kind: 'dungeon', dungeonId: 'rat_cellar', startedAt: T0 + 10 * SEC, progressMs: 0 });
    expect(r.state.stats.totalActions).toBe(3);
  });

  it('starting the same dungeon again keeps the current run; unknown dungeons are refused', () => {
    const s = dungeonGame();
    const again = applyCommand(s, { id: 'd', ...RAT_CELLAR }, T0 + MIN);
    expect(again.ok && progressMs(again.state)).toBe(MIN);
    const bad = applyCommand(s, { id: 'x', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'nope' as never }, T0);
    expect(bad).toMatchObject({ ok: false, error: { code: 'UNKNOWN_DUNGEON' } });
  });

  it('a dungeon can start at 0 HP: the fight is an immediate loss, then regen carries on', () => {
    const s = dungeonGame(1, (g) => withAttributes(withCharacter(g, { hp: 0 }), { endurance: -5 })); // rate 0
    const r = simulate(s, T0 + RUN_MS).state;
    expect(r.dungeon.lastFight).toMatchObject({ won: false, endReason: 'no_hp', rounds: 0, heroHpStart: 0, log: [] });
  });
});

describe('debug commands', () => {
  it('DEBUG_SET_HERO_HP sets HP (0..max), resets the regen remainder and flags the save', () => {
    const s = simulate(withCharacter(newGame(1, T0), { hp: 10 }), T0 + 3 * SEC).state; // progress banked
    const r = applyCommand(s, { id: 'h', type: 'DEBUG_SET_HERO_HP', hp: 1 }, T0 + 3 * SEC);
    expect(r.ok && r.state.character).toMatchObject({ hp: 1, hpRegenProgress: 0 });
    expect(r.ok && r.state.flags.debugUsed).toBe(true);
    for (const hp of [-1, 51, 1.5, Number.NaN]) {
      expect(applyCommand(s, { id: 'h', type: 'DEBUG_SET_HERO_HP', hp }, T0)).toMatchObject({ ok: false, error: { code: 'INVALID_AMOUNT' } });
    }
  });

  it('DEBUG_FINISH_DUNGEON_RUN resolves the run for free and flags the save', () => {
    const r = applyCommand(dungeonGame(), { id: 'f', type: 'DEBUG_FINISH_DUNGEON_RUN' }, T0 + MIN);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.stamina.current).toBe(100);
    expect(r.state.dungeon.totals.runs).toBe(1);
    expect(progressMs(r.state)).toBe(0);
    expect(r.state.flags.debugUsed).toBe(true);
    expect(applyCommand(newGame(1, T0), { id: 'g', type: 'DEBUG_FINISH_DUNGEON_RUN' }, T0)).toMatchObject({
      ok: false,
      error: { code: 'NO_DUNGEON_RUN' },
    });
  });

  it('HP → 1, then a run still fights, after regenerating during the run', () => {
    const s = apply(dungeonGame(4), { type: 'DEBUG_SET_HERO_HP', hp: 1 }, T0);
    const f = simulate(s, T0 + RUN_MS).state.dungeon.lastFight!;
    expect(f.heroHpStart).toBe(Math.min(50, 1 + Math.floor((RUN_MS * 15) / MIN))); // 1 + 72 → full 50
    const now = apply(dungeonGame(4), { type: 'DEBUG_SET_HERO_HP', hp: 1 }, T0);
    const skipNow = applyCommand(now, { id: 'f', type: 'DEBUG_FINISH_DUNGEON_RUN' }, T0);
    expect(skipNow.ok && skipNow.state.dungeon.lastFight).toMatchObject({ heroHpStart: 1, won: false, heroHpEnd: 0 });
  });
});
