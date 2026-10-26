// Hero "Status": the 4 attributes, derived combat stats (tap a row for its breakdown) and stamina.
// Derived stats come from the engine's read-only getDerivedStats(); nothing here computes rules.
import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ATTRIBUTE_KEYS,
  type AttributeKey,
  type Character,
  getDerivedStats,
  type RangePart,
  type Stamina,
  STATS,
  staminaView,
  type ValuePart,
} from '../engine';
import { colors, fonts } from '../theme';
import { ATTRIBUTE_NAMES, formatClock, formatHoursMinutes, formatNumber, itemName } from './format';
import { Bar, Panel } from './Panel';

/** What one point does, built from the engine coefficients so the text can't drift from the rules. */
const ATTRIBUTE_EFFECTS: Record<AttributeKey, string | null> = {
  strength: `+${STATS.damagePerStrength} damage`,
  dexterity: null,
  endurance: `+${STATS.defensePerEndurance} defense`,
  intelligence: null,
};

const ATTRIBUTES = ATTRIBUTE_KEYS.map((key) => ({
  key,
  ...ATTRIBUTE_NAMES[key],
  effect: ATTRIBUTE_EFFECTS[key] ?? 'no effect yet',
  active: ATTRIBUTE_EFFECTS[key] !== null,
}));

type StatKey = 'damage' | 'defense' | 'maxHp' | 'maxMana';

const range = (min: number, max: number) => (min === max ? formatNumber(min) : `${formatNumber(min)}–${formatNumber(max)}`);

function partLabel(p: RangePart | ValuePart): string {
  switch (p.source) {
    case 'weapon':
    case 'armor':
      return p.defId ? itemName(p.defId) : p.source;
    case 'unarmed':
      return 'unarmed';
    case 'percent': {
      // One rounded line; name each source so future buffs/affixes stay visible.
      const sources = (p.bonuses ?? []).map((b) => `${b.source} ${b.bp >= 0 ? '+' : '−'}${Math.abs(b.bp) / 100}%`);
      return sources.length > 0 ? `bonus (${sources.join(', ')})` : 'bonus';
    }
    case 'strength':
      return 'STR';
    case 'endurance':
      return 'END';
    case 'base':
      return 'base';
    case 'level':
      return 'from level';
  }
}

function describeRange(parts: RangePart[]): string {
  return parts.map((p) => `${range(p.min, p.max)} ${partLabel(p)}`).join(' + ');
}

function describeValue(parts: ValuePart[]): string {
  // Zero lines add nothing (e.g. "+ 0 from level" at level 1), but keep at least one.
  const shown = parts.filter((p) => p.value !== 0);
  return (shown.length > 0 ? shown : parts.slice(0, 1)).map((p) => `${formatNumber(p.value)} ${partLabel(p)}`).join(' + ');
}

type Props = {
  level: number;
  attributes: Character['attributes'];
  equipment: Character['equipment'];
  stamina: Stamina;
};

export const StatusPanel = memo(function StatusPanel({ level, attributes, equipment, stamina }: Props) {
  const stats = useMemo(() => getDerivedStats({ character: { level, attributes, equipment } }), [level, attributes, equipment]);
  const [open, setOpen] = useState<StatKey | null>(null);
  const toggle = useCallback((k: StatKey) => setOpen((cur) => (cur === k ? null : k)), []);

  return (
    <Panel title="Status">
      <View style={styles.attrGrid}>
        {ATTRIBUTES.map((a) => (
          <View key={a.key} style={styles.attrCell} accessible accessibilityLabel={`${a.label} ${attributes[a.key]}, ${a.effect}`}>
            <View style={styles.attrTop}>
              <Text style={styles.attrShort}>{a.short}</Text>
              <Text style={styles.attrValue}>{formatNumber(attributes[a.key])}</Text>
            </View>
            <Text style={a.active ? styles.attrEffect : styles.attrEffectNone}>{a.effect}</Text>
          </View>
        ))}
      </View>

      <View style={styles.statList}>
        <StatRow
          statKey="damage"
          label="Damage"
          value={range(stats.damage.min, stats.damage.max)}
          detail={describeRange(stats.damage.breakdown)}
          open={open === 'damage'}
          onToggle={toggle}
        />
        <StatRow
          statKey="defense"
          label="Defense"
          value={formatNumber(stats.defense.value)}
          detail={describeValue(stats.defense.breakdown)}
          open={open === 'defense'}
          onToggle={toggle}
        />
        <StatRow
          statKey="maxHp"
          label="HP"
          value={formatNumber(stats.maxHp.value)}
          detail={describeValue(stats.maxHp.breakdown)}
          open={open === 'maxHp'}
          onToggle={toggle}
        />
        <StatRow
          statKey="maxMana"
          label="Mana"
          value={formatNumber(stats.maxMana.value)}
          detail={describeValue(stats.maxMana.breakdown)}
          open={open === 'maxMana'}
          onToggle={toggle}
        />
      </View>

      <StaminaBar stamina={stamina} />
    </Panel>
  );
});

const StatRow = memo(function StatRow({
  statKey,
  label,
  value,
  detail,
  open,
  onToggle,
}: {
  statKey: StatKey;
  label: string;
  value: string;
  detail: string;
  open: boolean;
  onToggle: (k: StatKey) => void;
}) {
  const onPress = useCallback(() => onToggle(statKey), [onToggle, statKey]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={open ? `${label} ${value} equals ${detail}` : `${label} ${value}`}
      accessibilityHint="Shows where this number comes from"
      accessibilityState={{ expanded: open }}
      style={styles.statRow}
    >
      <View style={styles.statLine}>
        <Text style={styles.statLabel}>
          {open ? '▾' : '▸'} {label}
        </Text>
        <Text style={styles.statValue}>{value}</Text>
      </View>
      {open ? (
        <Text style={styles.statDetail}>
          {label} {value} = {detail}
        </Text>
      ) : null}
    </Pressable>
  );
});

const StaminaBar = memo(function StaminaBar({ stamina }: { stamina: Stamina }) {
  const view = staminaView({ stamina });
  return (
    <View style={styles.stamina}>
      <Text style={styles.staminaCaption}>Stamina</Text>
      <Bar value={view.current} max={view.max} color={colors.stamina} label={`${formatNumber(view.current)} / ${formatNumber(view.max)}`} />
      {view.full ? null : (
        <Text style={styles.staminaTimer}>
          +1 in {formatClock(view.nextInMs)} · full in {formatHoursMinutes(view.fullInMs)}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  attrGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  attrCell: {
    width: '50%',
    paddingVertical: 5,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.parchmentDark,
  },
  attrTop: { flexDirection: 'row', justifyContent: 'space-between' },
  attrShort: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  attrValue: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  attrEffect: { fontFamily: fonts.body, fontSize: 12, color: colors.skill },
  attrEffectNone: { fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft },

  statList: { marginTop: 10 },
  statRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.parchmentDark,
  },
  statLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { fontFamily: fonts.body, fontSize: 16, color: colors.ink },
  statValue: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink },
  statDetail: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft, marginTop: 4 },

  stamina: { marginTop: 12, gap: 4 },
  staminaCaption: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.inkSoft },
  staminaTimer: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
});
