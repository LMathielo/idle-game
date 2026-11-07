// The Potion Belt button on the Village screen (bottom right, above the activity strip) covers no sign at the start framing,
// on the villageMap test phones (375x667, 390x844, 430x932 with their real insets), with a sign's badge and its tap slop counted.
import { describe, expect, it } from 'vitest';
import { BELT_BUTTON_MARGIN, BELT_BUTTON_SIZE, beltButtonBox } from '../src/components/belt/beltLayout';
import { hudBottom } from '../src/components/hud/hudLayout';
import { mapLimits, SIGN_BUTTON_H, SIGN_HIT_SLOP, SIGN_SCALE, SIGNS, signWorldBox } from '../src/components/village/villageMap';

const LABEL_W: Record<string, number> = { dungeon: 76, mine: 98, merchant: 91, woodcutting: 116, training: 72, town_hall: 80, crafting: 80, storage: 76 };
const LOCKABLE = new Set(['woodcutting', 'mine', 'town_hall', 'training', 'crafting']);
const BADGE_BELOW = 22;
/** ActivityStrip's ACTIVITY_STRIP_HEIGHT (that file imports React Native, which tests cannot load; villageMap.test.ts hardcodes it too). */
const ACTIVITY_STRIP_HEIGHT = 44;

describe('Potion Belt button layout', () => {
  it('is a 56 pt square, 8 pt from the right edge and from the strip', () => {
    const b = beltButtonBox({ w: 375, h: 618 }, ACTIVITY_STRIP_HEIGHT);
    expect(b).toEqual({ x0: 375 - 8 - 56, x1: 375 - 8, y0: 618 - 44 - 8 - 56, y1: 618 - 44 - 8 });
    expect(BELT_BUTTON_SIZE).toBeGreaterThanOrEqual(44);
    expect(BELT_BUTTON_MARGIN).toBeGreaterThan(0);
  });

  it.each([
    { w: 375, h: 667, inset: 20, bottomInset: 0 },
    { w: 390, h: 844, inset: 47, bottomInset: 34 },
    { w: 430, h: 932, inset: 59, bottomInset: 34 },
  ])('covers no core sign (badge and tap slop included) at the start view on $w×$h', ({ w, h, inset, bottomInset }) => {
    const view = { w, h: h - 49 - bottomInset };
    const { camera } = mapLimits(view, hudBottom(inset), ACTIVITY_STRIP_HEIGHT);
    const btn = beltButtonBox(view, ACTIVITY_STRIP_HEIGHT);
    for (const s of SIGNS.filter((x) => !x.plot)) {
      const nat = (LABEL_W[s.key] + 30 + (LOCKABLE.has(s.key) ? 20 : 0)) * 1.04;
      const b = signWorldBox(s, nat);
      const slop = SIGN_HIT_SLOP * SIGN_SCALE * camera.zoom;
      const box = {
        x0: camera.tx + b.x0 * camera.zoom - slop,
        x1: camera.tx + b.x1 * camera.zoom + slop,
        y0: camera.ty + b.y0 * camera.zoom - slop,
        y1: camera.ty + (b.y1 + BADGE_BELOW * SIGN_SCALE) * camera.zoom + slop,
      };
      const apart = box.x1 <= btn.x0 || btn.x1 <= box.x0 || box.y1 <= btn.y0 || btn.y1 <= box.y0;
      expect(apart, `${s.key} ${JSON.stringify(box)} vs button ${JSON.stringify(btn)}`).toBe(true);
    }
    expect(SIGN_BUTTON_H).toBeGreaterThan(0);
  });
});
