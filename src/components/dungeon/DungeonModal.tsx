// Village → Dungeon: full-screen modal with the dungeon list and, inside the same modal, the detail
// view (enemy, hero, danger hint, start / skip / stop, last fight + replay). Rules stay in the engine: this
// file only reads selectors (dungeonRunView, dungeonUnlockView, dangerHint, hpView, staminaView,
// getDerivedStats) and dispatches commands. Locked dungeons can't be opened; the engine refuses them too.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGameClient, useGameSnapshot } from '../../client/GameProvider';
import type { CommandInput } from '../../client/types';
import {
  type DangerLevel,
  dangerHint,
  DEV_TOOLS_ENABLED,
  DUNGEON_IDS,
  type DungeonId,
  DUNGEONS,
  dungeonRunView,
  type DungeonRunView,
  dungeonTotals,
  dungeonUnlockView,
  ENEMIES,
  type FightRecord,
  type GameState,
  getDerivedStats,
  hpView,
  runMsFor,
  staminaView,
  strikeRange,
} from '../../engine';
import { colors, fonts } from '../../theme';
import { formatClock, formatNumber, itemIcon, itemName } from '../format';
import { LiveBar } from '../LiveBar';
import { ModalScreen } from '../ModalScreen';
import { Bar, Panel } from '../Panel';
import { PixelButton } from '../PixelButton';
import { confirmCancelRun } from './confirmCancelRun';
import { FightReplay } from './FightReplay';
import { OUTCOME_LABELS } from './outcome';

const range = (min: number, max: number) => (min === max ? `${min}` : `${min}–${max}`);
const percent = (p: number) => `${Math.round(p * 100)}%`;


export function DungeonModal() {
  const { state, clockPaused } = useGameSnapshot();
  const running = state.activity?.kind === 'dungeon' ? state.activity.dungeonId : null;
  const [selected, setSelected] = useState<DungeonId | null>(running);
  const hp = hpView(state);
  const stamina = staminaView(state);

  // Android back: from a dungeon's detail, go back to the list first; from the list it closes the modal.
  useEffect(() => {
    if (!selected) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelected(null);
      return true;
    });
    return () => sub.remove();
  }, [selected]);

  return (
    <ModalScreen
      title="Dungeons"
      closeLabel="Close dungeons"
      headerRight={
        <Text style={styles.stamina} accessibilityLabel={`Stamina ${stamina.current} of ${stamina.max}`}>
          ⚡ {stamina.current}/{stamina.max}
        </Text>
      }
      headerBelow={<HpRow hp={hp.hp} maxHp={hp.maxHp} regenPerMin={hp.regenPerMin} />}
    >
      <ScrollView contentContainerStyle={styles.content}>
        {clockPaused ? <Text style={styles.paused}>⏸ Paused: your device clock moved back. Runs and regen wait until it catches up.</Text> : null}
        {selected ? (
          <DungeonDetail id={selected} state={state} running={running === selected} paused={clockPaused} onBack={() => setSelected(null)} />
        ) : (
          <DungeonList state={state} running={running} onPick={setSelected} />
        )}
      </ScrollView>
    </ModalScreen>
  );
}

// ---------- header ----------

const HpRow = memo(function HpRow({ hp, maxHp, regenPerMin }: { hp: number; maxHp: number; regenPerMin: number }) {
  return (
    <View style={styles.hpRow} accessible accessibilityLabel={`Hero HP ${hp} of ${maxHp}, regenerates ${regenPerMin} per minute`}>
      <View style={styles.flex}>
        <Bar value={hp} max={maxHp} color={colors.hp} label={`HP ${formatNumber(hp)} / ${formatNumber(maxHp)}`} />
      </View>
      <Text style={styles.regen}>+{regenPerMin}/min</Text>
    </View>
  );
});

// ---------- list ----------

const DANGER_LABELS: Record<DangerLevel, string> = { easy: 'Easy', risky: 'Risky', deadly: 'Deadly' };

/** "Win 10× in Rat Cellar · 7/10" */
function requirementText(req: { dungeonId: DungeonId; wins: number }, progress: number): string {
  return `Win ${req.wins}× in ${DUNGEONS[req.dungeonId].name} · ${formatNumber(progress)}/${formatNumber(req.wins)}`;
}

function DungeonList({ state, running, onPick }: { state: GameState; running: DungeonId | null; onPick: (id: DungeonId) => void }) {
  return (
    <View>
      {DUNGEON_IDS.map((id) => {
        const unlock = dungeonUnlockView(state, id);
        if (!unlock.unlocked && unlock.requirement) {
          return <LockedCard key={id} id={id} requirement={requirementText(unlock.requirement, unlock.progress)} />;
        }
        return (
          <DungeonCard
            key={id}
            id={id}
            runMs={runMsFor(id, state.character.attributes)}
            wins={dungeonTotals(state, id).wins}
            running={running === id}
            onPick={onPick}
          />
        );
      })}
    </View>
  );
}

const DungeonCard = memo(function DungeonCard({
  id,
  runMs,
  wins,
  running,
  onPick,
}: {
  id: DungeonId;
  runMs: number;
  wins: number;
  running: boolean;
  onPick: (id: DungeonId) => void;
}) {
  const d = DUNGEONS[id];
  const enemy = ENEMIES[d.enemyId];
  const line = `Tier ${d.tier} · ${enemy.name} · ${formatClock(runMs)} per run`;
  return (
    <Pressable
      onPress={() => onPick(id)}
      accessibilityRole="button"
      accessibilityLabel={`${d.name}, ${line}, ${wins} wins${running ? ', running' : ''}`}
      accessibilityHint="Opens the dungeon"
    >
      {({ pressed }) => (
        <View style={[styles.card, pressed && styles.cardPressed, running && styles.cardRunning]}>
          <Text style={styles.cardIcon}>{enemy.icon}</Text>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{d.name}</Text>
            <Text style={styles.cardLine}>{line}</Text>
            <Text style={styles.cardLine}>Wins: {formatNumber(wins)}</Text>
          </View>
          {running ? <Text style={styles.badge}>Running</Text> : <Text style={styles.chevron}>›</Text>}
        </View>
      )}
    </Pressable>
  );
});

/** Dimmed, never opens the detail: a tap only repeats what unlocks it. */
const LockedCard = memo(function LockedCard({ id, requirement }: { id: DungeonId; requirement: string }) {
  const d = DUNGEONS[id];
  const enemy = ENEMIES[d.enemyId];
  const explain = () => Alert.alert(`🔒 ${d.name}`, `Locked. ${requirement}.`);
  return (
    <Pressable
      onPress={explain}
      accessibilityRole="button"
      accessibilityState={{ disabled: true }}
      accessibilityLabel={`${d.name}, locked, ${enemy.name}. ${requirement}`}
      accessibilityHint="Shows what unlocks it"
    >
      {({ pressed }) => (
        <View style={[styles.card, styles.cardLocked, pressed && styles.cardPressed]}>
          <Text style={[styles.cardIcon, styles.dimmed]}>🔒</Text>
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, styles.dimmed]}>{d.name}</Text>
            <Text style={styles.cardLine}>
              Tier {d.tier} · {enemy.name}
            </Text>
            <Text style={styles.lockLine}>{requirement}</Text>
          </View>
        </View>
      )}
    </Pressable>
  );
});

// ---------- detail ----------

function DungeonDetail({
  id,
  state,
  running,
  paused,
  onBack,
}: {
  id: DungeonId;
  state: GameState;
  running: boolean;
  paused: boolean;
  onBack: () => void;
}) {
  const client = useGameClient();
  const d = DUNGEONS[id];
  const enemy = ENEMIES[d.enemyId];
  const { level, attributes, equipment } = state.character;
  const stats = useMemo(() => getDerivedStats({ character: { level, attributes, equipment } }), [level, attributes, equipment]);
  const danger = useMemo(() => dangerHint({ character: { level, attributes, equipment } }, id), [level, attributes, equipment, id]);
  const unlock = dungeonUnlockView(state, id);
  const totals = dungeonTotals(state, id);
  const hp = hpView(state);
  const run = running ? dungeonRunView(state) : null;
  const inFlight = useRef(false);
  const [replay, setReplay] = useState<FightRecord | null>(null);
  const [replayKey, setReplayKey] = useState(0);
  const lastFight = state.dungeon.lastFight?.dungeonId === id ? state.dungeon.lastFight : null;

  /** One command at a time; a double tap never sends two. Engine refusals are shown, never hidden. */
  const send = useCallback(
    (cmd: CommandInput) => {
      if (inFlight.current) return;
      inFlight.current = true;
      client
        .dispatch(cmd)
        .then((res) => {
          // RUN_CHANGED: the run (or its cost) changed under the player's finger. Nothing was spent; the
          // screen already shows the new run and cost, so no alert.
          if (!res.ok && res.error.code !== 'RUN_CHANGED') Alert.alert('Not possible', res.error.message);
        })
        .catch(() => Alert.alert('Could not save', 'Try again.'))
        .finally(() => {
          inFlight.current = false;
        });
    },
    [client],
  );

  const start = () => send({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: id });
  /** Names the run and the cost the player saw, so the engine never charges more or skips a later run. */
  const skip = useCallback((runNumber: number, maxCost: number) => send({ type: 'SKIP_DUNGEON_RUN', run: runNumber, maxCost }), [send]);
  const hits = strikeRange(enemy.damage, stats.defense.value);
  const stop = useCallback(() => confirmCancelRun('Stop', () => send({ type: 'STOP_ACTIVITY' })), [send]);
  const otherActivity = state.activity && !running ? state.activity.kind : null;
  const addWins = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    client.debug
      .addDungeonWins(id, 10)
      .then((res) => {
        if (!res.ok) Alert.alert('Not possible', res.error.message);
      })
      .catch(() => Alert.alert('Could not save', 'Try again.'))
      .finally(() => {
        inFlight.current = false;
      });
  }, [client, id]);

  return (
    <View>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to all dungeons" hitSlop={8} style={styles.back}>
        <Text style={styles.backText}>‹ All dungeons</Text>
      </Pressable>

      <Panel title={`${d.name} · Tier ${d.tier}`}>
        <View style={styles.versus}>
          <View
            style={styles.side}
            accessible
            accessibilityLabel={`${enemy.name}: HP ${enemy.hp}, damage ${range(enemy.damage.min, enemy.damage.max)}, defense ${enemy.defense}`}
          >
            <Text style={styles.sideTitle}>
              {enemy.icon} {enemy.name}
            </Text>
            <StatLine label="HP" value={`${enemy.hp}`} />
            <StatLine label="Damage" value={range(enemy.damage.min, enemy.damage.max)} />
            <StatLine label="Defense" value={`${enemy.defense}`} />
          </View>
          <Text style={styles.vs}>vs</Text>
          <View
            style={styles.side}
            accessible
            accessibilityLabel={`${state.character.name}: HP ${hp.hp} of ${hp.maxHp}, damage ${range(stats.damage.min, stats.damage.max)}, defense ${stats.defense.value}`}
          >
            <Text style={styles.sideTitle}>🧔 {state.character.name}</Text>
            <StatLine label="HP" value={`${hp.hp}/${hp.maxHp}`} />
            <StatLine label="Damage" value={range(stats.damage.min, stats.damage.max)} />
            <StatLine label="Defense" value={`${stats.defense.value}`} />
          </View>
        </View>

        <View
          style={styles.dangerRow}
          accessible
          accessibilityLabel={`Danger: ${DANGER_LABELS[danger.level]}. About ${danger.expectedHpLoss} HP lost per fight, ${danger.percent}% of your max HP`}
        >
          <Text style={[styles.dangerLabel, DANGER_STYLES[danger.level]]}>Danger: {DANGER_LABELS[danger.level]}</Text>
          <Text style={styles.note}>
            ~{formatNumber(danger.expectedHpLoss)} HP lost per fight ({danger.percent}% of max)
          </Text>
        </View>

        <Text style={styles.subTitle}>Loot (win only)</Text>
        <View
          accessible
          accessibilityLabel={`Loot on a win: ${d.rewards.heroXp} hero XP, ${range(d.rewards.gold.min, d.rewards.gold.max)} gold, ${d.rewards.drops
            .map((x) => `${itemName(x.itemId)} ${percent(x.chance)} chance`)
            .join(', ')}`}
        >
          <StatLine label="✨ Hero XP" value={`+${d.rewards.heroXp}`} />
          <StatLine label="🪙 Gold" value={range(d.rewards.gold.min, d.rewards.gold.max)} />
          {d.rewards.drops.map((x) => (
            <StatLine key={x.itemId} label={`${itemIcon(x.itemId)} ${itemName(x.itemId)}`} value={percent(x.chance)} />
          ))}
        </View>
      </Panel>

      <Panel title="Runs">
        {run ? (
          <RunControls
            run={run}
            paused={paused}
            stamina={state.stamina.current}
            hp={hp.hp}
            enemyName={enemy.name}
            hitMin={hits.min}
            hitMax={hits.max}
            onSkip={skip}
            onStop={stop}
          />
        ) : !unlock.unlocked && unlock.requirement ? (
          <Text style={styles.note}>🔒 Locked. {requirementText(unlock.requirement, unlock.progress)}.</Text>
        ) : (
          <View style={styles.startBox}>
            <Text style={styles.note}>
              Runs repeat on their own, also while the app is closed (up to {formatNumber(state.offline.capMs / 3_600_000)}h). Each run takes{' '}
              {formatClock(runMsFor(id, attributes))} and ends in a fight. Waiting is free.
            </Text>
            {otherActivity === 'woodcutting' ? <Text style={styles.note}>Starting stops woodcutting (your logs are kept).</Text> : null}
            <PixelButton label="Start" icon="⚔️" onPress={start} accessibilityLabel={`Start ${d.name} runs`} />
          </View>
        )}
        <Text style={styles.totals}>
          Lifetime here: {formatNumber(totals.runs)} runs · {formatNumber(totals.wins)} wins · {formatNumber(totals.losses)} losses
        </Text>
        {DEV_TOOLS_ENABLED && unlock.unlocked ? (
          <View style={styles.debugRow}>
            <PixelButton label="+10 wins (debug)" onPress={addWins} accessibilityHint="Debug: adds 10 wins here, to test unlocks" />
          </View>
        ) : null}
      </Panel>

      <Panel title="Last fight">
        {replay ? (
          <FightReplay
            key={replayKey}
            fight={replay}
            heroName={state.character.name}
            enemyName={enemy.name}
            onClose={() => setReplay(null)}
          />
        ) : lastFight ? (
          <LastFight
            fight={lastFight}
            onReplay={() => {
              setReplayKey((k) => k + 1);
              setReplay(lastFight);
            }}
          />
        ) : (
          <Text style={styles.note}>No fight yet. Start a run, or skip one with stamina.</Text>
        )}
      </Panel>
    </View>
  );
}

const RunControls = memo(function RunControls({
  run,
  paused,
  stamina,
  hp,
  enemyName,
  hitMin,
  hitMax,
  onSkip,
  onStop,
}: {
  run: DungeonRunView;
  paused: boolean;
  stamina: number;
  hp: number;
  enemyName: string;
  /** What one enemy strike deals to the hero after defense (engine strikeRange). */
  hitMin: number;
  hitMax: number;
  onSkip: (run: number, maxCost: number) => void;
  onStop: () => void;
}) {
  const canSkip = stamina >= run.skipCost;
  const noHp = hp <= 0;
  return (
    <View style={styles.runBox}>
      <View style={styles.runLine} accessible accessibilityLabel={`Current run, ${formatClock(run.remainingMs)} left`}>
        <Text style={styles.runLabel}>Current run</Text>
        <Text style={styles.runTime}>{formatClock(run.remainingMs)}</Text>
      </View>
      <LiveBar fraction={run.fraction} remainingMs={run.remainingMs} paused={paused} color={colors.hp} style={styles.runBar} />
      <View style={styles.buttons}>
        <PixelButton
          label={`Skip (${run.skipCost} ⚡)`}
          onPress={() => onSkip(run.run, run.skipCost)}
          disabled={!canSkip}
          accessibilityLabel={`Skip this run for ${run.skipCost} stamina${noHp ? '. Certain loss, 0 HP' : ''}`}
          accessibilityHint={canSkip ? 'Fights now; the next run starts right after' : `Not enough stamina: you have ${stamina}`}
        />
        <PixelButton label="Stop" onPress={onStop} accessibilityHint="Asks first: the current run will be lost" />
      </View>
      {noHp ? (
        <Text style={styles.danger} accessibilityRole="alert">
          Certain loss — 0 HP
        </Text>
      ) : null}
      <Text style={styles.note}>
        Your HP {hp} · {enemyName} hits for {range(hitMin, hitMax)}
      </Text>
      {!canSkip ? <Text style={styles.note}>Not enough stamina to skip ({stamina}/{run.skipCost}).</Text> : null}
    </View>
  );
});

const LastFight = memo(function LastFight({ fight, onReplay }: { fight: FightRecord; onReplay: () => void }) {
  const r = fight.rewards;
  const items = Object.entries(r.items);
  const lost = Object.entries(r.itemsLost);
  const outcome = OUTCOME_LABELS[fight.endReason];
  const rewardText = fight.won
    ? [`+${r.heroXp} XP`, `+${r.gold} gold`, ...items.map(([id, n]) => `${itemIcon(id)} ${itemName(id)}${n > 1 ? ` ×${n}` : ''}`)].join(' · ')
    : 'No rewards';
  return (
    <View style={styles.lastBox}>
      <View
        accessible
        accessibilityLabel={`${outcome} in ${fight.rounds} rounds. HP ${fight.heroHpStart} to ${fight.heroHpEnd}. ${rewardText}`}
      >
        <Text style={[styles.outcome, fight.won ? styles.win : styles.loss]}>{outcome}</Text>
        <Text style={styles.note}>
          {fight.rounds} {fight.rounds === 1 ? 'round' : 'rounds'} · HP {fight.heroHpStart} → {fight.heroHpEnd}
        </Text>
        <Text style={styles.rewards}>{rewardText}</Text>
        {lost.map(([id, n]) => (
          <Text key={id} style={styles.lost}>
            Inventory full: {n} {itemName(id)} lost
          </Text>
        ))}
      </View>
      <PixelButton label="Replay" icon="▶" onPress={onReplay} accessibilityLabel="Replay the last fight" />
    </View>
  );
});

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statLine}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 12, paddingBottom: 32 },
  paused: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold, marginBottom: 10 },

  stamina: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.stamina },
  hpRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  regen: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.skill },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    padding: 12,
    marginBottom: 10,
    backgroundColor: colors.parchment,
    borderWidth: 3,
    borderColor: colors.woodDark,
  },
  cardPressed: { backgroundColor: colors.parchmentDark },
  cardRunning: { borderColor: colors.gold },
  cardLocked: { backgroundColor: colors.parchmentDark, borderColor: colors.inkSoft, opacity: 0.75 },
  dimmed: { color: colors.inkSoft },
  lockLine: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  cardIcon: { fontSize: 32 },
  cardTitle: { fontFamily: fonts.title, fontSize: 26, color: colors.ink },
  cardLine: { fontFamily: fonts.body, fontSize: 14, color: colors.inkSoft },
  badge: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.skill },
  chevron: { fontFamily: fonts.bodyBold, fontSize: 28, color: colors.inkSoft },

  back: { minHeight: 44, justifyContent: 'center', marginBottom: 4 },
  backText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.gold },

  versus: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  side: { flex: 1 },
  sideTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink, marginBottom: 4 },
  vs: { fontFamily: fonts.title, fontSize: 24, color: colors.inkSoft, alignSelf: 'center' },
  subTitle: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.inkSoft, marginTop: 12, marginBottom: 2 },
  statLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: colors.parchmentDark,
  },
  statLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  statValue: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },

  startBox: { gap: 10, alignItems: 'center' },
  runBox: { gap: 8 },
  runLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  runLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  runTime: { fontFamily: fonts.bodyBold, fontSize: 22, color: colors.ink },
  runBar: { height: 14 },
  buttons: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 4 },
  note: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft, textAlign: 'center' },
  totals: { fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft, marginTop: 10, textAlign: 'center' },
  debugRow: { alignItems: 'center', marginTop: 8 },
  dangerRow: { marginTop: 10, alignItems: 'center', gap: 2 },
  dangerLabel: { fontFamily: fonts.bodyBold, fontSize: 16 },
  dangerEasy: { color: colors.skill },
  dangerRisky: { color: colors.goldDark },
  dangerDeadly: { color: colors.hp },

  lastBox: { gap: 10, alignItems: 'center' },
  outcome: { fontFamily: fonts.title, fontSize: 28, textAlign: 'center' },
  win: { color: colors.skill },
  loss: { color: colors.hp },
  rewards: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink, textAlign: 'center' },
  danger: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.hp, textAlign: 'center' },
  lost: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.hp, textAlign: 'center' },
});

const DANGER_STYLES: Record<DangerLevel, (typeof styles)[keyof typeof styles]> = {
  easy: styles.dangerEasy,
  risky: styles.dangerRisky,
  deadly: styles.dangerDeadly,
};
