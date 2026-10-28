// Village → Woodcutting: full-screen modal. Header with level, XP, woodcutting strength (WS) and stamina;
// a horizontal paged carousel with one card per tree. Rules stay in the engine: this file reads
// woodcuttingView() and dispatches START_ACTIVITY {kind:'woodcutting', treeId} / STOP_ACTIVITY / SKIP_WOODCUT.
// Locked trees are refused by the engine too (TREE_LOCKED).
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, type ListRenderItem, type NativeScrollEvent, type NativeSyntheticEvent, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useGameClient, useGameSnapshot } from '../../client/GameProvider';
import type { CommandInput } from '../../client/types';
import { type TreeId, type TreeView, type WoodcutActivityView, woodcuttingView } from '../../engine';
import { colors, fonts } from '../../theme';
import { confirmCancelRun } from '../dungeon/confirmCancelRun';
import { formatClock, formatNumber, itemIcon, itemName } from '../format';
import { LiveBar } from '../LiveBar';
import { ModalScreen } from '../ModalScreen';
import { Bar } from '../Panel';
import { PixelButton } from '../PixelButton';

/** Width of the next card that shows at the right edge (the "peek"), and the gap between cards. */
const PEEK = 28;
const GAP = 10;
const SIDE = 16;

export function WoodcuttingModal() {
  const client = useGameClient();
  const { state, clockPaused } = useGameSnapshot();
  const view = woodcuttingView(state); // cheap: 5 trees, read-only
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(240, width - 2 * SIDE - PEEK);
  const step = cardWidth + GAP;
  const inFlight = useRef(false);

  /** Opens on the active tree, else the highest unlocked one. Fixed at mount so live ticks never scroll it. */
  const [initialIndex] = useState(() => Math.max(0, view.trees.findIndex((t) => t.treeId === view.focusTreeId)));
  const [page, setPage] = useState(initialIndex);
  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.max(0, Math.min(view.trees.length - 1, Math.round(e.nativeEvent.contentOffset.x / step)))),
    [step, view.trees.length],
  );

  /** One command at a time; a double tap never sends two. Engine refusals are shown, except a skip whose log already ended. */
  const send = useCallback(
    (cmd: CommandInput) => {
      if (inFlight.current) return;
      inFlight.current = true;
      client
        .dispatch(cmd)
        .then((res) => {
          // LOG_CHANGED: that log finished for free meanwhile; the card already shows the next one.
          if (!res.ok && res.error.code !== 'LOG_CHANGED') Alert.alert('Not possible', res.error.message);
        })
        .catch(() => Alert.alert('Could not save', 'Try again.'))
        .finally(() => {
          inFlight.current = false;
        });
    },
    [client],
  );

  const onStart = useCallback(
    (treeId: TreeId, name: string) => {
      const go = () => send({ type: 'START_ACTIVITY', kind: 'woodcutting', treeId });
      // One activity at a time: woodcutting would end the dungeon run in progress, so ask first.
      const a = client.getState().activity;
      if (a?.kind === 'dungeon') confirmCancelRun(`Cut ${name}`, go, a.phase === 'fight');
      else go();
    },
    [client, send],
  );
  const onStop = useCallback(() => send({ type: 'STOP_ACTIVITY' }), [send]);
  const onSkip = useCallback((log: number, cost: number) => send({ type: 'SKIP_WOODCUT', log, maxCost: cost }), [send]);

  const current = view.current;
  const stamina = state.stamina.current;
  const otherActivity = state.activity && state.activity.kind !== 'woodcutting' ? state.activity.kind : null;

  const renderItem: ListRenderItem<TreeView> = useCallback(
    ({ item }) => (
      <TreeCard
        tree={item}
        width={cardWidth}
        current={item.active ? current : null}
        stamina={stamina}
        paused={clockPaused}
        level={view.level}
        ws={view.ws.value}
        onStart={onStart}
        onStop={onStop}
        onSkip={onSkip}
      />
    ),
    [cardWidth, current, stamina, clockPaused, view.level, view.ws.value, onStart, onStop, onSkip],
  );
  const getItemLayout = useCallback((_: unknown, index: number) => ({ length: step, offset: step * index, index }), [step]);
  const separator = useCallback(() => <View style={styles.gap} />, []);
  const ws = view.ws.breakdown;
  const contentStyle = useMemo(() => ({ paddingHorizontal: SIDE, paddingRight: SIDE + PEEK }), []);

  return (
    <ModalScreen
      title="Woodcutting"
      closeLabel="Close woodcutting"
      headerRight={
        <Text style={styles.stamina} accessibilityLabel={`Stamina ${stamina} of ${state.stamina.max}`}>
          ⚡ {stamina}/{state.stamina.max}
        </Text>
      }
      headerBelow={
        <View style={styles.headerBelow}>
          <Bar value={view.xp} max={view.xpToNext} color={colors.skill} label={`Lv ${view.level} · ${formatNumber(view.xp)} / ${formatNumber(view.xpToNext)} XP`} />
          <Text
            style={styles.ws}
            accessibilityLabel={`Woodcutting strength ${view.ws.value}: ${ws.level} from level, ${ws.strength} from strength, ${ws.axe} from axe`}
          >
            💪 WS {formatNumber(view.ws.value)} <Text style={styles.wsParts}>= {formatNumber(ws.level)} level + {formatNumber(ws.strength)} STR + {formatNumber(ws.axe)} axe</Text>
          </Text>
        </View>
      }
    >
      {clockPaused ? <Text style={styles.paused}>⏸ Paused: your device clock moved back. Logs wait until it catches up.</Text> : null}
      <FlatList
        data={view.trees}
        keyExtractor={(t) => t.treeId}
        renderItem={renderItem}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        getItemLayout={getItemLayout}
        initialScrollIndex={initialIndex}
        ItemSeparatorComponent={separator}
        contentContainerStyle={contentStyle}
        onMomentumScrollEnd={onScrollEnd}
        style={styles.list}
      />
      <View style={styles.dots} accessibilityRole="text" accessibilityLabel={`Tree ${page + 1} of ${view.trees.length}`}>
        {view.trees.map((t, i) => (
          <View key={t.treeId} style={[styles.dot, i === page && styles.dotActive, t.active && styles.dotRunning]} />
        ))}
      </View>
      <Text style={styles.note}>Logs are cut one after another, also while the app is closed (up to {formatNumber(state.offline.capMs / 3_600_000)}h).</Text>
      {otherActivity === 'training' ? <Text style={styles.note}>Starting stops training (your training XP is kept).</Text> : null}
      {otherActivity === 'mining' ? <Text style={styles.note}>Starting stops mining (your ores are kept).</Text> : null}
      {otherActivity === 'dungeon' ? <Text style={styles.note}>Starting stops the dungeon: the run in progress is lost.</Text> : null}
    </ModalScreen>
  );
}

// ---------- one tree ----------

type CardProps = {
  tree: TreeView;
  width: number;
  /** The log in progress when this tree is being cut. */
  current: WoodcutActivityView | null;
  stamina: number;
  paused: boolean;
  level: number;
  ws: number;
  onStart: (treeId: TreeId, name: string) => void;
  onStop: () => void;
  onSkip: (log: number, cost: number) => void;
};

const TreeCard = memo(function TreeCard({ tree, width, current, stamina, paused, level, ws, onStart, onStop, onSkip }: CardProps) {
  const start = useCallback(() => onStart(tree.treeId, tree.name), [onStart, tree.treeId, tree.name]);
  const skip = useCallback(() => current && onSkip(current.log, current.skipCost), [current, onSkip]);
  const nest = tree.rareDrops[0];
  const missing = [
    tree.levelOk ? null : `Woodcutting Lv ${tree.reqLevel}`,
    tree.wsOk ? null : `${formatNumber(tree.reqWs - ws)} more WS`,
  ].filter(Boolean);
  const canSkip = !!current && stamina >= current.skipCost;
  const cardStyle = useMemo(() => [styles.card, { width }, tree.active && styles.cardActive, !tree.unlocked && styles.cardLocked], [width, tree.active, tree.unlocked]);

  return (
    <View style={cardStyle}>
      <Text style={styles.treeIcon} accessibilityElementsHidden importantForAccessibility="no">
        {tree.icon}
      </Text>
      <Text style={styles.treeName} accessibilityRole="header">
        {tree.name}
      </Text>
      <View style={styles.reqs}>
        <Req ok={tree.levelOk} label={`Lv ${tree.reqLevel}`} detail={`you ${level}`} />
        <Req ok={tree.wsOk} label={`WS ${formatNumber(tree.reqWs)}`} detail={`you ${formatNumber(ws)}`} />
      </View>
      <View style={styles.facts}>
        <Fact label="Time per log" value={formatClock(tree.logMs)} />
        <Fact label="XP per log" value={formatNumber(tree.xpPerLog)} />
        <Fact label="Log" value={`${itemIcon(tree.logItemId)} ${itemName(tree.logItemId)}`} />
        {nest ? <Fact label={`${itemIcon(nest.itemId)} ${itemName(nest.itemId)}`} value={`1 in ${formatNumber(Math.round(1 / nest.chance))}`} /> : null}
      </View>

      {current ? (
        <View style={styles.running}>
          <Text style={styles.countdown} accessibilityLabel={`${formatClock(current.remainingMs)} left on this log`}>
            Next log in {formatClock(current.remainingMs)}
          </Text>
          <LiveBar fraction={current.fraction} remainingMs={current.remainingMs} paused={paused} color={colors.skill} style={styles.bar} />
        </View>
      ) : null}

      <View style={styles.actions}>
        {!tree.unlocked ? (
          <Text style={styles.locked}>🔒 Needs {missing.join(' and ')}</Text>
        ) : current ? (
          <>
            <PixelButton label="Stop" onPress={onStop} active accessibilityLabel={`Stop cutting ${tree.name}`} accessibilityHint="Your logs are kept" />
            <PixelButton
              label={`Skip (${current.skipCost}⚡)`}
              onPress={skip}
              disabled={!canSkip}
              accessibilityLabel={`Skip this log for ${current.skipCost} stamina`}
              accessibilityHint={canSkip ? 'Finishes the current log now' : 'Not enough stamina'}
            />
          </>
        ) : (
          <PixelButton label="Start" onPress={start} accessibilityLabel={`Start cutting ${tree.name}`} accessibilityHint="Stops any other activity" />
        )}
      </View>
    </View>
  );
});

function Req({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <Text style={[styles.req, ok ? styles.reqOk : styles.reqMissing]} accessibilityLabel={`${label} required, ${detail}, ${ok ? 'met' : 'not met'}`}>
      {ok ? '✓' : '✗'} {label} <Text style={styles.reqDetail}>({detail})</Text>
    </Text>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stamina: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.stamina },
  headerBelow: { paddingHorizontal: 12, gap: 4 },
  ws: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.parchment },
  wsParts: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark },
  paused: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold, marginHorizontal: 12, marginTop: 10 },

  list: { flexGrow: 0, marginTop: 14 },
  gap: { width: GAP },
  card: {
    padding: 14,
    gap: 10,
    backgroundColor: colors.parchment,
    borderWidth: 3,
    borderColor: colors.parchmentDark,
  },
  cardActive: { borderColor: colors.gold, backgroundColor: '#f7ecd0' },
  cardLocked: { opacity: 0.6 },
  treeIcon: { fontSize: 56, textAlign: 'center' },
  treeName: { fontFamily: fonts.title, fontSize: 26, color: colors.ink, textAlign: 'center' },
  reqs: { flexDirection: 'row', justifyContent: 'center', gap: 14, flexWrap: 'wrap' },
  req: { fontFamily: fonts.bodyBold, fontSize: 15 },
  reqOk: { color: colors.dangerEasy },
  reqMissing: { color: colors.dangerDeadly },
  reqDetail: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  facts: { gap: 4 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  factLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.inkSoft },
  factValue: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink, textAlign: 'right' },
  running: { gap: 6 },
  countdown: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink, textAlign: 'center' },
  bar: { height: 14 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 10, minHeight: 48, alignItems: 'center' },
  locked: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.dangerDeadly, textAlign: 'center' },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 },
  dot: { width: 10, height: 10, backgroundColor: colors.woodDark, borderWidth: 2, borderColor: colors.goldDark },
  dotActive: { backgroundColor: colors.gold },
  dotRunning: { borderColor: colors.skill },
  note: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark, textAlign: 'center', marginTop: 10, marginHorizontal: 16 },
});
