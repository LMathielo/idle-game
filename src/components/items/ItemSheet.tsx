// An item's info box (InfoPopover, anchored next to the tapped slot) with the actions the screen allows
// (Equip / Use / Unequip / Buy / Sell) as buttons inside it. Dismissed by a tap outside. Errors from an action
// show inline, above the buttons.
import type { ReactNode } from 'react';
import { baseSellPrice, rarityOf } from '../../engine';
import { rarityColors } from '../../theme';
import { GameIcon, ItemIcon } from '../art/Sprites';
import type { IconName } from '../art/images';
import { formatNumber } from '../format';
import { PixelButton } from '../PixelButton';
import { type AnchorRect, InfoPopover, PopoverActions, PopoverRow, PopoverText } from '../ui/InfoPopover';
import { affixLines, defOf, itemSubtitle, type ShownItem, statLines } from './itemInfo';

export type SheetAction = { label: string; onPress: () => void; disabled?: boolean; sublabel?: string };

type Props = {
  /** The item shown (a stored item, a listing or a crafted piece; gear with its quality and rarity). Null = closed. */
  item: ShownItem | null;
  /** The tapped slot, from measureAnchor. Null = closed. */
  anchor: AnchorRect | null;
  /** Units owned / in stock, shown next to the name. */
  quantity?: number;
  /** For gear: the item now in the same slot (null = empty), so stats show the change. Omit for no comparison. */
  equipped?: ShownItem | null;
  /** Extra rows (price, quantity selector, total). */
  children?: ReactNode;
  actions: SheetAction[];
  /** Why the last action failed, shown above the buttons. */
  error?: string | null;
  onClose: () => void;
  /** Item grids: a backdrop tap on another slot moves the popover there (see InfoPopover). */
  onOutsidePress?: (point: { x: number; y: number }) => boolean | Promise<boolean>;
};

export function ItemSheet({ item, anchor, quantity, equipped, children, actions, error, onClose, onOutsidePress }: Props) {
  // No item (closed, or it is gone): stay mounted with no anchor, so the popover can fade its last box out.
  if (!item) return <InfoPopover anchor={null} onClose={onClose} title="" />;
  const def = defOf(item.defId);
  const color = rarityColors[rarityOf(item)];
  const sell = baseSellPrice(item);
  const qty = quantity !== undefined && def.stackable ? ` ×${formatNumber(quantity)}` : '';
  return (
    <InfoPopover
      anchor={anchor}
      onClose={onClose}
      onOutsidePress={onOutsidePress}
      title={`${def.name}${qty}`}
      titleColor={color}
      icon={<ItemIcon defId={item.defId} />}
      iconBorder={color}
      subtitle={itemSubtitle(item, def)}
    >
      <PopoverText tone="note">{def.description}</PopoverText>
      {[...statLines(item, equipped), ...affixLines(item)].map((line) => (
        <PopoverRow
          key={`${line.label}-${line.value}`}
          label={line.label}
          value={
            line.delta !== undefined && line.delta !== 0 ? (
              <>
                {line.value}
                <PopoverText tone={line.delta > 0 ? 'good' : 'bad'}>{`  ${line.delta > 0 ? '+' : ''}${line.delta}`}</PopoverText>
              </>
            ) : (
              line.value
            )
          }
        />
      ))}
      <PopoverRow icon={<GameIcon name="gold" />} label="Sell value" value={sell > 0 ? `${formatNumber(sell)}${def.stackable ? ' each' : ''}` : def.sellable === false ? 'Not sold' : '—'} />
      {children}
      {error ? <PopoverText tone="bad">{error}</PopoverText> : null}
      {actions.length ? (
        <PopoverActions>
          {actions.map((a) => (
            <PixelButton key={a.label} label={a.label} sublabel={a.sublabel} onPress={a.onPress} disabled={a.disabled} stretch />
          ))}
        </PopoverActions>
      ) : null}
    </InfoPopover>
  );
}

/** A label / value row in the box's style, for screens that add price lines (`icon`: e.g. gold before a price). */
export function SheetRow({ label, value, strong, icon }: { label: string; value: string; strong?: boolean; icon?: IconName }) {
  return <PopoverRow icon={icon ? <GameIcon name={icon} /> : undefined} label={label} value={value} strong={strong} />;
}
