// Village → Training: full-screen modal. Buy training tiers with gold, then train one attribute at a time.
// Rules stay in the engine: this file reads trainingView() and dispatches UNLOCK_TRAINING_TIER /
// START_ACTIVITY {kind:'training'} / STOP_ACTIVITY / SPEEDUP_TRAINING. Locked and maxed attributes are refused by the engine too.
import { memo, useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGameSnapshot } from '../../client/GameProvider';
import { type AttributeKey, type AttributeTrainingView, buildingLevel, TRAINING, type TrainingView, trainingView } from '../../engine';
import { colors, fonts } from '../../theme';
import { confirmCancelRun } from '../dungeon/confirmCancelRun';
import { ATTRIBUTE_NAMES, formatNumber, formatTrainingLeft } from '../format';
import { LiveBar } from '../LiveBar';
import { ModalScreen } from '../ModalScreen';
import { Panel } from '../Panel';
import { PixelButton } from '../PixelButton';
import { UpgradeEntry } from '../buildings/UpgradeEntry';
import { useCommand } from '../ui/useCommand';

export function TrainingModal() {
  const { state, clockPaused } = useGameSnapshot();
  const { character, activity, offline } = state;
  const view = trainingView(state); // cheap: 4 attributes, read-only
  /** One command at a time; a double tap never sends two. Engine refusals are shown in a GameDialog. */
  const { send, dialog, client } = useCommand();

  const onTrain = useCallback(
    async (attribute: AttributeKey) => {
      // One activity at a time: training would end the dungeon run in progress, so ask first.
      const a = client.getState().activity;
      if (a?.kind === 'dungeon' && !(await confirmCancelRun(dialog, `Train ${ATTRIBUTE_NAMES[attribute].short}`, a.phase === 'fight'))) return;
      await send({ type: 'START_ACTIVITY', kind: 'training', attribute });
    },
    [client, dialog, send],
  );
  const onPause = useCallback(() => void send({ type: 'STOP_ACTIVITY' }), [send]);
  /**
   * Hold-to-repeat: bound to the cost read from the live state at each tick (never more than the button shows; the
   * engine refuses COST_CHANGED rather than charge more). A repeat tick is quiet: a refusal just stops the hold.
   */
  const onSpeedup = useCallback(
    (key: SpeedupKey, repeat: boolean) => {
      const option = speedupOptions(trainingView(client.getState())).find((o) => o.key === key);
      if (!option || option.minutes <= 0 || client.getState().stamina.current < option.cost) return Promise.resolve(false);
      return send({ type: 'SPEEDUP_TRAINING', minutes: option.minutes, maxCost: option.cost }, { quiet: repeat });
    },
    [client, send],
  );
  const onUnlock = useCallback(
    async (tier: number, price: number, cap: number) => {
      const ok = await dialog.confirm({
        title: `Unlock Tier ${tier}?`,
        message: `Costs ${formatNumber(price)} gold. Core attributes can then be trained up to level ${cap}.`,
        confirmLabel: `Unlock · ${formatNumber(price)} g`,
      });
      if (ok) await send({ type: 'UNLOCK_TRAINING_TIER', tier });
    },
    [dialog, send],
  );

  const otherActivity = activity && activity.kind !== 'training' ? activity.kind : null;

  return (
    <ModalScreen
      title="Training"
      buildingId="training_grounds"
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
        <Panel title="Core attributes">
          <Text style={styles.note}>Each training level is +1 core point. Core points also drive the special effects (DEX: faster search and gathering, INT: faster crafting, STR: gathering strength).</Text>
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
            One attribute at a time, {view.xpPerMinute} XP per minute (Training Grounds Lv {buildingLevel(state, 'training_grounds')}), also while the app
            is closed (up to {formatNumber(offline.capMs / 3_600_000)}h). Pausing keeps your XP.
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
  onSpeedup: OnSpeedup;
};

const AttributeRow = memo(function AttributeRow({ view, locked, nextTier, paused, stamina, onTrain, onPause, onSpeedup }: RowProps) {
  const names = ATTRIBUTE_NAMES[view.attribute];
  const value = `${names.short} ${formatNumber(view.total)} (${formatNumber(view.normal)} + ${formatNumber(view.core)} core)`;
  const level = `Core ${formatNumber(view.core)}/${formatNumber(view.cap)}`;
  const maxedText = nextTier ? `Maxed — unlock Tier ${nextTier}` : 'Maxed';
  const status = locked
    ? 'Locked — unlock Tier 1'
    : view.maxed
      ? maxedText
      : `XP ${formatNumber(view.xp)}/${formatNumber(view.xpToNext)} · ${view.xpPerMinute} XP/min · ${formatTrainingLeft(view.remainingMs)} to next`;
  const train = useCallback(() => onTrain(view.attribute), [onTrain, view.attribute]);
  const canTrain = !locked && !view.maxed;

  return (
    <View style={[styles.row, view.active && styles.rowActive, (locked || view.maxed) && styles.rowDim]}>
      <View style={styles.rowTop} accessible accessibilityLabel={`${names.label} ${view.total}: ${view.normal} plus ${view.core} core. ${locked ? '' : `Core level ${view.core} of ${view.cap}. `}${status}${view.active ? '. Training now' : ''}`}>
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

type SpeedupKey = '1' | '10' | 'next';
type OnSpeedup = (key: SpeedupKey, repeat: boolean) => Promise<boolean>;

/** The speed-up buttons of the attribute being trained, with what each would cost right now. */
function speedupOptions(view: TrainingView) {
  const active = view.attributes.find((a) => a.active);
  if (!active) return [];
  return attributeSpeedups(active);
}

function attributeSpeedups(view: AttributeTrainingView) {
  const per = TRAINING.speedup.staminaPerStep;
  return (
    [
      { key: '1', minutes: 1, label: '+1m', spoken: '1 minute' },
      { key: '10', minutes: 10, label: '+10m', spoken: '10 minutes' },
      { key: 'next', minutes: view.speedupToNextLevel, label: 'Next Lv', spoken: 'To the next level' },
    ] as const
  ).map((o) => {
    const minutes = Math.min(o.minutes, view.speedupToCap);
    return { ...o, key: o.key as SpeedupKey, minutes, cost: minutes * per };
  });
}

/**
 * Stamina speed-up on the active row: 1 stamina per minute (worth the current XP/min), never charged beyond the tier
 * cap. Hold to repeat (each tick reads the cost again and stops when stamina runs out or the attribute maxes).
 */
function SpeedupButtons({ view, stamina, onSpeedup }: { view: AttributeTrainingView; stamina: number; onSpeedup: OnSpeedup }) {
  return (
    <View style={styles.speedup}>
      {attributeSpeedups(view).map((o) => (
        <PixelButton
          key={o.key}
          label={o.label}
          sublabel={`${o.cost}⚡`}
          stretch
          repeat={({ repeat }) => onSpeedup(o.key, repeat)}
          disabled={o.minutes <= 0 || stamina < o.cost}
          accessibilityLabel={`Speed up training: ${o.spoken}${o.key === 'next' ? ` (${o.minutes} minutes)` : ''}, costs ${o.cost} stamina`}
          accessibilityHint={stamina < o.cost ? 'Not enough stamina' : `Adds the training time right away, ${view.xpPerMinute} XP per minute. Hold to repeat`}
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
