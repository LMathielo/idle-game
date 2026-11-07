// Save v23 (engine 1.25.0): the combat opening. Fights now start with the hero's strike at t = 0 and the monster's at 300 ms
// (`COMBAT.heroFirstStrikeMs` / `enemyFirstStrikeMs`), stored on every fight. A fight that is IN PROGRESS when the update lands must finish
// on the OLD timing (each side's first strike one of its own intervals in), or its outcome would change after the player started it.
// Two frozen v22 saves, written by the UNTOUCHED 1.24.0 engine code (origin/feat/difficulty-tiers, PR #41):
//   - save-v22.json: a Hard Forgotten Crypt pack of 4 (3 plain, 1 Veteran) two strikes in, with a finished fight in `lastFight`;
//   - save-v22-boss.json: the Troll Chieftain three strikes in, stunned for the next three.
// tests/fixtures/save-v22-reference.json holds what the untouched engine produced from them (the end of the fight in progress); the
// migrated saves must reproduce it to the last HP, draw and log line.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { LogRow } from '../src/client/types';
import {
  COMBAT,
  CURRENT_SAVE_VERSION,
  ENGINE_VERSION,
  type GameState,
  hashState,
  loadSave,
  type MigratePayload,
  MIGRATIONS,
  replayLogReport,
  type ReplayEntry,
  simulate,
} from '../src/engine';
import { nextFightEvent } from '../src/engine/combat';
import { asV22, makeClient, MIN, SEC } from './helpers';

const read = (name: string): Record<string, any> => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const PACK = read('save-v22.json');
const BOSS = read('save-v22-boss.json');
/**
 * The frozen Hard run with Forgotten Crypt OPEN on Hard (50 Hard Wolf Den wins, the per-difficulty chain): the run repeats, so the tests that
 * look at the NEXT fight have one. The frozen document itself has no Hard Wolf Den wins: its run ends with the fight in progress (tested in
 * tests/difficulty.test.ts, "a Hard run on a stage the chain now closes").
 */
const PACK_OPEN = structuredClone(PACK);
PACK_OPEN.dungeon.harder.hard.byDungeon = { ...PACK_OPEN.dungeon.harder.hard.byDungeon, wolf_den: { runs: 50, wins: 50, losses: 0 } };
const REF = read('save-v22-reference.json');
const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);

const fightOf = (s: GameState) => (s.activity?.kind === 'dungeon' || s.activity?.kind === 'boss' ? s.activity.fight : null);

describe('the frozen v22 saves', () => {
  it('are what they claim: v22, a fight in progress with the old fight shape (no opening fields anywhere)', () => {
    expect(PACK.saveVersion).toBe(22);
    expect(PACK.activity).toMatchObject({ kind: 'dungeon', dungeonId: 'forgotten_crypt', difficulty: 'hard', phase: 'fight' });
    expect(PACK.activity.fight).toMatchObject({ enemyId: 'skeleton', elapsedMs: 2000, heroStrikes: 2 });
    expect(PACK.activity.fight.mobs).toHaveLength(4);
    expect(PACK.dungeon.lastFight).toBeTruthy();
    expect(BOSS.saveVersion).toBe(22);
    expect(BOSS.activity).toMatchObject({ kind: 'boss', bossId: 'troll_chieftain' });
    expect(BOSS.activity.fight).toMatchObject({ enemyId: 'troll_chieftain', elapsedMs: 3500, heroStrikes: 3, heroStunStrikes: 3 });
    for (const doc of [PACK, BOSS]) {
      expect(JSON.stringify(doc)).not.toContain('FirstStrikeMs');
      // The old rule is visible in the log of the finished fight: every first strike is one own interval in.
    }
    expect(PACK.dungeon.lastFight.log[0]).toMatchObject({ actor: 'hero', atMs: 1000, strike: 1 });
  });
});

describe('v22 -> v23', () => {
  const pack = loadSave(PACK);
  const boss = loadSave(BOSS);

  it('loads as the current save; the main RNG, the clock and everything else are untouched', () => {
    expect(CURRENT_SAVE_VERSION).toBe(24);
    for (const [s, doc] of [[pack, PACK], [boss, BOSS]] as const) {
      expect(s.saveVersion).toBe(24);
      expect(s.rng).toEqual(doc.rng);
      expect(s.time).toEqual(doc.time);
      // Taking the new fields off again gives the fixture byte for byte.
      expect(asV22(s)).toEqual(doc);
    }
  });

  it('the fight in progress is stamped with the OLD opening: each side first struck one of its own intervals in', () => {
    const f = fightOf(pack)!;
    expect(f.heroFirstStrikeMs).toBe(f.hero.attackIntervalMs);
    expect(f.enemyFirstStrikeMs).toBe(f.mobs[0].side.attackIntervalMs);
    expect([f.heroFirstStrikeMs, f.enemyFirstStrikeMs]).toEqual([1000, 1000]);
    const b = fightOf(boss)!;
    expect([b.heroFirstStrikeMs, b.enemyFirstStrikeMs]).toEqual([1000, 1000]);
    // Not the new defaults.
    expect(f.heroFirstStrikeMs).not.toBe(COMBAT.heroFirstStrikeMs);
    expect(f.enemyFirstStrikeMs).not.toBe(COMBAT.enemyFirstStrikeMs);
  });

  it('the last fight is stamped from its own log (the time of the first entry of each side)', () => {
    expect(pack.dungeon.lastFight).toMatchObject({ heroFirstStrikeMs: 1000, enemyFirstStrikeMs: 1000 });
    // A last fight whose sides struck later, or never, reads exactly that off the log; an empty log (a fight that ended at 0 HP) is 1000.
    const doc: any = JSON.parse(JSON.stringify(PACK));
    doc.dungeon.lastFight.log = doc.dungeon.lastFight.log.filter((e: any) => e.actor === 'hero').map((e: any) => ({ ...e, atMs: e.atMs + 500 }));
    expect(loadSave(doc).dungeon.lastFight).toMatchObject({ heroFirstStrikeMs: 1500, enemyFirstStrikeMs: 1000 });
    doc.dungeon.lastFight.log = [];
    expect(loadSave(doc).dungeon.lastFight).toMatchObject({ heroFirstStrikeMs: 1000, enemyFirstStrikeMs: 1000 });
  });

  it("a side's offset is its OWN interval: the next strike of a stamped fight is where the old rule had it", () => {
    const doc: any = JSON.parse(JSON.stringify(BOSS));
    doc.activity.fight.hero.attackIntervalMs = 1500;
    doc.activity.fight.mobs[0].side.attackIntervalMs = 800;
    const f = fightOf(loadSave(doc))!;
    expect([f.heroFirstStrikeMs, f.enemyFirstStrikeMs]).toEqual([1500, 800]);
    // Old rule: strike n at n x interval. 3 hero strikes done -> the 4th at 6000; the boss's 3 done -> 4th at 3200.
    expect(f.heroStrikes).toBe(3);
    expect(f.mobs[0].strikes).toBe(BOSS.activity.fight.mobs[0].strikes);
    const ev = nextFightEvent(f);
    if (ev.type === 'time_limit') throw new Error('unexpected');
    const heroNext = (f.heroFirstStrikeMs + f.heroStrikes * f.hero.attackIntervalMs);
    const mobNext = f.enemyFirstStrikeMs + f.mobs[0].strikes * f.mobs[0].side.attackIntervalMs;
    expect(ev.atMs).toBe(Math.min(heroNext, mobNext));
    expect(heroNext).toBe((f.heroStrikes + 1) * 1500);
    expect(mobNext).toBe((f.mobs[0].strikes + 1) * 800);
  });

  it('plays on exactly as the untouched v22 engine played it: the same fight end, the same stream, the same rewards, the same log', () => {
    // 1.26.0 (mob drops) changed the drop draws on purpose: the stage gear chance and the herb are new draws after the gold, and the
    // Chieftain's table is Troll Head + Potion Belt (no Tusk). The reference (written by the untouched 1.25.0 engine) still holds for
    // everything the fight itself decides; its `rewards` items and the RNG state after the rewards are the 1.26.0 values below.
    const NOW = {
      pack: { rewards: { gold: 428, items: { copper_helm: 1, old_bone: 2 }, gears: [{ defId: 'copper_helm', itemId: 'copper_helm#1', quality: 33, rarity: 'common' }] }, rng: 2445880944 }, // was gold 442, { old_bone: 1 }, rng want.rng (2509822141 before the T1 Health Potion roll)
      boss: { rewards: { items: { potion_belt: 1 } }, rng: 240652691 }, // was { chieftains_tusk: 1 } (the Tusk left the table)
    };
    const cases = [
      [pack, REF.pack, 60 * SEC, NOW.pack],
      [boss, REF.boss, 130 * SEC, NOW.boss],
    ] as const;
    for (const [s, ref, ms, now] of cases) {
      const r = simulate(s, s.time.lastSimulatedAt + ms).state;
      const f = r.dungeon.lastFight!;
      const want = ref.fightEnd;
      expect(f, ref.engine).toMatchObject({ won: want.won, endReason: want.endReason, durationMs: want.durationMs, heroHpEnd: want.heroHpEnd, dungeonId: want.lastDungeon, difficulty: want.difficulty });
      expect(f.rewards).toEqual({ ...want.rewards, ...now.rewards });
      expect(f.log).toHaveLength(want.logLen);
      expect(f.enemyHpEnd).toBe(want.enemyHpEnd);
      expect(f.mobs).toEqual(want.mobs);
      expect(r.rng.seed).toBe(now.rng); // was want.rng
      expect(r.character).toMatchObject({ gold: want.gold + (('gold' in now.rewards ? now.rewards.gold : want.rewards.gold) - want.rewards.gold), xp: want.xp, level: want.level, hp: want.hp });
      expect(r.dungeon.byDungeon).toEqual(want.byDungeon);
      expect(r.dungeon.bosses).toEqual(want.bosses);
      expect(r.dungeon.totals).toEqual(want.totals);
      expect(r.dungeon.harder).toEqual(want.harder);
      // The log of the finished fight still carries the old opening (stamped, so a replay shows it too).
      expect(f).toMatchObject({ heroFirstStrikeMs: 1000, enemyFirstStrikeMs: 1000 });
      expect(f.log[0].atMs).toBeGreaterThan(0);
    }
  });

  it('the NEXT fight opens the new way: the hero at 0, the monster at 300 ms', () => {
    const r = simulate(loadSave(PACK_OPEN), PACK.time.lastSimulatedAt + 30 * MIN).state;
    const f = r.dungeon.lastFight!;
    expect(f).toMatchObject({ heroFirstStrikeMs: 0, enemyFirstStrikeMs: 300 });
    expect(f.log[0]).toMatchObject({ actor: 'hero', atMs: 0, strike: 1 });
    expect(f.log.find((e) => e.actor === 'enemy')!.atMs).toBe(300);
    // And it is not the fight that was in progress.
    expect(f.log.length).not.toBe(REF.pack.fightEnd.logLen);
  });

  it('the same fight in one piece or split anywhere gives the same state (inside the old-timing fight, at its end, in the next one)', () => {
    for (const [s, span] of [[pack, 30 * MIN], [boss, 30 * MIN]] as const) {
      const end = s.time.lastSimulatedAt + span;
      const once = simulate(s, end).state;
      for (const at of [1, 300, 500, 1000, 1300, 3000, 8000, 27_000, 27_001, 39_000, 61_000, 2 * MIN]) {
        const two = simulate(simulate(s, s.time.lastSimulatedAt + at).state, end).state;
        expect(hashState(two), `split at ${at}`).toBe(hashState(once));
      }
    }
  });

  it('deterministic and pure: the same document loads to the same state; the input is not changed', () => {
    for (const doc of [PACK, BOSS]) {
      const copy = JSON.parse(JSON.stringify(doc));
      expect(loadSave(copy)).toEqual(loadSave(doc));
      expect(copy).toEqual(doc);
      expect(hashState(loadSave(doc))).toBe(hashState(loadSave(doc)));
    }
  });

  it('already-stamped fights are left alone, and a save with no fight loads untouched', () => {
    const stamped: any = JSON.parse(JSON.stringify(PACK));
    stamped.activity.fight.heroFirstStrikeMs = 0;
    stamped.activity.fight.enemyFirstStrikeMs = 300;
    const f = fightOf(loadSave(stamped))!;
    expect([f.heroFirstStrikeMs, f.enemyFirstStrikeMs]).toEqual([0, 300]);
    const idle: any = JSON.parse(JSON.stringify(PACK));
    idle.activity = null;
    idle.dungeon.lastFight = null;
    const s = loadSave(idle);
    expect(s.saveVersion).toBe(24);
    expect(s.activity).toBeNull();
    expect(s.dungeon.lastFight).toBeNull();
    expect(MIGRATIONS[22](JSON.parse(JSON.stringify(PACK))).saveVersion).toBe(23);
  });
});

describe('through the client', () => {
  it('loading writes a MIGRATE anchor (save 22 -> 23, engine 1.24.0 -> current); the old-timing fight plays on; the log replays', async () => {
    const repo = new MemoryGameRepository();
    await repo.init();
    const last = { commandId: 'v22-last', type: 'SIMULATE' as const, payload: { checkpoint: true }, clientTime: PACK.time.lastSimulatedAt, engineVersion: '1.24.0', stateHash: hashState(PACK_OPEN as unknown as GameState) };
    await repo.commit([last], PACK_OPEN as unknown as GameState, { [META_ENGINE_VERSION]: '1.24.0', device_id: 'phone' });
    const clock = new FakeClock(PACK.time.lastSimulatedAt + 3 * SEC);
    const { client } = makeClient({ repo, clock, prefix: 'v23' });
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect(p).toMatchObject({ fromSave: 22, toSave: CURRENT_SAVE_VERSION, fromEngine: '1.24.0', toEngine: ENGINE_VERSION });
    expect(p.snapshot).toEqual(loadSave(PACK_OPEN));
    // The fight in progress finishes the old way (27 s long in the reference), then the next ones open the new way.
    clock.advance(60 * SEC);
    await client.resume();
    expect(client.getState().dungeon.lastFight).toMatchObject({ won: REF.pack.fightEnd.won, durationMs: REF.pack.fightEnd.durationMs, heroFirstStrikeMs: 1000, enemyFirstStrikeMs: 1000 });
    clock.advance(20 * MIN);
    await client.resume();
    expect(client.getState().dungeon.lastFight).toMatchObject({ heroFirstStrikeMs: 0, enemyFirstStrikeMs: 300 });
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: 1 });
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});
