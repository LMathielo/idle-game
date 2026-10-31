// The village map's pure geometry: signs and plots inside the world, the start camera centred on the core, and the
// clamp that never shows an empty bar.
import { describe, expect, it } from 'vitest';
import { CORE, clampCamera, mapLimits, PLOTS, SIGNS, WORLD } from '../src/components/village/villageMap';

const SCREENS = [
  { w: 375, h: 667 },
  { w: 390, h: 844 },
  { w: 430, h: 932 },
];

describe('village map', () => {
  it('every sign sits on the core village, every plot inside the world and outside the core', () => {
    for (const s of SIGNS) {
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
    for (const s of SIGNS) {
      const x = camera.tx + s.x * camera.zoom;
      const y = camera.ty + s.y * camera.zoom;
      expect(x).toBeGreaterThan(40);
      expect(x).toBeLessThan(view.w - 40);
      expect(y - 22).toBeGreaterThanOrEqual(top);
      expect(y + 22 + 22).toBeLessThanOrEqual(view.h - bottom); // sign + an upgrade badge under it
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
