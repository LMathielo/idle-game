// Training: gold-bought tiers, timed attribute training, effective attributes (engine 1.5.0, save v6).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { LogRow } from '../src/client/types';
import {
  activityView,
  applyCommand,
  ATTRIBUTE_KEYS,
  type AttributeKey,
  CURRENT_SAVE_VERSION,
  dungeonRunView,
  effectiveAttributes,
  ENGINE_VERSION,
  type GameEvent,
  type GameState,
  getDerivedStats,
  hashState,
  hpRegenPerMinute,
  isNoteworthy,
  loadSave,
  type MigratePayload,
  MIGRATIONS,
  migrateDoc,
  newGame,
  newTrainingState,
  type ReplayEntry,
  replayLogReport,
  simulate,
  TRAINING,
  trainingCap,
  trainingTierPrice,
  trainingView,
  trainingXpToNext,
  trainingXpToReach,
} from '../src/engine';
import { apply, cmd, HOUR, makeClient, MIN, SEC, T0, builtGame, debugBuild } from './helpers';

const FIXTURES = join(__dirname, 'fixtures');
/** Frozen v5 save + its action log, written by the 1.4.0 engine before training (tests/fixtures). */
const V5_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v5.json'), 'utf8'));
const V5_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v5.json'), 'utf8'));

const entries = (rows: LogRow[]): ReplayEntry[] =>
  rows.map((r) => ({ type: r.type, payload: r.payload, clientTime: r.clientTime, engineVersion: r.engineVersion, stateHash: r.stateHash }));

/** Sum of the XP needed to go from level 0 to `level`. */
const cumulative = (level: number) => {
  let total = 0;
  for (let n = 1; n <= level; n++) total += trainingXpToReach(n);
  return total;
};

/** New hero with `gold` and `tier` already bought (set directly: tier purchases are tested on their own). */
function heroAtTier(tier: number, gold = 0): GameState {
  const s = builtGame(7, T0);
  return { ...s, character: { ...s.character, gold }, training: { ...s.training, tier } };
}

function train(s: GameState, attribute: AttributeKey, at = T0): GameState {
  return apply(s, { type: 'START_ACTIVITY', kind: 'training', attribute }, at);
}

const levelUps = (events: GameEvent[]) => events.flatMap((e) => (e.type === 'TRAINING_LEVEL_UP' ? [[e.attribute, e.level]] : []));

/** Simulates in steps of at most 8 h (the offline cap), so long training spans are paid in full. */
function simulateFor(s: GameState, from: number, ms: number) {
  const events: GameEvent[] = [];
  let state = s;
  let t = from;
  let xp = 0;
  while (t < from + ms) {
    t = Math.min(from + ms, t + 8 * HOUR);
    const r = simulate(state, t);
    state = r.state;
    events.push(...r.events);
    xp += Object.values(r.summary.trainingXpGained).reduce<number>((n, v) => n + (v ?? 0), 0);
  }
  return { state, events, xp };
}

describe('curve, caps and prices (config/training.ts)', () => {
  it('XP to reach level n is 5 + 10(n − 1) minutes: Lv1 5, Lv20 195, Lv200 1,995', () => {
    expect(trainingXpToReach(1)).toBe(5);
    expect(trainingXpToReach(2)).toBe(15);
    expect(trainingXpToReach(20)).toBe(195);
    expect(trainingXpToReach(200)).toBe(1995);
    expect(trainingXpToNext(0)).toBe(5); // from level 0 to 1
    expect(() => trainingXpToReach(0)).toThrow(RangeError);
    expect(() => trainingXpToNext(1.5)).toThrow(RangeError);
  });

  it('cumulative: +10 levels = 500 min, +20 levels = 2,000 min (from level 0)', () => {
    expect(cumulative(10)).toBe(500);
    expect(cumulative(20)).toBe(2000);
    expect(cumulative(200)).toBe(200_000);
  });

  it('10 tiers, tier t caps at 20t; tier 0 caps at 0 (nothing trainable)', () => {
    expect(TRAINING.maxTier).toBe(10);
    expect([0, 1, 2, 10].map(trainingCap)).toEqual([0, 20, 40, 200]);
  });

  it('price of tier t is 100 × t³', () => {
    expect(Array.from({ length: 10 }, (_, i) => trainingTierPrice(i + 1))).toEqual([100, 800, 2700, 6400, 12500, 21600, 34300, 51200, 72900, 100000]);
    expect(() => trainingTierPrice(0)).toThrow(RangeError);
    expect(() => trainingTierPrice(11)).toThrow(RangeError);
  });

  it('the rate multiplier hook is 1 (does nothing yet) and whole', () => {
    expect(TRAINING.rateMultiplier).toBe(1);
    expect(Number.isInteger(TRAINING.rateMultiplier)).toBe(true);
  });

  it('a new hero starts at tier 0 with every attribute untrained', () => {
    const s = builtGame(1, T0);
    expect(s.saveVersion).toBe(CURRENT_SAVE_VERSION);
    expect(s.training).toEqual({
      tier: 0,
      attributes: Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, { level: 0, xp: 0, progressMs: 0 }])),
    });
    expect(s.training).toEqual(newTrainingState());
  });
});

describe('UNLOCK_TRAINING_TIER', () => {
  it('Tier 1 costs 100 gold; tiers go in order; the next can be bought before the current one is maxed', () => {
    let s = heroAtTier(0, 1000);
    const r1 = applyCommand(s, cmd({ type: 'UNLOCK_TRAINING_TIER', tier: 1 }), T0);
    if (!r1.ok) throw new Error(r1.error.message);
    expect(r1.state.training.tier).toBe(1);
    expect(r1.state.character.gold).toBe(900);
    expect(r1.events).toContainEqual({ type: 'TRAINING_TIER_UNLOCKED', tier: 1 });
    s = apply(r1.state, { type: 'UNLOCK_TRAINING_TIER', tier: 2 }, T0); // nothing trained yet: still allowed
    expect([s.training.tier, s.character.gold]).toEqual([2, 100]);
  });

  it('out of order or repeated (a double tap) → TIER_NOT_NEXT, nothing changes', () => {
    const s = heroAtTier(0, 1_000_000);
    expect(applyCommand(s, cmd({ type: 'UNLOCK_TRAINING_TIER', tier: 2 }), T0)).toMatchObject({ ok: false, error: { code: 'TIER_NOT_NEXT' } });
    const one = apply(s, { type: 'UNLOCK_TRAINING_TIER', tier: 1 }, T0);
    expect(applyCommand(one, cmd({ type: 'UNLOCK_TRAINING_TIER', tier: 1 }), T0)).toMatchObject({ ok: false, error: { code: 'TIER_NOT_NEXT' } });
    expect(applyCommand(one, cmd({ type: 'UNLOCK_TRAINING_TIER', tier: 0 }), T0)).toMatchObject({ ok: false, error: { code: 'TIER_NOT_NEXT' } });
    expect(applyCommand(one, cmd({ type: 'UNLOCK_TRAINING_TIER', tier: 1.5 }), T0)).toMatchObject({ ok: false, error: { code: 'INVALID_COMMAND' } });
    expect(applyCommand(heroAtTier(10, 1e9), cmd({ type: 'UNLOCK_TRAINING_TIER', tier: 11 }), T0)).toMatchObject({ ok: false, error: { code: 'MAX_TIER' } });
  });

  it('not enough gold → NOT_ENOUGH_GOLD with what is missing; gold and tier untouched', () => {
    const s = builtGame(1, T0); // 25 gold
    const r = applyCommand(s, cmd({ type: 'UNLOCK_TRAINING_TIER', tier: 1 }), T0);
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_GOLD' } });
    expect(!r.ok && r.error.message).toContain('75 missing');
    expect(s.character.gold).toBe(25);
    expect(s.training.tier).toBe(0);
  });

  it('exactly the price leaves 0 gold; gold is never negative over every tier purchase', () => {
    let s = heroAtTier(0, 100);
    s = apply(s, { type: 'UNLOCK_TRAINING_TIER', tier: 1 }, T0);
    expect(s.character.gold).toBe(0);
    // Buy every tier with exactly enough gold each time, and try one gold short before each.
    for (let tier = 2; tier <= 10; tier++) {
      const price = trainingTierPrice(tier);
      const short = { ...s, character: { ...s.character, gold: price - 1 } };
      expect(applyCommand(short, cmd({ type: 'UNLOCK_TRAINING_TIER', tier }), T0)).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_GOLD' } });
      s = apply({ ...s, character: { ...s.character, gold: price } }, { type: 'UNLOCK_TRAINING_TIER', tier }, T0);
      expect(s.character.gold).toBe(0);
      expect(Number.isSafeInteger(s.character.gold)).toBe(true);
    }
    expect(s.training.tier).toBe(10);
    expect(trainingView(s).nextTier).toBeNull();
  });
});

describe('START_ACTIVITY training', () => {
  it('tier 0 → TRAINING_LOCKED; unknown attribute → UNKNOWN_ATTRIBUTE', () => {
    const s = builtGame(1, T0);
    expect(applyCommand(s, cmd({ type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' }), T0)).toMatchObject({
      ok: false,
      error: { code: 'TRAINING_LOCKED' },
    });
    const bad = { type: 'START_ACTIVITY', kind: 'training', attribute: 'agility' } as unknown as Parameters<typeof cmd>[0];
    expect(applyCommand(heroAtTier(1), cmd(bad), T0)).toMatchObject({ ok: false, error: { code: 'UNKNOWN_ATTRIBUTE' } });
  });

  it('a maxed attribute → TRAINING_MAXED until the next tier is bought', () => {
    const s = heroAtTier(1, 800);
    const maxed = { ...s, training: { ...s.training, attributes: { ...s.training.attributes, strength: { level: 20, xp: 0, progressMs: 0 } } } };
    expect(applyCommand(maxed, cmd({ type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' }), T0)).toMatchObject({
      ok: false,
      error: { code: 'TRAINING_MAXED' },
    });
    const t2 = apply(maxed, { type: 'UNLOCK_TRAINING_TIER', tier: 2 }, T0);
    expect(train(t2, 'strength').activity).toEqual({ kind: 'training', attribute: 'strength', startedAt: T0 });
  });

  it('starting the same attribute again is a no-op (no stop/start, progress untouched)', () => {
    const s = simulate(train(heroAtTier(1), 'strength'), T0 + 90 * SEC).state;
    const again = applyCommand(s, cmd({ type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' }), T0 + 90 * SEC);
    expect(again.ok && again.events).toEqual([]);
    expect(again.ok && again.state).toEqual(s);
  });
});

describe('training time', () => {
  it('exactly 1 XP per trained minute; the remainder is kept in ms', () => {
    let s = train(heroAtTier(1), 'strength');
    s = simulate(s, T0 + 90 * SEC).state;
    expect(s.training.attributes.strength).toEqual({ level: 0, xp: 1, progressMs: 30 * SEC });
    s = simulate(s, T0 + 120 * SEC).state;
    expect(s.training.attributes.strength).toEqual({ level: 0, xp: 2, progressMs: 0 });
    // 5 minutes → level 1 (STR 10 → 11), then 15 more for level 2.
    s = simulate(s, T0 + 5 * MIN).state;
    expect(s.training.attributes.strength).toEqual({ level: 1, xp: 0, progressMs: 0 });
    expect(effectiveAttributes(s).strength).toBe(11);
  });

  it('many 1 s ticks = one big resume, byte for byte (END level-ups change HP regen mid-way)', () => {
    let start = train(heroAtTier(1), 'endurance');
    start = apply(start, { type: 'DEBUG_SET_HERO_HP', hp: 1 }, T0); // regen runs the whole time
    const end = T0 + 47 * MIN + 13 * SEC;
    const big = simulate(start, end).state;
    let ticked = start;
    for (let t = T0 + SEC; t <= end; t += SEC) ticked = simulate(ticked, t).state;
    expect(hashState(ticked)).toBe(hashState(big));
    expect(big.training.attributes.endurance.level).toBe(3); // 5 + 15 + 25 = 45 min
  });

  it('pause (STOP_ACTIVITY) keeps XP; training again continues from it', () => {
    let s = simulate(train(heroAtTier(1), 'strength'), T0 + 3 * MIN + 20 * SEC).state;
    s = apply(s, { type: 'STOP_ACTIVITY' }, T0 + 3 * MIN + 20 * SEC);
    expect(s.activity).toBeNull();
    s = simulate(s, T0 + 5 * HOUR).state; // paused: nothing gained
    expect(s.training.attributes.strength).toEqual({ level: 0, xp: 3, progressMs: 20 * SEC });
    s = train(s, 'strength', T0 + 5 * HOUR);
    s = simulate(s, T0 + 5 * HOUR + MIN + 40 * SEC).state; // the 1:40 still missing for 5 min
    expect(s.training.attributes.strength).toEqual({ level: 1, xp: 0, progressMs: 0 });
  });

  it('switching attributes keeps each attribute’s XP', () => {
    let s = simulate(train(heroAtTier(1), 'strength'), T0 + 2 * MIN + 10 * SEC).state;
    s = train(s, 'dexterity', T0 + 2 * MIN + 10 * SEC);
    s = simulate(s, T0 + 6 * MIN).state;
    s = train(s, 'strength', T0 + 6 * MIN);
    expect(s.training.attributes.strength).toEqual({ level: 0, xp: 2, progressMs: 10 * SEC });
    expect(s.training.attributes.dexterity).toEqual({ level: 0, xp: 3, progressMs: 50 * SEC });
    s = simulate(s, T0 + 8 * MIN + 50 * SEC).state;
    expect(s.training.attributes.strength.level).toBe(1);
    expect(s.training.attributes.dexterity).toEqual({ level: 0, xp: 3, progressMs: 50 * SEC });
  });

  it('several level-ups in one simulate() each emit TRAINING_LEVEL_UP, and the summary counts them', () => {
    const r = simulate(train(heroAtTier(1), 'strength'), T0 + 8 * HOUR); // 480 min: 5·9² = 405 → Lv9 + 75 XP
    expect(levelUps(r.events)).toEqual(Array.from({ length: 9 }, (_, i) => ['strength', i + 1]));
    expect(r.state.training.attributes.strength).toEqual({ level: 9, xp: 75, progressMs: 0 });
    expect(r.summary.trainingXpGained).toEqual({ strength: 480 });
    expect(r.summary.trainingLevelsGained).toEqual({ strength: 9 });
    expect(isNoteworthy(r.summary)).toBe(true);
  });

  it('+10 levels take 500 min; +20 take 2,000 min (and Lv20 is the Tier 1 cap)', () => {
    const a = simulateFor(train(heroAtTier(2), 'strength'), T0, 500 * MIN - 1).state;
    expect(a.training.attributes.strength).toEqual({ level: 9, xp: 94, progressMs: MIN - 1 });
    const b = simulateFor(train(heroAtTier(2), 'strength'), T0, 500 * MIN).state;
    expect(b.training.attributes.strength).toEqual({ level: 10, xp: 0, progressMs: 0 });
    const c = simulateFor(train(heroAtTier(2), 'strength'), T0, 2000 * MIN).state;
    expect(c.training.attributes.strength).toEqual({ level: 20, xp: 0, progressMs: 0 });
  });

  it('at the tier cap training stops by itself: no XP beyond it, remainder dropped, TRAINING_MAXED once', () => {
    const { state, events, xp } = simulateFor(train(heroAtTier(1), 'strength'), T0, 40 * HOUR);
    expect(state.training.attributes.strength).toEqual({ level: 20, xp: 0, progressMs: 0 });
    expect(state.activity).toBeNull();
    expect(xp).toBe(2000); // exactly the 20 levels, nothing more
    expect(events.filter((e) => e.type === 'TRAINING_MAXED')).toEqual([{ type: 'TRAINING_MAXED', attribute: 'strength' }]);
    expect(events).toContainEqual({ type: 'ACTIVITY_STOPPED', kind: 'training' });
    expect(levelUps(events)).toHaveLength(20);
    // The cap is hit 80 min into the 5th 8 h block; that block's summary says so.
    const fourBlocks = simulateFor(train(heroAtTier(1), 'strength'), T0, 32 * HOUR).state;
    const fifth = simulate(fourBlocks, T0 + 40 * HOUR);
    expect(fifth.summary.trainingMaxed).toEqual(['strength']);
    expect(fifth.summary.trainingXpGained).toEqual({ strength: 80 });
    expect(fifth.summary.trainingLevelsGained).toEqual({ strength: 1 });
    // Buying Tier 2 lets it continue.
    const t2 = apply({ ...state, character: { ...state.character, gold: 800 } }, { type: 'UNLOCK_TRAINING_TIER', tier: 2 }, T0 + 40 * HOUR);
    const more = simulate(train(t2, 'strength', T0 + 40 * HOUR), T0 + 40 * HOUR + 205 * MIN).state;
    expect(more.training.attributes.strength.level).toBe(21);
  });

  it('offline: the 8 h cap limits training time (10 h away = 480 XP)', () => {
    const r = simulate(train(heroAtTier(1), 'intelligence'), T0 + 10 * HOUR);
    expect(r.summary.grantedMs).toBe(8 * HOUR);
    expect(r.summary.anomalies).toEqual([{ type: 'CLOCK_ANOMALY', kind: 'forward_capped', requestedMs: 10 * HOUR, grantedMs: 8 * HOUR }]);
    expect(r.summary.trainingXpGained).toEqual({ intelligence: 480 });
  });

  it('a backward clock pauses training until real time catches up', () => {
    let s = simulate(train(heroAtTier(1), 'strength'), T0 + 2 * HOUR).state;
    const before = s.training.attributes.strength;
    const back = simulate(s, T0 + HOUR);
    expect(back.summary.anomalies[0]).toMatchObject({ kind: 'backward' });
    expect(back.state.training.attributes.strength).toEqual(before);
    s = simulate(back.state, T0 + 2 * HOUR - MIN).state; // still behind the highest time seen
    expect(s.training.attributes.strength).toEqual(before);
    s = simulate(s, T0 + 2 * HOUR + 3 * MIN).state; // 3 min past it: paid once
    expect(s.training.attributes.strength).toEqual({ ...before, xp: before.xp + 3 });
  });
});

describe('one activity at a time', () => {
  it('training ↔ woodcutting: each stops the other; training XP is kept', () => {
    let s = simulate(train(heroAtTier(1), 'strength'), T0 + 2 * MIN).state;
    const r = applyCommand(s, cmd({ type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }), T0 + 2 * MIN);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events).toEqual([
      { type: 'ACTIVITY_STOPPED', kind: 'training' },
      { type: 'ACTIVITY_STARTED', kind: 'woodcutting' },
    ]);
    s = simulate(r.state, T0 + HOUR).state;
    expect(s.training.attributes.strength).toEqual({ level: 0, xp: 2, progressMs: 0 });
    const back = applyCommand(s, cmd({ type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' }), T0 + HOUR);
    expect(back.ok && back.events).toEqual([
      { type: 'ACTIVITY_STOPPED', kind: 'woodcutting' },
      { type: 'ACTIVITY_STARTED', kind: 'training' },
    ]);
  });

  it('dungeon → training: the run in progress is lost; training → dungeon: training stops, XP kept', () => {
    let s = apply(heroAtTier(1), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    s = simulate(s, T0 + MIN).state; // mid-search (1:50 at DEX 10)
    const r = applyCommand(s, cmd({ type: 'START_ACTIVITY', kind: 'training', attribute: 'endurance' }), T0 + MIN);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events).toContainEqual({ type: 'DUNGEON_RUN_CANCELLED', dungeonId: 'rat_cellar' });
    expect(r.state.dungeon.totals.runs).toBe(0); // no fight, no rewards
    s = simulate(r.state, T0 + 8 * MIN).state;
    s = apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0 + 8 * MIN);
    expect(s.activity?.kind).toBe('dungeon');
    expect(s.training.attributes.endurance).toEqual({ level: 1, xp: 2, progressMs: 0 });
    s = simulate(s, T0 + 2 * HOUR).state;
    expect(s.training.attributes.endurance).toEqual({ level: 1, xp: 2, progressMs: 0 });
  });
});

describe('effective attributes feed every rule', () => {
  it('5 min of STR training: STR 10 → 11 and damage +1 (acceptance)', () => {
    const s0 = train(heroAtTier(1), 'strength');
    const s = simulate(s0, T0 + 5 * MIN).state;
    expect(s.character.attributes.strength).toBe(10); // base stays
    expect(effectiveAttributes(s).strength).toBe(11);
    const [d0, d1] = [getDerivedStats(s0).damage, getDerivedStats(s).damage];
    expect([d1.min - d0.min, d1.max - d0.max]).toEqual([1, 1]);
    expect(d1.breakdown.find((p) => p.source === 'strength')).toMatchObject({ min: 11, max: 11 });
  });

  it('END: defense and HP regen; DEX: dungeon search time', () => {
    const base = heroAtTier(2);
    const trained = { ...base, training: { ...base.training, attributes: { ...base.training.attributes, endurance: { level: 7, xp: 0, progressMs: 0 }, dexterity: { level: 25, xp: 0, progressMs: 0 } } } };
    expect(getDerivedStats(trained).defense.value - getDerivedStats(base).defense.value).toBe(7);
    expect(hpRegenPerMinute(trained)).toBe(5 + 17);
    const search = (s: GameState) => dungeonRunView(apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0))!.searchMs;
    expect(search(base)).toBe(110 * SEC);
    expect(search(trained)).toBe(85 * SEC); // DEX 35
    // The skip cost reads the same search time.
    const started = apply(trained, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    expect(dungeonRunView(started)!.skipCost).toBe(2); // 1:25 left → 2 started minutes
  });
});

describe('views', () => {
  it('tier 0: Tier 1 for 100 g, unaffordable with 25 g (75 missing), nothing trainable', () => {
    const v = trainingView(builtGame(1, T0));
    expect(v).toMatchObject({ tier: 0, cap: 0, active: null, nextTier: { tier: 1, price: 100, cap: 20, affordable: false, missing: 75 } });
    expect(v.attributes.map((a) => [a.attribute, a.effective, a.trained, a.maxed])).toEqual(ATTRIBUTE_KEYS.map((k) => [k, 10, 0, false]));
  });

  it('active attribute: fraction and minutes left; the strip view matches', () => {
    const s = simulate(train(heroAtTier(1), 'strength'), T0 + 3 * MIN + 30 * SEC).state;
    const str = trainingView(s).attributes[0];
    expect(str).toMatchObject({ attribute: 'strength', active: true, xp: 3, xpToNext: 5, fraction: 0.7, remainingMs: 90 * SEC, effective: 10 });
    expect(activityView(s)).toEqual({ kind: 'training', ...str });
  });

  it('maxed attribute: full bar, 0 left', () => {
    const s = heroAtTier(1);
    const m = { ...s, training: { ...s.training, attributes: { ...s.training.attributes, dexterity: { level: 20, xp: 0, progressMs: 0 } } } };
    expect(trainingView(m).attributes[1]).toMatchObject({ maxed: true, fraction: 1, remainingMs: 0, effective: 30 });
  });
});

describe('debug rows', () => {
  it('+60 min training XP needs an attribute in training; it levels up and caps like real time', () => {
    const idle = heroAtTier(1);
    expect(applyCommand(idle, cmd({ type: 'DEBUG_ADD_TRAINING_XP', xp: 60 }), T0)).toMatchObject({ ok: false, error: { code: 'NOT_TRAINING' } });
    const s = apply(train(idle, 'strength'), { type: 'DEBUG_ADD_TRAINING_XP', xp: 60 }, T0);
    expect(s.training.attributes.strength).toEqual({ level: 3, xp: 15, progressMs: 0 }); // 5 + 15 + 25 = 45, +15
    expect(s.flags.debugUsed).toBe(true);
    const capped = applyCommand(s, cmd({ type: 'DEBUG_ADD_TRAINING_XP', xp: 100_000 }), T0);
    expect(capped.ok && capped.state.training.attributes.strength).toEqual({ level: 20, xp: 0, progressMs: 0 });
    expect(capped.ok && capped.state.activity).toBeNull();
    expect(capped.ok && capped.events.filter((e) => e.type === 'TRAINING_MAXED')).toHaveLength(1);
    expect(applyCommand(s, cmd({ type: 'DEBUG_ADD_TRAINING_XP', xp: 0 }), T0)).toMatchObject({ ok: false, error: { code: 'INVALID_AMOUNT' } });
    expect(applyCommand(s, cmd({ type: 'DEBUG_ADD_TRAINING_XP', xp: 60 }), T0, { allowDebug: false })).toMatchObject({
      ok: false,
      error: { code: 'DEBUG_DISABLED' },
    });
  });

  it('+1,000 gold; bounded', () => {
    const s = apply(builtGame(1, T0), { type: 'DEBUG_ADD_GOLD', amount: 1000 }, T0);
    expect(s.character.gold).toBe(1025);
    expect(s.flags.debugUsed).toBe(true);
    expect(applyCommand(s, cmd({ type: 'DEBUG_ADD_GOLD', amount: -5 }), T0)).toMatchObject({ ok: false, error: { code: 'INVALID_AMOUNT' } });
  });

  it('the whole flow through the client replays to the live hash (debug rows included)', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'tr' });
    await client.load();
    expect((await client.debug.addGold()).ok).toBe(true);
    await debugBuild(client, ['training_grounds']); // 1.9.0: the Training Grounds come with Tier 1
    expect((await client.dispatch({ type: 'UNLOCK_TRAINING_TIER', tier: 2 })).ok).toBe(true);
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' })).ok).toBe(true);
    for (let i = 0; i < 70; i++) {
      clock.advance(SEC);
      await client.tick();
    }
    expect((await client.debug.addTrainingXp()).ok).toBe(true);
    clock.advance(2 * HOUR);
    await client.resume();
    await client.persist();
    const rows = await repo.getAllLog();
    expect(rows.map((r) => r.type)).toEqual(expect.arrayContaining(['DEBUG_ADD_GOLD', 'DEBUG_BUILD', 'UNLOCK_TRAINING_TIER', 'DEBUG_ADD_TRAINING_XP']));
    const report = replayLogReport(entries(rows));
    expect(hashState(report.state)).toBe(hashState(client.getState()));
    expect(report.state?.flags.debugUsed).toBe(true);
  });
});

describe('client: away summary', () => {
  it('2 h away while training: 120 XP credited, levels gained in the summary', async () => {
    const { clock, client } = makeClient({ prefix: 'away' });
    await client.load();
    await debugBuild(client, ['training_grounds']); // Tier 1 comes with the building
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' });
    await client.persist();
    clock.advance(2 * HOUR);
    await client.resume();
    const away = client.getSnapshot().awaySummary;
    expect(away?.trainingXpGained).toEqual({ strength: 120 });
    expect(away?.trainingLevelsGained).toEqual({ strength: 4 }); // 5 + 15 + 25 + 35 = 80, 40 more toward Lv5
    expect(client.getState().training.attributes.strength).toEqual({ level: 4, xp: 40, progressMs: 0 });
  });
});

describe('frozen v5 save (tests/fixtures/save-v5.json) → v6', () => {
  /** A phone that ran the 1.4.0 build: the v5 document, its log and engine_version = 1.4.0. */
  async function v5Phone() {
    const repo = new MemoryGameRepository();
    await repo.init();
    await repo.commit(
      V5_LOG.map(({ seq: _seq, synced: _synced, ...r }) => r),
      V5_SAVE as GameState,
      { [META_ENGINE_VERSION]: '1.4.0', device_id: 'phone' },
    );
    const clock = new FakeClock(V5_SAVE.time.lastSimulatedAt + 3 * MIN);
    return makeClient({ repo, clock, prefix: 'v6' });
  }

  it('is what the 1.4.0 engine wrote: Bat Cave running, 198 gold, no training', () => {
    expect(V5_SAVE.saveVersion).toBe(5);
    expect(V5_SAVE).not.toHaveProperty('training');
    expect(V5_SAVE.activity).toMatchObject({ kind: 'dungeon', dungeonId: 'bat_cave' });
    expect(V5_SAVE.character.gold).toBe(198);
    expect(new Set(V5_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.4.0']));
  });

  it('migrates: adds an untrained tier-0 training state and changes nothing else (pure, deterministic)', () => {
    const frozen = JSON.parse(JSON.stringify(V5_SAVE));
    // The v5 → v6 step only (v6 → v7 is tested from the v6 fixture).
    const s = migrateDoc(V5_SAVE, MIGRATIONS, 6) as unknown as GameState;
    expect(V5_SAVE).toEqual(frozen);
    expect(s.saveVersion).toBe(6);
    expect(s.training).toEqual(newTrainingState());
    const { training: _t, saveVersion: _v, ...rest } = s;
    const { saveVersion: _rv, ...rawRest } = V5_SAVE;
    expect(rest).toEqual(rawRest);
    expect(hashState(migrateDoc(V5_SAVE, MIGRATIONS, 6) as unknown as GameState)).toBe(hashState(s));
    // Derived stats are unchanged by the migration (no training yet): base attributes only.
    expect(effectiveAttributes(s)).toEqual(V5_SAVE.character.attributes);
  });

  it('loading writes a MIGRATE anchor (save 5 → 6, engine 1.4.0 → 1.5.0) and the whole log replays', async () => {
    const { repo, clock, client } = await v5Phone();
    await client.load();
    const log = await repo.getAllLog();
    const m = log.filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({
      fromSave: 5,
      toSave: CURRENT_SAVE_VERSION,
      fromEngine: '1.4.0',
      toEngine: ENGINE_VERSION,
      fromHash: V5_LOG.at(-1)!.stateHash,
      snapshot: undefined,
    });
    expect(p.snapshot).toEqual(loadSave(V5_SAVE));

    // Plays on with training (1.9.0: the Training Grounds, built here with debug, come with Tier 1); training
    // cancels the Bat Cave run.
    await debugBuild(client, ['training_grounds']);
    expect(client.getState().training.tier).toBe(1);
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'training', attribute: 'endurance' })).ok).toBe(true);
    clock.advance(30 * MIN);
    await client.resume();
    expect(effectiveAttributes(client.getState()).endurance).toBe(13 + 2);

    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: V5_LOG.length });
    expect(hashState(report.state)).toBe(hashState(client.getState()));
  });
});
