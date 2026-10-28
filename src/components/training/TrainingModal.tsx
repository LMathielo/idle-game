// Village → Training: full-screen modal. Buy training tiers with gold, then train one attribute at a time.
// Rules stay in the engine: this file reads trainingView() and dispatches UNLOCK_TRAINING_TIER /
// START_ACTIVITY {kind:'training'} / STOP_ACTIVITY / SPEEDUP_TRAINING. Locked and maxed attributes are refused by the engine too.
import { memo, useCallback, useRef } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGameClient, useGameSnapshot } from '../../client/GameProvider';
import type { CommandInput } from '../../client/types';
import { type AttributeKey, type AttributeTrainingView, TRAINING, type TrainingView, trainingView } from '../../engine';
import { colors, fonts } from '../../theme';
import { confirmCancelRun } from '../dungeon/confirmCancelRun';
import { ATTRIBUTE_NAMES, formatNumber, formatTrainingLeft } from '../format';
import { LiveBar } from '../LiveBar';
import { ModalScreen } from '../ModalScreen';
import { Panel } from '../Panel';
import { PixelButton } from '../PixelButton';
import { UpgradeEntry } from '../buildings/UpgradeEntry';

export function TrainingModal() {
  const client = useGameClient();
  const { state, clockPaused } = useGameSnapshot();
  const { character, activity, offline } = state;
  const view = trainingView(state); // cheap: 4 attributes, read-only
  const inFlight = useRef(false);

  /** One command at a time; a double tap never sends two. Engine refusals are shown, never hidden. */
  const send = useCallback(
    (cmd: CommandInput) => {
      if (inFlight.current) return;
      inFlight.current = true;
      client
        .dispatch(cmd)
        .then((res) => {
          if (!res.ok) Alert.alert('Not possible', res.error.message);
        })
        .catch(() => Alert.alert('Could not save', 'Try again.'))
        .finally(() => {
          inFlight.current = false;
        });
    },
    [client],
  );

  const onTrain = useCallback(
    (attribute: AttributeKey) => {
      const go = () => send({ type: 'START_ACTIVITY', kind: 'training', attribute });
      // One activity at a time: training would end the dungeon run in progress, so ask first.
      const a = client.getState().activity;
      if (a?.kind === 'dungeon') confirmCancelRun(`Train ${ATTRIBUTE_NAMES[attribute].short}`, go, a.phase === 'fight');
      else go();
    },
    [client, send],
  );
  const onPause = useCallback(() => send({ type: 'STOP_ACTIVITY' }), [send]);
  /** Bound to the cost on the button: the engine refuses (COST_CHANGED) rather than charge more. */
  const onSpeedup = useCallback((minutes: number, cost: number) => send({ type: 'SPEEDUP_TRAINING', minutes, maxCost: cost }), [send]);
  const onUnlock = useCallback(
    (tier: number, price: number, cap: number) =>
      Alert.alert(`Unlock Tier ${tier}?`, `Costs ${formatNumber(price)} gold. Attributes can then be trained up to level ${cap}.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: `Unlock · ${formatNumber(price)} g`, onPress: () => send({ type: 'UNLOCK_TRAINING_TIER', tier }) },
      ]),
    [send],
  );

  const otherActivity = activity && activity.kind !== 'training' ? activity.kind : null;

  return (
    <ModalScreen
      title="Training"
      closeLabel="Close training"
      headerRight={
        <Text style={styles.gold} accessibilityLabel={`${formatNumber(character.gold)} gold, stamina ${state.stamina.current} of ${state.stamina.max}`}>
          🪙 {formatNumber(character.gold)} <Text style={styles.stamina}>⚡ {state.stamina.current}</Text>
        </Text>
      }
    >
      <ScrollView contentContainerStyle={styles.content}>
        {clockPaused ? <Text style={styles.paused}>⏸ Paused: your device clock moved back. Training waits until it catches up.</Text> : null}
        <TierPanel view={view} onUnlock={onUnlock} />
        <Panel title="Attributes">
          {view.tier === 0 ? <Text style={styles.note}>Unlock Tier 1 to start training.</Text> : null}
          {view.attributes.map((a) => (
            <AttributeRow
              key={a.attribute}
              view={a}
              locked={view.tier === 0}
              nextTier={view.nextTier?.tier ?? null}
              paused={clockPaused}
              stamina={state.stamina.current}
              onTrain={onTrain}
              onPause={onPause}
              onSpeedup={onSpeedup}
            />
          ))}
          <Text style={styles.note}>
            One attribute at a time, 1 XP per minute, also while the app is closed (up to {formatNumber(offline.capMs / 3_600_000)}h). Pausing keeps
            your XP.
          </Text>
          {otherActivity === 'woodcutting' ? <Text style={styles.note}>Training stops woodcutting (your logs are kept).</Text> : null}
          {otherActivity === 'dungeon' ? <Text style={styles.note}>Training stops the dungeon: the run in progress is lost.</Text> : null}
        </Panel>
        <UpgradeEntry buildingId="training_grounds" />
      </ScrollView>
    </ModalScreen>
  );
}

// ---------- tier ----------

const TierPanel = memo(function TierPanel({ view, onUnlock }: { view: TrainingView; onUnlock: (tier: number, price: number, cap: number) => void }) {
  const next = view.nextTier;
  const title = view.tier === 0 ? 'Training locked' : `Training Tier ${view.tier} · max level ${view.cap}`;
  return (
    <Panel title={title}>
      {view.tier === 0 ? (
        <Text style={styles.note}>
          Training needs Tier 1. Each tier raises the max training level by {TRAINING.levelsPerTier}, for all four attributes.
        </Text>
      ) : null}
      {next ? (
        <View style={styles.tierBox}>
          <PixelButton
            label={`Unlock Tier ${next.tier} · ${formatNumber(next.price)} g`}
            onPress={() => onUnlock(next.tier, next.price, next.cap)}
            disabled={!next.affordable}
            accessibilityLabel={`Unlock Tier ${next.tier} for ${formatNumber(next.price)} gold, max level ${next.cap}`}
            accessibilityHint={next.affordable ? 'Asks to confirm' : `Not enough gold: ${formatNumber(next.missing)} missing`}
          />
          {!next.affordable ? <Text style={styles.missing}>Need {formatNumber(next.missing)} more gold</Text> : null}
        </View>
      ) : (
        <Text style={styles.maxTier} accessibilityRole="text">
          Max tier
        </Text>
      )}
    </Panel>
  );
});

// ---------- one attribute ----------

type RowProps = {
  view: AttributeTrainingView;
  /** Tier 0: nothing is trainable. */
  locked: boolean;
  /** Next tier to buy (null at the max tier). */
  nextTier: number | null;
  paused: boolean;
  /** Current stamina, to grey out speed-ups it can't pay. */
  stamina: number;
  onTrain: (a: AttributeKey) => void;
  onPause: () => void;
  onSpeedup: (minutes: number, cost: number) => void;
};

const AttributeRow = memo(function AttributeRow({ view, locked, nextTier, paused, stamina, onTrain, onPause, onSpeedup }: RowProps) {
  const names = ATTRIBUTE_NAMES[view.attribute];
  const value = `${names.short} ${formatNumber(view.effective)} (${formatNumber(view.base)} + ${formatNumber(view.trained)} trained)`;
  const level = `${formatNumber(view.trained)}/${formatNumber(view.cap)}`;
  const maxedText = nextTier ? `Maxed — unlock Tier ${nextTier}` : 'Maxed';
  const status = locked
    ? 'Locked — unlock Tier 1'
    : view.maxed
      ? maxedText
      : `XP ${formatNumber(view.xp)}/${formatNumber(view.xpToNext)} · ${formatTrainingLeft(view.remainingMs)} to next`;
  const train = useCallback(() => onTrain(view.attribute), [onTrain, view.attribute]);
  const canTrain = !locked && !view.maxed;

  return (
    <View style={[styles.row, view.active && styles.rowActive, (locked || view.maxed) && styles.rowDim]}>
      <View style={styles.rowTop} accessible accessibilityLabel={`${names.label} ${view.effective}: ${view.base} base plus ${view.trained} trained. ${locked ? '' : `Training level ${view.trained} of ${view.cap}. `}${status}${view.active ? '. Training now' : ''}`}>
        <Text style={styles.rowValue}>{value}</Text>
        {locked ? null : <Text style={styles.rowLevel}>{level}</Text>}
      </View>
      <LiveBar fraction={view.fraction} remainingMs={view.remainingMs} paused={paused || !view.active} color={colors.skill} style={styles.bar} />
      <View style={styles.rowBottom}>
        <Text style={[styles.status, view.maxed && styles.statusMaxed]} numberOfLines={2}>
          {status}
        </Text>
        {view.active ? (
          <PixelButton label="Pause" onPress={onPause} active accessibilityLabel={`Pause ${names.label} training`} accessibilityHint="Your XP is kept" />
        ) : (
          <PixelButton
            label="Train"
            onPress={train}
            disabled={!canTrain}
            accessibilityLabel={`Train ${names.label}`}
            accessibilityHint={locked ? 'Unlock Tier 1 first' : view.maxed ? maxedText : 'Trains this attribute; stops any other activity'}
          />
        )}
      </View>
      {view.active && !view.maxed ? <SpeedupButtons view={view} stamina={stamina} onSpeedup={onSpeedup} /> : null}
    </View>
  );
});

/** Stamina speed-up on the active row: 1 stamina per minute, never charged beyond the tier cap. */
function SpeedupButtons({ view, stamina, onSpeedup }: { view: AttributeTrainingView; stamina: number; onSpeedup: (minutes: number, cost: number) => void }) {
  const per = TRAINING.speedup.staminaPerStep;
  const options = [
    { key: '1', minutes: 1, label: '+1m', spoken: '1 minute' },
    { key: '10', minutes: 10, label: '+10m', spoken: '10 minutes' },
    { key: 'next', minutes: view.speedupToNextLevel, label: 'Next Lv', spoken: 'To the next level' },
  ].map((o) => {
    const minutes = Math.min(o.minutes, view.speedupToCap);
    return { ...o, minutes, cost: minutes * per };
  });
  return (
    <View style={styles.speedup}>
      {options.map((o) => (
        <PixelButton
          key={o.key}
          label={o.label}
          sublabel={`${o.cost}⚡`}
          stretch
          onPress={() => onSpeedup(o.minutes, o.cost)}
          disabled={o.minutes <= 0 || stamina < o.cost}
          accessibilityLabel={`Speed up training: ${o.spoken}${o.key === 'next' ? ` (${o.minutes} minutes)` : ''}, costs ${o.cost} stamina`}
          accessibilityHint={stamina < o.cost ? 'Not enough stamina' : 'Adds the training time right away'}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12, paddingBottom: 32 },
  paused: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold, marginBottom: 10 },
  gold: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.gold },
  stamina: { color: colors.stamina },
  speedup: { flexDirection: 'row', flexWrap: 'nowrap', gap: 8, marginTop: 4 },

  tierBox: { alignItems: 'center', gap: 6, marginTop: 6 },
  missing: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.dangerDeadly },
  maxTier: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.skill, textAlign: 'center' },

  row: {
    padding: 10,
    marginBottom: 10,
    gap: 6,
    backgroundColor: colors.parchment,
    borderWidth: 3,
    borderColor: colors.parchmentDark,
  },
  rowActive: { borderColor: colors.gold, backgroundColor: '#f7ecd0' },
  rowDim: { opacity: 0.7 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  rowValue: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  rowLevel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.inkSoft },
  bar: { height: 14 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  status: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  statusMaxed: { fontFamily: fonts.bodyBold, color: colors.dangerTough },

  note: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft, textAlign: 'center', marginBottom: 8 },
});
