// InfoPopover: the one way to show info about something the player tapped (an item, a locked building, an upgrade, a
// stat, a locked dungeon, a tree or rock). A squared box in the dialog's visual family, anchored next to the tapped
// element: below it when it fits, else above, clamped to the screen and the safe area; its content scrolls when it is
// taller than the room. The element's actions go inside as buttons (PopoverActions). Dismissed by a tap anywhere
// outside it, the ✕, or Android back.
//
// It is an RN <Modal> owned by the screen that renders it, so it presents over a full-screen village modal too. It
// steps aside while the "While you were away" summary or a GameDialog is up (two RN modals never present at once);
// errors inside it are shown inline, not as dialogs.
//
// Usage: keep `{ key, anchor } | null` in state; on press, `measureAnchor(ref.current)` then set it.
import { type ReactNode, type RefObject, useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
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

/** The tapped element's box in window coordinates (measureInWindow). */
export type AnchorRect = { x: number; y: number; width: number; height: number };

/** Measures an element for InfoPopover. Resolves null when it is gone. */
export function measureAnchor(node: HostInstance | null | undefined): Promise<AnchorRect | null> {
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

/** Gap kept from the screen / safe-area edges and between the box and the element. */
const MARGIN = 8;
const GAP = 6;
const MAX_W = 360;
const CARET = 8;
/** Smallest box height worth showing; below that the popover overlaps the element instead of shrinking further. */
const MIN_H = 140;

type Props = {
  /** null = closed. */
  anchor: AnchorRect | null;
  onClose: () => void;
  title: string;
  /** Emoji or short text in a framed square left of the title. */
  icon?: string;
  /** Title color (e.g. item quality). Default gold. */
  titleColor?: string;
  /** Frame color of the icon square. */
  iconBorder?: string;
  /** Small line under the title. */
  subtitle?: ReactNode;
  children?: ReactNode;
};

export function InfoPopover({ anchor, onClose, title, icon, titleColor, iconBorder, subtitle, children }: Props) {
  const { awaySummary } = useGameSnapshot();
  const dialogShowing = useDialogShowing();
  const win = useWindowDimensions();
  const insets = useScreenInsets();
  const [h, setH] = useState<number | null>(null);
  const visible = !!anchor && !awaySummary && !dialogShowing;

  // A new anchor (another element) is measured again before it shows.
  useEffect(() => setH(null), [anchor]);
  useEffect(() => {
    if (visible) AccessibilityInfo.announceForAccessibility(title);
  }, [visible, title]);

  const onLayout = useCallback((e: LayoutChangeEvent) => setH(Math.round(e.nativeEvent.layout.height)), []);

  if (!anchor) return null;

  const left0 = insets.left + MARGIN;
  const right0 = win.width - insets.right - MARGIN;
  const top0 = insets.top + MARGIN;
  const bottom0 = win.height - insets.bottom - MARGIN;
  const width = Math.min(MAX_W, right0 - left0);
  const centerX = anchor.x + anchor.width / 2;
  const left = Math.min(Math.max(centerX - width / 2, left0), right0 - width);

  const spaceBelow = bottom0 - (anchor.y + anchor.height + GAP + CARET);
  const spaceAbove = anchor.y - GAP - CARET - top0;
  const natural = h ?? 0;
  const below = h === null ? spaceBelow >= spaceAbove : natural <= spaceBelow || spaceBelow >= spaceAbove;
  const room = Math.max(MIN_H, below ? spaceBelow : spaceAbove);
  const maxHeight = Math.min(room, bottom0 - top0);
  const boxH = Math.min(natural, maxHeight);
  let top = below ? anchor.y + anchor.height + GAP + CARET : anchor.y - GAP - CARET - boxH;
  top = Math.min(Math.max(top, top0), bottom0 - boxH);
  const caretLeft = Math.min(Math.max(centerX - left - CARET, 10), width - 10 - 2 * CARET);
  const caretFits = below ? top >= anchor.y + anchor.height : top + boxH <= anchor.y;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close info" />
      <View
        style={[styles.box, { left, top, width, maxHeight, opacity: h === null ? 0 : 1 }]}
        onLayout={onLayout}
        accessibilityViewIsModal
      >
        <View style={overlayFrame.frame}>
          <View style={[overlayFrame.box, styles.inner]}>
            <View style={styles.head}>
              {icon ? (
                <View style={[styles.icon, iconBorder ? { borderColor: iconBorder } : null]}>
                  <Text style={styles.iconText}>{icon}</Text>
                </View>
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
      {h !== null && caretFits ? (
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

/** A label / value row in the popover's style. */
export function PopoverRow({ label, value, strong, valueColor }: { label: ReactNode; value: ReactNode; strong?: boolean; valueColor?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
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
  inner: { flexShrink: 1, paddingTop: 8, paddingHorizontal: 12, paddingBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  icon: { width: 44, height: 44, borderWidth: 3, borderColor: colors.goldDark, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 22 },
  title: { fontFamily: fonts.title, fontSize: 20, color: colors.gold },
  subtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  closeText: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.parchment },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: 6, paddingTop: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 24, gap: 8 },
  label: { flexShrink: 1, fontFamily: fonts.body, fontSize: 14, color: colors.parchmentDark },
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
