// InfoPopover: the one way to show info about something the player tapped (an item, a locked building, an upgrade, a
// stat, a locked dungeon, a tree or rock). A squared box in the dialog's visual family, anchored next to the tapped
// element: below it when it fits, else above, clamped to the screen and the safe area; its content scrolls when it is
// taller than the room. The element's actions go inside as buttons (PopoverActions). Dismissed by a tap anywhere
// outside it, the ✕, or Android back (item grids can instead pass `onOutsidePress` so a tap on another slot moves it).
//
// It is an RN <Modal> owned by the screen that renders it, so it presents over a full-screen village modal too. It
// steps aside while the "While you were away" summary or a GameDialog is up (two RN modals never present at once);
// errors inside it are shown inline, not as dialogs.
//
// Switching: item grids move an open popover onto another item (anchor changes while the Modal stays visible) with a
// quick crossfade, not a close / reopen: the old box (a snapshot of its content and placement) fades out (FADE_OUT_MS)
// while the new one mounts hidden and is measured; once measured it fades in (FADE_IN_MS). State machine:
// popoverCrossfade.ts. Reduce-motion: the old box stays until the new one is measured, then swaps at once.
//
// Usage: keep `{ key, anchor } | null` in state; on press, `measureAnchor(ref.current)` then set it.
import { type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  type GestureResponderEvent,
  type HostInstance,
  type LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useGameSnapshot } from '../../client/GameProvider';
import { colors, fonts } from '../../theme';
import { overlayFrame, useDialogShowing } from './GameDialog';
import { useScreenInsets } from './insets';
import { type Crossfade, type CrossfadeEvent, IDLE, crossfade, fadeInProgress, liveTouchable } from './popoverCrossfade';
import { type AnchorBox, type Measured, boxShown, CARET, FADE_IN_MS, FADE_OUT_MS, MEASURE_TIMEOUT_MS, measuredFor, placePopover } from './popoverLayout';

let presentationSeq = 0;

/** The tapped element's box in window coordinates (measureInWindow). */
export type AnchorRect = AnchorBox;

/** Measures an element for InfoPopover. Resolves null when it is gone. */
export function measureAnchor(node: Pick<HostInstance, 'measureInWindow'> | null | undefined): Promise<AnchorRect | null> {
  return new Promise((resolve) => {
    if (!node) {
      resolve(null);
      return;
    }
    node.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
  });
}

/** Measure a ref, for press handlers: `onPress={() => anchorOf(ref).then((a) => setOpen({ id, anchor: a }))}`. */
export function anchorOf(ref: RefObject<HostInstance | null>): Promise<AnchorRect | null> {
  return measureAnchor(ref.current);
}

/** What one box shows (and where): kept as a snapshot while that box fades out. */
type BoxData = {
  anchor: AnchorRect;
  title: string;
  icon?: ReactNode;
  titleColor?: string;
  iconBorder?: string;
  subtitle?: ReactNode;
  children?: ReactNode;
};

/** The old box during a switch: its content + measured height, and its own opacity. */
type Snapshot = { data: BoxData; h: number | null; anim: Animated.Value };

type Xf = {
  presentation: number;
  visible: boolean;
  m: Crossfade;
  prev: Snapshot | null;
  /** Opacity of the new box while the machine is not idle (null in idle: it is then 1 once shown, else 0). */
  live: Animated.Value | null;
  /** When the new box started fading in (to resume from its opacity if another switch interrupts). */
  inStart: number | null;
};

function step(x: Xf, e: CrossfadeEvent): Xf {
  const m = crossfade(x.m, e);
  if (m === x.m) return x;
  return { ...x, m, prev: m.hasPrev ? x.prev : null, live: m.phase === 'idle' ? null : x.live };
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v), () => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

type Props = {
  /** null = closed. */
  anchor: AnchorRect | null;
  onClose: () => void;
  /**
   * Item grids: called with the window point of a tap on the backdrop. Resolve true when the tap landed on another
   * slot and the caller already pointed `anchor` (and the content) at it: the popover then stays up and crossfades
   * onto it (old box out, new box in), with no Modal close / open. Resolve false to close as usual.
   */
  onOutsidePress?: (point: { x: number; y: number }) => Promise<boolean>;
  title: string;
  /** Pixel-art image (GameIcon, ItemIcon…, up to 32 pt) in a framed square left of the title. */
  icon?: ReactNode;
  /** Title color (e.g. item rarity). Default gold. */
  titleColor?: string;
  /** Frame color of the icon square. */
  iconBorder?: string;
  /** Small line under the title. */
  subtitle?: ReactNode;
  children?: ReactNode;
};

export function InfoPopover({ anchor, onClose, onOutsidePress, title, icon, titleColor, iconBorder, subtitle, children }: Props) {
  const { awaySummary } = useGameSnapshot();
  const dialogShowing = useDialogShowing();
  const win = useWindowDimensions();
  const insets = useScreenInsets();
  const visible = !!anchor && !awaySummary && !dialogShowing;

  // One "presentation" = this anchor while the Modal is visible. Its id changes with either, so the measured box is
  // remounted (a fresh onLayout is guaranteed) and an older measurement can never apply (no reset effect to race).
  const presentation = useMemo(() => ++presentationSeq, [anchor, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [timedOutKey, setTimedOutKey] = useState<number | null>(null);
  const h = measuredFor(measured, presentation);
  const shown = boxShown(h, timedOutKey, presentation);

  // Safety net: if the layout never arrives, show the box anyway so the backdrop never covers an invisible popover.
  useEffect(() => {
    if (!visible || shown) return;
    const t = setTimeout(() => setTimedOutKey(presentation), MEASURE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [visible, shown, presentation]);

  useEffect(() => {
    if (visible) AccessibilityInfo.announceForAccessibility(title);
  }, [visible, title]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => setMeasured({ key: presentation, h: Math.round(e.nativeEvent.layout.height) }),
    [presentation],
  );

  const onBackdrop = (e: GestureResponderEvent) => {
    if (!onOutsidePress) return onClose();
    const { pageX, pageY } = e.nativeEvent;
    onOutsidePress({ x: pageX, y: pageY }).then((handled) => !handled && onClose(), onClose);
  };

  const reduce = useReduceMotion();
  const data: BoxData | null = anchor ? { anchor, title, icon, titleColor, iconBorder, subtitle, children } : null;

  // Crossfade state, derived during render when the presentation changes (so the very first frame of a switch already
  // shows the old box's snapshot at full opacity and the new box hidden: no frame with the new content in the old place).
  const [xf, setXf] = useState<Xf>(() => ({ presentation, visible, m: IDLE, prev: null, live: null, inStart: null }));
  const displayed = useRef<{ presentation: number; data: BoxData; h: number | null } | null>(null);
  if (xf.presentation !== presentation) {
    let next: Xf = { presentation, visible, m: IDLE, prev: null, live: null, inStart: null };
    if (xf.visible && visible) {
      const prevShown = displayed.current?.presentation === xf.presentation;
      let m = crossfade(xf.m, { t: 'switch', prevShown, reduce });
      let prev = m.hasPrev ? xf.prev : null;
      if (m.hasPrev && !xf.m.hasPrev && displayed.current) {
        const start = xf.m.phase === 'fadingIn' ? fadeInProgress(Date.now() - (xf.inStart ?? Date.now())) : 1;
        prev = { data: displayed.current.data, h: displayed.current.h, anim: new Animated.Value(start) };
      }
      if (m.hasPrev && !prev) m = IDLE; // no snapshot to fade: plain mount, never stuck hidden
      next = { presentation, visible, m, prev, live: m.phase === 'idle' ? null : new Animated.Value(0), inStart: null };
    }
    setXf(next);
  }
  const phase = xf.m.phase;

  // The box on screen, for the next switch's snapshot (committed values only).
  useLayoutEffect(() => {
    if (!data || !visible) {
      displayed.current = null;
      return;
    }
    if (xf.presentation === presentation && (phase === 'idle' ? shown : phase === 'fadingIn')) displayed.current = { presentation, data, h };
  });

  // The new box is measured (or timed out): the machine may fade it in.
  useEffect(() => {
    if (visible && shown) setXf((x) => (x.presentation === presentation ? step(x, { t: 'ready', reduce }) : x));
  }, [visible, shown, presentation, reduce]);

  const outAnim = phase === 'fadingOut' ? (xf.prev?.anim ?? null) : null;
  useEffect(() => {
    if (!outAnim) return;
    const done = () => setXf((x) => step(x, { t: 'outDone' }));
    const a = Animated.timing(outAnim, { toValue: 0, duration: FADE_OUT_MS, easing: Easing.linear, useNativeDriver: true });
    a.start(({ finished }) => finished && done());
    const t = setTimeout(done, FADE_OUT_MS + 100); // if the native callback is ever lost, never stay in fadingOut
    return () => {
      a.stop();
      clearTimeout(t);
    };
  }, [outAnim]);

  const inAnim = phase === 'fadingIn' ? xf.live : null;
  useEffect(() => {
    if (!inAnim) return;
    const done = () => setXf((x) => (x.live === inAnim ? step(x, { t: 'inDone' }) : x));
    setXf((x) => (x.live === inAnim ? { ...x, inStart: Date.now() } : x));
    const a = Animated.timing(inAnim, { toValue: 1, duration: FADE_IN_MS, easing: Easing.linear, useNativeDriver: true });
    a.start(({ finished }) => finished && done());
    const t = setTimeout(done, FADE_IN_MS + 100);
    return () => {
      a.stop();
      clearTimeout(t);
    };
  }, [inAnim]);

  if (!data) return null;

  const liveOpacity = phase === 'idle' || !xf.live ? (shown ? 1 : 0) : xf.live;
  // Reduce-motion holds the old box until the new one is ready; it is never touchable (its buttons act on the old item).
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onBackdrop} accessibilityRole="button" accessibilityLabel="Close info" />
      {xf.prev ? <PopoverBox data={xf.prev.data} h={xf.prev.h} win={win} insets={insets} opacity={xf.prev.anim} live={false} onClose={onClose} /> : null}
      <PopoverBox key={presentation} data={data} h={h} win={win} insets={insets} opacity={liveOpacity} live touchable={liveTouchable(phase, shown)} onClose={onClose} onLayout={onLayout} />
    </Modal>
  );
}

type BoxProps = {
  data: BoxData;
  h: number | null;
  win: { width: number; height: number };
  insets: { top: number; bottom: number; left: number; right: number };
  opacity: number | Animated.Value;
  /** false = the fading-out snapshot: inert and hidden from accessibility. */
  live: boolean;
  /** live box only: false while it is invisible, so taps reach what is actually on screen. */
  touchable?: boolean;
  onClose: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
};

/** One popover box with its caret; `opacity` fades both. */
function PopoverBox({ data, h, win, insets, opacity, live, touchable = true, onClose, onLayout }: BoxProps) {
  const { anchor, title, icon, titleColor, iconBorder, subtitle, children } = data;
  const { left, top, width, maxHeight, boxH, below, caretLeft, caretFits } = placePopover(anchor, h, win, insets);
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity }]}
      pointerEvents={live && touchable ? 'box-none' : 'none'}
      accessibilityElementsHidden={!live}
      importantForAccessibility={live ? 'auto' : 'no-hide-descendants'}
    >
      <View style={[styles.box, { left, top, width, maxHeight }]} onLayout={onLayout} accessibilityViewIsModal={live}>
        <View style={[overlayFrame.frame, styles.shrink]}>
          <View style={[overlayFrame.box, styles.inner]}>
            <View style={styles.head}>
              {icon ? (
                <View style={[styles.icon, iconBorder ? { borderColor: iconBorder } : null]}>{icon}</View>
              ) : null}
              <View style={styles.flex}>
                <Text style={[styles.title, titleColor ? { color: titleColor } : null]} accessibilityRole="header">
                  {title}
                </Text>
                {typeof subtitle === 'string' ? <Text style={styles.subtitle}>{subtitle}</Text> : subtitle}
              </View>
              <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={6}>
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content} bounces={false} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          </View>
        </View>
      </View>
      {caretFits ? (
        <View
          pointerEvents="none"
          style={[
            styles.caret,
            below ? styles.caretUp : styles.caretDown,
            { left: left + caretLeft, top: below ? top - CARET + 1 : top + boxH - 1 },
          ]}
        />
      ) : null}
    </Animated.View>
  );
}

/** A label / value row in the popover's style; `icon` (a pixel image, 16 pt) sits before the label. */
export function PopoverRow({ label, value, strong, valueColor, icon }: { label: ReactNode; value: ReactNode; strong?: boolean; valueColor?: string; icon?: ReactNode }) {
  return (
    <View style={styles.row}>
      {icon ? (
        <View style={styles.labelRow}>
          {icon}
          <Text style={[styles.label, styles.labelShrink]}>{label}</Text>
        </View>
      ) : (
        <Text style={styles.label}>{label}</Text>
      )}
      <Text style={[styles.value, strong && styles.strong, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

/** Body text in the popover. */
export function PopoverText({ children, tone }: { children: ReactNode; tone?: 'note' | 'good' | 'bad' | 'gold' }) {
  return <Text style={[styles.text, tone === 'note' && styles.note, tone === 'good' && styles.good, tone === 'bad' && styles.bad, tone === 'gold' && styles.gold]}>{children}</Text>;
}

/** A small section heading in the popover. */
export function PopoverSection({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

/** The element's actions: a row of PixelButtons (use `stretch`). */
export function PopoverActions({ children }: { children: ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

/** Met / unmet and better / worse text on the dark box (pass 4.5:1 on colors.sheet). */
export const POPOVER_GOOD = '#7fd17a';
export const POPOVER_BAD = '#ff8a7a';

const styles = StyleSheet.create({
  box: { position: 'absolute' },
  // The frame and box must shrink, or the ScrollView inside is never bounded by the popover's maxHeight.
  shrink: { flexShrink: 1 },
  inner: { flexShrink: 1, paddingTop: 8, paddingHorizontal: 12, paddingBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  icon: { width: 44, height: 44, borderWidth: 3, borderColor: colors.goldDark, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.title, fontSize: 20, color: colors.gold },
  subtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  closeText: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.parchment },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: 6, paddingTop: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 24, gap: 8 },
  label: { flexShrink: 1, fontFamily: fonts.body, fontSize: 14, color: colors.parchmentDark },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  labelShrink: { flexShrink: 1 },
  value: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.parchment, textAlign: 'right' },
  strong: { color: colors.gold, fontSize: 17 },
  text: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.parchment },
  note: { fontSize: 13, lineHeight: 18, color: colors.parchmentDark },
  good: { fontFamily: fonts.bodyBold, color: POPOVER_GOOD },
  bad: { fontFamily: fonts.bodyBold, color: POPOVER_BAD },
  gold: { fontFamily: fonts.bodyBold, color: colors.gold },
  section: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.parchment, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  // Hard-edged pixel caret pointing at the element (a bordered triangle, no rounding).
  caret: { position: 'absolute', width: 0, height: 0, borderLeftWidth: CARET, borderRightWidth: CARET, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  caretUp: { borderBottomWidth: CARET, borderBottomColor: colors.gold },
  caretDown: { borderTopWidth: CARET, borderTopColor: colors.goldDark },
});
