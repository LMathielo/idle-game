// The Potion Belt button's fixed geometry (pure, no React Native, so tests can read it). The Village screen floats the button over
// the map at the bottom right, just above the activity strip; tests/potionBeltLayout.test.ts checks it covers no sign at the start
// view on the villageMap test phones. The Dungeon modal puts it in a footer row under the scrolling content instead (nothing to cover).

/** The button's side, points (a 3 pt bevel and a 16x16 flask at x2, with the total under it). */
export const BELT_BUTTON_SIZE = 56;
/** Gap from the screen's right edge and from the strip. */
export const BELT_BUTTON_MARGIN = 8;

/** The button's box on the Village screen (`view` = the screen above the tab bar), above a strip of `stripHeight`. */
export function beltButtonBox(view: { w: number; h: number }, stripHeight: number): { x0: number; y0: number; x1: number; y1: number } {
  const x1 = view.w - BELT_BUTTON_MARGIN;
  const y1 = view.h - stripHeight - BELT_BUTTON_MARGIN;
  return { x0: x1 - BELT_BUTTON_SIZE, y0: y1 - BELT_BUTTON_SIZE, x1, y1 };
}
