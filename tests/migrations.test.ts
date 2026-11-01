import { describe, expect, it } from 'vitest';
import { type GameState, getDerivedStats, hashState, newGame, newTrainingState } from '../src/engine';
import { CURRENT_SAVE_VERSION, loadSave, migrateDoc, type Migration, MIGRATIONS, SaveVersionError } from '../src/engine/migrations';
import { T0, withoutGearRolls } from './helpers';

describe('save migrations', () => {
  it('real v1 → v2 step adds flags.debugUsed = false and keeps everything else', () => {
    const v1 = { saveVersion: 1, rng: { seed: 9 }, character: { name: 'X' } };
    expect(MIGRATIONS[1](v1)).toEqual({ ...v1, saveVersion: 2, flags: { debugUsed: false } });
  });

  it('real v2 → v3: remaps attributes to max(old, 10), drops hp, adds full stamina and item defIds', () => {
    const v2 = {
      saveVersion: 2,
      rng: { seed: 9 },
      activity: null,
      flags: { debugUsed: false },
      character: {
        name: 'Lucius',
        level: 7,
        xp: 12,
        hp: 33,
        maxHp: 50,
        gold: 99,
        attributes: { strength: 21, dexterity: 13, agility: 8, constitution: 17, charisma: 4, intelligence: 6 },
        equipment: {
          weapon: { id: 'start-rusty_gladius', name: 'Rusty Gladius', icon: '🗡️', rarity: 'common', slot: 'weapon' },
          boots: { id: 'start-worn_sandals', name: 'Worn Sandals', icon: '👢', rarity: 'common', slot: 'boots' },
        },
        skills: { woodcutting: { level: 3, xp: 1, xpToNext: 2598 } },
      },
      inventory: {
        capacity: 20,
        items: [{ id: 'oak_logs', name: 'Oak Logs', icon: '🪵', rarity: 'common', stackable: true, quantity: 40 }],
      },
    };
    const frozenInput = JSON.parse(JSON.stringify(v2));
    const v3 = MIGRATIONS[2](v2) as unknown as GameState;
    expect(v2).toEqual(frozenInput); // pure
    expect(v3.saveVersion).toBe(3);
    // Above 10 kept, below 10 raised to 10 (intelligence 6 → 10); agility and charisma dropped.
    expect(v3.character.attributes).toEqual({ strength: 21, dexterity: 13, endurance: 17, intelligence: 10 });
    expect(v3.character).not.toHaveProperty('hp');
    expect(v3.character).not.toHaveProperty('maxHp');
    expect(v3.stamina).toEqual({ current: 100, max: 100, progressMs: 0 });
    expect(v3.character.equipment.weapon).toMatchObject({ id: 'start-rusty_gladius', defId: 'rusty_gladius' });
    expect(v3.character.equipment.boots).toMatchObject({ id: 'start-worn_sandals', defId: 'worn_sandals' });
    expect(v3.inventory.items).toEqual([{ ...v2.inventory.items[0], defId: 'oak_logs' }]);
    // Untouched fields survive as they were.
    expect({ ...v3.character, attributes: undefined, equipment: undefined }).toEqual({
      ...v2.character,
      hp: undefined,
      maxHp: undefined,
      attributes: undefined,
      equipment: undefined,
    });
    expect(v3.rng).toEqual(v2.rng);
    // Derived stats read the catalog through the new defIds: 2–4 + 21 STR, 1 armor + 17 END (no training in v3).
    const d = getDerivedStats({ ...v3, training: newTrainingState() });
    expect([d.damage.min, d.damage.max, d.defense.value]).toEqual([23, 25, 18]);
  });

  it('v2 → v3 tolerates missing attributes (defaults to 10) and keeps an existing defId', () => {
    const v3 = MIGRATIONS[2]({
      saveVersion: 2,
      character: { attributes: { strength: 'x' }, equipment: { weapon: { id: 'w1', defId: 'rusty_gladius' } } },
    }) as unknown as GameState;
    expect(v3.character.attributes).toEqual({ strength: 10, dexterity: 10, endurance: 10, intelligence: 10 });
    expect(v3.character.equipment.weapon?.defId).toBe('rusty_gladius');
    expect(v3.inventory.items).toEqual([]);
  });

  it('real v3 → v4: full HP at the hero level, no dungeon activity, empty fight state; pure', () => {
    const v3 = {
      saveVersion: 3,
      activity: { kind: 'woodcutting', startedAt: 1, progressMs: 7 },
      character: { name: 'Lucius', level: 6, xp: 3, gold: 9, attributes: { strength: 10, dexterity: 10, endurance: 10, intelligence: 10 } },
      stamina: { current: 50, max: 100, progressMs: 3 },
    };
    const frozenInput = JSON.parse(JSON.stringify(v3));
    const v4 = MIGRATIONS[3](v3) as unknown as GameState;
    expect(v3).toEqual(frozenInput);
    expect(v4.saveVersion).toBe(4);
    expect(v4.character).toEqual({ ...v3.character, hp: 100, hpRegenProgress: 0 }); // 50 + 10 × 5
    expect(v4.dungeon).toEqual({ lastFight: null, totals: { runs: 0, wins: 0, losses: 0 } });
    expect(v4.activity).toEqual(v3.activity);
    expect(v4.stamina).toEqual(v3.stamina);
    // A broken level counts as 1.
    expect((MIGRATIONS[3]({ saveVersion: 3, character: { level: 'x' } }) as unknown as GameState).character.hp).toBe(50);
    expect((MIGRATIONS[3]({ saveVersion: 3 }) as unknown as GameState).character).toEqual({ hp: 50, hpRegenProgress: 0 });
  });

  it('real v4 → v5: renames rat_cellar_1, moves the lifetime totals to Rat Cellar; pure', () => {
    const fight = { dungeonId: 'rat_cellar_1', enemyId: 'rat', won: true, rounds: 3 };
    const v4 = {
      saveVersion: 4,
      activity: { kind: 'dungeon', dungeonId: 'rat_cellar_1', startedAt: 1, progressMs: 7 },
      dungeon: { lastFight: fight, totals: { runs: 12, wins: 9, losses: 3 } },
      character: { name: 'Lucius' },
    };
    const frozenInput = JSON.parse(JSON.stringify(v4));
    const v5 = MIGRATIONS[4](v4) as unknown as GameState;
    expect(v4).toEqual(frozenInput);
    expect(v5.saveVersion).toBe(5);
    expect(v5.activity).toEqual({ ...v4.activity, dungeonId: 'rat_cellar' });
    expect(v5.dungeon).toEqual({
      lastFight: { ...fight, dungeonId: 'rat_cellar' },
      totals: { runs: 12, wins: 9, losses: 3 },
      byDungeon: { rat_cellar: { runs: 12, wins: 9, losses: 3 } },
    });
    expect(v5.character).toEqual(v4.character);
  });

  it('v4 → v5 edge cases: no runs → empty byDungeon; woodcutting activity untouched; broken counters count as 0', () => {
    const wood = { kind: 'woodcutting', startedAt: 1, progressMs: 2 };
    const a = MIGRATIONS[4]({ saveVersion: 4, activity: wood, dungeon: { lastFight: null, totals: { runs: 0, wins: 0, losses: 0 } } }) as unknown as GameState;
    expect(a.activity).toEqual(wood);
    expect(a.dungeon).toEqual({ lastFight: null, totals: { runs: 0, wins: 0, losses: 0 }, byDungeon: {} });
    const b = MIGRATIONS[4]({ saveVersion: 4, activity: null, dungeon: { totals: { runs: 'x', wins: -1, losses: 2 } } }) as unknown as GameState;
    expect(b.activity).toBeNull();
    expect(b.dungeon).toEqual({ lastFight: null, totals: { runs: 0, wins: 0, losses: 2 }, byDungeon: { rat_cellar: { runs: 0, wins: 0, losses: 2 } } });
    expect((MIGRATIONS[4]({ saveVersion: 4 }) as unknown as GameState).dungeon).toEqual({
      lastFight: null,
      totals: { runs: 0, wins: 0, losses: 0 },
      byDungeon: {},
    });
  });

  it('real v6 → v7: running woodcutting becomes Oak at progress 0, the Wooden Axe fills the new axe slot; pure', () => {
    const gear = { weapon: { id: 'start-rusty_gladius', defId: 'rusty_gladius' } };
    const v6 = {
      saveVersion: 6,
      activity: { kind: 'woodcutting', startedAt: 5, progressMs: 2400 },
      character: { name: 'Lucius', equipment: gear, skills: { woodcutting: { level: 9, xp: 7, xpToNext: 13500 } } },
      inventory: { capacity: 20, items: [{ id: 'oak_logs', defId: 'oak_logs', quantity: 12 }] },
    };
    const frozenInput = JSON.parse(JSON.stringify(v6));
    const v7 = MIGRATIONS[6](v6) as unknown as GameState;
    expect(v6).toEqual(frozenInput);
    expect(v7.saveVersion).toBe(7);
    expect(v7.activity).toEqual({ kind: 'woodcutting', treeId: 'oak', startedAt: 5, progressMs: 0 });
    expect(v7.character.equipment).toEqual({
      ...gear,
      axe: { id: 'start-wooden_axe', defId: 'wooden_axe', name: 'Wooden Axe', icon: '🪓', rarity: 'common', slot: 'axe' },
    });
    // The frozen axe is exactly what a new hero gets, once v8 drops the per-instance rarity.
    expect((MIGRATIONS[7](v7 as never) as unknown as GameState).character.equipment.axe).toEqual(withoutGearRolls(newGame(1, T0)).character.equipment.axe);
    expect(v7.character.skills).toEqual(v6.character.skills);
    expect(v7.inventory).toEqual(v6.inventory);
  });

  it('v6 → v7 edge cases: other activities and no activity untouched; an existing axe is kept; no character', () => {
    const dungeon = { kind: 'dungeon', dungeonId: 'bat_cave', startedAt: 1, progressMs: 9 };
    expect((MIGRATIONS[6]({ saveVersion: 6, activity: dungeon }) as unknown as GameState).activity).toEqual(dungeon);
    const training = { kind: 'training', attribute: 'strength', startedAt: 1 };
    expect((MIGRATIONS[6]({ saveVersion: 6, activity: training }) as unknown as GameState).activity).toEqual(training);
    expect((MIGRATIONS[6]({ saveVersion: 6, activity: null }) as unknown as GameState).activity).toBeNull();
    const axe = { id: 'a1', defId: 'wooden_axe' };
    expect((MIGRATIONS[6]({ saveVersion: 6, character: { equipment: { axe } } }) as unknown as GameState).character.equipment.axe).toEqual(axe);
    expect((MIGRATIONS[6]({ saveVersion: 6 }) as unknown as GameState).character.equipment.axe?.defId).toBe('wooden_axe');
  });

  it('v7 → v8: merchant at 5/5 with the 4 listings in the first slots, item serial 1, instance rarity dropped; pure', () => {
    const v7 = {
      saveVersion: 7,
      activity: { kind: 'dungeon', dungeonId: 'rat_cellar', startedAt: 1, progressMs: 9 },
      character: {
        gold: 77,
        equipment: { axe: { id: 'start-wooden_axe', defId: 'wooden_axe', name: 'Wooden Axe', icon: '🪓', rarity: 'common', slot: 'axe' } },
      },
      inventory: { capacity: 6, items: [{ id: 'bird_nest', defId: 'bird_nest', name: 'Bird Nest', icon: '🪺', rarity: 'rare', stackable: true, quantity: 2 }] },
    };
    const frozenInput = JSON.parse(JSON.stringify(v7));
    const v8 = MIGRATIONS[7](v7) as unknown as GameState;
    expect(v7).toEqual(frozenInput);
    expect(v8.saveVersion).toBe(8);
    expect(v8.activity).toEqual(v7.activity);
    expect(v8.merchant).toEqual({
      charges: 5,
      chargeProgressMs: 0,
      stock: [
        { defId: 'health_potion_t1', quantity: 10, unitPrice: 12 },
        { defId: 'iron_axe', quantity: 1, unitPrice: 600 },
        { defId: 'iron_sword', quantity: 1, unitPrice: 500 },
        { defId: 'iron_helm', quantity: 1, unitPrice: 400 },
        null,
        null,
      ],
    });
    expect(v8.nextItemSerial).toBe(1);
    expect(v8.character.gold).toBe(77);
    expect(v8.character.equipment.axe).toEqual({ id: 'start-wooden_axe', defId: 'wooden_axe', name: 'Wooden Axe', icon: '🪓', slot: 'axe' });
    expect(v8.inventory).toEqual({ capacity: 6, items: [{ id: 'bird_nest', defId: 'bird_nest', name: 'Bird Nest', icon: '🪺', stackable: true, quantity: 2 }] });
    // Broken or missing parts: default capacity 20, nothing else invented.
    const bare = MIGRATIONS[7]({ saveVersion: 7 }) as unknown as GameState;
    expect(bare.merchant.stock).toEqual([
      { defId: 'health_potion_t1', quantity: 10, unitPrice: 12 },
      { defId: 'iron_axe', quantity: 1, unitPrice: 600 },
      { defId: 'iron_sword', quantity: 1, unitPrice: 500 },
      { defId: 'iron_helm', quantity: 1, unitPrice: 400 },
      ...Array.from({ length: 16 }, () => null),
    ]);
    expect(bare.inventory.items).toEqual([]);
  });

  it('newest save loads unchanged; a new game is already v15', () => {
    const s = newGame(77, T0);
    expect(s.saveVersion).toBe(15);
    expect(CURRENT_SAVE_VERSION).toBe(15);
    expect(loadSave(s)).toEqual(s);
  });

  it('current-version round-trip: store as JSON, load back, identical state', () => {
    const s = newGame(77, T0);
    const stored = JSON.parse(JSON.stringify(s));
    const loaded = loadSave(stored);
    expect(loaded).toEqual(s);
    expect(hashState(loaded)).toBe(hashState(s));
    expect(loaded.saveVersion).toBe(CURRENT_SAVE_VERSION);
  });

  it('runs ordered migrations step by step (framework test with fake versions)', () => {
    const calls: number[] = [];
    const migrations: Record<number, Migration> = {
      1: (d) => {
        calls.push(1);
        return { ...d, saveVersion: 2, renamed: d.old, old: undefined };
      },
      2: (d) => {
        calls.push(2);
        return { ...d, saveVersion: 3, added: 'default' };
      },
    };
    const v1 = { saveVersion: 1, old: 'x' };
    const out = migrateDoc(v1, migrations, 3);
    expect(calls).toEqual([1, 2]);
    expect(out).toMatchObject({ saveVersion: 3, renamed: 'x', added: 'default' });
    expect(v1).toEqual({ saveVersion: 1, old: 'x' }); // input untouched
    // already current: no migration runs
    expect(migrateDoc({ saveVersion: 3 }, migrations, 3)).toEqual({ saveVersion: 3 });
  });

  it('rejects broken or future saves instead of corrupting them', () => {
    expect(() => migrateDoc(null)).toThrow(SaveVersionError);
    expect(() => migrateDoc({})).toThrow(SaveVersionError);
    expect(() => migrateDoc({ saveVersion: '1' })).toThrow(SaveVersionError);
    expect(() => migrateDoc({ saveVersion: 99 })).toThrow(/newer/);
    expect(() => migrateDoc({ saveVersion: 0 }, {}, 1)).toThrow(/No migration/);
    expect(() => migrateDoc({ saveVersion: 1 }, { 1: (d) => ({ ...d }) }, 2)).toThrow(/must set saveVersion/);
  });
});
