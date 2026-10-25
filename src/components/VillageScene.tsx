import { memo, useState } from 'react';
import { Image, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { PixelButton } from './PixelButton';
import { colors } from '../theme';

const village = require('../../assets/images/village.png');

// Base pixel size of the artwork (rendered at 4x in the PNG).
const ART_W = 180;
const ART_H = 390;

export type VillageAction = 'storage' | 'merchant' | 'dungeon' | 'training' | 'woodcutting';

// Where each sign sits on the artwork, as fractions of the image (x = center, y = top of sign).
// Matches the landmarks drawn in the background.
const SIGNS: { key: VillageAction; label: string; icon: string; x: number; y: number }[] = [
  { key: 'dungeon', label: 'Dungeon', icon: '💀', x: 0.8, y: 0.312 },
  { key: 'woodcutting', label: 'Woodcutting', icon: '🪓', x: 0.27, y: 0.525 },
  { key: 'merchant', label: 'Merchant', icon: '💰', x: 0.73, y: 0.475 },
  { key: 'storage', label: 'Storage', icon: '📦', x: 0.22, y: 0.715 },
  { key: 'training', label: 'Training', icon: '⚔️', x: 0.735, y: 0.81 },
];

/**
 * Village background that covers the available area (cropping the sky first),
 * with signs pinned to the buildings regardless of screen size.
 */
export const VillageScene = memo(function VillageScene({
  onAction,
  active,
}: {
  onAction?: (a: VillageAction) => void;
  /** Sign of the running activity, drawn highlighted. */
  active?: VillageAction | null;
}) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ w: width, h: height });
  };

  // "cover" scale, anchored to the bottom so the village stays visible on short screens
  const scale = Math.max(box.w / ART_W, box.h / ART_H);
  const imgW = ART_W * scale;
  const imgH = ART_H * scale;
  const left = (box.w - imgW) / 2;
  const top = box.h - imgH;

  return (
    <View style={styles.root} onLayout={onLayout}>
      {box.w > 0 && (
        <View style={{ position: 'absolute', left, top, width: imgW, height: imgH }}>
          <Image source={village} style={StyleSheet.absoluteFill} resizeMode="stretch" />
          {SIGNS.map((s) => (
            <View
              key={s.key}
              style={[styles.sign, { left: `${s.x * 100}%`, top: `${s.y * 100}%` }]}
              pointerEvents="box-none"
            >
              <PixelButton label={s.label} icon={s.icon} active={active === s.key} onPress={() => onAction?.(s.key)} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: colors.night },
  // center the sign horizontally on its anchor point
  sign: { position: 'absolute', width: 0, alignItems: 'center', overflow: 'visible' },
});
