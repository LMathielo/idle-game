// The difficulty skulls of a tier (1.24.0): three always-visible buttons, white skull = Normal, red = Hard, black with flaming eyes =
// Extreme. The selected one has a gold frame (and "selected" for screen readers); a locked one is greyed with a padlock, and a tap on
// it explains why (the parent shows an InfoPopover anchored on it). Display only: the engine validates SET_DUNGEON_DIFFICULTY.
import { memo, useCallback, useRef } from 'react';
import { type HostInstance, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Difficulty, DifficultyView } from '../../engine';
import { colors, fonts } from '../../theme';
import { GameIcon } from '../art/Sprites';
import type { IconName } from '../art/images';

const SKULL: Record<Difficulty, IconName> = { normal: 'skull_normal', hard: 'skull_hard', extreme: 'skull_extreme' };

const Skull = memo(function Skull({
  view,
  onSelect,
  onExplain,
}: {
  view: DifficultyView;
  onSelect: (difficulty: Difficulty) => void;
  onExplain: (difficulty: Difficulty, node: HostInstance | null) => void;
}) {
  const ref = useRef<HostInstance>(null);
  const { difficulty, name, unlocked, selected, lockReason } = view;
  const press = useCallback(() => (unlocked ? onSelect(difficulty) : onExplain(difficulty, ref.current)), [unlocked, onSelect, onExplain, difficulty]);
  return (
    <Pressable
      ref={ref}
      onPress={press}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: false }}
      accessibilityLabel={unlocked ? `${name} difficulty${selected ? ', selected' : ''}` : `${name} difficulty, locked. ${lockReason ?? ''}`}
      accessibilityHint={unlocked ? (selected ? undefined : `Plays this tier on ${name}`) : 'Shows what unlocks it'}
      style={styles.flex}
    >
      {({ pressed }) => (
        <View style={[styles.skull, !unlocked && styles.skullLocked, selected && styles.skullSelected, pressed && styles.skullPressed]}>
          <View>
            <GameIcon name={SKULL[difficulty]} size={32} style={!unlocked ? styles.dim : undefined} />
            {!unlocked ? <GameIcon name="locked" size={16} style={styles.lock} /> : null}
          </View>
          <Text style={[styles.label, !unlocked && styles.labelLocked]}>
            {selected ? '✓ ' : ''}
            {name}
          </Text>
        </View>
      )}
    </Pressable>
  );
});

export function DifficultySelector({
  views,
  onSelect,
  onExplain,
}: {
  views: readonly DifficultyView[];
  onSelect: (difficulty: Difficulty) => void;
  onExplain: (difficulty: Difficulty, node: HostInstance | null) => void;
}) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Difficulty">
      {views.map((v) => (
        <Skull key={v.difficulty} view={v} onSelect={onSelect} onExplain={onExplain} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  skull: {
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 6,
    backgroundColor: colors.parchment,
    borderWidth: 3,
    borderColor: colors.woodDark,
  },
  skullSelected: { borderColor: colors.goldDark, backgroundColor: colors.gold },
  skullLocked: { backgroundColor: colors.parchmentDark, borderColor: colors.inkSoft },
  skullPressed: { opacity: 0.8 },
  dim: { opacity: 0.35 },
  lock: { position: 'absolute', right: -4, bottom: -4 },
  label: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
  labelLocked: { color: colors.inkSoft },
});
