// Visual-only replay of the engine's fight log: lines appear one by one while both HP bars animate.
// Timing never changes anything; the outcome is already in the save. LogLine and AnimatedHpBar are shared
// with the live fight (LiveFight.tsx).
import { memo, useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import type { FightLogEntry, FightRecord } from '../../engine';
import { colors, fonts } from '../../theme';
import { PixelButton } from '../PixelButton';
import { OUTCOME_LABELS } from './outcome';

/** Whole replay takes about this long (each line between 40 and 600 ms). */
const REPLAY_TOTAL_MS = 3000;
const BAR_MS = 220;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export function replayStepMs(lines: number): number {
  return Math.min(600, Math.max(40, Math.floor(REPLAY_TOTAL_MS / Math.max(1, lines))));
}

type Props = {
  fight: FightRecord;
  heroName: string;
  enemyName: string;
  onClose: () => void;
};

export function FightReplay({ fight, heroName, enemyName, onClose }: Props) {
  const reducedMotion = useReducedMotion();
  const total = fight.log.length;
  const [shown, setShown] = useState(reducedMotion ? total : 0);

  // One line per step; the parent remounts this component (new key) for a new replay.
  useEffect(() => {
    if (reducedMotion && shown < total) {
      setShown(total);
      return;
    }
    if (shown >= total) return;
    const id = setTimeout(() => setShown((n) => Math.min(total, n + 1)), replayStepMs(total));
    return () => clearTimeout(id);
  }, [shown, total, reducedMotion]);

  // HP after the last shown strike of each side.
  let heroHp = fight.heroHpStart;
  let enemyHp = fight.enemyMaxHp;
  for (let i = 0; i < shown; i++) {
    const e = fight.log[i];
    if (e.actor === 'hero') enemyHp = e.targetHpAfter;
    else heroHp = e.targetHpAfter;
  }
  const done = shown >= total;
  if (done) heroHp = fight.heroHpEnd; // a time-limit loss ends at 0 even though no strike says so (and regen shows here)
  const result = OUTCOME_LABELS[fight.endReason];

  // Screen readers hear the result once, not every line as it appears.
  useEffect(() => {
    if (done) AccessibilityInfo.announceForAccessibility(`Replay finished: ${result}`);
  }, [done, result]);

  return (
    <View style={styles.root}>
      <View style={styles.bars}>
        <AnimatedHpBar label={heroName} value={heroHp} max={fight.heroMaxHp} color={colors.skill} instant={reducedMotion} />
        <AnimatedHpBar label={enemyName} value={enemyHp} max={fight.enemyMaxHp} color={colors.hp} instant={reducedMotion} />
      </View>
      <View style={styles.log}>
        {fight.log.length === 0 ? <Text style={styles.line}>{heroName} had no HP left and could not fight.</Text> : null}
        {fight.log.slice(0, shown).map((e, i) => (
          <LogLine key={i} entry={e} heroName={heroName} enemyName={enemyName} />
        ))}
        {done ? (
          <Text style={[styles.result, fight.won ? styles.win : styles.loss]} accessibilityLiveRegion="polite">
            {result}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        <PixelButton label={done ? 'Close replay' : 'Skip replay'} onPress={done ? onClose : () => setShown(total)} />
      </View>
    </View>
  );
}

/** "0:07": fight time when the strike landed, whole seconds rounded down. */
export function strikeTime(atMs: number): string {
  const s = Math.max(0, Math.floor(atMs / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const LogLine = memo(function LogLine({ entry, heroName, enemyName }: { entry: FightLogEntry; heroName: string; enemyName: string }) {
  const hero = entry.actor === 'hero';
  const attacker = hero ? heroName : enemyName;
  const target = hero ? enemyName : heroName;
  const text = `${strikeTime(entry.atMs)} · ${attacker} hits ${target} for ${entry.dealt}${entry.dealt !== entry.roll ? ` (rolled ${entry.roll})` : ''} → ${entry.targetHpAfter} HP`;
  return (
    <Text style={[styles.line, hero ? styles.heroLine : styles.enemyLine]} accessibilityLabel={text}>
      {text}
    </Text>
  );
});

export const AnimatedHpBar = memo(function AnimatedHpBar({
  label,
  value,
  max,
  color,
  instant,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  instant: boolean;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const width = useSharedValue(pct);
  useEffect(() => {
    width.set(instant ? pct : withTiming(pct, { duration: BAR_MS, easing: EASE_OUT }));
  }, [pct, instant, width]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${width.get() * 100}%` }));
  return (
    <View style={styles.barBlock} accessible accessibilityLabel={`${label} HP ${value} of ${max}`}>
      <Text style={styles.barName} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.barOuter}>
        <Animated.View style={[styles.barFill, { backgroundColor: color }, fillStyle]} />
        <Text style={styles.barLabel}>
          {value}/{max}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: 10 },
  bars: { flexDirection: 'row', gap: 10 },
  barBlock: { flex: 1, gap: 2 },
  barName: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
  barOuter: {
    height: 18,
    backgroundColor: colors.slot,
    borderWidth: 2,
    borderColor: colors.slotBorder,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  barLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: '#fff',
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  log: { gap: 3, minHeight: 40 },
  line: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.ink },
  heroLine: { color: colors.ink },
  enemyLine: { color: colors.hp },
  result: { fontFamily: fonts.title, fontSize: 20, marginTop: 4 },
  win: { color: colors.skill },
  loss: { color: colors.hp },
  actions: { alignItems: 'center' },
});
