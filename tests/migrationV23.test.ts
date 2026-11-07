// Save v24 (engine 1.27.0): the Potion Belt. The belt becomes an accessory whose item instance holds four slots, and potion cooldowns are
// stored by type (`potionCooldowns`). Frozen v23 save, written by the UNTOUCHED 1.26.0 engine (origin/feat/mob-drops, PR #43): a level 5
// slayer who beat the Troll Chieftain once (the Potion Belt dropped into the bag), bought 10 Health Potions, cut Oak for 70 minutes and sits
// at 40 HP. tests/fixtures/save-v23-reference.json holds what that engine produced from it (three continuations); the migrated save
// must reproduce it to the last HP, draw and item: an unworn belt changes nothing.
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
  ENGINE_VERSION,
  type GameState,
  hashState,
  loadSave,
  type MigratePayload,
  MIGRATIONS,
  RELEASED_ENGINES,
  replayLogReport,
  type ReplayEntry,
  simulate,
} from '../src/engine';
import { asV23, cmd, HOUR, makeClient, MIN, SEC } from './helpers';

const read = (name: string): Record<string, any> => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const V23 = read('save-v23.json');
const REF = read('save-v23-reference.json');
const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);
const T = V23.time.lastSimulatedAt as number;

/** The facts the generator recorded from the 1.26.0 engine. */
const facts = (st: GameState) => ({
  gold: st.character.gold,
  hp: st.character.hp,
  hpRegenProgress: st.character.hpRegenProgress,
  xp: st.character.xp,
  level: st.character.level,
  rng: st.rng.seed,
  woodcutting: st.character.skills.woodcutting,
  items: st.inventory.items.map((i) => [i.defId, i.quantity ?? 1]),
  lastFight: st.dungeon.lastFight ? { won: st.dungeon.lastFight.won, durationMs: st.dungeon.lastFight.durationMs, log: st.dungeon.lastFight.log.length, rewards: st.dungeon.lastFight.rewards } : null,
  totals: st.dungeon.totals,
});

describe('the frozen v23 save', () => {
  it('is what it claims: v23, a Potion Belt in the bag with no slot and no belt, no potion cooldowns, Oak running, 40 HP', () => {
    expect(V23.saveVersion).toBe(23);
    expect(REF.engine).toBe('1.26.0');
    const belt = V23.inventory.items.find((i: any) => i.defId === 'potion_belt');
    expect(belt).toEqual({ id: 'potion_belt', defId: 'potion_belt', name: 'Potion Belt', icon: '🎒' });
    expect(V23.potionCooldowns).toBeUndefined();
    expect(V23.activity).toMatchObject({ kind: 'woodcutting', treeId: 'oak' });
    expect(V23.character.hp).toBe(40);
    expect(V23.inventory.items.find((i: any) => i.defId === 'health_potion_t1').quantity).toBe(10);
    expect(V23.character.equipment.accessory).toBeUndefined();
  });
});

describe('v23 -> v24', () => {
  const s = loadSave(V23);

  it('loads as the current save; nothing but the new fields differs from the document', () => {
    expect(CURRENT_SAVE_VERSION).toBe(24);
    expect(s.saveVersion).toBe(24);
    expect(s.potionCooldowns).toEqual({});
    expect(s.rng).toEqual(V23.rng);
    expect(s.time).toEqual(V23.time);
    // Taking the new fields off again gives the fixture byte for byte.
    expect(asV23(s)).toEqual(V23);
  });

  it('the belt in the bag becomes an accessory with four EMPTY slots; the potions stay in the bag; the equipment gets no accessory', () => {
    const belt = s.inventory.items.find((i) => i.defId === 'potion_belt')!;
    expect(belt).toMatchObject({ id: 'potion_belt', slot: 'accessory', belt: [null, null, null, null] });
    expect(s.inventory.items.find((i) => i.defId === 'health_potion_t1')!.quantity).toBe(10);
    expect(s.character.equipment.accessory).toBeUndefined();
  });

  it('a save without a belt only gains the empty cooldown map; an existing map and belt are left alone', () => {
    const doc: any = JSON.parse(JSON.stringify(V23));
    doc.inventory.items = doc.inventory.items.filter((i: any) => i.defId !== 'potion_belt');
    const bare = loadSave(doc);
    expect(bare.potionCooldowns).toEqual({});
    expect(bare.inventory.items.some((i) => i.defId === 'potion_belt')).toBe(false);
    const again = MIGRATIONS[23]({ ...JSON.parse(JSON.stringify(V23)), potionCooldowns: { health_potion_t1: 5 } });
    expect((again as any).potionCooldowns).toEqual({ health_potion_t1: 5 });
    const done: any = { saveVersion: 23, inventory: { items: [{ id: 'potion_belt', defId: 'potion_belt', belt: [{ defId: 'health_potion_t1', count: 2, rule: 'always' }, null, null, null] }] } };
    expect((MIGRATIONS[23](done) as any).inventory.items[0].belt[0]).toEqual({ defId: 'health_potion_t1', count: 2, rule: 'always' });
  });

  it('an unworn belt changes nothing: the migrated save plays on exactly as the untouched 1.26.0 engine played it', () => {
    expect(facts(s)).toEqual({ ...REF.start, hp: 40 });
    expect(hashState(asV23(s))).toBe(REF.startHash);
    expect(facts(simulate(s, T + 3 * HOUR).state)).toEqual(REF.afterWoodcutting3h);
    const rat = applyCommand(s, cmd({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }), T);
    if (!rat.ok) throw new Error(rat.error.message);
    expect(facts(simulate(rat.state, T + 40 * MIN).state)).toEqual(REF.afterRatCellar40m);
    const wood = simulate(s, T + 3 * HOUR).state;
    const boss = applyCommand(wood, cmd({ type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10 }), T + 3 * HOUR);
    if (!boss.ok) throw new Error(boss.error.message);
    expect(facts(simulate(boss.state, T + 3 * HOUR + 2 * MIN).state)).toEqual(REF.afterBoss);
  });

  it('the migrated belt works: wear it, fill it, and it drinks the 40 HP hero up at once', () => {
    const worn = applyCommand(s, cmd({ type: 'EQUIP_ITEM', itemId: 'potion_belt' }), T);
    if (!worn.ok) throw new Error(worn.error.message);
    const put = applyCommand(worn.state, cmd({ type: 'BELT_PUT', itemId: 'health_potion_t1', slot: 0 }), T);
    if (!put.ok) throw new Error(put.error.message);
    expect(put.state.character.equipment.accessory!.belt![0]).toEqual({ defId: 'health_potion_t1', count: 10, rule: 'hp_below_50' });
    expect(put.state.inventory.items.some((i) => i.defId === 'health_potion_t1')).toBe(false);
    const r = simulate(put.state, T + 5 * SEC);
    expect(r.state.character.hp).toBe(90); // 40 / 90 <= 50% -> +50, capped at max HP
    expect(r.summary.potionsUsed).toEqual({ health_potion_t1: 1 });
  });

  it('deterministic and pure: the same document loads to the same state; the input is not changed', () => {
    const copy = JSON.parse(JSON.stringify(V23));
    expect(loadSave(copy)).toEqual(loadSave(V23));
    expect(copy).toEqual(V23);
    expect(MIGRATIONS[23](JSON.parse(JSON.stringify(V23))).saveVersion).toBe(24);
  });

  it('the release table: 1.27.0 wrote save 24', () => {
    expect(RELEASED_ENGINES.at(-1)).toEqual({ engine: '1.27.0', save: 24 });
    expect(ENGINE_VERSION).toBe('1.27.0');
  });
});

describe('through the client', () => {
  it('loading writes a MIGRATE anchor (save 23 -> 24, engine 1.26.0 -> current); the log replays', async () => {
    const repo = new MemoryGameRepository();
    await repo.init();
    const last = { commandId: 'v23-last', type: 'SIMULATE' as const, payload: { checkpoint: true }, clientTime: T, engineVersion: '1.26.0', stateHash: hashState(V23) };
    await repo.commit([last], V23 as unknown as GameState, { [META_ENGINE_VERSION]: '1.26.0', device_id: 'phone' });
    const clock = new FakeClock(T + 3 * SEC);
    const { client } = makeClient({ repo, clock, prefix: 'v24' });
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect(p).toMatchObject({ fromSave: 23, toSave: CURRENT_SAVE_VERSION, fromEngine: '1.26.0', toEngine: ENGINE_VERSION });
    expect(p.snapshot).toEqual(loadSave(V23));
    // After the anchor: wear the belt, fill it, let it drink, take the rest back; all of it replays.
    const equip = await client.dispatch({ type: 'EQUIP_ITEM', itemId: 'potion_belt' });
    expect(equip.ok).toBe(true);
    expect((await client.dispatch({ type: 'BELT_PUT', itemId: 'health_potion_t1', slot: 1 })).ok).toBe(true);
    expect((await client.dispatch({ type: 'BELT_SET_RULE', slot: 1, rule: 'always' })).ok).toBe(true);
    clock.advance(45 * SEC);
    await client.resume();
    expect((await client.dispatch({ type: 'BELT_TAKE', slot: 1 })).ok).toBe(true);
    const state = client.getState();
    expect(state.character.hp).toBe(90);
    expect(state.character.equipment.accessory!.belt![1]).toBeNull();
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: 1 });
    expect(hashState(report.state!)).toBe(hashState(state));
  });
});
