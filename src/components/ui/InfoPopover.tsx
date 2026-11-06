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
// Usage: keep `{ key, anchor } | null` in state; on press, `measureAnchor(ref.current)` then set it.
import { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
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
import { type AnchorBox, type Measured, boxShown, CARET, MEASURE_TIMEOUT_MS, measuredFor, placePopover } from './popoverLayout';

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

type Props = {
  /** null = closed. */
  anchor: AnchorRect | null;
  onClose: () => void;
  /**
   * Item grids: called with the window point of a tap on the backdrop. Resolve true when the tap landed on another
   * slot and the caller already pointed `anchor` (and the content) at it: the popover then stays up and just moves,
   * with no close / fade. Resolve false to close as usual.
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

  if (!anchor) return null;

  const { left, top, width, maxHeight, boxH, below, caretLeft, caretFits } = placePopover(anchor, h, win, insets);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onBackdrop} accessibilityRole="button" accessibilityLabel="Close info" />
      <View
        key={presentation}
        style={[styles.box, { left, top, width, maxHeight, opacity: shown ? 1 : 0 }]}
        onLayout={onLayout}
        accessibilityViewIsModal
      >
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
      {shown && caretFits ? (
        <View
          pointerEvents="none"
          style={[
            styles.caret,
            below ? styles.caretUp : styles.caretDown,
            { left: left + caretLeft, top: below ? top - CARET + 1 : top + boxH - 1 },
          ]}
        />
      ) : null}
    </Modal>
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
