// Hero "Status": the 4 attributes (the total; tap one for an info box with "N STR + M core STR" and the effects of each
// part), derived combat stats (tap a row for an info box with its breakdown) and stamina. Info boxes are InfoPopovers
// anchored on the row. Numbers come from the engine's read-only selectors (attributeViews, getDerivedStats, hpView);
// nothing here computes rules, it only words them.
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { type HostInstance, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ATTRIBUTE_POINTS,
  type AttributeEffect,
  type AttributeKey,
  type AttributeView,
  attributeViews,
  type Character,
  getDerivedStats,
  hpView,
  type RangePart,
  type Stamina,
  STATS,
  staminaView,
  type TrainingState,
  type ValuePart,
} from '../engine';
import { colors, fonts } from '../theme';
import { ATTRIBUTE_NAMES, formatClock, formatHoursMinutes, formatNumber, itemName } from './format';
import { Bar, Panel } from './Panel';
import { type AnchorRect, InfoPopover, measureAnchor, PopoverRow, PopoverText } from './ui/InfoPopover';

/** 833 bp → "8.3%". */
const pct = (bp: number) => `${Number((bp / 100).toFixed(1))}%`;

/** One effect line, worded from the engine's numbers. */
function effectText(e: AttributeEffect): string {
  switch (e.kind) {
    case 'damage':
      return `+${formatNumber(e.amount)} damage`;
    case 'defense':
      return `+${formatNumber(e.amount)} defense`;
    case 'hpRegen':
      return `+${formatNumber(e.amount)} HP/min`;
    case 'gatheringPower':
      return `+${formatNumber(e.amount)} woodcutting & mining strength`;
    case 'activityTime':
      return `−${pct(e.bp)} search, cut & mining time`;
    case 'craftTime':
      return `−${pct(e.bp)} crafting time`;
  }
}

const effectsText = (effects: AttributeEffect[]) => effects.map(effectText).join(', ');

/** The cell's one-line summary: the linear effects, else the core ones (a hint while there is no core point yet). */
function summaryOf(v: AttributeView): { text: string; active: boolean } {
  if (v.linear.length > 0) return { text: effectsText(v.linear), active: true };
  if (v.coreEffects.length === 0) return { text: 'no effect yet', active: false };
  if (v.core === 0) return { text: 'train core for its effect', active: false };
  return { text: effectsText(v.coreEffects), active: true };
}


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
  // Zero lines add nothing (e.g. "+ 0 STR" for a new hero), but keep at least one.
  const shown = parts.filter((p) => p.min !== 0 || p.max !== 0);
  return (shown.length > 0 ? shown : parts.slice(0, 1)).map((p) => `${range(p.min, p.max)} ${partLabel(p)}`).join(' + ');
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
  const attrs = useMemo(() => attributeViews({ character: { level, attributes }, training }), [level, attributes, training]);
  const hpNow = hpView({ character: { level, attributes, equipment, hp, hpRegenProgress }, training });
  /** The info box: a stat or an attribute, anchored on its row. */
  const [info, setInfo] = useState<{ key: StatKey | AttributeKey; anchor: AnchorRect } | null>(null);
  const openInfo = useCallback((key: StatKey | AttributeKey, node: HostInstance | null) => {
    void measureAnchor(node).then((anchor) => anchor && setInfo({ key, anchor }));
  }, []);
  const closeInfo = useCallback(() => setInfo(null), []);
  const attrInfo = info ? attrs.find((a) => a.attribute === info.key) : undefined;
  const attrNames = attrInfo ? ATTRIBUTE_NAMES[attrInfo.attribute] : undefined;

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
      detail: `Max HP ${formatNumber(stats.maxHp.value)} = ${describeValue(stats.maxHp.breakdown)}. Regen ${hpNow.regenPerMin}/min = ${STATS.hpRegen.basePerMin} base + ${STATS.hpRegen.perEndurance} × total END.`,
    },
    { key: 'maxMana', label: 'Mana', value: formatNumber(stats.maxMana.value), detail: `Mana ${formatNumber(stats.maxMana.value)} = ${describeValue(stats.maxMana.breakdown)}` },
  ];
  const statInfo = info && !attrInfo ? rows.find((r) => r.key === info.key) : undefined;

  return (
    <Panel title="Status">
      <View style={styles.attrGrid}>
        {attrs.map((a) => {
          const sum = summaryOf(a);
          return <AttributeCell key={a.attribute} attribute={a.attribute} total={a.total} summary={sum.text} active={sum.active} onInfo={openInfo} />;
        })}
      </View>

      <View style={styles.statList}>
        {rows.map((r) => (
          <StatRow key={r.key} statKey={r.key} label={r.label} value={r.value} note={r.note} onInfo={openInfo} />
        ))}
      </View>

      <StaminaBar stamina={stamina} />
      {info && attrInfo && attrNames ? (
        <InfoPopover
          anchor={info.anchor}
          onClose={closeInfo}
          title={`${attrNames.short} ${formatNumber(attrInfo.total)}`}
          subtitle={`${formatNumber(attrInfo.normal)} ${attrNames.short} + ${formatNumber(attrInfo.core)} core ${attrNames.short}`}
        >
          <PopoverRow label="From hero level" value={formatNumber(attrInfo.levelPoints)} />
          {attrInfo.extra !== 0 ? <PopoverRow label="Extra" value={formatNumber(attrInfo.extra)} /> : null}
          <PopoverRow label="Core (training)" value={formatNumber(attrInfo.core)} />
          <PopoverText>
            {`Total ${attrNames.short} (linear): ${attrInfo.linear.length > 0 ? effectsText(attrInfo.linear) : 'no effect yet'}`}
          </PopoverText>
          <PopoverText>
            {`Core ${attrNames.short} (special): ${attrInfo.coreEffects.length > 0 ? effectsText(attrInfo.coreEffects) : 'no special effect yet'}`}
          </PopoverText>
          <PopoverText tone="note">Every hero level gives +{ATTRIBUTE_POINTS.perLevel} to each attribute. Core points come only from the Training Grounds.</PopoverText>
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
  attribute,
  total,
  summary,
  active,
  onInfo,
}: {
  attribute: AttributeKey;
  total: number;
  summary: string;
  active: boolean;
  onInfo: (k: AttributeKey, node: HostInstance | null) => void;
}) {
  const ref = useRef<HostInstance>(null);
  const onPress = useCallback(() => onInfo(attribute, ref.current), [onInfo, attribute]);
  const names = ATTRIBUTE_NAMES[attribute];
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      style={styles.attrCell}
      accessibilityRole="button"
      accessibilityLabel={`${names.label} ${total}, ${summary}`}
      accessibilityHint="Shows normal and core points and what each does"
    >
      <View style={styles.attrTop}>
        <Text style={styles.attrShort}>ⓘ {names.short}</Text>
        <Text style={styles.attrValue}>{formatNumber(total)}</Text>
      </View>
      <Text style={active ? styles.attrEffect : styles.attrEffectNone}>{summary}</Text>
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
