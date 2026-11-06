import { describe, expect, it } from 'vitest';
import { boxShown, measuredFor, placePopover } from '../src/components/ui/popoverLayout';

describe('popover measurement', () => {
  it('a measurement is valid only for the presentation it was taken for', () => {
    expect(measuredFor(null, 1)).toBeNull();
    expect(measuredFor({ key: 1, h: 120 }, 1)).toBe(120);
    expect(measuredFor({ key: 1, h: 120 }, 2)).toBeNull();
  });

  it('a new anchor never reuses the old height, with no reset step that could race', () => {
    let m = { key: 1, h: 120 };
    expect(measuredFor(m, 2)).toBeNull(); // the first render of anchor 2 already reads "unmeasured"
    m = { key: 2, h: 90 };
    expect(measuredFor(m, 2)).toBe(90);
  });

  it('the box is shown once measured or once the timeout fired, never neither', () => {
    expect(boxShown(null, null, 3)).toBe(false);
    expect(boxShown(100, null, 3)).toBe(true);
    expect(boxShown(null, 3, 3)).toBe(true);
    expect(boxShown(null, 2, 3)).toBe(false); // a timeout of an older presentation does not count
  });
});

describe('placePopover', () => {
  const win = { width: 400, height: 800 };
  const insets = { top: 40, bottom: 20, left: 0, right: 0 };
  const anchor = { x: 100, y: 300, width: 50, height: 50 };

  it('places below when it fits, above when it does not, clamped to the screen', () => {
    expect(placePopover(anchor, 200, win, insets).below).toBe(true);
    const low = placePopover({ ...anchor, y: 650 }, 300, win, insets);
    expect(low.below).toBe(false);
    expect(low.top).toBeGreaterThanOrEqual(48);
    expect(low.top + low.boxH).toBeLessThanOrEqual(772);
  });

  it('unmeasured placement picks the larger side and has height 0', () => {
    const p = placePopover(anchor, null, win, insets);
    expect(p.boxH).toBe(0);
    expect(p.below).toBe(true);
    expect(placePopover({ ...anchor, y: 650 }, null, win, insets).below).toBe(false);
  });

  it('caps the height to the room', () => {
    const p = placePopover(anchor, 5000, win, insets);
    expect(p.boxH).toBe(p.maxHeight);
    expect(p.maxHeight).toBeLessThanOrEqual(800 - 40 - 20 - 16);
  });
});
