// Save v22 (engine 1.24.0): difficulties and packs. A frozen v21 save (written by the untouched 1.23.x engine code on origin/dev: a Lv 20
// STR+END hero, 140 Normal stage wins, the Troll Chieftain killed once and lost to once, a Troll Bridge fight three strikes in, a boss win
// in `lastFight`) must load into v22 with:
//   - every existing counter becoming the Normal one (the Hard / Extreme counters empty), the selected difficulty Normal for every tier;
//   - the fight in progress a pack of ONE Normal mob that plays on exactly as before;
//   - the last fight shown as a Normal pack of one;
//   - nothing else changed (the main RNG and the clock included).
// tests/fixtures/save-v21-reference.json holds what the UNTOUCHED v21 engine produced from this very save (the fight's end and the state
// after 30 minutes); the migrated save must reproduce it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { LogRow } from '../src/client/types';
import {
  applyCommand,
  CURRENT_SAVE_VERSION,
  difficultyViews,
  dungeonRunView,
  ENGINE_VERSION,
  type GameState,
  hashState,
  loadSave,
  type MigratePayload,
  MIGRATIONS,
  replayLogReport,
  type ReplayEntry,
  selectedDifficulty,
  simulate,
} from '../src/engine';
import { asV21, cmd, makeClient, MIN, SEC } from './helpers';

const V21: Record<string, any> = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'save-v21.json'), 'utf8'));
const REF: Record<string, any> = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'save-v21-reference.json'), 'utf8'));
const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);

describe('the frozen v21 save', () => {
  it('is what it claims: v21, a Troll Bridge fight in progress as one flat enemy, a boss win on record, no difficulty anywhere', () => {
    expect(V21.saveVersion).toBe(21);
    expect(V21.activity).toMatchObject({ kind: 'dungeon', dungeonId: 'troll_bridge', phase: 'fight' });
    expect(V21.activity.fight).toMatchObject({ enemyId: 'troll', elapsedMs: 3500, enemyHp: 175, enemyMaxHp: 300, heroStrikes: 3, enemyStrikes: 3 });
    expect(V21.activity.fight.mobs).toBeUndefined();
    expect(V21.dungeon.lastFight).toMatchObject({ dungeonId: 'troll_chieftain', won: true });
    expect(V21.dungeon.bosses.troll_chieftain).toEqual({ runs: 2, wins: 1, losses: 1 });
    expect(JSON.stringify(V21)).not.toContain('difficulty');
    expect(JSON.stringify(V21)).not.toContain('harder');
  });
});

describe('v21 -> v22', () => {
  const s = loadSave(V21);

  it('loads as the current save; the main RNG, the clock and everything else are untouched', () => {
    expect(CURRENT_SAVE_VERSION).toBe(25);
    expect(s.saveVersion).toBe(25);
    expect(s.rng).toEqual(V21.rng);
    expect(s.time).toEqual(V21.time);
    // Taking the new shape off again gives the fixture byte for byte.
    expect(asV21(s)).toEqual(V21);
  });

  it('every existing counter is the Normal one; Hard and Extreme start empty; the selected difficulty is Normal for the tier', () => {
    expect(s.dungeon.byDungeon).toEqual(V21.dungeon.byDungeon);
    expect(s.dungeon.bosses).toEqual(V21.dungeon.bosses);
    expect(s.dungeon.totals).toEqual(V21.dungeon.totals);
    expect(s.dungeon.harder).toEqual({ hard: { byDungeon: {}, bosses: {} }, extreme: { byDungeon: {}, bosses: {} } });
    expect(s.dungeon.difficulty).toEqual({ '1': 'normal' });
    expect(selectedDifficulty(s, 1)).toBe('normal');
  });

  it('the boss was killed on Normal in this save, so Hard is open (a rule of the counters, not a flag); Extreme is not', () => {
    expect(difficultyViews(s, 1).map((v) => [v.difficulty, v.unlocked])).toEqual([['normal', true], ['hard', true], ['extreme', false]]);
  });

  it('the fight in progress is a pack of one Normal mob, with the old fields moved over unchanged', () => {
    const f = s.activity?.kind === 'dungeon' ? s.activity.fight : null;
    expect(s.activity).toMatchObject({ kind: 'dungeon', dungeonId: 'troll_bridge', difficulty: 'normal', phase: 'fight' });
    expect(f).not.toBeNull();
    expect(f!.mobs).toHaveLength(1);
    const old = V21.activity.fight;
    expect(f!.mobs[0]).toMatchObject({ variant: 'base', multBp: 10_000, hp: old.enemyHp, maxHp: old.enemyMaxHp, strikes: old.enemyStrikes, side: old.enemy, regenBp: old.enemyRegenBp });
    expect(f!.log).toEqual(old.log); // no `mob` index on a fight of one
    expect(f!.elapsedMs).toBe(3500);
    expect(f!.heroStrikes).toBe(3);
    expect(dungeonRunView(s)).toMatchObject({ dungeonId: 'troll_bridge', difficulty: 'normal' });
  });

  it('lastFight is a Normal pack of one', () => {
    expect(s.dungeon.lastFight).toMatchObject({
      difficulty: 'normal',
      dungeonId: 'troll_chieftain',
      won: true,
      mobs: [{ variant: 'base', multBp: 10_000, maxHp: 1000, hpEnd: 0 }],
    });
  });

  it('plays on exactly as the untouched v21 engine played it: the same fight end, the same stream, the same rewards, the same log', () => {
    // Only up to the end of the fight in progress: the fights after it open the 1.25.0 way (hero at 0, monsters at 300 ms), so the
    // `after30min` reference of the untouched 1.23.x engine no longer applies to them (tests/migrationV22.test.ts covers that hand-over).
    for (const [key, ms] of [['fightEnd', 60_000]] as const) {
      const r = simulate(s, s.time.lastSimulatedAt + ms).state;
      const f = r.dungeon.lastFight!;
      const want = REF[key];
      expect(f).toMatchObject({ won: want.won, endReason: want.endReason, durationMs: want.durationMs, heroHpEnd: want.heroHpEnd, dungeonId: want.lastDungeon, difficulty: 'normal' });
      // 1.26.0 (mob drops): the Troll Bridge win now draws a gear chance and a Wild Sage chance after the gold, so the Troll Hide roll
      // reads another point of the stream (it hits now; it missed before) and the stream ends elsewhere. Gold, XP and the fight are unchanged.
      expect(f.rewards).toEqual({ ...want.rewards, items: { troll_hide: 1 } }); // was items {}
      expect(f.log).toHaveLength(want.logLen);
      expect(f.enemyHpEnd).toBe(want.enemyHpEnd);
      expect(r.rng.seed, key).toBe(921236456); // was want.rng; 3384637939 before the T1 Health Potion roll (1.26.0)
      expect(r.character).toMatchObject({ gold: want.gold, xp: want.xp, level: want.level, hp: want.hp });
      expect(r.dungeon.byDungeon.troll_bridge).toEqual(want.troll_bridge);
      expect(r.dungeon.totals).toEqual(want.totals);
      // The harder counters never moved: it all happened on Normal.
      expect(r.dungeon.harder).toEqual(s.dungeon.harder);
    }
  });

  it('the same fight in one piece or split anywhere gives the same state', () => {
    const end = s.time.lastSimulatedAt + 30 * MIN;
    const once = simulate(s, end).state;
    for (const at of [1, 500, 1000, 3000, 4500, 8000]) {
      const two = simulate(simulate(s, s.time.lastSimulatedAt + at).state, end).state;
      expect(hashState(two), `split at ${at}`).toBe(hashState(once));
    }
  });

  it('deterministic and pure: the same document loads to the same state; the input is not changed', () => {
    const doc = JSON.parse(JSON.stringify(V21));
    expect(loadSave(doc)).toEqual(s);
    expect(doc).toEqual(V21);
    expect(hashState(loadSave(V21))).toBe(hashState(s));
  });

  it('a migrated save can use the new commands at once', () => {
    const r = applyCommand(s, cmd({ type: 'SET_DUNGEON_DIFFICULTY', tier: 1, difficulty: 'hard' }), s.time.lastSimulatedAt);
    expect(r.ok).toBe(true);
    if (r.ok) expect(selectedDifficulty(r.state, 1)).toBe('hard');
    const x = applyCommand(s, cmd({ type: 'SET_DUNGEON_DIFFICULTY', tier: 1, difficulty: 'extreme' }), s.time.lastSimulatedAt);
    expect(x.ok).toBe(false);
  });

  it('the step is registered and bumps exactly one version; a save without a fight or lastFight migrates too', () => {
    expect(MIGRATIONS[21](JSON.parse(JSON.stringify(V21))).saveVersion).toBe(22);
    const idle: any = JSON.parse(JSON.stringify(V21));
    idle.activity = null;
    idle.dungeon.lastFight = null;
    const m = loadSave(idle);
    expect(m.activity).toBeNull();
    expect(m.dungeon.lastFight).toBeNull();
    expect(m.dungeon.difficulty).toEqual({ '1': 'normal' });
    // A run still in its search gets its difficulty.
    const searching: any = JSON.parse(JSON.stringify(V21));
    searching.activity = { ...searching.activity, phase: 'search', progressMs: 4000, fight: null };
    expect(loadSave(searching).activity).toMatchObject({ kind: 'dungeon', difficulty: 'normal', phase: 'search', progressMs: 4000, fight: null });
  });
});

describe('through the client', () => {
  it('loading writes a MIGRATE anchor (save 21 -> 22, engine 1.23.0 -> current); the fight plays on; a Hard run starts; the log replays', async () => {
    const repo = new MemoryGameRepository();
    await repo.init();
    const last = { commandId: 'v21-last', type: 'SIMULATE' as const, payload: { checkpoint: true }, clientTime: V21.time.lastSimulatedAt, engineVersion: '1.23.0', stateHash: hashState(V21 as unknown as GameState) };
    await repo.commit([last], V21 as unknown as GameState, { [META_ENGINE_VERSION]: '1.23.0', device_id: 'phone' });
    const clock = new FakeClock(V21.time.lastSimulatedAt + 3 * SEC);
    const { client } = makeClient({ repo, clock, prefix: 'v22' });
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect(p).toMatchObject({ fromSave: 21, toSave: CURRENT_SAVE_VERSION, fromEngine: '1.23.0', toEngine: ENGINE_VERSION });
    expect(p.snapshot).toEqual(loadSave(V21));
    // The fight finishes as it would have, then the player picks Hard (the boss was killed on Normal) and starts a run on it.
    clock.advance(10 * SEC);
    await client.resume();
    expect(client.getState().dungeon.lastFight).toMatchObject({ dungeonId: 'troll_bridge', won: true, difficulty: 'normal' });
    const set = await client.dispatch({ type: 'SET_DUNGEON_DIFFICULTY', tier: 1, difficulty: 'hard' });
    expect(set.ok).toBe(true);
    const go = await client.dispatch({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' });
    expect(go.ok).toBe(true);
    expect(client.getState().activity).toMatchObject({ kind: 'dungeon', dungeonId: 'rat_cellar', difficulty: 'hard' });
    clock.advance(20 * MIN);
    await client.resume();
    expect(client.getState().dungeon.harder.hard.byDungeon.rat_cellar!.runs).toBeGreaterThan(0);
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: 1 });
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});
