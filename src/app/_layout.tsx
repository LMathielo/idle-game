import { Jacquard12_400Regular } from '@expo-google-fonts/jacquard-12';
import { PixelifySans_400Regular, PixelifySans_700Bold } from '@expo-google-fonts/pixelify-sans';
import { useFonts } from 'expo-font';
import { usePathname } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { GameProvider } from '../client/GameProvider';
import { AwayModal } from '../components/AwayModal';
import { colors } from '../theme';

/** The tabs sit under every village modal, also when a modal is the first route opened. */
export const unstable_settings = { anchor: '(tabs)' };

/** Village modal routes. Each one renders its own <AwayModal /> (see RootAwayModal). */
const VILLAGE_MODAL_PATHS: readonly string[] = ['/dungeon', '/training'];

/**
 * iOS presents an RN <Modal> from the view controller that owns it. Mounted here it belongs to the
 * root controller, which cannot present a second modal while a full-screen village modal is up, so
 * the summary would never appear. While a village modal is open, that screen hosts the AwayModal.
 */
function RootAwayModal() {
  const pathname = usePathname();
  return VILLAGE_MODAL_PATHS.includes(pathname) ? null : <AwayModal />;
}

/**
 * Root stack: the tabs group, plus one full-screen modal per village sign (Dungeon and Training today).
 * fullScreenModal: iOS covers the whole screen with no swipe-to-dismiss (the modal's ✕ closes it);
 * Android has no such style and falls back to 'modal', so the slide-up is set explicitly to match
 * (a fade when the system asks to reduce motion).
 */
export default function RootLayout() {
  const [loaded] = useFonts({ Jacquard12_400Regular, PixelifySans_400Regular, PixelifySans_700Bold });
  // Reduce Motion: a fade instead of the slide-up (iOS also cross-dissolves for 'fade' on modals).
  const reducedMotion = useReducedMotion();
  if (!loaded) return <View style={styles.blank} />;

  return (
    <GameProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: styles.content }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="dungeon" options={{ presentation: 'fullScreenModal', animation: reducedMotion ? 'fade' : 'slide_from_bottom' }} />
        <Stack.Screen name="training" options={{ presentation: 'fullScreenModal', animation: reducedMotion ? 'fade' : 'slide_from_bottom' }} />
      </Stack>
      <RootAwayModal />
    </GameProvider>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: colors.night },
  content: { backgroundColor: colors.night },
});
