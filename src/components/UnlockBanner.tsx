// "New dungeon unlocked" banner. Driven by the engine's DUNGEON_UNLOCKED events, which the client
// collects into `snapshot.unlockedDungeons`. Tap to dismiss; it also hides itself after a few seconds.
// Hosted twice, like the away summary: once over the tabs and once inside each village modal (a
// full-screen modal covers the tabs), so it shows wherever the player is.
import { useEffect } from 'react';
import { AccessibilityInfo, Pressable, type StyleProp, StyleSheet, Text, type ViewStyle } from 'react-native';
import Animated, { FadeInDown, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { useGameClient, useGameSnapshot } from '../client/GameProvider';
import { type DungeonId, DUNGEONS } from '../engine';
import { colors, fonts } from '../theme';

const AUTO_HIDE_MS = 5000;

/**
 * The list last read out by the screen reader. Both hosts receive the same array from the snapshot, so
 * comparing identity makes exactly one of them announce it (an `alert` role is ignored on iOS and a live
 * region rarely fires on first mount, hence the explicit announcement).
 */
let lastAnnounced: readonly DungeonId[] | null = null;

function texts(ids: readonly DungeonId[]) {
  const names = ids.map((id) => DUNGEONS[id].name).join(', ');
  const title = ids.length === 1 ? 'New dungeon unlocked!' : 'New dungeons unlocked!';
  return { names, title };
}

/** `position` places the banner inside its host (absolute; left/right are set here). */
export function UnlockBanner({ position }: { position: StyleProp<ViewStyle> }) {
  const client = useGameClient();
  const { unlockedDungeons } = useGameSnapshot();
  const shown = unlockedDungeons.length > 0;

  useEffect(() => {
    if (!shown || lastAnnounced === unlockedDungeons) return;
    lastAnnounced = unlockedDungeons;
    const { title, names } = texts(unlockedDungeons);
    AccessibilityInfo.announceForAccessibility(`${title} ${names}`);
  }, [shown, unlockedDungeons]);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => client.dismissUnlocks(), AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [client, shown, unlockedDungeons]);

  if (!shown) return null;
  const { names, title } = texts(unlockedDungeons);
  return (
    <Animated.View
      entering={FadeInDown.reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.reduceMotion(ReduceMotion.System)}
      style={[styles.wrap, position]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={() => client.dismissUnlocks()}
        accessibilityRole="button"
        accessibilityLabel={`${title} ${names}`}
        accessibilityHint="Dismisses this message"
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
