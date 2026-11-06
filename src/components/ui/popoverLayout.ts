// Pure helpers behind InfoPopover (no React / RN imports, unit-tested in tests/popoverLayout.test.ts).

export type AnchorBox = { x: number; y: number; width: number; height: number };

/** A box height measured by onLayout, tagged with the presentation (anchor + visible epoch) it was measured for. */
export type Measured = { key: number; h: number };

/** The measured height, valid only for the presentation `key` it was measured for; else null (not measured yet). */
export function measuredFor(m: Measured | null, key: number): number | null {
  return m !== null && m.key === key ? m.h : null;
}

/** The box is drawn once measured, or once the safety timeout for this presentation has fired (never stays hidden). */
export function boxShown(h: number | null, timedOutKey: number | null, key: number): boolean {
  return h !== null || timedOutKey === key;
}

/** Gap kept from the screen / safe-area edges and between the box and the element. */
export const MARGIN = 8;
export const GAP = 6;
export const MAX_W = 360;
export const CARET = 8;
/** Smallest box height worth showing; below that the popover overlaps the element instead of shrinking further. */
export const MIN_H = 140;
/** If the box has not reported its layout within this long of becoming visible, it is shown anyway. */
export const MEASURE_TIMEOUT_MS = 150;
/** Item switch crossfade: the old box fades out, then the new one fades in once measured (reduce-motion: instant). */
export const FADE_OUT_MS = 80;
export const FADE_IN_MS = 120;

export type Placement = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  boxH: number;
  below: boolean;
  caretLeft: number;
  caretFits: boolean;
};

/** Where the box goes. `h` null = not measured (placed by the larger side, height 0). */
export function placePopover(
  anchor: AnchorBox,
  h: number | null,
  win: { width: number; height: number },
  insets: { top: number; bottom: number; left: number; right: number },
): Placement {
  const left0 = insets.left + MARGIN;
  const right0 = win.width - insets.right - MARGIN;
  const top0 = insets.top + MARGIN;
  const bottom0 = win.height - insets.bottom - MARGIN;
  const width = Math.min(MAX_W, right0 - left0);
  const centerX = anchor.x + anchor.width / 2;
  const left = Math.min(Math.max(centerX - width / 2, left0), right0 - width);

  const spaceBelow = bottom0 - (anchor.y + anchor.height + GAP + CARET);
  const spaceAbove = anchor.y - GAP - CARET - top0;
  const natural = h ?? 0;
  const below = h === null ? spaceBelow >= spaceAbove : natural <= spaceBelow || spaceBelow >= spaceAbove;
  const room = Math.max(MIN_H, below ? spaceBelow : spaceAbove);
  const maxHeight = Math.min(room, bottom0 - top0);
  const boxH = Math.min(natural, maxHeight);
  let top = below ? anchor.y + anchor.height + GAP + CARET : anchor.y - GAP - CARET - boxH;
  top = Math.min(Math.max(top, top0), bottom0 - boxH);
  const caretLeft = Math.min(Math.max(centerX - left - CARET, 10), width - 10 - 2 * CARET);
  const caretFits = below ? top >= anchor.y + anchor.height : top + boxH <= anchor.y;
  return { left, top, width, maxHeight, boxH, below, caretLeft, caretFits };
}
