// Dungeon tiers 1–5: config table, search times, win-based unlocks, DUNGEON_LOCKED, rewards per tier,
// the debug win grant and the danger hint.
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  averageDealt,
  type DangerLevel,
  dangerHint,
  DUNGEON_IDS,
  type DungeonId,
  DUNGEONS,
  dungeonRunView,
  dungeonTotals,
  dungeonUnlockView,
  ENEMIES,
  type GameState,
  getDerivedStats,
  getItemDef,
  hashState,
  isDungeonUnlocked,
  newGame,
  COMBAT,
  type GameEvent,
  searchMsFor,
  simulate,
} from '../src/engine';
import { formatClock } from '../src/components/format';
import { apply, cmd, HOUR, MIN, SEC, T0 } from './helpers';

const DEX10 = { dexterity: 10 };

/** A new game with counters set directly (the state is plain data), to test the rules around them. */
function withCounters(byDungeon: GameState['dungeon']['byDungeon'], seed = 7): GameState {
  const s = newGame(seed, T0);
  const totals = { runs: 0, wins: 0, losses: 0 };
  for (const t of Object.values(byDungeon)) {
    totals.runs += t!.runs;
    totals.wins += t!.wins;
    totals.losses += t!.losses;
  }
  return { ...s, dungeon: { ...s.dungeon, totals, byDungeon } };
}

const ALL_OPEN: GameState['dungeon']['byDungeon'] = {
  rat_cellar: { runs: 10, wins: 10, losses: 0 },
  bat_cave: { runs: 15, wins: 15, losses: 0 },
  wolf_den: { runs: 25, wins: 25, losses: 0 },
  forgotten_crypt: { runs: 40, wins: 40, losses: 0 },
};

function startDungeon(s: GameState, dungeonId: DungeonId, at = T0) {
  return applyCommand(s, cmd({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId }), at);
}

/** Plays 1 s at a time until `pred` holds; returns the state and every event on the way (a run ends with its fight). */
function playUntil(start: GameState, pred: (s: GameState) => boolean) {
  let s = start;
  const events: GameEvent[] = [];
  const unlocked: DungeonId[] = [];
  for (let i = 0; i < 100_000 && !pred(s); i++) {
    const r = simulate(s, s.time.lastSimulatedAt + SEC);
    s = r.state;
    events.push(...r.events);
    unlocked.push(...r.summary.dungeonsUnlocked);
  }
  return { state: s, events, unlocked };
}

function sumTotals(s: GameState) {
  const t = { runs: 0, wins: 0, losses: 0 };
  for (const v of Object.values(s.dungeon.byDungeon)) {
    t.runs += v!.runs;
    t.wins += v!.wins;
    t.losses += v!.losses;
  }
  return t;
}

describe('tier table (config)', () => {
  it('5 dungeons in order, with the owner-approved enemies, unlocks, rewards and loot', () => {
    expect(DUNGEON_IDS).toEqual(['rat_cellar', 'bat_cave', 'wolf_den', 'forgotten_crypt', 'troll_bridge']);
    const table = DUNGEON_IDS.map((id) => {
      const d = DUNGEONS[id];
      const e = ENEMIES[d.enemyId];
      return [
        d.tier,
        d.name,
        `${e.name} ${e.hp} · ${e.damage.min}–${e.damage.max} · ${e.defense}`,
        d.search.baseMs / MIN,
        `${e.attackIntervalMs} ms`,
        d.unlock ? `${d.unlock.wins} in ${d.unlock.dungeonId}` : '—',
        `${d.rewards.heroXp} · ${d.rewards.gold.min}–${d.rewards.gold.max}`,
        d.rewards.drops.map((x) => `${x.itemId} ${x.chance}`).join(),
      ];
    });
    expect(table).toEqual([
      [1, 'Rat Cellar', 'Rat 30 · 3–5 · 2', 2, '1000 ms', '—', '35 · 2–5', 'rat_skin 0.5'],
      [2, 'Bat Cave', 'Bat 60 · 6–9 · 6', 3, '1000 ms', '10 in rat_cellar', '60 · 6–12', 'bat_wing 0.4'],
      [3, 'Wolf Den', 'Wolf 110 · 10–14 · 12', 5, '1000 ms', '15 in bat_cave', '140 · 15–30', 'wolf_pelt 0.3'],
      [4, 'Forgotten Crypt', 'Skeleton 180 · 15–20 · 20', 8, '1000 ms', '25 in wolf_den', '300 · 35–60', 'old_bone 0.25'],
      [5, 'Troll Bridge', 'Troll 300 · 22–30 · 30', 12, '1000 ms', '40 in forgotten_crypt', '650 · 80–130', 'troll_hide 0.2'],
    ]);
  });

  it('new loot is in the catalog: stackable, junk, with an icon', () => {
    for (const id of ['bat_wing', 'wolf_pelt', 'old_bone', 'troll_hide']) {
      expect(getItemDef(id)).toMatchObject({ id, stackable: true, quality: 'junk', icon: expect.any(String) });
      expect(getItemDef(id)!.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('search time per tier', () => {
  it('DEX 10: 1:50, 2:50, 4:50, 7:50, 11:50', () => {
    expect(DUNGEON_IDS.map((id) => formatClock(searchMsFor(id, DEX10)))).toEqual(['1:50', '2:50', '4:50', '7:50', '11:50']);
  });

  it('−1 s per DEX on every tier, never under 1:00', () => {
    for (const id of DUNGEON_IDS) {
      const base = DUNGEONS[id].search.baseMs;
      expect(searchMsFor(id, { dexterity: 11 })).toBe(base - 11 * SEC);
      expect(searchMsFor(id, { dexterity: 10_000 })).toBe(MIN);
      expect(searchMsFor(id, { dexterity: (base - MIN) / SEC })).toBe(MIN); // exactly at the floor
      expect(searchMsFor(id, { dexterity: (base - MIN) / SEC - 1 })).toBe(MIN + SEC);
    }
  });

  it('a Bat Cave search ends at exactly 2:50 with DEX 10, then the fight starts', () => {
    const r = startDungeon(withCounters({ rat_cellar: { runs: 10, wins: 10, losses: 0 } }), 'bat_cave');
    if (!r.ok) throw new Error(r.error.message);
    expect(dungeonRunView(simulate(r.state, T0 + 170 * SEC - 1).state)).toMatchObject({ phase: 'search', remainingMs: 1 });
    const fight = simulate(r.state, T0 + 170 * SEC).state;
    expect(dungeonRunView(fight)).toMatchObject({ dungeonId: 'bat_cave', run: 11, searchMs: 170 * SEC, phase: 'fight' });
    expect(dungeonRunView(fight)?.fight).toMatchObject({ enemyId: 'bat', enemyHp: 60, elapsedMs: 0 });
    const done = simulate(r.state, T0 + 170 * SEC + COMBAT.maxFightMs).state;
    expect(dungeonTotals(done, 'bat_cave').runs).toBe(1);
  });
});

describe('unlocks', () => {
  it('a fresh hero has only Rat Cellar open', () => {
    const s = newGame(1, T0);
    expect(DUNGEON_IDS.map((id) => isDungeonUnlocked(s, id))).toEqual([true, false, false, false, false]);
    expect(dungeonUnlockView(s, 'rat_cellar')).toEqual({ unlocked: true, requirement: null, progress: 0 });
    expect(dungeonUnlockView(s, 'bat_cave')).toEqual({ unlocked: false, requirement: { dungeonId: 'rat_cellar', wins: 10 }, progress: 0 });
  });

  it('thresholds 10 / 15 / 25 / 40: one win short stays locked, exactly the count unlocks', () => {
    const cases: [DungeonId, DungeonId, number][] = [
      ['bat_cave', 'rat_cellar', 10],
      ['wolf_den', 'bat_cave', 15],
      ['forgotten_crypt', 'wolf_den', 25],
      ['troll_bridge', 'forgotten_crypt', 40],
    ];
    for (const [id, from, wins] of cases) {
      const short = withCounters({ [from]: { runs: wins - 1, wins: wins - 1, losses: 0 } });
      expect(dungeonUnlockView(short, id)).toEqual({ unlocked: false, requirement: { dungeonId: from, wins }, progress: wins - 1 });
      const exact = withCounters({ [from]: { runs: wins, wins, losses: 0 } });
      expect(dungeonUnlockView(exact, id)).toEqual({ unlocked: true, requirement: { dungeonId: from, wins }, progress: wins });
      // Progress is capped at the requirement.
      expect(dungeonUnlockView(withCounters({ [from]: { runs: 99, wins: 99, losses: 0 } }), id).progress).toBe(wins);
    }
  });

  it('losses never count: 9 wins + 50 losses stays locked', () => {
    const s = withCounters({ rat_cellar: { runs: 59, wins: 9, losses: 50 } });
    expect(isDungeonUnlocked(s, 'bat_cave')).toBe(false);
    expect(dungeonUnlockView(s, 'bat_cave').progress).toBe(9);
  });

  it('the 10th real win unlocks Bat Cave and emits DUNGEON_UNLOCKED once; the 9th does not', () => {
    let s = withCounters({ rat_cellar: { runs: 8, wins: 8, losses: 0 } });
    s = apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    const ninth = playUntil(s, (x) => dungeonTotals(x, 'rat_cellar').runs === 9);
    expect(ninth.state.dungeon.lastFight?.won).toBe(true);
    expect(dungeonTotals(ninth.state, 'rat_cellar').wins).toBe(9);
    expect(isDungeonUnlocked(ninth.state, 'bat_cave')).toBe(false);
    expect(ninth.events.some((e) => e.type === 'DUNGEON_UNLOCKED')).toBe(false);

    const tenth = playUntil(ninth.state, (x) => dungeonTotals(x, 'rat_cellar').runs === 10);
    expect(tenth.state.dungeon.lastFight?.won).toBe(true);
    expect(isDungeonUnlocked(tenth.state, 'bat_cave')).toBe(true);
    expect(tenth.events.filter((e) => e.type === 'DUNGEON_UNLOCKED')).toEqual([{ type: 'DUNGEON_UNLOCKED', dungeonId: 'bat_cave' }]);
    expect(tenth.unlocked).toEqual(['bat_cave']);

    // The 11th win does not announce it again.
    const eleventh = playUntil(tenth.state, (x) => dungeonTotals(x, 'rat_cellar').runs === 11);
    expect(eleventh.events.some((e) => e.type === 'DUNGEON_UNLOCKED')).toBe(false);
  });

  it('a loss at 9 wins does not unlock (fight at 0 HP)', () => {
    let s = withCounters({ rat_cellar: { runs: 9, wins: 9, losses: 0 } });
    s = apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    s = apply(s, { type: 'DEBUG_SET_HERO_HP', hp: 0 }, T0);
    const r = applyCommand(s, cmd({ type: 'DEBUG_FINISH_DUNGEON_RUN' }), T0);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.dungeon.lastFight).toMatchObject({ won: false, endReason: 'no_hp' });
    expect(dungeonTotals(r.state, 'rat_cellar')).toEqual({ runs: 10, wins: 9, losses: 1 });
    expect(isDungeonUnlocked(r.state, 'bat_cave')).toBe(false);
    expect(r.events.some((e) => e.type === 'DUNGEON_UNLOCKED')).toBe(false);
  });

  it('an offline catch-up that crosses a threshold reports the unlock in the summary', () => {
    let s = withCounters({ rat_cellar: { runs: 5, wins: 5, losses: 0 } });
    s = apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    const r = simulate(s, T0 + 2 * HOUR);
    expect(dungeonTotals(r.state, 'rat_cellar').wins).toBeGreaterThanOrEqual(10);
    expect(r.summary.dungeonsUnlocked).toEqual(['bat_cave']);
  });

  it('unlocks are permanent: losses afterwards never re-lock', () => {
    let s = withCounters({ rat_cellar: { runs: 10, wins: 10, losses: 0 } });
    s = apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    for (let i = 0; i < 5; i++) {
      s = apply(s, { type: 'DEBUG_SET_HERO_HP', hp: 0 }, T0);
      s = apply(s, { type: 'DEBUG_FINISH_DUNGEON_RUN' }, T0);
    }
    expect(dungeonTotals(s, 'rat_cellar')).toEqual({ runs: 15, wins: 10, losses: 5 });
    expect(isDungeonUnlocked(s, 'bat_cave')).toBe(true);
  });

  it('global totals always equal the sum of the per-dungeon counters', () => {
    let s = withCounters({ rat_cellar: { runs: 10, wins: 10, losses: 0 } });
    s = apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    s = simulate(s, T0 + HOUR).state;
    s = apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'bat_cave' }, T0 + HOUR);
    s = simulate(s, T0 + 3 * HOUR).state;
    s = apply(s, { type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'bat_cave', amount: 3 }, T0 + 3 * HOUR);
    expect(dungeonTotals(s, 'bat_cave').runs).toBeGreaterThan(3);
    expect(s.dungeon.totals).toEqual(sumTotals(s));
  });
});

describe('determinism on higher tiers', () => {
  it('Wolf Den: 1 s ticks give the same state, byte for byte, as one resume (unlock included)', () => {
    let s = withCounters({ rat_cellar: { runs: 10, wins: 10, losses: 0 }, bat_cave: { runs: 15, wins: 15, losses: 0 } }, 21);
    s = { ...s, character: { ...s.character, attributes: { ...s.character.attributes, strength: 40, endurance: 40 } } };
    s = apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'wolf_den' }, T0);
    const span = 3 * searchMsFor('wolf_den', s.character.attributes) + 30 * SEC; // three 4:50 searches + three short fights
    let ticked = s;
    for (let t = SEC; t <= span; t += SEC) ticked = simulate(ticked, T0 + t).state;
    const once = simulate(s, T0 + span).state;
    expect(dungeonTotals(once, 'wolf_den').runs).toBe(3);
    expect(hashState(ticked)).toBe(hashState(once));
    expect(JSON.stringify(ticked)).toBe(JSON.stringify(once));
  });

  it('same seed, same commands → same hash; another seed → different fights', () => {
    const play = (seed: number) => {
      let s = withCounters({ rat_cellar: { runs: 10, wins: 10, losses: 0 } }, seed);
      s = apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'bat_cave' }, T0);
      return simulate(s, T0 + 4 * HOUR).state;
    };
    expect(hashState(play(11))).toBe(hashState(play(11)));
    expect(hashState(play(11))).not.toBe(hashState(play(12)));
  });
});

describe('DUNGEON_LOCKED', () => {
  it('starting a locked dungeon is refused with a typed error and changes nothing', () => {
    const wood = apply(newGame(3, T0), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0);
    const frozen = JSON.parse(JSON.stringify(wood));
    for (const id of ['bat_cave', 'wolf_den', 'forgotten_crypt', 'troll_bridge'] as const) {
      const r = startDungeon(wood, id, T0 + MIN);
      expect(r).toEqual({ ok: false, error: { code: 'DUNGEON_LOCKED', message: expect.stringContaining(DUNGEONS[id].name) } });
    }
    expect(wood).toEqual(frozen); // input untouched, woodcutting still running
  });

  it('9 Rat Cellar wins: Bat Cave refused; 10: accepted', () => {
    expect(startDungeon(withCounters({ rat_cellar: { runs: 9, wins: 9, losses: 0 } }), 'bat_cave')).toMatchObject({
      ok: false,
      error: { code: 'DUNGEON_LOCKED' },
    });
    expect(startDungeon(withCounters({ rat_cellar: { runs: 10, wins: 10, losses: 0 } }), 'bat_cave').ok).toBe(true);
  });
});

describe('rewards and loot per tier', () => {
  it.each(DUNGEON_IDS)('%s: every win gives its XP, gold in range and only its own loot, near the drop chance', (id) => {
    // A hero who always wins in one hit: huge STR/END, DEX at the 1:00 floor. Counters open every tier.
    const base = withCounters(ALL_OPEN, 99);
    let s: GameState = {
      ...base,
      character: { ...base.character, attributes: { strength: 5000, dexterity: 5000, endurance: 5000, intelligence: 10 } },
      inventory: { ...base.inventory, capacity: 100 },
    };
    s = apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: id }, T0);
    const before = dungeonTotals(s, id);
    const r = simulate(s, T0 + 8 * HOUR); // 1:00 searches + a one-strike fight (1 s) each
    const runs = Math.floor((8 * HOUR) / (MIN + SEC)); // 472
    const d = DUNGEONS[id];
    expect(dungeonTotals(r.state, id)).toEqual({ runs: before.runs + runs, wins: before.wins + runs, losses: 0 });
    expect(r.summary.dungeon).toEqual({ runs, wins: runs, losses: 0 });
    expect(r.summary.heroXpGained).toBe(runs * d.rewards.heroXp);
    expect(r.summary.goldGained).toBeGreaterThanOrEqual(runs * d.rewards.gold.min);
    expect(r.summary.goldGained).toBeLessThanOrEqual(runs * d.rewards.gold.max);
    expect(r.state.character.gold).toBe(s.character.gold + r.summary.goldGained);
    const drop = d.rewards.drops[0];
    expect(Object.keys(r.summary.itemsGained)).toEqual([drop.itemId]);
    // Within 4 standard deviations of runs × chance.
    const mean = runs * drop.chance;
    const sd = Math.sqrt(runs * drop.chance * (1 - drop.chance));
    expect(Math.abs(r.summary.itemsGained[drop.itemId] - mean)).toBeLessThan(4 * sd);
    expect(r.state.dungeon.lastFight).toMatchObject({ dungeonId: id, enemyId: d.enemyId, won: true });
  });

  it('a single win: rewards recorded on the fight, same order of rolls (gold, then drop)', () => {
    let s = withCounters({ rat_cellar: { runs: 10, wins: 10, losses: 0 } }, 4);
    s = { ...s, character: { ...s.character, attributes: { ...s.character.attributes, strength: 500, endurance: 500 } } };
    s = apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'bat_cave' }, T0);
    const r = simulate(s, T0 + searchMsFor('bat_cave', s.character.attributes) + COMBAT.maxFightMs).state;
    const f = r.dungeon.lastFight!;
    expect(f.won).toBe(true);
    expect(f.rewards.heroXp).toBe(60);
    expect(f.rewards.gold).toBeGreaterThanOrEqual(6);
    expect(f.rewards.gold).toBeLessThanOrEqual(12);
    expect(Object.keys(f.rewards.items).every((k) => k === 'bat_wing')).toBe(true);
  });
});

describe('DEBUG_ADD_DUNGEON_WINS', () => {
  it('adds wins and runs, flags the save, unlocks the next tier with an event', () => {
    const s = newGame(5, T0);
    const r = applyCommand(s, cmd({ type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'rat_cellar', amount: 10 }), T0);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.flags.debugUsed).toBe(true);
    expect(dungeonTotals(r.state, 'rat_cellar')).toEqual({ runs: 10, wins: 10, losses: 0 });
    expect(r.state.dungeon.totals).toEqual({ runs: 10, wins: 10, losses: 0 });
    expect(r.events).toContainEqual({ type: 'DUNGEON_UNLOCKED', dungeonId: 'bat_cave' });
    expect(isDungeonUnlocked(r.state, 'bat_cave')).toBe(true);
    expect(r.state.dungeon.lastFight).toBeNull(); // no fight, no rewards
    expect(r.state.character.gold).toBe(s.character.gold);
  });

  it('emits DUNGEON_UNLOCKED only for dungeons that were locked before and are open after', () => {
    // Already open: no event. 40 Rat Cellar wins open Bat Cave only (Wolf Den needs Bat Cave wins).
    const open = withCounters({ rat_cellar: { runs: 12, wins: 12, losses: 0 } });
    const again = applyCommand(open, cmd({ type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'rat_cellar', amount: 10 }), T0);
    expect(again.ok && again.events.filter((e) => e.type === 'DUNGEON_UNLOCKED')).toEqual([]);
    const big = applyCommand(newGame(5, T0), cmd({ type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'rat_cellar', amount: 40 }), T0);
    expect(big.ok && big.events.filter((e) => e.type === 'DUNGEON_UNLOCKED')).toEqual([{ type: 'DUNGEON_UNLOCKED', dungeonId: 'bat_cave' }]);
  });

  it('refuses locked or unknown dungeons and bad amounts', () => {
    const s = newGame(5, T0);
    const code = (c: object) => {
      const r = applyCommand(s, cmd(c as never), T0);
      return r.ok ? 'ok' : r.error.code;
    };
    expect(code({ type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'bat_cave', amount: 10 })).toBe('DUNGEON_LOCKED');
    expect(code({ type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'nope', amount: 10 })).toBe('UNKNOWN_DUNGEON');
    for (const amount of [0, -1, 1.5, 1001, Number.NaN, '10']) {
      expect(code({ type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'rat_cellar', amount })).toBe('INVALID_AMOUNT');
    }
  });

  it('a running run keeps going; the skip run number moves with the global counter', () => {
    let s = apply(newGame(5, T0), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    s = simulate(s, T0 + MIN).state;
    s = apply(s, { type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'rat_cellar', amount: 10 }, T0 + MIN);
    expect(s.activity).toMatchObject({ kind: 'dungeon', progressMs: MIN });
    expect(dungeonRunView(s)?.run).toBe(11);
  });
});

describe('danger hint', () => {
  const fresh = newGame(1, T0);
  const levels = (s: GameState) => DUNGEON_IDS.map((id) => dangerHint(s, id).level);

  it('fresh hero: Easy, Tough, Deadly, Deadly, Deadly', () => {
    expect(levels(fresh)).toEqual<DangerLevel[]>(['easy', 'tough', 'deadly', 'deadly', 'deadly']);
    // Rat: 3 hits to kill (avg 11.7 vs 30 HP), at 3 s; the rat lands 2 strikes before that (1 s, 2 s; the one at 3 s
    // comes after the hero's killing blow) for ~3 → 6 of 50 HP.
    expect(dangerHint(fresh, 'rat_cellar')).toEqual({ level: 'easy', expectedHpLoss: 6, maxHp: 50, percent: 12, heroHits: 3, enemyHits: 2, fightMs: 3000 });
    // Bat: 5 hits (avg 12 vs 60 HP) at 5 s, 4 bat strikes of 6 → 24 of 50 HP.
    expect(dangerHint(fresh, 'bat_cave')).toEqual({ level: 'tough', expectedHpLoss: 24, maxHp: 50, percent: 48, heroHits: 5, enemyHits: 4, fightMs: 5000 });
  });

  it('expected loss grows tier by tier for the same hero', () => {
    const losses = DUNGEON_IDS.map((id) => dangerHint(fresh, id).expectedHpLoss);
    expect([...losses].sort((a, b) => a - b)).toEqual(losses);
  });

  it('pure: no RNG, same answer every time, never touches the state', () => {
    const before = hashState(fresh);
    expect(dangerHint(fresh, 'wolf_den')).toEqual(dangerHint(fresh, 'wolf_den'));
    expect(hashState(fresh)).toBe(before);
  });

  it('a strong hero sees every tier as Easy; a hero who cannot win within the time limit sees Deadly', () => {
    const strong = { ...fresh, character: { ...fresh.character, attributes: { ...fresh.character.attributes, strength: 1000, endurance: 1000 } } };
    expect(levels(strong as GameState)).toEqual(['easy', 'easy', 'easy', 'easy', 'easy']);
    const weak = { ...fresh, character: { ...fresh.character, equipment: {}, attributes: { ...fresh.character.attributes, strength: 0, endurance: 10_000 } } };
    // Unarmed 1–2 vs the troll's 300 HP: 300 hits = 300 s > 60 s, even though the troll barely scratches.
    expect(dangerHint(weak as GameState, 'troll_bridge')).toMatchObject({ level: 'deadly' });
  });

  it('averageDealt is the mean over every roll after defense', () => {
    expect(averageDealt({ min: 12, max: 14 }, 6)).toBe(12); // 11, 12, 13
    expect(averageDealt({ min: 3, max: 5 }, 13)).toBe(3); // 2, 3, 4
    expect(averageDealt({ min: 7, max: 7 }, 0)).toBe(7);
  });

  it('uses derived stats (gear + attributes)', () => {
    const d = getDerivedStats(fresh);
    expect([d.damage.min, d.damage.max, d.defense.value]).toEqual([12, 14, 13]);
  });
});
