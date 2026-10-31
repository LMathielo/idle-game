// Save v12 / engine 1.12.0: the skill XP rebalance. Skill curve base 500 → 100 with its own segments (flat to Lv15,
// then 1.07 from Lv15, 1.08 from Lv40); the v11 → v12 migration keeps each skill's TOTAL XP and recomputes its level;
// the frozen v11 fixture written by the 1.11.0 engine (tests/fixtures/save-v11-skills.json) migrates, anchors and replays.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { LogRow } from '../src/client/types';
import {
  CURRENT_SAVE_VERSION,
  ENGINE_VERSION,
  type GameState,
  hashState,
  HERO_XP_CURVE,
  loadSave,
  type MigratePayload,
  MIGRATIONS,
  replayLogReport,
  type ReplayEntry,
  simulate,
  SKILL_XP_CURVE,
  TREES,
  v12SkillProgress,
  woodcuttingView,
} from '../src/engine';
import { cumulativeXp, xpToNext } from '../src/engine/progression';
import { HOUR, makeClient, MIN, T0, woodcuttingGame } from './helpers';

const FIXTURES = join(__dirname, 'fixtures');
/** Frozen v11 save + log written by the 1.11.0 engine: WC Lv4 (63 XP), Mining Lv3 (536 XP), Oak running mid-log. */
const V11_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v11-skills.json'), 'utf8'));
const V11_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v11-skills.json'), 'utf8'));
const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);

/** The v11 skill curve, written out (base 500, the hero's segments) to compute old totals independently. */
const V11_CURVE = { base: 500, power: 1.5, segments: HERO_XP_CURVE.segments };
const totalOn = (curve: typeof SKILL_XP_CURVE, s: { level: number; xp: number }) => cumulativeXp(curve, s.level) + s.xp;

/** Hours of continuous gathering from Lv1 to `level` at DEX `dex`, cutting Oak below `birchFrom`, Birch from there. */
function hoursTo(level: number, birchFrom: number, dex: number): number {
  const rate = (t: (typeof TREES)['oak']) => t.xpPerLog / ((t.baseMs - dex * 1000) / 3_600_000);
  let h = 0;
  for (let l = 1; l < level; l += 1) h += xpToNext(SKILL_XP_CURVE, l) / rate(l < birchFrom ? TREES.oak : TREES.birch);
  return h;
}

describe('skill XP curve (1.12.0)', () => {
  it('owner target: Lv1 → 15 within a day of gathering (Oak to Lv5, then Birch)', () => {
    expect(SKILL_XP_CURVE.base).toBe(100);
    expect(cumulativeXp(SKILL_XP_CURVE, 15)).toBe(31_998);
    expect(hoursTo(15, 5, 0)).toBeLessThanOrEqual(24); // 23.5 h at DEX 0
    expect(hoursTo(15, 5, 10)).toBeLessThanOrEqual(23); // 22.6 h at DEX 10 (a new hero)
    expect(hoursTo(5, 5, 10)).toBeLessThan(2.2); // early levels are quick: Lv5 in ~2 h of Oak
  });

  it('reference table (docs/ENGINE.md): Lv5/10/15/20/30 cumulative XP', () => {
    expect([5, 10, 15, 20, 30].map((l) => cumulativeXp(SKILL_XP_CURVE, l))).toEqual([1_703, 11_106, 31_998, 72_891, 317_081]);
    // Hours on the plain Oak → Birch path (Maple from Lv15 needs WS 450, i.e. a better axe or STR; it would be faster).
    expect([5, 10, 15, 20, 30].map((l) => Math.round(hoursTo(l, 5, 0) * 10) / 10)).toEqual([2.3, 8.9, 23.5, 52.1, 223.1]);
    expect([5, 10, 15, 20, 30].map((l) => Math.round(hoursTo(l, 5, 10) * 10) / 10)).toEqual([2.1, 8.4, 22.6, 50.3, 215.6]);
  });

  it('cheaper than the v11 skill curve at every level (so the migration never drops a level), and never NaN', () => {
    for (let l = 1; l <= 400; l += 1) {
      const n = xpToNext(SKILL_XP_CURVE, l);
      expect(Number.isSafeInteger(n)).toBe(true);
      expect(n).toBeLessThanOrEqual(xpToNext(V11_CURVE, l));
    }
  });
});

describe('save v12 migration (v11 → v12): skills keep their total XP', () => {
  it('recomputes level and XP-into-level from the total on the new curve', () => {
    // WC Lv8 + 7,140 XP on the v11 curve = 37,851 total → Lv16 + 43 on the v12 curve.
    expect(v12SkillProgress({ level: 8, xp: 7_140, xpToNext: 11_314 })).toEqual({ level: 16, xp: 43, xpToNext: 6_848 });
    // A fresh skill stays Lv1 with the new requirement.
    expect(v12SkillProgress({ level: 1, xp: 0, xpToNext: 500 })).toEqual({ level: 1, xp: 0, xpToNext: 100 });
    // Exactly on a v12 boundary: Lv2 with 0 XP (v11 Lv1 + 100 XP).
    expect(v12SkillProgress({ level: 1, xp: 100, xpToNext: 500 })).toEqual({ level: 2, xp: 0, xpToNext: 283 });
  });

  it('total XP is kept exactly and the level never goes down, for every level 1–60 and several XP points', () => {
    for (let level = 1; level <= 60; level += 1) {
      const need = xpToNext(V11_CURVE, level);
      for (const xp of [0, 1, Math.floor(need / 2), need - 1]) {
        const v12 = v12SkillProgress({ level, xp, xpToNext: need });
        expect(totalOn(SKILL_XP_CURVE, v12)).toBe(totalOn(V11_CURVE, { level, xp }));
        expect(v12.level).toBeGreaterThanOrEqual(level);
        expect(v12.xp).toBeGreaterThanOrEqual(0);
        expect(v12.xp).toBeLessThan(v12.xpToNext);
        expect(v12.xpToNext).toBe(xpToNext(SKILL_XP_CURVE, v12.level));
      }
    }
  });

  it('a corrupt huge level returns quickly (the total stops at MAX_SAFE_INTEGER)', () => {
    const t0 = Date.now();
    const v = v12SkillProgress({ level: 1e15, xp: 0, xpToNext: 1 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(v.xp).toBeLessThan(v.xpToNext);
  });

  it('broken or missing values count as Lv1 / 0 XP; huge totals clamp without looping forever', () => {
    expect(v12SkillProgress(undefined)).toEqual({ level: 1, xp: 0, xpToNext: 100 });
    expect(v12SkillProgress({ level: -3, xp: 'x' })).toEqual({ level: 1, xp: 0, xpToNext: 100 });
    const huge = v12SkillProgress({ level: 101, xp: 50, xpToNext: 92_076_057 });
    expect(huge.level).toBeGreaterThan(101);
    expect(huge.xp).toBeLessThan(huge.xpToNext);
  });

  it('touches only the skills (every skill key), keeps everything else; pure', () => {
    const doc = {
      saveVersion: 11,
      activity: { kind: 'woodcutting', treeId: 'oak', startedAt: 1, progressMs: 5 },
      character: {
        level: 7,
        gold: 3,
        skills: {
          woodcutting: { level: 8, xp: 7_140, xpToNext: 11_314 },
          mining: { level: 3, xp: 536, xpToNext: 2_598 },
          fishing: { level: 1, xp: 0, xpToNext: 500 },
          smithing: { level: 1, xp: 0, xpToNext: 500 },
        },
      },
      inventory: { capacity: 20, items: [] },
    };
    const frozen = JSON.parse(JSON.stringify(doc));
    const v12 = MIGRATIONS[11](doc) as unknown as GameState;
    expect(doc).toEqual(frozen);
    expect(v12.saveVersion).toBe(12);
    expect(v12.activity).toEqual(frozen.activity);
    expect(v12.inventory).toEqual(frozen.inventory);
    expect(v12.character).toMatchObject({ level: 7, gold: 3 });
    expect(v12.character.skills.woodcutting).toEqual({ level: 16, xp: 43, xpToNext: 6_848 });
    // Mining Lv3 + 536 on v11 = 500 + 1,414 + 536 = 2,450 total → Lv5 (1,703) + 747 on the v12 curve.
    expect(v12.character.skills.mining).toEqual({ level: 5, xp: 747, xpToNext: 1_118 });
    expect(v12.character.skills.fishing).toEqual({ level: 1, xp: 0, xpToNext: 100 });
    expect((MIGRATIONS[11]({ saveVersion: 11 }) as unknown as GameState).saveVersion).toBe(12);
  });

  it('after a level jump a running activity keeps going and new trees unlock (a level only ever goes up)', () => {
    // A v11 hero cutting Oak at WC Lv14 (old curve) becomes Lv23 under v12: Birch and Maple are open by level.
    const base = woodcuttingGame();
    const v11 = {
      ...JSON.parse(JSON.stringify(base)),
      saveVersion: 11,
      character: { ...base.character, skills: { ...base.character.skills, woodcutting: { level: 14, xp: 100, xpToNext: xpToNext(V11_CURVE, 14) } } },
    };
    const s = loadSave(v11);
    expect(s.character.skills.woodcutting.level).toBe(23);
    expect(s.activity).toEqual(base.activity);
    const view = woodcuttingView(s);
    expect(view.trees.find((t) => t.treeId === 'birch')!.levelOk).toBe(true);
    expect(view.trees.find((t) => t.treeId === 'maple')!.levelOk).toBe(true);
    const r = simulate(s, T0 + 30 * MIN);
    expect(r.summary.actions).toBeGreaterThan(0);
    expect(r.state.activity).toMatchObject({ kind: 'woodcutting', treeId: 'oak' });
  });
});

describe('frozen v11 save (tests/fixtures/save-v11-skills.json), engine 1.11.0 → 1.12.0', () => {
  async function phone(after = 3 * MIN) {
    const repo = new MemoryGameRepository();
    await repo.init();
    await repo.commit(
      V11_LOG.map(({ seq: _seq, synced: _synced, ...r }) => r),
      V11_SAVE as GameState,
      { [META_ENGINE_VERSION]: '1.11.0', device_id: 'phone' },
    );
    const clock = new FakeClock(V11_SAVE.time.lastSimulatedAt + after);
    return makeClient({ repo, clock, prefix: 'v12' });
  }

  it('is what the 1.11.0 engine wrote: WC Lv4 + 63, Mining Lv3 + 536, Oak running mid-log', () => {
    expect(V11_SAVE.saveVersion).toBe(11);
    expect(V11_SAVE.character.skills.woodcutting).toEqual({ level: 4, xp: 63, xpToNext: 4_000 });
    expect(V11_SAVE.character.skills.mining).toEqual({ level: 3, xp: 536, xpToNext: 2_598 });
    expect(V11_SAVE.activity).toMatchObject({ kind: 'woodcutting', treeId: 'oak', progressMs: 102_000 });
    expect(new Set(V11_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.11.0']));
    expect(hashState(V11_SAVE)).toBe(V11_LOG.at(-1)!.stateHash);
  });

  it('migrates: WC 4,575 total XP → Lv7, Mining 2,450 → Lv5; everything else kept (deterministic)', () => {
    const s = loadSave(V11_SAVE);
    expect(s.saveVersion).toBe(CURRENT_SAVE_VERSION);
    expect(s.character.skills.woodcutting).toEqual({ level: 7, xp: 284, xpToNext: 1_852 });
    expect(totalOn(SKILL_XP_CURVE, s.character.skills.woodcutting)).toBe(4_575); // 500 + 1,414 + 2,598 + 63
    expect(s.character.skills.mining).toEqual({ level: 5, xp: 747, xpToNext: 1_118 });
    expect(totalOn(SKILL_XP_CURVE, s.character.skills.mining)).toBe(2_450);
    const { character, saveVersion: _v, ...rest } = s;
    const { character: rc, saveVersion: _rv, ...rawRest } = V11_SAVE;
    expect(rest).toEqual(rawRest);
    const { skills: _s, ...otherCharacter } = character;
    const { skills: _rs, ...rawOther } = rc;
    expect(otherCharacter).toEqual(rawOther);
    expect(hashState(loadSave(V11_SAVE))).toBe(hashState(s));
  });

  it('loading writes a MIGRATE anchor (save 11 → 12, engine 1.11.0 → 1.12.0); Oak keeps running; the whole log replays', async () => {
    const { repo, clock, client } = await phone();
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({
      fromSave: 11,
      toSave: 12,
      fromEngine: '1.11.0',
      toEngine: ENGINE_VERSION,
      fromHash: V11_LOG.at(-1)!.stateHash,
      snapshot: undefined,
    });
    expect(ENGINE_VERSION).toBe('1.12.0');
    expect(p.snapshot).toEqual(loadSave(V11_SAVE));

    const logsBefore = client.getState().stats.totalActions;
    clock.advance(HOUR);
    await client.resume();
    expect(client.getState().activity).toMatchObject({ kind: 'woodcutting', treeId: 'oak' });
    expect(client.getState().stats.totalActions).toBeGreaterThan(logsBefore + 30);
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' })).ok).toBe(true);

    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: V11_LOG.length });
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});
