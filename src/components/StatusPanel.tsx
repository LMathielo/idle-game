// Hero "Status": the 4 attributes (effective = base + trained; tap one for an info box with the split), derived combat
// stats (tap a row for an info box with its breakdown) and stamina. Info boxes are InfoPopovers anchored on the row.
// Derived stats come from the engine's read-only getDerivedStats(); nothing here computes rules.
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { type HostInstance, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ATTRIBUTE_KEYS,
  type AttributeKey,
  type Character,
  effectiveAttributes,
  getDerivedStats,
  intCraftReductionBp,
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
import { type AnchorRect, InfoPopover, measureAnchor, PopoverRow, PopoverText } from './ui/InfoPopover';

/** What one point does, built from the engine coefficients so the text can't drift from the rules. */
const ATTRIBUTE_EFFECTS: Record<AttributeKey, string | null> = {
  strength: `+${STATS.damagePerStrength} damage`,
  // Rat Cellar's timing; every tier uses the same −1 s per DEX today (config/dungeons.ts).
  dexterity: `−${DUNGEONS.rat_cellar.search.perDexterityMs / 1000}s dungeon search`,
  endurance: `+${STATS.defensePerEndurance} defense, +${STATS.hpRegen.perEndurance} HP/min`,
  // INT's effect depends on its value (a diminishing curve), so it is filled in from the engine in the component.
  intelligence: null,
};

/** INT 10 → "−8.3% crafting time" (intCraftReductionBp: diminishing, cap 50%). */
const intEffect = (bp: number) => `−${Number((bp / 100).toFixed(1))}% crafting time`;

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
  /** The info box: a stat or an attribute, anchored on its row. */
  const [info, setInfo] = useState<{ key: StatKey | AttributeKey; anchor: AnchorRect } | null>(null);
  const openInfo = useCallback((key: StatKey | AttributeKey, node: HostInstance | null) => {
    void measureAnchor(node).then((anchor) => anchor && setInfo({ key, anchor }));
  }, []);
  const closeInfo = useCallback(() => setInfo(null), []);
  const intBp = intCraftReductionBp({ character: { attributes }, training });
  const attrs = useMemo(() => ATTRIBUTES.map((a) => (a.key === 'intelligence' ? { ...a, effect: intEffect(intBp), active: true } : a)), [intBp]);
  const attrInfo = info ? attrs.find((a) => a.key === info.key) : undefined;

  const rows: { key: StatKey; label: string; value: string; note?: string; detail: string }[] = [
    { key: 'damage', label: 'Damage', value: range(stats.damage.min, stats.damage.max), detail: `Damage ${range(stats.damage.min, stats.damage.max)} = ${describeRange(stats.damage.breakdown)}` },
    { key: 'defense', label: 'Defense', value: formatNumber(stats.defense.value), detail: `Defense ${formatNumber(stats.defense.value)} = ${describeValue(stats.defense.breakdown)}` },
    {
      key: 'attackIntervalMs',
      label: 'Attacks',
      value: `every ${formatSeconds(stats.attackIntervalMs.value)}`,
      detail: `${formatNumber(stats.attackIntervalMs.value)} ms between strikes = ${describeValue(stats.attackIntervalMs.breakdown)} (ms).`,
    },
    {
      key: 'maxHp',
      label: 'HP',
      value: `${formatNumber(hpNow.hp)} / ${formatNumber(stats.maxHp.value)}`,
      note: `+${hpNow.regenPerMin}/min${hpNow.full ? '' : ` · full in ${formatHoursMinutes(hpNow.fullInMs)}`}`,
      detail: `Max HP ${formatNumber(stats.maxHp.value)} = ${describeValue(stats.maxHp.breakdown)}. Regen ${hpNow.regenPerMin}/min = ${STATS.hpRegen.basePerMin} base + ${STATS.hpRegen.perEndurance} × END.`,
    },
    { key: 'maxMana', label: 'Mana', value: formatNumber(stats.maxMana.value), detail: `Mana ${formatNumber(stats.maxMana.value)} = ${describeValue(stats.maxMana.breakdown)}` },
  ];
  const statInfo = info && !attrInfo ? rows.find((r) => r.key === info.key) : undefined;

  return (
    <Panel title="Status">
      <View style={styles.attrGrid}>
        {attrs.map((a) => (
          <AttributeCell key={a.key} attr={a} effective={effective[a.key]} onInfo={openInfo} />
        ))}
      </View>

      <View style={styles.statList}>
        {rows.map((r) => (
          <StatRow key={r.key} statKey={r.key} label={r.label} value={r.value} note={r.note} onInfo={openInfo} />
        ))}
      </View>

      <StaminaBar stamina={stamina} />
      {info && attrInfo ? (
        <InfoPopover anchor={info.anchor} onClose={closeInfo} title={attrInfo.label} subtitle={attrInfo.effect}>
          <PopoverRow label="Total" value={formatNumber(effective[attrInfo.key])} strong />
          <PopoverRow label="Base" value={formatNumber(attributes[attrInfo.key])} />
          <PopoverRow label="Trained" value={formatNumber(training.attributes[attrInfo.key].level)} />
          <PopoverText tone="note">Raise it at the Training Grounds. Everything that uses it reads the total.</PopoverText>
        </InfoPopover>
      ) : null}
      {statInfo && info ? (
        <InfoPopover anchor={info.anchor} onClose={closeInfo} title={statInfo.label} subtitle={statInfo.note ? `${statInfo.value} · ${statInfo.note}` : statInfo.value}>
          <PopoverText>{statInfo.detail}</PopoverText>
        </InfoPopover>
      ) : null}
    </Panel>
  );
});

const AttributeCell = memo(function AttributeCell({
  attr,
  effective,
  onInfo,
}: {
  attr: (typeof ATTRIBUTES)[number];
  effective: number;
  onInfo: (k: AttributeKey, node: HostInstance | null) => void;
}) {
  const ref = useRef<HostInstance>(null);
  const onPress = useCallback(() => onInfo(attr.key, ref.current), [onInfo, attr.key]);
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      style={styles.attrCell}
      accessibilityRole="button"
      accessibilityLabel={`${attr.label} ${effective}, ${attr.effect}`}
      accessibilityHint="Shows base and trained points"
    >
      <View style={styles.attrTop}>
        <Text style={styles.attrShort}>ⓘ {attr.short}</Text>
        <Text style={styles.attrValue}>{formatNumber(effective)}</Text>
      </View>
      <Text style={attr.active ? styles.attrEffect : styles.attrEffectNone}>{attr.effect}</Text>
    </Pressable>
  );
});

const StatRow = memo(function StatRow({
  statKey,
  label,
  value,
  note,
  onInfo,
}: {
  statKey: StatKey;
  label: string;
  value: string;
  /** Always shown under the value (e.g. HP regen). */
  note?: string;
  onInfo: (k: StatKey, node: HostInstance | null) => void;
}) {
  const ref = useRef<HostInstance>(null);
  const onPress = useCallback(() => onInfo(statKey, ref.current), [onInfo, statKey]);
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${value}${note ? `, ${note}` : ''}`}
      accessibilityHint="Shows where this number comes from"
      style={styles.statRow}
    >
      <View style={styles.statLine}>
        <Text style={styles.statLabel}>ⓘ {label}</Text>
        <Text style={styles.statValue}>{value}</Text>
      </View>
      {note ? <Text style={styles.statNote}>{note}</Text> : null}
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

  stamina: { marginTop: 12, gap: 4 },
  staminaCaption: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.inkSoft },
  staminaTimer: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
});
