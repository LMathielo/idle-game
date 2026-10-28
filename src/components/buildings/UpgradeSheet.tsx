// Bottom sheet to upgrade a building: current level, this level's and the next level's bonuses, the cost (have /
// need, met / unmet), the builder time, and why it can't start (Town Hall cap, builder busy, max level). Reads
// upgradeView() / constructionView() and dispatches UPGRADE_BUILDING (bound to the level shown); the engine re-checks
// everything. While this building is being upgraded it shows the countdown, plus a debug "finish now" button.
// An RN <Modal> owned by the screen that renders it (also over a full-screen village modal). Hidden while a
// "While you were away" summary is pending.
import { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGameClient, useGameSnapshot } from '../../client/GameProvider';
import { BUILDINGS, type BuildingId, constructionView, DEV_TOOLS_ENABLED, type RequirementView, upgradeView } from '../../engine';
import { colors, fonts } from '../../theme';
import { formatCountdown, formatHoursMinutes, formatNumber, itemIcon, itemName } from '../format';
import { PixelButton } from '../PixelButton';
import { bonusLines } from './bonusText';

/** Met / unmet text on the dark sheet (same values as the Build sheet; both pass 4.5:1 on colors.sheet). */
const MET = '#7fd17a';
const UNMET = '#ff8a7a';

type Props = {
  buildingId: BuildingId | null;
  onClose: () => void;
};

function costText(r: RequirementView): { label: string; have: string; need: string } {
  if (r.kind === 'item') return { label: `${itemIcon(r.defId)} ${itemName(r.defId)}`, have: formatNumber(r.have), need: formatNumber(r.need) };
  return { label: '🪙 Gold', have: formatNumber(r.have), need: formatNumber(r.need) };
}

export function UpgradeSheet({ buildingId, onClose }: Props) {
  const client = useGameClient();
  const { state, awaySummary } = useGameSnapshot();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** One command at a time: a ref, so two taps in the same frame never send two. */
  const inFlight = useRef(false);
  const view = buildingId ? upgradeView(state, buildingId) : null;
  const job = constructionView(state);

  const close = useCallback(() => {
    setError(null);
    onClose();
  }, [onClose]);

  const run = useCallback((p: Promise<{ ok: true } | { ok: false; error: { message: string } }>) => {
    inFlight.current = true;
    setBusy(true);
    p.then((res) => setError(res.ok ? null : res.error.message))
      .catch(() => setError('Could not save. Try again.'))
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  }, []);

  const upgrade = useCallback(() => {
    if (!buildingId || !view?.nextLevel || inFlight.current) return;
    run(client.dispatch({ type: 'UPGRADE_BUILDING', buildingId, level: view.nextLevel }));
  }, [buildingId, client, run, view?.nextLevel]);

  const finishNow = useCallback(() => {
    if (inFlight.current) return;
    run(client.debug.finishConstruction());
  }, [client, run]);

  if (!view || !buildingId) return null;
  const def = BUILDINGS[buildingId];
  const now = bonusLines(view.bonuses);
  const next = view.nextBonuses ? bonusLines(view.nextBonuses) : [];
  const mine = job && job.buildingId === buildingId ? job : null;

  let blockText: string | null = null;
  if (view.block === 'max_level') blockText = `Max level (${view.maxLevel}).`;
  else if (view.block === 'town_hall') blockText = `Upgrade the Town Hall to Lv ${view.townHallNeeded} first: no building goes above it.`;
  else if (view.block === 'builder_busy' && job && !mine) blockText = `The builder is busy: ${job.name} → Lv ${job.level} (${formatCountdown(job.remainingMs)} left). One upgrade at a time.`;
  else if (view.block === 'locked') blockText = 'Build it first.';
  else if (view.block === 'not_upgradable') blockText = "Can't be upgraded yet: its next level gives nothing.";

  return (
    <Modal visible={!awaySummary} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel="Close upgrade details" />
      <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]}>
        <ScrollView bounces={false} contentContainerStyle={styles.content}>
          <View style={styles.head}>
            <View style={styles.icon}>
              <Text style={styles.iconText}>{def.icon}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.name} accessibilityRole="header">
                {def.name}
              </Text>
              <Text style={styles.status}>
                Level {view.level} / {view.maxLevel}
              </Text>
            </View>
            <Pressable onPress={close} style={styles.close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {mine ? (
            <Text style={styles.working} accessibilityLabel={`Upgrading to level ${mine.level}, ${formatCountdown(mine.remainingMs)} left`}>
              🔨 Upgrading to Lv {mine.level} · {formatCountdown(mine.remainingMs)} left
            </Text>
          ) : null}

          <Text style={styles.section}>Now (Lv {view.level})</Text>
          {now.length > 0 ? now.map((l) => <Text key={l} style={styles.bonus}>• {l}</Text>) : <Text style={styles.note}>No passive bonus.</Text>}

          {view.nextLevel && !mine ? (
            <>
              <Text style={styles.section}>Next (Lv {view.nextLevel})</Text>
              {next.length > 0 ? next.map((l) => <Text key={l} style={styles.bonusNext}>• {l}</Text>) : <Text style={styles.note}>No new passive bonus yet.</Text>}
              <Text style={styles.section}>Cost</Text>
              {view.cost.map((r, i) => {
                const t = costText(r);
                return (
                  <View key={i} style={styles.row} accessible accessibilityLabel={`${t.label}: you have ${t.have}, needs ${t.need}, ${r.met ? 'met' : 'not met'}`}>
                    <Text style={styles.label}>
                      <Text style={r.met ? styles.met : styles.unmet}>{r.met ? '✓ ' : '✗ '}</Text>
                      {t.label}
                    </Text>
                    <Text style={[styles.value, r.met ? styles.met : styles.unmet]}>
                      {t.have} / {t.need}
                    </Text>
                  </View>
                );
              })}
              <View style={styles.row}>
                <Text style={styles.label}>⏳ Builder time</Text>
                <Text style={styles.valuePlain}>{formatHoursMinutes(view.durationMs)}</Text>
              </View>
              <Text style={styles.note}>Paid up front. Upgrades go on while you play and while the app is closed; one at a time.</Text>
            </>
          ) : null}

          {blockText ? <Text style={styles.block}>{blockText}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {view.nextLevel && !mine ? (
            <View style={styles.actions}>
              <PixelButton
                label={`Upgrade to Lv ${view.nextLevel}`}
                onPress={upgrade}
                disabled={view.block !== null || busy}
                stretch
                accessibilityHint={view.block === null ? `Pays the cost and starts the builder` : 'Not possible right now'}
              />
            </View>
          ) : null}
          {mine && DEV_TOOLS_ENABLED ? (
            <View style={styles.actions}>
              <PixelButton label="Finish now (debug)" onPress={finishNow} disabled={busy} stretch accessibilityHint="Debug: finishes this upgrade at once for free" />
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { maxHeight: '85%', backgroundColor: colors.sheet, borderTopWidth: 3, borderTopColor: colors.goldDark },
  content: { padding: 16, gap: 6 },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 58, height: 58, borderWidth: 3, borderColor: colors.goldDark, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 30 },
  name: { fontFamily: fonts.title, fontSize: 22, color: colors.gold },
  status: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: fonts.bodyBold, fontSize: 24, color: colors.parchment },
  working: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.gold, marginTop: 4 },
  section: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.parchment, marginTop: 6 },
  bonus: { fontFamily: fonts.body, fontSize: 14, color: colors.parchmentDark },
  bonusNext: { fontFamily: fonts.bodyBold, fontSize: 14, color: MET },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 28, gap: 8 },
  label: { flexShrink: 1, fontFamily: fonts.body, fontSize: 15, color: colors.parchment },
  value: { fontFamily: fonts.bodyBold, fontSize: 15 },
  valuePlain: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.parchment },
  met: { color: MET },
  unmet: { color: UNMET },
  note: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark },
  block: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19, color: colors.gold, marginTop: 4 },
  error: { fontFamily: fonts.bodyBold, fontSize: 13, color: UNMET },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
});
