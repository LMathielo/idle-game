// Engine 1.17.0 / save v17 (owner decisions 2026-11-03):
//   - every hero level-up grants 5 UNSPENT attribute points (no automatic +5 on every attribute); SPEND_ATTRIBUTE_POINTS
//     moves them into permanent normal points (normal = spent + extra; no refund);
//   - woodcutting / mining strength use TOTAL STR 1:1 (workers follow through their 25% share);
//   - current mana regenerates at 5 + total INT per minute wherever HP does (integer banking, exact across resumes);
//   - save v16 → v17: 5 × (level − 1) unspent points, mana full.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { LogRow } from '../src/client/types';
import {
  applyCommand,
  ATTRIBUTE_POINTS,
  attributeViews,
  type Command,
  CURRENT_SAVE_VERSION,
  effectiveAttributes,
  ENGINE_VERSION,
  expectedCrewYieldBp,
  type GameState,
  getDerivedStats,
  hashState,
  heroPower,
  hpRegenPerMinute,
  loadSave,
  manaRegenPerMinute,
  manaView,
  type MigratePayload,
  MIGRATIONS,
  miningStrength,
  newGame,
  normalAttributes,
  REGEN_UNIT,
  replayLogReport,
  type ReplayEntry,
  simulate,
  STATS,
  woodcuttingStrength,
} from '../src/engine';
import { apply, builtGame, cmd, HOUR, makeClient, MIN, SEC, T0, v17Added, V18_ADDED, withCore } from './helpers';

const ZERO = { strength: 0, dexterity: 0, endurance: 0, intelligence: 0 };

const withChar = (s: GameState, patch: Partial<GameState['character']>): GameState => ({ ...s, character: { ...s.character, ...patch } });

/** Sends SPEND_ATTRIBUTE_POINTS and returns the raw result. */
const spend = (s: GameState, points: unknown, now = T0) => applyCommand(s, { id: `spend-${Math.random()}`, type: 'SPEND_ATTRIBUTE_POINTS', points } as Command, now);

describe('level-up grants unspent points (5 per level)', () => {
  it('config: 5 per level; a new hero has 0 spent, 0 unspent, full mana', () => {
    expect(ATTRIBUTE_POINTS).toEqual({ unspentPerLevel: 5 });
    const s = newGame(1, T0);
    expect(s.character).toMatchObject({ spentPoints: ZERO, unspentPoints: 0, mana: 20, manaRegenProgress: 0 });
  });

  it('a single level-up: +5 unspent, attributes unchanged', () => {
    const s = apply(newGame(1, T0), { type: 'DEBUG_GRANT_HERO_XP', amount: 100 }, T0); // Lv1 → Lv2 at 100 XP
    expect(s.character.level).toBe(2);
    expect(s.character.unspentPoints).toBe(5);
    expect(effectiveAttributes(s)).toEqual(ZERO);
  });

  it('a multi-level jump grants 5 per level gained', () => {
    const s = apply(newGame(1, T0), { type: 'DEBUG_GRANT_HERO_XP', amount: 16_000 }, T0);
    expect(s.character.level).toBeGreaterThan(5);
    expect(s.character.unspentPoints).toBe(5 * (s.character.level - 1));
  });

  it('level-ups inside simulate() (dungeon wins, offline) grant them too, and unspent points add up', () => {
    let s = apply(builtGame(3, T0), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    s = withChar(s, { unspentPoints: 2 });
    const r = simulate(s, T0 + 6 * HOUR);
    expect(r.state.character.level).toBeGreaterThan(2);
    expect(r.summary.heroLevelsGained).toBe(r.state.character.level - 1);
    expect(r.state.character.unspentPoints).toBe(2 + 5 * (r.state.character.level - 1));
  });

  it('max HP and max mana rise with the level; current HP and mana do not (they regenerate)', () => {
    const s = apply(newGame(1, T0), { type: 'DEBUG_GRANT_HERO_XP', amount: 100 }, T0);
    const d = getDerivedStats(s);
    expect([d.maxHp.value, d.maxMana.value]).toEqual([60, 25]);
    expect([s.character.hp, s.character.mana]).toEqual([50, 20]);
  });
});

describe('SPEND_ATTRIBUTE_POINTS', () => {
  const base = withChar(builtGame(1, T0), { unspentPoints: 10 });

  it('valid: moves points into spentPoints atomically; totals and every effect read them', () => {
    const r = spend(base, { strength: 3, endurance: 4, intelligence: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.state.character;
    expect(c.spentPoints).toEqual({ strength: 3, dexterity: 0, endurance: 4, intelligence: 2 });
    expect(c.unspentPoints).toBe(1);
    expect(c.attributes).toEqual(ZERO); // extra points untouched
    expect(normalAttributes(r.state)).toEqual({ strength: 3, dexterity: 0, endurance: 4, intelligence: 2 });
    const d = getDerivedStats(r.state);
    expect([d.damage.min, d.damage.max]).toEqual([12 + 3, 14 + 3]); // STR → damage
    expect(d.defense.value).toBe(13 + 4); // END → defense
    expect(hpRegenPerMinute(r.state)).toBe(15 + 4); // END → HP regen
    expect(manaRegenPerMinute(r.state)).toBe(5 + 2); // INT → mana regen
    expect([woodcuttingStrength(r.state).value, miningStrength(r.state).value]).toEqual([21 + 3, 21 + 3]); // STR → WS / MS
  });

  it('spent points accumulate over several commands and with the whole budget; zeros for other keys are fine', () => {
    let s = apply(base, { type: 'SPEND_ATTRIBUTE_POINTS', points: { dexterity: 4, strength: 0 } }, T0);
    s = apply(s, { type: 'SPEND_ATTRIBUTE_POINTS', points: { dexterity: 6 } }, T0);
    expect(s.character.spentPoints.dexterity).toBe(10);
    expect(s.character.unspentPoints).toBe(0);
  });

  it('spent DEX / INT are normal points: they never shorten activities or crafts (core only)', () => {
    const s = apply(base, { type: 'SPEND_ATTRIBUTE_POINTS', points: { dexterity: 5, intelligence: 5 } }, T0);
    const [, dex, , int] = attributeViews(s);
    expect(dex).toMatchObject({ total: 5, spent: 5, core: 0, coreEffects: [{ kind: 'activityTime', bp: 0 }] });
    expect(int).toMatchObject({ total: 5, spent: 5, linear: [{ kind: 'manaRegen', amount: 5 }], coreEffects: [{ kind: 'craftTime', bp: 0 }] });
  });

  it.each([
    ['over budget', { strength: 11 }, 'NOT_ENOUGH_POINTS'],
    ['over budget across keys', { strength: 6, endurance: 5 }, 'NOT_ENOUGH_POINTS'],
    ['negative', { strength: -1, endurance: 2 }, 'INVALID_AMOUNT'],
    ['fractional', { strength: 1.5 }, 'INVALID_AMOUNT'],
    ['NaN', { strength: Number.NaN }, 'INVALID_AMOUNT'],
    ['a string', { strength: '2' }, 'INVALID_AMOUNT'],
    ['unsafe integer', { strength: 2 ** 53 }, 'INVALID_AMOUNT'],
    ['unknown key', { charisma: 1 }, 'UNKNOWN_ATTRIBUTE'],
    ['unknown key beside a valid one', { strength: 1, agility: 1 }, 'UNKNOWN_ATTRIBUTE'],
    ['empty', {}, 'INVALID_AMOUNT'],
    ['all zero', { strength: 0, dexterity: 0 }, 'INVALID_AMOUNT'],
    ['not an object', 5, 'INVALID_AMOUNT'],
    ['an array', [1, 2], 'INVALID_AMOUNT'],
    ['missing', undefined, 'INVALID_AMOUNT'],
  ])('rejects %s with a clear error and changes nothing', (_name, points, code) => {
    const r = spend(base, points);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe(code);
    expect(r.error.message.length).toBeGreaterThan(0);
    expect(base.character).toMatchObject({ unspentPoints: 10, spentPoints: ZERO });
  });

  it('with 0 unspent points any spend is refused', () => {
    const r = spend(builtGame(1, T0), { strength: 1 });
    expect(!r.ok && r.error.code).toBe('NOT_ENOUGH_POINTS');
  });

  it('is not a debug command (works with debug off) and never marks the save as debugged; logged and replayable', async () => {
    const r = applyCommand(base, cmd({ type: 'SPEND_ATTRIBUTE_POINTS', points: { strength: 1 } }), T0, { allowDebug: false });
    expect(r.ok && r.state.flags.debugUsed).toBe(false);
    const { client, repo } = makeClient({ prefix: 'spend' });
    await client.load();
    expect((await client.debug.grantHeroXp(100)).ok).toBe(true); // Lv2: 5 points
    expect((await client.dispatch({ type: 'SPEND_ATTRIBUTE_POINTS', points: { strength: 2, intelligence: 3 } })).ok).toBe(true);
    expect(client.getState().character).toMatchObject({ unspentPoints: 0, spentPoints: { strength: 2, intelligence: 3 } });
    const rows = await repo.getAllLog();
    expect(rows.map((x) => x.type)).toContain('SPEND_ATTRIBUTE_POINTS');
    const report = replayLogReport(rows.map(({ seq: _s, synced: _y, ...x }) => x));
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });

  it('DEBUG_ADD_UNSPENT_POINTS: +N unspent, debug only, bounded, marks the save', () => {
    const s = apply(newGame(1, T0), { type: 'DEBUG_ADD_UNSPENT_POINTS', amount: 5 }, T0);
    expect(s.character.unspentPoints).toBe(5);
    expect(s.flags.debugUsed).toBe(true);
    const off = applyCommand(newGame(1, T0), cmd({ type: 'DEBUG_ADD_UNSPENT_POINTS', amount: 5 }), T0, { allowDebug: false });
    expect(!off.ok && off.error.code).toBe('DEBUG_DISABLED');
    for (const amount of [0, -5, 1.5, 1001]) {
      const r = applyCommand(newGame(1, T0), cmd({ type: 'DEBUG_ADD_UNSPENT_POINTS', amount }), T0);
      expect(!r.ok && r.error.code).toBe('INVALID_AMOUNT');
    }
  });
});

describe('total STR → gathering power (1:1), workers follow', () => {
  it('WS = 10 × level + 10 + total STR + axe; MS the same with the pickaxe; each STR source counts', () => {
    const g = builtGame(1, T0);
    const s = withCore(withChar(g, { spentPoints: { ...ZERO, strength: 7 }, attributes: { ...ZERO, strength: 2 } }), { strength: 4 });
    expect(effectiveAttributes(s).strength).toBe(13);
    expect(woodcuttingStrength(s)).toMatchObject({ value: 10 + 10 + 13 + 1, breakdown: { level: 10, base: 10, strength: 13, axe: 1 } });
    expect(miningStrength(s)).toMatchObject({ value: 10 + 10 + 13 + 1, breakdown: { strength: 13, pickaxe: 1 } });
  });

  it('workers take their 25% share of the hero power, so spent STR raises crew yield', () => {
    const g = withChar(builtGame(1, T0), { unspentPoints: 80 });
    const before = expectedCrewYieldBp(g, 'oak', 4);
    const after = apply(g, { type: 'SPEND_ATTRIBUTE_POINTS', points: { strength: 79 } }, T0);
    expect(heroPower(after, 'woodcutting')).toBe(heroPower(g, 'woodcutting') + 79); // 21 → 100
    expect(heroPower(after, 'mining')).toBe(heroPower(g, 'mining') + 79);
    // 4 workers × 25% = 1 hero: yield = power ÷ 20 (Oak) → 21 / 20 = 1.05, 100 / 20 = 5.
    expect([before, expectedCrewYieldBp(after, 'oak', 4)]).toEqual([10_500, 50_000]);
  });

  it('spending STR can open a tree or rock (Birch needs 100 WS at WC Lv5)', () => {
    let s = withChar(builtGame(1, T0), { unspentPoints: 40 });
    s = { ...s, character: { ...s.character, skills: { ...s.character.skills, woodcutting: { level: 5, xp: 0, xpToNext: 1000 } } } };
    const blocked = applyCommand(s, cmd({ type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'birch' }), T0);
    expect(!blocked.ok && blocked.error.code).toBe('TREE_LOCKED');
    s = apply(s, { type: 'SPEND_ATTRIBUTE_POINTS', points: { strength: 39 } }, T0); // 61 + 39 = 100
    expect(woodcuttingStrength(s).value).toBe(100);
    expect(applyCommand(s, cmd({ type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'birch' }), T0).ok).toBe(true);
  });
});

describe('mana pool: 5 + total INT per minute, wherever HP regenerates', () => {
  const drained = (s: GameState, mana = 0) => withChar(s, { mana, manaRegenProgress: 0 });

  it('config and view: max 20 + 5 per level, regen 5 + 1 × total INT; view shows current / max and time to full', () => {
    expect(STATS.manaRegen).toEqual({ basePerMin: 5, perIntelligence: 1 });
    const s = withCore(drained(builtGame(1, T0), 3), { intelligence: 5 });
    expect(manaRegenPerMinute(s)).toBe(10);
    expect(manaView(s)).toEqual({ mana: 3, maxMana: 20, regenPerMin: 10, full: false, fullInMs: Math.ceil((17 * REGEN_UNIT) / 10) });
    expect(manaView(newGame(1, T0))).toMatchObject({ mana: 20, full: true, fullInMs: 0 });
  });

  it('idle: +5 per minute at INT 0, capped at max, remainder banked, nothing banked while full', () => {
    const s = drained(newGame(1, T0));
    expect(simulate(s, T0 + MIN).state.character).toMatchObject({ mana: 5, manaRegenProgress: 0 });
    expect(simulate(s, T0 + 30 * SEC).state.character).toMatchObject({ mana: 2, manaRegenProgress: 30_000 }); // 2.5
    expect(simulate(s, T0 + HOUR).state.character).toMatchObject({ mana: 20, manaRegenProgress: 0 });
    const full = newGame(1, T0);
    expect(simulate(full, T0 + MIN).state.character).toBe(full.character); // nothing to do: same object (HP full too)
  });

  const activities: [string, (s: GameState) => GameState][] = [
    ['idle', (s) => s],
    ['woodcutting', (s) => apply(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0)],
    ['mining', (s) => apply(s, { type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' }, T0)],
    ['training', (s) => apply(s, { type: 'START_ACTIVITY', kind: 'training', attribute: 'endurance' }, T0)],
    ['dungeon search', (s) => apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0)],
  ];

  it.each(activities)('%s: 3 min of regen = 15 mana (INT 0)', (_n, start) => {
    const s = start(drained(builtGame(4, T0)));
    expect(simulate(s, T0 + 3 * MIN - 1).state.character.mana).toBe(14);
    expect(simulate(s, T0 + 3 * MIN).state.character.mana).toBe(15);
  });

  it.each(activities)('%s: exact across split simulate() calls (simulate(a) + simulate(b) == simulate(a + b))', (_n, start) => {
    // Lv50 (max mana 265) so the pool never fills here; INT 7 → 12/min.
    const s = start(withCore(withChar(drained(builtGame(4, T0)), { level: 50 }), { intelligence: 7 }));
    const end = T0 + 2 * MIN + 13_777;
    const once = simulate(s, end).state;
    let split = simulate(s, T0 + 41_003).state;
    split = simulate(split, T0 + 77_500).state;
    split = simulate(split, end).state;
    expect(hashState(split)).toBe(hashState(once));
    expect(once.character.mana * REGEN_UNIT + once.character.manaRegenProgress).toBe((2 * MIN + 13_777) * 12);
  });

  it('dungeon fight: mana regenerates during the fight too (split mid-fight is exact)', () => {
    let s = apply(drained(builtGame(5, T0)), { type: 'DEBUG_SET_HERO_HP', hp: 50 }, T0);
    s = apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    s = apply(s, { type: 'DEBUG_FINISH_DUNGEON_RUN' }, T0); // the fight starts now
    expect(s.activity).toMatchObject({ phase: 'fight' });
    const mid = simulate(s, T0 + 1500).state;
    expect(mid.activity).toMatchObject({ phase: 'fight' });
    expect(mid.character.mana * REGEN_UNIT + mid.character.manaRegenProgress).toBe(1500 * 5);
    const end = T0 + 3 * MIN;
    expect(hashState(simulate(mid, end).state)).toBe(hashState(simulate(s, end).state));
    expect(simulate(s, end).state.character.mana).toBe(15);
  });

  it('beyond the offline cap: mana keeps regenerating (uncapped like HP), with or without a dungeon', () => {
    const idle = withChar(drained(builtGame(6, T0)), { level: 1000 }); // max mana 5,015: never full here
    const r = simulate(idle, T0 + 10 * HOUR);
    expect(r.summary.grantedMs).toBe(8 * HOUR);
    expect(r.state.character.mana).toBe(10 * 60 * 5); // 3,000: all 10 h, not only the 8 h granted
    const dungeon = apply(idle, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    expect(simulate(dungeon, T0 + 10 * HOUR).state.character.mana).toBe(3000);
    const small = withChar(dungeon, { level: 200 }); // max 1,015
    expect(simulate(small, T0 + 10 * HOUR).state.character.mana).toBe(1015);
  });

  it('the rate follows INT changes at their instant (training INT mid-walk): ticks and one resume agree', () => {
    let s = apply(drained(builtGame(8, T0)), { type: 'START_ACTIVITY', kind: 'training', attribute: 'intelligence' }, T0);
    s = withChar(s, { level: 100 }); // max mana 515: never full here
    const end = T0 + 40 * MIN + 7 * SEC; // INT levels 1 (5 min), 2 (+15 min), 3 (+25 min)…
    const once = simulate(s, end).state;
    expect(once.training.attributes.intelligence.level).toBeGreaterThanOrEqual(2);
    let ticked = s;
    for (let t = T0 + 7 * SEC; t < end; t += 7 * SEC) ticked = simulate(ticked, t).state;
    expect(hashState(simulate(ticked, end).state)).toBe(hashState(once));
    expect(once.character.mana).toBeGreaterThan(40 * 5); // more than 5/min once INT rose
  });

  it('a level-up raises max mana, not current mana (as HP); the new room fills by regen', () => {
    let s = apply(builtGame(9, T0), { type: 'DEBUG_GRANT_HERO_XP', amount: 100 }, T0);
    expect([s.character.mana, manaView(s).maxMana]).toEqual([20, 25]);
    s = simulate(s, T0 + MIN).state;
    expect(s.character.mana).toBe(25);
  });
});

// ---------- save v17 ----------

const FIXTURES = join(__dirname, 'fixtures');
/**
 * Frozen v16 save + log written by the untouched 1.16.0 engine (origin/dev): hero Lv3 (+10 level points on each then),
 * +3 extra STR and +2 extra END (debug), core STR 5, HP 51/70 (set to 30, then regen), Oak 47 s into a cut. 13 rows.
 */
const V16_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v16.json'), 'utf8'));
const V16_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v16.json'), 'utf8'));
const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);

describe('save v17 migration (v16 → v17)', () => {
  it('unspent = 5 × (level − 1), nothing spent, mana full at the level; pure; a broken level counts as 1', () => {
    const d = { saveVersion: 16, character: { level: 4, attributes: { strength: 3 }, hp: 7, gold: 5 }, training: { tier: 1 } };
    const frozen = JSON.parse(JSON.stringify(d));
    const v17 = MIGRATIONS[16](d) as Record<string, any>;
    expect(d).toEqual(frozen);
    expect(v17).toEqual({
      saveVersion: 17,
      character: { level: 4, attributes: { strength: 3 }, hp: 7, gold: 5, spentPoints: ZERO, unspentPoints: 15, mana: 35, manaRegenProgress: 0 },
      training: { tier: 1 },
    });
    expect((MIGRATIONS[16]({ saveVersion: 16, character: { level: 'x' } }) as Record<string, any>).character).toMatchObject({ unspentPoints: 0, mana: 20 });
    expect(MIGRATIONS[16]({ saveVersion: 16 })).toEqual({ saveVersion: 17 });
  });

  it('the frozen v16 save: is what 1.16.0 wrote; migrates (10 points to spend, extra and core kept, mana full); nothing else moves', () => {
    expect(V16_SAVE.saveVersion).toBe(16);
    expect(V16_SAVE.character).toMatchObject({ level: 3, attributes: { strength: 3, dexterity: 0, endurance: 2, intelligence: 0 }, hp: 51 });
    expect(V16_SAVE.training.attributes.strength.level).toBe(5);
    expect(new Set(V16_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.16.0']));
    expect(hashState(V16_SAVE)).toBe(V16_LOG.at(-1)!.stateHash);
    const s = loadSave(V16_SAVE);
    expect(s.saveVersion).toBe(CURRENT_SAVE_VERSION);
    expect(s.character).toEqual({ ...V16_SAVE.character, ...v17Added(3) });
    expect(s.character.unspentPoints).toBe(10);
    expect(s.character.mana).toBe(30); // 20 + 5 × 2, full
    const { character: _c, saveVersion: _v, ...rest } = s;
    const { character: _rc, saveVersion: _rv, ...raw } = V16_SAVE;
    expect(rest).toEqual({ ...raw, buildings: { ...raw.buildings, storage: V18_ADDED.storageBuilding } }); // v18: Storage, unbuilt
    // 1.16.0 read STR as 10 level + 3 extra + 5 core = 18 and WS from core only (10 + 10 + 5 + 1 = 26). Now: 3 + 5 = 8 until
    // the 10 points are spent; WS = 10 + 10 + 8 + 1 = 29.
    expect(effectiveAttributes(s)).toEqual({ strength: 8, dexterity: 0, endurance: 2, intelligence: 0 });
    expect(woodcuttingStrength(s).value).toBe(29);
    expect(hashState(loadSave(V16_SAVE))).toBe(hashState(s)); // deterministic
  });

  it('loading writes a MIGRATE anchor (save 16 → 17, engine 1.16.0 → 1.17.0); spending works; the whole log replays', async () => {
    const repo = new MemoryGameRepository();
    await repo.init();
    await repo.commit(V16_LOG.map(({ seq: _seq, synced: _synced, ...r }) => r), V16_SAVE as GameState, { [META_ENGINE_VERSION]: '1.16.0', device_id: 'phone' });
    const clock = new FakeClock(V16_SAVE.time.lastSimulatedAt + 3 * MIN);
    const { client } = makeClient({ repo, clock, prefix: 'v17' });
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({ fromSave: 16, toSave: CURRENT_SAVE_VERSION, fromEngine: '1.16.0', toEngine: ENGINE_VERSION, fromHash: V16_LOG.at(-1)!.stateHash, snapshot: undefined });
    expect(p.snapshot).toEqual(loadSave(V16_SAVE));
    expect((await client.dispatch({ type: 'SPEND_ATTRIBUTE_POINTS', points: { strength: 6, intelligence: 4 } })).ok).toBe(true);
    expect(client.getState().character).toMatchObject({ unspentPoints: 0, spentPoints: { strength: 6, intelligence: 4 } });
    expect(woodcuttingStrength(client.getState()).value).toBe(35);
    clock.advance(30 * MIN);
    await client.resume();
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: V16_LOG.length });
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});
