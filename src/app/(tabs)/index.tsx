import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGameState } from '../../client/GameProvider';
import { ACTIVITY_STRIP_HEIGHT } from '../../components/ActivityStrip';
import { BuildSheet } from '../../components/buildings/BuildSheet';
import { HeroHud } from '../../components/hud/HeroHud';
import { hudBottom } from '../../components/hud/hudLayout';
import { type SignBadge, type VillageAction, VillageScene } from '../../components/VillageScene';
import { formatCountdown } from '../../components/format';
import type { AnchorRect } from '../../components/ui/InfoPopover';
import { type ActivityKind, type BuildingId, constructionView, craftingSign, isBuilt } from '../../engine';
import { colors, fonts } from '../../theme';

const COMING_SOON: Record<Exclude<VillageAction, 'woodcutting' | 'mine' | 'town_hall' | 'dungeon' | 'training' | 'merchant' | 'crafting'>, string> = {
  storage: 'Storage',
};

/** Signs whose building has to be built first (every sign but the Dungeon, which is always open). */
const SIGN_BUILDING: Partial<Record<VillageAction, BuildingId>> = {
  storage: 'storage',
  merchant: 'merchant',
  woodcutting: 'woodcutting',
  mine: 'mine_shaft',
  town_hall: 'town_hall',
  training: 'training_grounds',
  crafting: 'crafting',
};

/** The sign of each building, for the "Upgrading 12:34" line. */
const BUILDING_SIGN: Record<BuildingId, VillageAction> = {
  woodcutting: 'woodcutting',
  mine_shaft: 'mine',
  town_hall: 'town_hall',
  training_grounds: 'training',
  merchant: 'merchant',
  crafting: 'crafting',
  storage: 'storage',
};

/** The full-screen modal each built sign opens. */
const SIGN_ROUTE: Partial<Record<VillageAction, '/dungeon' | '/training' | '/woodcutting' | '/mine' | '/merchant' | '/town-hall' | '/crafting'>> = {
  dungeon: '/dungeon',
  training: '/training',
  woodcutting: '/woodcutting',
  mine: '/mine',
  merchant: '/merchant',
  town_hall: '/town-hall',
  crafting: '/crafting',
};

/** The sign highlighted while an activity runs. */
const ACTIVITY_SIGN: Record<ActivityKind, VillageAction> = { woodcutting: 'woodcutting', mining: 'mine', dungeon: 'dungeon', training: 'training' };

const TOAST_MS = 1600;

export default function VillageScreen() {
  const state = useGameState();
  const { activity } = state;
  const [toast, setToast] = useState<string | null>(null);
  /** The locked building whose Build box is open, anchored on its sign. */
  const [building, setBuilding] = useState<{ id: BuildingId; anchor: AnchorRect } | null>(null);
  // Building state is read through the engine selector; `state.buildings` keeps its identity until a build.
  const buildings = state.buildings;
  const locked = useMemo(() => {
    const out = new Set<VillageAction>();
    for (const [sign, id] of Object.entries(SIGN_BUILDING) as [VillageAction, BuildingId][]) if (!isBuilt({ buildings }, id)) out.add(sign);
    return out;
  }, [buildings]);
  const job = constructionView(state);
  const badgeText = job ? `Upgrading ${formatCountdown(job.remainingMs)}` : null;
  const badgeKey = job ? BUILDING_SIGN[job.buildingId] : null;
  // The Crafting sign: "Iron Sword ready" (a finished gear piece waits for Done), "Inventory full", "Waiting for
  // materials" (every busy pipe waits), "2/2 crafting · 0:04" (busy pipes / open pipes, shortest craft left), or nothing.
  const pipes = craftingSign(state);
  const craftText = pipes
    ? pipes.readyName
      ? `${pipes.readyName} ready`
      : pipes.held
        ? 'Inventory full'
        : pipes.waiting
          ? 'Waiting for materials'
          : `${pipes.busy}/${pipes.open} crafting · ${formatCountdown(pipes.nextCraftMs)}`
    : null;
  const craftReady = !!pipes?.readyName;
  const badges = useMemo(() => {
    const out: Partial<Record<VillageAction, SignBadge>> = {};
    if (craftText) out.crafting = { icon: craftReady ? 'ready' : 'crafting', text: craftText };
    if (badgeKey && badgeText) out[badgeKey] = { icon: 'upgrade', text: badgeText }; // an upgrade wins over the crafting line
    return out;
  }, [badgeKey, badgeText, craftText, craftReady]);
  /** Bottom edge of the hero HUD (safe area included, fixed size: hudLayout.ts); the start view keeps the signs below it. */
  const insets = useSafeAreaInsets();
  const topReserve = hudBottom(insets.top);
  const openHero = useCallback(() => router.navigate('/hero'), []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(text);
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onAction = useCallback(
    (action: VillageAction, anchor: AnchorRect | null) => {
      const needs = SIGN_BUILDING[action];
      if (needs && locked.has(action)) {
        // The sign's box comes from the map camera (see VillageScene), so it is right after panning and zooming.
        if (anchor) setBuilding({ id: needs, anchor });
        return;
      }
      const route = SIGN_ROUTE[action];
      if (route) {
        router.push(route);
        return;
      }
      showToast(`${COMING_SOON[action as keyof typeof COMING_SOON]}: coming soon`);
    },
    [locked, showToast],
  );
  const closeSheet = useCallback(() => setBuilding(null), []);
  const onBuilt = useCallback(
    (name: string) => {
      setBuilding(null);
      showToast(`${name} built!`);
    },
    [showToast],
  );

  return (
    <View style={styles.root}>
      {/* The map: pan + pinch. The HUD and the activity strip stay fixed overlays above it; the start view centres the
          village between them (the strip's slot is reserved even when hidden). */}
      <VillageScene
        onAction={onAction}
        active={activity ? ACTIVITY_SIGN[activity.kind] : null}
        locked={locked}
        badges={badges}
        topReserve={topReserve}
        bottomReserve={ACTIVITY_STRIP_HEIGHT}
      />
      {/* Hero HUD over the sky, top-left: tapping it opens the Hero tab. Only the HUD takes touches. */}
      <SafeAreaView edges={['top']} style={styles.hudWrap} pointerEvents="box-none">
        <HeroHud onPress={openHero} />
        {toast ? (
          <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{toast}</Text>
          </Animated.View>
        ) : null}
      </SafeAreaView>
      <BuildSheet buildingId={building?.id ?? null} anchor={building?.anchor ?? null} onClose={closeSheet} onBuilt={onBuilt} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.night },
  hudWrap: { position: 'absolute', left: 0, right: 0, top: 0 },
  toast: {
    alignSelf: 'center',
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colors.parchment,
    borderWidth: 3,
    borderColor: colors.woodDark,
  },
  toastText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
});
