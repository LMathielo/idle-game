// Save v11 / engine 1.10.0: the v10 → v11 migration (building levels kept, the Merchant as a building, idle builder,
// no workers, stock kept), the frozen v10 fixture written by the 1.9.0 engine, its MIGRATE anchor and log replay.
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
  loadSave,
  type MigratePayload,
  MIGRATIONS,
  newWorkersState,
  type ReplayEntry,
  replayLogReport,
} from '../src/engine';
import { HOUR, makeClient, MIN, qty } from './helpers';

const FIXTURES = join(__dirname, 'fixtures');
/** Frozen v10 save + its action log, written by the 1.9.0 engine before workers (tests/fixtures). */
const V10_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v10.json'), 'utf8'));
const V10_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v10.json'), 'utf8'));

const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);

describe('save v11 migration (v10 → v11)', () => {
  it('keeps every building and level, adds the Merchant (built, Lv1), an idle builder and no workers; pure', () => {
    const doc = {
      saveVersion: 10,
      buildings: {
        woodcutting: { state: 'built', level: 1 },
        mine_shaft: { state: 'locked', level: 0 },
        town_hall: { state: 'built', level: 1 },
        training_grounds: { state: 'locked', level: 0 },
      },
      merchant: { charges: 3, chargeProgressMs: 5, stock: [{ defId: 'iron_axe', quantity: 1, unitPrice: 600 }, null] },
      character: { gold: 9 },
    };
    const frozen = JSON.parse(JSON.stringify(doc));
    const v11 = MIGRATIONS[10](doc) as unknown as GameState;
    expect(doc).toEqual(frozen);
    expect(v11.saveVersion).toBe(11);
    expect(v11.buildings).toEqual({ ...frozen.buildings, merchant: { state: 'built', level: 1 } });
    expect(v11.construction).toBeNull();
    expect(v11.workers).toEqual(newWorkersState());
    expect(v11.merchant).toEqual(frozen.merchant); // stock kept until the next refresh
  });

  it('tolerates a bare document', () => {
    const bare = MIGRATIONS[10]({ saveVersion: 10 }) as unknown as GameState;
    expect(bare.buildings).toEqual({ merchant: { state: 'built', level: 1 } });
    expect(bare.workers.list).toEqual([]);
  });
});

describe('frozen v10 save (tests/fixtures/save-v10.json) → v11', () => {
  /** A phone that ran the 1.9.0 build: the v10 document, its log and engine_version = 1.9.0. */
  async function v10Phone(after = 3 * MIN) {
    const repo = new MemoryGameRepository();
    await repo.init();
    await repo.commit(
      V10_LOG.map(({ seq: _seq, synced: _synced, ...r }) => r),
      V10_SAVE as GameState,
      { [META_ENGINE_VERSION]: '1.9.0', device_id: 'phone' },
    );
    const clock = new FakeClock(V10_SAVE.time.lastSimulatedAt + after);
    return makeClient({ repo, clock, prefix: 'v11' });
  }

  it('is what the 1.9.0 engine wrote: hero Lv6, 141 gold, Woodcutting / Mine Shaft / Town Hall built, Stone running', () => {
    expect(V10_SAVE.saveVersion).toBe(10);
    expect(V10_SAVE).not.toHaveProperty('workers');
    expect(V10_SAVE).not.toHaveProperty('construction');
    expect(V10_SAVE.character).toMatchObject({ level: 6, gold: 141 });
    expect(V10_SAVE.buildings.town_hall).toEqual({ state: 'built', level: 1 });
    expect(V10_SAVE.activity).toMatchObject({ kind: 'mining', rockId: 'stone', progressMs: 17_000 });
    expect(V10_SAVE.merchant.stock).toHaveLength(20);
    expect(new Set(V10_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.9.0']));
  });

  it('migrates: levels, activity, items, gold and the 20-slot stock kept; Merchant building, idle builder, no workers', () => {
    const s = loadSave(V10_SAVE);
    expect(s.saveVersion).toBe(CURRENT_SAVE_VERSION);
    expect(s.buildings).toEqual({ ...V10_SAVE.buildings, merchant: { state: 'built', level: 1 } });
    expect(s.construction).toBeNull();
    expect(s.workers).toEqual(newWorkersState());
    const { buildings: _b, construction: _c, workers: _w, saveVersion: _v, ...rest } = s;
    const { buildings: _rb, saveVersion: _rv, ...rawRest } = V10_SAVE;
    expect(rest).toEqual(rawRest);
    expect(hashState(loadSave(V10_SAVE))).toBe(hashState(s));
  });

  it('loading writes a MIGRATE anchor (save 10 → 11, engine 1.9.0 → 1.10.0); hiring and workers follow; the whole log replays', async () => {
    const { repo, clock, client } = await v10Phone();
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({
      fromSave: 10,
      toSave: CURRENT_SAVE_VERSION,
      fromEngine: '1.9.0',
      toEngine: ENGINE_VERSION,
      fromHash: V10_LOG.at(-1)!.stateHash,
      snapshot: undefined,
    });
    expect(p.snapshot).toEqual(loadSave(V10_SAVE));
    // Stone kept running through the update (3 minutes since the save: 1 more swing at least).
    expect(qty(client.getState(), 'stone')).toBeGreaterThan(5);

    // The save's own gold: hire one worker (100) and put it on Oak; the Stone the hero mines stays separate.
    expect(await client.dispatch({ type: 'HIRE_WORKER', maxCost: 100 })).toMatchObject({ ok: true });
    expect(await client.dispatch({ type: 'ASSIGN_WORKER', workerId: 'w1', node: 'oak' })).toMatchObject({ ok: true });
    expect(await client.dispatch({ type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 2 })).toMatchObject({
      ok: false,
      error: { code: 'REQUIREMENTS_NOT_MET' },
    });
    clock.advance(HOUR);
    const summary = await client.resume();
    // 41 gold left after hiring: minute 1 (paid by ASSIGN_WORKER) + 40 more, then the crew pauses for gold.
    expect(summary.upkeepPaid).toBe(40);
    expect(summary.workerActions).toBe(20);
    expect(client.getState().character.gold).toBe(0);
    expect(client.getState().workers.paused).toBe(true);
    // Selling one Stone brings 1 gold: the crew resumes at once.
    expect((await client.dispatch({ type: 'SELL_ITEM', itemId: 'stone', quantity: 1 })).ok).toBe(true);
    expect(client.getState().workers.paused).toBe(false);
    // The old 20-slot stock is kept until the next refresh, which rolls 5 slots at Merchant Lv1.
    expect(client.getState().merchant.stock).toHaveLength(20);
    expect((await client.dispatch({ type: 'REFRESH_MERCHANT' })).ok).toBe(true);
    expect(client.getState().merchant.stock).toHaveLength(5);

    const rows = await repo.getAllLog();
    const report = replayLogReport(entries(rows));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: V10_LOG.length });
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
    expect(client.getState().flags.debugUsed).toBe(false);
  });
});
