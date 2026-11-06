import { describe, expect, it } from 'vitest';
import { hitSlot, pointInRect, type SlotRect } from '../src/components/ui/slotHitTest';

const r = { x: 100, y: 200, width: 52, height: 52 };

describe('pointInRect', () => {
  it('inside, outside and edges (left / top inclusive, right / bottom exclusive)', () => {
    expect(pointInRect({ x: 120, y: 220 }, r)).toBe(true);
    expect(pointInRect({ x: 100, y: 200 }, r)).toBe(true);
    expect(pointInRect({ x: 152, y: 220 }, r)).toBe(false);
    expect(pointInRect({ x: 120, y: 252 }, r)).toBe(false);
    expect(pointInRect({ x: 99, y: 220 }, r)).toBe(false);
  });
  it('slop grows every side', () => {
    expect(pointInRect({ x: 98, y: 198 }, r, 2)).toBe(true);
    expect(pointInRect({ x: 97, y: 220 }, r, 2)).toBe(false);
    expect(pointInRect({ x: 153, y: 253 }, r, 2)).toBe(true);
  });
});

describe('hitSlot', () => {
  const rects: SlotRect[] = [
    { id: 'a', x: 0, y: 0, width: 52, height: 52 },
    { id: 'b', x: 54, y: 0, width: 52, height: 52 }, // 2 pt gap: slop areas overlap
    { id: 7, x: 0, y: 60, width: 52, height: 52 },
  ];
  it('finds the slot, or null in empty space', () => {
    expect(hitSlot(rects, { x: 10, y: 10 })).toBe('a');
    expect(hitSlot(rects, { x: 80, y: 30 })).toBe('b');
    expect(hitSlot(rects, { x: 10, y: 80 })).toBe(7);
    expect(hitSlot(rects, { x: 200, y: 200 })).toBeNull();
    expect(hitSlot([], { x: 1, y: 1 })).toBeNull();
  });
  it('a point inside a box beats a neighbour whose slop reaches it', () => {
    expect(hitSlot(rects, { x: 51.5, y: 26 })).toBe('a');
    expect(hitSlot(rects, { x: 54.5, y: 26 })).toBe('b');
  });
  it('overlap in the gap goes to the nearer centre', () => {
    expect(hitSlot(rects, { x: 52.4, y: 26 })).toBe('a');
    expect(hitSlot(rects, { x: 53.6, y: 26 })).toBe('b');
  });
  it('slots clipped out of the viewport cannot be hit', () => {
    const viewport = { x: 0, y: 40, width: 400, height: 500 };
    expect(hitSlot(rects, { x: 10, y: 10 }, viewport)).toBeNull();
    expect(hitSlot(rects, { x: 10, y: 80 }, viewport)).toBe(7);
  });
});
