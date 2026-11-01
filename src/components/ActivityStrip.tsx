// Status strip shown above the tab bar while an activity runs (woodcutting, mining, dungeon runs or training), or,
// with no activity, while the builder upgrades a building.
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useGameSnapshot } from '../client/GameProvider';
import { activityView, constructionView, DUNGEONS, ENEMIES, hpView, itemQuantity, ROCKS, TREES } from '../engine';
import { colors, fonts } from '../theme';
import { ATTRIBUTE_NAMES, formatClock, formatCountdown, formatNumber, formatTrainingLeft } from './format';
import { LiveBar } from './LiveBar';

/** Fixed height: the strip floats over the screen, so scrollable screens reserve this much at the bottom. */
export const ACTIVITY_STRIP_HEIGHT = 44;

const PAUSED_A11Y = ', paused because the device clock moved back';

export function ActivityStrip() {
  const { state, clockPaused } = useGameSnapshot();
  const view = activityView(state);
  if (!view) {
    // No hero activity: the strip shows the builder's job instead, when there is one.
    const job = constructionView(state);
    if (!job) return null;
    return (
      <StripView
        title={`🔨 ${job.name} → Lv ${job.level} · ${formatCountdown(job.remainingMs)}`}
        right="Builder"
        a11y={`Upgrading ${job.name} to level ${job.level}, ${formatCountdown(job.remainingMs)} left${clockPaused ? PAUSED_A11Y : ''}`}
        fraction={job.fraction}
        remainingMs={job.remainingMs}
        paused={clockPaused}
        color={colors.gold}
      />
    );
  }

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
        title={`🏋️ Training core ${names.short} · Lv ${view.core} · ${left} to next`}
        right={`${names.short} ${formatNumber(view.total)}`}
        a11y={`Training core ${names.label}, level ${view.core} of ${view.cap}, ${left} to the next level, ${names.label} ${view.total}${clockPaused ? PAUSED_A11Y : ''}`}
        fraction={view.fraction}
        remainingMs={view.remainingMs}
        paused={clockPaused}
        color={colors.skill}
      />
    );
  }

  if (view.kind === 'mining') {
    const rock = ROCKS[view.rockId];
    const ores = itemQuantity(state, rock.oreItemId);
    return (
      <StripView
        title={`⛏️ ${rock.name} · ${formatClock(view.remainingMs)} · Lv ${view.skillLevel}`}
        right={`${rock.icon} ${formatNumber(ores)}`}
        a11y={`Mining ${rock.name}, ${formatClock(view.remainingMs)} to the next ore, mining level ${view.skillLevel}, ${ores} ${rock.name}${clockPaused ? PAUSED_A11Y : ''}`}
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
  paused: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.gold },
});
