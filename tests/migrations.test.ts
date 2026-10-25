import { describe, expect, it } from 'vitest';
import { hashState, newGame } from '../src/engine';
import { CURRENT_SAVE_VERSION, loadSave, migrateDoc, type Migration, SaveVersionError } from '../src/engine/migrations';
import { T0 } from './helpers';

describe('save migrations', () => {
  it('real v1 → v2 migration adds flags.debugUsed = false and keeps everything else', () => {
    const v2 = newGame(77, T0);
    const { flags: _flags, ...rest } = v2;
    const v1 = { ...rest, saveVersion: 1 };
    const migrated = loadSave(v1);
    expect(migrated).toEqual({ ...v2, flags: { debugUsed: false } });
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
