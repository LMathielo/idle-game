// The village map's pure geometry: signs and plots inside the world, the start camera centred on the core, and the
// clamp that never shows an empty bar.
import { describe, expect, it } from 'vitest';
import { HUD_MARGIN_LEFT, HUD_WIDTH, hudBottom } from '../src/components/hud/hudLayout';
import { CORE, clampCamera, mapLimits, PLOTS, SIGNS, WORLD } from '../src/components/village/villageMap';

/** Signs on the core village (visible at start) and signs on a building plot outside it (reached by panning). */
const CORE_SIGNS = SIGNS.filter((s) => !s.plot);
const PLOT_SIGNS = SIGNS.filter((s) => s.plot);

const SCREENS = [
  { w: 375, h: 667 },
  { w: 390, h: 844 },
  { w: 430, h: 932 },
];

describe('village map', () => {
  it('every core sign sits on the core village, every plot inside the world and outside the core', () => {
    for (const s of CORE_SIGNS) {
      expect(s.x).toBeGreaterThan(CORE.x);
      expect(s.x).toBeLessThan(CORE.x + CORE.w);
      expect(s.y).toBeGreaterThan(CORE.y);
      expect(s.y).toBeLessThan(CORE.y + CORE.h);
    }
    for (const [x0, y0, x1, y1] of Object.values(PLOTS)) {
      expect(x0 >= 0 && y0 >= 0 && x1 <= WORLD.w && y1 <= WORLD.h).toBe(true);
      const overlaps = x1 > CORE.x && x0 < CORE.x + CORE.w && y1 > CORE.y && y0 < CORE.y + CORE.h;
      expect(overlaps).toBe(false);
    }
  });

  it.each(SCREENS)('start camera on $w×$h: covers the screen, every sign visible between the HUD and the strip', (view) => {
    const top = 100;
    const bottom = 44;
    const { camera, minZoom, maxZoom, start } = mapLimits(view, top, bottom);
    expect(minZoom).toBeLessThanOrEqual(start);
    expect(maxZoom).toBeCloseTo(start * 2.5);
    expect(WORLD.w * minZoom).toBeGreaterThanOrEqual(view.w);
    expect(WORLD.h * minZoom).toBeGreaterThanOrEqual(view.h);
    expect(camera).toEqual(clampCamera(camera, view));
    for (const s of CORE_SIGNS) {
      const x = camera.tx + s.x * camera.zoom;
      const y = camera.ty + s.y * camera.zoom;
      expect(x).toBeGreaterThan(40);
      expect(x).toBeLessThan(view.w - 40);
      expect(y - 22).toBeGreaterThanOrEqual(top);
      expect(y + 22 + 22).toBeLessThanOrEqual(view.h - bottom); // sign + an upgrade badge under it
    }
  });

  it('a plot sign (Crafting, 1.13.0) sits at its plot centre and pans fully into view between the HUD and the strip', () => {
    expect(PLOT_SIGNS.map((s) => [s.key, s.plot])).toEqual([['crafting', 'east']]);
    for (const s of PLOT_SIGNS) {
      const [x0, y0, x1, y1] = PLOTS[s.plot!];
      expect([s.x, s.y]).toEqual([(x0 + x1) / 2, (y0 + y1) / 2]);
      for (const view of SCREENS) {
        const top = 100;
        const bottom = 44;
        const { start } = mapLimits(view, top, bottom);
        // Pan so the sign is centred in the visible band (clamped like a real drag), at the start zoom.
        const bandMid = top + (view.h - top - bottom) / 2;
        const c = clampCamera({ zoom: start, tx: view.w / 2 - s.x * start, ty: bandMid - s.y * start }, view);
        const x = c.tx + s.x * c.zoom;
        const y = c.ty + s.y * c.zoom;
        expect(x).toBeGreaterThan(40);
        expect(x).toBeLessThan(view.w - 40);
        expect(y - 22).toBeGreaterThanOrEqual(top);
        expect(y + 22 + 22).toBeLessThanOrEqual(view.h - bottom);
      }
    }
  });

  // 1.17.0: the hero HUD (top-left, fixed size) with each phone's real top inset: 375×667 (iPhone SE, 20), 390×844 (47),
  // 430×932 (59). The map reserves the HUD's bottom edge, so every core sign starts fully below it (no overlap).
  // The Village screen sits above the tab bar (49 + the bottom inset); the activity strip (44) floats over its bottom.
  it.each([
    { w: 375, h: 667, inset: 20, bottomInset: 0 },
    { w: 390, h: 844, inset: 47, bottomInset: 34 },
    { w: 430, h: 932, inset: 59, bottomInset: 34 },
  ])('the hero HUD on $w×$h (top inset $inset) covers no core sign at the start view', ({ w, h, inset, bottomInset }) => {
    expect(HUD_WIDTH).toBeGreaterThanOrEqual(170);
    expect(HUD_WIDTH).toBeLessThanOrEqual(190);
    expect(HUD_MARGIN_LEFT + HUD_WIDTH).toBeLessThan(w / 2 + 20); // top-left: about half a 375 pt screen
    const view = { w, h: h - 49 - bottomInset };
    const top = hudBottom(inset);
    const bottom = 44;
    const { camera } = mapLimits(view, top, bottom);
    for (const s of CORE_SIGNS) {
      const y = camera.ty + s.y * camera.zoom;
      expect(y - 22).toBeGreaterThanOrEqual(top); // a sign's button is 44 high, centred on its anchor
      expect(y + 22 + 22).toBeLessThanOrEqual(view.h - bottom);
    }
  });

  it('clamp: the map edges never come inside the screen at any zoom', () => {
    const view = SCREENS[1];
    const { minZoom, maxZoom } = mapLimits(view);
    for (const zoom of [minZoom, (minZoom + maxZoom) / 2, maxZoom]) {
      for (const [tx, ty] of [[500, 500], [-99999, -99999], [0, 0]]) {
        const c = clampCamera({ zoom, tx, ty }, view);
        expect(c.tx).toBeLessThanOrEqual(0);
        expect(c.ty).toBeLessThanOrEqual(0);
        expect(c.tx + WORLD.w * zoom).toBeGreaterThanOrEqual(view.w - 1e-9);
        expect(c.ty + WORLD.h * zoom).toBeGreaterThanOrEqual(view.h - 1e-9);
      }
    }
  });
});
