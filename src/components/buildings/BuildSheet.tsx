// Bottom sheet for a locked village building: what it is, each requirement with have / need and met / unmet, and a
// Build button enabled only when everything is met. Reads buildingView() through the game state and dispatches
// BUILD; the engine re-checks every requirement (REQUIREMENTS_NOT_MET / ALREADY_BUILT change nothing).
// An RN <Modal> owned by the Village screen. Hidden while a "While you were away" summary is pending.
import { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGameClient, useGameSnapshot } from '../../client/GameProvider';
import { BUILDINGS, type BuildingId, buildingView, type RequirementView } from '../../engine';
import { DEV_TOOLS_ENABLED } from '../../engine/config/dev';
import { colors, fonts } from '../../theme';
import { formatNumber, itemIcon, itemName } from '../format';
import { PixelButton } from '../PixelButton';

/** Met / unmet text on the dark sheet (same values as the item sheet's deltas; both pass 4.5:1 on colors.sheet). */
const MET = '#7fd17a';
const UNMET = '#ff8a7a';

type Props = {
  buildingId: BuildingId | null;
  onClose: () => void;
  /** Called after a successful build, with the building's name. */
  onBuilt: (name: string) => void;
};

function requirementText(r: RequirementView): { label: string; have: string; need: string } {
  switch (r.kind) {
    case 'heroLevel':
      return { label: '⭐ Hero level', have: formatNumber(r.have), need: formatNumber(r.need) };
    case 'building':
      return { label: `${BUILDINGS[r.buildingId].icon} ${BUILDINGS[r.buildingId].name}`, have: r.have > 0 ? 'built' : 'not built', need: 'built' };
    case 'item':
      return { label: `${itemIcon(r.defId)} ${itemName(r.defId)}`, have: formatNumber(r.have), need: formatNumber(r.need) };
    case 'gold':
      return { label: '🪙 Gold', have: formatNumber(r.have), need: formatNumber(r.need) };
  }
}

export function BuildSheet({ buildingId, onClose, onBuilt }: Props) {
  const client = useGameClient();
  const { state, awaySummary } = useGameSnapshot();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  /** Styling only (greys the buttons while a build is in flight). */
  const [busy, setBusy] = useState(false);
  /** One command at a time: a ref, so two taps in the same frame never send two (state updates land too late). */
  const inFlight = useRef(false);
  const view = buildingId ? buildingView(state, buildingId) : null;

  const close = useCallback(() => {
    setError(null);
    onClose();
  }, [onClose]);

  const send = useCallback(
    (debug: boolean) => {
      if (!buildingId || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      const name = BUILDINGS[buildingId].name;
      const run = debug ? client.debug.build(buildingId) : client.dispatch({ type: 'BUILD', buildingId });
      run
        .then((res) => {
          if (res.ok) {
            setError(null);
            onBuilt(name);
          } else {
            setError(res.error.message);
          }
        })
        .catch(() => setError('Could not save. Try again.'))
        .finally(() => {
          inFlight.current = false;
          setBusy(false);
        });
    },
    [buildingId, client, onBuilt],
  );

  return (
    <Modal visible={!!view && !awaySummary} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel="Close build details" />
      {view ? (
        <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]}>
          <ScrollView bounces={false} contentContainerStyle={styles.content}>
            <View style={styles.head}>
              <View style={styles.icon}>
                <Text style={styles.iconText}>{view.icon}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.name} accessibilityRole="header">
                  {view.name}
                </Text>
                <Text style={styles.status}>🔒 Not built yet</Text>
              </View>
              <Pressable onPress={close} style={styles.close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.description}>{view.description}</Text>

            <Text style={styles.section}>Needs</Text>
            {view.requirements.map((r, i) => {
              const t = requirementText(r);
              return (
                <View
                  key={i}
                  style={styles.row}
                  accessible
                  accessibilityLabel={`${t.label}: you have ${t.have}, needs ${t.need}, ${r.met ? 'met' : 'not met'}`}
                >
                  <Text style={styles.label}>
                    <Text style={r.met ? styles.met : styles.unmet}>{r.met ? '✓ ' : '✗ '}</Text>
                    {t.label}
                  </Text>
                  <Text style={[styles.value, r.met ? styles.met : styles.unmet]}>{r.kind === 'building' ? t.have : `${t.have} / ${t.need}`}</Text>
                </View>
              );
            })}
            {view.requirements.some((r) => r.kind === 'item' || r.kind === 'gold') ? <Text style={styles.note}>Gold and materials are used up when you build.</Text> : null}
            {view.grantsTrainingTier ? <Text style={styles.note}>Comes with Training Tier {view.grantsTrainingTier}.</Text> : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <PixelButton
                label="Build"
                onPress={() => send(false)}
                disabled={!view.canBuild || busy}
                stretch
                accessibilityHint={view.canBuild ? `Builds the ${view.name} now` : 'Not every requirement is met'}
              />
            </View>
            {DEV_TOOLS_ENABLED ? (
              <View style={styles.actions}>
                <PixelButton label="Build free (debug)" onPress={() => send(true)} disabled={busy} stretch accessibilityHint="Debug: builds it without the requirements" />
              </View>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { maxHeight: '80%', backgroundColor: colors.sheet, borderTopWidth: 3, borderTopColor: colors.goldDark },
  content: { padding: 16, gap: 8 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 58, height: 58, borderWidth: 3, borderColor: colors.goldDark, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 30 },
  name: { fontFamily: fonts.title, fontSize: 22, color: colors.gold },
  status: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: fonts.bodyBold, fontSize: 24, color: colors.parchment },
  description: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.parchmentDark },
  section: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.parchment, marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 28, gap: 8 },
  label: { flexShrink: 1, fontFamily: fonts.body, fontSize: 15, color: colors.parchment },
  value: { fontFamily: fonts.bodyBold, fontSize: 15 },
  met: { color: MET },
  unmet: { color: UNMET },
  note: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark },
  error: { fontFamily: fonts.bodyBold, fontSize: 13, color: UNMET },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
});
