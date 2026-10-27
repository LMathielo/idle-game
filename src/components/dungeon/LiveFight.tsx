// The fight in progress, as the engine has played it up to now. Strikes appear when engine time reaches them
// (the client ticks every second); nothing here times or decides anything. The outcome is applied by the
// engine when the fight ends, and the panel then shows the next search.
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import type { DungeonFightView } from '../../engine';
import { colors, fonts } from '../../theme';
import { AnimatedHpBar, LogLine, strikeTime } from './FightReplay';

/** Lines kept on screen; older strikes scroll out (the last fight's replay has them all). */
const VISIBLE_LINES = 8;

type Props = {
  fight: DungeonFightView;
  heroName: string;
  enemyName: string;
  enemyIcon: string;
  paused: boolean;
};

export const LiveFight = memo(function LiveFight({ fight, heroName, enemyName, enemyIcon, paused }: Props) {
  const reducedMotion = useReducedMotion();
  const lines = fight.log.slice(-VISIBLE_LINES);
  const hidden = fight.log.length - lines.length;
  const clock = `${strikeTime(fight.elapsedMs)} / ${strikeTime(fight.maxFightMs)}`;
  return (
    <View style={styles.root}>
      <View
        style={styles.header}
        accessible
        accessibilityLabel={`Fighting ${enemyName}. ${heroName} HP ${fight.heroHp} of ${fight.heroMaxHp}, ${enemyName} HP ${fight.enemyHp} of ${fight.enemyMaxHp}. ${clock}${paused ? ', paused' : ''}`}
      >
        <Text style={styles.title}>
          ⚔️ Fighting {enemyIcon} {enemyName}
        </Text>
        <Text style={styles.clock}>{paused ? `⏸ ${clock}` : clock}</Text>
      </View>
      <View style={styles.bars}>
        <AnimatedHpBar label={heroName} value={fight.heroHp} max={fight.heroMaxHp} color={colors.skill} instant={reducedMotion} />
        <AnimatedHpBar label={enemyName} value={fight.enemyHp} max={fight.enemyMaxHp} color={colors.hp} instant={reducedMotion} />
      </View>
      <View style={styles.log}>
        {fight.log.length === 0 ? <Text style={styles.wait}>The {enemyName} circles you…</Text> : null}
        {hidden > 0 ? <Text style={styles.more}>… {hidden} earlier {hidden === 1 ? 'strike' : 'strikes'}</Text> : null}
        {lines.map((e) => (
          <LogLine key={`${e.actor}-${e.strike}`} entry={e} heroName={heroName} enemyName={enemyName} />
        ))}
      </View>
      <Text style={styles.note}>The fight plays out live and can't be skipped. Closing this screen keeps it going.</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink, flexShrink: 1 },
  clock: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink },
  bars: { flexDirection: 'row', gap: 10 },
  log: { gap: 3, minHeight: 40 },
  wait: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  more: { fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft },
  note: { fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft, textAlign: 'center' },
});
