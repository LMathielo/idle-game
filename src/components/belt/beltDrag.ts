// Drag and drop on the belt panel: which slot a dragged potion is over (pure, no React Native, so a test reads it). Runs as a
// worklet on the UI thread (the Pan gesture's callbacks), in window coordinates: the slots' boxes come from measureInWindow, the
// finger from the gesture's absoluteX / absoluteY.

export type DropRect = { x: number; y: number; width: number; height: number };

/** Extra points around a slot that still count as over it (a thumb is not a pixel). */
export const DROP_SLOP = 10;

/**
 * Index of the slot box the point is over (boxes grown by `slop`), or -1. Slots are far enough apart that the first hit is the only
 * one; ties (a point in two grown boxes) go to the slot whose centre is nearer.
 */
export function slotAt(rects: readonly DropRect[], x: number, y: number, slop: number = DROP_SLOP): number {
  'worklet';
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r.width <= 0 || r.height <= 0) continue;
    if (x < r.x - slop || x > r.x + r.width + slop || y < r.y - slop || y > r.y + r.height + slop) continue;
    const dx = x - (r.x + r.width / 2);
    const dy = y - (r.y + r.height / 2);
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
