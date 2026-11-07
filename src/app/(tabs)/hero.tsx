import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameClient, useGameState } from '../../client/GameProvider';
import { ACTIVITY_STRIP_HEIGHT } from '../../components/ActivityStrip';
import { DebugPanel } from '../../components/DebugPanel';
import { formatNumber } from '../../components/format';
import { IconText, SkillIcon } from '../../components/art/Sprites';
import { defOf, SLOT_LABELS } from '../../components/items/itemInfo';
import { ItemSheet, type SheetAction } from '../../components/items/ItemSheet';
import { acceptingBoxes, boxTarget, COMBAT_GRID, dropBoxCount, type EquipmentTab, noBoxes, parseDragId, slotBox, slotDragId, tabOfSlot, TOOLS_GRID } from '../../components/items/heroDrag';
import { ItemSlot } from '../../components/items/ItemSlot';
import { DragGhost, type DragHandlers, type DragSurface, useDragSurface } from '../../components/ui/drag/dragKit';
import { useCommand } from '../../components/ui/useCommand';
import { type SlotHitTest, useSlotHitTest } from '../../components/ui/useSlotHitTest';
import type { AnchorRect } from '../../components/ui/InfoPopover';
import { Bar, Panel } from '../../components/Panel';
import { PixelButton } from '../../components/PixelButton';
import { StatusPanel } from '../../components/StatusPanel';
import { type CommandInput } from '../../client/types';
import { bagCells, dropCommand, freeSlots, hpView, potionCooldownLeftMs } from '../../engine';
import { DEV_TOOLS_ENABLED } from '../../engine/config/dev';
import type { Character, EquipmentSlot, Inventory, Item, SkillKey } from '../../engine/types';
import { colors, fonts } from '../../theme';

const SKILL_LABELS: Record<SkillKey, string> = {
  woodcutting: 'Woodcutting',
  mining: 'Mining',
  fishing: 'Fishing',
};

/** What the item box shows: an inventory item (by id) or an equipment slot, anchored on the tapped slot. */
type Selection = ({ kind: 'inventory'; itemId: string } | { kind: 'equipment'; slot: EquipmentSlot }) & { anchor: AnchorRect };

export default function HeroScreen() {
  const state = useGameState();
  const { character, inventory, stamina, training } = state;
  const [selection, setSelection] = useState<Selection | null>(null);
  const openInventory = useCallback((key: string | number, anchor: AnchorRect) => setSelection({ kind: 'inventory', itemId: String(key), anchor }), []);
  const openEquipment = useCallback((key: string | number, anchor: AnchorRect) => setSelection({ kind: 'equipment', slot: key as EquipmentSlot, anchor }), []);
  const close = useCallback(() => setSelection(null), []);
  // A tap on another slot while the box is open moves the box there (no close / fade); the same slot closes it.
  const hitTest = useSlotHitTest(selection);

  // ---- drag (1.28.0): hold an item, drag it onto a bag cell or an equipment slot. The shared kit does the gesture, the ghost and the
  // highlight on the UI thread; here only the rules' side: which boxes accept (the engine's dropCommand) and what a drop sends. ----
  const surface = useDragSurface(dropBoxCount(inventory.capacity));
  const stateRef = useRef(state);
  stateRef.current = state;
  const { send } = useCommand();
  const sendRef = useRef(send);
  sendRef.current = send;
  /** The Equipment panel's tab setter, so a drag can bring the tab that holds the target slot on screen. */
  const showTab = useRef<((tab: EquipmentTab) => void) | null>(null);
  const dragHandlers = useMemo<DragHandlers>(
    () => ({
      onStart: (id, icon) => {
        const st = stateRef.current;
        const source = parseDragId(id);
        surface.ghostIcon.current?.(icon);
        surface.allowed.set(acceptingBoxes(st, source));
        // A piece from the bag may belong to the other tab (a tool while Combat shows): switch so its slot is there to drop on.
        const piece = source.kind === 'bag' ? st.inventory.items.find((i) => i.id === source.itemId) : undefined;
        if (piece?.slot) showTab.current?.(tabOfSlot(piece.slot));
        surface.measure();
      },
      onDrop: (id, box) => {
        const st = stateRef.current;
        const target = boxTarget(box, st.inventory.capacity);
        const command = target ? dropCommand(st, parseDragId(id), target) : null;
        if (command) void sendRef.current(command);
      },
      onEnd: () => surface.allowed.set(noBoxes(dropBoxCount(stateRef.current.inventory.capacity))),
    }),
    [surface],
  );
  const outsidePress = (p: { x: number; y: number }) =>
    hitTest.press(p, (hit) => {
      const equipment = typeof hit.id === 'string' && hit.id in SLOT_LABELS; // item ids contain '#', slot names do not
      if (selection && (equipment ? selection.kind === 'equipment' && selection.slot === hit.id : selection.kind === 'inventory' && selection.itemId === hit.id)) return false;
      (equipment ? openEquipment : openInventory)(hit.id, hit.anchor);
      return true;
    });

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <ScrollView ref={hitTest.viewportRef} contentContainerStyle={styles.content}>
        <HeaderPanel name={character.name} title={character.title} level={character.level} xp={character.xp} xpToNext={character.xpToNext} />
        <StatusPanel
          level={character.level}
          attributes={character.attributes}
          spentPoints={character.spentPoints}
          unspentPoints={character.unspentPoints}
          equipment={character.equipment}
          hp={character.hp}
          hpRegenProgress={character.hpRegenProgress}
          mana={character.mana}
          manaRegenProgress={character.manaRegenProgress}
          stamina={stamina}
          training={training}
        />
        <EquipmentPanel equipment={character.equipment} capacity={inventory.capacity} onPress={openEquipment} hitTest={hitTest} drag={surface} dragHandlers={dragHandlers} showTab={showTab} />
        <InventoryPanel inventory={inventory} gold={character.gold} onPress={openInventory} hitTest={hitTest} drag={surface} dragHandlers={dragHandlers} />
        <SkillsPanel skills={character.skills} />
        {DEV_TOOLS_ENABLED ? <DebugPanel /> : null}
      </ScrollView>
      {/* The ghost that follows the finger: a layer over the screen that takes no touches (the kit places the ghost in it). */}
      <View ref={surface.layerRef} style={styles.dragLayer} pointerEvents="none" collapsable={false}>
        <DragGhost surface={surface} />
      </View>
      <HeroItemSheet selection={selection} onClose={close} onOutsidePress={outsidePress} />
    </SafeAreaView>
  );
}

// Each panel is memoized on the slices it shows. simulate() keeps untouched slices by reference,
// so a woodcutting action re-renders Inventory and Skills, not Equipment. Status re-renders
// only when level, attributes, points, equipment, HP, mana, stamina or training change (HP, mana and stamina tick while
// they regenerate, training while an attribute trains). The Hero tab has no HUD: its Header panel shows the level and
// XP, Status the bars and the points to spend; gold is in the Inventory header.

const HeaderPanel = memo(function HeaderPanel({ name, title, level, xp, xpToNext }: { name: string; title: string; level: number; xp: number; xpToNext: number }) {
  return (
    <Panel>
      <Text style={styles.name}>{name}</Text>
      <Text style={styles.subtitle}>{`Level ${level} · ${title}`}</Text>
      <View style={styles.bars}>
        <Text style={styles.barCaption}>Experience</Text>
        <Bar value={xp} max={xpToNext} color={colors.xp} label={`${formatNumber(xp)} / ${formatNumber(xpToNext)} XP`} />
      </View>
    </Panel>
  );
});

type PressHandler = (key: string | number, anchor: AnchorRect) => void;

type DragProps = { drag: DragSurface; dragHandlers: DragHandlers };

const EquipmentPanel = memo(function EquipmentPanel({
  equipment,
  capacity,
  onPress,
  hitTest,
  drag,
  dragHandlers,
  showTab,
}: { equipment: Character['equipment']; capacity: number; onPress: PressHandler; hitTest: SlotHitTest; showTab: { current: ((tab: EquipmentTab) => void) | null } } & DragProps) {
  const [tab, setTab] = useState<EquipmentTab>('combat');
  const grid = tab === 'combat' ? COMBAT_GRID : TOOLS_GRID;
  useEffect(() => {
    showTab.current = setTab;
    return () => {
      showTab.current = null;
    };
  }, [showTab]);
  // The other tab changes this panel's height and so where the bag sits: measure the drop boxes again once it is laid out.
  const firstTab = useRef(true);
  useEffect(() => {
    if (firstTab.current) {
      firstTab.current = false;
      return;
    }
    const frame = requestAnimationFrame(drag.measure);
    return () => cancelAnimationFrame(frame);
  }, [tab, drag]);
  return (
    <Panel title="Equipment">
      <View style={styles.equipTabs}>
        <PixelButton label="Combat" active={tab === 'combat'} stretch onPress={() => setTab('combat')} accessibilityLabel="Combat equipment" />
        <PixelButton label="Tools" active={tab === 'tools'} stretch onPress={() => setTab('tools')} accessibilityLabel="Tools equipment" />
      </View>
      {grid.map((row, r) => (
        <View key={r} style={styles.equipRow}>
          {row.map((slot, c) =>
            slot ? (
              <View key={c} style={styles.equipCell}>
                <ItemSlot
                  item={equipment[slot]}
                  size={58}
                  pressKey={slot}
                  onPress={onPress}
                  hitTest={hitTest}
                  placeholder={slot === 'accessory' ? 'slot_accessory' : undefined}
                  drag={drag}
                  dragIndex={slotBox(slot, capacity)}
                  dragHandlers={dragHandlers}
                  dragId={slotDragId(slot)}
                />
                <Text style={styles.slotLabel} numberOfLines={1}>
                  {equipment[slot]?.name ?? SLOT_LABELS[slot]}
                </Text>
              </View>
            ) : (
              <View key={c} style={styles.equipCell} />
            ),
          )}
        </View>
      ))}
    </Panel>
  );
});

const InventoryPanel = memo(function InventoryPanel({ inventory, gold, onPress, hitTest, drag, dragHandlers }: { inventory: Inventory; gold: number; onPress: PressHandler; hitTest: SlotHitTest } & DragProps) {
  // The bag is a grid with gaps (1.28.0): every cell is its own drop box, filled or not.
  const slots = bagCells(inventory);
  return (
    <Panel
      title={`Inventory ${inventory.items.length}/${inventory.capacity} ·`}
      titleExtra={
        <IconText icon="gold" size={18} style={styles.goldText} accessibilityLabel={`${formatNumber(gold)} gold`}>
          {formatNumber(gold)}
        </IconText>
      }
    >
      <View style={styles.invGrid}>
        {slots.map((item, i) => (
          <View key={i} style={styles.invCell}>
            <ItemSlot item={item} size={52} pressKey={item?.id} onPress={onPress} hitTest={hitTest} drag={drag} dragIndex={i} dragHandlers={dragHandlers} />
          </View>
        ))}
      </View>
    </Panel>
  );
});

const SkillsPanel = memo(function SkillsPanel({ skills }: { skills: Character['skills'] }) {
  return (
    <Panel title="Skills">
      {(Object.keys(SKILL_LABELS) as SkillKey[]).map((k) => {
        const s = skills[k];
        return (
          <View key={k} style={styles.skillRow}>
            <IconText image={<SkillIcon skill={k} />} style={styles.skillName}>
              {SKILL_LABELS[k]} <Text style={styles.skillLevel}>Lv {s.level}</Text>
            </IconText>
            <Bar value={s.xp} max={s.xpToNext} color={colors.skill} label={`${formatNumber(s.xp)} / ${formatNumber(s.xpToNext)}`} />
          </View>
        );
      })}
    </Panel>
  );
});

/**
 * Item info box for the Hero tab (InfoPopover on the tapped slot): Equip for gear, Use for potions (inventory),
 * Unequip (equipment). Reads the item from the live state, so it closes by itself when the item leaves that place.
 */
function HeroItemSheet({ selection, onClose, onOutsidePress }: { selection: Selection | null; onClose: () => void; onOutsidePress: (p: { x: number; y: number }) => boolean | Promise<boolean> }) {
  const state = useGameState();
  const client = useGameClient();
  // The error belongs to the item it came from: switching to another item must not show it.
  const scope = selection ? (selection.kind === 'inventory' ? selection.itemId : selection.slot) : '';
  const [errorState, setErrorState] = useState<{ scope: string; message: string } | null>(null);
  const error = errorState && errorState.scope === scope ? errorState.message : null;
  const setError = (message: string | null) => setErrorState(message === null ? null : { scope, message });
  // Busy and the result's close belong to the item the command was sent for: if the player switched items meanwhile,
  // the result neither closes the new item's popover nor disables its buttons.
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const busy = busyScope === scope;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const item: Item | undefined =
    selection?.kind === 'inventory'
      ? state.inventory.items.find((i) => i.id === selection.itemId)
      : selection?.kind === 'equipment'
        ? state.character.equipment[selection.slot]
        : undefined;
  const def = item ? defOf(item.defId, item) : null;

  const close = () => {
    setError(null);
    onClose();
  };

  const send = (cmd: CommandInput, closeAfter: boolean) => {
    if (busy) return;
    const at = scope;
    setBusyScope(at);
    setError(null);
    client
      .dispatch(cmd)
      .then((res) => {
        if (!res.ok) setErrorState({ scope: at, message: res.error.message });
        else if (closeAfter && scopeRef.current === at) close();
      })
      .catch((err: unknown) => setErrorState({ scope: at, message: err instanceof Error ? err.message : String(err) }))
      .finally(() => setBusyScope((b) => (b === at ? null : b)));
  };

  const actions: SheetAction[] = [];
  let equipped: Item | null | undefined;
  if (item && def && selection?.kind === 'inventory') {
    if (def.slot && !def.stackable) {
      const current = state.character.equipment[def.slot];
      equipped = current ?? null;
      actions.push({
        label: 'Equip',
        disabled: busy,
        sublabel: current ? `swaps ${current.name}` : SLOT_LABELS[def.slot],
        onPress: () => send({ type: 'EQUIP_ITEM', itemId: item.id }, true),
      });
    } else if (def.heal) {
      const hp = hpView(state);
      // The potion's cooldown group (a drink of any potion of it starts it, the belt's too): the button waits it out, counting down.
      const cooldownS = Math.ceil(potionCooldownLeftMs(state, item.defId, state.time.lastSimulatedAt) / 1000);
      actions.push({
        label: 'Use',
        disabled: busy || hp.full || cooldownS > 0,
        sublabel: hp.full ? 'HP full' : cooldownS > 0 ? `Cooldown ${cooldownS}s` : `HP ${hp.hp}/${hp.maxHp}`,
        onPress: () => send({ type: 'USE_ITEM', itemId: item.id }, false),
      });
    }
  } else if (item && selection?.kind === 'equipment') {
    const full = freeSlots(state.inventory) < 1;
    actions.push({
      label: 'Unequip',
      disabled: busy || full,
      sublabel: full ? 'Inventory full' : undefined,
      onPress: () => send({ type: 'UNEQUIP_ITEM', slot: selection.slot }, true),
    });
  }

  return <ItemSheet item={item ?? null} anchor={selection?.anchor ?? null} quantity={item?.quantity} equipped={equipped} actions={actions} error={error} onClose={close} onOutsidePress={onOutsidePress} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.night },
  dragLayer: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 40, elevation: 40 },
  // Room for the activity strip that floats above the tab bar. The HUD above the scroll view keeps its own space.
  content: { padding: 12, paddingTop: 8, paddingBottom: 32 + ACTIVITY_STRIP_HEIGHT },

  name: { fontFamily: fonts.title, fontSize: 26, color: colors.ink, lineHeight: 32 },
  subtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  bars: { marginTop: 12, gap: 4 },
  barCaption: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.inkSoft, marginTop: 4 },

  equipTabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  equipRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  equipCell: { width: 84, alignItems: 'center' },
  slotLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft, marginTop: 3 },

  invGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  invCell: { padding: 3 },

  skillRow: { marginBottom: 10, gap: 4 },
  skillName: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  goldText: { fontFamily: fonts.title, fontSize: 20, color: colors.ink },
  skillLevel: { fontFamily: fonts.bodyBold, color: colors.skill },
});
