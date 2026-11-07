// The one drag-hold constant of the app (owner decision 2026-11-07). Every "hold, then drag" gesture (the Potion Belt panel today; bag
// reordering and drag-to-equip later) uses it, so the feel is tuned in one place.

/**
 * How long a finger must rest on a draggable thing before the drag starts, ms (Gesture Handler Pan `activateAfterLongPress`). Lists scroll,
 * so a drag that started on any movement would fight the scroll: with a hold, moving more than ~10 pt BEFORE the delay fails the pan
 * (native, both platforms) and the list scrolls as usual; after the hold the pan is active and the item follows the finger. A tap still
 * selects. 0.1 s: quick enough to feel like "pick up"; a scroll swipe moves at once and never reaches it.
 */
export const DRAG_HOLD_MS = 100;
