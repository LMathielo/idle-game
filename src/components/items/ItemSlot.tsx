// One inventory / equipment / merchant slot: icon, stack count, rarity-colored frame (the instance's), optional price
// caption, tap to open the item's info box (anchored on the slot). Memoized: grids re-render only the slots that changed.
// On the Hero tab (1.28.0) a slot is also a DROP BOX of the drag kit (empty or not) and, holding an item, a drag source: hold, then drag.
import { memo, useCallback, useEffect, useRef } from 'react';
import { type HostInstance, Pressable, StyleSheet, Text, View } from 'react-native';
import { type AnchorRect, measureAnchor } from '../ui/InfoPopover';
import { type DragHandlers, DragSource, DropHighlight, type DragSurface } from '../ui/drag/dragKit';
import type { SlotHitTest } from '../ui/useSlotHitTest';
import { type ItemRarity, rarityOf } from '../../engine';
import { colors, fonts, rarityColors } from '../../theme';
import { GameIcon, ItemIcon } from '../art/Sprites';
import type { IconName } from '../art/images';
import { formatQty } from '../format';

/** Spoken after a draggable slot's label (the tap path stays the accessible way to move things: Equip / Unequip in the box). */
const DRAG_HINT = 'Opens its details. Hold and drag to move it';

/** The Hero tab's inventory slot size; the Crafting recipe tiles use it too. */
export const INVENTORY_SLOT_SIZE = 52;

/** Gear carries its own rarity (the frame colour); anything else takes the catalog's. The art comes from `defId`. */
export type SlotItem = { defId: string; name: string; quantity?: number; stackable?: boolean; rarity?: ItemRarity };

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
  /** Ghost art shown while the slot is empty (the Hero tab's accessory slot: a belt outline). */
  placeholder?: IconName;
  /** Registers the slot so a tap on it while a popover is open moves the popover here (useSlotHitTest). */
  hitTest?: SlotHitTest;
  /** The Hero tab's drag: the surface, this slot's drop box index, and the shared drag callbacks (all stable). */
  drag?: DragSurface;
  dragIndex?: number;
  dragHandlers?: DragHandlers;
  /** What the drag hands back for this slot's item (default: `pressKey`). */
  dragId?: string;
};

export const ItemSlot = memo(function ItemSlot({ item, size, caption, pressKey, onPress, hint, hitTest, placeholder, drag, dragIndex, dragHandlers, dragId }: Props) {
  const ref = useRef<HostInstance>(null);
  const box = dragIndex !== undefined ? drag : undefined;
  const setBox = useCallback((node: HostInstance | null) => box?.setTarget(dragIndex!, node), [box, dragIndex]);
  const handle = useCallback(() => {
    if (!onPress || pressKey === undefined) return;
    void measureAnchor(ref.current).then((anchor) => anchor && onPress(pressKey, anchor));
  }, [onPress, pressKey]);
  const active = !!item && !!onPress && pressKey !== undefined;
  useEffect(() => (active && hitTest ? hitTest.register(pressKey!, ref) : undefined), [active, hitTest, pressKey]);
  const rarity = item ? rarityOf(item) : null;
  const label = item ? `${item.name}${item.quantity ? ` x${item.quantity}` : ''}${hint ?? ''}` : 'Empty slot';
  const frame = (
    <View ref={box ? setBox : undefined} collapsable={false} style={[styles.slot, size === 58 ? styles.slot58 : styles.slot52, rarity ? { borderColor: rarityColors[rarity] } : null]}>
      {item ? <ItemIcon defId={item.defId} size={size === 58 ? 40 : 36} /> : placeholder ? <GameIcon name={placeholder} size={size === 58 ? 40 : 36} /> : null}
      {item?.quantity ? <Text style={styles.qty}>{formatQty(item.quantity)}</Text> : null}
      {box ? <DropHighlight surface={box} index={dragIndex!} /> : null}
    </View>
  );
  const draggable = !!box && !!item && !!onPress && !!dragHandlers && pressKey !== undefined;
  const tappable =
    item && onPress ? (
      <Pressable ref={ref} onPress={handle} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={draggable ? DRAG_HINT : undefined} hitSlop={2}>
        {frame}
      </Pressable>
    ) : (
      <View accessible accessibilityLabel={label}>
        {frame}
      </View>
    );
  return (
    <View style={styles.cell}>
      {draggable ? (
        <DragSource surface={box!} spec={{ id: dragId ?? String(pressKey), icon: item!.defId, index: dragIndex!, onStart: dragHandlers!.onStart, onDrop: dragHandlers!.onDrop, onEnd: dragHandlers!.onEnd, onTap: handle }}>
          {tappable}
        </DragSource>
      ) : (
        tappable
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
