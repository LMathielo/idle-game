import { memo, useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameClient, useGameState } from '../../client/GameProvider';
import { ACTIVITY_STRIP_HEIGHT } from '../../components/ActivityStrip';
import { DebugPanel } from '../../components/DebugPanel';
import { formatNumber } from '../../components/format';
import { defOf, SLOT_LABELS } from '../../components/items/itemInfo';
import { ItemSheet, type SheetAction } from '../../components/items/ItemSheet';
import { ItemSlot } from '../../components/items/ItemSlot';
import { Bar, Panel } from '../../components/Panel';
import { StatusPanel } from '../../components/StatusPanel';
import { type CommandInput } from '../../client/types';
import { freeSlots, hpView } from '../../engine';
import { DEV_TOOLS_ENABLED } from '../../engine/config/dev';
import type { Character, EquipmentSlot, Inventory, Item, SkillKey } from '../../engine/types';
import { colors, fonts } from '../../theme';

const SKILL_LABELS: Record<SkillKey, { label: string; icon: string }> = {
  woodcutting: { label: 'Woodcutting', icon: '🪓' },
  mining: { label: 'Mining', icon: '⛏️' },
  fishing: { label: 'Fishing', icon: '🎣' },
  smithing: { label: 'Smithing', icon: '🔨' },
};

// Paper-doll layout: 3 columns, null = empty cell
const EQUIPMENT_GRID: (EquipmentSlot | null)[][] = [
  [null, 'helmet', 'amulet'],
  ['weapon', 'armor', 'shield'],
  ['ring1', 'gloves', 'ring2'],
  ['axe', 'boots', null],
];

/** What the item sheet shows: an inventory item (by id) or an equipment slot. */
type Selection = { kind: 'inventory'; itemId: string } | { kind: 'equipment'; slot: EquipmentSlot } | null;

export default function HeroScreen() {
  const { character, inventory, stamina, training } = useGameState();
  const [selection, setSelection] = useState<Selection>(null);
  const openInventory = useCallback((key: string | number) => setSelection({ kind: 'inventory', itemId: String(key) }), []);
  const openEquipment = useCallback((key: string | number) => setSelection({ kind: 'equipment', slot: key as EquipmentSlot }), []);
  const close = useCallback(() => setSelection(null), []);

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <HeaderPanel character={character} />
        <StatusPanel
          level={character.level}
          attributes={character.attributes}
          equipment={character.equipment}
          hp={character.hp}
          hpRegenProgress={character.hpRegenProgress}
          stamina={stamina}
          training={training}
        />
        <EquipmentPanel equipment={character.equipment} onPress={openEquipment} />
        <InventoryPanel inventory={inventory} onPress={openInventory} />
        <SkillsPanel skills={character.skills} />
        {DEV_TOOLS_ENABLED ? <DebugPanel /> : null}
      </ScrollView>
      <HeroItemSheet selection={selection} onClose={close} />
    </SafeAreaView>
  );
}

// Each panel is memoized on the slice it shows. simulate() keeps untouched slices by reference,
// so a woodcutting action re-renders Header, Inventory and Skills, not Equipment. Status re-renders
// only when level, attributes, equipment, HP, stamina or training change (HP and stamina tick while they
// regenerate, training while an attribute trains).

const HeaderPanel = memo(function HeaderPanel({ character }: { character: Character }) {
  return (
    <Panel>
      <View style={styles.headerRow}>
        <View style={styles.portrait}>
          <Text style={styles.portraitIcon}>🧔</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.name}>{character.name}</Text>
          <Text style={styles.subtitle}>
            Level {character.level} · {character.title}
          </Text>
          <Text style={styles.gold}>🪙 {formatNumber(character.gold)} gold</Text>
        </View>
      </View>
      <View style={styles.bars}>
        <Text style={styles.barCaption}>Experience</Text>
        <Bar
          value={character.xp}
          max={character.xpToNext}
          color={colors.xp}
          label={`${formatNumber(character.xp)} / ${formatNumber(character.xpToNext)}`}
        />
      </View>
    </Panel>
  );
});

type PressHandler = (key: string | number) => void;

const EquipmentPanel = memo(function EquipmentPanel({ equipment, onPress }: { equipment: Character['equipment']; onPress: PressHandler }) {
  return (
    <Panel title="Equipment">
      {EQUIPMENT_GRID.map((row, r) => (
        <View key={r} style={styles.equipRow}>
          {row.map((slot, c) =>
            slot ? (
              <View key={c} style={styles.equipCell}>
                <ItemSlot item={equipment[slot]} size={58} pressKey={slot} onPress={onPress} />
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

const InventoryPanel = memo(function InventoryPanel({ inventory, onPress }: { inventory: Inventory; onPress: PressHandler }) {
  const slots: (Item | undefined)[] = Array.from({ length: inventory.capacity }, (_, i) => inventory.items[i]);
  return (
    <Panel title={`Inventory  ${inventory.items.length}/${inventory.capacity}`}>
      <View style={styles.invGrid}>
        {slots.map((item, i) => (
          <View key={i} style={styles.invCell}>
            <ItemSlot item={item} size={52} pressKey={item?.id} onPress={onPress} />
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
            <Text style={styles.skillName}>
              {SKILL_LABELS[k].icon} {SKILL_LABELS[k].label} <Text style={styles.skillLevel}>Lv {s.level}</Text>
            </Text>
            <Bar value={s.xp} max={s.xpToNext} color={colors.skill} label={`${formatNumber(s.xp)} / ${formatNumber(s.xpToNext)}`} />
          </View>
        );
      })}
    </Panel>
  );
});

/**
 * Item info sheet for the Hero tab: Equip for gear, Use for potions (inventory), Unequip (equipment).
 * Reads the item from the live state, so it closes by itself when the item leaves that place.
 */
function HeroItemSheet({ selection, onClose }: { selection: Selection; onClose: () => void }) {
  const state = useGameState();
  const client = useGameClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    setError(null);
    client
      .dispatch(cmd)
      .then((res) => {
        if (!res.ok) setError(res.error.message);
        else if (closeAfter) close();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const actions: SheetAction[] = [];
  let equipped: ReturnType<typeof defOf> | null | undefined;
  if (item && def && selection?.kind === 'inventory') {
    if (def.slot && !def.stackable) {
      const current = state.character.equipment[def.slot];
      equipped = current ? defOf(current.defId, current) : null;
      actions.push({
        label: 'Equip',
        disabled: busy,
        sublabel: current ? `swaps ${current.name}` : SLOT_LABELS[def.slot],
        onPress: () => send({ type: 'EQUIP_ITEM', itemId: item.id }, true),
      });
    } else if (def.heal) {
      const hp = hpView(state);
      actions.push({
        label: 'Use',
        disabled: busy || hp.full,
        sublabel: hp.full ? 'HP full' : `HP ${hp.hp}/${hp.maxHp}`,
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

  return <ItemSheet def={def} quantity={item?.quantity} equipped={equipped} actions={actions} error={error} onClose={close} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.night },
  flex: { flex: 1 },
  // Room for the activity strip that floats above the tab bar.
  content: { padding: 12, paddingBottom: 32 + ACTIVITY_STRIP_HEIGHT },

  headerRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  portrait: {
    width: 64,
    height: 64,
    backgroundColor: colors.slot,
    borderWidth: 3,
    borderColor: colors.goldDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portraitIcon: { fontSize: 36 },
  name: { fontFamily: fonts.title, fontSize: 34, color: colors.ink, lineHeight: 36 },
  subtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  gold: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.goldDark, marginTop: 2 },
  bars: { marginTop: 12, gap: 4 },
  barCaption: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.inkSoft, marginTop: 4 },

  equipRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  equipCell: { width: 84, alignItems: 'center' },
  slotLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.inkSoft, marginTop: 3 },

  invGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  invCell: { padding: 3 },

  skillRow: { marginBottom: 10, gap: 4 },
  skillName: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  skillLevel: { fontFamily: fonts.bodyBold, color: colors.skill },
});
