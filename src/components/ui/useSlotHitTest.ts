// Lets an item grid switch an open InfoPopover to another slot in one tap. Slots register their view; while a popover
// is open the hook keeps a cache of every slot's window rect (and the scroll viewport that clips them), measured when
// the popover opens / switches and again whenever the registered set changes (a buy / sell / equip changed the grid).
// The Modal blocks scrolling, so the cached rects stay valid while it is up. The popover's backdrop hands the tap point
// to `press`, which decides close vs switch synchronously from the cache (no await, so a dismiss starts at once); only
// when the cache is missing or stale does it measure at tap time. Touch convenience only: screen-reader users close
// the popover with the close button / back.
import { type RefObject, useEffect, useMemo, useRef } from 'react';
import { type HostInstance, useWindowDimensions } from 'react-native';
import { type AnchorRect, measureAnchor } from './InfoPopover';
import { hitSlot, type Point, type SlotRect } from './slotHitTest';

export type SlotHit = { id: string | number; anchor: AnchorRect };

export type SlotHitTest = {
  /** Register a slot's view under its press key; returns the unregister function. */
  register: (id: string | number, ref: RefObject<HostInstance | null>) => () => void;
  /** Ref for the scroll container that clips the slots (optional): taps outside it hit nothing. */
  viewportRef: (node: Pick<HostInstance, 'measureInWindow'> | null) => void;
  /**
   * What to do with a backdrop tap: finds the slot under `p` and calls `apply` with it (true = the caller moved the
   * popover there). Synchronous when the cache is fresh, else a promise after measuring. No slot = false (close).
   */
  press: (p: Point, apply: (hit: SlotHit) => boolean) => boolean | Promise<boolean>;
};

type Cache = { rects: SlotRect[]; viewport: AnchorRect | null | undefined };

/** Window rects of all slots plus the viewport (undefined = none registered, null = it could not be measured). */
async function measureAll(slots: Map<string | number, RefObject<HostInstance | null>>, viewport: Pick<HostInstance, 'measureInWindow'> | null): Promise<Cache> {
  const entries = [...slots.entries()];
  const [vp, ...boxes] = await Promise.all([measureAnchor(viewport), ...entries.map(([, ref]) => measureAnchor(ref.current))]);
  const rects = entries.flatMap(([id], i) => (boxes[i] ? [{ id, ...boxes[i]! }] : []));
  return { rects, viewport: viewport ? (vp && vp.width > 0 && vp.height > 0 ? vp : null) : undefined };
}

function toHit(c: Cache, p: Point): SlotHit | null {
  const id = hitSlot(c.rects, p, c.viewport);
  if (id === null) return null;
  const { x, y, width, height } = c.rects.find((r) => r.id === id)!;
  return { id, anchor: { x, y, width, height } };
}

/** Wait this long after a registration change before re-measuring (a grid re-registers many slots in one commit). */
const REMEASURE_MS = 32;

/**
 * `openToken`: any value that is non-null while the popover is open and changes when it moves to another slot
 * (e.g. the selection object). Must be null while closed.
 */
export function useSlotHitTest(openToken: unknown): SlotHitTest {
  const win = useWindowDimensions();
  const slots = useRef(new Map<string | number, RefObject<HostInstance | null>>());
  const viewport = useRef<Pick<HostInstance, 'measureInWindow'> | null>(null);
  const cache = useRef<Cache | null>(null);
  const gen = useRef(0); // bumped when the cache is invalidated: a measure started before that is dropped
  const open = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const api = useMemo(() => {
    const measure = async (): Promise<Cache> => {
      const g = gen.current;
      const c = await measureAll(slots.current, viewport.current);
      if (g === gen.current && open.current) cache.current = c;
      return c;
    };
    const schedule = (ms: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        if (open.current) void measure();
      }, ms);
    };
    const invalidate = () => {
      gen.current++;
      cache.current = null;
      if (open.current) schedule(REMEASURE_MS);
    };
    const hitTest: SlotHitTest & { schedule: typeof schedule; invalidate: typeof invalidate; close: () => void } = {
      viewportRef: (node) => {
        viewport.current = node;
      },
      register: (id, ref) => {
        slots.current.set(id, ref);
        invalidate();
        return () => {
          if (slots.current.get(id) === ref) {
            slots.current.delete(id);
            invalidate();
          }
        };
      },
      press: (p, apply) => {
        const c = cache.current;
        if (c) {
          const hit = toHit(c, p);
          return hit !== null && apply(hit);
        }
        return measure().then((m) => {
          const hit = toHit(m, p);
          return hit !== null && apply(hit);
        });
      },
      schedule,
      invalidate,
      close: () => {
        gen.current++;
        cache.current = null;
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
      },
    };
    return hitTest;
  }, []);

  // Popover opened / moved to another slot (or the window changed size): measure now. Closed: drop the cache (the grid
  // may scroll while no Modal blocks it).
  useEffect(() => {
    open.current = openToken != null;
    if (openToken == null) {
      api.close();
      return;
    }
    api.schedule(0);
  }, [openToken, win.width, win.height, api]);
  useEffect(() => {
    api.invalidate();
  }, [win.width, win.height, api]);
  useEffect(() => () => api.close(), [api]);

  return api;
}
