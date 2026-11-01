// Save v15 / engine 1.15.0: continuous material pipes. The v14 → v15 migration makes every material job continuous:
// the craft in progress keeps its inputs and progress (×10 if the job was x10), the inputs of every craft not yet
// started and their up-front ×10 stamina (capped) go back, and a refund that does not fit stays on the job as prepaid
// crafts. The frozen v14 save written by the 1.14.0 engine (tests/fixtures/save-v14.json) migrates, anchors and replays.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { LogRow } from '../src/client/types';
import {
  applyCommand,
  craftJobView,
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
import { cmd, HOUR, makeClient, MIN, qty, SEC } from './helpers';

const FIXTURES = join(__dirname, 'fixtures');
/**
 * Frozen v14 save + log written by the 1.14.0 engine: Woodcutting, Mine Shaft and Crafting built (debug), 2 h of Oak, an
 * Oak Plank job of 20 (x1) in pipe 1 and one of 3 in x10 mode in pipe 2, both 1 craft done and 2,416 ms into the
 * second; 41 Oak Logs, 11 Oak Planks, 97 stamina; Oak running. 10 rows.
 */
const V14_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v14.json'), 'utf8'));
const V14_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v14.json'), 'utf8'));
const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);

const job = (over: Record<string, unknown>) => ({ id: 1, recipeId: 'oak_plank', mode: 'x1', quantity: 10, done: 2, craftMs: 4584, progressMs: 1000, staminaPerCraft: 0, status: 'running', startedAt: 5, ...over });
const stack = (defId: string, quantity: number) => ({ id: defId, defId, name: defId, icon: '?', stackable: true, quantity });
const junk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `helm#${i}`, defId: 'iron_helm', name: 'Iron Helm', icon: '⛑️', slot: 'helmet', quality: 25, rarity: 'common' }));
const doc = (pipes: unknown[], items: unknown[], stamina = { current: 50, max: 100, progressMs: 1234 }, capacity = 20) => ({
  saveVersion: 14,
  stamina,
  inventory: { capacity, items },
  crafting: { pipesUnlocked: 2, pipes: [...pipes, ...Array(8 - pipes.length).fill(null)], remainders: {}, nextJobSerial: 9 },
});

describe('save v15 migration (v14 → v15)', () => {
  it('the craft in progress keeps its inputs and progress; the unstarted crafts’ inputs go back to the stack; pure', () => {
    const d = doc([job({}), null], [stack('oak_logs', 3)]);
    const frozen = JSON.parse(JSON.stringify(d));
    const v15 = MIGRATIONS[14](d) as unknown as GameState;
    expect(d).toEqual(frozen);
    expect(v15.saveVersion).toBe(15);
    // 10 crafts, 2 done, the 3rd in progress: 7 not started → 14 logs back.
    expect(v15.crafting.pipes[0]).toEqual({ id: 1, recipeId: 'oak_plank', done: 2, craftMs: 4584, progressMs: 1000, x10: false, status: 'running', startedAt: 5 });
    expect(v15.inventory.items).toEqual([stack('oak_logs', 17)]);
    expect(v15.stamina).toEqual(frozen.stamina); // x1: no stamina was paid
    expect(v15.crafting.nextJobSerial).toBe(9);
  });

  it('x10: the craft in progress stays ×10; 10× inputs per unstarted craft and their stamina come back, capped at max', () => {
    const d = doc([job({ recipeId: 'stone_brick', mode: 'x10', quantity: 5, done: 1, staminaPerCraft: 2 })], [stack('stone', 0)], { current: 97, max: 100, progressMs: 4000 });
    const v15 = MIGRATIONS[14](d) as unknown as GameState;
    expect(v15.crafting.pipes[0]).toMatchObject({ recipeId: 'stone_brick', x10: true, done: 1, progressMs: 1000 });
    expect(v15.inventory.items).toEqual([stack('stone', 3 * 20)]); // crafts 3–5: 3 × 20 Stone
    expect(v15.stamina).toEqual({ current: 100, max: 100, progressMs: 0 }); // 97 + 6 → capped at 100
  });

  it('no stack: a free slot takes the refund (a frozen stack); none free: the crafts stay prepaid on the job (nothing lost)', () => {
    const fits = MIGRATIONS[14](doc([job({ recipeId: 'iron_ingot', quantity: 4, done: 0 })], [])) as unknown as GameState;
    expect(fits.inventory.items).toEqual([{ id: 'iron_ore', defId: 'iron_ore', name: 'Iron Ore', icon: '⚫', stackable: true, quantity: 24 }]);
    expect(fits.crafting.pipes[0]!.prepaid).toBeUndefined();
    const full = MIGRATIONS[14](doc([job({ quantity: 4, done: 0 }), job({ id: 2, recipeId: 'gold_ingot', mode: 'x10', quantity: 3, done: 0, staminaPerCraft: 12 })], junk(20))) as unknown as GameState;
    expect(full.inventory.items).toEqual(junk(20));
    expect(full.crafting.pipes[0]).toMatchObject({ prepaid: 3, x10: false });
    expect(full.crafting.pipes[1]).toMatchObject({ prepaid: 20, x10: true }); // 2 unstarted ×10 crafts = 20 x1 crafts
    expect(full.stamina.current).toBe(74); // 50 + 2 × 12: stamina always fits
    // Pipe order: the first refund takes the last free slot, the second is prepaid.
    const one = MIGRATIONS[14](doc([job({ quantity: 2, done: 0 }), job({ id: 2, recipeId: 'stone_brick', quantity: 2, done: 0 })], junk(19))) as unknown as GameState;
    expect(one.inventory.items.at(-1)).toMatchObject({ defId: 'oak_logs', quantity: 2 });
    expect([one.crafting.pipes[0]!.prepaid, one.crafting.pipes[1]!.prepaid]).toEqual([undefined, 1]);
  });

  it('gear, held and ready jobs are kept (only the shape changes); the last craft of a job just keeps going', () => {
    const gear = job({ id: 3, recipeId: 'iron_sword', quantity: 1, done: 0, status: 'ready', progressMs: 4584, gear: { staminaInvested: 5, quality: 50, rarity: 'rare' } });
    const held = job({ id: 4, quantity: 5, done: 2, status: 'held', progressMs: 4584 });
    const last = job({ id: 5, quantity: 3, done: 2 });
    const v15 = MIGRATIONS[14](doc([gear, held, last], [stack('oak_logs', 1)])) as unknown as GameState;
    expect(v15.crafting.pipes[0]).toEqual({ id: 3, recipeId: 'iron_sword', done: 0, craftMs: 4584, progressMs: 4584, x10: false, status: 'ready', startedAt: 5, gear: { staminaInvested: 5, quality: 50, rarity: 'rare' } });
    expect(v15.crafting.pipes[1]).toMatchObject({ status: 'held', done: 2, progressMs: 4584, x10: false });
    expect(v15.crafting.pipes[2]).toEqual({ id: 5, recipeId: 'oak_plank', done: 2, craftMs: 4584, progressMs: 1000, x10: false, status: 'running', startedAt: 5 });
    expect(v15.inventory.items).toEqual([stack('oak_logs', 1 + 4)]); // the held job's crafts 4–5
    expect(MIGRATIONS[14]({ saveVersion: 14 })).toEqual({ saveVersion: 15 });
  });

  it('prepaid crafts start before any new inputs are taken, and Stop refunds them', () => {
    const v15 = loadSave({ ...JSON.parse(JSON.stringify(V14_SAVE)), crafting: { ...V14_SAVE.crafting, pipes: [job({ quantity: 4, done: 0, startedAt: V14_SAVE.time.lastSimulatedAt }), null, null, null, null, null, null, null] }, inventory: { capacity: 3, items: junk(3) } });
    expect(v15.crafting.pipes[0]).toMatchObject({ prepaid: 3 });
    const t0 = v15.time.lastSimulatedAt;
    const withLogs = { ...v15, activity: null };
    let s = simulate(withLogs, t0 + HOUR).state; // the current craft finishes; its planks need a slot: held
    expect(s.crafting.pipes[0]).toMatchObject({ status: 'held', prepaid: 3 });
    // Room for the planks (a command settles the pipes): prepaid crafts run with no logs at all, then the pipe waits.
    s = { ...s, inventory: { ...s.inventory, capacity: 4 } };
    const r = applyCommand(s, cmd({ type: 'DEBUG_ADD_GOLD', amount: 1 }), t0 + HOUR);
    if (!r.ok) throw new Error(r.error.message);
    s = simulate(r.state, t0 + 2 * HOUR).state;
    expect(qty(s, 'oak_plank')).toBe(4);
    expect(s.crafting.pipes[0]).toMatchObject({ status: 'waiting', done: 4 });
    expect(s.crafting.pipes[0]!.prepaid).toBeUndefined();
    // Stop on a job with prepaid crafts gives their logs back (here: a slot is free).
    const stopped = applyCommand({ ...v15, inventory: { ...v15.inventory, capacity: 4 } }, cmd({ type: 'STOP_CRAFT', pipe: 0, jobId: 1 }), t0);
    expect(stopped.ok && qty(stopped.state, 'oak_logs')).toBe(2 + 6);
    expect(craftJobView(v15, 0)!.prepaid).toBe(3);
  });
});

describe('frozen v14 save (tests/fixtures/save-v14.json), engine 1.14.0 → 1.15.0', () => {
  async function phone(after = 3 * MIN) {
    const repo = new MemoryGameRepository();
    await repo.init();
    await repo.commit(V14_LOG.map(({ seq: _seq, synced: _synced, ...r }) => r), V14_SAVE as GameState, { [META_ENGINE_VERSION]: '1.14.0', device_id: 'phone' });
    const clock = new FakeClock(V14_SAVE.time.lastSimulatedAt + after);
    return makeClient({ repo, clock, prefix: 'v15' });
  }

  it('is what the 1.14.0 engine wrote: two running Oak Plank jobs (x1 1/20, x10 1/3), Oak running', () => {
    expect(V14_SAVE.saveVersion).toBe(14);
    expect(V14_SAVE.crafting.pipes.slice(0, 2)).toMatchObject([
      { id: 1, recipeId: 'oak_plank', mode: 'x1', quantity: 20, done: 1, progressMs: 2416, status: 'running' },
      { id: 2, recipeId: 'oak_plank', mode: 'x10', quantity: 3, done: 1, progressMs: 2416, staminaPerCraft: 1, status: 'running' },
    ]);
    expect([qty(V14_SAVE, 'oak_logs'), qty(V14_SAVE, 'oak_plank'), V14_SAVE.stamina.current]).toEqual([41, 11, 97]);
    expect(V14_SAVE.activity).toMatchObject({ kind: 'woodcutting', treeId: 'oak' });
    expect(new Set(V14_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.14.0']));
    expect(hashState(V14_SAVE)).toBe(V14_LOG.at(-1)!.stateHash);
  });

  it('migrates: crafts in progress kept (pipe 2 still ×10), 18 + 1 unstarted crafts’ logs (36 + 20) and 1 stamina back', () => {
    const s = loadSave(V14_SAVE);
    expect(s.saveVersion).toBe(CURRENT_SAVE_VERSION);
    expect(s.crafting.pipes.slice(0, 2)).toEqual([
      { id: 1, recipeId: 'oak_plank', done: 1, craftMs: 4584, progressMs: 2416, x10: false, status: 'running', startedAt: V14_SAVE.crafting.pipes[0].startedAt },
      { id: 2, recipeId: 'oak_plank', done: 1, craftMs: 4584, progressMs: 2416, x10: true, status: 'running', startedAt: V14_SAVE.crafting.pipes[1].startedAt },
    ]);
    expect([qty(s, 'oak_logs'), qty(s, 'oak_plank'), s.stamina]).toEqual([41 + 36 + 20, 11, { current: 98, max: 100, progressMs: 7000 }]);
    const { crafting: _c, inventory: _i, stamina: _s, saveVersion: _v, ...rest } = s;
    const { crafting: _c2, inventory: _i2, stamina: _s2, saveVersion: _v2, ...rest14 } = V14_SAVE;
    expect(rest).toEqual(rest14); // nothing else moves
    expect(hashState(loadSave(V14_SAVE))).toBe(hashState(s));
  });

  it('loading writes a MIGRATE anchor (save 14 → 15, engine 1.14.0 → 1.15.0); the pipes run on, a ×10 tap and a Stop; the whole log replays', async () => {
    const { repo, clock, client } = await phone();
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({ fromSave: 14, toSave: 15, fromEngine: '1.14.0', toEngine: ENGINE_VERSION, fromHash: V14_LOG.at(-1)!.stateHash, snapshot: undefined });
    expect(ENGINE_VERSION).toBe('1.15.0');
    expect(p.snapshot).toEqual(loadSave(V14_SAVE));

    // 3 min later both pipes kept crafting from the logs (and the hero's Oak); pipe 2's ×10 craft made 10.
    let s = client.getState();
    expect(qty(s, 'oak_plank')).toBeGreaterThan(11 + 10 + 2);
    expect(s.crafting.pipes[0]!.done + s.crafting.pipes[1]!.done).toBeGreaterThan(2);
    const v = craftJobView(s, 0)!;
    if (v.status === 'running') {
      expect((await client.dispatch({ type: 'X10_CRAFT', pipe: 0, jobId: v.id, craft: v.craftNumber, maxCost: v.x10Tap!.stamina })).ok).toBe(v.x10Tap!.blocked === null);
    }
    expect((await client.dispatch({ type: 'STOP_CRAFT', pipe: 1, jobId: 2 })).ok).toBe(true);
    clock.advance(30 * SEC);
    await client.tick();
    clock.advance(HOUR);
    await client.resume();
    s = client.getState();
    expect(s.crafting.pipes[1]).toBeNull();
    expect(s.crafting.pipes[0]).toMatchObject({ id: 1 });

    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: V14_LOG.length });
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});
