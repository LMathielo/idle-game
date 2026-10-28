import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameState } from '../../client/GameProvider';
import { ACTIVITY_STRIP_HEIGHT } from '../../components/ActivityStrip';
import { BuildSheet } from '../../components/buildings/BuildSheet';
import { type VillageAction, VillageScene } from '../../components/VillageScene';
import { formatCountdown, formatNumber } from '../../components/format';
import { type ActivityKind, type BuildingId, constructionView, isBuilt } from '../../engine';
import { colors, fonts } from '../../theme';

const COMING_SOON: Record<Exclude<VillageAction, 'woodcutting' | 'mine' | 'town_hall' | 'dungeon' | 'training' | 'merchant'>, string> = {
  storage: 'Storage',
};

/** Signs whose building has to be built first. Dungeon, Merchant and Storage are always built. */
const SIGN_BUILDING: Partial<Record<VillageAction, BuildingId>> = {
  woodcutting: 'woodcutting',
  mine: 'mine_shaft',
  town_hall: 'town_hall',
  training: 'training_grounds',
};

/** The sign of each building, for the "Upgrading 12:34" line. */
const BUILDING_SIGN: Record<BuildingId, VillageAction> = {
  woodcutting: 'woodcutting',
  mine_shaft: 'mine',
  town_hall: 'town_hall',
  training_grounds: 'training',
  merchant: 'merchant',
};

/** The full-screen modal each built sign opens. */
const SIGN_ROUTE: Partial<Record<VillageAction, '/dungeon' | '/training' | '/woodcutting' | '/mine' | '/merchant' | '/town-hall'>> = {
  dungeon: '/dungeon',
  training: '/training',
  woodcutting: '/woodcutting',
  mine: '/mine',
  merchant: '/merchant',
  town_hall: '/town-hall',
};

/** The sign highlighted while an activity runs. */
const ACTIVITY_SIGN: Record<ActivityKind, VillageAction> = { woodcutting: 'woodcutting', mining: 'mine', dungeon: 'dungeon', training: 'training' };

const TOAST_MS = 1600;

export default function VillageScreen() {
  const state = useGameState();
  const { character, activity } = state;
  const [toast, setToast] = useState<string | null>(null);
  /** The locked building whose Build sheet is open. */
  const [building, setBuilding] = useState<BuildingId | null>(null);
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
  const badge = useMemo(() => (badgeKey && badgeText ? { key: badgeKey, text: badgeText } : null), [badgeKey, badgeText]);
  /** Bottom edge of the top HUD (safe area included); signs are kept below it. */
  const [hudBottom, setHudBottom] = useState(0);
  const onHudLayout = useCallback((e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    setHudBottom(y + height);
  }, []);
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
    (action: VillageAction) => {
      const needs = SIGN_BUILDING[action];
      if (needs && locked.has(action)) {
        setBuilding(needs);
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
      {/* The activity strip is reserved even when hidden, so signs never move when an activity starts. */}
      <VillageScene
        onAction={onAction}
        active={activity ? ACTIVITY_SIGN[activity.kind] : null}
        locked={locked}
        badge={badge}
        topReserve={hudBottom}
        bottomReserve={ACTIVITY_STRIP_HEIGHT}
      />
      {/* Top HUD over the sky */}
      <SafeAreaView edges={['top']} style={styles.hudWrap} pointerEvents="none">
        <View style={styles.hud} onLayout={onHudLayout}>
          <Text style={styles.hudName}>
            {character.name} <Text style={styles.hudLevel}>Lv {character.level}</Text>
          </Text>
          <Text style={styles.hudGold}>🪙 {formatNumber(character.gold)}</Text>
        </View>
        {toast ? (
          <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </Animated.View>
        ) : null}
      </SafeAreaView>
      <BuildSheet buildingId={building} onClose={closeSheet} onBuilt={onBuilt} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.night },
  hudWrap: { position: 'absolute', left: 0, right: 0, top: 0 },
  hud: {
    marginHorizontal: 12,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(43, 29, 18, 0.85)',
    borderWidth: 2,
    borderColor: colors.wood,
  },
  hudName: { fontFamily: fonts.title, fontSize: 20, color: colors.parchment },
  hudLevel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold },
  hudGold: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.gold },
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
