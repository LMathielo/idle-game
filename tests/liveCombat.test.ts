// Live combat and the first rebalancing pass (engine 1.8.0, save v9): search + live fight runs, strike timing,
// the fight time limit, determinism across simulate boundaries mid-fight, the search-only skip, the hero XP
// curve, the v8 → v9 migration and replay.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { LogRow } from '../src/client/types';
import {
  type ActiveFight,
  addXp,
  applyCommand,
  COMBAT,
  createRng,
  cumulativeXp,
  CURRENT_SAVE_VERSION,
  type DungeonId,
  DUNGEONS,
  dungeonRunView,
  ENEMIES,
  ENGINE_VERSION,
  type GameState,
  getDerivedStats,
  hashState,
  HERO_XP_CURVE,
  loadSave,
  type MigratePayload,
  migrateDoc,
  MIGRATIONS,
  newFight,
  newGame,
  newProgress,
  nextFightEvent,
  type ReplayEntry,
  replayLogReport,
  resolveFight,
  searchMsFor,
  simulate,
  SKILL_XP_CURVE,
  xpToNext,
} from '../src/engine';
import { apply, builtGame, HOUR, makeClient, MIN, SEC, T0, progressMs, withCore } from './helpers';

const FIXTURES = join(__dirname, 'fixtures');
/** Frozen v8 save + its action log, written by the 1.7.0 engine before live combat (tests/fixtures). */
const V8_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v8.json'), 'utf8'));
const V8_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v8.json'), 'utf8'));

const SEARCH_MS = 120 * SEC; // Rat Cellar at core DEX 0 (1.16.0)
const RAT_CELLAR = { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' } as const;

const entries = (rows: LogRow[]): ReplayEntry[] =>
  rows.map((r) => ({ type: r.type, payload: r.payload, clientTime: r.clientTime, stateHash: r.stateHash, engineVersion: r.engineVersion }));

const side = (attackIntervalMs: number, damage = { min: 1, max: 1 }, defense = 1_000_000) => ({ damage, defense, attackIntervalMs });

function fightOf(s: GameState): ActiveFight | null {
  return s.activity?.kind === 'dungeon' ? s.activity.fight : null;
}

/** A game with every dungeon unlocked and `id` running from T0. */
function runningIn(id: DungeonId, seed = 5, tweak: (s: GameState) => GameState = (s) => s): GameState {
  const g = builtGame(seed, T0);
  g.dungeon.byDungeon = { rat_cellar: { runs: 10, wins: 10, losses: 0 }, bat_cave: { runs: 15, wins: 15, losses: 0 }, wolf_den: { runs: 25, wins: 25, losses: 0 }, forgotten_crypt: { runs: 40, wins: 40, losses: 0 } };
  g.dungeon.totals = { runs: 90, wins: 90, losses: 0 };
  return apply(tweak(g), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: id }, T0);
}

/**
 * Live play, the slow way: simulate exactly to each event (end of a search, each strike) one at a time until
 * `until`. What a player with the app open on every event sees.
 */
function walkEventByEvent(start: GameState, until: number): { state: GameState; steps: number } {
  let s = start;
  let t = s.time.lastSimulatedAt;
  let steps = 0;
  for (let guard = 0; guard < 100_000; guard++) {
    const a = s.activity;
    if (a?.kind !== 'dungeon') throw new Error('not in a dungeon');
    const f = a.phase === 'fight' ? a.fight : null;
    const next = f ? t + (nextFightEvent(f).atMs - f.elapsedMs) : t + (searchMsFor(a.dungeonId, s) - a.progressMs);
    if (next > until) break;
    if (next > t) {
      t = next;
      s = simulate(s, t).state;
      steps += 1;
    } else {
      // Zero-length step (two strikes at the same time): the previous simulate already played every event due then.
      throw new Error('stuck: an event due now was not played');
    }
  }
  return { state: simulate(s, until).state, steps };
}

describe('rebalance (config)', () => {
  it('search times 2 / 3 / 5 / 8 / 12 min, core DEX on the curve (1.16.0), floor 1:00; every enemy strikes every 1 s', () => {
    const base = Object.values(DUNGEONS).map((d) => d.search.baseMs / MIN);
    expect(base).toEqual([2, 3, 5, 8, 12]);
    for (const d of Object.values(DUNGEONS)) expect(d.search).toEqual({ baseMs: d.search.baseMs, minMs: 60_000 });
    expect(Object.values(ENEMIES).map((e) => e.attackIntervalMs)).toEqual([1000, 1000, 1000, 1000, 1000]);
    const g = builtGame(1, T0);
    expect(searchMsFor('troll_bridge', withCore(g, { dexterity: 10 }))).toBe(660_024);
    expect(searchMsFor('rat_cellar', withCore(g, { dexterity: 50 }))).toBe(90 * SEC);
    expect(COMBAT.maxFightMs).toBe(60_000);
  });

  it('Rat XP 35; other rewards unchanged', () => {
    expect(Object.values(DUNGEONS).map((d) => d.rewards.heroXp)).toEqual([35, 60, 140, 300, 650]);
  });

  it("the hero's attack interval is a derived stat: base 1000 ms, no gear changes it yet", () => {
    const d = getDerivedStats(newGame(1, T0));
    expect(d.attackIntervalMs).toEqual({ value: 1000, breakdown: [{ source: 'base', value: 1000 }] });
  });
});

describe('hero XP curve (base 100)', () => {
  it('xpToNext = round(100 × L × √L × growth): 100, 283, 520, 800, 1118 …; skills have their own curve (base 100 since 1.12.0)', () => {
    expect(HERO_XP_CURVE).toMatchObject({ base: 100, power: 1.5 });
    expect([1, 2, 3, 4, 5, 10, 20].map((l) => xpToNext(HERO_XP_CURVE, l))).toEqual([100, 283, 520, 800, 1118, 3162, 8944]);
    expect(SKILL_XP_CURVE.base).toBe(100);
    expect(xpToNext(SKILL_XP_CURVE, 1)).toBe(100);
  });

  it('Lv5 needs 1,703 XP: 49 Rat Cellar wins (48 is still Lv4)', () => {
    expect(cumulativeXp(HERO_XP_CURVE, 5)).toBe(1703);
    const rat = DUNGEONS.rat_cellar.rewards.heroXp;
    const after = (wins: number) => addXp(newProgress(HERO_XP_CURVE), wins * rat, HERO_XP_CURVE).progress.level;
    expect(after(48)).toBe(4);
    expect(after(49)).toBe(5);
    expect(Math.ceil(1703 / rat)).toBe(49);
  });

  it('a new hero starts at Lv1 with 0 / 100 XP', () => {
    expect(newGame(1, T0).character).toMatchObject({ level: 1, xp: 0, xpToNext: 100 });
  });
});

describe('strike timing', () => {
  it('both sides strike on their own timers from the fight start; the first strikes land at t = interval; ties go to the hero', () => {
    const r = resolveFight({ hp: 1000, ...side(1000) }, { hp: 1000, ...side(1000) }, createRng(1));
    expect(r.log.slice(0, 4).map((e) => [e.atMs, e.actor, e.strike])).toEqual([
      [1000, 'hero', 1],
      [1000, 'enemy', 1],
      [2000, 'hero', 2],
      [2000, 'enemy', 2],
    ]);
  });

  it('different intervals: each side keeps its own rhythm, merged in time order (hero first on a tie)', () => {
    const r = resolveFight({ hp: 1000, ...side(700) }, { hp: 1000, ...side(1000) }, createRng(1), 3500);
    expect(r.log.map((e) => [e.atMs, e.actor])).toEqual([
      [700, 'hero'],
      [1000, 'enemy'],
      [1400, 'hero'],
      [2000, 'enemy'],
      [2100, 'hero'],
      [2800, 'hero'],
      [3000, 'enemy'],
      [3500, 'hero'],
    ]);
    // A slower hero: the enemy gets the early strikes; at 3 s both are due and the hero goes first.
    const slow = resolveFight({ hp: 1000, ...side(1500) }, { hp: 1000, ...side(1000) }, createRng(1), 3000);
    expect(slow.log.map((e) => [e.atMs, e.actor])).toEqual([
      [1000, 'enemy'],
      [1500, 'hero'],
      [2000, 'enemy'],
      [3000, 'hero'],
      [3000, 'enemy'],
    ]);
  });

  it('a faster side can win before the other strikes at all', () => {
    const r = resolveFight({ hp: 10, damage: { min: 50, max: 50 }, defense: 0, attackIntervalMs: 400 }, { hp: 60, damage: { min: 99, max: 99 }, defense: 0, attackIntervalMs: 1000 }, createRng(3));
    expect(r).toMatchObject({ won: true, durationMs: 800, heroHp: 10 });
    expect(r.log.map((e) => e.actor)).toEqual(['hero', 'hero']);
  });

  it('nextFightEvent: the time limit comes after the last strike due at or before it', () => {
    const f = newFight('rat', side(1000), side(1000), 10, 10, 10);
    expect(nextFightEvent(f, 60_000)).toEqual({ type: 'strike', actor: 'hero', atMs: 1000 });
    f.heroStrikes = 60;
    f.enemyStrikes = 59;
    expect(nextFightEvent(f, 60_000)).toEqual({ type: 'strike', actor: 'enemy', atMs: 60_000 });
    f.enemyStrikes = 60;
    expect(nextFightEvent(f, 60_000)).toEqual({ type: 'time_limit', atMs: 60_000 });
  });

  it('in a dungeon the fight uses the hero derived stats and the enemy config, frozen at its start', () => {
    const s = simulate(runningIn('rat_cellar'), T0 + SEARCH_MS).state;
    const f = fightOf(s)!;
    const d = getDerivedStats(s);
    expect(f.hero).toEqual({ damage: { min: d.damage.min, max: d.damage.max }, defense: d.defense.value, attackIntervalMs: 1000 });
    expect(f.enemy).toEqual({ damage: ENEMIES.rat.damage, defense: ENEMIES.rat.defense, attackIntervalMs: 1000 });
    expect(f).toMatchObject({ elapsedMs: 0, heroHpStart: 50, heroMaxHp: 50, enemyHp: 30, enemyMaxHp: 30, log: [] });
  });
});

describe('fight time limit', () => {
  it('reaching 60 s is a loss with the usual loss rules: 0 HP, no rewards, a loss on the counters', () => {
    // Troll Bridge with an unarmed hero at total STR −10 (the old STR 0: 1 dmg per strike vs 300 HP) and huge END (the
    // Troll deals 1): nobody dies in 60 s.
    const s = runningIn('troll_bridge', 9, (g) => {
      g.character.equipment = { ...g.character.equipment, weapon: undefined };
      g.character.attributes = { ...g.character.attributes, strength: -10, endurance: 100_000 };
      return g;
    });
    const search = searchMsFor('troll_bridge', s);
    const mid = simulate(s, T0 + search + 59_999).state;
    expect(fightOf(mid)?.log).toHaveLength(118);
    const r = simulate(s, T0 + search + 60_000);
    const f = r.state.dungeon.lastFight!;
    expect(f).toMatchObject({ won: false, endReason: 'time_limit', durationMs: 60_000, heroHpEnd: 0, rewards: { heroXp: 0, gold: 0, items: {}, itemsLost: {} } });
    expect(f.log).toHaveLength(120);
    expect(r.state.character.hp).toBe(0);
    expect(r.state.dungeon.byDungeon.troll_bridge).toEqual({ runs: 1, wins: 0, losses: 1 });
    expect(r.summary.dungeon).toEqual({ runs: 1, wins: 0, losses: 1 });
    expect(r.state.activity).toMatchObject({ phase: 'search', progressMs: 0, fight: null });
  });
});

describe('determinism across simulate boundaries', () => {
  const rat = (hp = 50) => runningIn('rat_cellar', 31, (g) => ({ ...g, character: { ...g.character, hp } }));

  it('a simulate boundary in the middle of a fight gives the same state as one simulate (every split point)', () => {
    const s = rat(23);
    const end = T0 + SEARCH_MS + 30 * SEC;
    const once = simulate(s, end).state;
    expect(once.dungeon.totals.runs).toBe(91); // the fight finished inside the window
    // Split once at every 250 ms through the search's end and the whole fight, plus right around each strike.
    const splits = new Set<number>();
    for (let t = SEARCH_MS - SEC; t <= SEARCH_MS + 10 * SEC; t += 250) splits.add(t);
    for (const k of [1, 2, 3, 4, 5]) for (const d of [-1, 0, 1]) splits.add(SEARCH_MS + k * 1000 + d);
    for (const split of splits) {
      const two = simulate(simulate(s, T0 + split).state, end).state;
      expect(hashState(two), `split at ${split}`).toBe(hashState(once));
    }
  });

  it('1 ms, 333 ms and 1 s ticks through two hours of runs give the same state as one simulate', () => {
    const s = rat(9);
    const end = T0 + 2 * HOUR + 7 * SEC;
    const once = simulate(s, end).state;
    for (const step of [333, 1000, 61_000]) {
      let t = s;
      for (let at = T0 + step; at < end; at += step) t = simulate(t, at).state;
      t = simulate(t, end).state;
      expect(hashState(t), `${step} ms ticks`).toBe(hashState(once));
    }
    // 1 ms ticks across one whole fight (search end → 6 s in).
    let fine = simulate(s, T0 + SEARCH_MS - 5).state;
    for (let at = T0 + SEARCH_MS - 4; at <= T0 + SEARCH_MS + 6 * SEC; at += 1) fine = simulate(fine, at).state;
    expect(hashState(simulate(fine, end).state)).toBe(hashState(once));
  });

  it('offline: one simulate resolves search + fight runs back to back exactly as live play, event by event', () => {
    for (const [seed, hp] of [[3, 50], [8, 4], [13, 0]] as const) {
      const s = runningIn('bat_cave', seed, (g) => ({ ...g, character: { ...g.character, hp } }));
      const end = T0 + 3 * HOUR + 11 * SEC;
      const offline = simulate(s, end);
      const live = walkEventByEvent(s, end);
      expect(hashState(live.state)).toBe(hashState(offline.state));
      expect(offline.summary.dungeon.runs).toBeGreaterThan(30);
      // One step per search end and per strike time: far more steps than runs.
      expect(live.steps).toBeGreaterThan(3 * offline.summary.dungeon.runs);
    }
  });

  /**
   * Shifts the timeline (initial search progress) until T0 + 8 h falls inside a fight with strikes already landed
   * and at least one more second of fight to go. `s` is the state at exactly 8 h (no cap: requested = 8 h).
   * Wolf Den (1.16.0): a new hero loses there in a few seconds, so it never levels up and every fight lasts several
   * strikes. On the Rat Cellar, 8 h of wins give level points that make every fight a one-strike kill.
   */
  function capInsideFight(): { g: GameState; s: GameState } {
    const base = runningIn('wolf_den', 31);
    for (let p = 0; p < searchMsFor('wolf_den', base); p += 250) {
      const g = structuredClone(base);
      if (g.activity?.kind === 'dungeon') g.activity.progressMs = p;
      const s = simulate(g, T0 + 8 * HOUR).state;
      const f = fightOf(s);
      if (f && f.log.length >= 2 && f.elapsedMs % 1000 !== 0 && fightOf(simulate(s, T0 + 8 * HOUR + 1000).state)) return { g, s };
    }
    throw new Error('no timeline with the cap inside a fight');
  }

  it('the 8 h cap lands mid-fight: that fight is finished past the cap, exactly as live play; nothing else progresses', () => {
    const pick = capInsideFight();
    const atCap = fightOf(pick.s)!;
    // A player who never hit the cap: the same fight ends within maxFightMs of the cap, before the next 5:00 search ends.
    const live = simulate(pick.s, T0 + 8 * HOUR + COMBAT.maxFightMs).state;
    expect(fightOf(live)).toBeNull();
    expect(live.dungeon.totals.runs).toBe(pick.s.dungeon.totals.runs + 1);

    // 20 h away: granted 8 h, then the fight in progress plays to its end with the time beyond the cap.
    const capped = simulate(pick.g, T0 + 20 * HOUR);
    expect(capped.summary).toMatchObject({ requestedMs: 20 * HOUR, grantedMs: 8 * HOUR });
    expect(capped.state.activity).toMatchObject({ kind: 'dungeon', phase: 'search', progressMs: 0, fight: null });
    // Same strikes (times, rolls, damage, HP after each), same outcome, same rewards and RNG as live play.
    expect(capped.state.dungeon).toEqual(live.dungeon);
    expect(capped.state.dungeon.lastFight!.log.slice(0, atCap.log.length)).toEqual(atCap.log);
    expect(capped.state.dungeon.lastFight!.log.length).toBeGreaterThan(atCap.log.length);
    expect(capped.state.rng).toEqual(live.rng);
    expect(capped.state.character.gold).toBe(live.character.gold);
    expect(capped.state.character.xp).toBe(live.character.xp);
    expect(capped.events).toContainEqual({ type: 'FIGHT_RESOLVED', dungeonId: 'wolf_den', won: capped.state.dungeon.lastFight!.won });
    expect(capped.summary.dungeon.runs).toBe(live.dungeon.totals.runs - pick.g.dungeon.totals.runs);
    // HP regen is not capped (it ran over the whole 20 h), so the hero comes back full, by the regen rule.
    expect(capped.state.character.hp).toBe(getDerivedStats(capped.state).maxHp.value);

    // The next search stays at 0 until the next resume, which is live play again.
    const next = simulate(capped.state, T0 + 20 * HOUR + 30 * SEC).state;
    expect(next.activity).toMatchObject({ phase: 'search', progressMs: 30 * SEC });
  });

  it('past the cap: deterministic, independent of how long beyond the cap, and never past the real time', () => {
    const pick = capInsideFight();
    const atCap = fightOf(pick.s)!;
    const runs = [9 * HOUR, 20 * HOUR, 72 * HOUR].map((away) => simulate(pick.g, T0 + away).state);
    for (const r of runs) {
      expect(r.dungeon).toEqual(runs[0].dungeon);
      expect(r.rng).toEqual(runs[0].rng);
      expect(r.activity).toEqual(runs[0].activity);
    }
    expect(hashState(simulate(pick.g, T0 + 20 * HOUR).state)).toBe(hashState(runs[1]));

    // Only 0.5 s beyond the cap really passed: the fight gets exactly that, and continues live on the next resume.
    const short = simulate(pick.g, T0 + 8 * HOUR + 500).state;
    expect(fightOf(short)!.elapsedMs).toBe(atCap.elapsedMs + 500);
    expect(fightOf(short)!.log).toEqual(fightOf(simulate(pick.s, T0 + 8 * HOUR + 500).state)!.log);
  });

  it('the 8 h cap during a search still pauses the search there', () => {
    // Shift the timeline until T0 + 8 h falls inside a search with time banked.
    const base = rat();
    let pick: { g: GameState; s: GameState } | null = null;
    for (let p = 0; p < SEARCH_MS && !pick; p += 1000) {
      const g = structuredClone(base);
      if (g.activity?.kind === 'dungeon') g.activity.progressMs = p;
      const s = simulate(g, T0 + 8 * HOUR).state;
      if (s.activity?.kind === 'dungeon' && s.activity.phase === 'search' && s.activity.progressMs > 10 * SEC) pick = { g, s };
    }
    if (!pick) throw new Error('no timeline with the cap inside a search');
    const capped = simulate(pick.g, T0 + 20 * HOUR).state;
    expect(capped.activity).toEqual(pick.s.activity);
    expect(capped.dungeon).toEqual(pick.s.dungeon);
    expect(capped.rng).toEqual(pick.s.rng);
  });

  it('closing the app mid-fight: the next launch catches up to the same state and the log replays', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'midf' });
    await client.load();
    await client.dispatch(RAT_CELLAR);
    const view = dungeonRunView(client.getState())!;
    expect((await client.dispatch({ type: 'SKIP_DUNGEON_RUN', run: view.run, maxCost: view.skipCost! })).ok).toBe(true);
    clock.advance(1500);
    await client.tick();
    const mid = fightOf(client.getState())!;
    expect(mid.log.map((e) => e.atMs)).toEqual([1000, 1000]);
    await client.persist(); // app goes to the background mid-fight

    // Killed. Relaunched 40 minutes later with the same repository.
    clock.advance(40 * MIN);
    const { client: again } = makeClient({ repo, clock, prefix: 'midf2' });
    await again.load();
    const expected = simulate(client.getState(), clock.now()).state;
    expect(hashState(again.getState())).toBe(hashState(expected));
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(hashState(report.state)).toBe(hashState(again.getState()));
  });
});

describe('skip: search only', () => {
  it('skipping gives no HP regen for the skipped time; the fight starts at the HP of the tap, and regen runs during it', () => {
    const hurt = runningIn('rat_cellar', 2, (g) => ({ ...g, character: { ...g.character, hp: 10 } }));
    const skipped = applyCommand(hurt, { id: 'k', type: 'SKIP_DUNGEON_RUN', run: 91, maxCost: 2 }, T0);
    if (!skipped.ok) throw new Error(skipped.error.message);
    expect(skipped.state.character.hp).toBe(10);
    expect(fightOf(skipped.state)).toMatchObject({ heroHpStart: 10, elapsedMs: 0 });
    // Waiting instead regenerates 2:00 × 15/min = 30 HP before the fight.
    expect(fightOf(simulate(hurt, T0 + SEARCH_MS).state)?.heroHpStart).toBe(40);
    // During the fight regen keeps going: after 4 s the hero has 10 − hits + 1 HP (15/min = 1 HP per 4 s).
    const at4 = simulate(skipped.state, T0 + 4 * SEC).state;
    const hits = fightOf(at4) ? fightOf(at4)!.log : at4.dungeon.lastFight!.log;
    const taken = hits.filter((e) => e.actor === 'enemy' && e.atMs <= 4000).reduce((n, e) => n + e.dealt, 0);
    if (fightOf(at4)) expect(at4.character.hp).toBe(10 - taken + 1);
  });

  it('a potion drunk mid-fight counts (the hero HP is the real HP throughout)', () => {
    const s = apply(runningIn('rat_cellar', 4, (g) => {
      g.character.hp = 6;
      g.inventory.items.push({ id: 'health_potion_t1', defId: 'health_potion_t1', name: 'Health Potion (T1)', icon: '🧪', stackable: true, quantity: 1 });
      return g;
    }), { type: 'SKIP_DUNGEON_RUN', run: 91, maxCost: 2 }, T0);
    const healed = apply(s, { type: 'USE_ITEM', itemId: 'health_potion_t1' }, T0 + 500);
    expect(healed.character.hp).toBe(50);
    expect(fightOf(healed)?.heroHpStart).toBe(6);
    const end = simulate(healed, T0 + COMBAT.maxFightMs).state.dungeon.lastFight!;
    expect(end.won).toBe(true);
  });

  it('stopping mid-fight is a forfeit: a loss with the normal loss rules (0 HP, no rewards, counted, lastFight)', () => {
    const s = simulate(apply(runningIn('rat_cellar', 6), { type: 'SKIP_DUNGEON_RUN', run: 91, maxCost: 2 }, T0), T0 + 1500).state;
    const fight = fightOf(s)!;
    expect(fight.log).toHaveLength(2);
    const stop = applyCommand(s, { id: 'st', type: 'STOP_ACTIVITY' }, T0 + 1500);
    if (!stop.ok) throw new Error(stop.error.message);
    expect(stop.state.activity).toBeNull();
    expect(stop.state.character).toMatchObject({ hp: 0, xp: s.character.xp, gold: s.character.gold });
    expect(stop.state.dungeon.lastFight).toMatchObject({
      won: false,
      endReason: 'forfeit',
      durationMs: 1500,
      heroHpEnd: 0,
      enemyHpEnd: fight.enemyHp,
      rewards: { heroXp: 0, gold: 0, items: {}, itemsLost: {} },
    });
    expect(stop.state.dungeon.lastFight!.log).toEqual(fight.log);
    expect(stop.state.dungeon.byDungeon.rat_cellar).toEqual({ runs: 11, wins: 10, losses: 1 });
    expect(stop.state.dungeon.totals).toEqual({ runs: 91, wins: 90, losses: 1 });
    expect(stop.events).toContainEqual({ type: 'FIGHT_RESOLVED', dungeonId: 'rat_cellar', won: false });
    expect(stop.events).not.toContainEqual({ type: 'DUNGEON_RUN_CANCELLED', dungeonId: 'rat_cellar' });
    expect(stop.events).toContainEqual({ type: 'ACTIVITY_STOPPED', kind: 'dungeon' });
  });

  it('starting another activity mid-fight forfeits too; during the search it is still a plain cancel', () => {
    const inFight = simulate(apply(runningIn('rat_cellar', 6), { type: 'SKIP_DUNGEON_RUN', run: 91, maxCost: 2 }, T0), T0 + 1500).state;
    const wood = applyCommand(inFight, { id: 'w', type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0 + 1500);
    if (!wood.ok) throw new Error(wood.error.message);
    expect(wood.state.activity).toMatchObject({ kind: 'woodcutting' });
    expect(wood.state.dungeon.lastFight).toMatchObject({ endReason: 'forfeit', won: false });
    expect(wood.state.dungeon.totals.losses).toBe(1);
    expect(wood.state.character.hp).toBe(0);
    // Another dungeon mid-fight: the same.
    const other = applyCommand(inFight, { id: 'b', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'bat_cave' }, T0 + 1500);
    expect(other.ok && [other.state.dungeon.lastFight?.endReason, other.state.activity?.kind === 'dungeon' && other.state.activity.dungeonId]).toEqual(['forfeit', 'bat_cave']);

    // During the search: cancelled, nothing recorded, HP untouched.
    const searching = simulate(runningIn('rat_cellar', 6), T0 + MIN).state;
    const stop = applyCommand(searching, { id: 's', type: 'STOP_ACTIVITY' }, T0 + MIN);
    if (!stop.ok) throw new Error(stop.error.message);
    expect(stop.state.dungeon).toEqual(searching.dungeon);
    expect(stop.state.character.hp).toBe(searching.character.hp);
    expect(stop.events).toContainEqual({ type: 'DUNGEON_RUN_CANCELLED', dungeonId: 'rat_cellar' });
    const train = applyCommand(searching, { id: 't', type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0 + MIN);
    expect(train.ok && train.state.dungeon).toEqual(searching.dungeon);
  });

  it('a forfeit through the client is logged as STOP_ACTIVITY and replays to the same hash', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'flee' });
    await client.load();
    await client.dispatch(RAT_CELLAR);
    const v = dungeonRunView(client.getState())!;
    await client.dispatch({ type: 'SKIP_DUNGEON_RUN', run: v.run, maxCost: v.skipCost! });
    clock.advance(1500);
    await client.tick();
    expect((await client.dispatch({ type: 'STOP_ACTIVITY' })).ok).toBe(true);
    expect(client.getState().dungeon.lastFight?.endReason).toBe('forfeit');
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(hashState(report.state)).toBe(hashState(client.getState()));
  });

  it('the run view: search shows the countdown and the skip cost; the fight shows HP and the strikes so far, no skip', () => {
    const s = runningIn('rat_cellar', 6);
    expect(dungeonRunView(simulate(s, T0 + 50 * SEC).state)).toMatchObject({ phase: 'search', remainingMs: 70 * SEC, skipCost: 2, fight: null, run: 91 });
    const fight = dungeonRunView(simulate(s, T0 + SEARCH_MS + 1000).state)!;
    expect(fight).toMatchObject({ phase: 'fight', skipCost: null, remainingMs: 0, fraction: 1 });
    expect(fight.fight).toMatchObject({ elapsedMs: 1000, maxFightMs: 60_000, heroMaxHp: 50, enemyMaxHp: 30 });
    expect(fight.fight!.log).toHaveLength(2);
  });
});

describe('save v9 migration (v8 → v9)', () => {
  const v8Doc = (patch: Record<string, unknown> = {}) => ({
    saveVersion: 8,
    activity: { kind: 'dungeon', dungeonId: 'bat_cave', startedAt: 1, progressMs: 123_456 },
    character: { name: 'L', level: 4, xp: 3500, xpToNext: 12_000, hp: 5 },
    dungeon: {
      totals: { runs: 3, wins: 2, losses: 1 },
      byDungeon: {},
      lastFight: {
        dungeonId: 'rat_cellar',
        enemyId: 'rat',
        won: false,
        endReason: 'round_cap',
        rounds: 50,
        heroHpStart: 9,
        heroHpEnd: 0,
        heroMaxHp: 50,
        enemyMaxHp: 30,
        enemyHpEnd: 30,
        rewards: { heroXp: 0, gold: 0, items: {}, itemsLost: {} },
        log: [
          { round: 1, actor: 'hero', roll: 3, dealt: 1, targetHpAfter: 29 },
          { round: 1, actor: 'enemy', roll: 4, dealt: 3, targetHpAfter: 6 },
        ],
      },
    },
    ...patch,
  });

  it('keeps the level, clamps XP into progress toward the next level on the new curve; pure', () => {
    const doc = v8Doc();
    const frozen = JSON.parse(JSON.stringify(doc));
    const v9 = MIGRATIONS[8](doc) as unknown as GameState;
    expect(doc).toEqual(frozen);
    expect(v9.saveVersion).toBe(9);
    // Lv4 needs 800 on the new curve: 3500 → 799.
    expect(v9.character).toMatchObject({ level: 4, xp: 799, xpToNext: 800, hp: 5 });
    // XP already below the new requirement is kept as is.
    const low = MIGRATIONS[8](v8Doc({ character: { level: 2, xp: 17, xpToNext: 4243 } })) as unknown as GameState;
    expect(low.character).toMatchObject({ level: 2, xp: 17, xpToNext: 283 });
    // The migration's frozen curve matches the engine's curve.
    for (const level of [1, 5, 19, 20, 21, 39, 40, 99, 100, 101, 150]) {
      const m = MIGRATIONS[8](v8Doc({ character: { level, xp: 0 } })) as unknown as GameState;
      expect(m.character.xpToNext).toBe(xpToNext(HERO_XP_CURVE, level));
    }
  });

  it('a dungeon run in progress becomes its search phase with its progress kept; other activities untouched', () => {
    const v9 = MIGRATIONS[8](v8Doc()) as unknown as GameState;
    expect(v9.activity).toEqual({ kind: 'dungeon', dungeonId: 'bat_cave', startedAt: 1, progressMs: 123_456, phase: 'search', fight: null });
    const wood = { kind: 'woodcutting', treeId: 'oak', startedAt: 1, progressMs: 7 };
    expect((MIGRATIONS[8](v8Doc({ activity: wood })) as unknown as GameState).activity).toEqual(wood);
    expect((MIGRATIONS[8](v8Doc({ activity: null })) as unknown as GameState).activity).toBeNull();
  });

  it('the last fight gets strike times (round n → n s) and numbers; round_cap → time_limit; rounds → durationMs', () => {
    const v9 = MIGRATIONS[8](v8Doc()) as unknown as GameState;
    expect(v9.dungeon.lastFight).toMatchObject({ endReason: 'time_limit', durationMs: 50_000 });
    expect(v9.dungeon.lastFight).not.toHaveProperty('rounds');
    expect(v9.dungeon.lastFight!.log).toEqual([
      { atMs: 1000, actor: 'hero', strike: 1, roll: 3, dealt: 1, targetHpAfter: 29 },
      { atMs: 1000, actor: 'enemy', strike: 1, roll: 4, dealt: 3, targetHpAfter: 6 },
    ]);
    const none = MIGRATIONS[8](v8Doc({ dungeon: { totals: { runs: 0, wins: 0, losses: 0 }, byDungeon: {}, lastFight: null } })) as unknown as GameState;
    expect(none.dungeon.lastFight).toBeNull();
  });
});

describe('frozen v8 save (tests/fixtures/save-v8.json) → v9', () => {
  async function v8Phone(after = 3 * MIN) {
    const repo = new MemoryGameRepository();
    await repo.init();
    await repo.commit(
      V8_LOG.map(({ seq: _seq, synced: _synced, ...r }) => r),
      V8_SAVE as GameState,
      { [META_ENGINE_VERSION]: '1.7.0', device_id: 'phone' },
    );
    const clock = new FakeClock(V8_SAVE.time.lastSimulatedAt + after);
    return makeClient({ repo, clock, prefix: 'v9' });
  }

  it('is what the 1.7.0 engine wrote: hero Lv3 with 1182 XP, Rat Cellar mid-run (3:27 in), 37 wins', () => {
    expect(V8_SAVE.saveVersion).toBe(8);
    expect(V8_SAVE.character).toMatchObject({ level: 3, xp: 1182, xpToNext: 7794 });
    expect(V8_SAVE.activity).toEqual({ kind: 'dungeon', dungeonId: 'rat_cellar', startedAt: V8_SAVE.activity.startedAt, progressMs: 207_000 });
    expect(V8_SAVE.dungeon.totals).toEqual({ runs: 37, wins: 37, losses: 0 });
    expect(V8_SAVE.dungeon.lastFight).toHaveProperty('rounds');
    expect(new Set(V8_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.7.0']));
  });

  it('migrates: level kept, XP clamped (1182 → 519 of 520), the run kept as its search, everything else kept', () => {
    const s = migrateDoc(V8_SAVE, MIGRATIONS, 9) as unknown as GameState; // the v8 → v9 step only (v10 has its own test)
    expect(s.saveVersion).toBe(9);
    expect(s.character).toMatchObject({ level: 3, xp: 519, xpToNext: 520 });
    expect(s.activity).toEqual({ ...V8_SAVE.activity, phase: 'search', fight: null });
    expect(s.dungeon.lastFight).toMatchObject({ won: true, endReason: 'enemy_defeated', durationMs: V8_SAVE.dungeon.lastFight.rounds * 1000 });
    const { character, activity: _a, dungeon, saveVersion: _v, ...rest } = s;
    const { character: rc, activity: _ra, dungeon: rd, saveVersion: _rv, ...rawRest } = V8_SAVE;
    expect(rest).toEqual(rawRest);
    expect({ ...character, xp: 0, xpToNext: 0 }).toEqual({ ...rc, xp: 0, xpToNext: 0 });
    expect({ ...dungeon, lastFight: null }).toEqual({ ...rd, lastFight: null });
    expect(hashState(migrateDoc(V8_SAVE, MIGRATIONS, 9) as unknown as GameState)).toBe(hashState(s)); // deterministic
  });

  it('the kept 3:27 already covers the new 1:50 search: the fight starts on the next simulate and plays live', () => {
    const s = loadSave(V8_SAVE);
    const t = s.time.lastSimulatedAt;
    const next = simulate(s, t + 1).state;
    expect(next.activity).toMatchObject({ phase: 'fight' });
    expect(fightOf(next)).toMatchObject({ elapsedMs: 1, log: [] });
    const later = simulate(s, t + MIN).state;
    expect(later.dungeon.totals.runs).toBe(38);
  });

  it('loading writes a MIGRATE anchor (save 8 → 9, engine 1.7.0 → 1.8.0); a skip and a live fight follow; the whole log replays', async () => {
    const { repo, clock, client } = await v8Phone(1500); // Lv3 = +10 STR since 1.16.0: the Rat falls at the 2nd strike
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({
      fromSave: 8,
      toSave: CURRENT_SAVE_VERSION,
      fromEngine: '1.7.0',
      toEngine: ENGINE_VERSION,
      fromHash: V8_LOG.at(-1)!.stateHash,
      snapshot: undefined,
    });
    expect(p.snapshot).toEqual(loadSave(V8_SAVE));
    // The resume after the anchor already started the fight (1.5 s in).
    expect(client.getState().activity).toMatchObject({ phase: 'fight' });
    for (let i = 0; i < 70; i++) {
      clock.advance(SEC);
      await client.tick();
    }
    expect(client.getState().dungeon.totals.runs).toBe(38);
    const v = dungeonRunView(client.getState())!;
    expect(v.phase).toBe('search');
    expect((await client.dispatch({ type: 'SKIP_DUNGEON_RUN', run: v.run, maxCost: v.skipCost! })).ok).toBe(true);
    clock.advance(500);
    await client.tick();
    expect((await client.dispatch({ type: 'SKIP_DUNGEON_RUN', run: v.run, maxCost: 2 })).ok).toBe(false); // FIGHT_IN_PROGRESS, not logged
    clock.advance(HOUR);
    await client.resume();
    const rows = await repo.getAllLog();
    expect(rows.filter((r) => r.type === 'SKIP_DUNGEON_RUN')).toHaveLength(1);
    const report = replayLogReport(entries(rows));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: V8_LOG.length });
    expect(hashState(report.state)).toBe(hashState(client.getState()));
  });
});
