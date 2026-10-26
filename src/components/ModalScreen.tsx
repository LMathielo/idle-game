// Shared shell for every village full-screen modal: header row (✕ + title + optional right slot),
// safe-area padding, and the screen's own "While you were away" host. Every village modal route uses it.
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '../theme';
import { AwayModal } from './AwayModal';

type Props = {
  title: string;
  /** Spoken label of the ✕ button, e.g. "Close dungeons". */
  closeLabel: string;
  /** Defaults to going back to the village. */
  onClose?: () => void;
  /** Short text on the right of the title row (e.g. stamina). Must stay compact. */
  headerRight?: ReactNode;
  /** Extra header rows under the title row (e.g. an HP bar). */
  headerBelow?: ReactNode;
  children: ReactNode;
};

/** Back to the village; also works when the modal was the first route opened (deep link / reload). */
export function closeVillageModal() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Why insets come from `useSafeAreaInsets()` and not `<SafeAreaView>`: on iOS a `fullScreenModal` is
 * presented by UIKit in its own view hierarchy, outside the root SafeAreaProvider's native view. The
 * native SafeAreaView then falls back to its own UIView insets, read when it is mounted (while the
 * modal still sits off-screen for the slide-in, so top = 0) and never refreshed afterwards. The hook
 * reads the root provider's window insets through React context, which is correct for a full-screen
 * modal on iOS and Android alike.
 */
export function ModalScreen({ title, closeLabel, onClose = closeVillageModal, headerRight, headerBelow, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top, paddingLeft: PAD + insets.left, paddingRight: PAD + insets.right }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel={closeLabel} hitSlop={8}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
            {title}
          </Text>
          {headerRight}
        </View>
        {headerBelow}
      </View>
      <View style={[styles.body, { paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>{children}</View>
      {/* This screen's own host for "While you were away" (see RootAwayModal in app/_layout.tsx). */}
      <AwayModal />
    </View>
  );
}

const PAD = 12;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.night },
  header: {
    backgroundColor: colors.woodDark,
    borderBottomWidth: 3,
    borderBottomColor: colors.goldDark,
    paddingBottom: 10,
    gap: 6,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: fonts.bodyBold, fontSize: 26, color: colors.parchment },
  title: { flex: 1, fontFamily: fonts.title, fontSize: 34, color: colors.gold },
  body: { flex: 1 },
});
