// The Potion Belt panel: an overlay the host screen mounts over its own content (not a native Modal, so GameDialog and
// InfoPopover, which are Modals owned by the screen, still present on top of it, on the Village and over the Dungeon's
// full-screen modal alike). Four belt slots on top, the bag's potions below.
//
// Filling a slot: HOLD a potion in the list, then DRAG it onto a slot (Gesture Handler pan that activates after a short hold, so a
// scroll swipe in the list never starts a drag; Reanimated shared values, all on the UI thread: the ghost follows the finger, the slot
// under it lights up, one scheduleOnRN on release), or TAP a potion and then a slot.
// Nothing here re-renders the panel when a drag starts or ends (the ghost's icon is state of its own small component, set through a ref),
// and each row's gesture config is memoized, so the gesture is never re-created while a finger is on it.
// Tapping a filled slot opens its InfoPopover: the three rules (the current one marked) and Remove (back to the bag).
// While a potion's cooldown group is cooling down (after a drink of any potion of it) its seconds count down in green over its slots and in the bag list; the
// seconds come from the engine's clock the client ticks every second.
import { type MutableRefObject, memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, type HostInstance, type LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView, type PanGestureConfig, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useGameState } from '../../client/GameProvider';
import { type BagPotionView, BELT_RULE_IDS, BELT_RULES, type BeltRule, type BeltSlotView, bagPotions, beltView } from '../../engine';
import { colors, fonts } from '../../theme';
import { GameIcon, ItemIcon } from '../art/Sprites';
import { formatQty } from '../format';
import { PixelButton } from '../PixelButton';
import { type AnchorRect, InfoPopover, measureAnchor, POPOVER_GOOD, PopoverActions, PopoverRow, PopoverText } from '../ui/InfoPopover';
import { DRAG_HOLD_MS } from '../ui/dragHold';
import { useCommand } from '../ui/useCommand';
import { type DropRect, slotAt } from './beltDrag';

/** Whole seconds left of a cooldown (rounded up, so "1s" shows until it is over). */
export const cooldownSeconds = (ms: number) => Math.ceil(ms / 1000);

const SLOT_SIZE = 64;
const GHOST_SIZE = 44;
const NO_RECT: DropRect = { x: 0, y: 0, width: 0, height: 0 };

type Props = {
  onClose: () => void;
  /** Room kept free at the bottom (the Village's activity strip floats there). */
  bottomReserve?: number;
};

export function BeltPanel({ onClose, bottomReserve = 0 }: Props) {
  const state = useGameState();
  const { send } = useCommand();
  const belt = beltView(state);
  const bag = bagPotions(state);

  // The belt cannot be managed unless worn: close if it is taken off meanwhile.
  useEffect(() => {
    if (!belt.equipped) onClose();
  }, [belt.equipped, onClose]);
  // Android back closes the panel first (registered after the screen's own handlers, so it runs before them).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = bag.find((p) => p.itemId === selectedId) ?? null; // gone from the bag (all moved): no selection
  const [menu, setMenu] = useState<{ slot: number; anchor: AnchorRect } | null>(null);
  /** Sets the ghost's icon (a potion's defId, null = none): owned by GhostIcon so a drag start / end re-renders only that. */
  const ghostIcon = useRef<((defId: string | null) => void) | null>(null);

  // ---- drag state, all on the UI thread ----
  const slotRects = useSharedValue<DropRect[]>([NO_RECT, NO_RECT, NO_RECT, NO_RECT]);
  const originX = useSharedValue(0); // the overlay root's window origin, to place the ghost
  const originY = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const ghostOn = useSharedValue(0);
  const hover = useSharedValue(-1);

  const rootRef = useRef<HostInstance>(null);
  const slotRefs = useRef<(HostInstance | null)[]>([null, null, null, null]);
  const measure = useCallback(() => {
    void Promise.all([measureAnchor(rootRef.current), ...slotRefs.current.map((r) => measureAnchor(r))]).then(([root, ...rects]) => {
      if (root) {
        originX.set(root.x);
        originY.set(root.y);
      }
      slotRects.set(rects.map((r) => (r ? { x: r.x, y: r.y, width: r.width, height: r.height } : NO_RECT)));
    });
  }, [originX, originY, slotRects]);
  // Boxes are measured once laid out (and again when a drag starts), never per frame.
  const onLayout = useCallback(
    (_e: LayoutChangeEvent) => {
      requestAnimationFrame(measure);
    },
    [measure],
  );

  const put = useCallback(
    (itemId: string, slot: number) => {
      void send({ type: 'BELT_PUT', itemId, slot });
    },
    [send],
  );
  const startDrag = useCallback(
    (defId: string) => {
      ghostIcon.current?.(defId);
      setMenu(null); // no-op (no render) unless a slot's popover is open
      measure();
    },
    [measure],
  );
  const endDrag = useCallback(() => ghostIcon.current?.(null), []);
  const drop = useCallback(
    (itemId: string, slot: number) => {
      ghostIcon.current?.(null);
      put(itemId, slot);
    },
    [put],
  );

  const onSlotPress = useCallback(
    (slot: number, anchor: AnchorRect) => {
      if (selected) {
        put(selected.itemId, slot);
        return;
      }
      if (belt.slots[slot]?.defId) setMenu({ slot, anchor });
    },
    [belt.slots, put, selected],
  );

  const ghostStyle = useAnimatedStyle(() => ({
    opacity: ghostOn.get(),
    transform: [{ translateX: dragX.get() - originX.get() - GHOST_SIZE / 2 }, { translateY: dragY.get() - originY.get() - GHOST_SIZE / 2 }],
  }));

  const hint = selected ? `Tap a slot to put ${selected.name} there.` : 'Hold a potion and drag it onto a slot, or tap a potion and then a slot. Tap a filled slot to change its rule or remove it.';

  return (
    <GestureHandlerRootView style={styles.fill} pointerEvents="box-none">
      <View ref={rootRef} style={styles.fill} onLayout={onLayout} collapsable={false}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the potion belt" />
        <View style={[styles.panel, { bottom: bottomReserve + 12 }]} accessibilityViewIsModal>
          <View style={styles.head}>
            <View style={styles.headText}>
              <Text style={styles.title} accessibilityRole="header">
                Potion Belt
              </Text>
              <Text style={styles.subtitle}>
                {belt.total} {belt.total === 1 ? 'potion' : 'potions'} · up to {belt.maxPerSlot} per slot
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close the potion belt" hitSlop={8}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.slots}>
            {belt.slots.map((s) => (
              <BeltSlotCell
                key={s.index}
                slot={s}
                maxPerSlot={belt.maxPerSlot}
                hover={hover}
                armed={!!selected}
                onPress={onSlotPress}
                setRef={(node) => {
                  slotRefs.current[s.index] = node;
                }}
              />
            ))}
          </View>

          <Text style={styles.hint}>{hint}</Text>

          <Text style={styles.section}>In your bag</Text>
          <ScrollView style={styles.bagScroll} contentContainerStyle={styles.bag}>
            {bag.length === 0 ? (
              <Text style={styles.empty}>No potions in your bag.</Text>
            ) : (
              bag.map((p) => (
                <BagRow
                  key={p.itemId}
                  potion={p}
                  selected={p.itemId === selected?.itemId}
                  onSelect={setSelectedId}
                  ghostOn={ghostOn}
                  dragX={dragX}
                  dragY={dragY}
                  hover={hover}
                  slotRects={slotRects}
                  startDrag={startDrag}
                  endDrag={endDrag}
                  drop={drop}
                />
              ))
            )}
          </ScrollView>
        </View>

        {/* The ghost that follows the finger (UI thread). */}
        <Animated.View style={[styles.ghost, ghostStyle]} pointerEvents="none">
          <GhostIcon setter={ghostIcon} />
        </Animated.View>
      </View>

      <SlotMenu menu={menu} slotView={menu ? belt.slots[menu.slot] : null} maxPerSlot={belt.maxPerSlot} onClose={() => setMenu(null)} />
    </GestureHandlerRootView>
  );
}

/** The icon inside the drag ghost. Its own state, so starting / ending a drag re-renders this and nothing else. */
function GhostIcon({ setter }: { setter: MutableRefObject<((defId: string | null) => void) | null> }) {
  const [defId, setDefId] = useState<string | null>(null);
  useEffect(() => {
    setter.current = setDefId;
    return () => {
      setter.current = null;
    };
  }, [setter]);
  return defId ? <ItemIcon defId={defId} size={36} /> : null;
}

// ---------- belt slot ----------

type SlotProps = {
  slot: BeltSlotView;
  maxPerSlot: number;
  hover: { get: () => number };
  /** A bag potion is selected: a tap on any slot puts it there. */
  armed: boolean;
  onPress: (slot: number, anchor: AnchorRect) => void;
  setRef: (node: HostInstance | null) => void;
};

function BeltSlotCell({ slot, maxPerSlot, hover, armed, onPress, setRef }: SlotProps) {
  const ref = useRef<HostInstance | null>(null);
  const filled = slot.defId !== null;
  const secs = cooldownSeconds(slot.cooldownLeftMs);
  const lit = useAnimatedStyle(() => (hover.get() === slot.index ? { borderColor: colors.gold, backgroundColor: colors.woodDark } : { borderColor: colors.slotBorder, backgroundColor: colors.slot }));
  const handle = () => {
    void measureAnchor(ref.current).then((anchor) => anchor && onPress(slot.index, anchor));
  };
  const label = filled
    ? `Slot ${slot.index + 1}, ${slot.name}, ${slot.count} of ${maxPerSlot}, ${slot.ruleLabel}${secs > 0 ? `, ${secs} seconds of cooldown left` : ''}`
    : `Slot ${slot.index + 1}, empty`;
  return (
    <View style={styles.slotCell}>
      <Pressable
        ref={(node) => {
          ref.current = node;
          setRef(node);
        }}
        onPress={handle}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={armed ? 'Puts the selected potion here' : filled ? 'Opens the slot rules' : undefined}
        collapsable={false}
      >
        <Animated.View style={[styles.slot, lit, armed && styles.slotArmed]}>
          {filled ? <ItemIcon defId={slot.defId!} size={40} style={secs > 0 ? styles.iconDim : undefined} /> : <GameIcon name="slot_potion" size={32} />}
          {filled ? <Text style={styles.qty}>{formatQty(slot.count)}</Text> : null}
          {secs > 0 ? <Text style={styles.cooldown}>{`${secs}s`}</Text> : null}
        </Animated.View>
      </Pressable>
      <Text style={styles.rule} numberOfLines={1}>
        {filled ? slot.ruleLabel : 'Empty'}
      </Text>
    </View>
  );
}

// ---------- bag row (drag source) ----------

type RowProps = {
  potion: BagPotionView;
  selected: boolean;
  onSelect: (itemId: string | null) => void;
  ghostOn: { set: (v: number) => void };
  dragX: { set: (v: number) => void };
  dragY: { set: (v: number) => void };
  hover: { set: (v: number) => void };
  slotRects: { get: () => DropRect[] };
  startDrag: (defId: string) => void;
  endDrag: () => void;
  drop: (itemId: string, slot: number) => void;
};

const BagRow = memo(function BagRow({ potion, selected, onSelect, ghostOn, dragX, dragY, hover, slotRects, startDrag, endDrag, drop }: RowProps) {
  const secs = cooldownSeconds(potion.cooldownLeftMs);
  const { itemId, defId } = potion;
  // Memoized: the cooldown counts down every second and re-renders the row, and a new config object would re-create the gesture each
  // time, also under a finger. The callbacks are worklets by their own directive (the plugin only auto-workletizes an inline config).
  const config = useMemo<PanGestureConfig>(
    () => ({
      // Hold, then drag: a swipe that moves before the hold fails the pan and scrolls the bag list instead (DRAG_HOLD_MS).
      activateAfterLongPress: DRAG_HOLD_MS,
      onActivate: (e) => {
        'worklet';
        dragX.set(e.absoluteX);
        dragY.set(e.absoluteY);
        ghostOn.set(1);
        scheduleOnRN(startDrag, defId);
      },
      onUpdate: (e) => {
        'worklet';
        dragX.set(e.absoluteX);
        dragY.set(e.absoluteY);
        hover.set(slotAt(slotRects.get(), e.absoluteX, e.absoluteY));
      },
      onDeactivate: (e) => {
        'worklet';
        const slot = e.canceled ? -1 : slotAt(slotRects.get(), e.absoluteX, e.absoluteY);
        if (slot >= 0) scheduleOnRN(drop, itemId, slot);
      },
      onFinalize: () => {
        'worklet';
        ghostOn.set(0);
        hover.set(-1);
        scheduleOnRN(endDrag);
      },
    }),
    [defId, itemId, dragX, dragY, ghostOn, hover, slotRects, startDrag, endDrag, drop],
  );
  const pan = usePanGesture(config);
  return (
    <GestureDetector gesture={pan}>
      <Pressable
        onPress={() => onSelect(selected ? null : itemId)}
        style={[styles.row, selected && styles.rowSelected]}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${potion.name}, ${potion.quantity} in your bag${secs > 0 ? `, ${secs} seconds of cooldown left` : ''}`}
        accessibilityHint="Select, then tap a belt slot. Or hold it and drag it onto a slot"
      >
        <View style={styles.rowIcon}>
          <ItemIcon defId={defId} size={36} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={1}>
            {potion.name}
          </Text>
          <Text style={styles.rowQty}>{`x${formatQty(potion.quantity)} in your bag`}</Text>
        </View>
        {secs > 0 ? <Text style={styles.rowCooldown}>{`${secs}s`}</Text> : null}
      </Pressable>
    </GestureDetector>
  );
});

// ---------- the filled slot's popover ----------

function SlotMenu({ menu, slotView, maxPerSlot, onClose }: { menu: { slot: number; anchor: AnchorRect } | null; slotView: BeltSlotView | null; maxPerSlot: number; onClose: () => void }) {
  const { send } = useCommand();
  // Emptied meanwhile (e.g. removed): nothing to show, the popover fades out.
  const open = menu !== null && slotView !== null && slotView.defId !== null;
  const secs = slotView ? cooldownSeconds(slotView.cooldownLeftMs) : 0;
  const setRule = (rule: BeltRule) => {
    if (!menu) return;
    void send({ type: 'BELT_SET_RULE', slot: menu.slot, rule }).then((ok) => ok && onClose());
  };
  const remove = () => {
    if (!menu) return;
    void send({ type: 'BELT_TAKE', slot: menu.slot }).then((ok) => ok && onClose());
  };
  let body: ReactNode = null;
  if (open && slotView && menu) {
    const current = slotView.rule;
    body = (
      <>
        <PopoverText tone="note">{current ? BELT_RULES[current].description : ''}</PopoverText>
        <PopoverRow label="Cooldown" value={secs > 0 ? `${secs}s` : 'Ready'} valueColor={secs > 0 ? POPOVER_GOOD : undefined} />
        {BELT_RULE_IDS.map((id) => (
          <PopoverActions key={id}>
            <PixelButton label={BELT_RULES[id].label} active={current === id} stretch onPress={() => setRule(id)} accessibilityLabel={`Rule: ${BELT_RULES[id].label}${current === id ? ', current' : ''}`} />
          </PopoverActions>
        ))}
        <PopoverActions>
          <PixelButton label="Remove" sublabel="Back to your bag" stretch onPress={remove} accessibilityLabel={`Remove ${slotView.name} from the belt`} />
        </PopoverActions>
      </>
    );
  }
  return (
    <InfoPopover
      anchor={open && menu ? menu.anchor : null}
      onClose={onClose}
      title={slotView?.name ?? ''}
      icon={slotView?.defId ? <ItemIcon defId={slotView.defId} /> : undefined}
      subtitle={slotView ? `Slot ${(menu?.slot ?? 0) + 1} · ${slotView.count}/${maxPerSlot}` : undefined}
    >
      {body}
    </InfoPopover>
  );
}

const styles = StyleSheet.create({
  // zIndex + elevation: on Android a sibling with elevation (the sign buttons, the potion button) draws over a plain overlay.
  fill: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 20, elevation: 20 },
  backdrop: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10, 6, 3, 0.72)' },
  panel: {
    position: 'absolute',
    left: 12,
    right: 12,
    maxHeight: '86%',
    backgroundColor: colors.sheet,
    borderWidth: 3,
    borderColor: colors.goldDark,
    padding: 12,
    gap: 8,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headText: { flex: 1 },
  title: { fontFamily: fonts.title, fontSize: 24, color: colors.gold },
  subtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  closeText: { fontFamily: fonts.bodyBold, fontSize: 22, color: colors.parchment },
  slots: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 },
  slotCell: { flex: 1, alignItems: 'center', gap: 2 },
  slot: { width: SLOT_SIZE, height: SLOT_SIZE, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  slotArmed: { borderStyle: 'dashed' },
  iconDim: { opacity: 0.35 },
  qty: {
    position: 'absolute',
    right: 2,
    bottom: 0,
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: '#fff',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  cooldown: {
    position: 'absolute',
    fontFamily: fonts.bodyBold,
    fontSize: 20,
    color: POPOVER_GOOD,
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  rule: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.parchment, textAlign: 'center' },
  hint: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.parchmentDark },
  section: { fontFamily: fonts.title, fontSize: 18, color: colors.gold, marginTop: 4 },
  bagScroll: { flexGrow: 0 },
  bag: { gap: 6 },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.parchmentDark, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 6, backgroundColor: colors.slot, borderWidth: 3, borderColor: colors.slotBorder },
  rowSelected: { borderColor: colors.gold },
  rowIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.night, borderWidth: 2, borderColor: colors.goldDark },
  rowText: { flex: 1 },
  rowName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.parchment },
  rowQty: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark },
  rowCooldown: { fontFamily: fonts.bodyBold, fontSize: 18, color: POPOVER_GOOD },
  ghost: { position: 'absolute', left: 0, top: 0, width: GHOST_SIZE, height: GHOST_SIZE, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.woodDark, borderWidth: 3, borderColor: colors.gold },
});
