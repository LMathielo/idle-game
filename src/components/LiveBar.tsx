// Progress bar for a running timer, driven on the UI thread: each state update snaps it to the
// engine's fraction, then a linear timing runs it to full over the remaining time.
import { memo, useEffect } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors } from '../theme';

type Props = {
  fraction: number;
  remainingMs: number;
  paused: boolean;
  color: string;
  style?: StyleProp<ViewStyle>;
};

export const LiveBar = memo(function LiveBar({ fraction, remainingMs, paused, color, style }: Props) {
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
    <View style={[styles.outer, style]}>
      <Animated.View style={[styles.fill, { backgroundColor: color }, fillStyle]} />
    </View>
  );
});

const styles = StyleSheet.create({
  outer: { height: 10, backgroundColor: colors.slot, borderWidth: 2, borderColor: colors.slotBorder, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
});
