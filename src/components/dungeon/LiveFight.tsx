// The fight in progress, as the engine has played it up to now. Strikes appear when engine time reaches them
// (the client ticks every second); nothing here times or decides anything. The outcome is applied by the
// engine when the fight ends, and the panel then shows the next search.
import { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { type DungeonFightView, type EnemyId, mobName } from '../../engine';
import { colors, fonts } from '../../theme';
import { EnemySprite } from '../art/Sprites';
import { LogLine, StunNotice, strikeTime } from './FightReplay';
import { AnimatedHpBar } from './HpBars';
import { PackRows } from './PackRows';
import { displayClockMs, displayedFight, isFreshFight } from './fightDisplay';
import { mobLabel, packText } from './outcome';

/** Lines kept on screen; older strikes scroll out (the last fight's replay has them all). */
const VISIBLE_LINES = 8;

type Props = {
  fight: DungeonFightView;
  heroName: string;
  enemyId: EnemyId;
  paused: boolean;
};

/** Redraw rate of the display clock while it is catching up to the engine. */
const DISPLAY_STEP_MS = 50;

/**
 * The fight as the display clock has it (fightDisplay.ts): a view opened on a fresh fight starts 100 ms behind fight time 0, so the first
 * hit lands on screen after the screen opens. Not delayed for a fight already well underway or with reduce-motion on.
 */
function useDisplayedFight(fight: DungeonFightView, reducedMotion: boolean): DungeonFightView {
  const open = useRef<{ at: number; fresh: boolean; last: number } | null>(null);
  const [, redraw] = useState(0);
  const now = Date.now();
  // A new fight replaces the one on screen (engine time went back): its lead-in plays again.
  if (!open.current || fight.elapsedMs < open.current.last) open.current = { at: now, fresh: isFreshFight(fight.elapsedMs), last: fight.elapsedMs };
  open.current.last = fight.elapsedMs;
  const fresh = open.current.fresh && !reducedMotion;
  const displayMs = displayClockMs(fight.elapsedMs, now - open.current.at, fresh);
  const behind = displayMs < fight.elapsedMs || (fresh && displayMs < 0);
  useEffect(() => {
    if (!behind) return;
    const id = setInterval(() => redraw((n) => n + 1), DISPLAY_STEP_MS);
    return () => clearInterval(id);
  }, [behind]);
  return displayedFight(fight, displayMs);
}

export const LiveFight = memo(function LiveFight({ fight: engineFight, heroName, enemyId, paused }: Props) {
  const reducedMotion = useReducedMotion();
  const fight = useDisplayedFight(engineFight, reducedMotion);
  const lines = fight.log.slice(-VISIBLE_LINES);
  const hidden = fight.log.length - lines.length;
  const clock = `${strikeTime(fight.elapsedMs)} / ${strikeTime(fight.maxFightMs)}`;
  // A regenerating enemy (a boss): whole HP a second, from its basis points of max HP (display only, the engine heals it).
  const regenPerSec = Math.floor((fight.enemyMaxHp * fight.enemyRegenBp) / 10_000);
  // A pack (Hard / Extreme, 1.24.0): the mobs as rows, the log naming the creature ("Blight Rat #3 hits ..."). One mob keeps the two bars.
  const size = fight.mobs.length;
  const packed = size > 1;
  const soloName = mobName(enemyId, fight.mobs[0]?.variant ?? 'base');
  const nameOf = (mob: number | undefined) => mobLabel(enemyId, fight.mobs[mob ?? 0]?.variant ?? 'base', mob ?? 0, size);
  const title = packed ? `Fighting a pack: ${packText(size)}` : `Fighting ${soloName}`;
  const down = fight.mobs.filter((m) => !m.alive).length;
  return (
    <View style={styles.root}>
      <View
        style={styles.header}
        accessible
        accessibilityLabel={`${title}${packed ? `, ${down} down` : ''}. ${heroName} HP ${fight.heroHp} of ${fight.heroMaxHp}, ${packed ? 'pack' : soloName} HP ${fight.enemyHp} of ${fight.enemyMaxHp}. ${clock}${paused ? ', paused' : ''}`}
      >
        <View style={styles.who}>
          <EnemySprite enemyId={enemyId} variant={packed ? 'base' : (fight.mobs[0]?.variant ?? 'base')} />
          <Text style={styles.title}>{title}</Text>
        </View>
        <Text style={styles.clock}>{paused ? `Paused · ${clock}` : clock}</Text>
      </View>
      <View style={styles.bars}>
        <AnimatedHpBar label={heroName} value={fight.heroHp} max={fight.heroMaxHp} color={colors.skill} instant={reducedMotion} />
        {packed ? null : <AnimatedHpBar label={soloName} value={fight.enemyHp} max={fight.enemyMaxHp} color={colors.hp} instant={reducedMotion} />}
      </View>
      {packed ? <PackRows enemyId={enemyId} mobs={fight.mobs} instant={reducedMotion} /> : null}
      {regenPerSec > 0 ? <Text style={styles.note}>{soloName} heals {regenPerSec} HP a second.</Text> : null}
      {fight.heroStunStrikes > 0 ? <StunNotice name={heroName} strikes={fight.heroStunStrikes} /> : null}
      <View style={styles.log}>
        {fight.log.length === 0 ? <Text style={styles.wait}>{packed ? 'The pack circles you…' : `The ${soloName} circles you…`}</Text> : null}
        {hidden > 0 ? <Text style={styles.more}>… {hidden} earlier {hidden === 1 ? 'strike' : 'strikes'}</Text> : null}
        {lines.map((e) => (
          <LogLine key={`${e.actor}-${e.mob ?? 0}-${e.strike}`} entry={e} heroName={heroName} enemyName={nameOf(e.mob)} />
        ))}
      </View>
      <Text style={styles.note}>The fight plays out live and can't be skipped. Closing this screen keeps it going.</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink, flexShrink: 1 },
  clock: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink },
  bars: { flexDirection: 'row', gap: 10 },
  log: { gap: 3, minHeight: 40 },
  wait: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  more: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  note: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft, textAlign: 'center' },
});
