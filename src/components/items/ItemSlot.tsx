// One inventory / equipment / merchant slot: icon, stack count, quality-colored frame, optional price
// caption, tap to open the item's info box (anchored on the slot). Memoized: grids re-render only the slots that changed.
import { memo, useCallback, useRef } from 'react';
import { type HostInstance, Pressable, StyleSheet, Text, View } from 'react-native';
import { type AnchorRect, measureAnchor } from '../ui/InfoPopover';
import { colors, fonts, qualityColors } from '../../theme';
import { formatQty } from '../format';
import { defOf } from './itemInfo';

export type SlotItem = { defId: string; icon: string; name: string; quantity?: number; stackable?: boolean };

type Props = {
  item?: SlotItem | null;
  size: 52 | 58;
  /** Small caption under the slot (e.g. a price). */
  caption?: string;
  /** Opaque key handed back to onPress (slot index, item id, equipment slot). */
  pressKey?: string | number;
  /** Called with the key and the slot's box on screen (for InfoPopover). */
  onPress?: (key: string | number, anchor: AnchorRect) => void;
  /** Spoken suffix, e.g. ", sells for 10 gold". */
  hint?: string;
};

export const ItemSlot = memo(function ItemSlot({ item, size, caption, pressKey, onPress, hint }: Props) {
  const ref = useRef<HostInstance>(null);
  const handle = useCallback(() => {
    if (!onPress || pressKey === undefined) return;
    void measureAnchor(ref.current).then((anchor) => anchor && onPress(pressKey, anchor));
  }, [onPress, pressKey]);
  const quality = item ? defOf(item.defId).quality : null;
  const label = item ? `${item.name}${item.quantity ? ` x${item.quantity}` : ''}${hint ?? ''}` : 'Empty slot';
  const box = (
    <View style={[styles.slot, size === 58 ? styles.slot58 : styles.slot52, quality ? { borderColor: qualityColors[quality] } : null]}>
      {item ? <Text style={size === 58 ? styles.icon58 : styles.icon52}>{item.icon}</Text> : null}
      {item?.quantity ? <Text style={styles.qty}>{formatQty(item.quantity)}</Text> : null}
    </View>
  );
  return (
    <View style={styles.cell}>
      {item && onPress ? (
        <Pressable ref={ref} onPress={handle} accessibilityRole="button" accessibilityLabel={label} hitSlop={2}>
          {box}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={label}>
          {box}
        </View>
      )}
      {caption !== undefined ? (
        <Text style={styles.caption} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  cell: { alignItems: 'center' },
  slot58: { width: 58, height: 58 },
  slot52: { width: 52, height: 52 },
  icon58: { fontSize: 29 },
  icon52: { fontSize: 26 },
  slot: {
    backgroundColor: colors.slot,
    borderWidth: 3,
    borderColor: colors.slotBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  caption: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.gold, marginTop: 2, maxWidth: 56 },
});
