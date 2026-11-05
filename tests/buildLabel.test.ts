import { describe, expect, it } from 'vitest';
import config, { BASE_APP_NAME, appNameForBuild } from '../app.config';
import { buildLabelOf } from '../src/client/buildLabel';

describe('app name per build', () => {
  it('main or unset keeps "Idle Game"', () => {
    for (const raw of [undefined, null, '', '  ', 'main', ' main ']) expect(appNameForBuild(raw)).toBe('Idle Game');
    expect(BASE_APP_NAME).toBe('Idle Game');
  });

  it('dev and previews append the raw label, branch slashes kept', () => {
    expect(appNameForBuild('dev')).toBe('Idle Game · dev');
    expect(appNameForBuild('feat/expo-test-previews')).toBe('Idle Game · feat/expo-test-previews');
    expect(appNameForBuild(' fix/Stamina_Bug.2 ')).toBe('Idle Game · fix/Stamina_Bug.2');
  });

  it('uses the base name it is given (app.json name)', () => {
    expect(appNameForBuild('dev', 'Other')).toBe('Other · dev');
    expect(appNameForBuild(undefined, 'Other')).toBe('Other');
  });

  it('the dynamic config overrides only `name`', () => {
    const base = { name: 'Idle Game', slug: 'idle-game', version: '1.0.0', extra: { eas: { projectId: 'x' } } };
    const prev = process.env.EXPO_PUBLIC_BUILD_LABEL;
    try {
      process.env.EXPO_PUBLIC_BUILD_LABEL = 'feat/x';
      expect(config({ config: base })).toEqual({ ...base, name: 'Idle Game · feat/x' });
      delete process.env.EXPO_PUBLIC_BUILD_LABEL;
      expect(config({ config: base })).toEqual(base);
    } finally {
      if (prev === undefined) delete process.env.EXPO_PUBLIC_BUILD_LABEL;
      else process.env.EXPO_PUBLIC_BUILD_LABEL = prev;
    }
  });

  it('the Debug label agrees with the app name: same suffix, `main` when none', () => {
    for (const raw of [undefined, '', 'main', 'dev', 'feat/a-b']) {
      const label = buildLabelOf(raw);
      const name = appNameForBuild(raw);
      expect(name).toBe(label === 'main' ? 'Idle Game' : `Idle Game · ${label}`);
    }
  });
});
