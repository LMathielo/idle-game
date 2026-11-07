// The Storage modal on the village test phones (375x667, 390x844, 430x932 with their real insets): the grids have whole columns inside the
// screen, and each section shows enough rows to use (the storage 60%, the bag 40% of the room).
import { describe, expect, it } from 'vitest';
import { BAG_FLEX, BORDER, CELL, gridColumns, SCREEN_PAD, sectionHeights, STORAGE_FLEX, visibleRows } from '../src/components/storage/storageLayout';

const PHONES = [
  { w: 375, h: 667, top: 20, bottom: 0 },
  { w: 390, h: 844, top: 47, bottom: 34 },
  { w: 430, h: 932, top: 59, bottom: 34 },
];

describe('Storage modal layout', () => {
  it.each(PHONES)('has whole columns inside the screen on $w×$h', ({ w }) => {
    const cols = gridColumns(w);
    expect(cols).toBeGreaterThanOrEqual(5);
    expect(cols * CELL).toBeLessThanOrEqual(w - 2 * SCREEN_PAD - 2 * BORDER);
    // The leftover is less than one cell, so the grid is centred with little slack.
    expect(w - 2 * SCREEN_PAD - 2 * BORDER - cols * CELL).toBeLessThan(CELL);
  });

  it.each(PHONES)('splits the room 60 / 40 and shows 3+ storage rows and 2+ bag rows on $w×$h', ({ h, top, bottom }) => {
    const s = sectionHeights(h, top, bottom);
    expect(s.storage / (s.storage + s.bag)).toBeCloseTo(STORAGE_FLEX / (STORAGE_FLEX + BAG_FLEX), 5);
    expect(visibleRows(s.storage)).toBeGreaterThanOrEqual(3);
    expect(visibleRows(s.bag)).toBeGreaterThanOrEqual(2);
  });

  it('shows 5 columns on the smallest phone and 6 on the others', () => {
    expect(PHONES.map((p) => gridColumns(p.w))).toEqual([5, 6, 6]);
  });
});
