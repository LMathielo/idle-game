// Save v14 / engine 1.14.0: gear quality and rarity. The v13 → v14 migration gives every gear instance and every gear
// listing the default roll (25%, common), which keeps every stat and price; the frozen v13 save written by the 1.13.0
// engine (tests/fixtures/save-v13.json) migrates, anchors and replays.
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
  getDerivedStats,
  hashState,
  loadSave,
  type MigratePayload,
  migrateDoc,
  MIGRATIONS,
  miningStrength,
  newGame,
  replayLogReport,
  type ReplayEntry,
  sellPriceOfItem,
  woodcuttingStrength,
} from '../src/engine';
import { HOUR, makeClient, MIN, qty, SEC, T0, withoutGearRolls } from './helpers';

const FIXTURES = join(__dirname, 'fixtures');
/**
 * Frozen v13 save + log written by the 1.13.0 engine: Crafting built, Iron Helm equipped, Iron Sword in the bag, Iron
 * Axe and Iron Pickaxe in the stock, an Oak Plank job 8/20 mid-craft, Oak running, 2,125 gold. 12 rows.
 */
const V13_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v13.json'), 'utf8'));
const V13_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v13.json'), 'utf8'));
const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);
const ROLL = { quality: 25, rarity: 'common' };

describe('save v14 migration (v13 → v14)', () => {
  it('adds 25% / common to every gear instance and gear listing, nothing else; pure', () => {
    const doc = {
      saveVersion: 13,
      character: { equipment: { weapon: { id: 'start-rusty_gladius', defId: 'rusty_gladius', name: 'Rusty Gladius', icon: '🗡️', slot: 'weapon' } } },
      inventory: {
        capacity: 20,
        items: [
          { id: 'oak_logs', defId: 'oak_logs', name: 'Oak Logs', icon: '🪵', stackable: true, quantity: 5 },
          { id: 'steel_axe#4', defId: 'steel_axe', name: 'Steel Axe', icon: '🪓', slot: 'axe' },
        ],
      },
      merchant: { charges: 3, chargeProgressMs: 0, stock: [{ defId: 'health_potion_t1', quantity: 10, unitPrice: 12 }, { defId: 'iron_boots', quantity: 1, unitPrice: 250 }, null] },
    };
    const frozen = JSON.parse(JSON.stringify(doc));
    const v14 = MIGRATIONS[13](doc) as unknown as GameState;
    expect(doc).toEqual(frozen);
    expect(v14.saveVersion).toBe(14);
    expect(v14.character.equipment.weapon).toEqual({ ...frozen.character.equipment.weapon, ...ROLL });
    expect(v14.inventory.items).toEqual([frozen.inventory.items[0], { ...frozen.inventory.items[1], ...ROLL }]);
    expect(v14.merchant.stock).toEqual([frozen.merchant.stock[0], { ...frozen.merchant.stock[1], ...ROLL }, null]); // price kept
    expect(MIGRATIONS[13]({ saveVersion: 13 })).toMatchObject({ saveVersion: 14 });
  });

  it('a new save: starting gear and the starter stock are 25% / common', () => {
    const s = newGame(5, T0);
    for (const item of Object.values(s.character.equipment)) expect(item).toMatchObject(ROLL);
    for (const l of s.merchant.stock.slice(1)) expect(l).toMatchObject(ROLL);
  });
});

describe('frozen v13 save (tests/fixtures/save-v13.json), engine 1.13.0 → 1.14.0', () => {
  async function phone(after = 3 * MIN) {
    const repo = new MemoryGameRepository();
    await repo.init();
    await repo.commit(
      V13_LOG.map(({ seq: _seq, synced: _synced, ...r }) => r),
      V13_SAVE as GameState,
      { [META_ENGINE_VERSION]: '1.13.0', device_id: 'phone' },
    );
    const clock = new FakeClock(V13_SAVE.time.lastSimulatedAt + after);
    return makeClient({ repo, clock, prefix: 'v14' });
  }

  it('is what the 1.13.0 engine wrote: Iron Helm on, Iron Sword in the bag, iron tools in stock, an Oak Plank job, Oak running', () => {
    expect(V13_SAVE.saveVersion).toBe(13);
    expect(V13_SAVE.character.gold).toBe(2125);
    expect(V13_SAVE.character.equipment.helmet).toMatchObject({ defId: 'iron_helm' });
    expect(V13_SAVE.inventory.items.map((i: { id: string }) => i.id)).toContain('iron_sword#1');
    expect(V13_SAVE.merchant.stock.slice(1, 3).map((l: { defId: string }) => l.defId)).toEqual(['iron_axe', 'iron_pickaxe']);
    expect(V13_SAVE.crafting.pipes[0]).toMatchObject({ recipeId: 'oak_plank', quantity: 20, done: 8, status: 'running' });
    expect(new Set(V13_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.13.0']));
    expect(hashState(V13_SAVE)).toBe(V13_LOG.at(-1)!.stateHash);
  });

  it('migrates: every gear instance and listing 25% / common; every stat and price exactly as before; the rest kept', () => {
    const s = loadSave(V13_SAVE);
    expect(s.saveVersion).toBe(CURRENT_SAVE_VERSION);
    expect(withoutGearRolls(migrateDoc(V13_SAVE, MIGRATIONS, 14))).toEqual(V13_SAVE); // the v14 step alone (v15: tests/migrationV15.test.ts)
    for (const item of Object.values(s.character.equipment)) expect(item).toMatchObject(ROLL);
    for (const item of s.inventory.items) if (item.slot) expect(item).toMatchObject(ROLL);
    expect(s.merchant.stock[1]).toEqual({ defId: 'iron_axe', quantity: 1, unitPrice: 600, ...ROLL });
    // The numbers the player sees: 1.13.0 had Iron Helm 4 armor, Rusty Gladius 2–4, Wooden Axe +1 WS, Wooden Pickaxe +1 MS.
    // (Same attributes on both sides: the v16 step turns the stored ones into extra normal points.)
    const raw = { ...(V13_SAVE as GameState), character: { ...(V13_SAVE as GameState).character, attributes: s.character.attributes } };
    expect(getDerivedStats(s)).toEqual(getDerivedStats(raw)); // a v13 instance (no quality) reads as 25%
    expect(getDerivedStats(s).defense.breakdown.find((p) => p.source === 'armor' && p.defId === 'iron_helm')).toMatchObject({ value: 4 });
    expect(getDerivedStats(s).damage.breakdown[0]).toMatchObject({ min: 2, max: 4 });
    expect([woodcuttingStrength(s).value, miningStrength(s).value]).toEqual([woodcuttingStrength(raw).value, miningStrength(raw).value]);
    const sword = s.inventory.items.find((i) => i.defId === 'iron_sword')!;
    expect(sellPriceOfItem(s, sword)).toBe(150);
    expect(hashState(loadSave(V13_SAVE))).toBe(hashState(s)); // deterministic
  });

  it('loading writes a MIGRATE anchor (save 13 → current, engine 1.13.0 → current); gear crafts and the whole log replays', async () => {
    const { repo, clock, client } = await phone();
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({ fromSave: 13, toSave: CURRENT_SAVE_VERSION, fromEngine: '1.13.0', toEngine: ENGINE_VERSION, fromHash: V13_LOG.at(-1)!.stateHash, snapshot: undefined });
    expect(p.snapshot).toEqual(loadSave(V13_SAVE));

    // 1.15.0: the Oak Plank job became continuous (its 11 unstarted crafts' logs went back) and the hero's Oak feeds it:
    // past the old 20 in those 3 minutes; Stop it. Make Stone Bricks, then a Stone Sword with 20 stamina, through a
    // simulate boundary and an offline stretch; Done reveals it.
    let s = client.getState();
    expect(qty(s, 'oak_plank')).toBeGreaterThan(20);
    expect((await client.dispatch({ type: 'STOP_CRAFT', pipe: 0, jobId: s.crafting.pipes[0]!.id })).ok).toBe(true);
    expect((await client.dispatch({ type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' })).ok).toBe(true);
    clock.advance(HOUR);
    await client.resume();
    expect((await client.dispatch({ type: 'START_CRAFT', pipe: 1, recipeId: 'stone_brick' })).ok).toBe(true);
    clock.advance(MIN);
    await client.tick();
    expect((await client.dispatch({ type: 'START_CRAFT', pipe: 0, recipeId: 'stone_sword', maxCost: 20, stamina: 20 })).ok).toBe(true);
    clock.advance(2 * MIN + 7 * SEC);
    await client.tick();
    clock.advance(HOUR);
    const away = await client.resume();
    expect(away.craftsReady).toEqual({ stone_sword: 1 });
    s = client.getState();
    const job = s.crafting.pipes[0]!;
    expect(job.status).toBe('ready');
    expect(job.gear!.quality).toBeGreaterThanOrEqual(20);
    const done = await client.dispatch({ type: 'COLLECT_CRAFT', pipe: 0, jobId: job.id });
    expect(done.ok).toBe(true);
    const sword = client.getState().inventory.items.find((i) => i.defId === 'stone_sword')!;
    expect(sword).toMatchObject({ quality: job.gear!.quality, rarity: job.gear!.rarity });

    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: V13_LOG.length });
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});
