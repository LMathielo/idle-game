// Status strip shown above the tab bar while an activity runs (woodcutting, mining, dungeon runs or training), or,
// with no activity, while the builder upgrades a building.
import { memo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useGameSnapshot } from '../client/GameProvider';
import { activityView, BOSSES, constructionView, DIFFICULTY, DUNGEONS, hpView, itemQuantity, mobName, ROCKS, TREES } from '../engine';
import { colors, fonts } from '../theme';
import { GameIcon, ItemIcon, SkillIcon } from './art/Sprites';
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
        icon={<GameIcon name="upgrade" />}
        title={`${job.name} → Lv ${job.level} · ${formatCountdown(job.remainingMs)}`}
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
      // The creature it is (a Hard / Extreme mob is a Giant Rat, a Plague Bat ...), from the engine's variant table.
      const enemy = { name: mobName(fight.enemyId, fight.mobs[0]?.variant ?? 'base') };
      const lost = fight.enemyMaxHp > 0 ? 1 - fight.enemyHp / fight.enemyMaxHp : 1;
      // Hard / Extreme (1.24.0): the difficulty and how many mobs of the pack are still up.
      const harder = view.difficulty !== 'normal';
      const left = fight.mobs.filter((m) => m.alive).length;
      const tag = DIFFICULTY[view.difficulty].name;
      const pack = fight.mobs.length > 1 ? `${left}/${fight.mobs.length} mobs left` : `${enemy.name} ${formatNumber(fight.enemyHp)}/${formatNumber(fight.enemyMaxHp)}`;
      return (
        <StripView
          icon={<GameIcon name="fight" />}
          title={harder ? `${dungeon.name} · ${tag} · ${pack}` : `${dungeon.name} · ${enemy.name} ${formatNumber(fight.enemyHp)}/${formatNumber(fight.enemyMaxHp)}`}
          right={`HP ${formatNumber(hp.hp)}/${formatNumber(hp.maxHp)}`}
          a11y={`${dungeon.name}${harder ? ` on ${tag}` : ''}, fighting ${fight.mobs.length > 1 ? `a pack of ${fight.mobs.length}, ${left} still standing` : enemy.name}, ${fight.mobs.length > 1 ? 'pack' : enemy.name} HP ${fight.enemyHp} of ${fight.enemyMaxHp}, your HP ${hp.hp} of ${hp.maxHp}${clockPaused ? PAUSED_A11Y : ''}`}
          fraction={lost}
          remainingMs={0}
          paused
          color={colors.hp}
        />
      );
    }
    return (
      <StripView
        icon={<GameIcon name="fight" />}
        title={`${dungeon.name}${view.difficulty === 'normal' ? '' : ` · ${DIFFICULTY[view.difficulty].name}`} · searching ${formatClock(view.remainingMs)}`}
        right={`HP ${formatNumber(hp.hp)}/${formatNumber(hp.maxHp)}`}
        a11y={`${dungeon.name}${view.difficulty === 'normal' ? '' : ` on ${DIFFICULTY[view.difficulty].name}`}, searching for an opponent, ${formatClock(view.remainingMs)} left, HP ${hp.hp} of ${hp.maxHp}${clockPaused ? PAUSED_A11Y : ''}`}
        fraction={view.fraction}
        remainingMs={view.remainingMs}
        paused={clockPaused}
        color={colors.hp}
      />
    );
  }

  if (view.kind === 'boss') {
    // The boss fight: the bar shows the boss's HP lost (it regenerates, so the bar can move back); a stun is spelled out.
    const boss = BOSSES[view.bossId];
    const hp = hpView(state);
    const fight = view.fight;
    const lost = fight.enemyMaxHp > 0 ? 1 - fight.enemyHp / fight.enemyMaxHp : 1;
    const stunned = fight.heroStunStrikes > 0;
    return (
      <StripView
        icon={<GameIcon name="fight" />}
        title={`${boss.name}${view.difficulty === 'normal' ? '' : ` (${DIFFICULTY[view.difficulty].name})`} ${formatNumber(fight.enemyHp)}/${formatNumber(fight.enemyMaxHp)}${stunned ? ' · Stunned' : ''}`}
        right={`HP ${formatNumber(hp.hp)}/${formatNumber(hp.maxHp)}`}
        a11y={`Boss fight against ${boss.name}${view.difficulty === 'normal' ? '' : ` on ${DIFFICULTY[view.difficulty].name}`}, its HP ${fight.enemyHp} of ${fight.enemyMaxHp}, your HP ${hp.hp} of ${hp.maxHp}${stunned ? `, you are stunned for ${fight.heroStunStrikes} more strikes` : ''}${clockPaused ? PAUSED_A11Y : ''}`}
        fraction={lost}
        remainingMs={0}
        paused
        color={colors.hp}
      />
    );
  }

  if (view.kind === 'training') {
    const names = ATTRIBUTE_NAMES[view.attribute];
    const left = formatTrainingLeft(view.remainingMs);
    return (
      <StripView
        icon={<GameIcon name="training" />}
        title={`Training core ${names.short} · Lv ${view.core} · ${left} to next`}
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
        icon={<SkillIcon skill="mining" />}
        title={`${rock.name} · ${formatClock(view.remainingMs)} · Lv ${view.skillLevel}`}
        rightIcon={<ItemIcon defId={rock.oreItemId} size={16} />}
        right={formatNumber(ores)}
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
      icon={<SkillIcon skill="woodcutting" />}
      title={`${tree.name} · ${formatClock(view.remainingMs)} · Lv ${view.skillLevel}`}
      rightIcon={<ItemIcon defId={tree.logItemId} size={16} />}
      right={formatNumber(logs)}
      a11y={`Cutting ${tree.name}, ${formatClock(view.remainingMs)} to the next log, woodcutting level ${view.skillLevel}, ${logs} ${tree.name} logs${clockPaused ? PAUSED_A11Y : ''}`}
      fraction={view.fraction}
      remainingMs={view.remainingMs}
      paused={clockPaused}
      color={colors.skill}
    />
  );
}

type ViewProps = {
  /** Pixel symbol before the title. */
  icon: ReactNode;
  title: string;
  /** Pixel symbol before the right-hand count (the item being gathered). */
  rightIcon?: ReactNode;
  right: string;
  a11y: string;
  fraction: number;
  remainingMs: number;
  paused: boolean;
  color: string;
};

const StripView = memo(function StripView({ icon, title, rightIcon, right, a11y, fraction, remainingMs, paused, color }: ViewProps) {
  return (
    <View style={styles.strip} pointerEvents="none" accessible accessibilityRole="summary" accessibilityLabel={a11y}>
      <View style={styles.row}>
        {icon}
        <Text style={styles.title} numberOfLines={1}>
          {title}
          {paused ? <Text style={styles.paused}>  Paused</Text> : null}
        </Text>
        <View style={styles.right}>
          {rightIcon}
          <Text style={styles.count}>{right}</Text>
        </View>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 14, color: colors.parchment },
  right: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 2 },
  count: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold },
  paused: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.gold },
});
