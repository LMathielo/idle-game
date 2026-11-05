// Hero "Status": the 4 attributes (the total; tap one for an info box with "N STR + M core STR" and the effects of each
// part), derived combat stats (tap a row for an info box with its breakdown), mana and stamina. Info boxes are
// InfoPopovers anchored on the row. Numbers come from the engine's read-only selectors (attributeViews, getDerivedStats,
// hpView, manaView); nothing here computes rules, it only words them.
//
// Spending (1.17.0): with unspent points, each attribute gets − / + (hold to repeat, quiet ticks) that build a PENDING
// allocation, shown on the attribute ("STR 12 (+3)"); − only removes pending points, Reset clears them, and Confirm asks
// in a GameDialog ("Points can't be refunded") before one SPEND_ATTRIBUTE_POINTS. The engine validates the command.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type HostInstance, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_POINTS,
  type AttributeEffect,
  type AttributeKey,
  type AttributeView,
  attributeViews,
  type Character,
  getDerivedStats,
  hpView,
  manaView,
  type RangePart,
  type Stamina,
  STAT_EFFECTS,
  STATS,
  staminaView,
  type TrainingState,
  type ValuePart,
} from '../engine';
import { colors, fonts } from '../theme';
import { ATTRIBUTE_NAMES, bpPercent, critMultText, formatClock, formatHoursMinutes, formatNumber, formatRate, itemName } from './format';
import { Bar, Panel } from './Panel';
import { PixelButton } from './PixelButton';
import { type AnchorRect, InfoPopover, measureAnchor, PopoverRow, PopoverText } from './ui/InfoPopover';
import { useCommand } from './ui/useCommand';

/** One effect line, worded from the engine's numbers. `short` for the half-width attribute cell. */
function effectText(e: AttributeEffect, short = false): string {
  switch (e.kind) {
    case 'damage':
      return `+${formatNumber(e.amount)} damage`;
    case 'armor':
      return `+${formatNumber(e.amount)} armor`;
    case 'maxHp':
      return `+${formatNumber(e.amount)} HP`;
    case 'hpRegen':
      return `+${formatRate(e.amount)} HP/min`;
    case 'magicDamage':
      return `+${formatNumber(e.amount)} magic damage`;
    case 'magicResist':
      return short ? `+${formatNumber(e.amount)} resist` : `+${formatNumber(e.amount)} magic resist`;
    case 'maxMana':
      return `+${formatNumber(e.amount)} mana`;
    case 'manaRegen':
      return `+${formatRate(e.amount)} mana/min`;
    case 'gatheringPower':
      return short ? `+${formatNumber(e.amount)} WS & MS` : `+${formatNumber(e.amount)} woodcutting & mining strength`;
    case 'critMultiplier':
      return `${critMultText(e.bp)} crit damage`;
    case 'damageMult':
      return `+${bpPercent(e.bp)} damage`;
    case 'critChance':
      return `+${bpPercent(e.bp)} crit chance`;
    case 'armorMult':
      return `+${bpPercent(e.bp)} armor and magic resist`;
    case 'magicDamageMult':
      return `+${bpPercent(e.bp)} magic damage`;
    case 'activityTime':
      return short ? `−${bpPercent(e.bp)} search, cut & mine time` : `−${bpPercent(e.bp)} search, cut & mining time`;
    case 'craftTime':
      return `−${bpPercent(e.bp)} crafting time`;
  }
}

const effectsText = (effects: AttributeEffect[], short = false) => effects.map((e) => effectText(e, short)).join(' · ');

/** The cell's lines: the plain effects (always), and the core ones once there is a core point to show. */
function summaryOf(v: AttributeView): { plain: string; core: string | null } {
  return { plain: effectsText(v.linear, true), core: v.core > 0 && v.coreEffects.length > 0 ? `Core: ${effectsText(v.coreEffects, true)}` : null };
}

type StatKey = 'damage' | 'magicDamage' | 'armor' | 'magicResist' | 'critChance' | 'critMultiplier' | 'attackIntervalMs' | 'maxHp' | 'maxMana';

type Pending = Record<AttributeKey, number>;
const NO_PENDING: Pending = { strength: 0, dexterity: 0, endurance: 0, intelligence: 0 };
const sumOf = (p: Pending) => ATTRIBUTE_KEYS.reduce((n, k) => n + p[k], 0);

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
    case 'dexterity':
      return 'DEX';
    case 'endurance':
      return 'END';
    case 'intelligence':
      return 'INT';
    case 'core':
      return p.attribute ? `core ${ATTRIBUTE_NAMES[p.attribute].short}` : 'core';
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
  spentPoints: Character['spentPoints'];
  unspentPoints: number;
  equipment: Character['equipment'];
  hp: number;
  hpRegenProgress: number;
  mana: number;
  manaRegenProgress: number;
  stamina: Stamina;
  training: TrainingState;
};

export const StatusPanel = memo(function StatusPanel({
  level,
  attributes,
  spentPoints,
  unspentPoints,
  equipment,
  hp,
  hpRegenProgress,
  mana,
  manaRegenProgress,
  stamina,
  training,
}: Props) {
  const stats = useMemo(
    () => getDerivedStats({ character: { level, attributes, spentPoints, equipment }, training }),
    [level, attributes, spentPoints, equipment, training],
  );
  const attrs = useMemo(() => attributeViews({ character: { attributes, spentPoints }, training }), [attributes, spentPoints, training]);
  const hpNow = hpView({ character: { level, attributes, spentPoints, equipment, hp, hpRegenProgress }, training });
  const manaNow = manaView({ character: { level, attributes, spentPoints, equipment, mana, manaRegenProgress }, training });
  const spend = useSpending(unspentPoints);
  /** The info box: a stat or an attribute, anchored on its row. */
  const [info, setInfo] = useState<{ key: StatKey | AttributeKey; anchor: AnchorRect } | null>(null);
  const openInfo = useCallback((key: StatKey | AttributeKey, node: HostInstance | null) => {
    void measureAnchor(node).then((anchor) => anchor && setInfo({ key, anchor }));
  }, []);
  const closeInfo = useCallback(() => setInfo(null), []);
  const attrInfo = info ? attrs.find((a) => a.attribute === info.key) : undefined;
  const attrNames = attrInfo ? ATTRIBUTE_NAMES[attrInfo.attribute] : undefined;

  const cores = attrs.reduce((m, a) => ({ ...m, [a.attribute]: a.core }), {} as Record<AttributeKey, number>);
  const rows: { key: StatKey; label: string; value: string; note?: string; detail: string }[] = [
    { key: 'damage', label: 'Damage', value: range(stats.damage.min, stats.damage.max), detail: `Physical damage ${range(stats.damage.min, stats.damage.max)} = ${describeRange(stats.damage.breakdown)}` },
    {
      key: 'magicDamage',
      label: 'Magic damage',
      value: formatNumber(stats.magicDamage.value),
      detail: `Magic damage ${formatNumber(stats.magicDamage.value)} = ${describeValue(stats.magicDamage.breakdown)}. Added to every strike, reduced by the enemy's magic resist, never rolled or critical.`,
    },
    { key: 'armor', label: 'Armor', value: formatNumber(stats.armor.value), detail: `Armor ${formatNumber(stats.armor.value)} = ${describeValue(stats.armor.breakdown)}` },
    {
      key: 'magicResist',
      label: 'Magic resist',
      value: formatNumber(stats.magicResist.value),
      detail: `Magic resist ${formatNumber(stats.magicResist.value)} = ${describeValue(stats.magicResist.breakdown)}. No enemy deals magic damage yet, so it has no effect in fights for now.`,
    },
    {
      key: 'critChance',
      label: 'Crit chance',
      value: bpPercent(stats.critChanceBp.value),
      detail:
        `Crit chance ${bpPercent(stats.critChanceBp.value)} from core DEX ${formatNumber(cores.dexterity)} on a curve that never passes ` +
        `${bpPercent(STAT_EFFECTS.dexterity.critChance.capBp)}. A crit multiplies the physical part of a strike.`,
    },
    {
      key: 'critMultiplier',
      label: 'Crit damage',
      value: critMultText(stats.critMultiplierBp.value),
      detail:
        `Crit damage ${critMultText(stats.critMultiplierBp.value)} = ${critMultText(STATS.crit.multiplierBaseBp)} base + ` +
        `+${critMultText(STATS.crit.multiplierPerDexterityBp)} per total DEX (no limit).`,
    },
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
      note: `+${formatRate(hpNow.regenPerMin)}/min${hpNow.full ? '' : ` · full in ${formatHoursMinutes(hpNow.fullInMs)}`}`,
      detail:
        `Max HP ${formatNumber(stats.maxHp.value)} = ${describeValue(stats.maxHp.breakdown)}. ` +
        `Regen ${formatRate(hpNow.regenPerMin)}/min = ${STATS.hpRegen.basePerMin} base + ${STATS.hpRegen.perEndurance} × total END.`,
    },
    {
      key: 'maxMana',
      label: 'Mana',
      value: `${formatNumber(manaNow.mana)} / ${formatNumber(stats.maxMana.value)}`,
      note: `+${formatRate(manaNow.regenPerMin)}/min${manaNow.full ? '' : ` · full in ${formatHoursMinutes(manaNow.fullInMs)}`}`,
      detail:
        `Max mana ${formatNumber(stats.maxMana.value)} = ${describeValue(stats.maxMana.breakdown)}. ` +
        `Regen ${formatRate(manaNow.regenPerMin)}/min = ${STATS.manaRegen.basePerMin} base + ${STATS.manaRegen.perIntelligence} × total INT. Nothing uses mana yet.`,
    },
  ];
  const statInfo = info && !attrInfo ? rows.find((r) => r.key === info.key) : undefined;

  return (
    <Panel title="Status">
      {spend.spending ? <SpendBar left={spend.left} pending={spend.pendingTotal} onReset={spend.reset} onConfirm={spend.confirm} /> : null}
      <View style={styles.attrGrid}>
        {attrs.map((a) => {
          const sum = summaryOf(a);
          return (
            <AttributeCell
              key={a.attribute}
              attribute={a.attribute}
              total={a.total}
              pending={spend.pending[a.attribute]}
              spending={spend.spending}
              canAdd={spend.left > 0}
              summary={sum.plain}
              coreSummary={sum.core}
              onInfo={openInfo}
              onAdd={spend.add}
              onRemove={spend.remove}
            />
          );
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
          <PopoverRow label="Spent (level-ups)" value={formatNumber(attrInfo.spent)} />
          {attrInfo.extra !== 0 ? <PopoverRow label="Extra" value={formatNumber(attrInfo.extra)} /> : null}
          <PopoverRow label="Core (training)" value={formatNumber(attrInfo.core)} />
          <PopoverText>
            {`All ${attrNames.short} points (flat): ${effectsText(attrInfo.linear)}`}
          </PopoverText>
          <PopoverText>
            {`Core ${attrNames.short} (a capped multiplier): ${effectsText(attrInfo.coreEffects)}`}
          </PopoverText>
          <PopoverText tone="note">
            Every hero level gives {ATTRIBUTE_POINTS.unspentPerLevel} points to spend (no refunds). Core points come only from the Training Grounds.
          </PopoverText>
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

/**
 * Spending state (1.17.0): the pending allocation, kept in a ref too so hold-to-repeat ticks (100 ms apart) always see
 * the latest value and can refuse quietly (return false) when no point is left.
 */
function useSpending(unspent: number) {
  const { send, dialog } = useCommand();
  const [pending, setPending] = useState<Pending>(NO_PENDING);
  const ref = useRef<Pending>(NO_PENDING);
  const update = useCallback((next: Pending) => {
    ref.current = next;
    setPending(next);
  }, []);
  const pendingTotal = sumOf(pending);
  // The budget shrank under the pending allocation (e.g. a reset save): start over.
  useEffect(() => {
    if (sumOf(ref.current) > unspent) update(NO_PENDING);
  }, [unspent, update]);

  const add = useCallback(
    (k: AttributeKey) => {
      const cur = ref.current;
      if (sumOf(cur) >= unspent) return false;
      update({ ...cur, [k]: cur[k] + 1 });
      return true;
    },
    [unspent, update],
  );
  const remove = useCallback(
    (k: AttributeKey) => {
      const cur = ref.current;
      if (cur[k] <= 0) return false;
      update({ ...cur, [k]: cur[k] - 1 });
      return true;
    },
    [update],
  );
  const reset = useCallback(() => update(NO_PENDING), [update]);
  const confirm = useCallback(async () => {
    const points = ref.current;
    const n = sumOf(points);
    if (n < 1) return;
    const parts = ATTRIBUTE_KEYS.filter((k) => points[k] > 0).map((k) => `${ATTRIBUTE_NAMES[k].short} +${points[k]}`);
    const ok = await dialog.confirm({
      title: `Spend ${n} ${n === 1 ? 'point' : 'points'}?`,
      message: `${parts.join(', ')}.\nPoints can't be refunded.`,
      confirmLabel: 'Spend',
    });
    if (!ok) return;
    const payload: Partial<Pending> = {};
    for (const k of ATTRIBUTE_KEYS) if (points[k] > 0) payload[k] = points[k];
    if (await send({ type: 'SPEND_ATTRIBUTE_POINTS', points: payload })) update(NO_PENDING);
  }, [dialog, send, update]);

  return { pending, pendingTotal, left: Math.max(0, unspent - pendingTotal), spending: unspent > 0, add, remove, reset, confirm };
}

const SpendBar = memo(function SpendBar({ left, pending, onReset, onConfirm }: { left: number; pending: number; onReset: () => void; onConfirm: () => void }) {
  return (
    <View style={styles.spendBar}>
      <Text style={styles.spendText} accessibilityLiveRegion="polite">
        {left} {left === 1 ? 'point' : 'points'} to spend
      </Text>
      <View style={styles.spendButtons}>
        <PixelButton label="Reset" onPress={onReset} disabled={pending === 0} accessibilityHint="Clears the points not confirmed yet" />
        <PixelButton label="Confirm" onPress={onConfirm} disabled={pending === 0} accessibilityHint="Spends the chosen points for good" />
      </View>
    </View>
  );
});

const AttributeCell = memo(function AttributeCell({
  attribute,
  total,
  pending,
  spending,
  canAdd,
  summary,
  coreSummary,
  onInfo,
  onAdd,
  onRemove,
}: {
  attribute: AttributeKey;
  total: number;
  /** Points chosen but not confirmed yet. */
  pending: number;
  /** There are points to spend: show − / +. */
  spending: boolean;
  canAdd: boolean;
  summary: string;
  /** The core effects line, once the attribute has a core point. */
  coreSummary: string | null;
  onInfo: (k: AttributeKey, node: HostInstance | null) => void;
  onAdd: (k: AttributeKey) => boolean;
  onRemove: (k: AttributeKey) => boolean;
}) {
  const ref = useRef<HostInstance>(null);
  const onPress = useCallback(() => onInfo(attribute, ref.current), [onInfo, attribute]);
  const add = useCallback(() => onAdd(attribute), [onAdd, attribute]);
  const remove = useCallback(() => onRemove(attribute), [onRemove, attribute]);
  const names = ATTRIBUTE_NAMES[attribute];
  return (
    <View style={styles.attrCell}>
      <Pressable
        ref={ref}
        onPress={onPress}
        style={styles.attrInfo}
        accessibilityRole="button"
        accessibilityLabel={`${names.label} ${total}${pending > 0 ? `, plus ${pending} pending` : ''}, ${summary}${coreSummary ? `, ${coreSummary}` : ''}`}
        accessibilityHint="Shows normal and core points and what each does"
      >
        <View style={styles.attrTop}>
          <Text style={styles.attrShort}>ⓘ {names.short}</Text>
          <Text style={styles.attrValue}>
            {formatNumber(total)}
            {pending > 0 ? <Text style={styles.attrPending}> (+{pending})</Text> : null}
          </Text>
        </View>
        <Text style={styles.attrEffect}>{summary}</Text>
        {coreSummary ? <Text style={styles.attrCore}>{coreSummary}</Text> : null}
      </Pressable>
      {spending ? (
        <View style={styles.attrButtons}>
          <PixelButton label="−" repeat={remove} disabled={pending === 0} accessibilityLabel={`Remove a pending ${names.short} point`} />
          <PixelButton label="+" repeat={add} disabled={!canAdd} accessibilityLabel={`Add a point to ${names.short}`} />
        </View>
      ) : null}
    </View>
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
    paddingVertical: 5,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.parchmentDark,
  },
  attrInfo: { minHeight: 44 },
  attrTop: { flexDirection: 'row', justifyContent: 'space-between' },
  attrShort: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  attrValue: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  attrPending: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.skill },
  attrButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4, marginBottom: 2 },

  spendBar: {
    marginBottom: 8,
    padding: 8,
    gap: 6,
    backgroundColor: colors.parchmentDark,
    borderWidth: 2,
    borderColor: colors.goldDark,
  },
  spendText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  spendButtons: { flexDirection: 'row', gap: 10 },
  attrEffect: { fontFamily: fonts.body, fontSize: 13, color: colors.skill },
  attrCore: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },

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
