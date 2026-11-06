// Pixel-art image components. Every one is decorative: hidden from screen readers (the text next to it says what it
// is), `resizeMode="contain"`, no Android fade-in. The files are shipped big (x8) so a size here only ever shrinks them;
// sizes are whole points per art pixel where it matters (a 32x32 enemy at `pixel` 1 is 32 pt, the 48x48 troll 48 pt).
import { memo, type ReactNode } from 'react';
import { Image, type ImageSourcePropType, type ImageStyle, type StyleProp, StyleSheet, Text, type TextStyle, View, type ViewStyle } from 'react-native';
import type { EnemyId, MobVariant, SkillKey, WorkerNodeId } from '../../engine';
import { ENEMY_SPRITES, ENEMY_VARIANT_SPRITES, HERO_PORTRAIT, ICONS, type IconName, itemImage, nodeImage, SKILL_ICONS } from './images';

type ImageProps = { style?: StyleProp<ImageStyle> };

/** Any registry image at a given size, decorative. */
export const PixelImage = memo(function PixelImage({ source, width, height, style }: ImageProps & { source: ImageSourcePropType; width: number; height: number }) {
  return (
    <Image
      source={source}
      style={[{ width, height }, style]}
      resizeMode="contain"
      fadeDuration={0}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      accessibilityIgnoresInvertColors
    />
  );
});

/** A common UI symbol (gold, stamina, locked…), sized to the text line next to it. 16x16 art: 16 = 1 pt per pixel. */
export function GameIcon({ name, size = 16, style }: ImageProps & { name: IconName; size?: number }) {
  return <PixelImage source={ICONS[name]} width={size} height={size} style={style} />;
}

/** A hero skill's symbol (16x16 art, like GameIcon). */
export function SkillIcon({ skill, size = 16, style }: ImageProps & { skill: SkillKey; size?: number }) {
  return <PixelImage source={SKILL_ICONS[skill]} width={size} height={size} style={style} />;
}

/** A catalog item by id (32x32 art); unknown ids show the "unknown" stone. */
export function ItemIcon({ defId, size = 32, style }: ImageProps & { defId: string; size?: number }) {
  return <PixelImage source={itemImage(defId)} width={size} height={size} style={style} />;
}

/** A tree or a rock (32x32 art). */
export function NodeIcon({ node, size = 32, style }: ImageProps & { node: WorkerNodeId; size?: number }) {
  return <PixelImage source={nodeImage(node)} width={size} height={size} style={style} />;
}

/**
 * An enemy, `pixel` points per art pixel: every enemy keeps the same pixel scale, so the 48x48 troll shows 1.5x the
 * size of a 32x32 rat. `variant` (1.25.0): a Hard / Extreme pack mob is its own creature (Giant Rat, Blight Rat ...), same size as the base.
 */
export function EnemySprite({ enemyId, pixel = 1, variant = 'base', style }: ImageProps & { enemyId: EnemyId; pixel?: number; variant?: MobVariant }) {
  // A pack variant is the creature of the engine's variant table; the enemy's own sprite for the plain mob and for an enemy without variants (the boss).
  const s = (variant !== 'base' ? ENEMY_VARIANT_SPRITES[enemyId]?.[variant] : undefined) ?? ENEMY_SPRITES[enemyId];
  return <PixelImage source={s.source} width={s.w * pixel} height={s.h * pixel} style={style} />;
}

/** The hero's portrait (48x48 art), `size` points square. */
export function HeroPortrait({ size = HERO_PORTRAIT.w, style }: ImageProps & { size?: number }) {
  return <PixelImage source={HERO_PORTRAIT.source} width={size} height={size} style={style} />;
}

/**
 * A pixel symbol followed by its text on one row (the text never carries the symbol itself): `icon` is a common UI
 * symbol at `size`, or `image` any other pixel image (ItemIcon, NodeIcon…). One element for screen readers when
 * `accessibilityLabel` is given.
 */
export function IconText({
  icon,
  image,
  size = 16,
  style,
  rowStyle,
  children,
  accessibilityLabel,
  numberOfLines,
}: {
  icon?: IconName;
  image?: ReactNode;
  size?: number;
  style?: StyleProp<TextStyle>;
  rowStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
  accessibilityLabel?: string;
  numberOfLines?: number;
}) {
  return (
    <View style={[styles.row, rowStyle]} accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel}>
      {icon ? <GameIcon name={icon} size={size} /> : image}
      <Text style={[styles.text, style]} numberOfLines={numberOfLines}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  text: { flexShrink: 1 },
});
