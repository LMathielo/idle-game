// Workers on the Woodcutting and Mine Shaft cards: a "Workers: X free / Y hired" line above the cards and, on each
// tree / rock, the crew row with [−] / [+]. Rules stay in the engine: the can-work-it check and its reason come from
// nodeChoices(), the commands are ASSIGN_WORKER / UNASSIGN_WORKER (the Town Hall's own), and hiring / dismissing stay
// in the Town Hall. Which worker moves is decided by pickWorker.ts, read from the live state at tap time.
import { memo, useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { GameState } from '../../engine';
import { type CrewView, nodeChoices, type WorkerNodeId, workersView } from '../../engine';
import { colors, fonts } from '../../theme';
import { GameIcon, IconText } from '../art/Sprites';
import { formatPerMin, itemName } from '../format';
import { PixelButton } from '../PixelButton';
import type { Send } from '../ui/useCommand';
import { firstFreeWorker, lastWorkerOn } from './pickWorker';

export type NodeWorkersInfo = {
  /** Town Hall built and at least one worker hired: the controls show. */
  show: boolean;
  free: number;
  hired: number;
  /** Why workers can't work a node now (the engine's reason), per node; absent when they can. */
  reasons: ReadonlyMap<WorkerNodeId, string>;
};

/** Read-only numbers for the line and the cards (selectors only). */
export function nodeWorkersInfo(state: GameState): NodeWorkersInfo {
  const v = workersView(state);
  const reasons = new Map<WorkerNodeId, string>();
  for (const c of nodeChoices(state)) if (c.reason) reasons.set(c.node, c.reason);
  return { show: v.unlocked && v.hired > 0, free: v.workers.filter((w) => w.node === null).length, hired: v.hired, reasons };
}

/** The crew's status text as the cards showed it before (workers count, output or why not). */
export function crewStatusText(crew: CrewView): string {
  return crew.status === 'working'
    ? `${formatPerMin(crew.itemsPerMin)} ${itemName(crew.itemId)}/min`
    : crew.status === 'idle'
      ? 'idle (you can’t work it now)'
      : 'paused (upkeep)';
}

/** The crew's spoken form for screen readers. */
export function crewSpoken(crew: CrewView): string {
  return `${crew.workers} workers here, ${crew.status === 'working' ? `about ${formatPerMin(crew.itemsPerMin)} per minute` : crew.status}`;
}

/** Stable [+] / [−] handlers: they pick the worker from the live state, so they never go stale between ticks. */
export function useWorkerActions(send: Send, client: { getState(): GameState }) {
  const onAssign = useCallback(
    (node: WorkerNodeId) => {
      const workerId = firstFreeWorker(workersView(client.getState()).workers);
      if (workerId) void send({ type: 'ASSIGN_WORKER', workerId, node });
    },
    [client, send],
  );
  const onUnassign = useCallback(
    (node: WorkerNodeId) => {
      const workerId = lastWorkerOn(workersView(client.getState()).workers, node);
      if (workerId) void send({ type: 'UNASSIGN_WORKER', workerId });
    },
    [client, send],
  );
  return { onAssign, onUnassign };
}

/** "Workers: X free / Y hired" (hidden until the first hire). */
export const WorkersLine = memo(function WorkersLine({ info }: { info: NodeWorkersInfo }) {
  if (!info.show) return null;
  return (
    <IconText icon="workers" style={styles.line} rowStyle={styles.lineRow} accessibilityLabel={`Workers: ${info.free} free of ${info.hired} hired`}>
      Workers: {info.free} free / {info.hired} hired
    </IconText>
  );
});

type RowProps = {
  node: WorkerNodeId;
  name: string;
  /** Workers on this node. */
  workers: number;
  /** Crew status text, or null without a crew. */
  statusText: string | null;
  /** Spoken form of the crew, or null without a crew. */
  spoken: string | null;
  /** The crew is idle or paused (red text). */
  off: boolean;
  show: boolean;
  free: number;
  /** The hero can't work this node now (the card shows its own "Needs …" line, so this row adds no text). */
  blocked: boolean;
  onAssign: (node: WorkerNodeId) => void;
  onUnassign: (node: WorkerNodeId) => void;
};

/** The crew row of a tree / rock card: icon, "N workers" and status, then [−] [+] and a hint. */
export const NodeCrewControl = memo(function NodeCrewControl({ node, name, workers, statusText, spoken, off, show, free, blocked, onAssign, onUnassign }: RowProps) {
  const plus = useCallback(() => onAssign(node), [onAssign, node]);
  const minus = useCallback(() => onUnassign(node), [onUnassign, node]);
  if (workers === 0 && (!show || blocked)) return null;
  const noun = workers === 1 ? 'worker' : 'workers';
  const canAdd = free > 0 && !blocked;
  const hint = !blocked && free === 0 ? 'No free workers · hire at Town Hall' : null;
  return (
    <View style={styles.block}>
      <View style={styles.textRow}>
        <GameIcon name="workers" />
        <Text style={[styles.crew, off && styles.crewOff]} accessibilityLabel={spoken ?? `${workers} ${noun} here`}>
          {workers} {noun}
          {statusText ? ` · ${statusText}` : ''}
        </Text>
      </View>
      {show ? (
        <>
          <View style={styles.buttons}>
            <View style={styles.btn}>
              <PixelButton
                label="−"
                stretch
                onPress={minus}
                disabled={workers === 0}
                accessibilityLabel={`Remove a worker from ${name}`}
                accessibilityHint="Sends one worker back to unassigned"
              />
            </View>
            <View style={styles.btn}>
              <PixelButton
                label="+"
                stretch
                onPress={plus}
                disabled={!canAdd}
                accessibilityLabel={`Add a worker to ${name}`}
                accessibilityHint={canAdd ? 'Puts one free worker here' : (hint ?? undefined)}
              />
            </View>
          </View>
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        </>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  line: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.parchment, textAlign: 'center' },
  lineRow: { alignSelf: 'center', marginTop: 10 },
  block: { gap: 6, alignItems: 'center' },
  textRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5 },
  crew: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 14, color: colors.dangerEasy, textAlign: 'center' },
  crewOff: { color: colors.dangerDeadly },
  buttons: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  btn: { flexDirection: 'row', width: 64 },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft, textAlign: 'center' },
});
