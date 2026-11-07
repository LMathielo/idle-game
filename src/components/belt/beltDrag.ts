// Drag and drop on the belt panel: which slot a dragged potion is over (pure, no React Native, so a test reads it). Runs as a
// worklet on the UI thread (the Pan gesture's callbacks), in window coordinates: the slots' boxes come from measureInWindow, the
// finger from the gesture's absoluteX / absoluteY.
//
// WORKLET RULE (this file crashed the app once): the worklet plugin hands the function a `this.__closure` that is destructured as the
// FIRST statement of the BODY, so a closure variable used in a PARAMETER DEFAULT (`slop = DROP_SLOP`) is read before it exists and
// throws "Property 'DROP_SLOP' doesn't exist" on the UI runtime (fatal in Expo Go) while the same code runs fine on the JS thread and
// in Vitest. Use outer constants only inside the body. tests/workletRuntime.test.ts runs the compiled worklets the way the UI runtime
// does and fails on any default parameter that reads a closure variable.

export type DropRect = { x: number; y: number; width: number; height: number };

/** Extra points around a slot that still count as over it (a thumb is not a pixel). */
export const DROP_SLOP = 10;

/**
 * Index of the slot box the point is over (boxes grown by `slop`), or -1. Slots are far enough apart that the first hit is the only
 * one; ties (a point in two grown boxes) go to the slot whose centre is nearer.
 */
export function slotAt(rects: readonly DropRect[], x: number, y: number, slop?: number): number {
  'worklet';
  const grow = slop === undefined ? DROP_SLOP : slop; // not `slop = DROP_SLOP` in the parameter list: see the WORKLET RULE above
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (r.width <= 0 || r.height <= 0) continue;
    if (x < r.x - grow || x > r.x + r.width + grow || y < r.y - grow || y > r.y + r.height + grow) continue;
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
