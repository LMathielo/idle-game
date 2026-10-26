import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGameClient, useGameState } from '../client/GameProvider';
import { type VillageAction, VillageScene } from '../components/VillageScene';
import { formatNumber } from '../components/format';
import { colors, fonts } from '../theme';

const COMING_SOON: Record<Exclude<VillageAction, 'woodcutting'>, string> = {
  storage: 'Storage',
  merchant: 'Merchant',
  dungeon: 'Dungeon',
  training: 'Training',
};

const TOAST_MS = 1600;

export default function VillageScreen() {
  const client = useGameClient();
  const { character, activity } = useGameState();
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True while a start/stop is being saved; extra taps are ignored so a double tap can't toggle twice. */
  const inFlight = useRef(false);

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
      if (action !== 'woodcutting') {
        showToast(`${COMING_SOON[action]}: coming soon`);
        return;
      }
      if (inFlight.current) return;
      inFlight.current = true;
      const running = client.getState().activity?.kind === 'woodcutting';
      client
        .dispatch(running ? { type: 'STOP_ACTIVITY' } : { type: 'START_ACTIVITY', kind: 'woodcutting' })
        .then((res) => {
          if (!res.ok) showToast(res.error.message);
          else if (!res.duplicate) showToast(running ? 'Stopped woodcutting' : 'Woodcutting started');
        })
        .catch(() => showToast('Could not save. Try again.'))
        .finally(() => {
          inFlight.current = false;
        });
    },
    [client, showToast],
  );

  return (
    <View style={styles.root}>
      <VillageScene onAction={onAction} active={activity?.kind ?? null} />
      {/* Top HUD over the sky */}
      <SafeAreaView edges={['top']} style={styles.hudWrap} pointerEvents="none">
        <View style={styles.hud}>
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
