import { memo, useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameClient, useGameState } from '../../client/GameProvider';
import { ACTIVITY_STRIP_HEIGHT } from '../../components/ActivityStrip';
import { DebugPanel } from '../../components/DebugPanel';
import { formatNumber } from '../../components/format';
import { IconText, SkillIcon } from '../../components/art/Sprites';
import { HeroHud } from '../../components/hud/HeroHud';
import { defOf, SLOT_LABELS } from '../../components/items/itemInfo';
import { ItemSheet, type SheetAction } from '../../components/items/ItemSheet';
import { ItemSlot } from '../../components/items/ItemSlot';
import type { AnchorRect } from '../../components/ui/InfoPopover';
import { Bar, Panel } from '../../components/Panel';
import { StatusPanel } from '../../components/StatusPanel';
import { type CommandInput } from '../../client/types';
import { freeSlots, hpView } from '../../engine';
import { DEV_TOOLS_ENABLED } from '../../engine/config/dev';
import type { Character, EquipmentSlot, Inventory, Item, SkillKey } from '../../engine/types';
import { colors, fonts } from '../../theme';

const SKILL_LABELS: Record<SkillKey, string> = {
  woodcutting: 'Woodcutting',
  mining: 'Mining',
  fishing: 'Fishing',
};

// Paper-doll layout: 3 columns, null = empty cell
const EQUIPMENT_GRID: (EquipmentSlot | null)[][] = [
  [null, 'helmet', 'amulet'],
  ['weapon', 'armor', 'shield'],
  ['ring1', 'gloves', 'ring2'],
  ['axe', 'boots', 'pickaxe'],
];

/** What the item box shows: an inventory item (by id) or an equipment slot, anchored on the tapped slot. */
type Selection = ({ kind: 'inventory'; itemId: string } | { kind: 'equipment'; slot: EquipmentSlot }) & { anchor: AnchorRect };

export default function HeroScreen() {
  const { character, inventory, stamina, training } = useGameState();
  const [selection, setSelection] = useState<Selection | null>(null);
  const openInventory = useCallback((key: string | number, anchor: AnchorRect) => setSelection({ kind: 'inventory', itemId: String(key), anchor }), []);
  const openEquipment = useCallback((key: string | number, anchor: AnchorRect) => setSelection({ kind: 'equipment', slot: key as EquipmentSlot, anchor }), []);
  const close = useCallback(() => setSelection(null), []);

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      {/* The hero HUD sits at the top of the screen, above the scroll content (not floating over it). */}
      <HeroHud />
      <ScrollView contentContainerStyle={styles.content}>
        <HeaderPanel name={character.name} title={character.title} xp={character.xp} xpToNext={character.xpToNext} />
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
        <EquipmentPanel equipment={character.equipment} onPress={openEquipment} />
        <InventoryPanel inventory={inventory} gold={character.gold} onPress={openInventory} />
        <SkillsPanel skills={character.skills} />
        {DEV_TOOLS_ENABLED ? <DebugPanel /> : null}
      </ScrollView>
      <HeroItemSheet selection={selection} onClose={close} />
    </SafeAreaView>
  );
}

// Each panel is memoized on the slices it shows. simulate() keeps untouched slices by reference,
// so a woodcutting action re-renders Inventory and Skills, not Equipment. Status re-renders
// only when level, attributes, points, equipment, HP, mana, stamina or training change (HP, mana and stamina tick while
// they regenerate, training while an attribute trains). The portrait, level and gold moved to the HUD / Inventory (1.17.0).

const HeaderPanel = memo(function HeaderPanel({ name, title, xp, xpToNext }: { name: string; title: string; xp: number; xpToNext: number }) {
  return (
    <Panel>
      <Text style={styles.name}>{name}</Text>
      <Text style={styles.subtitle}>{title}</Text>
      <View style={styles.bars}>
        <Text style={styles.barCaption}>Experience</Text>
        <Bar value={xp} max={xpToNext} color={colors.xp} label={`${formatNumber(xp)} / ${formatNumber(xpToNext)} XP`} />
      </View>
    </Panel>
  );
});

type PressHandler = (key: string | number, anchor: AnchorRect) => void;

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

const InventoryPanel = memo(function InventoryPanel({ inventory, gold, onPress }: { inventory: Inventory; gold: number; onPress: PressHandler }) {
  const slots: (Item | undefined)[] = Array.from({ length: inventory.capacity }, (_, i) => inventory.items[i]);
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
function HeroItemSheet({ selection, onClose }: { selection: Selection | null; onClose: () => void }) {
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

  return <ItemSheet item={item ?? null} anchor={selection?.anchor ?? null} quantity={item?.quantity} equipped={equipped} actions={actions} error={error} onClose={close} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.night },
  // Room for the activity strip that floats above the tab bar. The HUD above the scroll view keeps its own space.
  content: { padding: 12, paddingTop: 8, paddingBottom: 32 + ACTIVITY_STRIP_HEIGHT },

  name: { fontFamily: fonts.title, fontSize: 26, color: colors.ink, lineHeight: 32 },
  subtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  bars: { marginTop: 12, gap: 4 },
  barCaption: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.inkSoft, marginTop: 4 },

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
