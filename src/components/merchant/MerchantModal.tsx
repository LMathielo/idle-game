// Village → Merchant. Buy | Sell tabs over a stock grid styled like the inventory. Reads merchantView() and
// the inventory; dispatches BUY_ITEM / SELL_ITEM / REFRESH_MERCHANT. The merchant is not an activity, so
// nothing here stops what the hero is doing.
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGameClient, useGameState } from '../../client/GameProvider';
import type { CommandInput } from '../../client/types';
import { baseSellPrice, beltPotionCount, DEV_TOOLS_ENABLED, freeSlots, type GameState, type Item, maxBuyable, merchantView, sellPriceOfItem, slotsNeeded } from '../../engine';
import { colors, fonts } from '../../theme';
import { IconText } from '../art/Sprites';
import { formatHms, formatNumber } from '../format';
import { defOf } from '../items/itemInfo';
import { ItemSheet, SheetRow } from '../items/ItemSheet';
import { ItemSlot, type SlotItem } from '../items/ItemSlot';
import { QuantityStepper } from '../items/QuantityStepper';
import { ModalScreen } from '../ModalScreen';
import { PixelButton } from '../PixelButton';
import { UpgradeEntry } from '../buildings/UpgradeEntry';
import { type AnchorRect, PopoverText } from '../ui/InfoPopover';
import { useDialog } from '../ui/GameDialog';
import { useCommand } from '../ui/useCommand';
import { type SlotHitTest, useSlotHitTest } from '../ui/useSlotHitTest';

type Tab = 'buy' | 'sell';

/** Errors that only mean "the screen was stale": the sheet closes and the grid shows the new state. */
const STALE = new Set(['PRICE_CHANGED', 'STOCK_CHANGED', 'SLOT_EMPTY', 'NOT_IN_INVENTORY']);

export function MerchantModal() {
  const state = useGameState();
  const [tab, setTab] = useState<Tab>('buy');
  const gold = state.character.gold;

  return (
    <ModalScreen
      title="Merchant"
      buildingId="merchant"
      closeLabel="Close merchant"
      headerRight={
        <IconText icon="gold" style={styles.gold} accessibilityLabel={`${formatNumber(gold)} gold`}>
          {formatNumber(gold)}
        </IconText>
      }
      headerBelow={
        <View style={styles.tabs} accessibilityRole="tablist">
          <PixelButton label="Buy" active={tab === 'buy'} onPress={() => setTab('buy')} stretch />
          <PixelButton label="Sell" active={tab === 'sell'} onPress={() => setTab('sell')} stretch />
        </View>
      }
    >
      {tab === 'buy' ? <BuyTab state={state} /> : <SellTab state={state} />}
    </ModalScreen>
  );
}

/**
 * Dispatch with a busy flag and an inline error; stale-screen errors just close the sheet. Busy, errors and the
 * close-after-done belong to the item the command was sent for (`scope`): if the player switched items meanwhile, the
 * result neither closes the new item's popover nor disables its buttons.
 */
function useSend(onDone: () => void, scope: string) {
  const client = useGameClient();
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const busy = busyScope === scope;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  // The sheet stays mounted while the player moves between items, so an error belongs to the item it came from.
  const [errorState, setErrorState] = useState<{ scope: string; message: string } | null>(null);
  const error = errorState && errorState.scope === scope ? errorState.message : null;
  const setError = useCallback((message: string | null) => setErrorState(message === null ? null : { scope: scopeRef.current, message }), []);
  const send = useCallback(
    (cmd: CommandInput, closeAfter = true) => {
      if (busy) return;
      const at = scope;
      const current = () => scopeRef.current === at;
      setBusyScope(at);
      setErrorState(null);
      client
        .dispatch(cmd)
        .then((res) => {
          if (res.ok) {
            if (closeAfter && current()) onDone();
          } else if (STALE.has(res.error.code)) {
            if (current()) onDone();
          } else setErrorState({ scope: at, message: res.error.message });
        })
        .catch((err: unknown) => setErrorState({ scope: at, message: err instanceof Error ? err.message : String(err) }))
        .finally(() => setBusyScope((b) => (b === at ? null : b)));
    },
    [busy, client, onDone, scope],
  );
  return { busy, error, setError, send };
}

// ---------- Buy ----------

function BuyTab({ state }: { state: GameState }) {
  const view = merchantView(state);
  const [selected, setSelected] = useState<{ slot: number; defId: string; anchor: AnchorRect } | null>(null);
  const { send, run, client } = useCommand();

  const slots = useMemo(
    () =>
      view.stock.map((l): SlotItem | null => {
        if (!l) return null;
        const def = defOf(l.defId);
        return { defId: l.defId, name: def.name, quantity: def.stackable ? l.quantity : undefined, stackable: def.stackable, rarity: l.rarity };
      }),
    [view.stock],
  );
  const open = useCallback(
    (key: string | number, anchor: AnchorRect) => {
      const listing = view.stock[Number(key)];
      if (listing) setSelected({ slot: Number(key), defId: listing.defId, anchor });
    },
    [view.stock],
  );
  const close = useCallback(() => setSelected(null), []);
  const hitTest = useSlotHitTest(selected);
  const outsidePress = (p: { x: number; y: number }) =>
    hitTest.press(p, (hit) => {
      if (hit.id === selected?.slot) return false;
      open(hit.id, hit.anchor);
      return true;
    });
  const prices = useMemo(() => view.stock.map((l) => (l ? `${formatNumber(l.unitPrice)}g` : '')), [view.stock]);

  /** Refusals and save failures show in a GameDialog. */
  const refresh = () => {
    setSelected(null);
    void send({ type: 'REFRESH_MERCHANT' });
  };

  /** Debug, hold to repeat (stops when the charges are full). */
  const addCharge = useCallback(({ repeat }: { repeat: boolean }) => run(() => client.debug.addMerchantCharge(), { quiet: repeat }), [client, run]);

  // The sheet follows the live stock: it closes when the slot is bought out or restocked with something else.
  const listing = selected ? view.stock[selected.slot] : null;
  const live = selected && listing && listing.defId === selected.defId ? { slot: selected.slot, listing, anchor: selected.anchor } : null;

  return (
    <ScrollView ref={hitTest.viewportRef} contentContainerStyle={styles.content}>
      <Text style={styles.caption}>The merchant's wares</Text>
      <StockGrid slots={slots} prices={prices} onPress={open} hitTest={hitTest} />
      <View style={styles.refreshRow}>
        <PixelButton
          label={`Refresh (${view.charges}/${view.maxCharges})`}
          sublabel={view.full ? 'Charges full' : `+1 in ${formatHms(view.nextInMs)}`}
          disabled={view.charges <= 0}
          onPress={refresh}
          accessibilityHint="Spends one charge and restocks the merchant"
          stretch
        />
      </View>
      {DEV_TOOLS_ENABLED ? (
        <View style={styles.refreshRow}>
          <PixelButton label="+1 merchant refresh (debug)" repeat={addCharge} disabled={view.full} stretch />
        </View>
      ) : null}
      <UpgradeEntry buildingId="merchant" />
      {live ? <BuySheet state={state} slot={live.slot} anchor={live.anchor} onClose={close} onOutsidePress={outsidePress} /> : null}
    </ScrollView>
  );
}

type OutsidePress = (p: { x: number; y: number }) => boolean | Promise<boolean>;

/** Stays mounted while the player moves between items (so the popover only moves, no close / fade): per-item state is keyed. */
function BuySheet({ state, slot, anchor, onClose, onOutsidePress }: { state: GameState; slot: number; anchor: AnchorRect; onClose: () => void; onOutsidePress: OutsidePress }) {
  const listing = state.merchant.stock[slot]!;
  const def = defOf(listing.defId);
  const max = maxBuyable(state, slot);
  const scope = `${slot}-${listing.defId}`;
  const [qtyState, setQtyState] = useState({ scope, qty: 1 });
  const qty = qtyState.scope === scope ? qtyState.qty : 1;
  const setQty = (n: number) => setQtyState({ scope, qty: n });
  const quantity = Math.max(1, Math.min(qty, Math.max(1, max)));
  const total = listing.unitPrice * quantity;
  const { busy, error, send } = useSend(onClose, scope);

  let blocked: string | undefined;
  if (max < 1) {
    blocked = slotsNeeded(state, def.id, 1) > freeSlots(state.inventory) ? 'Inventory full' : 'Not enough gold';
  }
  const equipped = def.slot ? state.character.equipment[def.slot] : undefined;

  return (
    <ItemSheet
      item={listing}
      anchor={anchor}
      quantity={listing.quantity}
      equipped={def.slot ? (equipped ?? null) : undefined}
      error={error}
      onClose={onClose}
      onOutsidePress={onOutsidePress}
      actions={[
        {
          label: 'Buy',
          sublabel: blocked ?? `${formatNumber(total)} gold`,
          disabled: busy || !!blocked,
          onPress: () => send({ type: 'BUY_ITEM', slot, defId: listing.defId, quantity, maxUnitPrice: listing.unitPrice }, !def.stackable || quantity >= listing.quantity),
        },
      ]}
    >
      <SheetRow icon="gold" label="Price" value={`${formatNumber(listing.unitPrice)}${def.stackable ? ' each' : ''}`} />
      <SheetRow label="In stock" value={formatNumber(listing.quantity)} />
      {def.stackable && max > 1 ? <QuantityStepper value={quantity} max={max} onChange={setQty} /> : null}
      <SheetRow icon="gold" label="Total" value={formatNumber(total)} strong />
    </ItemSheet>
  );
}

// ---------- Sell ----------

function SellTab({ state }: { state: GameState }) {
  const { inventory, buildings } = state;
  const [selected, setSelected] = useState<{ id: string; anchor: AnchorRect } | null>(null);
  const slots = useMemo(() => Array.from({ length: inventory.capacity }, (_, i): Item | null => inventory.items[i] ?? null), [inventory]);
  const prices = useMemo(
    () =>
      slots.map((item) => {
        if (!item) return '';
        // Catalog price plus the Town Hall bonus, as the engine pays it.
        const price = sellPriceOfItem({ buildings }, item);
        return price > 0 ? `${formatNumber(price)}g` : '—';
      }),
    [slots, buildings],
  );
  const open = useCallback((key: string | number, anchor: AnchorRect) => setSelected({ id: String(key), anchor }), []);
  const close = useCallback(() => setSelected(null), []);
  const hitTest = useSlotHitTest(selected);
  const outsidePress = (p: { x: number; y: number }) =>
    hitTest.press(p, (hit) => {
      if (hit.id === selected?.id) return false;
      open(hit.id, hit.anchor);
      return true;
    });
  const item = selected ? inventory.items.find((i) => i.id === selected.id) : undefined;

  return (
    <ScrollView ref={hitTest.viewportRef} contentContainerStyle={styles.content}>
      <Text style={styles.caption}>
        Your inventory {inventory.items.length}/{inventory.capacity} · equipped gear must be unequipped first
      </Text>
      <StockGrid slots={slots} prices={prices} onPress={open} keyOf={inventoryKey} hitTest={hitTest} />
      {item && selected ? <SellSheet item={item} anchor={selected.anchor} unitPrice={sellPriceOfItem({ buildings }, item)} onClose={close} onOutsidePress={outsidePress} /> : null}
    </ScrollView>
  );
}

/** Sell-tab slots hold inventory Items: tapping one opens it by item id. */
const inventoryKey = (item: SlotItem | null, i: number): string | number => (item as Item | null)?.id ?? i;

function SellSheet({ item, anchor, unitPrice, onClose, onOutsidePress }: { item: Item; anchor: AnchorRect; unitPrice: number; onClose: () => void; onOutsidePress: OutsidePress }) {
  const def = defOf(item.defId, item);
  const owned = item.stackable ? (item.quantity ?? 0) : 1;
  const [qtyState, setQtyState] = useState({ scope: item.id, qty: 1 });
  const qty = qtyState.scope === item.id ? qtyState.qty : 1;
  const setQty = (n: number) => setQtyState({ scope: item.id, qty: n });
  const quantity = Math.max(1, Math.min(qty, owned));
  const { busy, error, send } = useSend(onClose, item.id);
  const dialog = useDialog();
  const sellable = unitPrice > 0;
  // A Potion Belt keeps its potions when unequipped; selling it destroys them, so the player confirms first.
  const sell = async () => {
    const inside = beltPotionCount(item);
    if (inside > 0) {
      const ok = await dialog.confirm({
        title: `Sell the ${def.name}?`,
        message: `${inside} ${inside === 1 ? 'potion' : 'potions'} inside will be lost. Take them out first (wear the belt, then Remove) to keep them.`,
        confirmLabel: 'Sell anyway',
        destructive: true,
      });
      if (!ok) return;
    }
    send({ type: 'SELL_ITEM', itemId: item.id, quantity }, quantity >= owned);
  };

  return (
    <ItemSheet
      item={item}
      anchor={anchor}
      quantity={item.quantity}
      error={error}
      onClose={onClose}
      onOutsidePress={onOutsidePress}
      actions={[
        {
          label: 'Sell',
          sublabel: sellable ? `${formatNumber(unitPrice * quantity)} gold` : def.sellable === false ? 'Not sold' : 'Not wanted',
          disabled: busy || !sellable,
          onPress: () => void sell(),
        },
      ]}
    >
      {def.sellable === false ? <PopoverText tone="note">The Merchant does not buy this. It is kept for crafting.</PopoverText> : null}
      {owned > 1 ? <QuantityStepper value={quantity} max={owned} onChange={setQty} /> : null}
      {unitPrice !== baseSellPrice(item) ? <SheetRow icon="gold" label="Price" value={`${formatNumber(unitPrice)} (Town Hall bonus)`} /> : null}
      <SheetRow icon="gold" label="Total" value={formatNumber(unitPrice * quantity)} strong />
    </ItemSheet>
  );
}

// ---------- Grid ----------

type GridProps = {
  slots: (SlotItem | null)[];
  prices: string[];
  onPress: (key: string | number, anchor: AnchorRect) => void;
  /** Key passed to onPress for a filled slot (default: the slot index). */
  keyOf?: (item: SlotItem | null, index: number) => string | number;
  hitTest: SlotHitTest;
};

const StockGrid = memo(function StockGrid({ slots, prices, onPress, keyOf, hitTest }: GridProps) {
  return (
    <View style={styles.grid}>
      {slots.map((item, i) => (
        <View key={i} style={styles.cell}>
          <ItemSlot
            item={item}
            size={52}
            caption={prices[i] || ' '}
            pressKey={keyOf ? keyOf(item, i) : i}
            onPress={onPress}
            hitTest={hitTest}
            hint={prices[i] ? `, ${prices[i].replace('g', ' gold')}` : undefined}
          />
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  gold: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.gold },
  tabs: { flexDirection: 'row', gap: 10 },
  content: { padding: 12, paddingBottom: 32, gap: 12 },
  caption: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  cell: { padding: 3 },
  refreshRow: { flexDirection: 'row' },
});
