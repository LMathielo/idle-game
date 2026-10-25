// Status strip shown above the tab bar while an activity runs.
// The action bar is driven on the UI thread: each state update snaps it to the engine's
// fraction, then a linear timing runs it to full over the remaining time.
import { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useGameSnapshot } from '../client/GameProvider';
import { activityView, itemQuantity } from '../engine';
import { colors, fonts } from '../theme';
import { formatNumber } from './format';

const ACTIVITY_LABELS = { woodcutting: { icon: '🪓', label: 'Woodcutting' } } as const;

export function ActivityStrip() {
  const { state, clockPaused } = useGameSnapshot();
  const view = activityView(state);
  if (!view) return null;
  const meta = ACTIVITY_LABELS[view.kind];
  return (
    <ActivityStripView
      icon={meta.icon}
      label={meta.label}
      level={view.skillLevel}
      fraction={view.fraction}
      remainingMs={view.remainingMs}
      logs={itemQuantity(state, 'oak_logs')}
      paused={clockPaused}
    />
  );
}

type ViewProps = {
  icon: string;
  label: string;
  level: number;
  fraction: number;
  remainingMs: number;
  logs: number;
  paused: boolean;
};

const ActivityStripView = memo(function ActivityStripView({ icon, label, level, fraction, remainingMs, logs, paused }: ViewProps) {
  const progress = useSharedValue(fraction);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    progress.set(fraction);
    if (!paused && !reducedMotion && remainingMs > 0) {
      progress.set(withTiming(1, { duration: remainingMs, easing: Easing.linear }));
    }
  }, [fraction, remainingMs, paused, reducedMotion, progress]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }));

  return (
    <View style={styles.strip} accessibilityRole="summary" accessibilityLabel={`${label} level ${level}, ${logs} logs`}>
      <View style={styles.row}>
        <Text style={styles.title}>
          {icon} {label} · Lv {level}
        </Text>
        <Text style={styles.count}>🪵 {formatNumber(logs)}</Text>
      </View>
      <View style={styles.barOuter}>
        <Animated.View style={[styles.barFill, fillStyle]} />
      </View>
      {paused ? <Text style={styles.paused}>Paused: device clock moved back</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  strip: {
    backgroundColor: colors.woodDark,
    borderTopWidth: 3,
    borderTopColor: colors.goldDark,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 6,
    gap: 4,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.parchment },
  count: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold },
  barOuter: { height: 10, backgroundColor: colors.slot, borderWidth: 2, borderColor: colors.slotBorder, overflow: 'hidden' },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.skill },
  paused: { fontFamily: fonts.body, fontSize: 11, color: colors.gold },
});
