// Village → Storage. Two item grids on one screen: the storage on top (about 60% of the room, scrolls) and the bag below (about 40%, scrolls),
// a bar between them with Deposit all / Deposit stacked. Hold an item, then drag it onto a cell of either grid, or onto a section (not a
// cell) to send it to that container's stack / first free cell; tap an item for its info box with Deposit / Withdraw (the whole stack).
// The rules are the engine's (storage.ts `planMove` through `dropCommand` / STORAGE_MOVE, DEPOSIT_ALL, DEPOSIT_STACKED); this file only
// shows them. The drag is the shared kit (ui/drag/dragKit.tsx), its box numbering is storageDrag.ts.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useGameClient, useGameState } from '../../client/GameProvider';
import { depositedOf } from '../../client/dispatchEvents';
import type { CommandInput } from '../../client/types';
import { bagCells, canMove, dropCommand, type Item, type Side, storageView } from '../../engine';
import { colors, fonts } from '../../theme';
import { UpgradeEntry } from '../buildings/UpgradeEntry';
import { defOf } from '../items/itemInfo';
import { ItemSheet, type SheetAction } from '../items/ItemSheet';
import { ItemSlot } from '../items/ItemSlot';
import { ModalScreen } from '../ModalScreen';
import { PixelButton } from '../PixelButton';
import { DragGhost, type DragHandlers, DropHighlight, type DragSurface, useDragSurface } from '../ui/drag/dragKit';
import { type AnchorRect } from '../ui/InfoPopover';
import { useCommand } from '../ui/useCommand';
import { type SlotHit, type SlotHitTest, useSlotHitTest } from '../ui/useSlotHitTest';
import { CELL, gridColumns, SCREEN_PAD } from './storageLayout';
import { acceptingBoxes, bagCellBox, boxTarget, CLIP_BAG, CLIP_COUNT, CLIP_STORAGE, clipSlotOf, dragIdOf, dropBoxCount, noBoxes, parseDragId, sectionBox, storageCellBox } from './storageDrag';

const NOTICE_MS = 3200;

/** The tapped item: which container, its id there (stackable ids are the same in both), and the slot's box on screen. */
type Selection = { side: Side; itemId: string; anchor: AnchorRect };

type OutsidePress = (p: { x: number; y: number }) => boolean | Promise<boolean>;

export function StorageModal() {
  const state = useGameState();
  const { storage, inventory, buildings } = state;
  const view = useMemo(() => storageView({ storage, inventory, buildings }), [storage, inventory, buildings]);
  const storageCap = view.capacity;
  const bagCap = view.bagCapacity;

  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );
  const showNotice = useCallback((text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const open = useCallback((key: string | number, anchor: AnchorRect) => {
    const source = parseDragId(String(key));
    if (source.kind === 'slot') return;
    setSelection({ side: source.kind, itemId: source.itemId, anchor });
  }, []);
  const close = useCallback(() => setSelection(null), []);

  // One hit-test per grid: each has its own scroll viewport, and a slot scrolled out of its grid must not catch a tap meant for the other.
  const storageHit = useSlotHitTest(selection);
  const bagHit = useSlotHitTest(selection);
  const outsidePress: OutsidePress = (p) => {
    const apply = (hit: SlotHit) => {
      const source = parseDragId(String(hit.id));
      if (source.kind === 'slot') return false;
      if (selection && selection.side === source.kind && selection.itemId === source.itemId) return false;
      open(hit.id, hit.anchor);
      return true;
    };
    const first = storageHit.press(p, apply);
    const next = (hit: boolean) => (hit ? true : bagHit.press(p, apply));
    return typeof first === 'boolean' ? next(first) : first.then(next);
  };

  // ---- drag: the kit does the gesture, ghost and highlight on the UI thread; here only the rules' side (which boxes accept, what a drop sends) ----
  const surface = useDragSurface(dropBoxCount(storageCap, bagCap), false, CLIP_COUNT);
  const stateRef = useRef(state);
  stateRef.current = state;
  const capsRef = useRef({ storageCap, bagCap });
  capsRef.current = { storageCap, bagCap };
  surface.clipOf.current = (index) => clipSlotOf(index, capsRef.current.storageCap, capsRef.current.bagCap);
  const { send, sendForResult } = useCommand();
  const sendRef = useRef(send);
  sendRef.current = send;
  const dragHandlers = useMemo<DragHandlers>(
    () => ({
      onStart: (id, icon) => {
        const { storageCap: s, bagCap: b } = capsRef.current;
        surface.ghostIcon.current?.(icon);
        surface.allowed.set(acceptingBoxes(stateRef.current, parseDragId(id), s, b));
        surface.measure();
      },
      onDrop: (id, box) => {
        const { storageCap: s, bagCap: b } = capsRef.current;
        const target = boxTarget(box, s, b);
        const command = target ? dropCommand(stateRef.current, parseDragId(id), target) : null;
        if (command) void sendRef.current(command);
      },
      onEnd: () => {
        const { storageCap: s, bagCap: b } = capsRef.current;
        surface.allowed.set(noBoxes(dropBoxCount(s, b)));
      },
    }),
    [surface],
  );
  // The layout moved under the boxes (an upgrade added cells): measure them again once it is laid out.
  useEffect(() => {
    const frame = requestAnimationFrame(surface.measure);
    return () => cancelAnimationFrame(frame);
  }, [storageCap, surface]);

  const depositAll = useCallback(async () => {
    setSelection(null);
    const res = await sendForResult({ type: 'DEPOSIT_ALL' });
    const out = res ? depositedOf(res) : null;
    if (out && out.stayed > 0) showNotice(`Storage full: ${out.stayed} ${out.stayed === 1 ? 'item' : 'items'} stayed in your bag`);
  }, [sendForResult, showNotice]);
  const depositStacked = useCallback(() => {
    setSelection(null);
    void send({ type: 'DEPOSIT_STACKED' });
  }, [send]);

  const storageSection = useCallback((node: Parameters<DragSurface['setTarget']>[1]) => surface.setTarget(sectionBox('storage', storageCap, bagCap), node), [surface, storageCap, bagCap]);
  const bagSection = useCallback((node: Parameters<DragSurface['setTarget']>[1]) => surface.setTarget(sectionBox('bag', storageCap, bagCap), node), [surface, storageCap, bagCap]);
  const storageClip = useCallback((node: Parameters<DragSurface['setClip']>[1]) => surface.setClip(CLIP_STORAGE, node), [surface]);
  const bagClip = useCallback((node: Parameters<DragSurface['setClip']>[1]) => surface.setClip(CLIP_BAG, node), [surface]);

  const bagSlots = useMemo(() => bagCells(inventory), [inventory]);
  const { all, stacked } = view.deposit;

  return (
    <ModalScreen title="Storage" buildingId="storage" closeLabel="Close storage">
      <View style={styles.root}>
        <View ref={storageSection} collapsable={false} style={[styles.section, styles.storageSection]}>
          <Text style={styles.header} accessibilityRole="header">{`Storage ${view.used} / ${view.capacity}`}</Text>
          <View ref={storageClip} collapsable={false} style={styles.scrollWrap}>
            <ScrollView ref={storageHit.viewportRef} contentContainerStyle={styles.scrollContent}>
              <CellGrid cells={view.cells} side="storage" boxBase={0} onPress={open} hitTest={storageHit} drag={surface} dragHandlers={dragHandlers} />
              <UpgradeEntry buildingId="storage" />
            </ScrollView>
          </View>
          <DropHighlight surface={surface} index={sectionBox('storage', storageCap, bagCap)} />
        </View>

        <View style={styles.bar}>
          <PixelButton
            label="Deposit all"
            sublabel={all.reason ?? `${all.moves} to move`}
            disabled={all.reason !== null}
            onPress={depositAll}
            stretch
            accessibilityLabel={all.reason ? `Deposit all, ${all.reason}` : `Deposit all, ${all.moves} to move`}
            accessibilityHint="Moves everything in the bag into the storage, except what you wear and the potion belt"
          />
          <PixelButton
            label="Deposit stacked"
            sublabel={stacked.reason ?? `${stacked.moves} to merge`}
            disabled={stacked.reason !== null}
            onPress={depositStacked}
            stretch
            accessibilityLabel={stacked.reason ? `Deposit stacked, ${stacked.reason}` : `Deposit stacked, ${stacked.moves} to merge`}
            accessibilityHint="Adds the bag's stacks to the matching stacks already in the storage"
          />
        </View>

        <View ref={bagSection} collapsable={false} style={[styles.section, styles.bagSection]}>
          <Text style={styles.header} accessibilityRole="header">{`Bag ${view.bagUsed} / ${view.bagCapacity}`}</Text>
          <View ref={bagClip} collapsable={false} style={styles.scrollWrap}>
            <ScrollView ref={bagHit.viewportRef} contentContainerStyle={styles.scrollContent}>
              <CellGrid cells={bagSlots} side="bag" boxBase={storageCap} onPress={open} hitTest={bagHit} drag={surface} dragHandlers={dragHandlers} />
            </ScrollView>
          </View>
          <DropHighlight surface={surface} index={sectionBox('bag', storageCap, bagCap)} />
        </View>

        {notice ? (
          <View style={styles.notice} pointerEvents="none" accessibilityLiveRegion="polite">
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}
        {/* The ghost that follows the finger: a layer over the screen that takes no touches (the kit places the ghost in it). */}
        <View ref={surface.layerRef} style={styles.dragLayer} pointerEvents="none" collapsable={false}>
          <DragGhost surface={surface} />
        </View>
      </View>
      <StorageItemSheet selection={selection} onClose={close} onOutsidePress={outsidePress} />
    </ModalScreen>
  );
}

type GridProps = {
  cells: readonly (Item | null)[];
  side: Side;
  /** Drop box index of this grid's first cell (storage cells are 0..n-1, bag cells follow). */
  boxBase: number;
  onPress: (key: string | number, anchor: AnchorRect) => void;
  hitTest: SlotHitTest;
  drag: DragSurface;
  dragHandlers: DragHandlers;
};

/** Every cell is a drop box, filled or not. Rows of whole cells, left-aligned, so the last row does not drift to the middle. */
const CellGrid = memo(function CellGrid({ cells, side, boxBase, onPress, hitTest, drag, dragHandlers }: GridProps) {
  const { width } = useWindowDimensions();
  const columns = gridColumns(width);
  return (
    <View style={[styles.grid, { width: columns * CELL }]}>
      {cells.map((item, i) => (
        <View key={i} style={styles.cell}>
          <ItemSlot
            item={item}
            size={52}
            pressKey={item ? dragIdOf(side, item.id) : undefined}
            onPress={onPress}
            hitTest={hitTest}
            drag={drag}
            dragIndex={side === 'storage' ? storageCellBox(i) : bagCellBox(i, boxBase)}
            dragHandlers={dragHandlers}
          />
        </View>
      ))}
    </View>
  );
});

/** The info box of a tapped item: Deposit (bag item) or Withdraw (storage item), the whole stack. Reads the live item, so it closes when the item leaves. */
function StorageItemSheet({ selection, onClose, onOutsidePress }: { selection: Selection | null; onClose: () => void; onOutsidePress: OutsidePress }) {
  const state = useGameState();
  const client = useGameClient();
  const scope = selection ? `${selection.side}:${selection.itemId}` : '';
  const [errorState, setErrorState] = useState<{ scope: string; message: string } | null>(null);
  const error = errorState && errorState.scope === scope ? errorState.message : null;
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const busy = busyScope === scope;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const item: Item | undefined = selection ? (selection.side === 'storage' ? state.storage.items : state.inventory.items).find((i) => i.id === selection.itemId) : undefined;
  const def = item ? defOf(item.defId, item) : null;

  const close = () => {
    setErrorState(null);
    onClose();
  };
  const send = (cmd: CommandInput) => {
    if (busy) return;
    const at = scope;
    setBusyScope(at);
    setErrorState(null);
    client
      .dispatch(cmd)
      .then((res) => {
        if (!res.ok) setErrorState({ scope: at, message: res.error.message });
        else if (scopeRef.current === at) close();
      })
      .catch((err: unknown) => setErrorState({ scope: at, message: err instanceof Error ? err.message : String(err) }))
      .finally(() => setBusyScope((b) => (b === at ? null : b)));
  };

  const actions: SheetAction[] = [];
  if (item && def && selection) {
    const toBag = selection.side === 'storage';
    const to: Side = toBag ? 'bag' : 'storage';
    const fits = canMove(state, selection.side, item.id, to);
    actions.push({
      label: toBag ? 'Withdraw' : 'Deposit',
      disabled: busy || !fits,
      sublabel: fits ? undefined : toBag ? 'Bag full' : 'Storage full',
      onPress: () => send({ type: 'STORAGE_MOVE', from: selection.side, itemId: item.id, to }),
    });
  }

  return <ItemSheet item={item ?? null} anchor={selection?.anchor ?? null} quantity={item?.quantity} actions={actions} error={error} onClose={close} onOutsidePress={onOutsidePress} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: SCREEN_PAD, paddingTop: 8, gap: 8 },
  section: { minHeight: 0, borderWidth: 3, borderColor: colors.woodDark, backgroundColor: 'rgba(10, 6, 3, 0.35)' },
  // About 60 / 40 of what the bar leaves.
  storageSection: { flex: 6 },
  bagSection: { flex: 4 },
  header: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.parchment, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 2 },
  scrollWrap: { flex: 1 },
  scrollContent: { paddingBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'center' },
  cell: { padding: 3 },
  bar: { flexDirection: 'row', gap: 8 },
  notice: {
    position: 'absolute',
    left: SCREEN_PAD,
    right: SCREEN_PAD,
    bottom: 12,
    alignItems: 'center',
  },
  noticeText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.parchment,
    borderWidth: 3,
    borderColor: colors.woodDark,
    paddingHorizontal: 14,
    paddingVertical: 6,
    textAlign: 'center',
  },
  dragLayer: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 40, elevation: 40 },
});
