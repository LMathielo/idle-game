// Engine 1.16.0 / save v16: normal and core attribute points (owner-approved 2026-11-01).
//   total = normal + core; normal = 5 × (level − 1) + stored extra; core = training level.
//   Linear effects read the total (STR damage, END defense and regen); core DEX / INT shorten activity / craft time on the
//   diminishing curve; core STR adds to WS / MS. A new hero has 0 everywhere and plays like the old 10-stat hero.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { LogRow } from '../src/client/types';
import {
  activityTimeMs,
  attributeViews,
  coreAttributes,
  craftMs,
  CURRENT_SAVE_VERSION,
  dexActivityReductionBp,
  dungeonRunView,
  effectiveAttributes,
  ENGINE_VERSION,
  type GameState,
  getDerivedStats,
  hashState,
  hpRegenPerMinute,
  intCraftReductionBp,
  levelPoints,
  loadSave,
  logMsFor,
  type MigratePayload,
  MIGRATIONS,
  miningStrength,
  newGame,
  normalAttributes,
  oreMsFor,
  replayLogReport,
  type ReplayEntry,
  searchMsFor,
  simulate,
  STAT_EFFECTS,
  woodcuttingStrength,
} from '../src/engine';
import { apply, builtGame, HOUR, makeClient, MIN, SEC, T0, withCore } from './helpers';

const withLevel = (s: GameState, level: number, extra: Partial<GameState['character']['attributes']> = {}): GameState => ({
  ...s,
  character: { ...s.character, level, attributes: { ...s.character.attributes, ...extra } },
});

describe('normal, core and total', () => {
  it('level points: +5 per level above 1 on every attribute (Lv1 = 0, Lv2 = 5, Lv10 = 45), derived, never stored', () => {
    expect([1, 2, 10].map(levelPoints)).toEqual([0, 5, 45]);
    expect([0, -3, 1.5, Number.NaN].map(levelPoints)).toEqual([0, 0, 0, 0]);
    const s = withLevel(newGame(1, T0), 10);
    expect(s.character.attributes).toEqual({ strength: 0, dexterity: 0, endurance: 0, intelligence: 0 });
    expect(normalAttributes(s)).toEqual({ strength: 45, dexterity: 45, endurance: 45, intelligence: 45 });
  });

  it('total = level points + extra + core; core = training level only', () => {
    const s = withCore(withLevel(newGame(1, T0), 3, { strength: 7 }), { strength: 4, dexterity: 10 });
    expect(coreAttributes(s)).toEqual({ strength: 4, dexterity: 10, endurance: 0, intelligence: 0 });
    expect(normalAttributes(s)).toEqual({ strength: 17, dexterity: 10, endurance: 10, intelligence: 10 });
    expect(effectiveAttributes(s)).toEqual({ strength: 21, dexterity: 20, endurance: 10, intelligence: 10 });
  });

  it('attributeViews: the split and each part’s effects (the Status popover reads them, no math in the screen)', () => {
    const s = withCore(withLevel(newGame(1, T0), 2, { strength: 3 }), { strength: 2, dexterity: 10, intelligence: 50 });
    const [str, dex, end, int] = attributeViews(s);
    expect(str).toEqual({
      attribute: 'strength',
      total: 10,
      normal: 8,
      levelPoints: 5,
      extra: 3,
      core: 2,
      linear: [{ kind: 'damage', amount: 10 }],
      coreEffects: [{ kind: 'gatheringPower', amount: 2 }],
    });
    expect(dex).toMatchObject({ total: 15, normal: 5, core: 10, linear: [], coreEffects: [{ kind: 'activityTime', bp: 833 }] });
    expect(end).toMatchObject({ total: 5, core: 0, linear: [{ kind: 'defense', amount: 5 }, { kind: 'hpRegen', amount: 5 }], coreEffects: [] });
    expect(int).toMatchObject({ total: 55, core: 50, linear: [], coreEffects: [{ kind: 'craftTime', bp: 2500 }] });
  });
});

describe('a 0-stat new hero plays exactly like the old 10-stat new hero (the 10 moved into the base numbers)', () => {
  it('damage 12–14, defense 13, HP regen 15/min, WS 21, MS 21 (the values before 1.16.0)', () => {
    const s = builtGame(1, T0);
    expect(effectiveAttributes(s)).toEqual({ strength: 0, dexterity: 0, endurance: 0, intelligence: 0 });
    const d = getDerivedStats(s);
    expect([d.damage.min, d.damage.max, d.defense.value]).toEqual([12, 14, 13]);
    expect(hpRegenPerMinute(s)).toBe(15);
    expect(woodcuttingStrength(s).value).toBe(21);
    expect(miningStrength(s).value).toBe(21);
  });

  it('every extra point still counts like an old point above 10 (linear effects)', () => {
    const s = withLevel(builtGame(1, T0), 1, { strength: 7, endurance: 4 });
    const d = getDerivedStats(s);
    expect([d.damage.min, d.damage.max, d.defense.value]).toEqual([19, 21, 17]); // old STR 17, END 14
    expect(hpRegenPerMinute(s)).toBe(19);
  });
});

describe('core DEX → activity time (diminishing, cap 50%, k 50)', () => {
  const g = builtGame(1, T0);
  const at = (dexterity: number) => withCore(g, { dexterity });

  it('reduction 0 / 833 / 2500 / 4038 bp at core 0 / 10 / 50 / 210; config next to INT', () => {
    expect(STAT_EFFECTS.dexterity.activityTime).toEqual({ capBp: 5000, k: 50 });
    expect([0, 10, 50, 100, 210].map((v) => dexActivityReductionBp(at(v)))).toEqual([0, 833, 2500, 3333, 4038]);
  });

  it('search, cut and ore: max(floor, ceil(base × (1 − reduction))) at core 0 / 10 / 50 / 210', () => {
    const times = (v: number) => [searchMsFor('rat_cellar', at(v)), logMsFor('oak', at(v)), oreMsFor('stone', at(v)), searchMsFor('troll_bridge', at(v))];
    expect(times(0)).toEqual([120_000, 120_000, 120_000, 720_000]);
    expect(times(10)).toEqual([110_004, 110_004, 110_004, 660_024]);
    expect(times(50)).toEqual([90_000, 90_000, 90_000, 540_000]);
    expect(times(210)).toEqual([71_544, 71_544, 71_544, 429_264]);
  });

  it('the floors hold: search 60 s, gathering 10 s', () => {
    expect(activityTimeMs(100_000, 60_000, 4999)).toBe(60_000);
    expect(activityTimeMs(15_000, 10_000, 4999)).toBe(10_000);
    expect(activityTimeMs(120_000, 60_000, 0)).toBe(120_000);
    expect(activityTimeMs(120_000, 60_000, -5)).toBe(120_000);
  });

  it('normal DEX (level points, extra) never counts', () => {
    const s = withLevel(g, 50, { dexterity: 1000 });
    expect([searchMsFor('rat_cellar', s), logMsFor('oak', s), oreMsFor('stone', s)]).toEqual([120_000, 120_000, 120_000]);
  });
});

describe('core INT → craft time, core STR → gathering power', () => {
  it('only core INT shortens crafting (house × INT multiply)', () => {
    const g = builtGame(1, T0);
    expect(craftMs(g, 'oak_plank')).toBe(5000);
    expect(intCraftReductionBp(withLevel(g, 40, { intelligence: 500 }))).toBe(0);
    expect(craftMs(withCore(g, { intelligence: 10 }), 'oak_plank')).toBe(4584);
    const lv3 = { ...withCore(g, { intelligence: 50 }), buildings: { ...g.buildings, town_hall: { state: 'built' as const, level: 5 }, crafting: { state: 'built' as const, level: 3 } } };
    expect(craftMs(lv3, 'oak_plank')).toBe(3038); // 5000 × 0.81 × 0.75
  });

  it('WS / MS = 10 × level + 10 base + core STR + tool; normal STR adds damage but no power', () => {
    const g = builtGame(1, T0);
    const normal = withLevel(g, 30, { strength: 200 });
    expect([woodcuttingStrength(normal).value, miningStrength(normal).value]).toEqual([21, 21]);
    expect(getDerivedStats(normal).damage.min).toBe(2 + 10 + 145 + 200);
    const core = withCore(g, { strength: 15 });
    expect([woodcuttingStrength(core).value, miningStrength(core).value]).toEqual([36, 36]);
    expect(woodcuttingStrength(core).breakdown).toMatchObject({ level: 10, base: 10, strength: 15, axe: 1 });
  });
});

describe('split invariance with level points', () => {
  it('a hero levelling up mid-walk (wins raise END and so the HP regen) gives the same state for 1 s ticks and one resume', () => {
    const s = apply(apply(builtGame(9, T0), { type: 'DEBUG_SET_HERO_HP', hp: 20 }, T0), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    const end = T0 + 20 * MIN + 7 * SEC;
    const once = simulate(s, end).state;
    expect(once.character.level).toBeGreaterThan(1);
    let ticked = s;
    for (let t = T0 + SEC; t <= end; t += SEC) ticked = simulate(ticked, t).state;
    expect(hashState(ticked)).toBe(hashState(once));
    let odd = s;
    for (let t = T0 + 13 * SEC; t < end; t += 13 * SEC) odd = simulate(odd, t).state;
    expect(hashState(simulate(odd, end).state)).toBe(hashState(once));
  });
});

// ---------- save v16 ----------

const FIXTURES = join(__dirname, 'fixtures');
/**
 * Frozen v15 save + log written by the 1.15.0 engine (generated from untouched origin/dev): hero Lv3, +3 debug STR (stored
 * 13, the rest 10), DEX trained to 5, INT trained to 2, Training Grounds and Woodcutting built by debug, Rat Cellar running
 * 47 s into a search (1:45 at DEX 15 then). 13 rows.
 */
const V15_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v15.json'), 'utf8'));
const V15_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v15.json'), 'utf8'));
const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);

describe('save v16 migration (v15 → v16)', () => {
  it('stored attributes become extra normal points, max(0, old − 10); nothing else moves; pure', () => {
    const d = { saveVersion: 15, character: { level: 4, attributes: { strength: 13, dexterity: 10, endurance: 4, intelligence: 'x' }, gold: 5 }, training: { tier: 1 } };
    const frozen = JSON.parse(JSON.stringify(d));
    const v16 = MIGRATIONS[15](d) as Record<string, any>;
    expect(d).toEqual(frozen);
    expect(v16).toEqual({ saveVersion: 16, character: { level: 4, attributes: { strength: 3, dexterity: 0, endurance: 0, intelligence: 0 }, gold: 5 }, training: { tier: 1 } });
    expect(MIGRATIONS[15]({ saveVersion: 15 })).toEqual({ saveVersion: 16 });
  });

  it('the frozen v15 save: is what 1.15.0 wrote, migrates (training kept as core, level points at once), nothing else moves', () => {
    expect(V15_SAVE.saveVersion).toBe(15);
    expect(V15_SAVE.character).toMatchObject({ level: 3, attributes: { strength: 13, dexterity: 10, endurance: 10, intelligence: 10 } });
    expect(new Set(V15_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.15.0']));
    expect(hashState(V15_SAVE)).toBe(V15_LOG.at(-1)!.stateHash);
    const s = loadSave(V15_SAVE);
    expect(s.saveVersion).toBe(CURRENT_SAVE_VERSION);
    expect(s.character.attributes).toEqual({ strength: 3, dexterity: 0, endurance: 0, intelligence: 0 });
    expect(s.training).toEqual(V15_SAVE.training);
    expect(coreAttributes(s)).toEqual({ strength: 0, dexterity: 5, endurance: 0, intelligence: 2 });
    expect(effectiveAttributes(s)).toEqual({ strength: 13, dexterity: 15, endurance: 10, intelligence: 12 }); // Lv3: +10 each
    const { character, saveVersion: _v, ...rest } = s;
    const { character: rc, saveVersion: _rv, ...raw } = V15_SAVE;
    expect(rest).toEqual(raw);
    expect({ ...character, attributes: rc.attributes }).toEqual(rc);
    // The search in progress keeps its 47 s; it now ends at 114,552 ms (core DEX 5: −4.54%).
    expect(dungeonRunView(s)).toMatchObject({ phase: 'search', searchMs: 114_552, remainingMs: 114_552 - 47_000 });
  });

  it('loading writes a MIGRATE anchor (save 15 → 16, engine 1.15.0 → 1.16.0); play goes on; the whole log replays', async () => {
    const repo = new MemoryGameRepository();
    await repo.init();
    await repo.commit(V15_LOG.map(({ seq: _seq, synced: _synced, ...r }) => r), V15_SAVE as GameState, { [META_ENGINE_VERSION]: '1.15.0', device_id: 'phone' });
    const clock = new FakeClock(V15_SAVE.time.lastSimulatedAt + 3 * MIN);
    const { client } = makeClient({ repo, clock, prefix: 'v16' });
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({ fromSave: 15, toSave: 16, fromEngine: '1.15.0', toEngine: ENGINE_VERSION, fromHash: V15_LOG.at(-1)!.stateHash, snapshot: undefined });
    expect(ENGINE_VERSION).toBe('1.16.0');
    expect(p.snapshot).toEqual(loadSave(V15_SAVE));
    // Training DEX again raises the core points that shorten the search.
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'training', attribute: 'dexterity' })).ok).toBe(true);
    clock.advance(HOUR);
    await client.resume();
    expect(client.getState().training.attributes.dexterity.level).toBe(6);
    expect(searchMsFor('rat_cellar', client.getState())).toBe(113_580); // core DEX 6: 535 bp
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' })).ok).toBe(true);
    clock.advance(30 * MIN);
    await client.resume();
    expect(client.getState().dungeon.totals.runs).toBeGreaterThan(V15_SAVE.dungeon.totals.runs);
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: V15_LOG.length });
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});
