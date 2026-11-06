// The animated HP bar shared by the live fight, the replay and the pack rows. Visual only (the engine owns every number).
import { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors, fonts } from '../../theme';

const BAR_MS = 220;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export const AnimatedHpBar = memo(function AnimatedHpBar({
  label,
  value,
  max,
  color,
  instant,
  compact = false,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  instant: boolean;
  /** A pack row's bar: no name above it, shorter. */
  compact?: boolean;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const width = useSharedValue(pct);
  useEffect(() => {
    width.set(instant ? pct : withTiming(pct, { duration: BAR_MS, easing: EASE_OUT }));
  }, [pct, instant, width]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${width.get() * 100}%` }));
  return (
    <View style={compact ? styles.barCompact : styles.barBlock} accessible={!compact} accessibilityLabel={`${label} HP ${value} of ${max}`}>
      {compact ? null : (
        <Text style={styles.barName} numberOfLines={1}>
          {label}
        </Text>
      )}
      <View style={[styles.barOuter, compact && styles.barOuterCompact]}>
        <Animated.View style={[styles.barFill, { backgroundColor: color }, fillStyle]} />
        <Text style={styles.barLabel}>
          {value}/{max}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  barBlock: { flex: 1, gap: 2 },
  barCompact: { alignSelf: 'stretch' },
  barName: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
  barOuter: {
    height: 18,
    backgroundColor: colors.slot,
    borderWidth: 2,
    borderColor: colors.slotBorder,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  barOuterCompact: { height: 14 },
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
});
