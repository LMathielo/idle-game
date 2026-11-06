// The mobs of a pack fight as compact rows (1.24.0): a small sprite (Veteran / Extreme mobs with their coloured outline), the name with
// its variant and number, and an HP bar. The mob the hero strikes next is marked (gold frame and a leading ›, never colour alone);
// dead mobs are greyed and say "down". Two columns (pack order runs down the left column, then the right), so ten mobs fit a 375x667
// screen without scrolling the HP area. Display only: the engine decides who is hit and who dies.
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { EnemyId, MobVariant } from '../../engine';
import { colors, fonts } from '../../theme';
import { EnemySprite } from '../art/Sprites';
import { AnimatedHpBar } from './HpBars';
import { mobLabel } from './outcome';

export type PackRowMob = { variant: MobVariant; hp: number; maxHp: number };

/** Art pixels per point in a row: a 32x32 enemy is 24 pt, the 48x48 troll 36 pt (the outline variants are 4 art px larger). */
const ROW_PIXEL = 0.75;
const SPRITE_BOX = 40;

const MobRow = memo(function MobRow({ enemyId, label, mob, target, instant }: { enemyId: EnemyId; label: string; mob: PackRowMob; target: boolean; instant: boolean }) {
  const alive = mob.hp > 0;
  return (
    <View
      style={[styles.row, target && styles.rowTarget, !alive && styles.rowDown]}
      accessible
      accessibilityLabel={`${label}, HP ${mob.hp} of ${mob.maxHp}${target ? ', the hero is striking it' : ''}${alive ? '' : ', down'}`}
    >
      <View style={styles.sprite}>
        <EnemySprite enemyId={enemyId} pixel={ROW_PIXEL} variant={mob.variant} style={!alive ? styles.spriteDown : undefined} />
      </View>
      <View style={styles.info}>
        <Text style={[styles.name, target && styles.nameTarget]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {target ? '› ' : ''}
          {label}
          {alive ? '' : ' (down)'}
        </Text>
        <AnimatedHpBar label={label} value={mob.hp} max={mob.maxHp} color={colors.hp} instant={instant} compact />
      </View>
    </View>
  );
});

export const PackRows = memo(function PackRows({ enemyId, enemyName, mobs, instant }: { enemyId: EnemyId; enemyName: string; mobs: readonly PackRowMob[]; instant: boolean }) {
  const target = mobs.findIndex((m) => m.hp > 0);
  const split = Math.ceil(mobs.length / 2);
  const column = (from: number, to: number) => (
    <View style={styles.column}>
      {mobs.slice(from, to).map((m, k) => (
        <MobRow key={from + k} enemyId={enemyId} label={mobLabel(enemyName, m.variant, from + k, mobs.length)} mob={m} target={from + k === target} instant={instant} />
      ))}
    </View>
  );
  return (
    <View style={styles.grid}>
      {column(0, split)}
      {mobs.length > 1 ? column(split, mobs.length) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: 6 },
  column: { flex: 1, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 2, backgroundColor: colors.parchmentDark, borderWidth: 2, borderColor: colors.woodDark },
  rowTarget: { borderColor: colors.goldDark, backgroundColor: colors.gold },
  rowDown: { opacity: 0.45 },
  sprite: { width: SPRITE_BOX, height: SPRITE_BOX, alignItems: 'center', justifyContent: 'center' },
  spriteDown: { opacity: 0.6 },
  info: { flex: 1, gap: 1 },
  name: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink },
  nameTarget: { color: colors.ink },
});
