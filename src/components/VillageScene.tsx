// The village map: the artwork (bigger than the screen) can be dragged in any direction and
// pinch-zoomed (about the fingers' midpoint), clamped so it always covers the screen (no empty bars), from about the
// whole width up to 2.5× the starting zoom. It starts centred on the core village. Signs keep their on-screen size while
// zooming; their positions follow the map. A drag starting on a sign pans; a tap on a sign still opens it (the pan only
// activates after the finger moves, and then cancels the press).
//
// Gestures and the camera live on the UI thread (Reanimated shared values + Gesture Handler v3 hooks); React only
// re-renders when the game state changes. The HUD and the activity strip are overlays drawn by the screens above this.
//
// The artwork is the background (no buildings) plus one sprite per building, drawn back to front in the layout's order
// at their world px box inside the same transformed view, so they pan and zoom with it. A building that is not built yet
// is not drawn (its road ends on empty ground); its sign stays, greyed with the locked icon. Decor cottages always show.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { type HostInstance, Image, type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import type { AnchorRect } from './ui/InfoPopover';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures } from 'react-native-gesture-handler';
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withDecay } from 'react-native-reanimated';
import { colors, fonts } from '../theme';
import { GameIcon } from './art/Sprites';
import { type IconName, VILLAGE_BACKGROUND, VILLAGE_PIECES, type VillagePieceId } from './art/images';
import { PixelButton } from './PixelButton';
import { clampCamera, mapLimits, PIECES, SIGNS, type VillageAction, WORLD } from './village/villageMap';

export type { VillageAction } from './village/villageMap';

/** A timer pill under a sign: its symbol and text ("Upgrading 12:34", "2/2 crafting · 0:42"). */
export type SignBadge = { icon: IconName; text: string };

/** Each piece's box on the map, world px (1 pt per world px inside the transformed map view). */
const pieceStyles = StyleSheet.create(
  Object.fromEntries(PIECES.map((p) => [p.id, { position: 'absolute', left: p.x, top: p.y, width: p.w, height: p.h }] as const)),
);

/** Box each sign is centred in. Wider than any label so the text never wraps or gets squeezed. */
const SIGN_BOX_W = 200;
const SIGN_BOX_H = 56;
/** The sign button itself: 38pt inner + 3pt frame each side (PixelButton), centred in the box. */
const SIGN_BUTTON_H = 44;
/** Timer pill under a sign (the building being upgraded). */
const BADGE_H = 20;
const BADGE_GAP = 2;
/** The finger must move this far before a drag starts, so a tap on a sign stays a tap. */
const PAN_MIN_DISTANCE = 10;

type Props = {
  /**
   * A sign was tapped. `anchor` is its button's box on screen (window coordinates), computed from the camera, not
   * measured: measureInWindow on a Reanimated-transformed view can return the pre-pan position under Fabric.
   */
  onAction?: (a: VillageAction, anchor: AnchorRect | null) => void;
  /** Sign of the running activity, drawn highlighted. */
  active?: VillageAction | null;
  /**
   * Signs of buildings not built yet: their building is not drawn; the sign is greyed with the locked icon and stays
   * tappable (it opens the Build box).
   */
  locked?: ReadonlySet<VillageAction>;
  /** Timer pills under signs, each with its own symbol (upgrade: "Upgrading 12:34", crafting: "2/2 crafting · 0:42"). */
  badges?: Partial<Record<VillageAction, SignBadge>>;
  /** Screen space covered by overlays (HUD, activity strip): the start view centres the core between them. */
  topReserve?: number;
  bottomReserve?: number;
};

export const VillageScene = memo(function VillageScene({ onAction, active, locked, badges, topReserve = 0, bottomReserve = 0 }: Props) {
  const zoom = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const viewW = useSharedValue(0);
  const viewH = useSharedValue(0);
  const minZoom = useSharedValue(1);
  const maxZoom = useSharedValue(1);
  /** True once the player panned or zoomed: later layout changes then keep their view. */
  const moved = useSharedValue(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setSize((cur) => (cur && cur.w === width && cur.h === height ? cur : { w: width, h: height }));
  }, []);

  // Set up (or re-centre) the camera for this size and these overlays. The HUD reserve is fixed (hudLayout.ts) but the
  // safe-area inset can arrive after the first layout, so this runs again then; once the player has moved the map, only
  // the limits change and the view is clamped.
  useEffect(() => {
    if (!size) return;
    const lim = mapLimits(size, topReserve, bottomReserve);
    viewW.set(size.w);
    viewH.set(size.h);
    minZoom.set(lim.minZoom);
    maxZoom.set(lim.maxZoom);
    const c = moved.get() ? clampCamera({ zoom: Math.min(lim.maxZoom, Math.max(lim.minZoom, zoom.get())), tx: tx.get(), ty: ty.get() }, size) : lim.camera;
    zoom.set(c.zoom);
    tx.set(c.tx);
    ty.set(c.ty);
  }, [size, topReserve, bottomReserve, viewW, viewH, minZoom, maxZoom, moved, zoom, tx, ty]);
  const ready = !!size;
  /** The scene root's window position (it is never transformed, so measuring it is reliable). */
  const rootRef = useRef<HostInstance>(null);
  const rootOrigin = useRef({ x: 0, y: 0 });
  const measureRoot = useCallback(() => {
    rootRef.current?.measureInWindow((x, y) => {
      rootOrigin.current = { x, y };
    });
  }, []);
  /** A sign's button box on screen from the camera: root origin + camera position of its anchor, constant size. */
  const anchorOf = useCallback(
    (sign: (typeof SIGNS)[number], button: { w: number; h: number }): AnchorRect => ({
      x: rootOrigin.current.x + tx.get() + sign.x * zoom.get() - button.w / 2,
      y: rootOrigin.current.y + ty.get() + sign.y * zoom.get() - button.h / 2,
      width: button.w,
      height: button.h,
    }),
    [tx, ty, zoom],
  );

  const pan = usePanGesture({
    minDistance: PAN_MIN_DISTANCE,
    maxPointers: 2,
    onActivate: () => {
      moved.set(true);
      cancelDecay(tx, ty);
    },
    onUpdate: (e) => {
      const c = clampCamera({ zoom: zoom.get(), tx: tx.get() + e.changeX, ty: ty.get() + e.changeY }, { w: viewW.get(), h: viewH.get() });
      tx.set(c.tx);
      ty.set(c.ty);
    },
    onDeactivate: (e) => {
      // A flick glides on and stops at the map's edge.
      const z = zoom.get();
      tx.set(withDecay({ velocity: e.velocityX, clamp: [viewW.get() - WORLD.w * z, 0] }));
      ty.set(withDecay({ velocity: e.velocityY, clamp: [viewH.get() - WORLD.h * z, 0] }));
    },
  });

  const pinch = usePinchGesture({
    onActivate: () => {
      moved.set(true);
      cancelDecay(tx, ty);
    },
    onUpdate: (e) => {
      const z0 = zoom.get();
      const z1 = Math.min(maxZoom.get(), Math.max(minZoom.get(), z0 * e.scaleChange));
      // Zoom about the fingers' midpoint: the world point under it stays under it.
      const k = z1 / z0;
      const c = clampCamera(
        { zoom: z1, tx: e.focalX - (e.focalX - tx.get()) * k, ty: e.focalY - (e.focalY - ty.get()) * k },
        { w: viewW.get(), h: viewH.get() },
      );
      zoom.set(c.zoom);
      tx.set(c.tx);
      ty.set(c.ty);
    },
  });

  const gesture = useSimultaneousGestures(pan, pinch);

  // Transform only (no layout per frame): the map is laid out at 1 pt per base px and scaled from its top-left corner,
  // so world point p lands at (tx + p.x × zoom, ty + p.y × zoom), the same formula the signs use.
  const mapStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: zoom.get() }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        ref={rootRef}
        style={styles.root}
        onLayout={(e) => {
          onLayout(e);
          measureRoot();
        }}
        accessible={false}
      >
        {ready ? (
          <>
            <Animated.View style={[styles.map, mapStyle]} pointerEvents="none">
              <MapArt locked={locked} />
            </Animated.View>
            {SIGNS.map((s) => (
              <Sign
                key={s.key}
                sign={s}
                zoom={zoom}
                tx={tx}
                ty={ty}
                locked={!!locked?.has(s.key)}
                active={active === s.key}
                badge={badges?.[s.key]}
                onAction={onAction}
                anchorOf={anchorOf}
                onPressStart={measureRoot}
              />
            ))}
          </>
        ) : null}
      </View>
    </GestureDetector>
  );
});

/** Background, then every building piece back to front; a building not built yet is left out. */
const MapArt = memo(function MapArt({ locked }: { locked?: ReadonlySet<VillageAction> }) {
  return (
    <>
      <Image source={VILLAGE_BACKGROUND} style={styles.image} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors />
      {PIECES.map((p) => {
        const source = VILLAGE_PIECES[p.id as VillagePieceId];
        if (!source || (p.sign && locked?.has(p.sign))) return null;
        return <Image key={p.id} source={source} style={pieceStyles[p.id]} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors />;
      })}
    </>
  );
});

/** Stops a running flick (withDecay) so a new touch takes over at once. */
function cancelDecay(tx: SharedValue<number>, ty: SharedValue<number>) {
  'worklet';
  tx.set(tx.get());
  ty.set(ty.get());
}

type SignProps = {
  sign: (typeof SIGNS)[number];
  zoom: SharedValue<number>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  locked: boolean;
  active: boolean;
  badge?: SignBadge;
  onAction?: (a: VillageAction, anchor: AnchorRect | null) => void;
  anchorOf: (sign: (typeof SIGNS)[number], button: { w: number; h: number }) => AnchorRect;
  /** Re-measures the scene root before a tap is handled (it can move, e.g. a tab bar change). */
  onPressStart: () => void;
};

/** One sign: a constant-size button whose box follows its anchor on the map. */
const Sign = memo(function Sign({ sign, zoom, tx, ty, locked, active, badge, onAction, anchorOf, onPressStart }: SignProps) {
  /** The button's own size (layout, untransformed; it never changes with zoom). */
  const button = useRef({ w: 0, h: SIGN_BUTTON_H });
  const onButtonLayout = useCallback((e: LayoutChangeEvent) => {
    button.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
  }, []);
  const press = useCallback(() => {
    onPressStart();
    onAction?.(sign.key, anchorOf(sign, button.current));
  }, [onAction, onPressStart, anchorOf, sign]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() + sign.x * zoom.get() - SIGN_BOX_W / 2 }, { translateY: ty.get() + sign.y * zoom.get() - SIGN_BOX_H / 2 }],
  }));
  return (
    <Animated.View style={[styles.sign, style]} pointerEvents="box-none">
      <View onLayout={onButtonLayout}>
        <PixelButton
          sign
          label={sign.label}
          icon={locked ? 'locked' : undefined}
          muted={locked}
          active={!locked && active}
          onPress={press}
          accessibilityLabel={locked ? `${sign.label}, not built` : badge ? `${sign.label}, ${badge.text}` : sign.label}
          accessibilityHint={locked ? 'Shows what it needs to build' : undefined}
        />
      </View>
      {badge ? (
        <View style={styles.badge} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no">
          <GameIcon name={badge.icon} size={14} />
          <Text style={styles.badgeText} numberOfLines={1}>
            {badge.text}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: colors.night },
  map: { position: 'absolute', left: 0, top: 0, width: WORLD.w, height: WORLD.h, transformOrigin: 'left top' },
  image: { width: '100%', height: '100%' },
  // fixed box centred on the anchor point; the button is centred inside it at its natural size
  sign: { position: 'absolute', left: 0, top: 0, width: SIGN_BOX_W, height: SIGN_BOX_H, alignItems: 'center', justifyContent: 'center' },
  // Pinned just under the centred button; it may hang below the box.
  badge: {
    position: 'absolute',
    alignSelf: 'center',
    top: SIGN_BOX_H / 2 + SIGN_BUTTON_H / 2 + BADGE_GAP,
    height: BADGE_H,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.woodDark,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 13, lineHeight: 16, color: colors.gold },
});
