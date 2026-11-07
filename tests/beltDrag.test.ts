// The belt panel's drop target: which slot box a dragged potion is over (pure, window coordinates).
import { describe, expect, it } from 'vitest';
import { DROP_SLOP, type DropRect, slotAt } from '../src/components/belt/beltDrag';

const rects: DropRect[] = [0, 1, 2, 3].map((i) => ({ x: 20 + i * 80, y: 100, width: 64, height: 64 }));

describe('slotAt', () => {
  it('finds the slot under the finger', () => {
    expect(slotAt(rects, 50, 130)).toBe(0);
    expect(slotAt(rects, 120, 110)).toBe(1);
    expect(slotAt(rects, 300, 160)).toBe(3);
  });

  it('counts a margin around a slot, and nothing beyond it', () => {
    expect(slotAt(rects, 20 - DROP_SLOP, 100 - DROP_SLOP)).toBe(0);
    expect(slotAt(rects, 20 - DROP_SLOP - 1, 130)).toBe(-1);
    expect(slotAt(rects, 50, 164 + DROP_SLOP + 1)).toBe(-1);
    expect(slotAt(rects, 50, 130, 0)).toBe(0);
    expect(slotAt(rects, 85, 130, 0)).toBe(-1); // the gap between slots 0 and 1, no margin
  });

  it('the nearer centre wins when the margins overlap; unmeasured boxes never match', () => {
    // Gap between slot 0 (ends at 84) and slot 1 (starts at 100): x = 91 is inside both grown boxes.
    expect(slotAt(rects, 88, 130)).toBe(0);
    expect(slotAt(rects, 96, 130)).toBe(1);
    expect(slotAt([{ x: 0, y: 0, width: 0, height: 0 }], 0, 0)).toBe(-1);
    expect(slotAt([], 10, 10)).toBe(-1);
  });
});
