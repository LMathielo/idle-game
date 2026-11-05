import { describe, expect, it } from 'vitest';
import { DEFAULT_DB_NAME, dbNameForSlot, isDefaultSlot, sanitizeSaveSlot, slotSeedsFromDefault } from '../src/client/saveSlot';

describe('save slot -> database file name', () => {
  it('main keeps the existing file: no slot, empty, or "main"', () => {
    expect(DEFAULT_DB_NAME).toBe('idle-game.db');
    for (const raw of [undefined, null, '', 'main', 'MAIN', '  ', '///']) {
      expect(dbNameForSlot(raw)).toBe('idle-game.db');
      expect(isDefaultSlot(raw)).toBe(true);
    }
  });

  it('dev has its own file', () => {
    expect(dbNameForSlot('dev')).toBe('idle-game-dev.db');
    expect(isDefaultSlot('dev')).toBe(false);
  });

  it('PR preview slots are the sanitized head branch', () => {
    expect(dbNameForSlot('feat/expo-test-previews')).toBe('idle-game-feat-expo-test-previews.db');
    expect(dbNameForSlot('fix/Stamina_Bug.2')).toBe('idle-game-fix-stamina-bug-2.db');
    expect(dbNameForSlot('chore/a//b')).toBe('idle-game-chore-a-b.db');
  });

  it('sanitizing leaves only [a-z0-9-], never a leading, trailing or doubled dash', () => {
    for (const raw of ['Feat/Ünïcode ✓ branch', '../../etc/passwd', 'a b\tc', '-x-', 'x--y', 'UPPER']) {
      const slot = sanitizeSaveSlot(raw);
      expect(slot).toMatch(/^([a-z0-9]+(-[a-z0-9]+)*)?$/);
    }
    expect(sanitizeSaveSlot('../../etc/passwd')).toBe('etc-passwd');
    expect(dbNameForSlot('../../etc/passwd')).toBe('idle-game-etc-passwd.db');
  });

  it('is idempotent, so a slot sanitized by the workflow is unchanged in the app', () => {
    for (const raw of ['dev', 'feat/expo-test-previews', 'Fix_1', 'a--b']) {
      expect(sanitizeSaveSlot(sanitizeSaveSlot(raw))).toBe(sanitizeSaveSlot(raw));
    }
  });

  it('only dev seeds from the default save', () => {
    expect(slotSeedsFromDefault('dev')).toBe(true);
    expect(slotSeedsFromDefault('DEV')).toBe(true);
    for (const raw of [undefined, '', 'main', 'feat/x', 'dev-2']) expect(slotSeedsFromDefault(raw)).toBe(false);
  });
});
