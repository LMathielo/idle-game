// "New dungeon unlocked" banner. Driven by the engine's DUNGEON_UNLOCKED events, which the client
// collects into `snapshot.unlockedDungeons` (and, 1.24.0, `snapshot.unlockedHarder`: "Hard unlocked for Tier 1", "Extreme unlocked for
// Tier 1", and a boss opening on Hard / Extreme). Tap to dismiss; it also hides itself after a few seconds.
// Hosted twice, like the away summary: once over the tabs and once inside each village modal (a
// full-screen modal covers the tabs), so it shows wherever the player is.
import { useEffect } from 'react';
import { AccessibilityInfo, Pressable, type StyleProp, StyleSheet, Text, type ViewStyle } from 'react-native';
import Animated, { FadeInDown, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { useGameClient, useGameSnapshot } from '../client/GameProvider';
import { BOSSES, DIFFICULTY, type DungeonOrBossId, dungeonOrBossName, type HarderUnlock, isBossId } from '../engine';
import { colors, fonts } from '../theme';
import { GameIcon } from './art/Sprites';

const AUTO_HIDE_MS = 5000;

/**
 * The list last read out by the screen reader. Both hosts receive the same array from the snapshot, so
 * comparing identity makes exactly one of them announce it (an `alert` role is ignored on iOS and a live
 * region rarely fires on first mount, hence the explicit announcement).
 */
let lastAnnounced: { dungeons: readonly DungeonOrBossId[]; harder: readonly HarderUnlock[] } | null = null;

function harderText(u: HarderUnlock): string {
  return u.kind === 'difficulty' ? `${DIFFICULTY[u.difficulty].name} unlocked for Tier ${u.tier}` : `${BOSSES[u.bossId].name} unlocked on ${DIFFICULTY[u.difficulty].name}`;
}

function texts(ids: readonly DungeonOrBossId[], harder: readonly HarderUnlock[]) {
  const names = ids.map(dungeonOrBossName).join(', ');
  const dungeonTitle = ids.every(isBossId) ? (ids.length === 1 ? 'Boss unlocked!' : 'Bosses unlocked!') : ids.length === 1 ? 'New dungeon unlocked!' : 'New dungeons unlocked!';
  if (harder.length === 0) return { names, title: dungeonTitle };
  // The harder difficulty leads ("Hard unlocked for Tier 1"); a dungeon unlocked at the same time follows.
  const title = harder.map(harderText).join('\n');
  return { names: ids.length > 0 ? `${dungeonTitle} ${names}` : '', title };
}

/** `position` places the banner inside its host (absolute; left/right are set here). */
export function UnlockBanner({ position }: { position: StyleProp<ViewStyle> }) {
  const client = useGameClient();
  const { unlockedDungeons, unlockedHarder } = useGameSnapshot();
  const shown = unlockedDungeons.length > 0 || unlockedHarder.length > 0;

  useEffect(() => {
    if (!shown || (lastAnnounced?.dungeons === unlockedDungeons && lastAnnounced?.harder === unlockedHarder)) return;
    lastAnnounced = { dungeons: unlockedDungeons, harder: unlockedHarder };
    const { title, names } = texts(unlockedDungeons, unlockedHarder);
    AccessibilityInfo.announceForAccessibility(`${title.replace('\n', '. ')} ${names}`);
  }, [shown, unlockedDungeons, unlockedHarder]);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => client.dismissUnlocks(), AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [client, shown, unlockedDungeons, unlockedHarder]);

  if (!shown) return null;
  const { names, title } = texts(unlockedDungeons, unlockedHarder);
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
        accessibilityLabel={`${title.replace('\n', '. ')} ${names}`}
        accessibilityHint="Dismisses this message"
        style={styles.banner}
      >
        <GameIcon name="unlocked" size={32} />
        <Text style={styles.text}>
          <Text style={styles.title}>{title}</Text>
          {names ? '\n' : ''}
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
  text: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.parchment },
  title: { fontFamily: fonts.bodyBold, color: colors.gold },
});
