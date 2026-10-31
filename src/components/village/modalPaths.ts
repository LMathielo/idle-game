/**
 * Village full-screen modal routes. Each one hosts its own AwayModal and DialogHost (through ModalScreen), because on
 * iOS the root's RN Modal can't present over a full-screen modal; the root hosts step aside while one is open.
 * The single list used by app/_layout.tsx (RootAwayModal) and ui/GameDialog.tsx (RootDialogHost).
 */
export const VILLAGE_MODAL_PATHS: readonly string[] = ['/dungeon', '/training', '/woodcutting', '/mine', '/merchant', '/town-hall'];
