// Which build this is, as a label: `main` (or unset), `dev`, or the raw git branch of a PR preview. Baked at publish
// time through the public env var EXPO_PUBLIC_BUILD_LABEL (set by eas-update.yml for dev and by expo-preview.yml for
// previews), next to EXPO_PUBLIC_SAVE_SLOT (saveSlot.ts: the sanitized form, for file names). The same variable also
// names the app in Expo Go (app.config.ts). The Debug panel shows it.

/** The label for a raw value: `main` when unset or blank, otherwise the trimmed value. */
export function buildLabelOf(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  return trimmed === '' ? 'main' : trimmed;
}

/** This build's label. Metro inlines the literal `process.env.EXPO_PUBLIC_*` at bundle time. */
export const BUILD_LABEL: string = buildLabelOf(process.env.EXPO_PUBLIC_BUILD_LABEL);
