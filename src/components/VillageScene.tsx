import { memo, useState } from 'react';
import { Image, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { PixelButton } from './PixelButton';
import { colors } from '../theme';

const village = require('../../assets/images/village.png');

// Base pixel size of the artwork (rendered at 4x in the PNG).
const ART_W = 180;
const ART_H = 390;

export type VillageAction = 'storage' | 'merchant' | 'dungeon' | 'training' | 'woodcutting' | 'mine' | 'town_hall';

/**
 * Where the CENTRE of each sign sits on the artwork, as fractions of the image (base px / 180, base px / 390).
 * Landmarks come from tools/generate-village.py (anchors printed by the script):
 * - dungeon: just under the cave mouth (cave 150,104-119)
 * - mine: just under the mine entrance (opening 32-44, 116-129; rails to y 142)
 * - woodcutting: at the foot of the forest, by the stumps (trees x 0-70, y 150-209)
 * - merchant: over the stall's awning (stall 114-150, 204-226)
 * - town_hall: on the hall's roof, under the bell tower (hall 110-142, 231-282)
 * - storage: in front of the barn (barn 22-56, 234-277)
 * - training: on the yard's top fence (yard 108-156, 286-314)
 * Keep x within ~0.2-0.8 so the longest label still fits on a 375pt-wide screen. Checked for overlaps at 320×568,
 * 375×667, 390×844 and 430×932 (the Town Hall sign sits between Merchant and Training on the right).
 */
const SIGNS: { key: VillageAction; label: string; icon: string; x: number; y: number }[] = [
  { key: 'dungeon', label: 'Dungeon', icon: '💀', x: 0.8, y: 0.336 },
  { key: 'mine', label: 'Mine Shaft', icon: '⛏️', x: 0.25, y: 0.335 },
  { key: 'woodcutting', label: 'Woodcutting', icon: '🪓', x: 0.25, y: 0.55 },
  { key: 'merchant', label: 'Merchant', icon: '💰', x: 0.733, y: 0.49 },
  { key: 'town_hall', label: 'Town Hall', icon: '🏛️', x: 0.71, y: 0.615 },
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
  locked,
  badge,
  topReserve = 0,
  bottomReserve = 0,
}: {
  onAction?: (a: VillageAction) => void;
  /** Sign of the running activity, drawn highlighted. */
  active?: VillageAction | null;
  /** Signs of buildings not built yet: greyed with 🔒, still tappable (they open the Build sheet). */
  locked?: ReadonlySet<VillageAction>;
  /** One sign with a second line (the building being upgraded: "Upgrading 12:34"). */
  badge?: { key: VillageAction; text: string } | null;
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
            const isLocked = !!locked?.has(s.key);
            const sub = badge?.key === s.key ? badge.text : undefined;
            return (
              <View key={s.key} style={[styles.sign, { left: cx - SIGN_BOX_W / 2, top: cy - SIGN_BOX_H / 2 }]} pointerEvents="box-none">
                <PixelButton
                  sign
                  label={s.label}
                  icon={isLocked ? '🔒' : s.icon}
                  muted={isLocked}
                  active={!isLocked && active === s.key}
                  sublabel={sub}
                  onPress={() => onAction?.(s.key)}
                  accessibilityLabel={isLocked ? `${s.label}, not built` : sub ? `${s.label}, ${sub}` : s.label}
                  accessibilityHint={isLocked ? 'Shows what it needs to build' : undefined}
                />
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
