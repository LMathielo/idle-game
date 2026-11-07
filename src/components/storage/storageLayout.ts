// The Storage modal's geometry, as pure functions (no React Native, so a test checks it on the phones in tests/storageLayout.test.ts).

/** One grid cell's width: the 52 slot plus 3 of room on each side (the Hero tab's bag grid). */
export const CELL = 58;
export const SCREEN_PAD = 12;
/** Storage section : bag section (flex weights; the bar between them keeps its own height). */
export const STORAGE_FLEX = 6;
export const BAG_FLEX = 4;
/** Section header row (text 14 + padding), the bar between the sections, the gaps and the modal header (ModalScreen: ✕ row 44 + bonus line + padding). */
export const SECTION_HEADER_H = 26;
export const BAR_H = 54;
export const GAP = 8;
export const MODAL_HEADER_H = 80;
/** A section's frame, each side. */
export const BORDER = 3;

/** Whole cells that fit a row inside a section (the screen `width` less the side padding and the section's frame). */
export const gridColumns = (width: number): number => Math.max(1, Math.floor((width - 2 * SCREEN_PAD - 2 * BORDER) / CELL));

/** Height of the storage and the bag section for a window and its safe-area insets (the flex split of what the header, the bar and the gaps leave). */
export function sectionHeights(windowHeight: number, topInset: number, bottomInset: number): { storage: number; bag: number } {
  const room = windowHeight - topInset - bottomInset - MODAL_HEADER_H - GAP /* top pad */ - 2 * GAP - BAR_H;
  const storage = (room * STORAGE_FLEX) / (STORAGE_FLEX + BAG_FLEX);
  return { storage, bag: room - storage };
}

/** Rows of cells a section shows without scrolling. */
export const visibleRows = (sectionHeight: number): number => Math.floor((sectionHeight - SECTION_HEADER_H - 2 * BORDER) / CELL);
