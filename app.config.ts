// Dynamic Expo config on top of app.json: the only thing it changes is `name`, per build, so Expo Go's "Recently
// opened" shows "Idle Game", "Idle Game · dev" or "Idle Game · <git branch>". Everything else comes from app.json
// untouched. `expo export` / `eas update` evaluate it with the publish step's EXPO_PUBLIC_BUILD_LABEL (the RAW branch
// name for a preview, `dev` for dev, unset for main; the app reads the same variable in src/client/buildLabel.ts).
//
// Self-contained on purpose: no imports from src/ (the Expo config loader does not reliably resolve local .ts files).
import type { ExpoConfig } from 'expo/config';

/** App name of the main build and the base of every other one. */
export const BASE_APP_NAME = 'Idle Game';

/** "Idle Game" for main / unset / blank, "Idle Game · dev", "Idle Game · <raw git branch>" for a preview. */
export function appNameForBuild(label: string | null | undefined, baseName: string = BASE_APP_NAME): string {
  const trimmed = (label ?? '').trim();
  return trimmed === '' || trimmed === 'main' ? baseName : `${baseName} · ${trimmed}`;
}

export default ({ config }: { config: ExpoConfig }): ExpoConfig => ({
  ...config,
  name: appNameForBuild(process.env.EXPO_PUBLIC_BUILD_LABEL, config.name),
});
