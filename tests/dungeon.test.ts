// Dungeon runs (search + live fight), combat, HP regen, skip and the one-activity rule.
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
  searchMsFor,
  simulate,
  skipCost,
} from '../src/engine';
import { apply, HOUR, MIN, SEC, T0, progressMs, builtGame } from './helpers';

const RAT_CELLAR = { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' } as const;
const SEARCH_MS = 110 * SEC; // Rat Cellar at DEX 10
const FIGHT_MS = COMBAT.maxFightMs;
const ONE_SECOND = { attackIntervalMs: 1000 };

function withCharacter(s: GameState, patch: Partial<GameState['character']>): GameState {
  return { ...s, character: { ...s.character, ...patch } };
}

function withAttributes(s: GameState, patch: Partial<GameState['character']['attributes']>): GameState {
  return withCharacter(s, { attributes: { ...s.character.attributes, ...patch } });
}

/** The skip the UI would send for the search it shows in `s` (run number + cost on the button). */
function skipFor(s: GameState, id = 'skip') {
  const v = dungeonRunView(s);
  if (!v || v.skipCost === null) throw new Error('no search');
  return { id, type: 'SKIP_DUNGEON_RUN', run: v.run, maxCost: v.skipCost } as const;
}

/** A skip for the current run that accepts any cost up to a full 2:00 search. */
function skipAny(s: GameState, id = 'skip') {
  return { id, type: 'SKIP_DUNGEON_RUN', run: s.dungeon.totals.runs + 1, maxCost: 2 } as const;
}

/** New game at T0 with Rat Cellar running. */
function dungeonGame(seed = 7, tweak: (s: GameState) => GameState = (s) => s): GameState {
  return apply(tweak(builtGame(seed, T0)), RAT_CELLAR, T0);
}

/** The first run of a dungeonGame, played to its end (search + fight; the next search has just begun or is under way). */
function firstRun(s: GameState) {
  const r = simulate(s, T0 + SEARCH_MS + FIGHT_MS);
  const f = r.state.dungeon.lastFight;
  if (r.state.dungeon.totals.runs !== 1 || !f) throw new Error('first run did not finish');
  return { ...r, fight: f, endsAt: T0 + SEARCH_MS + f.durationMs };
}

describe('search time', () => {
  it('searchMs = max(60 s, 120 s − 1 s × DEX), from the dungeon timing in config', () => {
    expect(DUNGEONS.rat_cellar.search).toEqual({ baseMs: 120_000, perDexterityMs: 1_000, minMs: 60_000 });
    const rc = (dexterity: number) => searchMsFor('rat_cellar', { dexterity });
    expect(rc(10)).toBe(110_000); // 1:50
    expect(rc(0)).toBe(120_000);
    expect(rc(59)).toBe(61_000);
    expect(rc(60)).toBe(60_000);
    expect(rc(1_000_000)).toBe(60_000); // floor
  });

  it('the search ends exactly at searchMs and the fight starts then; the run counts when the fight ends', () => {
    const s = dungeonGame();
    const before = simulate(s, T0 + SEARCH_MS - 1).state;
    expect(before.activity).toMatchObject({ phase: 'search', progressMs: SEARCH_MS - 1, fight: null });
    const atEnd = simulate(s, T0 + SEARCH_MS).state;
    expect(atEnd.activity).toMatchObject({ phase: 'fight', progressMs: 0 });
    expect(atEnd.activity?.kind === 'dungeon' && atEnd.activity.fight).toMatchObject({ elapsedMs: 0, log: [], heroStrikes: 0, enemyStrikes: 0 });
    expect(atEnd.dungeon.totals.runs).toBe(0);
    const { state, endsAt, fight } = firstRun(s);
    expect(fight.durationMs).toBeGreaterThan(0);
    expect(simulate(s, endsAt - 1).state.dungeon.totals.runs).toBe(0);
    expect(simulate(s, endsAt).state.activity).toMatchObject({ phase: 'search', progressMs: 0, fight: null });
    // The next search starts at once.
    expect(progressMs(state)).toBe(T0 + SEARCH_MS + FIGHT_MS - endsAt);
  });
});

describe('skip (search only)', () => {
  it('costs 1 stamina per started minute left', () => {
    expect(skipCost(5 * MIN)).toBe(5);
    expect(skipCost(2 * MIN + 10 * SEC)).toBe(3);
    expect(skipCost(30 * SEC)).toBe(1);
    expect(skipCost(MIN)).toBe(1);
    expect(skipCost(MIN + 1)).toBe(2);
    expect(skipCost(1)).toBe(1);
    expect(skipCost(0)).toBe(1); // a skip always costs something
  });

  it('spends ceil(minutes) stamina and ends the search now; the fight then plays live from that moment', () => {
    const s = dungeonGame();
    const at = T0 + 40 * SEC; // 1:10 left → 2
    const r = applyCommand(s, skipFor(simulate(s, at).state), at);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.stamina.current).toBe(98);
    expect(r.state.dungeon.totals.runs).toBe(0); // nothing resolved yet
    expect(r.events.some((e) => e.type === 'FIGHT_RESOLVED')).toBe(false);
    expect(r.state.activity).toMatchObject({ kind: 'dungeon', phase: 'fight', progressMs: 0 });
    // One second later the hero's first strike has landed.
    const t1 = simulate(r.state, at + SEC).state;
    expect(t1.activity?.kind === 'dungeon' && t1.activity.fight?.log.map((e) => [e.actor, e.atMs])).toEqual([
      ['hero', 1000],
      ['enemy', 1000],
    ]);
    // The run ends with its fight, then a full search starts.
    const done = simulate(r.state, at + FIGHT_MS).state;
    expect(done.dungeon.totals.runs).toBe(1);
    const fightEnd = at + done.dungeon.lastFight!.durationMs;
    expect(simulate(r.state, fightEnd + SEARCH_MS - 1).state.activity).toMatchObject({ phase: 'search' });
    expect(simulate(r.state, fightEnd + SEARCH_MS).state.activity).toMatchObject({ phase: 'fight' });
  });

  it('a full 2:00 search costs 2; 0:30 left costs 1', () => {
    const slow = dungeonGame(7, (g) => withAttributes(g, { dexterity: 0 }));
    const full = applyCommand(slow, skipFor(slow, 'a'), T0);
    expect(full.ok && full.state.stamina.current).toBe(98);
    const late = applyCommand(dungeonGame(), skipAny(dungeonGame(), 'b'), T0 + SEARCH_MS - 30 * SEC);
    expect(late.ok && late.state.stamina.current).toBe(99);
  });

  it('typed error and no change when stamina is short or no run is going', () => {
    const s = dungeonGame(7, (g) => ({ ...g, stamina: { ...g.stamina, current: 1 } }));
    const r = applyCommand(s, skipFor(s, 'x'), T0); // 1:50 left → 2
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_STAMINA' } });
    expect(s.dungeon.totals.runs).toBe(0);
    expect(s.stamina.current).toBe(1);
    const idle = applyCommand(builtGame(1, T0), { id: 'y', type: 'SKIP_DUNGEON_RUN', run: 1, maxCost: 5 }, T0);
    expect(idle).toMatchObject({ ok: false, error: { code: 'NO_DUNGEON_RUN' } });
  });

  it('counts stamina regen up to now before spending', () => {
    // 1 stamina, 1 s from the 2nd point. A fresh search costs 2.
    const s = dungeonGame(7, (g) => ({ ...g, stamina: { current: 1, max: 100, progressMs: 299_000 } }));
    expect(applyCommand(s, skipAny(s, 'a'), T0)).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_STAMINA' } });
    // 1 s later the regen gives the 2nd point (1:49 left still costs 2), so the same skip succeeds.
    const r = applyCommand(s, skipAny(s, 'b'), T0 + SEC);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.stamina.current).toBe(0);
    expect(r.state.activity).toMatchObject({ phase: 'fight' });
  });

  it('never charges more than the button showed', () => {
    const s = dungeonGame();
    const r = applyCommand(s, { id: 'a', type: 'SKIP_DUNGEON_RUN', run: 1, maxCost: 1 }, T0); // real cost 2
    expect(r).toMatchObject({ ok: false, error: { code: 'RUN_CHANGED' } });
    expect(s.stamina.current).toBe(100);
  });

  it('a tap that lands after the search ended: FIGHT_IN_PROGRESS (fight on) or RUN_CHANGED (run over); nothing spent', () => {
    const s = dungeonGame();
    const seen = simulate(s, T0 + SEARCH_MS - 30 * SEC).state; // 0:30 left, button shows "Skip (1)"
    const cmdSeen = skipFor(seen);
    expect(cmdSeen).toMatchObject({ run: 1, maxCost: 1 });
    // Exactly at the end of the search the fight has started: the fight is never skippable.
    expect(applyCommand(seen, cmdSeen, T0 + SEARCH_MS)).toMatchObject({ ok: false, error: { code: 'FIGHT_IN_PROGRESS' } });
    // After run 1's fight, run 2 is searching: naming run 1 can't skip run 2, even with a generous maxCost.
    const { endsAt } = firstRun(s);
    expect(applyCommand(seen, cmdSeen, endsAt + SEC)).toMatchObject({ ok: false, error: { code: 'RUN_CHANGED' } });
    expect(applyCommand(seen, { ...cmdSeen, maxCost: 2 }, endsAt + SEC)).toMatchObject({ ok: false, error: { code: 'RUN_CHANGED' } });
    // 1 ms before the search ends, the skip still works and costs what was shown.
    const ok = applyCommand(seen, cmdSeen, T0 + SEARCH_MS - 1);
    expect(ok.ok && [ok.state.stamina.current, ok.state.activity?.kind === 'dungeon' && ok.state.activity.phase]).toEqual([99, 'fight']);
  });

  it('during the fight the skip is refused with FIGHT_IN_PROGRESS and nothing changes', () => {
    const s = apply(dungeonGame(), skipAny(dungeonGame()), T0);
    const mid = simulate(s, T0 + SEC).state;
    const r = applyCommand(mid, { id: 'again', type: 'SKIP_DUNGEON_RUN', run: 1, maxCost: 2 }, T0 + SEC);
    expect(r).toMatchObject({ ok: false, error: { code: 'FIGHT_IN_PROGRESS' } });
    expect(dungeonRunView(mid)).toMatchObject({ phase: 'fight', skipCost: null, remainingMs: 0 });
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
    expect(COMBAT).toMatchObject({ defenseK: 50, maxFightMs: 60_000, minDamage: 1 });
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

  it('fixed seed → fixed fight log; with equal 1 s intervals the rolls are exactly the old alternating fight', () => {
    const hero = { hp: 50, damage: { min: 12, max: 14 }, defense: 13, ...ONE_SECOND };
    const rat = { hp: 30, damage: { min: 3, max: 5 }, defense: 2, ...ONE_SECOND };
    const a = resolveFight(hero, rat, createRng(123));
    expect(resolveFight(hero, rat, createRng(123))).toEqual(a);
    // Same rolls, dealt, HP and final seed as the 1.7.0 turn-based fight (pinned there as rounds 1–3).
    expect(a.log.map((e) => [e.atMs, e.actor, e.strike, e.roll, e.dealt, e.targetHpAfter])).toEqual([
      [1000, 'hero', 1, 14, 13, 17],
      [1000, 'enemy', 1, 3, 2, 48],
      [2000, 'hero', 2, 13, 13, 4],
      [2000, 'enemy', 2, 3, 2, 46],
      [3000, 'hero', 3, 13, 13, 0],
    ]);
    expect(a).toMatchObject({ won: true, endReason: 'enemy_defeated', durationMs: 3000, heroHp: 46, enemyHp: 0, rng: { seed: 567894596 } });
    for (const e of a.log) expect(e.dealt).toBe(dealtDamage(e.roll, e.actor === 'hero' ? rat.defense : hero.defense));
  });

  it('time limit: a stalemate is a loss at 60 s that leaves the hero at 0 HP; strikes due at exactly 60 s still land', () => {
    const tank = { hp: 1000, damage: { min: 1, max: 1 }, defense: 1_000_000, ...ONE_SECOND };
    const r = resolveFight(tank, tank, createRng(1));
    expect(r.log).toHaveLength(120);
    expect(r).toMatchObject({ won: false, endReason: 'time_limit', durationMs: 60_000, heroHp: 0, enemyHp: 940 });
    expect(r.log.at(-1)).toMatchObject({ atMs: 60_000, strike: 60, actor: 'enemy', targetHpAfter: 940 });
  });

  it('starting at 0 HP is an immediate loss with no rolls', () => {
    const rng = createRng(9);
    const r = resolveFight({ hp: 0, damage: { min: 12, max: 14 }, defense: 13, ...ONE_SECOND }, { hp: 30, damage: { min: 3, max: 5 }, defense: 2, ...ONE_SECOND }, rng);
    expect(r).toEqual({ won: false, endReason: 'no_hp', durationMs: 0, heroHp: 0, enemyHp: 30, log: [], rng });
  });
});

describe('rewards', () => {
  /** Finds a seed whose first Rat Cellar run (full HP) wins with or without the Rat Skin drop. */
  function seedWhere(skin: boolean): number {
    for (let seed = 1; seed < 200; seed++) {
      const f = firstRun(dungeonGame(seed)).fight;
      if (f.won && (f.rewards.items.rat_skin === 1) === skin) return seed;
    }
    throw new Error('no seed');
  }

  it('win: +35 hero XP, 2–5 gold, Rat Skin 50%; the hero keeps the HP left (regen during the fight included)', () => {
    for (const skin of [true, false]) {
      const s = dungeonGame(seedWhere(skin));
      const r = firstRun(s);
      const f = r.fight;
      expect(f.won).toBe(true);
      expect(f.endReason).toBe('enemy_defeated');
      expect(f.rewards.heroXp).toBe(35);
      expect(f.rewards.gold).toBeGreaterThanOrEqual(2);
      expect(f.rewards.gold).toBeLessThanOrEqual(5);
      expect(r.state.character.xp).toBe(35);
      expect(r.state.character.gold).toBe(s.character.gold + f.rewards.gold);
      expect(r.state.inventory.items.some((i) => i.defId === 'rat_skin')).toBe(skin);
      expect(f.heroHpStart).toBe(50);
      // Full HP at the start: the hits taken, plus 1 HP per 4 s of regen (15/min) after the first one.
      const atEnd = simulate(s, r.endsAt).state;
      expect(atEnd.character.hp).toBe(f.heroHpEnd);
      const hits = f.log.filter((e) => e.actor === 'enemy');
      if (hits.length > 0) expect(f.heroHpEnd).toBe(Math.min(50, hits.at(-1)!.targetHpAfter + Math.floor(((f.durationMs - hits.at(-1)!.atMs) * 15) / MIN)));
      expect(r.summary).toMatchObject({ heroXpGained: 35, goldGained: f.rewards.gold, dungeon: { runs: 1, wins: 1, losses: 0 } });
      expect(r.summary.itemsGained.rat_skin ?? 0).toBe(skin ? 1 : 0);
      expect(r.state.dungeon.totals).toEqual({ runs: 1, wins: 1, losses: 0 });
    }
  });

  it('XP goes through addXp: a win at the level threshold levels up and carries the excess', () => {
    const s = dungeonGame(seedWhere(false), (g) => withCharacter(g, { xp: 90 }));
    const r = firstRun(s).state;
    expect([r.character.level, r.character.xp, r.character.xpToNext]).toEqual([2, 25, 283]);
  });

  it('full inventory: the Rat Skin is lost, like woodcutting drops', () => {
    const s = dungeonGame(seedWhere(true), (g) => ({ ...g, inventory: { ...g.inventory, capacity: g.inventory.items.length } }));
    const r = firstRun(s);
    const f = r.fight;
    expect(f.rewards.items).toEqual({});
    expect(f.rewards.itemsLost).toEqual({ rat_skin: 1 });
    expect(r.summary.itemsLost).toEqual({ rat_skin: 1 });
    expect(r.state.inventory.items.some((i) => i.defId === 'rat_skin')).toBe(false);
    expect(f.rewards.gold).toBeGreaterThan(0); // gold and XP still count
  });

  it('loss: no XP, no gold, no loot; the hero ends at 0 HP', () => {
    // From 0 HP with END 0 (5/min, defense 3) and DEX 60 (60 s searches): the fight starts at 5 HP.
    // The rat needs 3 hero hits; its strikes at 1 s and 2 s (3–5 each after defense) kill 5 HP first.
    const s = dungeonGame(3, (g) => withAttributes(withCharacter(g, { hp: 0 }), { endurance: 0, dexterity: 60 }));
    const r = simulate(s, T0 + MIN + 10 * SEC);
    const f = r.state.dungeon.lastFight!;
    expect(f.heroHpStart).toBe(5);
    expect(f.won).toBe(false);
    expect(f.endReason).toBe('hero_defeated');
    expect(f.rewards).toEqual({ heroXp: 0, gold: 0, items: {}, itemsLost: {} });
    expect(r.state.character).toMatchObject({ xp: 0, gold: s.character.gold });
    expect(simulate(s, T0 + MIN + f.durationMs).state.character.hp).toBe(0);
    expect(r.summary).toMatchObject({ heroXpGained: 0, goldGained: 0, dungeon: { runs: 1, wins: 0, losses: 1 } });
  });

  it('only the last fight is stored', () => {
    const s = simulate(dungeonGame(), T0 + 10 * (SEARCH_MS + 10 * SEC)).state;
    expect(s.dungeon.totals.runs).toBe(10);
    expect(Object.keys(s.dungeon).sort()).toEqual(['byDungeon', 'lastFight', 'totals']);
    expect(s.dungeon.byDungeon).toEqual({ rat_cellar: s.dungeon.totals }); // counters only, no per-run log
    expect(s.dungeon.lastFight?.log.length).toBeLessThanOrEqual(2 * (COMBAT.maxFightMs / 1000));
  });
});

describe('HP regen', () => {
  const hurt = (hp: number, tweak: (s: GameState) => GameState = (s) => s) => tweak(withCharacter(builtGame(5, T0), { hp }));

  it('flat 5 + END per minute: 15/min at END 10, remainder kept', () => {
    expect(hpView(builtGame(1, T0))).toMatchObject({ hp: 50, maxHp: 50, regenPerMin: 15, full: true });
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
    const s = builtGame(1, T0);
    expect(simulate(s, T0 + HOUR).state.character).toBe(s.character);
  });

  it('runs while woodcutting and while idle', () => {
    const wood = apply(hurt(10), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0);
    const r = simulate(wood, T0 + 2 * MIN).state;
    expect(r.character.hp).toBe(40);
    expect(r.stats.totalActions).toBe(1);
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
  it('the 8h cap limits the number of runs (search + fight each)', () => {
    const r = simulate(dungeonGame(), T0 + 20 * HOUR);
    expect(r.summary.grantedMs).toBe(8 * HOUR);
    const runs = r.state.dungeon.totals.runs;
    expect(r.summary.dungeon.runs).toBe(runs);
    // Each run takes 1:50 + its fight (a few seconds for a fresh hero vs the Rat, never more than 60 s).
    expect(runs).toBeLessThanOrEqual(Math.floor((8 * HOUR) / (SEARCH_MS + SEC)));
    expect(runs).toBeGreaterThanOrEqual(Math.floor((8 * HOUR) / (SEARCH_MS + 10 * SEC)));
    // The rest of the capped time is not lost: it sits in the run in progress.
    expect(simulate(dungeonGame(), T0 + 8 * HOUR).state).toEqual({ ...r.state, time: { lastSimulatedAt: T0 + 8 * HOUR, highestSeenAt: T0 + 8 * HOUR } });
  });

  it('30 minutes away → runs back to back, rewards summed, HP consistent', () => {
    const s = dungeonGame();
    const r = simulate(s, T0 + 30 * MIN);
    expect(r.summary.dungeon.runs).toBeGreaterThanOrEqual(14);
    expect(r.summary.dungeon).toEqual({ runs: r.summary.dungeon.runs, wins: r.summary.dungeon.runs, losses: 0 });
    expect(r.summary.heroXpGained).toBe(35 * r.summary.dungeon.wins);
    expect(r.state.character.gold - s.character.gold).toBe(r.summary.goldGained);
    // The time since the last fight is in the current search, and the hero regenerated 15/min over it (the
    // remainder banked during the fight may add one more HP). Wins levelled the hero up, so max HP grew.
    const { maxHp } = hpView(r.state);
    expect(r.state.character.level).toBe(3);
    const regen = Math.floor((progressMs(r.state)! * 15) / MIN);
    expect(r.state.character.hp).toBeGreaterThanOrEqual(Math.min(maxHp, r.state.dungeon.lastFight!.heroHpEnd + regen));
    expect(r.state.character.hp).toBeLessThanOrEqual(Math.min(maxHp, r.state.dungeon.lastFight!.heroHpEnd + regen + 1));
  });

  it('regen and runs interleave in time order: each fight sees the HP regenerated during its search', () => {
    // END 0 (5/min), DEX 60 (60 s searches): every search regens exactly 5 HP; every fight at 5 HP is lost in ≤ 2 s.
    const s = dungeonGame(3, (g) => withAttributes(withCharacter(g, { hp: 0 }), { endurance: 0, dexterity: 60 }));
    const r = simulate(s, T0 + 10 * MIN + 25 * SEC);
    expect(r.state.dungeon.totals).toEqual({ runs: 10, wins: 0, losses: 10 });
    expect(r.state.dungeon.lastFight?.heroHpStart).toBe(5);
    // A loss keeps the regen remainder (also what the fight's seconds banked, always under 1 HP here), so after the
    // 10th loss the hero holds the current search's regen at 5/min plus less than 1 HP of carried remainder.
    const c = r.state.character;
    const units = c.hp * MIN + c.hpRegenProgress;
    expect(units).toBeGreaterThanOrEqual(progressMs(r.state)! * 5);
    expect(units).toBeLessThan(progressMs(r.state)! * 5 + MIN);
  });

  it('a chain at low HP: the next run starts at once whatever the HP, and regen carries the hero back', () => {
    // From 1 HP a 1:50 search regens 27 HP (15/min), so the first fight starts at 28 HP.
    const s = dungeonGame(11, (g) => withCharacter(g, { hp: 1 }));
    const atFight = simulate(s, T0 + SEARCH_MS).state;
    expect(atFight.activity?.kind === 'dungeon' && atFight.activity.fight?.heroHpStart).toBe(28);
    const r = simulate(s, T0 + 3 * (SEARCH_MS + 10 * SEC)).state;
    expect(r.dungeon.totals.runs).toBe(3);
  });

  it('1 s ticks give the same state as one resume (searches, fights, regen, rng)', () => {
    const s = dungeonGame(21, (g) => withCharacter(g, { hp: 7 }));
    const end = T0 + 17 * MIN + 3 * SEC;
    const once = simulate(s, end).state;
    let step = s;
    for (let t = T0 + SEC; t <= end; t += SEC) step = simulate(step, t).state;
    expect(hashState(step)).toBe(hashState(once));
    expect(once.dungeon.totals.runs).toBeGreaterThanOrEqual(8);
  });

  it('clock moved back pauses runs and regen', () => {
    const s = simulate(dungeonGame(2, (g) => withCharacter(g, { hp: 20 })), T0 + 50 * SEC).state;
    const back = simulate(s, T0 + 50 * SEC - 2 * HOUR);
    expect(back.state).toBe(s);
    expect(back.summary.anomalies[0]).toMatchObject({ kind: 'backward' });
    // Real time catches up: only time after the highest seen counts.
    const later = simulate(back.state, T0 + 60 * SEC).state;
    expect(progressMs(later)).toBe(60 * SEC);
  });
});

describe('one activity at a time', () => {
  it('starting woodcutting cancels the run in progress: no fight, no rewards', () => {
    const s = dungeonGame();
    const r = applyCommand(s, { id: 'w', type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0 + MIN);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.activity).toMatchObject({ kind: 'woodcutting', progressMs: 0 });
    expect(r.state.dungeon).toEqual(s.dungeon);
    expect(r.state.character).toMatchObject({ xp: 0, gold: s.character.gold });
    expect(r.state.rng).toEqual(s.rng);
    expect(r.events).toContainEqual({ type: 'DUNGEON_RUN_CANCELLED', dungeonId: 'rat_cellar' });
    expect(r.events).toContainEqual({ type: 'ACTIVITY_STOPPED', kind: 'dungeon' });
  });

  it('runs that finished before the switch are kept; only the current one is lost', () => {
    const r = applyCommand(dungeonGame(), { id: 'w', type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0 + SEARCH_MS + 90 * SEC);
    expect(r.ok && r.state.dungeon.totals.runs).toBe(1);
  });

  it('stopping the dungeon also loses the current run', () => {
    const r = applyCommand(dungeonGame(), { id: 's', type: 'STOP_ACTIVITY' }, T0 + MIN);
    expect(r.ok && r.state.activity).toBeNull();
    expect(r.ok && r.state.dungeon.totals.runs).toBe(0);
    expect(r.ok && r.events).toContainEqual({ type: 'DUNGEON_RUN_CANCELLED', dungeonId: 'rat_cellar' });
  });

  it('starting a dungeon stops woodcutting (logs gathered so far are kept)', () => {
    const wood = apply(builtGame(1, T0), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0);
    const r = applyCommand(wood, { id: 'd', ...RAT_CELLAR }, T0 + 340 * SEC);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.activity).toEqual({ kind: 'dungeon', dungeonId: 'rat_cellar', startedAt: T0 + 340 * SEC, phase: 'search', progressMs: 0, fight: null });
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
    const r = simulate(s, T0 + SEARCH_MS).state;
    expect(r.dungeon.lastFight).toMatchObject({ won: false, endReason: 'no_hp', durationMs: 0, heroHpStart: 0, log: [] });
    expect(r.activity).toMatchObject({ phase: 'search', progressMs: 0, fight: null });
  });
});

describe('debug commands', () => {
  it('DEBUG_SET_HERO_HP sets HP (0..max), resets the regen remainder and flags the save', () => {
    const s = simulate(withCharacter(builtGame(1, T0), { hp: 10 }), T0 + 3 * SEC).state; // progress banked
    const r = applyCommand(s, { id: 'h', type: 'DEBUG_SET_HERO_HP', hp: 1 }, T0 + 3 * SEC);
    expect(r.ok && r.state.character).toMatchObject({ hp: 1, hpRegenProgress: 0 });
    expect(r.ok && r.state.flags.debugUsed).toBe(true);
    for (const hp of [-1, 51, 1.5, Number.NaN]) {
      expect(applyCommand(s, { id: 'h', type: 'DEBUG_SET_HERO_HP', hp }, T0)).toMatchObject({ ok: false, error: { code: 'INVALID_AMOUNT' } });
    }
  });

  it('DEBUG_FINISH_DUNGEON_RUN ends the search for free (the fight starts) and flags the save', () => {
    const r = applyCommand(dungeonGame(), { id: 'f', type: 'DEBUG_FINISH_DUNGEON_RUN' }, T0 + MIN);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.stamina.current).toBe(100);
    expect(r.state.dungeon.totals.runs).toBe(0);
    expect(r.state.activity).toMatchObject({ phase: 'fight', progressMs: 0 });
    expect(r.state.flags.debugUsed).toBe(true);
    // During the fight it is refused, like the skip.
    expect(applyCommand(r.state, { id: 'f2', type: 'DEBUG_FINISH_DUNGEON_RUN' }, T0 + MIN)).toMatchObject({ ok: false, error: { code: 'FIGHT_IN_PROGRESS' } });
    expect(applyCommand(builtGame(1, T0), { id: 'g', type: 'DEBUG_FINISH_DUNGEON_RUN' }, T0)).toMatchObject({
      ok: false,
      error: { code: 'NO_DUNGEON_RUN' },
    });
  });

  it('HP → 1, then the search regenerates; a debug finish right away fights at 1 HP and loses', () => {
    const s = apply(dungeonGame(4), { type: 'DEBUG_SET_HERO_HP', hp: 1 }, T0);
    const fightStart = simulate(s, T0 + SEARCH_MS).state;
    expect(fightStart.activity?.kind === 'dungeon' && fightStart.activity.fight?.heroHpStart).toBe(1 + Math.floor((SEARCH_MS * 15) / MIN)); // 28
    const now = apply(dungeonGame(4), { type: 'DEBUG_SET_HERO_HP', hp: 1 }, T0);
    const finish = apply(now, { type: 'DEBUG_FINISH_DUNGEON_RUN' }, T0);
    const f = simulate(finish, T0 + FIGHT_MS).state.dungeon.lastFight;
    expect(f).toMatchObject({ heroHpStart: 1, won: false, heroHpEnd: 0, endReason: 'hero_defeated', durationMs: 1000 });
  });
});
