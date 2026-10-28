// Hero "Status": the 4 attributes (effective = base + trained; tap one for the split), derived combat stats
// (tap a row for its breakdown) and stamina.
// Derived stats come from the engine's read-only getDerivedStats(); nothing here computes rules.
import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ATTRIBUTE_KEYS,
  type AttributeKey,
  type Character,
  effectiveAttributes,
  getDerivedStats,
  hpView,
  type RangePart,
  type Stamina,
  STATS,
  staminaView,
  type TrainingState,
  type ValuePart,
  DUNGEONS,
} from '../engine';
import { colors, fonts } from '../theme';
import { ATTRIBUTE_NAMES, formatClock, formatHoursMinutes, formatNumber, itemName } from './format';
import { Bar, Panel } from './Panel';

/** What one point does, built from the engine coefficients so the text can't drift from the rules. */
const ATTRIBUTE_EFFECTS: Record<AttributeKey, string | null> = {
  strength: `+${STATS.damagePerStrength} damage`,
  // Rat Cellar's timing; every tier uses the same −1 s per DEX today (config/dungeons.ts).
  dexterity: `−${DUNGEONS.rat_cellar.search.perDexterityMs / 1000}s dungeon search`,
  endurance: `+${STATS.defensePerEndurance} defense, +${STATS.hpRegen.perEndurance} HP/min`,
  intelligence: null,
};

const ATTRIBUTES = ATTRIBUTE_KEYS.map((key) => ({
  key,
  ...ATTRIBUTE_NAMES[key],
  effect: ATTRIBUTE_EFFECTS[key] ?? 'no effect yet',
  active: ATTRIBUTE_EFFECTS[key] !== null,
}));

type StatKey = 'damage' | 'defense' | 'attackIntervalMs' | 'maxHp' | 'maxMana';

/** 1000 → "1.0s", 750 → "0.75s". */
const formatSeconds = (ms: number) => `${ms % 100 === 0 ? (ms / 1000).toFixed(1) : (ms / 1000).toFixed(2)}s`;

const range = (min: number, max: number) => (min === max ? formatNumber(min) : `${formatNumber(min)}–${formatNumber(max)}`);

function partLabel(p: RangePart | ValuePart): string {
  switch (p.source) {
    case 'weapon':
    case 'armor':
    case 'gear':
      return p.defId ? itemName(p.defId) : p.source;
    case 'floor':
      return 'minimum';
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
  hp: number;
  hpRegenProgress: number;
  stamina: Stamina;
  training: TrainingState;
};

export const StatusPanel = memo(function StatusPanel({ level, attributes, equipment, hp, hpRegenProgress, stamina, training }: Props) {
  const stats = useMemo(() => getDerivedStats({ character: { level, attributes, equipment }, training }), [level, attributes, equipment, training]);
  const effective = useMemo(() => effectiveAttributes({ character: { attributes }, training }), [attributes, training]);
  const hpNow = hpView({ character: { level, attributes, equipment, hp, hpRegenProgress }, training });
  const [open, setOpen] = useState<StatKey | null>(null);
  const toggle = useCallback((k: StatKey) => setOpen((cur) => (cur === k ? null : k)), []);
  const [openAttr, setOpenAttr] = useState<AttributeKey | null>(null);
  const toggleAttr = useCallback((k: AttributeKey) => setOpenAttr((cur) => (cur === k ? null : k)), []);

  return (
    <Panel title="Status">
      <View style={styles.attrGrid}>
        {ATTRIBUTES.map((a) => (
          <AttributeCell
            key={a.key}
            attr={a}
            effective={effective[a.key]}
            base={attributes[a.key]}
            trained={training.attributes[a.key].level}
            open={openAttr === a.key}
            onToggle={toggleAttr}
          />
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
          statKey="attackIntervalMs"
          label="Attacks"
          value={`every ${formatSeconds(stats.attackIntervalMs.value)}`}
          detail={`${formatNumber(stats.attackIntervalMs.value)} ms between strikes = ${describeValue(stats.attackIntervalMs.breakdown)} (ms).`}
          open={open === 'attackIntervalMs'}
          onToggle={toggle}
        />
        <StatRow
          statKey="maxHp"
          label="HP"
          value={`${formatNumber(hpNow.hp)} / ${formatNumber(stats.maxHp.value)}`}
          note={`+${hpNow.regenPerMin}/min${hpNow.full ? '' : ` · full in ${formatHoursMinutes(hpNow.fullInMs)}`}`}
          detail={`Max HP ${formatNumber(stats.maxHp.value)} = ${describeValue(stats.maxHp.breakdown)}. Regen ${hpNow.regenPerMin}/min = ${STATS.hpRegen.basePerMin} base + ${STATS.hpRegen.perEndurance} × END.`}
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

const AttributeCell = memo(function AttributeCell({
  attr,
  effective,
  base,
  trained,
  open,
  onToggle,
}: {
  attr: (typeof ATTRIBUTES)[number];
  effective: number;
  base: number;
  trained: number;
  open: boolean;
  onToggle: (k: AttributeKey) => void;
}) {
  const onPress = useCallback(() => onToggle(attr.key), [onToggle, attr.key]);
  const split = `${formatNumber(base)} base + ${formatNumber(trained)} trained`;
  return (
    <Pressable
      onPress={onPress}
      style={styles.attrCell}
      accessibilityRole="button"
      accessibilityLabel={`${attr.label} ${effective}, ${attr.effect}${open ? `. ${split}` : ''}`}
      accessibilityHint="Shows base and trained points"
      accessibilityState={{ expanded: open }}
    >
      <View style={styles.attrTop}>
        <Text style={styles.attrShort}>
          {open ? '▾' : '▸'} {attr.short}
        </Text>
        <Text style={styles.attrValue}>{formatNumber(effective)}</Text>
      </View>
      <Text style={attr.active ? styles.attrEffect : styles.attrEffectNone}>{attr.effect}</Text>
      {open ? <Text style={styles.attrSplit}>{split}</Text> : null}
    </Pressable>
  );
});

const StatRow = memo(function StatRow({
  statKey,
  label,
  value,
  note,
  detail,
  open,
  onToggle,
}: {
  statKey: StatKey;
  label: string;
  value: string;
  /** Always shown under the value (e.g. HP regen). */
  note?: string;
  detail: string;
  open: boolean;
  onToggle: (k: StatKey) => void;
}) {
  const onPress = useCallback(() => onToggle(statKey), [onToggle, statKey]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${value}${note ? `, ${note}` : ''}${open ? `. ${detail}` : ''}`}
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
      {note ? <Text style={styles.statNote}>{note}</Text> : null}
      {open ? (
        <Text style={styles.statDetail}>
          {note ? detail : `${label} ${value} = ${detail}`}
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
    minHeight: 44,
    paddingVertical: 5,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.parchmentDark,
  },
  attrTop: { flexDirection: 'row', justifyContent: 'space-between' },
  attrShort: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  attrValue: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  attrEffect: { fontFamily: fonts.body, fontSize: 13, color: colors.skill },
  attrEffectNone: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  attrSplit: { fontFamily: fonts.body, fontSize: 13, color: colors.ink, marginTop: 2 },

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
  statNote: { fontFamily: fonts.body, fontSize: 13, color: colors.skill, textAlign: 'right' },
  statDetail: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft, marginTop: 4 },

  stamina: { marginTop: 12, gap: 4 },
  staminaCaption: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.inkSoft },
  staminaTimer: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
});
