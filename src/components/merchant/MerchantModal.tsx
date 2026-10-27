// Village → Merchant. Buy | Sell tabs over a stock grid styled like the inventory. Reads merchantView() and
// the inventory; dispatches BUY_ITEM / SELL_ITEM / REFRESH_MERCHANT. The merchant is not an activity, so
// nothing here stops what the hero is doing.
import { memo, useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGameClient, useGameState } from '../../client/GameProvider';
import type { CommandInput } from '../../client/types';
import { DEV_TOOLS_ENABLED, freeSlots, type GameState, type Item, maxBuyable, merchantView, slotsNeeded } from '../../engine';
import { colors, fonts } from '../../theme';
import { formatHms, formatNumber } from '../format';
import { defOf } from '../items/itemInfo';
import { ItemSheet, SheetRow } from '../items/ItemSheet';
import { ItemSlot, type SlotItem } from '../items/ItemSlot';
import { QuantityStepper } from '../items/QuantityStepper';
import { ModalScreen } from '../ModalScreen';
import { PixelButton } from '../PixelButton';

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
      closeLabel="Close merchant"
      headerRight={
        <Text style={styles.gold} accessibilityLabel={`${formatNumber(gold)} gold`}>
          🪙 {formatNumber(gold)}
        </Text>
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

/** Dispatch with a busy flag and an inline error; stale-screen errors just close the sheet. */
function useSend(onDone: () => void) {
  const client = useGameClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = useCallback(
    (cmd: CommandInput, closeAfter = true) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      client
        .dispatch(cmd)
        .then((res) => {
          if (res.ok) {
            if (closeAfter) onDone();
          } else if (STALE.has(res.error.code)) onDone();
          else setError(res.error.message);
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setBusy(false));
    },
    [busy, client, onDone],
  );
  return { busy, error, setError, send };
}

// ---------- Buy ----------

function BuyTab({ state }: { state: GameState }) {
  const client = useGameClient();
  const view = merchantView(state);
  const [selected, setSelected] = useState<{ slot: number; defId: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const slots = useMemo(
    () =>
      view.stock.map((l): SlotItem | null => {
        if (!l) return null;
        const def = defOf(l.defId);
        return { defId: l.defId, icon: def.icon, name: def.name, quantity: def.stackable ? l.quantity : undefined, stackable: def.stackable };
      }),
    [view.stock],
  );
  const open = useCallback(
    (key: string | number) => {
      const listing = view.stock[Number(key)];
      if (listing) setSelected({ slot: Number(key), defId: listing.defId });
    },
    [view.stock],
  );
  const close = useCallback(() => setSelected(null), []);

  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    setSelected(null);
    client
      .dispatch({ type: 'REFRESH_MERCHANT' })
      .then((res) => {
        if (!res.ok) Alert.alert('Not possible', res.error.message);
      })
      .catch((err: unknown) => Alert.alert('Refresh failed', err instanceof Error ? err.message : String(err)))
      .finally(() => setRefreshing(false));
  };

  const addCharge = () => {
    client.debug.addMerchantCharge().then(
      (res) => {
        if (!res.ok) Alert.alert('Not possible', res.error.message);
      },
      (err: unknown) => Alert.alert('Debug action failed', err instanceof Error ? err.message : String(err)),
    );
  };

  // The sheet follows the live stock: it closes when the slot is bought out or restocked with something else.
  const listing = selected ? view.stock[selected.slot] : null;
  const live = selected && listing && listing.defId === selected.defId ? { slot: selected.slot, listing } : null;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.caption}>The merchant's wares</Text>
      <StockGrid slots={slots} prices={view.stock.map((l) => (l ? `${formatNumber(l.unitPrice)}g` : ''))} onPress={open} />
      <View style={styles.refreshRow}>
        <PixelButton
          label={`Refresh (${view.charges}/${view.maxCharges})`}
          sublabel={view.full ? 'Charges full' : `+1 in ${formatHms(view.nextInMs)}`}
          disabled={refreshing || view.charges <= 0}
          onPress={refresh}
          accessibilityHint="Spends one charge and restocks the merchant"
          stretch
        />
      </View>
      {DEV_TOOLS_ENABLED ? (
        <View style={styles.refreshRow}>
          <PixelButton label="+1 merchant refresh (debug)" onPress={addCharge} disabled={view.full} stretch />
        </View>
      ) : null}
      {live ? <BuySheet key={`${live.slot}-${live.listing.defId}`} state={state} slot={live.slot} onClose={close} /> : null}
    </ScrollView>
  );
}

function BuySheet({ state, slot, onClose }: { state: GameState; slot: number; onClose: () => void }) {
  const listing = state.merchant.stock[slot]!;
  const def = defOf(listing.defId);
  const max = maxBuyable(state, slot);
  const [qty, setQty] = useState(1);
  const quantity = Math.max(1, Math.min(qty, Math.max(1, max)));
  const total = listing.unitPrice * quantity;
  const { busy, error, send } = useSend(onClose);

  let blocked: string | undefined;
  if (max < 1) {
    blocked = slotsNeeded(state, def.id, 1) > freeSlots(state.inventory) ? 'Inventory full' : 'Not enough gold';
  }
  const equipped = def.slot ? state.character.equipment[def.slot] : undefined;

  return (
    <ItemSheet
      def={def}
      quantity={listing.quantity}
      equipped={def.slot ? (equipped ? defOf(equipped.defId, equipped) : null) : undefined}
      error={error}
      onClose={onClose}
      actions={[
        {
          label: 'Buy',
          sublabel: blocked ?? `${formatNumber(total)} gold`,
          disabled: busy || !!blocked,
          onPress: () => send({ type: 'BUY_ITEM', slot, defId: listing.defId, quantity, maxUnitPrice: listing.unitPrice }, !def.stackable || quantity >= listing.quantity),
        },
      ]}
    >
      <SheetRow label="Price" value={`🪙 ${formatNumber(listing.unitPrice)}${def.stackable ? ' each' : ''}`} />
      <SheetRow label="In stock" value={formatNumber(listing.quantity)} />
      {def.stackable && max > 1 ? <QuantityStepper value={quantity} max={max} onChange={setQty} /> : null}
      <SheetRow label="Total" value={`🪙 ${formatNumber(total)}`} strong />
    </ItemSheet>
  );
}

// ---------- Sell ----------

function SellTab({ state }: { state: GameState }) {
  const { inventory } = state;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const slots = useMemo(() => Array.from({ length: inventory.capacity }, (_, i): Item | null => inventory.items[i] ?? null), [inventory]);
  const prices = useMemo(
    () =>
      slots.map((item) => {
        if (!item) return '';
        const price = defOf(item.defId, item).sellPrice;
        return price > 0 ? `${formatNumber(price)}g` : '—';
      }),
    [slots],
  );
  const open = useCallback((key: string | number) => setSelectedId(String(key)), []);
  const close = useCallback(() => setSelectedId(null), []);
  const item = selectedId ? inventory.items.find((i) => i.id === selectedId) : undefined;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.caption}>
        Your inventory {inventory.items.length}/{inventory.capacity} · equipped gear must be unequipped first
      </Text>
      <StockGrid slots={slots} prices={prices} onPress={open} keyOf={inventoryKey} />
      {item ? <SellSheet key={item.id} item={item} onClose={close} /> : null}
    </ScrollView>
  );
}

/** Sell-tab slots hold inventory Items: tapping one opens it by item id. */
const inventoryKey = (item: SlotItem | null, i: number): string | number => (item as Item | null)?.id ?? i;

function SellSheet({ item, onClose }: { item: Item; onClose: () => void }) {
  const def = defOf(item.defId, item);
  const owned = item.stackable ? (item.quantity ?? 0) : 1;
  const [qty, setQty] = useState(1);
  const quantity = Math.max(1, Math.min(qty, owned));
  const { busy, error, send } = useSend(onClose);
  const sellable = def.sellPrice > 0;

  return (
    <ItemSheet
      def={def}
      quantity={item.quantity}
      error={error}
      onClose={onClose}
      actions={[
        {
          label: 'Sell',
          sublabel: sellable ? `${formatNumber(def.sellPrice * quantity)} gold` : 'Not wanted',
          disabled: busy || !sellable,
          onPress: () => send({ type: 'SELL_ITEM', itemId: item.id, quantity }, quantity >= owned),
        },
      ]}
    >
      {owned > 1 ? <QuantityStepper value={quantity} max={owned} onChange={setQty} /> : null}
      <SheetRow label="Total" value={`🪙 ${formatNumber(def.sellPrice * quantity)}`} strong />
    </ItemSheet>
  );
}

// ---------- Grid ----------

type GridProps = {
  slots: (SlotItem | null)[];
  prices: string[];
  onPress: (key: string | number) => void;
  /** Key passed to onPress for a filled slot (default: the slot index). */
  keyOf?: (item: SlotItem | null, index: number) => string | number;
};

const StockGrid = memo(function StockGrid({ slots, prices, onPress, keyOf }: GridProps) {
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
