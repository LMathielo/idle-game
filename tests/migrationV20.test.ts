// Save v21 (engine 1.22.0): gear affixes. A frozen v20 save (written by the untouched 1.20.0 engine code on `origin/feat/equipment-tabs`,
// then given rare / epic gear in every place that holds a gear roll) must load into v21 with each rare / epic piece's affixes rolled
// deterministically from a salted stream of the save's seed, the main RNG untouched, and nothing else changed.
//
// tests/fixtures/save-v20.json: hero Lv1, 4 rare/epic pieces equipped plus an uncommon axe and common boots, 6 gear pieces in the bag
// (rare, epic x2, uncommon, common, rare), 3 gear listings in the Merchant stock (rare, common, epic), a running rare Stone Pickaxe
// job and a ready epic Stone Helm job.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { LogRow } from '../src/client/types';
import {
  attributeViews,
  CURRENT_SAVE_VERSION,
  effectiveAttributes,
  ENGINE_VERSION,
  EQUIPMENT_SLOTS,
  type GameState,
  gearPerkTotals,
  getDerivedStats,
  getItemDef,
  hashState,
  loadSave,
  type MigratePayload,
  MIGRATIONS,
  replayLogReport,
  type ReplayEntry,
  simulate,
} from '../src/engine';
import { rollAffixes } from '../src/engine/gear';
import type { GearAffixes, Item } from '../src/engine/types';
import { HOUR, makeClient, MIN, T0, withoutAffixes } from './helpers';

const V20: Record<string, any> = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'save-v20.json'), 'utf8'));
const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);

/** The documented order and stream of the migration, replayed with the runtime roller: the picks every piece must have. */
function expectedPicks(doc: Record<string, any>): Map<string, GearAffixes | undefined> {
  let stream = { seed: ((doc.rng.seed as number) ^ 0x2f6c1d4b) >>> 0 };
  const out = new Map<string, GearAffixes | undefined>();
  const take = (key: string, x: { rarity?: string; slot?: string; defId?: string; recipeId?: string } | undefined, slotOverride?: string) => {
    if (!x || x.rarity === undefined || (x.defId !== undefined && !getItemDef(x.defId)?.slot)) return; // gear only
    const slot = (slotOverride ?? x.slot ?? getItemDef(x.defId ?? x.recipeId ?? '')?.slot) as never;
    const r = rollAffixes(stream, slot, x.rarity as never);
    stream = r.rng;
    out.set(key, r.value);
  };
  for (const slot of EQUIPMENT_SLOTS) take(`equipment.${slot}`, doc.character.equipment[slot]);
  doc.inventory.items.forEach((it: any, i: number) => take(`inventory.${i}`, it));
  doc.merchant.stock.forEach((l: any, i: number) => take(`stock.${i}`, l));
  doc.crafting.pipes.forEach((j: any, i: number) => j?.gear && take(`pipe.${i}`, j.gear, getItemDef(j.recipeId)?.slot));
  return out;
}

describe('the frozen v20 save', () => {
  it('is what it claims: v20, rare / epic gear everywhere, no affixes anywhere', () => {
    expect(V20.saveVersion).toBe(20);
    const rarities = (list: any[]) => list.filter((x) => x?.rarity).map((x) => x.rarity);
    expect(rarities(Object.values(V20.character.equipment))).toEqual(expect.arrayContaining(['rare', 'epic', 'uncommon']));
    expect(rarities(V20.inventory.items)).toEqual(expect.arrayContaining(['rare', 'epic', 'uncommon', 'common']));
    expect(rarities(V20.merchant.stock)).toEqual(expect.arrayContaining(['rare', 'epic', 'common']));
    expect(V20.crafting.pipes.filter(Boolean).map((j: any) => [j.gear.rarity, j.status])).toEqual([['rare', 'running'], ['epic', 'ready']]);
    expect(JSON.stringify(V20)).not.toContain('affixes');
  });
});

describe('v20 → v21', () => {
  const s = loadSave(V20);

  it('loads as the current save; the main RNG, the clock and everything else are untouched', () => {
    expect(CURRENT_SAVE_VERSION).toBe(21);
    expect(s.saveVersion).toBe(21);
    expect(s.rng).toEqual(V20.rng);
    expect(s.time).toEqual(V20.time);
    // Nothing lost or changed but the affixes: with them stripped and the version put back, the document is the fixture byte for byte.
    expect(withoutAffixes({ ...s, saveVersion: 20 })).toEqual(V20);
  });

  it('every rare / epic piece got affixes, in all four places; common and uncommon got none', () => {
    const check = (where: string, x: any) => {
      if (x.rarity === 'rare') {
        expect(x.affixes.attributes, where).toHaveLength(1);
        expect(x.affixes.perk, where).toBeUndefined();
      } else if (x.rarity === 'epic') {
        expect(x.affixes.attributes, where).toHaveLength(2);
        expect(new Set(x.affixes.attributes).size, where).toBe(2);
        expect(x.affixes.perk, where).toBeDefined();
      } else {
        expect(x.affixes, where).toBeUndefined();
      }
    };
    for (const slot of EQUIPMENT_SLOTS) if (s.character.equipment[slot]) check(`equipment.${slot}`, s.character.equipment[slot]);
    s.inventory.items.forEach((it, i) => it.slot && check(`inventory.${i} ${it.defId}`, it));
    s.merchant.stock.forEach((l, i) => l?.quality !== undefined && check(`stock.${i}`, l));
    s.crafting.pipes.forEach((j, i) => j?.gear && check(`pipe.${i}`, j.gear));
    const all: { rarity?: string }[] = [
      ...Object.values(s.character.equipment),
      ...s.inventory.items.filter((i) => i.slot),
      ...s.merchant.stock.filter((l) => l?.quality !== undefined),
      ...s.crafting.pipes.filter((j) => j?.gear).map((j) => j!.gear!),
    ] as never;
    const withAffixes = all.filter((x) => (x as { affixes?: unknown }).affixes !== undefined).length;
    expect(withAffixes).toBe(all.filter((x) => x.rarity === 'rare' || x.rarity === 'epic').length);
    expect(withAffixes).toBe(13);
  });

  it('tools get their fixed perk: the epic Steel Pickaxe mining strength, the epic Stone Axe woodcutting strength', () => {
    expect(s.character.equipment.pickaxe).toMatchObject({ defId: 'steel_pickaxe', rarity: 'epic', affixes: { perk: 'mining_strength' } });
    expect(s.inventory.items.find((i) => i.defId === 'stone_axe')?.affixes?.perk).toBe('woodcutting_strength');
    // the running job is a RARE pickaxe: one attribute and no perk
    expect(s.crafting.pipes[0]!.gear).toMatchObject({ rarity: 'rare', quality: 64 });
    expect(s.crafting.pipes[0]!.gear!.affixes!.perk).toBeUndefined();
    // the ready epic Stone Helm job: a combat perk
    expect(['max_damage', 'max_armor', 'hp_regen', 'mana_regen']).toContain(s.crafting.pipes[1]!.gear!.affixes!.perk);
  });

  it('the picks are the documented stream and order (equipment slots, bag, stock, jobs), so the runtime roller and the migration agree', () => {
    const want = expectedPicks(V20);
    const got = new Map<string, GearAffixes | undefined>();
    for (const slot of EQUIPMENT_SLOTS) if (s.character.equipment[slot]) got.set(`equipment.${slot}`, s.character.equipment[slot]!.affixes);
    s.inventory.items.forEach((it: Item, i) => it.slot && got.set(`inventory.${i}`, it.affixes));
    s.merchant.stock.forEach((l, i) => l && l.quality !== undefined && got.set(`stock.${i}`, l.affixes));
    s.crafting.pipes.forEach((j, i) => j?.gear && got.set(`pipe.${i}`, j.gear.affixes));
    expect(got.size).toBe(want.size);
    for (const [key, affixes] of want) expect(got.get(key), key).toEqual(affixes);
  });

  it('deterministic: the same save loads to the same affixes every time; another seed rolls other picks', () => {
    expect(hashState(loadSave(V20))).toBe(hashState(s));
    expect(loadSave(JSON.parse(JSON.stringify(V20)))).toEqual(s);
    const other = { ...V20, rng: { seed: 12345 } };
    expect(loadSave(other)).not.toEqual({ ...s, rng: other.rng });
  });

  it('is pure: the document passed in is not changed, and a piece that already has affixes keeps them', () => {
    const doc = JSON.parse(JSON.stringify(V20));
    loadSave(doc);
    expect(doc).toEqual(V20);
    const kept = JSON.parse(JSON.stringify(V20));
    kept.character.equipment.weapon.affixes = { attributes: ['dexterity'] };
    expect(loadSave(kept).character.equipment.weapon!.affixes).toEqual({ attributes: ['dexterity'] });
  });

  it('the migrated gear counts: stronger main stats, plain attribute points from the equipment, perks as final multipliers', () => {
    const d = getDerivedStats(s);
    const views = attributeViews(s);
    const gearPoints = views.reduce((n, v) => n + v.gear, 0);
    expect(gearPoints).toBeGreaterThan(0);
    for (const v of views) {
      expect(v.total).toBe(effectiveAttributes(s)[v.attribute]);
      expect(v.normal).toBe(v.spent + v.extra + v.gear);
      expect(v.core).toBe(0);
    }
    expect(s.character.attributes).toEqual({ strength: 0, dexterity: 0, endurance: 0, intelligence: 0 }); // never written to the save
    expect(d.maxHp.value).toBe(50 + 5 * effectiveAttributes(s).endurance);
    const perks = gearPerkTotals(s.character.equipment);
    expect(perks.mining_strength).toBeGreaterThan(0); // the epic Steel Pickaxe (lv 20, q55 -> 11%)
    expect(perks.mining_strength).toBe(11);
  });

  it('plays on: a day of simulation keeps the gear and the roll-only fields', () => {
    const after = simulate(s, s.time.lastSimulatedAt + 3 * HOUR).state;
    expect(after.character.equipment.helmet!.affixes).toEqual(s.character.equipment.helmet!.affixes);
    expect(after.crafting.pipes[0]!.status).toBe('ready'); // the rare pickaxe finishes
    expect(after.crafting.pipes[0]!.gear!.affixes).toEqual(s.crafting.pipes[0]!.gear!.affixes);
  });

  it('the step is registered and bumps exactly one version', () => {
    const out = MIGRATIONS[20](JSON.parse(JSON.stringify(V20)));
    expect(out.saveVersion).toBe(21);
  });
});

describe('through the client', () => {
  it('loading writes a MIGRATE anchor (save 20 -> 21, engine 1.20.0 -> current); the piece reveals and play go on; the log replays', async () => {
    const repo = new MemoryGameRepository();
    await repo.init();
    // The 1.20.0 engine's last log row: the anchor chains to it (its engine and the hash of the stored document).
    const last = { commandId: 'v20-last', type: 'SIMULATE' as const, payload: { checkpoint: true }, clientTime: V20.time.lastSimulatedAt, engineVersion: '1.20.0', stateHash: hashState(V20 as unknown as GameState) };
    await repo.commit([last], V20 as unknown as GameState, { [META_ENGINE_VERSION]: '1.20.0', device_id: 'phone' });
    const clock = new FakeClock(V20.time.lastSimulatedAt + 3 * MIN);
    const { client } = makeClient({ repo, clock, prefix: 'v21' });
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect(p).toMatchObject({ fromSave: 20, toSave: CURRENT_SAVE_VERSION, fromEngine: '1.20.0', toEngine: ENGINE_VERSION });
    expect(p.snapshot).toEqual(loadSave(V20));
    // Done on the ready epic Stone Helm: the new item carries the migrated job's affixes.
    const job = client.getState().crafting.pipes[1]!;
    const jobAffixes = job.gear!.affixes;
    expect(jobAffixes).toBeDefined();
    const done = await client.dispatch({ type: 'COLLECT_CRAFT', pipe: 1, jobId: job.id });
    expect(done.ok).toBe(true);
    const helm = client.getState().inventory.items.find((i) => i.defId === 'stone_helm')!;
    expect(helm).toMatchObject({ rarity: 'epic', quality: 91, affixes: jobAffixes });
    clock.advance(30 * MIN);
    await client.resume();
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: 1 });
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});
