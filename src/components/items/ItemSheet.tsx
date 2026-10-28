// Bottom sheet with an item's info and the actions the screen allows (Equip / Use / Unequip / Buy / Sell).
// An RN <Modal> owned by the screen that renders it, so it also presents over a full-screen village modal.
// Hidden while a "While you were away" summary is pending, so two modals never fight over presentation.
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGameSnapshot } from '../../client/GameProvider';
import type { ItemDef } from '../../engine';
import { colors, fonts, qualityColors } from '../../theme';
import { formatNumber } from '../format';
import { PixelButton } from '../PixelButton';
import { QUALITY_LABELS, statLines } from './itemInfo';

export type SheetAction = { label: string; onPress: () => void; disabled?: boolean; sublabel?: string };

type Props = {
  def: ItemDef | null;
  /** Units owned / in stock, shown next to the name. */
  quantity?: number;
  /** For gear: the item now in the same slot (null = empty), so stats show the change. Omit for no comparison. */
  equipped?: ItemDef | null;
  /** Extra rows (price, quantity selector, total). */
  children?: ReactNode;
  actions: SheetAction[];
  /** Why the last action failed, shown above the buttons. */
  error?: string | null;
  onClose: () => void;
};

export function ItemSheet({ def, quantity, equipped, children, actions, error, onClose }: Props) {
  const { awaySummary } = useGameSnapshot();
  const insets = useSafeAreaInsets();
  const visible = !!def && !awaySummary;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close item details" />
      {def ? (
        <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]}>
          <ScrollView bounces={false} contentContainerStyle={styles.content}>
            <View style={styles.head}>
              <View style={[styles.icon, { borderColor: qualityColors[def.quality] }]}>
                <Text style={styles.iconText}>{def.icon}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={[styles.name, { color: qualityColors[def.quality] }]} accessibilityRole="header">
                  {def.name}
                  {quantity !== undefined && def.stackable ? <Text style={styles.qty}>{`  x${formatNumber(quantity)}`}</Text> : null}
                </Text>
                <Text style={[styles.quality, { color: qualityColors[def.quality] }]}>{QUALITY_LABELS[def.quality]}</Text>
              </View>
              <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.description}>{def.description}</Text>
            {statLines(def, equipped).map((line) => (
              <View key={line.label} style={styles.row}>
                <Text style={styles.label}>{line.label}</Text>
                <Text style={styles.value}>
                  {line.value}
                  {line.delta !== undefined && line.delta !== 0 ? (
                    <Text style={line.delta > 0 ? styles.up : styles.down}>{`  ${line.delta > 0 ? '+' : ''}${line.delta}`}</Text>
                  ) : null}
                </Text>
              </View>
            ))}
            <View style={styles.row}>
              <Text style={styles.label}>Sell value</Text>
              <Text style={styles.value}>{def.sellPrice > 0 ? `🪙 ${formatNumber(def.sellPrice)}${def.stackable ? ' each' : ''}` : '—'}</Text>
            </View>
            {children}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {actions.length ? (
              <View style={styles.actions}>
                {actions.map((a) => (
                  <PixelButton key={a.label} label={a.label} sublabel={a.sublabel} onPress={a.onPress} disabled={a.disabled} stretch />
                ))}
              </View>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

/** A label / value row in the sheet's style, for screens that add price lines. */
export function SheetRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    maxHeight: '80%',
    backgroundColor: colors.sheet,
    borderTopWidth: 3,
    borderTopColor: colors.goldDark,
  },
  content: { padding: 16, gap: 8 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 58, height: 58, borderWidth: 3, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 30 },
  name: { fontFamily: fonts.bodyBold, fontSize: 19 },
  qty: { fontFamily: fonts.body, fontSize: 15, color: colors.parchment },
  quality: { fontFamily: fonts.body, fontSize: 13 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: fonts.bodyBold, fontSize: 24, color: colors.parchment },
  description: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.parchmentDark },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 24 },
  label: { fontFamily: fonts.body, fontSize: 14, color: colors.parchmentDark },
  value: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.parchment },
  strong: { color: colors.gold, fontSize: 17 },
  up: { color: '#7fd17a' },
  down: { color: '#ff8a7a' },
  error: { fontFamily: fonts.bodyBold, fontSize: 13, color: '#ff8a7a' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
});
