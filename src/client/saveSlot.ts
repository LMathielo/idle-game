// Save slots: every build keeps its own SQLite file, so main, dev and each previewed PR branch never overwrite one
// another's progress (Expo Go gives them all the same app storage).
//
// The slot is baked at publish time through the public env var EXPO_PUBLIC_SAVE_SLOT (see .github/workflows):
//   - not set (main, local `npx expo start`) -> idle-game.db, the file every build used before slots existed
//   - `dev`                                  -> idle-game-dev.db, seeded once from idle-game.db (seedSave.ts)
//   - a PR preview                           -> idle-game-<head branch>.db, a fresh save
// Client layer only: the engine never sees the slot.

/** The save file of main and of local runs. It keeps its historical name so existing progress stays on main. */
export const DEFAULT_DB_NAME = 'idle-game.db';

/** Slots that start from a one-time copy of the default save instead of from nothing. */
const SEEDED_SLOTS: readonly string[] = ['dev'];

/**
 * Lowercase letters, digits and single dashes only (`Feat/My_Thing` -> `feat-my-thing`), so the slot is safe in a file
 * name. Anything else becomes a dash; dashes are collapsed and trimmed. The publish workflow applies the same rule in
 * shell, and applying it again here changes nothing.
 */
export function sanitizeSaveSlot(raw: string | null | undefined): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** True when this slot is the default one: no slot, or `main`. */
export function isDefaultSlot(raw: string | null | undefined): boolean {
  const slot = sanitizeSaveSlot(raw);
  return slot === '' || slot === 'main';
}

/** SQLite file name for a slot: `idle-game.db` for the default slot, otherwise `idle-game-<slot>.db`. */
export function dbNameForSlot(raw: string | null | undefined): string {
  return isDefaultSlot(raw) ? DEFAULT_DB_NAME : `idle-game-${sanitizeSaveSlot(raw)}.db`;
}

/** Whether the slot's first launch copies the default save (only `dev`). */
export function slotSeedsFromDefault(raw: string | null | undefined): boolean {
  return SEEDED_SLOTS.includes(sanitizeSaveSlot(raw));
}

/** This build's slot (`main` when none was baked). Metro inlines the literal `process.env.EXPO_PUBLIC_*` at bundle time. */
export const SAVE_SLOT: string = isDefaultSlot(process.env.EXPO_PUBLIC_SAVE_SLOT)
  ? 'main'
  : sanitizeSaveSlot(process.env.EXPO_PUBLIC_SAVE_SLOT);

/** This build's SQLite file. */
export const SAVE_DB_NAME: string = dbNameForSlot(SAVE_SLOT);
