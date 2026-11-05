// The reveal: a won or collected gear piece's popover (rarity colour, quality, scaled stats) with Equip. Used by Crafting's
// Done and by a boss win that dropped gear. Follows the live item: it closes itself once the piece has left the inventory.
import { useGameSnapshot } from '../../client/GameProvider';
import { type AnchorRect } from '../ui/InfoPopover';
import { useCommand } from '../ui/useCommand';
import { ItemSheet } from './ItemSheet';

/** The reveal: the collected piece's popover (rarity colour, quality, scaled stats) with Equip. Follows the live item. */
export function RevealSheet({ itemId, anchor, onClose }: { itemId: string; anchor: AnchorRect; onClose: () => void }) {
  const { state } = useGameSnapshot();
  const { send } = useCommand();
  const item = state.inventory.items.find((i) => i.id === itemId) ?? null;
  if (!item?.slot) return null;
  const equipped = state.character.equipment[item.slot] ?? null;
  return (
    <ItemSheet
      item={item}
      anchor={anchor}
      equipped={equipped}
      onClose={onClose}
      actions={[
        {
          label: 'Equip',
          sublabel: equipped ? `swaps ${equipped.name}` : undefined,
          onPress: () => void send({ type: 'EQUIP_ITEM', itemId: item.id }).then((ok) => ok && onClose()),
        },
      ]}
    />
  );
}
