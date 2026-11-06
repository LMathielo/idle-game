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
  bossEnemyAt,
  bossEntryView,
  type BossId,
  bossRewardsAt,
  bossRunView,
  type BossRunView,
  bossTotals,
  bossUnlockView,
  COMBAT,
  COMBAT_SKILLS,
  type DangerLevel,
  dangerHint,
  DEV_TOOLS_ENABLED,
  type Difficulty,
  difficultyViews,
  type DungeonId,
  type DungeonOrBossId,
  DUNGEON_TIERS,
  DUNGEONS,
  dungeonRunView,
  type DungeonRunView,
  dungeonTotals,
  dungeonUnlockView,
  ENEMIES,
  type EnemyDef,
  type EnemyId,
  type FightRecord,
  type GameState,
  type MobVariant,
  getDerivedStats,
  hpView,
  isBossId,
  mobTypes,
  packSizeRange,
  rarityOf,
  scaleStat,
  searchMsFor,
  selectedDifficulty,
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
import { DifficultySelector } from './DifficultySelector';
import { difficultyName, fightLimitMs, outcomeLabel, packText } from './outcome';
import { RevealSheet } from '../items/RevealSheet';
import { RARITY_COLOR_NAMES } from '../items/itemInfo';

const range = (min: number, max: number) => (min === max ? `${min}` : `${min}–${max}`);
const percent = (p: number) => `${Math.round(p * 100)}%`;
/** A danger percent of max HP, capped for display: a hopeless pack can cost thousands of times your HP. */
const dangerPercent = (n: number) => (n > 999 ? '999%+' : `${n}%`);
const basisPercent = (bp: number) => `${Math.round(bp / 100)}%`;
/** "x2" / "x1.5" / "x12": a multiplier in basis points. */
const multText = (bp: number) => `x${Math.round(bp / 100) / 100}`;


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

/** Normal: "Win 10× in Rat Cellar · 7/10". Hard / Extreme (own chain, scaled count): "Hard Rat Cellar wins 3/20". */
function requirementText(req: { dungeonId: DungeonId; wins: number }, progress: number, difficulty: Difficulty = 'normal'): string {
  if (difficulty !== 'normal') return bossRequirementText(req, progress, difficulty); // "Hard Rat Cellar wins 3/20"
  return `Win ${req.wins}× in ${DUNGEONS[req.dungeonId].name} · ${formatNumber(progress)}/${formatNumber(req.wins)}`;
}

/** The boss's locked line: "Troll Bridge wins 12/50" (on Hard: "Hard Troll Bridge wins 12/100"). */
function bossRequirementText(req: { dungeonId: DungeonId; wins: number }, progress: number, difficulty: Difficulty = 'normal'): string {
  return `${difficulty === 'normal' ? '' : `${difficultyName(difficulty)} `}${DUNGEONS[req.dungeonId].name} wins ${formatNumber(progress)}/${formatNumber(req.wins)}`;
}

/** "Pack of 1-4" on Hard / Extreme, nothing on Normal. */
function packRangeText(difficulty: Difficulty): string | null {
  if (difficulty === 'normal') return null;
  const { min, max } = packSizeRange(difficulty);
  return `Pack of ${min}-${max}`;
}

/** The locked row whose info box is open, anchored on its card. */
type LockedInfoTarget = { id: DungeonOrBossId; anchor: AnchorRect };
/** The locked skull whose info box is open. */
type DifficultyInfoTarget = { tier: number; difficulty: Difficulty; anchor: AnchorRect };

function DungeonList({ state, running, onPick }: { state: GameState; running: DungeonOrBossId | null; onPick: (id: DungeonOrBossId) => void }) {
  const [info, setInfo] = useState<LockedInfoTarget | null>(null);
  const [diffInfo, setDiffInfo] = useState<DifficultyInfoTarget | null>(null);
  const { send, run: runCall, client } = useCommand();
  const explain = useCallback((id: DungeonOrBossId, node: HostInstance | null) => {
    void measureAnchor(node).then((anchor) => anchor && setInfo({ id, anchor }));
  }, []);
  const closeInfo = useCallback(() => setInfo(null), []);
  const closeDiffInfo = useCallback(() => setDiffInfo(null), []);
  const select = useCallback((tier: number, difficulty: Difficulty) => send({ type: 'SET_DUNGEON_DIFFICULTY', tier, difficulty }), [send]);
  const explainDifficulty = useCallback((tier: number, difficulty: Difficulty, node: HostInstance | null) => {
    void measureAnchor(node).then((anchor) => anchor && setDiffInfo({ tier, difficulty, anchor }));
  }, []);
  const infoBoss = info && isBossId(info.id) ? info.id : null;
  const infoStage = info && !isBossId(info.id) ? info.id : null;
  // The info boxes follow the difficulty of the tier they belong to.
  const infoTier = infoBoss ? BOSSES[infoBoss].tier : infoStage ? DUNGEONS[infoStage].tier : 1;
  const infoDifficulty = selectedDifficulty(state, infoTier);
  const infoUnlock = infoStage ? dungeonUnlockView(state, infoStage, infoDifficulty) : null;
  const infoBossUnlock = infoBoss ? bossUnlockView(state, infoBoss, infoDifficulty) : null;
  const diffViews = diffInfo ? difficultyViews(state, diffInfo.tier).find((v) => v.difficulty === diffInfo.difficulty) : null;
  return (
    <View>
      {DUNGEON_TIERS.map((tier) => {
        const difficulty = selectedDifficulty(state, tier.tier);
        return (
          <View key={tier.tier}>
            <Text style={styles.tierHeader} accessibilityRole="header">
              {tier.name}
            </Text>
            <DifficultySelector
              views={difficultyViews(state, tier.tier)}
              onSelect={(d) => void select(tier.tier, d)}
              onExplain={(d, node) => explainDifficulty(tier.tier, d, node)}
            />
            {tier.stages.map((id) => {
              const unlock = dungeonUnlockView(state, id, difficulty);
              if (!unlock.unlocked && unlock.requirement) {
                const d = DUNGEONS[id];
                return (
                  <LockedCard
                    key={id}
                    id={id}
                    title={`Stage ${d.stage} · ${d.name}`}
                    subtitle={ENEMIES[d.enemyId].name}
                    requirement={requirementText(unlock.requirement, unlock.progress, difficulty)}
                    onExplain={explain}
                  />
                );
              }
              return (
                <DungeonCard
                  key={id}
                  id={id}
                  difficulty={difficulty}
                  searchMs={searchMsFor(id, state)}
                  wins={dungeonTotals(state, id, difficulty).wins}
                  running={running === id}
                  onPick={onPick}
                />
              );
            })}
            {tier.boss ? <BossRow key={tier.boss} bossId={tier.boss} difficulty={difficulty} state={state} running={running === tier.boss} onPick={onPick} onExplain={explain} /> : null}
            {DEV_TOOLS_ENABLED && tier.boss ? (
              <View style={styles.debugRow}>
                <PixelButton
                  label={`+1 ${difficultyName(difficulty)} boss win (debug)`}
                  onPress={() => void runCall(() => client.debug.addBossWins(tier.boss!, 1, difficulty))}
                  accessibilityHint="Debug: adds one boss win on the selected difficulty. A Normal win opens Hard, a Hard win opens Extreme"
                />
              </View>
            ) : null}
          </View>
        );
      })}
      {info && infoStage && infoUnlock && !infoUnlock.unlocked && infoUnlock.requirement ? (
        <LockedInfo id={infoStage} difficulty={infoDifficulty} anchor={info.anchor} requirement={requirementText(infoUnlock.requirement, infoUnlock.progress, infoDifficulty)} onClose={closeInfo} />
      ) : null}
      {info && infoBoss && infoBossUnlock && !infoBossUnlock.unlocked ? (
        <BossLockedInfo
          bossId={infoBoss}
          difficulty={infoDifficulty}
          anchor={info.anchor}
          requirement={bossRequirementText(infoBossUnlock.requirement, infoBossUnlock.progress, infoDifficulty)}
          onClose={closeInfo}
        />
      ) : null}
      {diffInfo && diffViews && !diffViews.unlocked ? (
        <InfoPopover
          anchor={diffInfo.anchor}
          onClose={closeDiffInfo}
          title={`${diffViews.name} is locked`}
          icon={<GameIcon name="locked" size={32} />}
          subtitle={`${DUNGEON_TIERS.find((t) => t.tier === diffInfo.tier)?.name ?? 'Tier'} difficulty`}
        >
          <PopoverText tone="gold">{diffViews.lockReason ?? ''}</PopoverText>
          <PopoverText tone="note">The kill is permanent: once it counts, {diffViews.name} stays open.</PopoverText>
        </InfoPopover>
      ) : null}
    </View>
  );
}

/** What a locked dungeon holds and what opens it (InfoPopover, anchored on its card). Stats are the stage's Normal enemy; a pack on Hard / Extreme is the same enemy scaled. */
function LockedInfo({ id, difficulty, anchor, requirement, onClose }: { id: DungeonId; difficulty: Difficulty; anchor: AnchorRect; requirement: string; onClose: () => void }) {
  const d = DUNGEONS[id];
  const enemy = ENEMIES[d.enemyId];
  const pack = packRangeText(difficulty);
  return (
    <InfoPopover anchor={anchor} onClose={onClose} title={d.name} icon={<GameIcon name="locked" size={32} />} subtitle={`Tier ${d.tier} · Stage ${d.stage} · locked`}>
      <PopoverText tone="gold">{requirement}</PopoverText>
      <PopoverRow label="Enemy" value={enemy.name} />
      <PopoverRow label="Enemy HP / damage (Normal)" value={`${enemy.hp} / ${range(enemy.damage.min, enemy.damage.max)}`} />
      <PopoverRow icon={<GameIcon name="hero_xp" />} label="Hero XP per win (Normal)" value={`+${d.rewards.heroXp}`} />
      <PopoverRow icon={<GameIcon name="gold" />} label="Gold per win (Normal)" value={range(d.rewards.gold.min, d.rewards.gold.max)} />
      <PopoverText tone="note">
        {pack ? `On ${difficultyName(difficulty)} it opens with its Normal stage and sends a ${pack.toLowerCase()}. ` : ''}Only wins on Normal count toward the unlock; it is permanent once reached.
      </PopoverText>
    </InfoPopover>
  );
}

/** What the locked boss is and what opens it, as it is on the selected difficulty. */
function BossLockedInfo({ bossId, difficulty, anchor, requirement, onClose }: { bossId: BossId; difficulty: Difficulty; anchor: AnchorRect; requirement: string; onClose: () => void }) {
  const boss = BOSSES[bossId];
  const enemy = bossEnemyAt(bossId, difficulty);
  const rewards = bossRewardsAt(bossId, difficulty);
  return (
    <InfoPopover anchor={anchor} onClose={onClose} title={boss.name} icon={<GameIcon name="locked" size={32} />} subtitle={`Tier ${boss.tier} boss · ${difficultyName(difficulty)} · locked`}>
      <PopoverText tone="gold">{requirement}</PopoverText>
      <PopoverRow label="Boss HP / damage" value={`${formatNumber(enemy.hp)} / ${range(enemy.damage.min, enemy.damage.max)}`} />
      <PopoverRow icon={<GameIcon name="stamina" />} label="Entry cost" value={`${boss.entryStamina} stamina`} />
      <PopoverRow icon={<GameIcon name="hero_xp" />} label="Hero XP per win" value={`+${formatNumber(rewards.heroXp)}`} />
      <PopoverRow icon={<GameIcon name="gold" />} label="Gold per win" value={range(rewards.gold.min, rewards.gold.max)} />
      <PopoverText tone="note">
        Only Troll Bridge wins{difficulty === 'normal' ? '' : ` on ${difficultyName(difficulty)}`} count toward the unlock; it is permanent once reached.
      </PopoverText>
    </InfoPopover>
  );
}

const DungeonCard = memo(function DungeonCard({
  id,
  difficulty,
  searchMs,
  wins,
  running,
  onPick,
}: {
  id: DungeonId;
  difficulty: Difficulty;
  searchMs: number;
  wins: number;
  running: boolean;
  onPick: (id: DungeonOrBossId) => void;
}) {
  const d = DUNGEONS[id];
  const enemy = ENEMIES[d.enemyId];
  const pack = packRangeText(difficulty);
  const line = `${enemy.name}${pack ? ` · ${pack}` : ''} · ${formatClock(searchMs)} search`;
  const title = `Stage ${d.stage} · ${d.name}`;
  const level = difficulty === 'normal' ? '' : `${difficultyName(difficulty)} `;
  return (
    <Pressable
      onPress={() => onPick(id)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${level}${line}, ${wins} ${level}wins${running ? ', running' : ''}`}
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
            <Text style={styles.cardLine}>
              {level}Wins: {formatNumber(wins)}
            </Text>
          </View>
          {running ? <Text style={styles.badge}>Running</Text> : <Text style={styles.chevron}>›</Text>}
        </View>
      )}
    </Pressable>
  );
});

/** The tier's boss row (on the selected difficulty): locked ("Troll Bridge wins 12/50", a tap explains) or a card that opens the boss. */
const BossRow = memo(function BossRow({
  bossId,
  difficulty,
  state,
  running,
  onPick,
  onExplain,
}: {
  bossId: BossId;
  difficulty: Difficulty;
  state: GameState;
  running: boolean;
  onPick: (id: DungeonOrBossId) => void;
  onExplain: (id: DungeonOrBossId, node: HostInstance | null) => void;
}) {
  const boss = BOSSES[bossId];
  const unlock = bossUnlockView(state, bossId, difficulty);
  const title = `Boss · ${boss.name}`;
  if (!unlock.unlocked) {
    return (
      <LockedCard
        id={bossId}
        title={title}
        subtitle={`${boss.entryStamina} stamina`}
        requirement={bossRequirementText(unlock.requirement, unlock.progress, difficulty)}
        onExplain={onExplain}
        boss
      />
    );
  }
  const totals = bossTotals(state, bossId, difficulty);
  const line = `${boss.entryStamina} stamina · one live fight`;
  const level = difficulty === 'normal' ? '' : `${difficultyName(difficulty)} `;
  return (
    <Pressable
      onPress={() => onPick(bossId)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${level}${line}, ${totals.wins} ${level}wins${running ? ', fighting' : ''}`}
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
            <Text style={styles.cardLine}>
              {level}Wins: {formatNumber(totals.wins)}
            </Text>
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

/** The enemy's stats beside the hero's current ones (shared by a stage's and a boss's detail). `enemy` is the mob as it is on the difficulty. */
function Versus({
  enemyId,
  variant = 'base',
  enemy,
  name,
  state,
  stats,
  hp,
}: {
  enemyId: EnemyId;
  /** Which creature of the enemy it is (a stage on Hard / Extreme shows the variant's own sprite and name). */
  variant?: MobVariant;
  enemy: EnemyDef;
  name: string;
  state: GameState;
  stats: ReturnType<typeof getDerivedStats>;
  hp: { hp: number; maxHp: number };
}) {
  return (
    <View style={styles.versus}>
      <View
        style={styles.side}
        accessible
        accessibilityLabel={`${name}: HP ${enemy.hp}, damage ${range(enemy.damage.min, enemy.damage.max)}, armor ${enemy.armor}, magic resist ${enemy.magicResist}`}
      >
        <IconText image={<EnemySprite enemyId={enemyId} variant={variant} />} style={styles.sideTitle} rowStyle={styles.sideHead}>
          {name}
        </IconText>
        <StatLine label="HP" value={formatNumber(enemy.hp)} />
        <StatLine label="Damage" value={range(enemy.damage.min, enemy.damage.max)} />
        <StatLine label="Armor" value={formatNumber(enemy.armor)} />
        <StatLine label="Magic resist" value={formatNumber(enemy.magicResist)} />
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

/** Hard / Extreme: how a pack is made, and the stats of every kind of mob in it (the first one is shown beside the hero above). */
function PackInfo({ enemy, difficulty }: { enemy: EnemyDef; difficulty: Difficulty }) {
  const { min, max } = packSizeRange(difficulty);
  const kinds = mobTypes(enemy, difficulty);
  const [base, upgrade] = kinds;
  return (
    <View
      accessible
      accessibilityLabel={`Pack of ${min} to ${max}. Each mob is ${upgrade.name} ${basisPercent(upgrade.chanceBp)} of the time, otherwise ${base.name}.`}
    >
      <Text style={styles.subTitle}>Pack</Text>
      <StatLine label="Pack of" value={`${min}-${max} mobs`} />
      <StatLine label={`${base.name} (${multText(base.multBp)})`} value={`${basisPercent(base.chanceBp)} per mob`} />
      <StatLine label={`${upgrade.name} (${multText(upgrade.multBp)})`} value={`${basisPercent(upgrade.chanceBp)} per mob`} />
      <Text style={styles.abilityNote}>
        {upgrade.name}: HP {formatNumber(upgrade.enemy.hp)}, damage {range(upgrade.enemy.damage.min, upgrade.enemy.damage.max)}, armor {formatNumber(upgrade.enemy.armor)}, magic resist{' '}
        {formatNumber(upgrade.enemy.magicResist)}. Every mob fights at once and you strike the first one standing; each wins you its own loot, but only when you clear the whole pack.
      </Text>
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
  const difficulty = selectedDifficulty(state, d.tier);
  const kinds = mobTypes(enemy, difficulty);
  const packed = difficulty !== 'normal';
  const { level, attributes, spentPoints, equipment } = state.character;
  const { training } = state;
  const stats = useMemo(() => getDerivedStats({ character: { level, attributes, spentPoints, equipment }, training }), [level, attributes, spentPoints, equipment, training]);
  const danger = useMemo(
    () => dangerHint({ character: { level, attributes, spentPoints, equipment }, training }, id, difficulty),
    [level, attributes, spentPoints, equipment, training, id, difficulty],
  );
  const searchMs = searchMsFor(id, state);
  const unlock = dungeonUnlockView(state, id, difficulty);
  const totals = dungeonTotals(state, id, difficulty);
  const hp = hpView(state);
  const run = running ? dungeonRunView(state) : null;
  // A run keeps the difficulty it started on, whatever is selected now.
  const otherDifficultyRun = run && run.difficulty !== difficulty ? run.difficulty : null;
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
    // A boss fight in progress is fled by starting anything else (a loss, HP to 0): ask first. So is a run of this stage on another difficulty.
    const live = client.getState().activity;
    const leaving = live?.kind === 'boss' || (live?.kind === 'dungeon' && live.dungeonId === id && live.difficulty !== difficulty) ? live : null;
    if (!(await confirmLeaveRun(dialog, `Start ${d.name}`, leaving))) return;
    await send({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: id, difficulty });
  }, [client, d.name, dialog, difficulty, id, send]);
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
  // What one strike of the mob in the run deals to the hero (the run's own difficulty, its plain mob: the weakest kind).
  const runKinds = mobTypes(enemy, run?.difficulty ?? difficulty);
  const hits = strikeRange(runKinds[0].enemy.damage, stats.armor.value);
  const stop = useCallback(async () => {
    if (await confirmCancelRun(dialog, 'Stop')) await send({ type: 'STOP_ACTIVITY' });
  }, [dialog, send]);
  const flee = useCallback(async () => {
    if (await confirmCancelRun(dialog, 'Flee', true)) await send({ type: 'STOP_ACTIVITY' });
  }, [dialog, send]);
  const otherActivity = state.activity && !running ? state.activity.kind : null;
  /** Debug, hold to repeat. */
  const addWins = useCallback(({ repeat }: { repeat: boolean }) => runCall(() => client.debug.addDungeonWins(id, 10, difficulty), { quiet: repeat }), [client, difficulty, id, runCall]);
  const selectDifficulty = useCallback((to: Difficulty) => send({ type: 'SET_DUNGEON_DIFFICULTY', tier: d.tier, difficulty: to }), [d.tier, send]);
  const [diffInfo, setDiffInfo] = useState<{ difficulty: Difficulty; anchor: AnchorRect } | null>(null);
  const explainDifficulty = useCallback((to: Difficulty, node: HostInstance | null) => {
    void measureAnchor(node).then((anchor) => anchor && setDiffInfo({ difficulty: to, anchor }));
  }, []);
  const diffViews = difficultyViews(state, d.tier);
  const infoView = diffInfo ? diffViews.find((v) => v.difficulty === diffInfo.difficulty) : null;
  const level2 = difficulty === 'normal' ? '' : `${difficultyName(difficulty)} `;

  return (
    <View>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to all dungeons" hitSlop={8} style={styles.back}>
        <Text style={styles.backText}>‹ All dungeons</Text>
      </Pressable>

      <DifficultySelector views={diffViews} onSelect={(to) => void selectDifficulty(to)} onExplain={explainDifficulty} />

      <Panel title={`Stage ${d.stage} · ${d.name} · Tier ${d.tier}${packed ? ` · ${difficultyName(difficulty)}` : ''}`}>
        <Versus enemyId={d.enemyId} variant={kinds[0].variant} enemy={kinds[0].enemy} name={kinds[0].name} state={state} stats={stats} hp={hp} />
        {packed ? <PackInfo enemy={enemy} difficulty={difficulty} /> : null}

        <View
          style={styles.dangerRow}
          accessible
          accessibilityLabel={`Danger: ${DANGER_LABELS[danger.level]}. About ${danger.expectedHpLoss} HP lost per fight${packed ? ' against an average pack' : ''}, ${danger.percent}% of your max HP`}
        >
          <Text style={[styles.dangerLabel, DANGER_STYLES[danger.level]]}>Danger: {DANGER_LABELS[danger.level]}</Text>
          <Text style={styles.note}>
            ~{formatNumber(danger.expectedHpLoss)} HP lost per fight ({dangerPercent(danger.percent)} of max)
            {packed ? `, average pack of ${danger.packMin}-${danger.packMax}` : ''}
          </Text>
          {danger.fightMs > COMBAT.maxFightMs ? (
            <Text style={styles.note}>Too slow: about {Math.round(danger.fightMs / 1000)}s to clear it, the limit is {COMBAT.maxFightMs / 1000}s.</Text>
          ) : null}
          <Text style={styles.note}>
            Your average strike: {formatNumber(Math.round(danger.heroAvg * 10) / 10)}
            {danger.heroMagicAvg > 0 ? ` (${formatNumber(danger.heroMagicAvg)} magic)` : ''}
            {danger.critChanceBp > 0 ? `, crits ${bpPercent(danger.critChanceBp)} for ${critMultText(danger.critMultBp)}` : ''}
          </Text>
        </View>

        <Text style={styles.subTitle}>{packed ? 'Loot per mob, on a full clear' : 'Loot (win only)'}</Text>
        <View
          accessible
          accessibilityLabel={`Loot ${packed ? 'per mob, on a full clear' : 'on a win'}: ${kinds
            .map((k) => `${k.name} ${scaleStat(d.rewards.heroXp, k.multBp)} hero XP, gold ${range(scaleStat(d.rewards.gold.min, k.multBp), scaleStat(d.rewards.gold.max, k.multBp))}`)
            .join('; ')}; ${d.rewards.drops.map((x) => `${itemName(x.itemId)} ${percent(x.chance)} chance`).join(', ')}`}
        >
          {kinds.map((k) => (
            <View key={k.variant}>
              {packed ? <Text style={styles.kindTitle}>{k.name}</Text> : null}
              <StatLine icon={<GameIcon name="hero_xp" />} label="Hero XP" value={`+${formatNumber(scaleStat(d.rewards.heroXp, k.multBp))}`} />
              <StatLine icon={<GameIcon name="gold" />} label="Gold" value={range(scaleStat(d.rewards.gold.min, k.multBp), scaleStat(d.rewards.gold.max, k.multBp))} />
            </View>
          ))}
          {d.rewards.drops.map((x) => (
            <StatLine key={x.itemId} icon={<ItemIcon defId={x.itemId} size={20} />} label={itemName(x.itemId)} value={`${percent(x.chance)}${packed ? ' per mob' : ''}`} />
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
            hitName={runKinds[0].name}
            enemyId={d.enemyId}
            hitMin={hits.min}
            hitMax={hits.max}
            onSkip={skip}
            onStop={stop}
            onFlee={flee}
          />
        ) : !unlock.unlocked && unlock.requirement ? (
          <IconText icon="locked" style={styles.note} rowStyle={styles.centerRow}>
            Locked. {requirementText(unlock.requirement, unlock.progress, difficulty)}.
          </IconText>
        ) : (
          <View style={styles.startBox}>
            <Text style={styles.note}>
              Runs repeat on their own, also while the app is closed (up to {formatNumber(state.offline.capMs / 3_600_000)}h). Each run is a{' '}
              {formatClock(searchMs)} search for an opponent, then a live fight (up to {formatNumber(COMBAT.maxFightMs / 1000)}s). Waiting is free.
              {packed ? ` On ${difficultyName(difficulty)} the opponent is a pack: you must clear every mob inside the limit to win, and a loss pays nothing.` : ''}
            </Text>
            {otherActivity === 'woodcutting' ? <Text style={styles.note}>Starting stops woodcutting (your logs are kept).</Text> : null}
            {otherActivity === 'training' ? <Text style={styles.note}>Starting pauses training (your training XP is kept).</Text> : null}
            {otherActivity === 'boss' ? <Text style={styles.note}>Starting flees the boss fight: it counts as a loss.</Text> : null}
            <PixelButton label="Start" icon="fight" onPress={start} accessibilityLabel={`Start ${d.name} runs${packed ? ` on ${difficultyName(difficulty)}` : ''}`} />
          </View>
        )}
        {otherDifficultyRun ? (
          <View style={styles.startBox}>
            <Text style={styles.note}>This run plays on {difficultyName(otherDifficultyRun)} and keeps repeating on it. You selected {difficultyName(difficulty)}.</Text>
            {unlock.unlocked ? (
              <PixelButton label={`Start on ${difficultyName(difficulty)}`} onPress={start} accessibilityHint="Asks first: it replaces the current run, which gives no rewards if it is still searching" />
            ) : null}
          </View>
        ) : null}
        <Text style={styles.totals}>
          Lifetime {level2 ? `${level2.trim()} ` : ''}here: {formatNumber(totals.runs)} runs · {formatNumber(totals.wins)} wins · {formatNumber(totals.losses)} losses
        </Text>
        {DEV_TOOLS_ENABLED && unlock.unlocked ? (
          <View style={styles.debugRow}>
            <PixelButton
              label={`+10 ${level2}wins (debug)`}
              repeat={addWins}
              accessibilityHint={`Debug: adds 10 wins here on ${difficultyName(difficulty)}, to test unlocks. Hold to repeat`}
            />
          </View>
        ) : null}
      </Panel>

      <Panel title="Last fight">
        {replay ? (
          <FightReplay key={replayKey} fight={replay} heroName={state.character.name} onClose={() => setReplay(null)} />
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
      {diffInfo && infoView && !infoView.unlocked ? (
        <InfoPopover anchor={diffInfo.anchor} onClose={() => setDiffInfo(null)} title={`${infoView.name} is locked`} icon={<GameIcon name="locked" size={32} />} subtitle={`Tier ${d.tier} difficulty`}>
          <PopoverText tone="gold">{infoView.lockReason ?? ''}</PopoverText>
          <PopoverText tone="note">The kill is permanent: once it counts, {infoView.name} stays open.</PopoverText>
        </InfoPopover>
      ) : null}
    </View>
  );
}

function BossDetail({ id, state, running, paused, onBack }: { id: BossId; state: GameState; running: boolean; paused: boolean; onBack: () => void }) {
  const boss = BOSSES[id];
  const difficulty = selectedDifficulty(state, boss.tier);
  const enemy = bossEnemyAt(id, difficulty);
  const skill = COMBAT_SKILLS.heavy_bash;
  const { level, attributes, spentPoints, equipment } = state.character;
  const { training } = state;
  const input = useMemo(() => ({ character: { level, attributes, spentPoints, equipment }, training }), [level, attributes, spentPoints, equipment, training]);
  const stats = useMemo(() => getDerivedStats(input), [input]);
  const danger = useMemo(() => bossDangerHint(input, id, difficulty), [input, id, difficulty]);
  const entry = bossEntryView(state, id, difficulty);
  const totals = bossTotals(state, id, difficulty);
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
  const dName = difficultyName(difficulty);
  const onLevel = difficulty === 'normal' ? '' : ` on ${dName}`;

  // Entering and fleeing: one command at a time. FIGHT_IN_PROGRESS only means the screen was stale (a second tap).
  const { send, dialog, client } = useCommand({ silentCodes: ['FIGHT_IN_PROGRESS'] });
  const enter = useCallback(async () => {
    const live = client.getState();
    const view = bossEntryView(live, id, difficulty);
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
      title: view.hpBelowHalf ? 'Enter at low HP?' : `Enter the ${boss.name}${difficulty === 'normal' ? '' : ` on ${difficultyName(difficulty)}`}?`,
      message: lines.join('\n\n'),
      confirmLabel: 'Enter',
      cancelLabel: 'Not now',
      destructive: view.hpBelowHalf,
    });
    if (ok) await send({ type: 'ENTER_BOSS', bossId: id, maxCost: view.cost, difficulty });
  }, [boss.name, client, dialog, difficulty, id, send]);
  const flee = useCallback(async () => {
    if (await confirmCancelRun(dialog, 'Flee', true, id)) await send({ type: 'STOP_ACTIVITY' });
  }, [dialog, id, send]);
  const selectDifficulty = useCallback((to: Difficulty) => send({ type: 'SET_DUNGEON_DIFFICULTY', tier: boss.tier, difficulty: to }), [boss.tier, send]);
  const [diffInfo, setDiffInfo] = useState<{ difficulty: Difficulty; anchor: AnchorRect } | null>(null);
  const explainDifficulty = useCallback((to: Difficulty, node: HostInstance | null) => {
    void measureAnchor(node).then((anchor) => anchor && setDiffInfo({ difficulty: to, anchor }));
  }, []);
  const diffViews = difficultyViews(state, boss.tier);
  const infoView = diffInfo ? diffViews.find((v) => v.difficulty === diffInfo.difficulty) : null;

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
  const scaled = bossRewardsAt(id, difficulty);
  const weightTotal = scaled.rarityWeights.reduce((n, x) => n + x.weight, 0);
  const gearOdds = scaled.rarityWeights.map((w) => `${RARITY_COLOR_NAMES[w.value]} ${Math.round((w.weight * 100) / weightTotal)}%`).join(', ');

  return (
    <View>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to all dungeons" hitSlop={8} style={styles.back}>
        <Text style={styles.backText}>‹ All dungeons</Text>
      </Pressable>

      <DifficultySelector views={diffViews} onSelect={(to) => void selectDifficulty(to)} onExplain={explainDifficulty} />

      <Panel title={`${boss.name} · Tier ${boss.tier} boss${difficulty === 'normal' ? '' : ` · ${dName}`}`}>
        <Versus enemyId={boss.enemyId} enemy={enemy} name={boss.name} state={state} stats={stats} hp={hp} />

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
            ~{formatNumber(danger.expectedHpLoss)} HP lost ({dangerPercent(danger.percent)} of max), {skill.name} included
          </Text>
          <Text style={styles.note}>
            Your average strike: {formatNumber(Math.round(danger.heroAvg * 10) / 10)}. It heals {formatNumber(regenPerSec)} HP a second and {skill.name} stuns you {danger.stunChancePercent}% of the time for {danger.stunStrikes} strikes.
          </Text>
        </View>

        <Text style={styles.subTitle}>Rewards (win only)</Text>
        <View
          accessible
          accessibilityLabel={`Rewards on a win${onLevel}: ${scaled.heroXp} hero XP, ${range(scaled.gold.min, scaled.gold.max)} gold, ${percent(rewards.gear.chance)} chance of an Iron gear piece, ${rewards.drops.map((x) => `${itemName(x.itemId)} ${percent(x.chance)} chance`).join(', ')}`}
        >
          <StatLine icon={<GameIcon name="hero_xp" />} label="Hero XP" value={`+${formatNumber(scaled.heroXp)}`} />
          <StatLine icon={<GameIcon name="gold" />} label="Gold" value={range(scaled.gold.min, scaled.gold.max)} />
          <StatLine label="Iron gear piece" value={percent(rewards.gear.chance)} />
          <Text style={styles.abilityNote}>
            Sword, helm, chestplate, shield, gloves or boots, equal odds. {gearOdds}; quality 0–{rewards.gear.quality.max}%.
          </Text>
          {rewards.drops.map((x) => (
            <StatLine key={x.itemId} icon={<ItemIcon defId={x.itemId} size={20} />} label={itemName(x.itemId)} value={percent(x.chance)} />
          ))}
        </View>
      </Panel>

      <Panel title={run ? `Fight · ${difficultyName(run.difficulty)}` : 'Fight'}>
        {run ? (
          <View style={styles.runBox}>
            <LiveFight fight={run.fight} heroName={state.character.name} enemyId={boss.enemyId} paused={paused} />
            <View style={styles.buttons}>
              <PixelButton label="Flee (counts as loss)" onPress={flee} accessibilityHint={`Asks first: fleeing counts as a loss, drops your HP to 0 and the ${boss.entryStamina} stamina is not refunded`} />
            </View>
          </View>
        ) : !entry.unlock.unlocked ? (
          <IconText icon="locked" style={styles.note} rowStyle={styles.centerRow}>
            Locked. {bossRequirementText(entry.unlock.requirement, entry.unlock.progress, difficulty)}.
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
              accessibilityLabel={`Enter the ${boss.name}${onLevel} for ${entry.cost} stamina`}
              accessibilityHint={blockText ?? `Asks first. ${entry.cost} stamina, not refunded if you lose or flee`}
            />
            {blockText ? <Text style={styles.note}>{blockText}</Text> : null}
          </View>
        )}
        <Text style={styles.totals}>
          Lifetime{onLevel} here: {formatNumber(totals.runs)} fights · {formatNumber(totals.wins)} wins · {formatNumber(totals.losses)} losses
        </Text>
      </Panel>

      <Panel title="Last fight">
        {replay ? (
          <FightReplay key={replayKey} fight={replay} heroName={state.character.name} onClose={() => setReplay(null)} />
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
      {diffInfo && infoView && !infoView.unlocked ? (
        <InfoPopover anchor={diffInfo.anchor} onClose={() => setDiffInfo(null)} title={`${infoView.name} is locked`} icon={<GameIcon name="locked" size={32} />} subtitle={`Tier ${boss.tier} difficulty`}>
          <PopoverText tone="gold">{infoView.lockReason ?? ''}</PopoverText>
          <PopoverText tone="note">The kill is permanent: once it counts, {infoView.name} stays open.</PopoverText>
        </InfoPopover>
      ) : null}
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
  hitName,
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
  /** The run's plain mob, named for the hit line ("Stone Troll" on Extreme). */
  hitName: string;
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
        <LiveFight fight={run.fight} heroName={heroName} enemyId={enemyId} paused={paused} />
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
      <View style={styles.runLine} accessible accessibilityLabel={`Searching for an opponent on ${difficultyName(run.difficulty)}, ${formatClock(run.remainingMs)} left`}>
        <Text style={styles.runLabel}>Searching for opponent…{run.difficulty === 'normal' ? '' : ` (${difficultyName(run.difficulty)})`}</Text>
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
        Your HP {hp} · {run.difficulty === 'normal' ? enemyName : `each ${hitName}`} hits for {range(hitMin, hitMax)}
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
  const packSize = fight.mobs.length;
  const downCount = fight.mobs.filter((m) => m.hpEnd <= 0).length;
  const where = fight.difficulty === 'normal' ? '' : `${difficultyName(fight.difficulty)} · `;
  const seconds = Math.floor(fight.durationMs / 1000);
  const gearRef = useRef<HostInstance>(null);
  const rewardText = fight.won
    ? [`+${r.heroXp} XP`, `+${r.gold} gold`, ...items.map(([id, n]) => `${itemName(id)}${n > 1 ? ` ×${n}` : ''}`)].join(' · ')
    : 'No rewards';
  return (
    <View style={styles.lastBox}>
      <View
        accessible
        accessibilityLabel={`${outcome}${fight.difficulty === 'normal' ? '' : ` on ${difficultyName(fight.difficulty)}`}${packSize > 1 ? `, a pack of ${packSize}, ${downCount} defeated` : ''} after ${seconds} seconds. HP ${fight.heroHpStart} to ${fight.heroHpEnd}. ${rewardText}`}
      >
        <Text style={[styles.outcome, fight.won ? styles.win : styles.loss]}>{outcome}</Text>
        <Text style={styles.note}>
          {where}{packSize > 1 ? `${packText(packSize)}, ${downCount} down · ` : ''}{seconds}s · {fight.log.length} {fight.log.length === 1 ? 'strike' : 'strikes'} · HP {fight.heroHpStart} → {fight.heroHpEnd}
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
  kindTitle: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.inkSoft, marginTop: 6 },
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
