// Lets an item grid switch an open InfoPopover to another slot in one tap. Slots register their view; the popover's
// backdrop hands the tap point to `resolve`, which measures the slots at that moment (so scrolling is accounted for)
// and returns the slot under the finger with its fresh anchor. Touch convenience only: screen-reader users close the
// popover with the close button / back.
import { type RefObject, useMemo, useRef } from 'react';
import type { HostInstance } from 'react-native';
import { type AnchorRect, measureAnchor } from './InfoPopover';
import { hitSlot, type Point } from './slotHitTest';

export type SlotHit = { id: string | number; anchor: AnchorRect };

export type SlotHitTest = {
  /** Register a slot's view under its press key; returns the unregister function. */
  register: (id: string | number, ref: RefObject<HostInstance | null>) => () => void;
  /** Ref for the scroll container that clips the slots (optional): taps outside it hit nothing. */
  viewportRef: (node: Pick<HostInstance, 'measureInWindow'> | null) => void;
  /** The slot under the window point, measured now, or null. */
  resolve: (p: Point) => Promise<SlotHit | null>;
};

export function useSlotHitTest(): SlotHitTest {
  const slots = useRef(new Map<string | number, RefObject<HostInstance | null>>());
  const viewport = useRef<Pick<HostInstance, 'measureInWindow'> | null>(null);
  return useMemo<SlotHitTest>(
    () => ({
      viewportRef: (node) => {
        viewport.current = node;
      },
      register: (id, ref) => {
        slots.current.set(id, ref);
        return () => {
          if (slots.current.get(id) === ref) slots.current.delete(id);
        };
      },
      resolve: async (p) => {
        const entries = [...slots.current.entries()];
        const [vp, ...boxes] = await Promise.all([measureAnchor(viewport.current), ...entries.map(([, ref]) => measureAnchor(ref.current))]);
        const rects = entries.flatMap(([id], i) => (boxes[i] ? [{ id, ...boxes[i]! }] : []));
        const id = hitSlot(rects, p, viewport.current ? vp : null);
        if (id === null) return null;
        const box = rects.find((r) => r.id === id)!;
        return { id, anchor: { x: box.x, y: box.y, width: box.width, height: box.height } };
      },
    }),
    [],
  );
}
