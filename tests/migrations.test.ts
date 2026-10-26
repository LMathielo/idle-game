import { describe, expect, it } from 'vitest';
import { type GameState, getDerivedStats, hashState, newGame } from '../src/engine';
import { CURRENT_SAVE_VERSION, loadSave, migrateDoc, type Migration, MIGRATIONS, SaveVersionError } from '../src/engine/migrations';
import { T0 } from './helpers';

describe('save migrations', () => {
  it('real v1 → v2 step adds flags.debugUsed = false and keeps everything else', () => {
    const v1 = { saveVersion: 1, rng: { seed: 9 }, character: { name: 'X' } };
    expect(MIGRATIONS[1](v1)).toEqual({ ...v1, saveVersion: 2, flags: { debugUsed: false } });
  });

  it('real v2 → v3: remaps attributes keeping values, drops hp, adds full stamina and item defIds', () => {
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
    expect(v3.character.attributes).toEqual({ strength: 21, dexterity: 13, endurance: 17, intelligence: 6 });
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
    // Derived stats read the catalog through the new defIds: 2–4 + 21 STR, 1 armor + 17 END.
    const d = getDerivedStats(v3);
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

  it('newest save loads unchanged; a new game is already v3', () => {
    const s = newGame(77, T0);
    expect(s.saveVersion).toBe(3);
    expect(CURRENT_SAVE_VERSION).toBe(3);
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
