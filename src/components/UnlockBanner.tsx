// "New dungeon unlocked" banner. Driven by the engine's DUNGEON_UNLOCKED events, which the client
// collects into `snapshot.unlockedDungeons`. Tap to dismiss; it also hides itself after a few seconds.
// Hosted twice, like the away summary: once over the tabs and once inside each village modal (a
// full-screen modal covers the tabs), so it shows wherever the player is.
import { useEffect } from 'react';
import { Pressable, type StyleProp, StyleSheet, Text, type ViewStyle } from 'react-native';
import Animated, { FadeInDown, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { useGameClient, useGameSnapshot } from '../client/GameProvider';
import { DUNGEONS } from '../engine';
import { colors, fonts } from '../theme';

const AUTO_HIDE_MS = 5000;

/** `position` places the banner inside its host (absolute; left/right are set here). */
export function UnlockBanner({ position }: { position: StyleProp<ViewStyle> }) {
  const client = useGameClient();
  const { unlockedDungeons } = useGameSnapshot();
  const shown = unlockedDungeons.length > 0;

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => client.dismissUnlocks(), AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [client, shown, unlockedDungeons]);

  if (!shown) return null;
  const names = unlockedDungeons.map((id) => DUNGEONS[id].name).join(', ');
  const title = unlockedDungeons.length === 1 ? 'New dungeon unlocked!' : 'New dungeons unlocked!';
  return (
    <Animated.View
      entering={FadeInDown.reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.reduceMotion(ReduceMotion.System)}
      style={[styles.wrap, position]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={() => client.dismissUnlocks()}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${title} ${names}. Tap to dismiss.`}
        style={styles.banner}
      >
        <Text style={styles.icon}>🔓</Text>
        <Text style={styles.text}>
          <Text style={styles.title}>{title}</Text>
          {'\n'}
          {names}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 10, elevation: 12 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.woodDark,
    borderWidth: 3,
    borderColor: colors.gold,
  },
  icon: { fontSize: 26 },
  text: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.parchment },
  title: { fontFamily: fonts.bodyBold, color: colors.gold },
});
