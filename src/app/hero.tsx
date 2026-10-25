import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bar, Panel } from '../components/Panel';
import type { AttributeKey, EquipmentSlot, Item, ItemRarity, SkillKey } from '../engine/types';
import { mockGameState } from '../mocks/gameState';
import { colors, fonts } from '../theme';

const ATTRIBUTE_LABELS: Record<AttributeKey, string> = {
  strength: 'Strength',
  dexterity: 'Dexterity',
  agility: 'Agility',
  constitution: 'Constitution',
  charisma: 'Charisma',
  intelligence: 'Intelligence',
};

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
  [null, 'boots', null],
];

const SLOT_LABELS: Record<EquipmentSlot, string> = {
  helmet: 'Helmet',
  amulet: 'Amulet',
  armor: 'Armor',
  weapon: 'Weapon',
  shield: 'Shield',
  gloves: 'Gloves',
  ring1: 'Ring',
  ring2: 'Ring',
  boots: 'Boots',
};

const RARITY_COLORS: Record<ItemRarity, string> = {
  common: '#8c7a62',
  uncommon: '#4f9a4a',
  rare: '#3f8fd1',
  epic: '#9b59b6',
};

export default function HeroScreen() {
  const { character, inventory } = mockGameState;
  const slots: (Item | null)[] = Array.from({ length: inventory.capacity }, (_, i) => inventory.items[i] ?? null);

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <Panel>
          <View style={styles.headerRow}>
            <View style={styles.portrait}>
              <Text style={styles.portraitIcon}>🧔</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{character.name}</Text>
              <Text style={styles.subtitle}>
                Level {character.level} · {character.title}
              </Text>
              <Text style={styles.gold}>🪙 {character.gold.toLocaleString()} gold</Text>
            </View>
          </View>
          <View style={styles.bars}>
            <Text style={styles.barCaption}>Health</Text>
            <Bar value={character.hp} max={character.maxHp} color={colors.hp} label={`${character.hp} / ${character.maxHp}`} />
            <Text style={styles.barCaption}>Experience</Text>
            <Bar value={character.xp} max={character.xpToNext} color={colors.xp} label={`${character.xp} / ${character.xpToNext}`} />
          </View>
        </Panel>

        {/* Attributes */}
        <Panel title="Attributes">
          <View style={styles.attrGrid}>
            {(Object.keys(ATTRIBUTE_LABELS) as AttributeKey[]).map((k) => (
              <View key={k} style={styles.attrCell}>
                <Text style={styles.attrLabel}>{ATTRIBUTE_LABELS[k]}</Text>
                <Text style={styles.attrValue}>{character.attributes[k]}</Text>
              </View>
            ))}
          </View>
        </Panel>

        {/* Equipment */}
        <Panel title="Equipment">
          {EQUIPMENT_GRID.map((row, r) => (
            <View key={r} style={styles.equipRow}>
              {row.map((slot, c) =>
                slot ? (
                  <View key={c} style={styles.equipCell}>
                    <SlotBox item={character.equipment[slot]} size={58} />
                    <Text style={styles.slotLabel} numberOfLines={1}>
                      {character.equipment[slot]?.name ?? SLOT_LABELS[slot]}
                    </Text>
                  </View>
                ) : (
                  <View key={c} style={styles.equipCell} />
                ),
              )}
            </View>
          ))}
        </Panel>

        {/* Inventory */}
        <Panel title={`Inventory  ${inventory.items.length}/${inventory.capacity}`}>
          <View style={styles.invGrid}>
            {slots.map((item, i) => (
              <View key={i} style={styles.invCell}>
                <SlotBox item={item ?? undefined} size={52} />
              </View>
            ))}
          </View>
        </Panel>

        {/* Skills */}
        <Panel title="Skills">
          {(Object.keys(SKILL_LABELS) as SkillKey[]).map((k) => {
            const s = character.skills[k];
            return (
              <View key={k} style={styles.skillRow}>
                <Text style={styles.skillName}>
                  {SKILL_LABELS[k].icon} {SKILL_LABELS[k].label} <Text style={styles.skillLevel}>Lv {s.level}</Text>
                </Text>
                <Bar value={s.xp} max={s.xpToNext} color={colors.skill} label={`${s.xp} / ${s.xpToNext}`} />
              </View>
            );
          })}
        </Panel>
      </ScrollView>
    </SafeAreaView>
  );
}

function SlotBox({ item, size }: { item?: Item; size: number }) {
  return (
    <View
      style={[
        styles.slot,
        { width: size, height: size },
        item && { borderColor: RARITY_COLORS[item.rarity] },
      ]}
    >
      {item ? <Text style={{ fontSize: size * 0.5 }}>{item.icon}</Text> : null}
      {item?.quantity ? <Text style={styles.qty}>{item.quantity}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.night },
  content: { padding: 12, paddingBottom: 32 },

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

  attrGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  attrCell: {
    width: '50%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.parchmentDark,
  },
  attrLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  attrValue: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },

  equipRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  equipCell: { width: 84, alignItems: 'center' },
  slotLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.inkSoft, marginTop: 3 },

  invGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  invCell: { padding: 3 },

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

  skillRow: { marginBottom: 10, gap: 4 },
  skillName: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  skillLevel: { fontFamily: fonts.bodyBold, color: colors.skill },
});
