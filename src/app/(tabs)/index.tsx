import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameState } from '../../client/GameProvider';
import { ACTIVITY_STRIP_HEIGHT } from '../../components/ActivityStrip';
import { type VillageAction, VillageScene } from '../../components/VillageScene';
import { formatNumber } from '../../components/format';
import { colors, fonts } from '../../theme';

const COMING_SOON: Record<Exclude<VillageAction, 'woodcutting' | 'dungeon' | 'training'>, string> = {
  storage: 'Storage',
  merchant: 'Merchant',
};

const TOAST_MS = 1600;

export default function VillageScreen() {
  const { character, activity } = useGameState();
  const [toast, setToast] = useState<string | null>(null);
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
      if (action === 'dungeon') {
        router.push('/dungeon');
        return;
      }
      if (action === 'training') {
        router.push('/training');
        return;
      }
      if (action === 'woodcutting') {
        router.push('/woodcutting');
        return;
      }
      showToast(`${COMING_SOON[action]}: coming soon`);
    },
    [showToast],
  );

  return (
    <View style={styles.root}>
      {/* The activity strip is reserved even when hidden, so signs never move when an activity starts. */}
      <VillageScene onAction={onAction} active={activity?.kind ?? null} topReserve={hudBottom} bottomReserve={ACTIVITY_STRIP_HEIGHT} />
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
  hudName: { fontFamily: fonts.title, fontSize: 24, color: colors.parchment },
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
