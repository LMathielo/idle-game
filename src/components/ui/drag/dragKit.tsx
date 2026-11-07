// The drag kit shared by the Potion Belt panel and the Hero tab (owner decision 2026-11-07: one drag, tuned in one place).
//
// A SURFACE (`useDragSurface`) is the screen's drag state, all on the UI thread (Reanimated shared values): the drop boxes' window rects,
// which boxes accept the thing in hand (`allowed`), the box under the finger (`hover`), the finger, the ghost's opacity and the source box.
// A screen registers its drop boxes by index (`setTarget`), measures them when a drag starts (never per frame), and mounts one `DragGhost`.
// A SOURCE (`useDragSource` / `DragSource`) is a Gesture Handler pan that activates after DRAG_HOLD_MS: a swipe that moves before the hold
// fails the pan and the list scrolls as usual. On release, a drop on a box that accepts it calls `onDrop(id, box)` (one scheduleOnRN), a
// release that barely moved calls `onTap` (the hold swallowed the tap: the active pan cancels the touchable's press), anything else sends
// the ghost back to its box and fades it (springs back). The kit decides nothing about rules: the screen says which boxes accept (`allowed`)
// and runs the drop (for the Hero tab, `dropCommand` in the engine and the logged commands).
//
// Nothing here re-renders a screen when a drag starts or ends (the ghost's icon is state of its own small component, set through a ref), and
// each source's gesture config is memoized, so it is never re-created while a finger is on it.
//
// WORKLET RULE (this crashed the belt drag once, tests/workletRuntime.test.ts guards it): inside a worklet only the BODY may read outer
// variables, never a parameter default (`f(x, s = OUTER)`); see ui/drag/dropTargets.ts.
import { type MutableRefObject, memo, type ReactElement, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type HostInstance, StyleSheet } from 'react-native';
import { GestureDetector, type PanGestureConfig, usePanGesture } from 'react-native-gesture-handler';
import Animated, { type SharedValue, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { colors } from '../../../theme';
import { ItemIcon } from '../../art/Sprites';
import { DRAG_HOLD_MS } from '../dragHold';
import { measureAnchor } from '../InfoPopover';
import { type DropRect, slotAt, TAP_SLOP_SQ } from './dropTargets';

export const GHOST_SIZE = 44;
const NO_RECT: DropRect = { x: 0, y: 0, width: 0, height: 0 };
/** The ghost flying home and fading after a drop that does nothing, ms. */
const SPRING_BACK = { duration: 160 };

export type DragSurface = {
  /** The layer the ghost lives in (absolutely positioned over the screen): its window origin places the ghost. */
  layerRef: RefObject<HostInstance | null>;
  /** Registers (node) or unregisters (null) drop box `index`. Boxes that are not mounted have no rect and never match. */
  setTarget: (index: number, node: HostInstance | null) => void;
  /** Measures the layer and every registered box. Call when a drag starts and when the layout moved under it. */
  measure: () => void;
  /** Sets the ghost's icon (an item's defId; null = none). */
  ghostIcon: MutableRefObject<((defId: string | null) => void) | null>;
  ghostStyle: ReturnType<typeof useAnimatedStyle>;
  /** Window rects of the drop boxes, by index (no rect = zero size). */
  rects: SharedValue<DropRect[]>;
  /** 1 where the box accepts what is in hand, by index. The screen sets it when a drag starts. */
  allowed: SharedValue<number[]>;
  /** The box under the finger that accepts the drag, or -1. */
  hover: SharedValue<number>;
  /** The box the drag came from (dimmed), or -1. */
  sourceIndex: SharedValue<number>;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  downX: SharedValue<number>;
  downY: SharedValue<number>;
  originX: SharedValue<number>;
  originY: SharedValue<number>;
  ghostOn: SharedValue<number>;
};

/** `count` drop boxes. `allowAll`: every box accepts until the screen says otherwise (the belt's four slots). */
export function useDragSurface(count: number, allowAll = false): DragSurface {
  const rects = useSharedValue<DropRect[]>(Array.from({ length: count }, () => NO_RECT));
  const allowed = useSharedValue<number[]>(Array.from({ length: count }, () => (allowAll ? 1 : 0)));
  const hover = useSharedValue(-1);
  const sourceIndex = useSharedValue(-1);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const downX = useSharedValue(0);
  const downY = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const ghostOn = useSharedValue(0);
  const layerRef = useRef<HostInstance | null>(null);
  const targets = useRef<(HostInstance | null)[]>([]);
  const ghostIcon = useRef<((defId: string | null) => void) | null>(null);
  const countRef = useRef(count);
  countRef.current = count;

  const setTarget = useCallback((index: number, node: HostInstance | null) => {
    targets.current[index] = node;
  }, []);
  const measure = useCallback(() => {
    const n = countRef.current;
    void Promise.all([measureAnchor(layerRef.current), ...Array.from({ length: n }, (_, i) => measureAnchor(targets.current[i]))]).then(([layer, ...boxes]) => {
      if (layer) {
        originX.set(layer.x);
        originY.set(layer.y);
      }
      rects.set(boxes.map((b) => (b ? { x: b.x, y: b.y, width: b.width, height: b.height } : NO_RECT)));
    });
  }, [originX, originY, rects]);
  const ghostStyle = useAnimatedStyle(() => ({
    opacity: ghostOn.get(),
    transform: [{ translateX: dragX.get() - originX.get() - GHOST_SIZE / 2 }, { translateY: dragY.get() - originY.get() - GHOST_SIZE / 2 }],
  }));

  return useMemo(
    () => ({ layerRef, setTarget, measure, ghostIcon, ghostStyle, rects, allowed, hover, sourceIndex, dragX, dragY, downX, downY, originX, originY, ghostOn }),
    [setTarget, measure, ghostStyle, rects, allowed, hover, sourceIndex, dragX, dragY, downX, downY, originX, originY, ghostOn],
  );
}

/**
 * The icon inside the ghost. Its own state, so starting / ending a drag re-renders this and nothing else. The icon is dropped once the ghost
 * is fully hidden (after a spring-back's fade too), so the next drag never flashes the previous item.
 */
function GhostIcon({ setter, ghostOn }: { setter: MutableRefObject<((defId: string | null) => void) | null>; ghostOn: SharedValue<number> }) {
  const [defId, setDefId] = useState<string | null>(null);
  useEffect(() => {
    setter.current = setDefId;
    return () => {
      setter.current = null;
    };
  }, [setter]);
  useAnimatedReaction(
    () => ghostOn.get() === 0,
    (hidden, wasHidden) => {
      if (hidden && !wasHidden) scheduleOnRN(setDefId, null);
    },
  );
  return defId ? <ItemIcon defId={defId} size={36} /> : null;
}

/** The ghost that follows the finger (UI thread). Mount it last in the layer that `surface.layerRef` points at. */
export function DragGhost({ surface }: { surface: DragSurface }) {
  return (
    <Animated.View style={[styles.ghost, surface.ghostStyle]} pointerEvents="none">
      <GhostIcon setter={surface.ghostIcon} ghostOn={surface.ghostOn} />
    </Animated.View>
  );
}

/**
 * Fills a drop box (put it inside the box's view, last): a gold frame while the finger is over it with something it accepts, dimmed while
 * the drag came from this box.
 */
export const DropHighlight = memo(function DropHighlight({ surface, index }: { surface: DragSurface; index: number }) {
  const { hover, sourceIndex } = surface;
  const style = useAnimatedStyle(() => {
    const over = hover.get() === index;
    const from = sourceIndex.get() === index;
    return {
      borderColor: over ? colors.gold : 'transparent',
      backgroundColor: from ? 'rgba(10, 6, 3, 0.6)' : over ? 'rgba(232, 200, 114, 0.22)' : 'transparent',
    };
  });
  return <Animated.View pointerEvents="none" style={[styles.highlight, style]} />;
});

export type DragSourceSpec = {
  /** Handed back to onStart / onDrop (an item id). */
  id: string;
  /** The ghost's icon (an item's defId). */
  icon: string;
  /** The source's own drop box (dimmed while dragging, where a refused drop flies home), or -1. */
  index: number;
  /** A drag began. Stable across renders (a ref-backed callback), or the gesture is re-created. */
  onStart: (id: string, icon: string) => void;
  /** Let go over box `target`, which accepts the drag. */
  onDrop: (id: string, target: number) => void;
  /** The hold was released without moving: the tap the hold swallowed. */
  onTap?: () => void;
  /** The finger is up (after onDrop / onTap, or a refused drop). */
  onEnd?: () => void;
};

/** The callbacks a screen shares between all its sources (stable, so memoized slots stay memoized). */
export type DragHandlers = Pick<DragSourceSpec, 'onStart' | 'onDrop' | 'onEnd'>;

/** The pan that makes something draggable: hold DRAG_HOLD_MS, then drag. */
export function useDragSource(surface: DragSurface, spec: DragSourceSpec) {
  const { rects, allowed, hover, sourceIndex, dragX, dragY, downX, downY, ghostOn } = surface;
  const { id, icon, index, onStart, onDrop, onTap, onEnd } = spec;
  const reduceMotion = useReducedMotion();
  // Memoized: a new config object would re-create the gesture, also under a finger. The callbacks are worklets by their own directive (the
  // plugin only auto-workletizes an inline config).
  const config = useMemo<PanGestureConfig>(
    () => ({
      // Hold, then drag: a swipe that moves before the hold fails the pan and scrolls the list instead.
      activateAfterLongPress: DRAG_HOLD_MS,
      onActivate: (e) => {
        'worklet';
        dragX.set(e.absoluteX);
        dragY.set(e.absoluteY);
        downX.set(e.absoluteX);
        downY.set(e.absoluteY);
        sourceIndex.set(index);
        ghostOn.set(1);
        scheduleOnRN(onStart, id, icon);
      },
      onUpdate: (e) => {
        'worklet';
        dragX.set(e.absoluteX);
        dragY.set(e.absoluteY);
        const over = slotAt(rects.get(), e.absoluteX, e.absoluteY);
        hover.set(over >= 0 && allowed.get()[over] === 1 ? over : -1);
      },
      onDeactivate: (e) => {
        'worklet';
        const dx = e.absoluteX - downX.get();
        const dy = e.absoluteY - downY.get();
        if (!e.canceled && dx * dx + dy * dy <= TAP_SLOP_SQ) {
          ghostOn.set(0);
          if (onTap) scheduleOnRN(onTap);
          return;
        }
        const over = e.canceled ? -1 : slotAt(rects.get(), e.absoluteX, e.absoluteY);
        if (over >= 0 && allowed.get()[over] === 1) {
          ghostOn.set(0);
          scheduleOnRN(onDrop, id, over);
          return;
        }
        // Nothing accepts it here: the ghost flies back to its box and fades (no motion: it just goes).
        const home = index >= 0 ? rects.get()[index] : undefined;
        if (home && home.width > 0 && !reduceMotion) {
          dragX.set(withTiming(home.x + home.width / 2, SPRING_BACK));
          dragY.set(withTiming(home.y + home.height / 2, SPRING_BACK));
          ghostOn.set(withTiming(0, SPRING_BACK));
        } else {
          ghostOn.set(0);
        }
      },
      onFinalize: () => {
        'worklet';
        hover.set(-1);
        sourceIndex.set(-1);
        if (onEnd) scheduleOnRN(onEnd);
      },
    }),
    [id, icon, index, onStart, onDrop, onTap, onEnd, reduceMotion, rects, allowed, hover, sourceIndex, dragX, dragY, downX, downY, ghostOn],
  );
  return usePanGesture(config);
}

/** Makes its one child (a Pressable) a drag source. */
export function DragSource({ surface, spec, children }: { surface: DragSurface; spec: DragSourceSpec; children: ReactElement }) {
  const pan = useDragSource(surface, spec);
  return <GestureDetector gesture={pan}>{children}</GestureDetector>;
}

const styles = StyleSheet.create({
  ghost: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: GHOST_SIZE,
    height: GHOST_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.woodDark,
    borderWidth: 3,
    borderColor: colors.gold,
    zIndex: 30,
    elevation: 30,
  },
  highlight: { position: 'absolute', left: -3, top: -3, right: -3, bottom: -3, borderWidth: 3 },
});
