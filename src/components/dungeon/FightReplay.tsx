// Visual-only replay of the engine's fight log: lines appear one by one while both HP bars animate.
// Timing never changes anything; the outcome is already in the save. LogLine and AnimatedHpBar are shared
// with the live fight (LiveFight.tsx).
import { memo, useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { COMBAT_SKILLS, type FightLogEntry, type FightRecord, mobName } from '../../engine';
import { colors, fonts } from '../../theme';
import { PixelButton } from '../PixelButton';
import { FIGHT_VIEW_LEAD_MS } from './fightDisplay';
import { AnimatedHpBar } from './HpBars';
import { PackRows } from './PackRows';
import { mobLabel, outcomeLabel } from './outcome';

/** Whole replay takes about this long (each line between 40 and 600 ms). */
const REPLAY_TOTAL_MS = 3000;

export function replayStepMs(lines: number): number {
  return Math.min(600, Math.max(40, Math.floor(REPLAY_TOTAL_MS / Math.max(1, lines))));
}

type Props = {
  fight: FightRecord;
  heroName: string;
  onClose: () => void;
};

export function FightReplay({ fight, heroName, onClose }: Props) {
  const reducedMotion = useReducedMotion();
  const total = fight.log.length;
  // The replay opens empty: the first line (the hero's opening hit) shows FIGHT_VIEW_LEAD_MS after the screen opens, then one line per step.
  const [shown, setShown] = useState(reducedMotion ? total : 0);

  // One line per step; the parent remounts this component (new key) for a new replay.
  useEffect(() => {
    if (reducedMotion && shown < total) {
      setShown(total);
      return;
    }
    if (shown >= total) return;
    const id = setTimeout(() => setShown((n) => Math.min(total, n + 1)), shown === 0 ? FIGHT_VIEW_LEAD_MS : replayStepMs(total));
    return () => clearTimeout(id);
  }, [shown, total, reducedMotion]);

  // HP after the last shown strike of each side. A regenerating enemy (a boss) logs its HP after every strike (enemyHpAfter);
  // the stun left is what the shown Heavy Bash casts gave minus the hero strikes already lost.
  // A pack (Hard / Extreme): each hero strike names the mob it hit (`mob`) and that mob's HP after it; the target is the first alive mob.
  const packed = fight.mobs.length > 1;
  const mobHp = fight.mobs.map((m) => m.maxHp);
  let heroHp = fight.heroHpStart;
  let stunLeft = 0;
  for (let i = 0; i < shown; i++) {
    const e = fight.log[i];
    const at = e.mob ?? 0;
    if (e.actor === 'hero') mobHp[at] = e.targetHpAfter;
    else heroHp = e.targetHpAfter;
    if (e.enemyHpAfter !== undefined) mobHp[at] = e.enemyHpAfter;
    if (e.stunned) stunLeft = Math.max(0, stunLeft - 1);
    else if (e.stun) stunLeft = Math.max(stunLeft, e.stun);
  }
  const enemyHp = mobHp.reduce((n, h) => n + h, 0);
  const done = shown >= total;
  if (done) heroHp = fight.heroHpEnd; // a time-limit loss ends at 0 even though no strike says so (and regen shows here)
  const result = outcomeLabel(fight.endReason, fight.dungeonId);
  const size = fight.mobs.length;
  const nameOf = (e: FightLogEntry) => mobLabel(fight.enemyId, fight.mobs[e.mob ?? 0]?.variant ?? 'base', e.mob ?? 0, size);

  // Screen readers hear the result once, not every line as it appears.
  useEffect(() => {
    if (done) AccessibilityInfo.announceForAccessibility(`Replay finished: ${result}`);
  }, [done, result]);

  return (
    <View style={styles.root}>
      <View style={styles.bars}>
        <AnimatedHpBar label={heroName} value={heroHp} max={fight.heroMaxHp} color={colors.skill} instant={reducedMotion} />
        {packed ? null : <AnimatedHpBar label={mobName(fight.enemyId, fight.mobs[0]?.variant ?? 'base')} value={enemyHp} max={fight.enemyMaxHp} color={colors.hp} instant={reducedMotion} />}
      </View>
      {packed ? <PackRows enemyId={fight.enemyId} mobs={fight.mobs.map((m, i) => ({ variant: m.variant, hp: mobHp[i], maxHp: m.maxHp }))} instant={reducedMotion} /> : null}
      {!done && stunLeft > 0 ? <StunNotice name={heroName} strikes={stunLeft} /> : null}
      <View style={styles.log}>
        {fight.log.length === 0 ? <Text style={styles.line}>{heroName} had no HP left and could not fight.</Text> : null}
        {fight.log.slice(0, shown).map((e, i) => (
          <LogLine key={i} entry={e} heroName={heroName} enemyName={nameOf(e)} />
        ))}
        {done ? (
          <Text style={[styles.result, fight.won ? styles.win : styles.loss]} accessibilityLiveRegion="polite">
            {result}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        <PixelButton label={done ? 'Close replay' : 'Skip replay'} onPress={done ? onClose : () => setShown(total)} />
      </View>
    </View>
  );
}

export { AnimatedHpBar };

/** "0:07": fight time when the strike landed, whole seconds rounded down. */
export function strikeTime(atMs: number): string {
  const s = Math.max(0, Math.floor(atMs / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * "0:00.3": the fight time of a log line, with tenths of a second, read from the engine's log (`atMs`) -- so the hero's opening
 * strike reads 0:00.0 and a monster's first 0:00.3, whatever the opening is set to.
 */
export function logTime(atMs: number): string {
  const tenths = Math.max(0, Math.floor(atMs / 100));
  const s = Math.floor(tenths / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${tenths % 10}`;
}

/** "Stunned: loses the next 2 strikes", shown while a stun is on (live fight and replay). Text, not colour alone. */
export function StunNotice({ name, strikes }: { name: string; strikes: number }) {
  const text = `${name} is stunned: loses the next ${strikes === 1 ? 'strike' : `${strikes} strikes`}`;
  return (
    <Text style={styles.stunNotice} accessibilityRole="alert" accessibilityLabel={text}>
      Stunned! {text.replace(`${name} is stunned: `, '')}
    </Text>
  );
}

export const LogLine = memo(function LogLine({ entry, heroName, enemyName }: { entry: FightLogEntry; heroName: string; enemyName: string }) {
  if (entry.stunned) {
    // The hero's strike lost to a stun: no roll, no damage.
    const lost = `${logTime(entry.atMs)} · ${heroName} is stunned and loses the strike`;
    return (
      <Text style={[styles.line, styles.stunLine]} accessibilityLabel={lost}>
        {lost}
      </Text>
    );
  }
  const hero = entry.actor === 'hero';
  const attacker = hero ? heroName : enemyName;
  const target = hero ? enemyName : heroName;
  const skill = entry.skill ? COMBAT_SKILLS[entry.skill] : null;
  // The number is the total; a magic part and the raw roll are shown only when they explain it. A crit says so in words and
  // in gold (the colour never carries the meaning alone). A skill cast says its name; a stun says how many strikes it costs.
  const parts = [entry.magic > 0 ? `${entry.magic} magic` : '', entry.dealt !== entry.roll || entry.crit ? `rolled ${entry.roll}` : ''].filter(Boolean);
  const prefix = `${logTime(entry.atMs)} · ${attacker} hits ${target} for `;
  const suffix = `${parts.length > 0 ? ` (${parts.join(', ')})` : ''} → ${entry.targetHpAfter} HP`;
  const stunText = skill ? (entry.stun ? ` Stunned for ${entry.stun} strikes!` : ' No stun.') : '';
  const label = `${prefix}${entry.dealt}${entry.crit ? ', critical hit' : ''}${skill ? `, ${skill.name}` : ''}${suffix}${stunText}`;
  return (
    <Text style={[styles.line, hero ? styles.heroLine : styles.enemyLine]} accessibilityLabel={label}>
      {prefix}
      <Text style={entry.crit ? styles.critDamage : undefined}>{entry.dealt}</Text>
      {entry.crit ? <Text style={styles.critTag}> Crit!</Text> : null}
      {skill ? <Text style={styles.skillTag}> {skill.name}!</Text> : null}
      {suffix}
      {skill ? <Text style={entry.stun ? styles.skillTag : undefined}>{stunText}</Text> : null}
    </Text>
  );
});

const styles = StyleSheet.create({
  root: { gap: 10 },
  bars: { flexDirection: 'row', gap: 10 },
  log: { gap: 3, minHeight: 40 },
  line: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.ink },
  heroLine: { color: colors.ink },
  enemyLine: { color: colors.hp },
  critDamage: { fontFamily: fonts.bodyBold, color: colors.crit },
  critTag: { fontFamily: fonts.bodyBold, color: colors.crit },
  skillTag: { fontFamily: fonts.bodyBold, color: colors.crit },
  stunLine: { fontFamily: fonts.body, color: colors.inkSoft, fontStyle: 'italic' },
  stunNotice: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.hp, textAlign: 'center' },
  result: { fontFamily: fonts.title, fontSize: 20, marginTop: 4 },
  win: { color: colors.skill },
  loss: { color: colors.hp },
  actions: { alignItems: 'center' },
});
