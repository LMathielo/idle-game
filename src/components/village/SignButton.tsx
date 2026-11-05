// A village sign: PixelButton's sign look (wooden board, hard bevels, Pixelify Sans Bold label, padlock when locked, green
// highlight when its activity runs) at `scale` times its natural size, for real: the map lays signs out at
// SIGN_SCALE × the settled zoom in screen space (no GPU scale), so the text is rasterised at the size it is shown. Boxes
// snap to whole device pixels and the font to whole points. Sizes mirror PixelButton's.
import { memo, useMemo } from 'react';
import { PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
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
  /** Real layout size = natural size × scale. */
  scale: number;
  /** Extra touch area around the board, in px (already × scale). */
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
            {icon ? <GameIcon name={icon} size={snap(16 * scale)} /> : null}
            <Text style={[s.label, muted && s.labelMuted]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
});

/** Rounds a size to whole device pixels: hard pixel bevels and frames stay sharp. */
export function snap(v: number): number {
  return PixelRatio.roundToNearestPixel(v);
}

function makeStyles(k: number) {
  const px = (v: number) => Math.max(1 / PixelRatio.get(), snap(v * k)); // never a hairline of 0
  return StyleSheet.create({
    outer: {
      backgroundColor: colors.woodDark,
      padding: px(3),
      shadowColor: '#000',
      shadowOffset: { width: px(3), height: px(3) },
      shadowOpacity: 0.6,
      shadowRadius: 0,
      elevation: 4 * k,
    },
    outerActive: { backgroundColor: colors.gold },
    outerPressed: { transform: [{ translateY: px(2) }], shadowOffset: { width: px(1), height: px(1) } },
    outerMuted: { shadowOpacity: 0, elevation: 0 },
    inner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: px(4), // icon to label, like PixelButton's icon row
      minHeight: px(38),
      backgroundColor: colors.wood,
      paddingHorizontal: px(10),
      paddingVertical: px(4),
      borderTopWidth: px(2),
      borderLeftWidth: px(2),
      borderTopColor: colors.woodLight,
      borderLeftColor: colors.woodLight,
      borderBottomWidth: px(2),
      borderRightWidth: px(2),
      borderBottomColor: colors.woodDark,
      borderRightColor: colors.woodDark,
    },
    innerActive: { backgroundColor: colors.skill, borderTopColor: '#7cc576', borderLeftColor: '#7cc576' },
    innerPressed: { backgroundColor: colors.woodDark },
    innerMuted: { backgroundColor: colors.slot, borderTopColor: colors.slotBorder, borderLeftColor: colors.slotBorder },
    label: {
      fontFamily: fonts.title,
      fontSize: Math.round(18 * k), // whole points: the pixel font stays crisp
      color: colors.gold,
      textShadowColor: colors.woodDark,
      textShadowOffset: { width: px(1), height: px(1) },
      textShadowRadius: 0,
    },
    labelMuted: { color: colors.parchmentDark, opacity: 0.6 },
  });
}
