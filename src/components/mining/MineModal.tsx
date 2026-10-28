// Village → Mine Shaft: full-screen modal, mirroring the Woodcutting modal. Header with level, XP, mining strength
// (MS) and stamina; a horizontal paged carousel with one card per rock. Rules stay in the engine: this file reads
// miningView() and dispatches START_ACTIVITY {kind:'mining', rockId} / STOP_ACTIVITY / SKIP_MINE. Locked rocks are
// refused by the engine too (ROCK_LOCKED).
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, type ListRenderItem, type NativeScrollEvent, type NativeSyntheticEvent, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useGameClient, useGameSnapshot } from '../../client/GameProvider';
import type { CommandInput } from '../../client/types';
import { type MineActivityView, miningView, type RockId, type RockView } from '../../engine';
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

export function MineModal() {
  const client = useGameClient();
  const { state, clockPaused } = useGameSnapshot();
  const view = miningView(state); // cheap: 5 rocks, read-only
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(240, width - 2 * SIDE - PEEK);
  const step = cardWidth + GAP;
  const inFlight = useRef(false);

  /** Opens on the active rock, else the highest unlocked one. Fixed at mount so live ticks never scroll it. */
  const [initialIndex] = useState(() => Math.max(0, view.rocks.findIndex((r) => r.rockId === view.focusRockId)));
  const [page, setPage] = useState(initialIndex);
  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.max(0, Math.min(view.rocks.length - 1, Math.round(e.nativeEvent.contentOffset.x / step)))),
    [step, view.rocks.length],
  );

  /** One command at a time; a double tap never sends two. Engine refusals are shown, except a skip whose ore already ended. */
  const send = useCallback(
    (cmd: CommandInput) => {
      if (inFlight.current) return;
      inFlight.current = true;
      client
        .dispatch(cmd)
        .then((res) => {
          // ORE_CHANGED: that ore finished for free meanwhile; the card already shows the next one.
          if (!res.ok && res.error.code !== 'ORE_CHANGED') Alert.alert('Not possible', res.error.message);
        })
        .catch(() => Alert.alert('Could not save', 'Try again.'))
        .finally(() => {
          inFlight.current = false;
        });
    },
    [client],
  );

  const onStart = useCallback(
    (rockId: RockId, name: string) => {
      const go = () => send({ type: 'START_ACTIVITY', kind: 'mining', rockId });
      // One activity at a time: mining would end the dungeon run in progress, so ask first.
      const a = client.getState().activity;
      if (a?.kind === 'dungeon') confirmCancelRun(`Mine ${name}`, go, a.phase === 'fight');
      else go();
    },
    [client, send],
  );
  const onStop = useCallback(() => send({ type: 'STOP_ACTIVITY' }), [send]);
  const onSkip = useCallback((ore: number, cost: number) => send({ type: 'SKIP_MINE', ore, maxCost: cost }), [send]);

  const current = view.current;
  const stamina = state.stamina.current;
  const otherActivity = state.activity && state.activity.kind !== 'mining' ? state.activity.kind : null;

  const renderItem: ListRenderItem<RockView> = useCallback(
    ({ item }) => (
      <RockCard
        rock={item}
        width={cardWidth}
        current={item.active ? current : null}
        stamina={stamina}
        paused={clockPaused}
        level={view.level}
        ms={view.ms.value}
        onStart={onStart}
        onStop={onStop}
        onSkip={onSkip}
      />
    ),
    [cardWidth, current, stamina, clockPaused, view.level, view.ms.value, onStart, onStop, onSkip],
  );
  const getItemLayout = useCallback((_: unknown, index: number) => ({ length: step, offset: step * index, index }), [step]);
  const separator = useCallback(() => <View style={styles.gap} />, []);
  const ms = view.ms.breakdown;
  const contentStyle = useMemo(() => ({ paddingHorizontal: SIDE, paddingRight: SIDE + PEEK }), []);

  return (
    <ModalScreen
      title="Mine Shaft"
      closeLabel="Close mine shaft"
      headerRight={
        <Text style={styles.stamina} accessibilityLabel={`Stamina ${stamina} of ${state.stamina.max}`}>
          ⚡ {stamina}/{state.stamina.max}
        </Text>
      }
      headerBelow={
        <View style={styles.headerBelow}>
          <Bar value={view.xp} max={view.xpToNext} color={colors.skill} label={`Lv ${view.level} · ${formatNumber(view.xp)} / ${formatNumber(view.xpToNext)} XP`} />
          <Text
            style={styles.ms}
            accessibilityLabel={`Mining strength ${view.ms.value}: ${ms.level} from level, ${ms.strength} from strength, ${ms.pickaxe} from pickaxe`}
          >
            💪 MS {formatNumber(view.ms.value)} <Text style={styles.msParts}>= {formatNumber(ms.level)} level + {formatNumber(ms.strength)} STR + {formatNumber(ms.pickaxe)} pickaxe</Text>
          </Text>
        </View>
      }
    >
      {clockPaused ? <Text style={styles.paused}>⏸ Paused: your device clock moved back. Ores wait until it catches up.</Text> : null}
      <FlatList
        data={view.rocks}
        keyExtractor={(r) => r.rockId}
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
      <View style={styles.dots} accessibilityRole="text" accessibilityLabel={`Rock ${page + 1} of ${view.rocks.length}`}>
        {view.rocks.map((r, i) => (
          <View key={r.rockId} style={[styles.dot, i === page && styles.dotActive, r.active && styles.dotRunning]} />
        ))}
      </View>
      <Text style={styles.note}>Ores are mined one after another, also while the app is closed (up to {formatNumber(state.offline.capMs / 3_600_000)}h).</Text>
      {otherActivity === 'training' ? <Text style={styles.note}>Starting stops training (your training XP is kept).</Text> : null}
      {otherActivity === 'woodcutting' ? <Text style={styles.note}>Starting stops woodcutting (your logs are kept).</Text> : null}
      {otherActivity === 'dungeon' ? <Text style={styles.note}>Starting stops the dungeon: the run in progress is lost.</Text> : null}
    </ModalScreen>
  );
}

// ---------- one rock ----------

type CardProps = {
  rock: RockView;
  width: number;
  /** The ore in progress when this rock is being mined. */
  current: MineActivityView | null;
  stamina: number;
  paused: boolean;
  level: number;
  ms: number;
  onStart: (rockId: RockId, name: string) => void;
  onStop: () => void;
  onSkip: (ore: number, cost: number) => void;
};

const RockCard = memo(function RockCard({ rock, width, current, stamina, paused, level, ms, onStart, onStop, onSkip }: CardProps) {
  const start = useCallback(() => onStart(rock.rockId, rock.name), [onStart, rock.rockId, rock.name]);
  const skip = useCallback(() => current && onSkip(current.ore, current.skipCost), [current, onSkip]);
  const geode = rock.rareDrops[0];
  const missing = [
    rock.levelOk ? null : `Mining Lv ${rock.reqLevel}`,
    rock.msOk ? null : `${formatNumber(rock.reqMs - ms)} more MS`,
  ].filter(Boolean);
  const canSkip = !!current && stamina >= current.skipCost;
  const cardStyle = useMemo(() => [styles.card, { width }, rock.active && styles.cardActive, !rock.unlocked && styles.cardLocked], [width, rock.active, rock.unlocked]);

  return (
    <View style={cardStyle}>
      <Text style={styles.rockIcon} accessibilityElementsHidden importantForAccessibility="no">
        {rock.icon}
      </Text>
      <Text style={styles.rockName} accessibilityRole="header">
        {rock.name}
      </Text>
      <View style={styles.reqs}>
        <Req ok={rock.levelOk} label={`Lv ${rock.reqLevel}`} detail={`you ${level}`} />
        <Req ok={rock.msOk} label={`MS ${formatNumber(rock.reqMs)}`} detail={`you ${formatNumber(ms)}`} />
      </View>
      <View style={styles.facts}>
        <Fact label="Time per ore" value={formatClock(rock.oreMs)} />
        <Fact label="XP per ore" value={formatNumber(rock.xpPerOre)} />
        <Fact label="Ore" value={`${itemIcon(rock.oreItemId)} ${itemName(rock.oreItemId)}`} />
        {geode ? <Fact label={`${itemIcon(geode.itemId)} ${itemName(geode.itemId)}`} value={`1 in ${formatNumber(Math.round(1 / geode.chance))}`} /> : null}
      </View>

      {current ? (
        <View style={styles.running}>
          <Text style={styles.countdown} accessibilityLabel={`${formatClock(current.remainingMs)} left on this ore`}>
            Next ore in {formatClock(current.remainingMs)}
          </Text>
          <LiveBar fraction={current.fraction} remainingMs={current.remainingMs} paused={paused} color={colors.skill} style={styles.bar} />
        </View>
      ) : null}

      <View style={styles.actions}>
        {!rock.unlocked ? (
          <Text style={styles.locked}>🔒 Needs {missing.join(' and ')}</Text>
        ) : current ? (
          <>
            <PixelButton label="Stop" onPress={onStop} active accessibilityLabel={`Stop mining ${rock.name}`} accessibilityHint="Your ores are kept" />
            <PixelButton
              label={`Skip (${current.skipCost}⚡)`}
              onPress={skip}
              disabled={!canSkip}
              accessibilityLabel={`Skip this ore for ${current.skipCost} stamina`}
              accessibilityHint={canSkip ? 'Finishes the current ore now' : 'Not enough stamina'}
            />
          </>
        ) : (
          <PixelButton label="Start" onPress={start} accessibilityLabel={`Start mining ${rock.name}`} accessibilityHint="Stops any other activity" />
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
  ms: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.parchment },
  msParts: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark },
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
  rockIcon: { fontSize: 56, textAlign: 'center' },
  rockName: { fontFamily: fonts.title, fontSize: 26, color: colors.ink, textAlign: 'center' },
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
