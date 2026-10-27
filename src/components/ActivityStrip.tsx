// Status strip shown above the tab bar while an activity runs (woodcutting, dungeon runs or training).
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useGameSnapshot } from '../client/GameProvider';
import { activityView, DUNGEONS, ENEMIES, hpView, itemQuantity, TREES } from '../engine';
import { colors, fonts } from '../theme';
import { ATTRIBUTE_NAMES, formatClock, formatNumber, formatTrainingLeft } from './format';
import { LiveBar } from './LiveBar';

/** Fixed height: the strip floats over the screen, so scrollable screens reserve this much at the bottom. */
export const ACTIVITY_STRIP_HEIGHT = 44;

const PAUSED_A11Y = ', paused because the device clock moved back';

export function ActivityStrip() {
  const { state, clockPaused } = useGameSnapshot();
  const view = activityView(state);
  if (!view) return null;

  if (view.kind === 'dungeon') {
    const dungeon = DUNGEONS[view.dungeonId];
    const hp = hpView(state);
    const fight = view.fight;
    if (fight) {
      // Fight phase: the bar shows the enemy's HP lost (snapped on every engine tick, never animated ahead).
      const enemy = ENEMIES[fight.enemyId];
      const lost = fight.enemyMaxHp > 0 ? 1 - fight.enemyHp / fight.enemyMaxHp : 1;
      return (
        <StripView
          title={`⚔️ ${dungeon.name} · ${enemy.name} ${formatNumber(fight.enemyHp)}/${formatNumber(fight.enemyMaxHp)}`}
          right={`HP ${formatNumber(hp.hp)}/${formatNumber(hp.maxHp)}`}
          a11y={`${dungeon.name}, fighting ${enemy.name}, ${enemy.name} HP ${fight.enemyHp} of ${fight.enemyMaxHp}, your HP ${hp.hp} of ${hp.maxHp}${clockPaused ? PAUSED_A11Y : ''}`}
          fraction={lost}
          remainingMs={0}
          paused
          color={colors.hp}
        />
      );
    }
    return (
      <StripView
        title={`${dungeon.icon} ${dungeon.name} · searching ${formatClock(view.remainingMs)}`}
        right={`HP ${formatNumber(hp.hp)}/${formatNumber(hp.maxHp)}`}
        a11y={`${dungeon.name}, searching for an opponent, ${formatClock(view.remainingMs)} left, HP ${hp.hp} of ${hp.maxHp}${clockPaused ? PAUSED_A11Y : ''}`}
        fraction={view.fraction}
        remainingMs={view.remainingMs}
        paused={clockPaused}
        color={colors.hp}
      />
    );
  }

  if (view.kind === 'training') {
    const names = ATTRIBUTE_NAMES[view.attribute];
    const left = formatTrainingLeft(view.remainingMs);
    return (
      <StripView
        title={`🏋️ Training ${names.short} · Lv ${view.trained} · ${left} to next`}
        right={`${names.short} ${formatNumber(view.effective)}`}
        a11y={`Training ${names.label}, level ${view.trained} of ${view.cap}, ${left} to the next level, ${names.label} ${view.effective}${clockPaused ? PAUSED_A11Y : ''}`}
        fraction={view.fraction}
        remainingMs={view.remainingMs}
        paused={clockPaused}
        color={colors.skill}
      />
    );
  }

  const tree = TREES[view.treeId];
  const logs = itemQuantity(state, tree.logItemId);
  return (
    <StripView
      title={`🪓 ${tree.name} · ${formatClock(view.remainingMs)} · Lv ${view.skillLevel}`}
      right={`🪵 ${formatNumber(logs)}`}
      a11y={`Cutting ${tree.name}, ${formatClock(view.remainingMs)} to the next log, woodcutting level ${view.skillLevel}, ${logs} ${tree.name} logs${clockPaused ? PAUSED_A11Y : ''}`}
      fraction={view.fraction}
      remainingMs={view.remainingMs}
      paused={clockPaused}
      color={colors.skill}
    />
  );
}

type ViewProps = {
  title: string;
  right: string;
  a11y: string;
  fraction: number;
  remainingMs: number;
  paused: boolean;
  color: string;
};

const StripView = memo(function StripView({ title, right, a11y, fraction, remainingMs, paused, color }: ViewProps) {
  return (
    <View style={styles.strip} pointerEvents="none" accessible accessibilityRole="summary" accessibilityLabel={a11y}>
      <View style={styles.row}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
          {paused ? <Text style={styles.paused}>  ⏸ Paused</Text> : null}
        </Text>
        <Text style={styles.count}>{right}</Text>
      </View>
      <LiveBar fraction={fraction} remainingMs={remainingMs} paused={paused} color={color} />
    </View>
  );
});

const styles = StyleSheet.create({
  // Absolute overlay sitting on top of the tab bar: mounting it never resizes the screen above.
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    height: ACTIVITY_STRIP_HEIGHT,
    justifyContent: 'center',
    backgroundColor: colors.woodDark,
    borderTopWidth: 3,
    borderTopColor: colors.goldDark,
    paddingHorizontal: 12,
    gap: 4,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 14, color: colors.parchment },
  count: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold, marginLeft: 8 },
  paused: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.gold },
});
