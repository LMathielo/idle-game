// The hero HUD's fixed geometry (pure, no React Native, so tests can read it). HeroHud draws exactly this box; the
// Village map keeps its signs below it (topReserve) and tests/villageMap.test.ts checks every sign fits at start.

/** Portrait box, frame included (square). */
export const HUD_PORTRAIT = 54;
/** One bar's height, frame included; four bars stacked with HUD_BAR_GAP between them fill the portrait's height. */
export const HUD_BAR_HEIGHT = 12;
export const HUD_BAR_GAP = 2;
/** Width of the bar column. */
export const HUD_BARS_WIDTH = 116;
/** Gap between the portrait and the bars. */
export const HUD_GAP = 6;
/** Inner padding and frame of the HUD box. */
export const HUD_PADDING = 3;
export const HUD_BORDER = 2;
/** Offset of the HUD from the top safe-area edge and from the left screen edge. */
export const HUD_MARGIN_TOP = 4;
export const HUD_MARGIN_LEFT = 8;

/** Outer size of the HUD box: 186 × 64. */
export const HUD_WIDTH = 2 * (HUD_PADDING + HUD_BORDER) + HUD_PORTRAIT + HUD_GAP + HUD_BARS_WIDTH;
export const HUD_HEIGHT = 2 * (HUD_PADDING + HUD_BORDER) + HUD_PORTRAIT;

/** Bottom edge of the HUD on screen (what the Village map reserves at the top), for a top safe-area inset. */
export function hudBottom(insetTop: number): number {
  return insetTop + HUD_MARGIN_TOP + HUD_HEIGHT;
}
