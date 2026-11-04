// Compact hero HUD (top-left, inside the top safe area) for the Village and Hero tabs: the portrait in a hard-bevel pixel
// frame with the level badge (and a "+N" badge while there are points to spend), and four thin bars: HP (red), mana
// (blue), stamina (orange) and XP (white, the level's progress as "xx.yy%"). Fixed size from hudLayout.ts, so the
// Village map can keep its signs below it. Numbers come from the engine's read-only views (hpView, manaView, staminaView).
//
// Live: the provider's 1 s tick re-renders the container, which only derives a handful of numbers; the drawing part is
// memoized on those numbers, so it redraws only when a bar's value actually changes.
import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useGameState } from '../../client/GameProvider';
import { hpView, manaView, staminaView } from '../../engine';
import { colors, fonts } from '../../theme';
import { HeroPortrait } from '../art/Sprites';
import { formatLevelPercent, formatNumber } from '../format';
import { HUD_BAR_GAP, HUD_BAR_HEIGHT, HUD_BARS_WIDTH, HUD_BORDER, HUD_GAP, HUD_HEIGHT, HUD_MARGIN_LEFT, HUD_MARGIN_TOP, HUD_PADDING, HUD_PORTRAIT, HUD_WIDTH } from './hudLayout';

type Props = {
  /** Village: opens the Hero tab. Without it the HUD is not pressable (Hero tab). */
  onPress?: () => void;
};

export function HeroHud({ onPress }: Props) {
  const { character, training, stamina } = useGameState();
  // simulate() keeps untouched slices by reference: these only recompute when the hero, training or stamina changed.
  const v = useMemo(() => {
    const state = { character, training };
    const hp = hpView(state);
    const mana = manaView(state);
    const st = staminaView({ stamina });
    return {
      name: character.name,
      level: character.level,
      unspent: character.unspentPoints,
      hp: hp.hp,
      maxHp: hp.maxHp,
      mana: mana.mana,
      maxMana: mana.maxMana,
      stamina: st.current,
      maxStamina: st.max,
      xp: character.xp,
      xpToNext: character.xpToNext,
    };
  }, [character, training, stamina]);
  return <HudView {...v} onPress={onPress} />;
}

type ViewProps = {
  name: string;
  level: number;
  unspent: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  stamina: number;
  maxStamina: number;
  xp: number;
  xpToNext: number;
  onPress?: () => void;
};

const HudView = memo(function HudView({ name, level, unspent, hp, maxHp, mana, maxMana, stamina, maxStamina, xp, xpToNext, onPress }: ViewProps) {
  const xpPct = formatLevelPercent(xp, xpToNext);
  const a11y =
    `${name}, level ${level}. HP ${hp} of ${maxHp}, mana ${mana} of ${maxMana}, stamina ${stamina} of ${maxStamina}, ` +
    `${xpPct} to the next level${unspent > 0 ? `. ${unspent} attribute points to spend` : ''}`;
  const body = (
    <View style={styles.box}>
      <View style={styles.portrait}>
        {/* Inside the 3 pt bevel: 48 pt, 1 pt per art pixel. */}
        <HeroPortrait size={HUD_PORTRAIT - 6} />
        <View style={styles.levelBadge}>
          <Text style={styles.levelText}>{level}</Text>
        </View>
        {unspent > 0 ? (
          <View style={styles.pointsBadge}>
            <Text style={styles.pointsText}>+{unspent}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.bars}>
        <HudBar value={hp} max={maxHp} color={colors.hudHp} label={`${formatNumber(hp)}/${formatNumber(maxHp)}`} />
        <HudBar value={mana} max={maxMana} color={colors.hudMana} label={`${formatNumber(mana)}/${formatNumber(maxMana)}`} />
        <HudBar value={stamina} max={maxStamina} color={colors.hudStamina} label={`${formatNumber(stamina)}/${formatNumber(maxStamina)}`} />
        <HudBar value={xp} max={xpToNext} color={colors.hudXp} label={xpPct} dark />
      </View>
    </View>
  );
  if (!onPress) {
    return (
      <View style={styles.wrap} accessible accessibilityLabel={a11y}>
        {body}
      </View>
    );
  }
  return (
    <Pressable style={styles.wrap} onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} accessibilityHint="Opens the Hero tab" hitSlop={4}>
      {({ pressed }) => <View style={pressed ? styles.pressed : undefined}>{body}</View>}
    </Pressable>
  );
});

/** One thin bar with its label inside (centred). `dark`: once the white XP fill reaches the label, the label turns dark. */
const HudBar = memo(function HudBar({ value, max, color, label, dark }: { value: number; max: number; color: string; label: string; dark?: boolean }) {
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <View style={styles.barOuter}>
      <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      <Text style={[styles.barLabel, dark && pct >= 0.5 ? styles.barLabelDark : null]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { marginTop: HUD_MARGIN_TOP, marginLeft: HUD_MARGIN_LEFT, alignSelf: 'flex-start' },
  pressed: { opacity: 0.85 },
  box: {
    width: HUD_WIDTH,
    height: HUD_HEIGHT,
    flexDirection: 'row',
    gap: HUD_GAP,
    padding: HUD_PADDING,
    backgroundColor: 'rgba(43, 29, 18, 0.88)',
    borderWidth: HUD_BORDER,
    borderColor: colors.woodDark,
  },
  // Hard pixel bevel: light top-left, dark bottom-right (no rounded corners).
  portrait: {
    width: HUD_PORTRAIT,
    height: HUD_PORTRAIT,
    backgroundColor: colors.slot,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderTopColor: colors.gold,
    borderLeftColor: colors.gold,
    borderBottomColor: colors.goldDark,
    borderRightColor: colors.goldDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelBadge: {
    position: 'absolute',
    left: -3,
    bottom: -3,
    minWidth: 20,
    paddingHorizontal: 3,
    backgroundColor: colors.woodDark,
    borderWidth: 1,
    borderColor: colors.gold,
    alignItems: 'center',
  },
  levelText: { fontFamily: fonts.title, fontSize: 13, lineHeight: 15, color: colors.gold },
  pointsBadge: {
    position: 'absolute',
    right: -3,
    top: -3,
    paddingHorizontal: 3,
    backgroundColor: colors.gold,
    borderWidth: 1,
    borderColor: colors.woodDark,
  },
  pointsText: { fontFamily: fonts.bodyBold, fontSize: 10, lineHeight: 12, color: colors.ink },
  bars: { width: HUD_BARS_WIDTH, height: HUD_PORTRAIT, gap: HUD_BAR_GAP },
  barOuter: {
    height: HUD_BAR_HEIGHT,
    backgroundColor: colors.slotBorder,
    borderWidth: 1,
    borderColor: '#000',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  // Bar labels may go below 13 (AGENTS.md): Inter, white with a hard 1 px shadow.
  barLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 9,
    lineHeight: 10,
    color: '#fff',
    textAlign: 'center',
    includeFontPadding: false,
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  barLabelDark: { color: colors.ink, textShadowColor: '#fff' },
});
