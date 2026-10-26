import { memo, useState } from 'react';
import { Image, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { PixelButton } from './PixelButton';
import { colors } from '../theme';

const village = require('../../assets/images/village.png');

// Base pixel size of the artwork (rendered at 4x in the PNG).
const ART_W = 180;
const ART_H = 390;

export type VillageAction = 'storage' | 'merchant' | 'dungeon' | 'training' | 'woodcutting';

/**
 * Where the CENTRE of each sign sits on the artwork, as fractions of the image (base px / 180, base px / 390).
 * Landmarks come from tools/generate-village.py (anchors printed by the script):
 * - dungeon: just under the cave mouth (cave 150,104-119)
 * - woodcutting: at the foot of the forest, by the stumps (trees x 0-70, y 150-209)
 * - merchant: over the stall's awning (stall 114-150, 204-226)
 * - storage: in front of the barn (barn 22-56, 234-277)
 * - training: on the yard's top fence (yard 108-156, 286-314)
 * Keep x within ~0.2-0.8 so the longest label still fits on a 375pt-wide screen.
 */
const SIGNS: { key: VillageAction; label: string; icon: string; x: number; y: number }[] = [
  { key: 'dungeon', label: 'Dungeon', icon: '💀', x: 0.8, y: 0.336 },
  { key: 'woodcutting', label: 'Woodcutting', icon: '🪓', x: 0.25, y: 0.55 },
  { key: 'merchant', label: 'Merchant', icon: '💰', x: 0.733, y: 0.49 },
  { key: 'storage', label: 'Storage', icon: '📦', x: 0.217, y: 0.74 },
  { key: 'training', label: 'Training', icon: '⚔️', x: 0.733, y: 0.705 },
];

/** Box each sign is centred in. Wider than any label so the text never wraps or gets squeezed. */
const SIGN_BOX_W = 200;
const SIGN_BOX_H = 56;
/** Gap kept between a sign and the HUD / bottom strip. */
const SIGN_GAP = 4;

/**
 * Village background that covers the available area (cropping the sky first),
 * with signs pinned to the buildings regardless of screen size.
 * `topReserve` / `bottomReserve`: screen space covered by overlays (HUD, activity strip); a sign whose
 * landmark falls under one is pushed just clear of it, so every sign stays visible and tappable.
 */
export const VillageScene = memo(function VillageScene({
  onAction,
  active,
  topReserve = 0,
  bottomReserve = 0,
}: {
  onAction?: (a: VillageAction) => void;
  /** Sign of the running activity, drawn highlighted. */
  active?: VillageAction | null;
  topReserve?: number;
  bottomReserve?: number;
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
  const minY = topReserve + SIGN_GAP + SIGN_BOX_H / 2;
  const maxY = box.h - bottomReserve - SIGN_GAP - SIGN_BOX_H / 2;

  return (
    <View style={styles.root} onLayout={onLayout}>
      {box.w > 0 && (
        <>
          <Image source={village} style={{ position: 'absolute', left, top, width: imgW, height: imgH }} resizeMode="stretch" />
          {SIGNS.map((s) => {
            const cx = left + s.x * imgW;
            const cy = Math.min(Math.max(top + s.y * imgH, minY), maxY);
            return (
              <View key={s.key} style={[styles.sign, { left: cx - SIGN_BOX_W / 2, top: cy - SIGN_BOX_H / 2 }]} pointerEvents="box-none">
                <PixelButton label={s.label} icon={s.icon} active={active === s.key} onPress={() => onAction?.(s.key)} />
              </View>
            );
          })}
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: colors.night },
  // fixed box centred on the anchor point; the button is centred inside it at its natural size
  sign: { position: 'absolute', width: SIGN_BOX_W, height: SIGN_BOX_H, alignItems: 'center', justifyContent: 'center' },
});
