// The Potion Belt button: a pixel flask and the potions in the belt. Shown only while the belt is worn; dimmed (still tappable)
// when every filled slot's potion group is on cooldown or the belt is empty. Taps open the belt panel (BeltPanel), which the host
// screen mounts: the Village floats the button over the map (`PotionBeltFloating`), the Dungeon modal keeps it in a footer row under
// its scrolling content (`PotionBeltFooter`, so it can never cover a button there).
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useGameState } from '../../client/GameProvider';
import { beltView } from '../../engine';
import { colors, fonts } from '../../theme';
import { GameIcon } from '../art/Sprites';
import { formatQty } from '../format';
import { BELT_BUTTON_MARGIN, BELT_BUTTON_SIZE } from './beltLayout';

type Props = { onPress: () => void };

/** The square button itself (null while the belt is not worn). */
export const PotionBeltButton = memo(function PotionBeltButton({ onPress }: Props) {
  const view = beltView(useGameState());
  if (!view.equipped) return null;
  const label = `Potion belt, ${view.total} ${view.total === 1 ? 'potion' : 'potions'}${view.total === 0 ? ', empty' : view.dimmed ? ', all on cooldown' : ''}`;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Opens the potion belt" hitSlop={6}>
      {({ pressed }) => (
        <View style={[styles.outer, pressed && styles.outerPressed, view.dimmed && styles.dimmed]}>
          <View style={[styles.inner, pressed && styles.innerPressed]}>
            <GameIcon name="potion" size={32} />
            <Text style={styles.count} numberOfLines={1}>
              {formatQty(view.total)}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
});

/** Village: the button floats at the bottom right of the screen, above the activity strip (`stripHeight`). */
export function PotionBeltFloating({ onPress, stripHeight }: Props & { stripHeight: number }) {
  return (
    <View style={[styles.floating, { bottom: stripHeight + BELT_BUTTON_MARGIN }]} pointerEvents="box-none">
      <PotionBeltButton onPress={onPress} />
    </View>
  );
}

/** Dungeon modal: a footer row under the scrolling content, the button at the right. Takes no room while the belt is not worn. */
export function PotionBeltFooter({ onPress }: Props) {
  const worn = beltView(useGameState()).equipped;
  if (!worn) return null;
  return (
    <View style={styles.footer}>
      <PotionBeltButton onPress={onPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  floating: { position: 'absolute', right: BELT_BUTTON_MARGIN },
  footer: { alignItems: 'flex-end', paddingHorizontal: BELT_BUTTON_MARGIN + 4, paddingVertical: BELT_BUTTON_MARGIN },
  outer: {
    width: BELT_BUTTON_SIZE,
    height: BELT_BUTTON_SIZE,
    backgroundColor: colors.woodDark,
    padding: 3,
    shadowColor: '#000',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.6,
    shadowRadius: 0,
    elevation: 4,
  },
  outerPressed: { transform: [{ translateY: 2 }], shadowOffset: { width: 1, height: 1 } },
  dimmed: { opacity: 0.5 },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.wood,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderTopColor: colors.woodLight,
    borderLeftColor: colors.woodLight,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomColor: colors.woodDark,
    borderRightColor: colors.woodDark,
  },
  innerPressed: { backgroundColor: colors.woodDark },
  count: {
    position: 'absolute',
    right: 2,
    bottom: 0,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: '#fff',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
});
