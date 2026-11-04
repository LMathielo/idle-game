// Village → Town Hall (once built): full-screen modal. Its level and next upgrade, then the workers: hire (cost),
// assign each one to a tree or rock (picker with tier, upkeep / min and expected items / min), unassign, dismiss;
// the total upkeep per minute and a warning while the crews are paused for gold. Rules stay in the engine: this
// reads workersView() / nodeChoices() and dispatches HIRE_WORKER / ASSIGN_WORKER / UNASSIGN_WORKER / DISMISS_WORKER.
import { memo, useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGameSnapshot } from '../../client/GameProvider';
import type { CommandInput } from '../../client/types';
import { BUILDINGS, buildingLevel, type CrewView, type NodeChoice, nodeChoices, upgradeView, type WorkerNodeId, workersView, type WorkerView } from '../../engine';
import { colors, fonts } from '../../theme';
import { GameIcon, IconText, ItemIcon, NodeIcon } from '../art/Sprites';
import { formatNumber, formatPerMin, itemName } from '../format';
import { ModalScreen } from '../ModalScreen';
import { PixelButton } from '../PixelButton';
import { useDialogShowing } from '../ui/GameDialog';
import { useCommand } from '../ui/useCommand';
import { bonusLines } from './bonusText';
import { UpgradeEntry } from './UpgradeEntry';

const STATUS_TEXT: Record<WorkerView['status'], string> = {
  unassigned: 'Unassigned (free)',
  working: 'Working',
  idle: 'Idle: you can no longer work this node',
  paused: 'Paused: not enough gold for upkeep',
};

const STATUS_SHORT: Record<WorkerView['status'], string> = { unassigned: 'Free', working: 'Working', idle: 'Idle', paused: 'Paused' };

export function TownHallModal() {
  const { state } = useGameSnapshot();
  const level = buildingLevel(state, 'town_hall');
  const view = workersView(state);
  const bonuses = bonusLines(upgradeView(state, 'town_hall').bonuses);
  /** The worker whose node picker is open. */
  const [picking, setPicking] = useState<string | null>(null);
  /**
   * One command at a time; a double tap never sends two. Engine refusals are shown in a GameDialog, except
   * COST_CHANGED: the price on screen was stale; the button already shows the new one.
   */
  const { send: dispatch, dialog } = useCommand({ silentCodes: ['COST_CHANGED'] });
  const send = useCallback(
    (cmd: CommandInput, then?: () => void) => {
      void dispatch(cmd).then((ok) => ok && then?.());
    },
    [dispatch],
  );

  const hireCost = view.hireCost;
  const hire = useCallback(() => {
    if (hireCost !== null) send({ type: 'HIRE_WORKER', maxCost: hireCost });
  }, [hireCost, send]);
  const unassign = useCallback((workerId: string) => send({ type: 'UNASSIGN_WORKER', workerId }), [send]);
  const dismiss = useCallback(
    async (workerId: string, name: string) => {
      const ok = await dialog.confirm({
        title: `Dismiss ${name}?`,
        message: 'They leave for good. The hiring price is not refunded.',
        confirmLabel: 'Dismiss',
        cancelLabel: 'Keep',
        destructive: true,
      });
      if (ok) send({ type: 'DISMISS_WORKER', workerId });
    },
    [dialog, send],
  );
  const closePicker = useCallback(() => setPicking(null), []);
  const assign = useCallback(
    (node: WorkerNodeId) => {
      if (picking) send({ type: 'ASSIGN_WORKER', workerId: picking, node }, closePicker);
    },
    [picking, send, closePicker],
  );

  const hireSub = !view.unlocked
    ? 'Build the Town Hall'
    : hireCost === null
      ? `Full (${view.cap}): upgrade the Town Hall`
      : `${formatNumber(hireCost)}${view.canHire ? '' : ' · not enough gold'}`;
  const hireSubIcon = view.unlocked && hireCost !== null ? 'gold' : undefined;

  return (
    <ModalScreen title={BUILDINGS.town_hall.name} buildingId="town_hall" closeLabel="Close town hall" headerRight={<Text style={styles.level}>Lv {level}</Text>}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle} accessibilityRole="header">
            Town Hall · Lv {level}
          </Text>
          {bonuses.map((l) => (
            <Text key={l} style={styles.line}>
              • {l}
            </Text>
          ))}
          <Text style={styles.muted}>No building can go above the Town Hall's level.</Text>
        </View>
        <UpgradeEntry buildingId="town_hall" />

        <View style={styles.card}>
          <View style={styles.titleRow}>
            <IconText icon="workers" size={22} style={styles.cardTitle} rowStyle={styles.titleIconRow} accessibilityLabel={`Workers ${view.hired} of ${view.cap}`}>
              Workers {view.hired}/{view.cap}
            </IconText>
            <IconText icon="gold" style={styles.upkeep} accessibilityLabel={`Upkeep ${view.upkeepPerMin} gold per minute`}>
              {formatNumber(view.upkeepPerMin)}/min
            </IconText>
          </View>
          <Text style={styles.muted}>
            Each worker adds 25% of your power on a tree or rock you can work, also while the app is closed, and costs
            upkeep for every minute of work. No XP, no rare finds.
          </Text>
          {view.paused ? (
            <Text style={styles.warn} accessibilityRole="alert">
              Paused: not enough gold for the next minute of upkeep. Workers resume as soon as you have it.
            </Text>
          ) : null}
          <View style={styles.actions}>
            <PixelButton label="Hire worker" sublabel={hireSub} sublabelIcon={hireSubIcon} onPress={hire} disabled={!view.canHire} stretch accessibilityHint="The price doubles for each worker you have" />
          </View>
          {view.workers.map((w, i) => (
            <WorkerRow key={w.id} worker={w} name={`Worker ${i + 1}`} onAssign={setPicking} onUnassign={unassign} onDismiss={dismiss} />
          ))}
        </View>

        {view.crews.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle} accessibilityRole="header">
              Crews
            </Text>
            {view.crews.map((c) => (
              <CrewLine key={c.node} crew={c} />
            ))}
          </View>
        ) : null}
      </ScrollView>
      {picking ? <NodePicker onPick={assign} onClose={closePicker} current={view.workers.find((w) => w.id === picking)?.node ?? null} /> : null}
    </ModalScreen>
  );
}

// ---------- rows ----------

type RowProps = {
  worker: WorkerView;
  name: string;
  onAssign: (id: string) => void;
  onUnassign: (id: string) => void;
  onDismiss: (id: string, name: string) => void;
};

const WorkerRow = memo(function WorkerRow({ worker, name, onAssign, onUnassign, onDismiss }: RowProps) {
  const statusStyle = worker.status === 'working' ? styles.ok : worker.status === 'unassigned' ? styles.small : styles.bad;
  const assign = useCallback(() => onAssign(worker.id), [onAssign, worker.id]);
  const unassign = useCallback(() => onUnassign(worker.id), [onUnassign, worker.id]);
  const dismiss = useCallback(() => onDismiss(worker.id, name), [onDismiss, worker.id, name]);
  return (
    <View style={styles.worker}>
      <View style={styles.titleRow} accessible accessibilityLabel={`${name}, ${worker.nodeName ?? 'unassigned'}, ${STATUS_TEXT[worker.status]}`}>
        <View style={styles.workerWho}>
          <Text style={styles.workerName}>{name}</Text>
          {worker.node ? (
            <>
              <NodeIcon node={worker.node} size={16} />
              <Text style={styles.where}>{worker.nodeName}</Text>
            </>
          ) : null}
        </View>
        <Text style={[styles.status, statusStyle]}>{STATUS_SHORT[worker.status]}</Text>
      </View>
      {worker.status === 'idle' || worker.status === 'paused' ? <Text style={[styles.small, styles.bad]}>{STATUS_TEXT[worker.status]}</Text> : null}
      <View style={styles.actions}>
        <PixelButton label={worker.node ? 'Move' : 'Assign'} onPress={assign} stretch accessibilityLabel={`${worker.node ? 'Move' : 'Assign'} ${name}`} />
        {worker.node ? <PixelButton label="Unassign" onPress={unassign} stretch accessibilityLabel={`Unassign ${name}`} /> : null}
        <PixelButton label="Dismiss" onPress={dismiss} stretch accessibilityLabel={`Dismiss ${name}`} accessibilityHint="No refund" />
      </View>
    </View>
  );
});

const CrewLine = memo(function CrewLine({ crew }: { crew: CrewView }) {
  const per = crew.status === 'working' ? `${formatPerMin(crew.itemsPerMin)} ${itemName(crew.itemId)}/min` : crew.status === 'idle' ? 'idle' : 'paused';
  return (
    <View style={styles.crew} accessible accessibilityLabel={`${crew.name}, ${crew.workers} workers, ${per}, upkeep ${crew.upkeepPerMin} gold per minute`}>
      <View style={styles.crewRow}>
        <NodeIcon node={crew.node} size={16} />
        <Text style={styles.line}>
          {crew.name} <Text style={styles.small}>· Tier {crew.tier} · {crew.workers}</Text>
        </Text>
        <GameIcon name="workers" />
      </View>
      <View style={styles.crewRow}>
        <ItemIcon defId={crew.itemId} size={16} />
        <Text style={[styles.small, crew.status === 'working' ? styles.ok : styles.bad]}>{per} ·</Text>
        <GameIcon name="gold" />
        <Text style={[styles.small, crew.status === 'working' ? styles.ok : styles.bad]}>{formatNumber(crew.upkeepPerMin)}/min</Text>
      </View>
    </View>
  );
});

// ---------- node picker ----------

function NodePicker({ onPick, onClose, current }: { onPick: (node: WorkerNodeId) => void; onClose: () => void; current: WorkerNodeId | null }) {
  const { state, awaySummary } = useGameSnapshot();
  // Steps aside for a GameDialog (e.g. "Not possible" after a pick): two RN modals never present at once.
  const dialogShowing = useDialogShowing();
  const insets = useSafeAreaInsets();
  const choices = useMemo(() => nodeChoices(state), [state]);
  return (
    <Modal visible={!awaySummary && !dialogShowing} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the node list" />
      <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]}>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle} accessibilityRole="header">
            Put to work on…
          </Text>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <Text style={styles.sheetNote}>Only what you can work yourself. Output of one more worker, with your power and bonuses now.</Text>
        <ScrollView bounces={false} contentContainerStyle={styles.sheetList}>
          {choices.map((c) => (
            <ChoiceRow key={c.node} choice={c} current={c.node === current} onPick={onPick} />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const ChoiceRow = memo(function ChoiceRow({ choice, current, onPick }: { choice: NodeChoice; current: boolean; onPick: (node: WorkerNodeId) => void }) {
  const disabled = !choice.available || current;
  const pick = useCallback(() => onPick(choice.node), [onPick, choice.node]);
  const detail = choice.available
    ? `Tier ${choice.tier} · upkeep ${formatNumber(choice.upkeepPerMin)} gold/min · +${formatPerMin(choice.itemsPerMinPerWorker)} ${itemName(choice.itemId)}/min`
    : choice.reason;
  return (
    <Pressable
      onPress={pick}
      disabled={disabled}
      style={({ pressed }) => [styles.choice, pressed && styles.choicePressed, disabled && styles.choiceDisabled]}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={`${choice.name}, tier ${choice.tier}, ${
        choice.available ? `upkeep ${choice.upkeepPerMin} gold per minute, about ${formatPerMin(choice.itemsPerMinPerWorker)} ${itemName(choice.itemId)} per minute` : choice.reason
      }${current ? ', current' : ''}`}
    >
      <IconText image={<NodeIcon node={choice.node} size={20} />} style={styles.choiceName}>
        {choice.name}
        {current ? <Text style={styles.choiceCurrent}>  (here now)</Text> : null}
      </IconText>
      {choice.available ? (
        <Text style={styles.choiceDetail}>{detail}</Text>
      ) : (
        <IconText icon="locked" size={14} style={[styles.choiceDetail, styles.choiceLocked]}>
          {detail}
        </IconText>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  level: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.gold },
  content: { paddingBottom: 32 },
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    gap: 8,
    backgroundColor: colors.parchment,
    borderWidth: 3,
    borderColor: colors.parchmentDark,
  },
  cardTitle: { flexShrink: 1, fontFamily: fonts.title, fontSize: 22, color: colors.ink },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  upkeep: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  line: { fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.inkSoft },
  small: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  warn: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19, color: colors.dangerDeadly },
  ok: { color: colors.dangerEasy },
  bad: { color: colors.dangerDeadly },
  actions: { flexDirection: 'row', gap: 8 },
  worker: { gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.parchmentDark },
  workerWho: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, flexWrap: 'wrap' },
  workerName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  where: { fontFamily: fonts.body, fontSize: 14, color: colors.inkSoft },
  status: { fontFamily: fonts.bodyBold, fontSize: 14 },
  crew: { gap: 2, paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.parchmentDark },
  crewRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  titleIconRow: { flexShrink: 1, gap: 6 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { maxHeight: '80%', backgroundColor: colors.sheet, borderTopWidth: 3, borderTopColor: colors.goldDark, paddingTop: 12 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  sheetTitle: { flex: 1, fontFamily: fonts.title, fontSize: 22, color: colors.gold },
  sheetNote: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark, paddingHorizontal: 16 },
  sheetList: { padding: 16, gap: 8 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: fonts.bodyBold, fontSize: 24, color: colors.parchment },
  choice: { minHeight: 52, padding: 10, gap: 2, backgroundColor: colors.night, borderWidth: 2, borderColor: colors.goldDark },
  choicePressed: { borderColor: colors.gold },
  choiceDisabled: { opacity: 0.6 },
  choiceName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.parchment },
  choiceCurrent: { fontFamily: fonts.body, fontSize: 13, color: colors.gold },
  choiceDetail: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark },
  choiceLocked: { color: '#ff8a7a' },
});
