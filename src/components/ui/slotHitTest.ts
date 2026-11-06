// Pure hit-testing behind "tap another item while a popover is open" (unit-tested in tests/slotHitTest.test.ts).
import type { AnchorBox } from './popoverLayout';

export type Point = { x: number; y: number };
export type SlotRect<K extends string | number = string | number> = AnchorBox & { id: K };

/** Touch margin around a slot, matching the slots' own hitSlop. */
export const SLOT_HIT_SLOP = 2;

/** True when `p` is inside `r` grown by `slop` (left / top edges inclusive, right / bottom exclusive). */
export function pointInRect(p: Point, r: AnchorBox, slop = 0): boolean {
  return p.x >= r.x - slop && p.x < r.x + r.width + slop && p.y >= r.y - slop && p.y < r.y + r.height + slop;
}

/**
 * The slot under `p`, or null. `viewport` (optional) is the visible area the slots are clipped to (a ScrollView): a
 * point outside it hits nothing. When slop areas overlap, the slot whose own box contains the point wins, else the
 * nearest centre.
 */
export function hitSlot<K extends string | number>(rects: readonly SlotRect<K>[], p: Point, viewport?: AnchorBox | null, slop = SLOT_HIT_SLOP): K | null {
  if (viewport && !pointInRect(p, viewport)) return null;
  let best: K | null = null;
  let bestScore = Infinity;
  for (const r of rects) {
    if (!pointInRect(p, r, slop)) continue;
    const inside = pointInRect(p, r) ? 0 : 1e9;
    const d = Math.abs(p.x - (r.x + r.width / 2)) + Math.abs(p.y - (r.y + r.height / 2));
    if (inside + d < bestScore) {
      best = r.id;
      bestScore = inside + d;
    }
  }
  return best;
}
