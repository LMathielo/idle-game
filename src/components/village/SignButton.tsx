// A village sign: PixelButton's sign look (wooden board, hard bevels, Pixelify Sans Bold label, padlock when locked, green
// highlight when its activity runs) laid out at `scale` times its natural size. The map draws signs at SIGN_LAYOUT_SCALE
// (villageMap.ts) and shrinks them with a transform, so iOS rasterises the text at that large layout size and only ever
// scales the bitmap DOWN (a sign shown at 0.5 × zoom stays crisp up to the maximum zoom). Sizes mirror PixelButton's.
import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../../theme';
import { GameIcon } from '../art/Sprites';
import type { IconName } from '../art/images';

type Props = {
  label: string;
  icon?: IconName;
  muted?: boolean;
  active?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Layout size = natural size × scale. */
  scale: number;
  /** Extra touch area around the board, in layout px (already × scale). */
  hitSlop: number;
};

export const SignButton = memo(function SignButton({ label, icon, muted, active, onPress, accessibilityLabel, accessibilityHint, scale, hitSlop }: Props) {
  const s = useMemo(() => makeStyles(scale), [scale]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: !!active }}
      hitSlop={hitSlop}
    >
      {({ pressed }) => (
        <View style={[s.outer, active && s.outerActive, pressed && s.outerPressed, muted && s.outerMuted]}>
          <View style={[s.inner, active && s.innerActive, pressed && s.innerPressed, muted && s.innerMuted]}>
            {icon ? <GameIcon name={icon} size={16 * scale} /> : null}
            <Text style={[s.label, muted && s.labelMuted]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
});

function makeStyles(k: number) {
  return StyleSheet.create({
    outer: {
      backgroundColor: colors.woodDark,
      padding: 3 * k,
      shadowColor: '#000',
      shadowOffset: { width: 3 * k, height: 3 * k },
      shadowOpacity: 0.6,
      shadowRadius: 0,
      elevation: 4,
    },
    outerActive: { backgroundColor: colors.gold },
    outerPressed: { transform: [{ translateY: 2 * k }], shadowOffset: { width: k, height: k } },
    outerMuted: { shadowOpacity: 0, elevation: 0 },
    inner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6 * k,
      minHeight: 38 * k,
      backgroundColor: colors.wood,
      paddingHorizontal: 10 * k,
      paddingVertical: 4 * k,
      borderTopWidth: 2 * k,
      borderLeftWidth: 2 * k,
      borderTopColor: colors.woodLight,
      borderLeftColor: colors.woodLight,
      borderBottomWidth: 2 * k,
      borderRightWidth: 2 * k,
      borderBottomColor: colors.woodDark,
      borderRightColor: colors.woodDark,
    },
    innerActive: { backgroundColor: colors.skill, borderTopColor: '#7cc576', borderLeftColor: '#7cc576' },
    innerPressed: { backgroundColor: colors.woodDark },
    innerMuted: { backgroundColor: colors.slot, borderTopColor: colors.slotBorder, borderLeftColor: colors.slotBorder },
    label: {
      fontFamily: fonts.title,
      fontSize: 18 * k,
      color: colors.gold,
      textShadowColor: colors.woodDark,
      textShadowOffset: { width: k, height: k },
      textShadowRadius: 0,
    },
    labelMuted: { color: colors.parchmentDark, opacity: 0.6 },
  });
}
