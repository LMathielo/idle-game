// Village → Dungeon: full-screen modal with the dungeon list (a header per tier: its five stages, then its boss) and, inside
// the same modal, the detail view (enemy, hero, danger hint, start / skip / stop, the live fight, last fight + replay), or the
// boss's detail (its stats and abilities, rewards, Enter for stamina, the live fight, last fight + gear reveal). Rules stay in
// the engine: this file only reads selectors (dungeonRunView, dungeonUnlockView, dangerHint, bossEntryView, bossRunView,
// bossDangerHint, hpView, staminaView, getDerivedStats) and dispatches commands. Locked dungeons and bosses can't be opened;
// the engine refuses them too.
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, type HostInstance, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGameSnapshot } from '../../client/GameProvider';
import {
  BOSSES,
  bossDangerHint,
  bossEntryView,
  type BossId,
  bossRunView,
  type BossRunView,
  bossTotals,
  bossUnlockView,
  COMBAT,
  COMBAT_SKILLS,
  type DangerLevel,
  dangerHint,
  DEV_TOOLS_ENABLED,
  type DungeonId,
  type DungeonOrBossId,
  DUNGEON_TIERS,
  DUNGEONS,
  dungeonRunView,
  type DungeonRunView,
  dungeonTotals,
  dungeonUnlockView,
  ENEMIES,
  type EnemyId,
  type FightRecord,
  type GameState,
  getDerivedStats,
  hpView,
  isBossId,
  rarityOf,
  searchMsFor,
  staminaView,
  strikeRange,
} from '../../engine';
import { colors, fonts, rarityColors } from '../../theme';
import { EnemySprite, GameIcon, HeroPortrait, IconText, ItemIcon } from '../art/Sprites';
import { bpPercent, critMultText, formatClock, formatNumber, formatRate, itemName } from '../format';
import { LiveBar } from '../LiveBar';
import { ModalScreen } from '../ModalScreen';
import { Bar, Panel } from '../Panel';
import { PixelButton } from '../PixelButton';
import { type AnchorRect, InfoPopover, measureAnchor, PopoverRow, PopoverText } from '../ui/InfoPopover';
import { useCommand } from '../ui/useCommand';
import { confirmCancelRun, confirmLeaveRun } from './confirmCancelRun';
import { FightReplay } from './FightReplay';
import { LiveFight } from './LiveFight';
import { fightLimitMs, outcomeLabel } from './outcome';
import { RevealSheet } from '../items/RevealSheet';
import { RARITY_COLOR_NAMES } from '../items/itemInfo';

const range = (min: number, max: number) => (min === max ? `${min}` : `${min}–${max}`);
const percent = (p: number) => `${Math.round(p * 100)}%`;


export function DungeonModal() {
  const { state, clockPaused } = useGameSnapshot();
  const running: DungeonOrBossId | null =
    state.activity?.kind === 'dungeon' ? state.activity.dungeonId : state.activity?.kind === 'boss' ? state.activity.bossId : null;
  const [selected, setSelected] = useState<DungeonOrBossId | null>(running);
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
        <IconText icon="stamina" style={styles.stamina} accessibilityLabel={`Stamina ${stamina.current} of ${stamina.max}`}>
          {stamina.current}/{stamina.max}
        </IconText>
      }
      headerBelow={<HpRow hp={hp.hp} maxHp={hp.maxHp} regenPerMin={hp.regenPerMin} />}
    >
      <ScrollView contentContainerStyle={styles.content}>
        {clockPaused ? <Text style={styles.paused}>Paused: your device clock moved back. Runs and regen wait until it catches up.</Text> : null}
        {selected && isBossId(selected) ? (
          <BossDetail id={selected} state={state} running={running === selected} paused={clockPaused} onBack={() => setSelected(null)} />
        ) : selected ? (
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
    <View style={styles.hpRow} accessible accessibilityLabel={`Hero HP ${hp} of ${maxHp}, regenerates ${formatRate(regenPerMin)} per minute`}>
      <View style={styles.flex}>
        <Bar value={hp} max={maxHp} color={colors.hp} label={`HP ${formatNumber(hp)} / ${formatNumber(maxHp)}`} />
      </View>
      <Text style={styles.regen}>+{formatRate(regenPerMin)}/min</Text>
    </View>
  );
});

// ---------- list ----------

const DANGER_LABELS: Record<DangerLevel, string> = { easy: 'Easy', tough: 'Tough', deadly: 'Deadly' };

/** "Win 10× in Rat Cellar · 7/10" */
function requirementText(req: { dungeonId: DungeonId; wins: number }, progress: number): string {
  return `Win ${req.wins}× in ${DUNGEONS[req.dungeonId].name} · ${formatNumber(progress)}/${formatNumber(req.wins)}`;
}

/** The boss's locked line: "Troll Bridge wins 12/50". */
function bossRequirementText(req: { dungeonId: DungeonId; wins: number }, progress: number): string {
  return `${DUNGEONS[req.dungeonId].name} wins ${formatNumber(progress)}/${formatNumber(req.wins)}`;
}

/** The locked row whose info box is open, anchored on its card. */
type LockedInfoTarget = { id: DungeonOrBossId; anchor: AnchorRect };

function DungeonList({ state, running, onPick }: { state: GameState; running: DungeonOrBossId | null; onPick: (id: DungeonOrBossId) => void }) {
  const [info, setInfo] = useState<LockedInfoTarget | null>(null);
  const explain = useCallback((id: DungeonOrBossId, node: HostInstance | null) => {
    void measureAnchor(node).then((anchor) => anchor && setInfo({ id, anchor }));
  }, []);
  const closeInfo = useCallback(() => setInfo(null), []);
  const infoBoss = info && isBossId(info.id) ? info.id : null;
  const infoStage = info && !isBossId(info.id) ? info.id : null;
  const infoUnlock = infoStage ? dungeonUnlockView(state, infoStage) : null;
  const infoBossUnlock = infoBoss ? bossUnlockView(state, infoBoss) : null;
  return (
    <View>
      {DUNGEON_TIERS.map((tier) => (
        <View key={tier.tier}>
          <Text style={styles.tierHeader} accessibilityRole="header">
            {tier.name}
          </Text>
          {tier.stages.map((id) => {
            const unlock = dungeonUnlockView(state, id);
            if (!unlock.unlocked && unlock.requirement) {
              const d = DUNGEONS[id];
              return (
                <LockedCard
                  key={id}
                  id={id}
                  title={`Stage ${d.stage} · ${d.name}`}
                  subtitle={ENEMIES[d.enemyId].name}
                  requirement={requirementText(unlock.requirement, unlock.progress)}
                  onExplain={explain}
                />
              );
            }
            return (
              <DungeonCard
                key={id}
                id={id}
                searchMs={searchMsFor(id, state)}
                wins={dungeonTotals(state, id).wins}
                running={running === id}
                onPick={onPick}
              />
            );
          })}
          {tier.boss ? <BossRow key={tier.boss} bossId={tier.boss} state={state} running={running === tier.boss} onPick={onPick} onExplain={explain} /> : null}
        </View>
      ))}
      {info && infoStage && infoUnlock && !infoUnlock.unlocked && infoUnlock.requirement ? (
        <LockedInfo id={infoStage} anchor={info.anchor} requirement={requirementText(infoUnlock.requirement, infoUnlock.progress)} onClose={closeInfo} />
      ) : null}
      {info && infoBoss && infoBossUnlock && !infoBossUnlock.unlocked ? (
        <BossLockedInfo bossId={infoBoss} anchor={info.anchor} requirement={bossRequirementText(infoBossUnlock.requirement, infoBossUnlock.progress)} onClose={closeInfo} />
      ) : null}
    </View>
  );
}

/** What a locked dungeon holds and what opens it (InfoPopover, anchored on its card). */
function LockedInfo({ id, anchor, requirement, onClose }: { id: DungeonId; anchor: AnchorRect; requirement: string; onClose: () => void }) {
  const d = DUNGEONS[id];
  const enemy = ENEMIES[d.enemyId];
  return (
    <InfoPopover anchor={anchor} onClose={onClose} title={d.name} icon={<GameIcon name="locked" size={32} />} subtitle={`Tier ${d.tier} · Stage ${d.stage} · locked`}>
      <PopoverText tone="gold">{requirement}</PopoverText>
      <PopoverRow label="Enemy" value={enemy.name} />
      <PopoverRow label="Enemy HP / damage" value={`${enemy.hp} / ${range(enemy.damage.min, enemy.damage.max)}`} />
      <PopoverRow icon={<GameIcon name="hero_xp" />} label="Hero XP per win" value={`+${d.rewards.heroXp}`} />
      <PopoverRow icon={<GameIcon name="gold" />} label="Gold per win" value={range(d.rewards.gold.min, d.rewards.gold.max)} />
      <PopoverText tone="note">Only wins count toward the unlock; it is permanent once reached.</PopoverText>
    </InfoPopover>
  );
}

/** What the locked boss is and what opens it. */
function BossLockedInfo({ bossId, anchor, requirement, onClose }: { bossId: BossId; anchor: AnchorRect; requirement: string; onClose: () => void }) {
  const boss = BOSSES[bossId];
  const enemy = ENEMIES[boss.enemyId];
  return (
    <InfoPopover anchor={anchor} onClose={onClose} title={boss.name} icon={<GameIcon name="locked" size={32} />} subtitle={`Tier ${boss.tier} boss · locked`}>
      <PopoverText tone="gold">{requirement}</PopoverText>
      <PopoverRow label="Boss HP / damage" value={`${formatNumber(enemy.hp)} / ${range(enemy.damage.min, enemy.damage.max)}`} />
      <PopoverRow icon={<GameIcon name="stamina" />} label="Entry cost" value={`${boss.entryStamina} stamina`} />
      <PopoverRow icon={<GameIcon name="hero_xp" />} label="Hero XP per win" value={`+${formatNumber(boss.rewards.heroXp)}`} />
      <PopoverRow icon={<GameIcon name="gold" />} label="Gold per win" value={range(boss.rewards.gold.min, boss.rewards.gold.max)} />
      <PopoverText tone="note">Only Troll Bridge wins count toward the unlock; it is permanent once reached.</PopoverText>
    </InfoPopover>
  );
}

const DungeonCard = memo(function DungeonCard({
  id,
  searchMs,
  wins,
  running,
  onPick,
}: {
  id: DungeonId;
  searchMs: number;
  wins: number;
  running: boolean;
  onPick: (id: DungeonOrBossId) => void;
}) {
  const d = DUNGEONS[id];
  const enemy = ENEMIES[d.enemyId];
  const line = `${enemy.name} · ${formatClock(searchMs)} search`;
  const title = `Stage ${d.stage} · ${d.name}`;
  return (
    <Pressable
      onPress={() => onPick(id)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${line}, ${wins} wins${running ? ', running' : ''}`}
      accessibilityHint="Opens the dungeon"
    >
      {({ pressed }) => (
        <View style={[styles.card, pressed && styles.cardPressed, running && styles.cardRunning]}>
          <View style={styles.cardIcon}>
            <EnemySprite enemyId={d.enemyId} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{title}</Text>
            <Text style={styles.cardLine}>{line}</Text>
            <Text style={styles.cardLine}>Wins: {formatNumber(wins)}</Text>
          </View>
          {running ? <Text style={styles.badge}>Running</Text> : <Text style={styles.chevron}>›</Text>}
        </View>
      )}
    </Pressable>
  );
});

/** The tier's boss row: locked ("Troll Bridge wins 12/50", a tap explains) or a card that opens the boss. */
const BossRow = memo(function BossRow({
  bossId,
  state,
  running,
  onPick,
  onExplain,
}: {
  bossId: BossId;
  state: GameState;
  running: boolean;
  onPick: (id: DungeonOrBossId) => void;
  onExplain: (id: DungeonOrBossId, node: HostInstance | null) => void;
}) {
  const boss = BOSSES[bossId];
  const unlock = bossUnlockView(state, bossId);
  const title = `Boss · ${boss.name}`;
  if (!unlock.unlocked) {
    return <LockedCard id={bossId} title={title} subtitle={`${boss.entryStamina} stamina`} requirement={bossRequirementText(unlock.requirement, unlock.progress)} onExplain={onExplain} boss />;
  }
  const totals = bossTotals(state, bossId);
  const line = `${boss.entryStamina} stamina · one live fight`;
  return (
    <Pressable
      onPress={() => onPick(bossId)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${line}, ${totals.wins} wins${running ? ', fighting' : ''}`}
      accessibilityHint="Opens the boss"
    >
      {({ pressed }) => (
        <View style={[styles.card, styles.cardBoss, pressed && styles.cardPressed, running && styles.cardRunning]}>
          <View style={styles.cardIcon}>
            <EnemySprite enemyId={boss.enemyId} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{title}</Text>
            <Text style={styles.cardLine}>{line}</Text>
            <Text style={styles.cardLine}>Wins: {formatNumber(totals.wins)}</Text>
          </View>
          {running ? <Text style={styles.badge}>Fighting</Text> : <Text style={styles.chevron}>›</Text>}
        </View>
      )}
    </Pressable>
  );
});

/** Dimmed, never opens the detail: a tap opens an info box with what unlocks it. */
const LockedCard = memo(function LockedCard({
  id,
  title,
  subtitle,
  requirement,
  onExplain,
  boss,
}: {
  id: DungeonOrBossId;
  title: string;
  subtitle: string;
  requirement: string;
  onExplain: (id: DungeonOrBossId, node: HostInstance | null) => void;
  boss?: boolean;
}) {
  const ref = useRef<HostInstance>(null);
  const explain = useCallback(() => onExplain(id, ref.current), [onExplain, id]);
  return (
    <Pressable
      ref={ref}
      onPress={explain}
      accessibilityRole="button"
      accessibilityLabel={`${title}, locked, ${subtitle}. ${requirement}`}
      accessibilityHint="Shows what unlocks it"
    >
      {({ pressed }) => (
        <View style={[styles.card, boss && styles.cardBoss, styles.cardLocked, pressed && styles.cardPressed]}>
          <View style={styles.cardIcon}>
            <GameIcon name="locked" size={32} style={styles.iconDimmed} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, styles.dimmed]}>{title}</Text>
            <Text style={styles.cardLine}>{subtitle}</Text>
            <Text style={styles.lockLine}>{requirement}</Text>
          </View>
        </View>
      )}
    </Pressable>
  );
});

/** The enemy's stats beside the hero's current ones (shared by a stage's and a boss's detail). */
function Versus({ enemyId, state, stats, hp }: { enemyId: EnemyId; state: GameState; stats: ReturnType<typeof getDerivedStats>; hp: { hp: number; maxHp: number } }) {
  const enemy = ENEMIES[enemyId];
  return (
        <View style={styles.versus}>
          <View
            style={styles.side}
            accessible
            accessibilityLabel={`${enemy.name}: HP ${enemy.hp}, damage ${range(enemy.damage.min, enemy.damage.max)}, armor ${enemy.armor}, magic resist ${enemy.magicResist}`}
          >
            <IconText image={<EnemySprite enemyId={enemyId} />} style={styles.sideTitle} rowStyle={styles.sideHead}>
              {enemy.name}
            </IconText>
            <StatLine label="HP" value={`${enemy.hp}`} />
            <StatLine label="Damage" value={range(enemy.damage.min, enemy.damage.max)} />
            <StatLine label="Armor" value={`${enemy.armor}`} />
            <StatLine label="Magic resist" value={`${enemy.magicResist}`} />
          </View>
          <Text style={styles.vs}>vs</Text>
          <View
            style={styles.side}
            accessible
            accessibilityLabel={`${state.character.name}: HP ${hp.hp} of ${hp.maxHp}, damage ${range(stats.damage.min, stats.damage.max)}, magic damage ${stats.magicDamage.value}, armor ${stats.armor.value}, magic resist ${stats.magicResist.value}, crit chance ${bpPercent(stats.critChanceBp.value)}`}
          >
            <IconText image={<HeroPortrait size={32} />} style={styles.sideTitle} rowStyle={styles.sideHead}>
              {state.character.name}
            </IconText>
            <StatLine label="HP" value={`${hp.hp}/${hp.maxHp}`} />
            <StatLine label="Damage" value={range(stats.damage.min, stats.damage.max)} />
            <StatLine label="Magic damage" value={`${stats.magicDamage.value}`} />
            <StatLine label="Armor" value={`${stats.armor.value}`} />
            <StatLine label="Magic resist" value={`${stats.magicResist.value}`} />
            <StatLine label="Crit" value={`${bpPercent(stats.critChanceBp.value)} · ${critMultText(stats.critMultiplierBp.value)}`} />
          </View>
        </View>
  );
}

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
  const d = DUNGEONS[id];
  const enemy = ENEMIES[d.enemyId];
  const { level, attributes, spentPoints, equipment } = state.character;
  const { training } = state;
  const stats = useMemo(() => getDerivedStats({ character: { level, attributes, spentPoints, equipment }, training }), [level, attributes, spentPoints, equipment, training]);
  const danger = useMemo(
    () => dangerHint({ character: { level, attributes, spentPoints, equipment }, training }, id),
    [level, attributes, spentPoints, equipment, training, id],
  );
  const searchMs = searchMsFor(id, state);
  const unlock = dungeonUnlockView(state, id);
  const totals = dungeonTotals(state, id);
  const hp = hpView(state);
  const run = running ? dungeonRunView(state) : null;
  const [replay, setReplay] = useState<FightRecord | null>(null);
  const [replayKey, setReplayKey] = useState(0);
  const lastFight = state.dungeon.lastFight?.dungeonId === id ? state.dungeon.lastFight : null;

  /**
   * One command at a time; a double tap never sends two. Engine refusals are shown in a GameDialog, except
   * RUN_CHANGED / FIGHT_IN_PROGRESS: the search ended (or its cost changed) under the player's finger. Nothing was
   * spent; the screen already shows the fight or the new cost.
   */
  const { send, run: runCall, dialog, client } = useCommand({ silentCodes: ['RUN_CHANGED', 'FIGHT_IN_PROGRESS'] });

  const start = useCallback(async () => {
    // A boss fight in progress is fled by starting anything else (a loss, HP to 0): ask first.
    if (!(await confirmLeaveRun(dialog, `Start ${d.name}`, client.getState().activity?.kind === 'boss' ? client.getState().activity : null))) return;
    await send({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: id });
  }, [client, d.name, dialog, id, send]);
  /**
   * Hold-to-repeat search skip. Each tick names the run and the cost on screen right now (live state), so the engine
   * never charges more or skips a later run; the repeat ends by itself when the fight starts (no skip in a fight) or
   * stamina runs out.
   */
  const skip = useCallback(
    (repeat: boolean) => {
      const live = dungeonRunView(client.getState());
      if (!live || live.skipCost === null || client.getState().stamina.current < live.skipCost) return Promise.resolve(false);
      return send({ type: 'SKIP_DUNGEON_RUN', run: live.run, maxCost: live.skipCost }, { quiet: repeat });
    },
    [client, send],
  );
  const hits = strikeRange(enemy.damage, stats.armor.value);
  const stop = useCallback(async () => {
    if (await confirmCancelRun(dialog, 'Stop')) await send({ type: 'STOP_ACTIVITY' });
  }, [dialog, send]);
  const flee = useCallback(async () => {
    if (await confirmCancelRun(dialog, 'Flee', true)) await send({ type: 'STOP_ACTIVITY' });
  }, [dialog, send]);
  const otherActivity = state.activity && !running ? state.activity.kind : null;
  /** Debug, hold to repeat. */
  const addWins = useCallback(({ repeat }: { repeat: boolean }) => runCall(() => client.debug.addDungeonWins(id, 10), { quiet: repeat }), [client, id, runCall]);

  return (
    <View>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to all dungeons" hitSlop={8} style={styles.back}>
        <Text style={styles.backText}>‹ All dungeons</Text>
      </Pressable>

      <Panel title={`Stage ${d.stage} · ${d.name} · Tier ${d.tier}`}>
        <Versus enemyId={d.enemyId} state={state} stats={stats} hp={hp} />

        <View
          style={styles.dangerRow}
          accessible
          accessibilityLabel={`Danger: ${DANGER_LABELS[danger.level]}. About ${danger.expectedHpLoss} HP lost per fight, ${danger.percent}% of your max HP`}
        >
          <Text style={[styles.dangerLabel, DANGER_STYLES[danger.level]]}>Danger: {DANGER_LABELS[danger.level]}</Text>
          <Text style={styles.note}>
            ~{formatNumber(danger.expectedHpLoss)} HP lost per fight ({danger.percent}% of max)
          </Text>
          <Text style={styles.note}>
            Your average strike: {formatNumber(Math.round(danger.heroAvg * 10) / 10)}
            {danger.heroMagicAvg > 0 ? ` (${formatNumber(danger.heroMagicAvg)} magic)` : ''}
            {danger.critChanceBp > 0 ? `, crits ${bpPercent(danger.critChanceBp)} for ${critMultText(danger.critMultBp)}` : ''}
          </Text>
        </View>

        <Text style={styles.subTitle}>Loot (win only)</Text>
        <View
          accessible
          accessibilityLabel={`Loot on a win: ${d.rewards.heroXp} hero XP, ${range(d.rewards.gold.min, d.rewards.gold.max)} gold, ${d.rewards.drops
            .map((x) => `${itemName(x.itemId)} ${percent(x.chance)} chance`)
            .join(', ')}`}
        >
          <StatLine icon={<GameIcon name="hero_xp" />} label="Hero XP" value={`+${d.rewards.heroXp}`} />
          <StatLine icon={<GameIcon name="gold" />} label="Gold" value={range(d.rewards.gold.min, d.rewards.gold.max)} />
          {d.rewards.drops.map((x) => (
            <StatLine key={x.itemId} icon={<ItemIcon defId={x.itemId} size={20} />} label={itemName(x.itemId)} value={percent(x.chance)} />
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
            heroName={state.character.name}
            enemyName={enemy.name}
            enemyId={d.enemyId}
            hitMin={hits.min}
            hitMax={hits.max}
            onSkip={skip}
            onStop={stop}
            onFlee={flee}
          />
        ) : !unlock.unlocked && unlock.requirement ? (
          <IconText icon="locked" style={styles.note} rowStyle={styles.centerRow}>
            Locked. {requirementText(unlock.requirement, unlock.progress)}.
          </IconText>
        ) : (
          <View style={styles.startBox}>
            <Text style={styles.note}>
              Runs repeat on their own, also while the app is closed (up to {formatNumber(state.offline.capMs / 3_600_000)}h). Each run is a{' '}
              {formatClock(searchMs)} search for an opponent, then a live fight (up to {formatNumber(COMBAT.maxFightMs / 1000)}s). Waiting is free.
            </Text>
            {otherActivity === 'woodcutting' ? <Text style={styles.note}>Starting stops woodcutting (your logs are kept).</Text> : null}
            {otherActivity === 'training' ? <Text style={styles.note}>Starting pauses training (your training XP is kept).</Text> : null}
            {otherActivity === 'boss' ? <Text style={styles.note}>Starting flees the boss fight: it counts as a loss.</Text> : null}
            <PixelButton label="Start" icon="fight" onPress={start} accessibilityLabel={`Start ${d.name} runs`} />
          </View>
        )}
        <Text style={styles.totals}>
          Lifetime here: {formatNumber(totals.runs)} runs · {formatNumber(totals.wins)} wins · {formatNumber(totals.losses)} losses
        </Text>
        {DEV_TOOLS_ENABLED && unlock.unlocked ? (
          <View style={styles.debugRow}>
            <PixelButton label="+10 wins (debug)" repeat={addWins} accessibilityHint="Debug: adds 10 wins here, to test unlocks. Hold to repeat" />
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

function BossDetail({ id, state, running, paused, onBack }: { id: BossId; state: GameState; running: boolean; paused: boolean; onBack: () => void }) {
  const boss = BOSSES[id];
  const enemy = ENEMIES[boss.enemyId];
  const skill = COMBAT_SKILLS.heavy_bash;
  const { level, attributes, spentPoints, equipment } = state.character;
  const { training } = state;
  const input = useMemo(() => ({ character: { level, attributes, spentPoints, equipment }, training }), [level, attributes, spentPoints, equipment, training]);
  const stats = useMemo(() => getDerivedStats(input), [input]);
  const danger = useMemo(() => bossDangerHint(input, id), [input, id]);
  const entry = bossEntryView(state, id);
  const totals = bossTotals(state, id);
  const hp = hpView(state);
  const run: BossRunView | null = running ? bossRunView(state) : null;
  const [replay, setReplay] = useState<FightRecord | null>(null);
  const [replayKey, setReplayKey] = useState(0);
  const lastFight = state.dungeon.lastFight?.dungeonId === id ? state.dungeon.lastFight : null;
  const dropped = lastFight?.won ? lastFight.rewards.gear : undefined;
  const gear: DroppedGear | null = dropped ? { ...dropped, inBag: state.inventory.items.some((i) => i.id === dropped.itemId) } : null;
  const limitS = fightLimitMs(id) / 1000;
  const regenPerSec = Math.floor((enemy.hp * (enemy.regenBpPerSec ?? 0)) / 10_000);
  const regenPct = (enemy.regenBpPerSec ?? 0) / 100;

  // Entering and fleeing: one command at a time. FIGHT_IN_PROGRESS only means the screen was stale (a second tap).
  const { send, dialog, client } = useCommand({ silentCodes: ['FIGHT_IN_PROGRESS'] });
  const enter = useCallback(async () => {
    const live = client.getState();
    const view = bossEntryView(live, id);
    if (view.block) return;
    const a = live.activity;
    const lines = [`It costs ${view.cost} stamina, not refunded if you lose or flee. One fight, no repeat: it plays out live (also while the app is closed) and you are idle after it.`];
    if (a?.kind === 'woodcutting') lines.push('Entering stops woodcutting (your logs are kept).');
    else if (a?.kind === 'mining') lines.push('Entering stops mining (your ore is kept).');
    else if (a?.kind === 'training') lines.push('Entering pauses training (your training XP is kept).');
    else if (a?.kind === 'dungeon') lines.push('Entering cancels the dungeon search (it gives no rewards). Finished runs are kept.');
    const max = getDerivedStats(live).maxHp.value;
    if (view.hpBelowHalf) lines.unshift(`Your HP is below half (${live.character.hp}/${max}). A loss costs all of it.`);
    const ok = await dialog.confirm({
      title: view.hpBelowHalf ? 'Enter at low HP?' : `Enter the ${boss.name}?`,
      message: lines.join('\n\n'),
      confirmLabel: 'Enter',
      cancelLabel: 'Not now',
      destructive: view.hpBelowHalf,
    });
    if (ok) await send({ type: 'ENTER_BOSS', bossId: id, maxCost: view.cost });
  }, [boss.name, client, dialog, id, send]);
  const flee = useCallback(async () => {
    if (await confirmCancelRun(dialog, 'Flee', true, id)) await send({ type: 'STOP_ACTIVITY' });
  }, [dialog, id, send]);

  // The reveal: a win that dropped gear, seen as it happens, opens the piece's popover with Equip (like crafting's Done).
  const [reveal, setReveal] = useState<{ itemId: string; anchor: AnchorRect } | null>(null);
  const lastBoxRef = useRef<HostInstance>(null);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running && lastFight?.won && lastFight.rewards.gear) {
      const itemId = lastFight.rewards.gear.itemId;
      void measureAnchor(lastBoxRef.current).then((anchor) => anchor && setReveal({ itemId, anchor }));
    }
    wasRunning.current = running;
  }, [running, lastFight]);
  const showGear = useCallback(
    (node: HostInstance | null) => {
      if (!gear) return;
      void measureAnchor(node).then((anchor) => anchor && setReveal({ itemId: gear.itemId, anchor }));
    },
    [gear],
  );
  const closeReveal = useCallback(() => setReveal(null), []);

  const blockText =
    entry.block === 'stamina'
      ? `Not enough stamina (${state.stamina.current}/${entry.cost}).`
      : entry.block === 'no_hp'
        ? 'You have no HP left. Recover first.'
        : entry.block === 'fight'
          ? 'A dungeon fight is on. Finish or flee it first.'
          : null;
  const otherActivity = state.activity && !running ? state.activity.kind : null;
  const killText = !danger.canKill
    ? "Your damage can't beat its regen: you can't win."
    : danger.overLimit
      ? `Too slow: about ${Math.round(danger.fightMs / 1000)}s to kill, the limit is ${limitS}s.`
      : `Killing it takes about ${Math.round(danger.fightMs / 1000)}s (limit ${limitS}s).`;
  const rewards = boss.rewards;
  const gearOdds = rewards.gear.rarityWeights.map((w) => `${RARITY_COLOR_NAMES[w.value]} ${Math.round((w.weight * 100) / rewards.gear.rarityWeights.reduce((n, x) => n + x.weight, 0))}%`).join(', ');

  return (
    <View>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to all dungeons" hitSlop={8} style={styles.back}>
        <Text style={styles.backText}>‹ All dungeons</Text>
      </Pressable>

      <Panel title={`${boss.name} · Tier ${boss.tier} boss`}>
        <Versus enemyId={boss.enemyId} state={state} stats={stats} hp={hp} />

        <Text style={styles.subTitle}>Boss abilities</Text>
        <View accessible accessibilityLabel={`Regenerates ${regenPct} percent of its max HP a second, ${regenPerSec} HP. ${skill.name}: ${skill.description}. Time limit ${limitS} seconds.`}>
          <StatLine label="Regeneration" value={`${regenPct}%/s (${regenPerSec} HP)`} />
          <StatLine label={skill.name} value="Stuns" />
          <Text style={styles.abilityNote}>{skill.description}</Text>
          <StatLine label="Time limit" value={`${limitS}s`} />
        </View>

        <View
          style={styles.dangerRow}
          accessible
          accessibilityLabel={`Danger: ${DANGER_LABELS[danger.level]}. ${killText} About ${danger.expectedHpLoss} HP lost, ${danger.percent}% of your max HP`}
        >
          <Text style={[styles.dangerLabel, DANGER_STYLES[danger.level]]}>Danger: {DANGER_LABELS[danger.level]}</Text>
          <Text style={styles.note}>{killText}</Text>
          <Text style={styles.note}>
            ~{formatNumber(danger.expectedHpLoss)} HP lost ({danger.percent}% of max), {skill.name} included
          </Text>
          <Text style={styles.note}>
            Your average strike: {formatNumber(Math.round(danger.heroAvg * 10) / 10)}. It heals {regenPerSec} HP a second and {skill.name} stuns you {danger.stunChancePercent}% of the time for {danger.stunStrikes} strikes.
          </Text>
        </View>

        <Text style={styles.subTitle}>Rewards (win only)</Text>
        <View
          accessible
          accessibilityLabel={`Rewards on a win: ${rewards.heroXp} hero XP, ${range(rewards.gold.min, rewards.gold.max)} gold, ${percent(rewards.gear.chance)} chance of an Iron gear piece, ${rewards.drops.map((x) => `${itemName(x.itemId)} ${percent(x.chance)} chance`).join(', ')}`}
        >
          <StatLine icon={<GameIcon name="hero_xp" />} label="Hero XP" value={`+${formatNumber(rewards.heroXp)}`} />
          <StatLine icon={<GameIcon name="gold" />} label="Gold" value={range(rewards.gold.min, rewards.gold.max)} />
          <StatLine label="Iron gear piece" value={percent(rewards.gear.chance)} />
          <Text style={styles.abilityNote}>
            Sword, helm, chestplate, shield, gloves or boots, equal odds. {gearOdds}; quality 0–{rewards.gear.quality.max}%.
          </Text>
          {rewards.drops.map((x) => (
            <StatLine key={x.itemId} icon={<ItemIcon defId={x.itemId} size={20} />} label={itemName(x.itemId)} value={percent(x.chance)} />
          ))}
        </View>
      </Panel>

      <Panel title="Fight">
        {run ? (
          <View style={styles.runBox}>
            <LiveFight fight={run.fight} heroName={state.character.name} enemyName={enemy.name} enemyId={boss.enemyId} paused={paused} />
            <View style={styles.buttons}>
              <PixelButton label="Flee (counts as loss)" onPress={flee} accessibilityHint={`Asks first: fleeing counts as a loss, drops your HP to 0 and the ${boss.entryStamina} stamina is not refunded`} />
            </View>
          </View>
        ) : !entry.unlock.unlocked ? (
          <IconText icon="locked" style={styles.note} rowStyle={styles.centerRow}>
            Locked. {bossRequirementText(entry.unlock.requirement, entry.unlock.progress)}.
          </IconText>
        ) : (
          <View style={styles.startBox}>
            <Text style={styles.note}>
              One fight per entry: the stamina is paid up front and is not refunded if you lose or flee. There is no search and no repeat. It plays out live, also while the app is closed, and you are idle after it. Potions work.
            </Text>
            {otherActivity === 'woodcutting' ? <Text style={styles.note}>Entering stops woodcutting (your logs are kept).</Text> : null}
            {otherActivity === 'mining' ? <Text style={styles.note}>Entering stops mining (your ore is kept).</Text> : null}
            {otherActivity === 'training' ? <Text style={styles.note}>Entering pauses training (your training XP is kept).</Text> : null}
            {otherActivity === 'dungeon' && entry.block !== 'fight' ? <Text style={styles.note}>Entering cancels the dungeon search (no rewards).</Text> : null}
            {entry.hpBelowHalf && entry.block !== 'no_hp' ? (
              <Text style={styles.danger} accessibilityRole="alert">
                Low HP: {hp.hp}/{hp.maxHp}
              </Text>
            ) : null}
            <PixelButton
              label="Enter"
              sublabel={`${entry.cost}`}
              sublabelIcon="stamina"
              onPress={enter}
              disabled={entry.block !== null}
              accessibilityLabel={`Enter the ${boss.name} for ${entry.cost} stamina`}
              accessibilityHint={blockText ?? `Asks first. ${entry.cost} stamina, not refunded if you lose or flee`}
            />
            {blockText ? <Text style={styles.note}>{blockText}</Text> : null}
          </View>
        )}
        <Text style={styles.totals}>
          Lifetime here: {formatNumber(totals.runs)} fights · {formatNumber(totals.wins)} wins · {formatNumber(totals.losses)} losses
        </Text>
      </Panel>

      <Panel title="Last fight">
        {replay ? (
          <FightReplay key={replayKey} fight={replay} heroName={state.character.name} enemyName={enemy.name} onClose={() => setReplay(null)} />
        ) : lastFight ? (
          <View ref={lastBoxRef} collapsable={false}>
            <LastFight
              fight={lastFight}
              gear={gear}
              onShowGear={showGear}
              onReplay={() => {
                setReplayKey((k) => k + 1);
                setReplay(lastFight);
              }}
            />
          </View>
        ) : (
          <Text style={styles.note}>No fight yet.</Text>
        )}
      </Panel>
      {reveal ? <RevealSheet key={reveal.itemId} itemId={reveal.itemId} anchor={reveal.anchor} onClose={closeReveal} /> : null}
    </View>
  );
}

const RunControls = memo(function RunControls({
  run,
  paused,
  stamina,
  hp,
  heroName,
  enemyName,
  enemyId,
  hitMin,
  hitMax,
  onSkip,
  onStop,
  onFlee,
}: {
  run: DungeonRunView;
  paused: boolean;
  stamina: number;
  hp: number;
  heroName: string;
  enemyName: string;
  enemyId: EnemyId;
  /** What one enemy strike deals to the hero after armor (engine strikeRange). */
  hitMin: number;
  hitMax: number;
  /** Hold-to-repeat search skip (reads the live run each tick). */
  onSkip: (repeat: boolean) => Promise<boolean>;
  onStop: () => void;
  /** Stop during the fight: a forfeit (counts as a loss). */
  onFlee: () => void;
}) {
  if (run.fight) {
    // Fight phase: plays live, no skip.
    return (
      <View style={styles.runBox}>
        <LiveFight fight={run.fight} heroName={heroName} enemyName={enemyName} enemyId={enemyId} paused={paused} />
        <View style={styles.buttons}>
          <PixelButton label="Flee (counts as loss)" onPress={onFlee} accessibilityHint="Asks first: fleeing counts as a loss and drops your HP to 0" />
        </View>
      </View>
    );
  }
  const cost = run.skipCost ?? 0;
  const canSkip = run.skipCost !== null && stamina >= cost;
  const noHp = hp <= 0;
  return (
    <View style={styles.runBox}>
      <View style={styles.runLine} accessible accessibilityLabel={`Searching for an opponent, ${formatClock(run.remainingMs)} left`}>
        <Text style={styles.runLabel}>Searching for opponent…</Text>
        <Text style={styles.runTime}>{formatClock(run.remainingMs)}</Text>
      </View>
      <LiveBar fraction={run.fraction} remainingMs={run.remainingMs} paused={paused} color={colors.hp} style={styles.runBar} />
      <View style={styles.buttons}>
        <PixelButton
          label={`Skip (${cost})`}
          icon="stamina"
          repeat={({ repeat }) => onSkip(repeat)}
          disabled={!canSkip}
          accessibilityLabel={`Skip the search for ${cost} stamina${noHp ? '. Certain loss, 0 HP' : ''}`}
          accessibilityHint={canSkip ? 'The fight starts now and plays out live. No HP regen for the skipped time' : `Not enough stamina: you have ${stamina}`}
        />
        <PixelButton label="Stop" onPress={onStop} accessibilityHint="Asks first: the current search will be lost" />
      </View>
      {noHp ? (
        <Text style={styles.danger} accessibilityRole="alert">
          Certain loss — 0 HP
        </Text>
      ) : null}
      <Text style={styles.note}>
        Your HP {hp} · {enemyName} hits for {range(hitMin, hitMax)}
      </Text>
      <Text style={styles.note}>Skipping the search gives no HP regen for the skipped time.</Text>
      {!canSkip ? <Text style={styles.note}>Not enough stamina to skip ({stamina}/{cost}).</Text> : null}
    </View>
  );
});

/** The piece a boss win dropped, for the last-fight box: its colour and quality words, and whether it is still in the bag. */
type DroppedGear = { itemId: string; defId: string; rarity: ReturnType<typeof rarityOf>; quality: number; inBag: boolean };

const LastFight = memo(function LastFight({
  fight,
  onReplay,
  gear,
  onShowGear,
}: {
  fight: FightRecord;
  onReplay: () => void;
  gear?: DroppedGear | null;
  /** Opens the gear popover (with Equip) anchored on the given element. */
  onShowGear?: (node: HostInstance | null) => void;
}) {
  const r = fight.rewards;
  const items = Object.entries(r.items);
  const lost = Object.entries(r.itemsLost);
  const outcome = outcomeLabel(fight.endReason, fight.dungeonId);
  const seconds = Math.floor(fight.durationMs / 1000);
  const gearRef = useRef<HostInstance>(null);
  const rewardText = fight.won
    ? [`+${r.heroXp} XP`, `+${r.gold} gold`, ...items.map(([id, n]) => `${itemName(id)}${n > 1 ? ` ×${n}` : ''}`)].join(' · ')
    : 'No rewards';
  return (
    <View style={styles.lastBox}>
      <View
        accessible
        accessibilityLabel={`${outcome} after ${seconds} seconds. HP ${fight.heroHpStart} to ${fight.heroHpEnd}. ${rewardText}`}
      >
        <Text style={[styles.outcome, fight.won ? styles.win : styles.loss]}>{outcome}</Text>
        <Text style={styles.note}>
          {seconds}s · {fight.log.length} {fight.log.length === 1 ? 'strike' : 'strikes'} · HP {fight.heroHpStart} → {fight.heroHpEnd}
        </Text>
        <Text style={styles.rewards}>{rewardText}</Text>
        {lost.map(([id, n]) => (
          <Text key={id} style={styles.lost}>
            Lost: {n} {itemName(id)} (inventory full)
          </Text>
        ))}
      </View>
      {gear ? (
        <View ref={gearRef} collapsable={false} style={styles.gearBox}>
          <Text style={[styles.gearText, { color: rarityColors[gear.rarity] }]}>
            Drop: {itemName(gear.defId)} · {RARITY_COLOR_NAMES[gear.rarity]} · Quality {gear.quality}%
          </Text>
          {gear.inBag && onShowGear ? <PixelButton label="View" onPress={() => onShowGear(gearRef.current)} accessibilityLabel={`View the ${itemName(gear.defId)} you won`} /> : null}
        </View>
      ) : null}
      <PixelButton label="Replay" onPress={onReplay} accessibilityLabel="Replay the last fight" />
    </View>
  );
});

function StatLine({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <View style={styles.statLine}>
      {icon ? (
        <IconText image={icon} style={styles.statLabel} rowStyle={styles.flexShrink}>
          {label}
        </IconText>
      ) : (
        <Text style={styles.statLabel}>{label}</Text>
      )}
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  centerRow: { justifyContent: 'center' },
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
  cardBoss: { borderColor: colors.hp },
  tierHeader: { fontFamily: fonts.title, fontSize: 22, color: colors.ink, marginTop: 4, marginBottom: 8 },
  dimmed: { color: colors.inkSoft },
  lockLine: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  /** Fits the 48 pt troll; 32 pt enemies are centred, so every title lines up. */
  cardIcon: { width: 48, alignItems: 'center', justifyContent: 'center' },
  iconDimmed: { opacity: 0.6 },
  cardTitle: { fontFamily: fonts.title, fontSize: 20, color: colors.ink },
  cardLine: { fontFamily: fonts.body, fontSize: 14, color: colors.inkSoft },
  badge: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.skill },
  chevron: { fontFamily: fonts.bodyBold, fontSize: 28, color: colors.inkSoft },

  back: { minHeight: 44, justifyContent: 'center', marginBottom: 4 },
  backText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.gold },

  versus: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  side: { flex: 1 },
  sideHead: { marginBottom: 4, gap: 6, minHeight: 32 },
  sideTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  vs: { fontFamily: fonts.title, fontSize: 18, color: colors.inkSoft, alignSelf: 'center' },
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
  abilityNote: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft, paddingVertical: 3 },
  totals: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft, marginTop: 10, textAlign: 'center' },
  debugRow: { alignItems: 'center', marginTop: 8 },
  dangerRow: { marginTop: 10, alignItems: 'center', gap: 2 },
  dangerLabel: { fontFamily: fonts.bodyBold, fontSize: 16 },
  dangerEasy: { color: colors.dangerEasy },
  dangerTough: { color: colors.dangerTough },
  dangerDeadly: { color: colors.dangerDeadly },

  lastBox: { gap: 10, alignItems: 'center' },
  outcome: { fontFamily: fonts.title, fontSize: 22, textAlign: 'center' },
  win: { color: colors.skill },
  loss: { color: colors.hp },
  rewards: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink, textAlign: 'center' },
  danger: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.hp, textAlign: 'center' },
  lost: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.hp, textAlign: 'center' },
  gearBox: { alignItems: 'center', gap: 6 },
  gearText: { fontFamily: fonts.bodyBold, fontSize: 15, textAlign: 'center' },
});

const DANGER_STYLES: Record<DangerLevel, (typeof styles)[keyof typeof styles]> = {
  easy: styles.dangerEasy,
  tough: styles.dangerTough,
  deadly: styles.dangerDeadly,
};
