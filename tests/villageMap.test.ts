// The village map's pure geometry: signs and plots inside the world, the start camera centred on the core, and the
// clamp that never shows an empty bar. Signs scale with the map (2026-11-05), so their sizes and overlaps are in world px
// and do not depend on the phone.
import { describe, expect, it } from 'vitest';
import { HUD_MARGIN_LEFT, HUD_WIDTH, hudBottom } from '../src/components/hud/hudLayout';
import {
  CORE,
  clampCamera,
  mapLimits,
  PIECES,
  PLOTS,
  SIGN_BUTTON_H,
  SIGN_GAP,
  SIGN_HIT_SLOP,
  SIGN_LAYOUT_SCALE,
  SIGN_LABEL_PT,
  SIGN_NUDGE,
  SIGN_TOUCH_H,
  SIGN_SCALE,
  SIGNS,
  signWorldBox,
  WORLD,
} from '../src/components/village/villageMap';

/** Signs on the core village (visible at start) and signs on a building plot outside it (reached by panning). */
const CORE_SIGNS = SIGNS.filter((s) => !s.plot);
const PLOT_SIGNS = SIGNS.filter((s) => s.plot);

const SCREENS = [
  { w: 375, h: 667 },
  { w: 390, h: 844 },
  { w: 430, h: 932 },
];

// A sign's natural width: its label in Pixelify Sans Bold 18 (measured, rounded up) + 30 of PixelButton chrome, + 20 for
// the padlock while its building is not built. The widths are hand-measured (TECH_DEBT); sizes and gaps are not.
const LABEL_W: Record<string, number> = { dungeon: 76, mine: 98, merchant: 91, woodcutting: 116, training: 72, town_hall: 80, crafting: 80, storage: 76 };
const LOCKABLE = new Set(['woodcutting', 'mine', 'town_hall', 'training', 'crafting']);
const naturalWidth = (key: string, padlock: boolean) => LABEL_W[key] + 30 + (padlock && LOCKABLE.has(key) ? 20 : 0);
/** The timer pill under a sign (20 high + 2 gap, natural px) hangs below the sign. */
const BADGE_BELOW = 22;
const boxOf = (s: (typeof SIGNS)[number], padlock = true) => signWorldBox(s, naturalWidth(s.key, padlock));

/** Screen rect of a sign's box (with its badge under it) for a camera. */
function screenBox(s: (typeof SIGNS)[number], c: { zoom: number; tx: number; ty: number }) {
  const b = boxOf(s);
  return {
    x0: c.tx + b.x0 * c.zoom,
    x1: c.tx + b.x1 * c.zoom,
    y0: c.ty + b.y0 * c.zoom,
    y1: c.ty + (b.y1 + BADGE_BELOW * SIGN_SCALE) * c.zoom,
  };
}

describe('village map', () => {
  it('every core sign sits in the start framing; every plot is inside the world and empty ground in the art', () => {
    for (const s of CORE_SIGNS) {
      expect(s.x).toBeGreaterThan(CORE.x);
      expect(s.x).toBeLessThan(CORE.x + CORE.w);
      expect(s.y).toBeGreaterThan(CORE.y);
      expect(s.y).toBeLessThan(CORE.y + CORE.h);
    }
    // A plot's centre is under no building piece, except the building that stands on it (east = Crafting house).
    const onPlot = new Map(SIGNS.filter((s) => s.plot).map((s) => [s.plot, s.key]));
    for (const [plot, [x0, y0, x1, y1]] of Object.entries(PLOTS)) {
      expect(x0 >= 0 && y0 >= 0 && x1 <= WORLD.w && y1 <= WORLD.h).toBe(true);
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const under = PIECES.filter((p) => cx >= p.x && cx < p.x + p.w && cy >= p.y && cy < p.y + p.h).map((p) => p.id);
      expect(under, plot).toEqual(onPlot.has(plot as never) ? [onPlot.get(plot as never)] : []);
    }
  });

  // One rule: centred on the building's box, top edge on the box's bottom edge (SIGN_GAP = 0).
  it('every sign is centred under its building (one nudge listed), its top on the bottom edge of the building box, inside the world', () => {
    expect(SIGN_GAP).toBe(0);
    expect(SIGNS.map((s) => s.key).sort()).toEqual(PIECES.filter((p) => p.sign).map((p) => p.id).sort());
    for (const s of SIGNS) {
      const p = PIECES.find((q) => q.id === s.key)!;
      expect(s.x, s.key).toBe(p.x + p.w / 2 + (SIGN_NUDGE[s.key]?.x ?? 0));
      expect(Math.abs(s.x - (p.x + p.w / 2)), s.key).toBeLessThanOrEqual(7); // a nudge stays under the building's box
      expect(s.y, s.key).toBe(p.y + p.h + SIGN_GAP);
      for (const padlock of [false, true]) {
        const b = boxOf(s, padlock);
        expect(b.x0, s.key).toBeGreaterThanOrEqual(0);
        expect(b.x1, s.key).toBeLessThanOrEqual(WORLD.w);
        expect(b.y0, s.key).toBeGreaterThanOrEqual(p.y + p.h + SIGN_GAP);
        expect(b.y1 + BADGE_BELOW * SIGN_SCALE, s.key).toBeLessThanOrEqual(WORLD.h);
      }
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
      const r = screenBox(s, camera);
      expect(r.x0, s.key).toBeGreaterThanOrEqual(0);
      expect(r.x1, s.key).toBeLessThanOrEqual(view.w);
      expect(r.y0, s.key).toBeGreaterThanOrEqual(top);
      expect(r.y1, s.key).toBeLessThanOrEqual(view.h - bottom); // sign + an upgrade badge under it
    }
  });

  it('a plot sign (Crafting, 1.13.0) hangs under the building on its plot and pans fully into view between the HUD and the strip', () => {
    expect(PLOT_SIGNS.map((s) => [s.key, s.plot])).toEqual([['crafting', 'east']]);
    for (const s of PLOT_SIGNS) {
      const [x0, y0, x1, y1] = PLOTS[s.plot!];
      const p = PIECES.find((q) => q.id === s.key)!;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      expect(cx >= p.x && cx < p.x + p.w && cy >= p.y && cy < p.y + p.h).toBe(true); // the building stands on its plot
      for (const view of SCREENS) {
        const top = 100;
        const bottom = 44;
        const { start } = mapLimits(view, top, bottom);
        // Pan so the sign is centred in the visible band (clamped like a real drag), at the start zoom.
        const bandMid = top + (view.h - top - bottom) / 2;
        const c = clampCamera({ zoom: start, tx: view.w / 2 - s.x * start, ty: bandMid - s.y * start }, view);
        const r = screenBox(s, c);
        expect(r.x0).toBeGreaterThanOrEqual(0);
        expect(r.x1).toBeLessThanOrEqual(view.w);
        expect(r.y0).toBeGreaterThanOrEqual(top);
        expect(r.y1).toBeLessThanOrEqual(view.h - bottom);
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
      const r = screenBox(s, camera);
      expect(r.y0, s.key).toBeGreaterThanOrEqual(top);
      expect(r.y1, s.key).toBeLessThanOrEqual(view.h - bottom);
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

  // Signs scale with the map, so neighbours clear each other at every zoom when they do in world px.
  function overlaps(padlocks: boolean): string[] {
    const out: string[] = [];
    for (let i = 0; i < SIGNS.length; i++) {
      for (let j = i + 1; j < SIGNS.length; j++) {
        const a = boxOf(SIGNS[i], padlocks);
        const b = boxOf(SIGNS[j], padlocks);
        // The badge hangs under its sign too.
        const aY1 = a.y1 + BADGE_BELOW * SIGN_SCALE;
        const bY1 = b.y1 + BADGE_BELOW * SIGN_SCALE;
        const apart = a.x1 <= b.x0 || b.x1 <= a.x0 || aY1 <= b.y0 || bY1 <= a.y0;
        if (!apart) out.push(`${SIGNS[i].key}/${SIGNS[j].key}`);
      }
    }
    return out;
  }

  it('no two built signs overlap (world px, so on every phone and zoom)', () => {
    expect(overlaps(false)).toEqual([]);
  });

  it('no two signs overlap with padlocks (a new save)', () => {
    expect(overlaps(true)).toEqual([]);
  });

  // iOS rasterises text at its layout size: the bitmap must only ever be scaled down (sign scale × zoom <= layout scale).
  it.each(SCREENS)('on $w×$h a sign (and its badge) is laid out big enough to stay crisp at the maximum zoom', (view) => {
    const { maxZoom } = mapLimits(view, 100, 44);
    expect(SIGN_SCALE * maxZoom).toBeLessThanOrEqual(SIGN_LAYOUT_SCALE);
  });

  it.each(SCREENS)('at the start zoom on $w×$h a sign label is at least 13 pt and its tap area at least 44 pt', (view) => {
    const { start } = mapLimits(view, 100, 44);
    expect(SIGN_LABEL_PT * SIGN_SCALE * start).toBeGreaterThanOrEqual(13);
    expect(SIGN_TOUCH_H * SIGN_SCALE * start).toBeGreaterThanOrEqual(44); // the wrappers contain the slop, so this is the real tap height
  });
});
