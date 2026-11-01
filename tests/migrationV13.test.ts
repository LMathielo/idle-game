// Save v13 / engine 1.13.0: the Crafting house. The v12 → v13 migration adds the locked building and the idle pipes
// and drops the unused smithing skill; the frozen v12 save written by the 1.12.0 engine (tests/fixtures/save-v12.json)
// migrates, anchors and replays.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { LogRow } from '../src/client/types';
import { CURRENT_SAVE_VERSION, ENGINE_VERSION, RELEASED_ENGINES, type GameState, hashState, loadSave, type MigratePayload, MIGRATIONS, newGame, replayLogReport, type ReplayEntry } from '../src/engine';
import { HOUR, makeClient, MIN, qty, SEC, T0, V13_ADDED, withoutGearRolls } from './helpers';

const FIXTURES = join(__dirname, 'fixtures');
/** Frozen v12 save + log written by the 1.12.0 engine: Woodcutting and Mine Shaft built, 925 gold, 141 Oak, 133 Stone, Stone mid-ore. */
const V12_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v12.json'), 'utf8'));
const V12_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v12.json'), 'utf8'));
const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);

describe('save v13 migration (v12 → v13)', () => {
  it('adds the locked Crafting house and 2 of 8 idle pipes, drops smithing, keeps everything else; pure', () => {
    const doc = {
      saveVersion: 12,
      buildings: { woodcutting: { state: 'built', level: 3 }, merchant: { state: 'built', level: 1 } },
      character: { level: 7, skills: { woodcutting: { level: 9, xp: 1, xpToNext: 2 }, fishing: { level: 1, xp: 0, xpToNext: 100 }, smithing: { level: 1, xp: 0, xpToNext: 100 } } },
      inventory: { capacity: 20, items: [] },
    };
    const frozen = JSON.parse(JSON.stringify(doc));
    const v13 = MIGRATIONS[12](doc) as unknown as GameState;
    expect(doc).toEqual(frozen);
    expect(v13.saveVersion).toBe(13);
    expect(v13.buildings).toEqual({ ...frozen.buildings, crafting: { state: 'locked', level: 0 } });
    expect(v13.crafting).toEqual(V13_ADDED.crafting);
    expect(v13.character.skills).toEqual({ woodcutting: frozen.character.skills.woodcutting, fishing: frozen.character.skills.fishing });
    expect(v13.inventory).toEqual(frozen.inventory);
    // A bare document still gets the new fields.
    expect(MIGRATIONS[12]({ saveVersion: 12 })).toMatchObject({ saveVersion: 13, buildings: { crafting: { state: 'locked', level: 0 } }, crafting: V13_ADDED.crafting });
  });

  it('a migrated save has exactly the crafting state of a new save', () => {
    const fresh = newGame(5, T0);
    expect(fresh.crafting).toEqual(V13_ADDED.crafting);
    expect(fresh.buildings.crafting).toEqual(V13_ADDED.craftingBuilding);
    expect(Object.keys(fresh.character.skills)).toEqual(['woodcutting', 'mining', 'fishing']);
  });
});

describe('frozen v12 save (tests/fixtures/save-v12.json), engine 1.12.0 → 1.13.0', () => {
  async function phone(after = 3 * MIN) {
    const repo = new MemoryGameRepository();
    await repo.init();
    await repo.commit(
      V12_LOG.map(({ seq: _seq, synced: _synced, ...r }) => r),
      V12_SAVE as GameState,
      { [META_ENGINE_VERSION]: '1.12.0', device_id: 'phone' },
    );
    const clock = new FakeClock(V12_SAVE.time.lastSimulatedAt + after);
    return makeClient({ repo, clock, prefix: 'v13' });
  }

  it('is what the 1.12.0 engine wrote: Woodcutting + Mine Shaft, 925 gold, 141 Oak, 133 Stone, Stone mid-ore, smithing Lv1', () => {
    expect(V12_SAVE.saveVersion).toBe(12);
    expect(V12_SAVE.character.gold).toBe(925);
    expect(V12_SAVE.character.skills.smithing).toEqual({ level: 1, xp: 0, xpToNext: 100 });
    expect(V12_SAVE.activity).toMatchObject({ kind: 'mining', rockId: 'stone', progressMs: 47_000 });
    expect(V12_SAVE).not.toHaveProperty('crafting');
    expect(new Set(V12_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.12.0']));
    expect(hashState(V12_SAVE)).toBe(V12_LOG.at(-1)!.stateHash);
  });

  it('migrates: Crafting locked, idle pipes, no smithing; everything else kept (deterministic)', () => {
    expect(loadSave(V12_SAVE).saveVersion).toBe(CURRENT_SAVE_VERSION);
    const s = withoutGearRolls(loadSave(V12_SAVE)); // the v13 → v14 gear rolls: tests/migrationV14.test.ts
    const { character, saveVersion: _v, buildings, crafting, ...rest } = s;
    const { character: rc, saveVersion: _rv, buildings: rb, ...rawRest } = V12_SAVE;
    expect(rest).toEqual(rawRest);
    expect(buildings).toEqual({ ...rb, crafting: V13_ADDED.craftingBuilding });
    expect(crafting).toEqual(V13_ADDED.crafting);
    const { smithing: _sm, ...skills } = rc.skills;
    expect(character).toEqual({ ...rc, skills });
    expect(hashState(withoutGearRolls(loadSave(V12_SAVE)))).toBe(hashState(s));
  });

  it('loading writes a MIGRATE anchor (save 12 → current, engine 1.12.0 → current); Crafting is built and crafts; the whole log replays', async () => {
    const { repo, clock, client } = await phone();
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({ fromSave: 12, toSave: CURRENT_SAVE_VERSION, fromEngine: '1.12.0', toEngine: ENGINE_VERSION, fromHash: V12_LOG.at(-1)!.stateHash, snapshot: undefined });
    expect(RELEASED_ENGINES.some((r) => r.engine === '1.13.0')).toBe(true);
    expect(p.snapshot).toEqual(loadSave(V12_SAVE));

    // Mining keeps running; the house is built for real and crafts beside it, live and offline.
    expect(client.getState().activity).toMatchObject({ kind: 'mining', rockId: 'stone' });
    expect((await client.dispatch({ type: 'BUILD', buildingId: 'crafting' })).ok).toBe(true);
    expect((await client.dispatch({ type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank', quantity: 10, mode: 'x1', maxCost: 0 })).ok).toBe(true);
    clock.advance(30 * SEC);
    await client.tick();
    expect((await client.dispatch({ type: 'START_CRAFT', pipe: 1, recipeId: 'stone_brick', quantity: 3, mode: 'x10', maxCost: 3 })).ok).toBe(true);
    clock.advance(HOUR);
    await client.resume();
    const s = client.getState();
    expect(qty(s, 'oak_plank')).toBe(10);
    expect(qty(s, 'stone_brick')).toBe(30);
    expect(s.crafting.pipes.every((x) => x === null)).toBe(true);
    expect(s.activity).toMatchObject({ kind: 'mining', rockId: 'stone' });

    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: V12_LOG.length });
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});
