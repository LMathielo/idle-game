// Boss fights (pure): who can enter, the entry check, the fight's start and its result. See docs/ENGINE.md ("Bosses and
// combat skills") and docs/PRODUCT.md ("Bosses").
//
// A boss fight is one fight: paid for up front (stamina, never refunded), no search, no repeat. It is the hero's activity
// (kind 'boss') while it lasts and plays out through the same simulate() path as a dungeon fight (advanceDungeon in
// dungeon.ts: live and offline, same events and RNG draws, same offline-cap rule). When it ends the activity is cleared and the
// hero is idle. Strike rules (regen, Heavy Bash, stun, RNG order) are in combat.ts.
//
// Reward roll order on a win, all on the main RNG stream:
//   1. hero XP (no draw)      2. gold: one draw                 3. gear drop: one chance draw; on a hit three more, in this order:
//   the piece (equal weights), its colour (uncommon 75 / rare 25), its quality (uniform 0..70)
//   4. each material drop in config order: one chance draw each, independent of the gear drop
// A gear piece or material that does not fit in the inventory is lost (and reported in the result).
//
// Difficulty (1.24.0): the same boss on Hard / Extreme has x2 / x8 HP, damage, armor and magic resist (regen keeps its % of max HP; Heavy
// Bash, the 120 s limit and the 10 stamina entry are unchanged), x2 / x8 XP and gold, and a better gear colour table. The draws are the same.
import { grantHeroXp } from './activities';
import { harderTally } from './summary';
import { enemyCombatSide, enemyFightOptions, type DungeonFightView, fightView, type FightOutcome, heroCombatSide, newFight } from './combat';
import { DIFFICULTY } from './config/difficulty';
import { BOSSES, DUNGEONS, ENEMIES, isBossId } from './config/dungeons';
import {
  bossTotalsAt,
  bossUnlockWins,
  checkDifficulty,
  emitNewUnlocks,
  isBossUnlockedAt,
  isDifficulty,
  scaledEnemy,
  scaleStat,
  selectedDifficulty,
  setBossTotals,
  snapshotUnlocks,
  stageTotalsAt,
} from './difficulty';
import { GEAR } from './config/gear';
import { getItemDef } from './config/items';
import { affixStream, rollAffixes, rollQuality, rollRarity } from './gear';
import { addStackable, makeItem } from './inventory';
import { chance, nextInt, weightedPick } from './rng';
import { getDerivedStats } from './stats';
import type {
  BossActivity,
  BossId,
  Difficulty,
  DungeonId,
  DungeonTotals,
  FightRewards,
  GameEvent,
  GameState,
  ItemRarity,
  SimulationSummary,
} from './types';

export type BossErrorCode = 'UNKNOWN_BOSS' | 'UNKNOWN_DIFFICULTY' | 'DIFFICULTY_LOCKED' | 'BOSS_LOCKED' | 'NO_HP' | 'COST_CHANGED' | 'NOT_ENOUGH_STAMINA' | 'FIGHT_IN_PROGRESS' | 'INVALID_AMOUNT';

export type BossError = { code: BossErrorCode; message: string };

/** Lifetime fights / wins / losses against one boss on a difficulty (Normal by default; 0/0/0 before the first). `runs` is the number of fights. Read-only. */
export function bossTotals(state: Pick<GameState, 'dungeon'>, bossId: BossId, difficulty: Difficulty = 'normal'): DungeonTotals {
  return bossTotalsAt(state, bossId, difficulty);
}

/** True once the boss is open on the difficulty: it is unlocked AND enough wins in the boss's stage on that difficulty. Permanent: wins never go down. */
export function isBossUnlocked(state: Pick<GameState, 'dungeon'>, bossId: BossId, difficulty: Difficulty = 'normal'): boolean {
  return isBossUnlockedAt(state, bossId, difficulty);
}

export type BossUnlockView = {
  unlocked: boolean;
  requirement: { dungeonId: DungeonId; wins: number };
  /** Wins so far toward the requirement (in the same difficulty), capped at it. */
  progress: number;
  /** The difficulty itself is still locked (Hard / Extreme only). */
  difficultyLocked: boolean;
};

export function bossUnlockView(state: Pick<GameState, 'dungeon'>, bossId: BossId, difficulty: Difficulty = 'normal'): BossUnlockView {
  const rule = BOSSES[bossId].unlock;
  const wins = stageTotalsAt(state, rule.dungeonId, difficulty).wins;
  const need = bossUnlockWins(bossId, difficulty);
  const unlocked = isBossUnlockedAt(state, bossId, difficulty);
  return { unlocked, requirement: { dungeonId: rule.dungeonId, wins: need }, progress: Math.min(wins, need), difficultyLocked: checkDifficulty(state, BOSSES[bossId].tier, difficulty) !== null };
}

/** True while a fight is on (a boss fight, or a stage dungeon's fight phase): leaving it would be a forfeit that drops the hero to 0 HP. */
export function fightIsOn(state: Pick<GameState, 'activity'>): boolean {
  const a = state.activity;
  return a?.kind === 'boss' || (a?.kind === 'dungeon' && a.phase === 'fight');
}

/** Why the boss cannot be entered right now, in the order the engine checks, or null. */
export type BossEntryBlock = 'locked' | 'fight' | 'no_hp' | 'stamina';

export type BossEntryView = {
  bossId: BossId;
  difficulty: Difficulty;
  /** Stamina the entry costs (BOSSES[...].entryStamina). */
  cost: number;
  unlock: BossUnlockView;
  block: BossEntryBlock | null;
  /** The hero's current HP is below half of max (the UI warns before entering). */
  hpBelowHalf: boolean;
};

/** Read-only, for the UI: can it be entered, and if not why not. Mirrors checkBossEntry. */
export function bossEntryView(state: GameState, bossId: BossId, difficulty: Difficulty = 'normal'): BossEntryView {
  const cost = BOSSES[bossId].entryStamina;
  const unlock = bossUnlockView(state, bossId, difficulty);
  const maxHp = getDerivedStats(state).maxHp.value;
  const hp = Math.max(0, Math.min(state.character.hp, maxHp));
  const block: BossEntryBlock | null = !unlock.unlocked ? 'locked' : fightIsOn(state) ? 'fight' : hp <= 0 ? 'no_hp' : state.stamina.current < cost ? 'stamina' : null;
  return { bossId, difficulty, cost, unlock, block, hpBelowHalf: hp * 2 < maxHp };
}

const err = (code: BossErrorCode, message: string): BossError => ({ code, message });

/**
 * The difficulty an ENTER_BOSS fights on: the command's own when it names one (anything else is refused), else the one selected for the
 * boss's tier. Returns it, or the error.
 */
export function resolveBossDifficulty(state: Pick<GameState, 'dungeon'>, bossId: BossId, requested: unknown): Difficulty | BossError {
  if (requested === undefined) return selectedDifficulty(state, BOSSES[bossId].tier);
  if (!isDifficulty(requested)) return err('UNKNOWN_DIFFICULTY', `Unknown difficulty ${String(requested)}`);
  return requested;
}

/**
 * ENTER_BOSS validation, before anything changes. In this order: a known boss; a valid `maxCost`; a known difficulty (the command's, else
 * the tier's selected one) that is unlocked; the boss unlocked on it; no fight already on (a second tap must never pay twice, and leaving
 * a dungeon fight would zero the hero's HP); the cost still at most `maxCost` (the cost the player saw); the hero has HP (a 0 HP hero would
 * lose at once and waste the stamina); enough stamina.
 */
export function checkBossEntry(state: GameState, bossId: unknown, maxCost: unknown, difficulty?: unknown): BossError | null {
  if (!isBossId(bossId)) return err('UNKNOWN_BOSS', `Unknown boss ${String(bossId)}`);
  if (typeof maxCost !== 'number' || !Number.isSafeInteger(maxCost) || maxCost <= 0) return err('INVALID_AMOUNT', `Invalid maxCost ${String(maxCost)}`);
  const boss = BOSSES[bossId];
  const d = resolveBossDifficulty(state, bossId, difficulty);
  if (typeof d !== 'string') return d;
  const locked = checkDifficulty(state, boss.tier, d);
  if (locked) return err(locked.code === 'DIFFICULTY_LOCKED' ? 'DIFFICULTY_LOCKED' : 'UNKNOWN_DIFFICULTY', locked.message);
  const view = bossEntryView(state, bossId, d);
  if (view.block === 'locked') {
    const { requirement, progress } = view.unlock;
    return err('BOSS_LOCKED', `${boss.name} is locked${d === 'normal' ? '' : ` on ${DIFFICULTY[d].name}`}: win ${requirement.wins}× in ${DUNGEONS[requirement.dungeonId].name}${d === 'normal' ? '' : ` on ${DIFFICULTY[d].name}`} (${progress}/${requirement.wins})`);
  }
  if (view.block === 'fight') return err('FIGHT_IN_PROGRESS', 'A fight is already on: finish it first');
  if (view.cost > maxCost) return err('COST_CHANGED', `Entering now costs ${view.cost} stamina, more than the ${maxCost} shown`);
  if (view.block === 'no_hp') return err('NO_HP', 'You have no HP: recover before facing a boss');
  if (view.block === 'stamina') return err('NOT_ENOUGH_STAMINA', `Needs ${view.cost} stamina, has ${state.stamina.current}`);
  return null;
}

/** The boss as it is on a difficulty: HP, damage, armor and magic resist scaled; regen %, skills and limit unchanged. */
export function bossEnemyAt(bossId: BossId, difficulty: Difficulty) {
  return scaledEnemy(ENEMIES[BOSSES[bossId].enemyId], DIFFICULTY[difficulty].boss.statBp);
}

export type BossRewardsView = {
  heroXp: number;
  gold: { min: number; max: number };
  /** The gear rarity weights that apply on the difficulty (Normal: the boss's own table). */
  rarityWeights: readonly { value: ItemRarity; weight: number }[];
};

/** The boss's rewards on a difficulty (XP and gold scaled, the difficulty's rarity table). Gear chance and the Tusk are unchanged. Read-only. */
export function bossRewardsAt(bossId: BossId, difficulty: Difficulty): BossRewardsView {
  const r = BOSSES[bossId].rewards;
  const rule = DIFFICULTY[difficulty].boss;
  return {
    heroXp: scaleStat(r.heroXp, rule.rewardBp),
    gold: { min: scaleStat(r.gold.min, rule.rewardBp), max: scaleStat(r.gold.max, rule.rewardBp) },
    rarityWeights: rule.rarityWeights ?? r.gear.rarityWeights,
  };
}

/**
 * The boss activity at engine time `now`: the fight starts at once with the hero's current HP and stats (frozen for this fight).
 * The caller has run checkBossEntry (HP > 0) and paid the stamina.
 */
export function newBossActivity(state: GameState, bossId: BossId, now: number, difficulty: Difficulty = 'normal'): BossActivity {
  const enemy = bossEnemyAt(bossId, difficulty);
  const stats = getDerivedStats(state);
  const maxHp = stats.maxHp.value;
  const hp = Math.max(0, Math.min(state.character.hp, maxHp));
  return {
    kind: 'boss',
    bossId,
    difficulty,
    startedAt: now,
    progressMs: 0,
    fight: newFight(enemy.id, heroCombatSide(stats), enemyCombatSide(enemy), hp, maxHp, enemy.hp, enemyFightOptions(enemy)),
  };
}

/**
 * Adds fights to one boss's counters on a difficulty, then emits the unlock events that flipped. The first boss kill on a difficulty opens
 * the next one (Hard after Normal, Extreme after Hard); 100 / 400 wins in the boss's stage on Hard / Extreme open the boss there.
 * Mutates `draft.dungeon`, which the caller owns.
 */
export function recordBossResults(draft: GameState, bossId: BossId, difficulty: Difficulty, wins: number, losses: number, summary: SimulationSummary | null, events: GameEvent[]): void {
  const unlocked = snapshotUnlocks(draft);
  const before = bossTotalsAt(draft, bossId, difficulty);
  setBossTotals(draft.dungeon, difficulty, bossId, { runs: before.runs + wins + losses, wins: before.wins + wins, losses: before.losses + losses });
  emitNewUnlocks(unlocked, draft, summary, events);
}

function bump(map: Record<string, number>, key: string, by: number) {
  if (by !== 0) map[key] = (map[key] ?? 0) + by;
}

/**
 * Ends the boss fight and applies its outcome (reward order above). Win: hero XP, gold, gear, materials. Loss (defeat, time limit, flee):
 * nothing, and the hero ends at 0 HP; the stamina paid at entry is never refunded. Records the kill counter, `lastFight` and the summary,
 * then clears the activity (the hero is idle). Mutates `draft` (a copy owned by the caller).
 */
export function finishBossFight(draft: GameState, activity: BossActivity, outcome: FightOutcome, summary: SimulationSummary | null, events: GameEvent[]): void {
  const bossId = activity.bossId;
  const boss = BOSSES[bossId];
  const difficulty = activity.difficulty;
  const rule = DIFFICULTY[difficulty].boss;
  const won = outcome.endReason === 'enemy_defeated';
  if (!won) draft.character.hp = 0;

  const rewards: FightRewards = { heroXp: 0, gold: 0, items: {}, itemsLost: {} };
  if (won) {
    const r = boss.rewards;
    const xp = scaleStat(r.heroXp, rule.rewardBp);
    if (xp > 0) {
      grantHeroXp(draft, xp, summary, events);
      rewards.heroXp = xp;
    }
    const gold = nextInt(draft.rng, r.gold.min, r.gold.max);
    draft.rng = gold.rng;
    const goldGained = scaleStat(gold.value, rule.rewardBp);
    draft.character.gold += goldGained;
    rewards.gold = goldGained;

    const hit = chance(draft.rng, r.gear.chance);
    draft.rng = hit.rng;
    if (hit.value) {
      const piece = weightedPick(draft.rng, r.gear.pieces.map((p) => ({ value: p.itemId, weight: p.weight })));
      const rarity = rollRarity(piece.rng, rule.rarityWeights ?? r.gear.rarityWeights);
      const quality = rollQuality(rarity.rng, r.gear.quality.min, r.gear.quality.max);
      draft.rng = quality.rng;
      const defId = piece.value;
      // Affixes (1.22.0) come from a salted sub-stream of the main RNG after these draws: the main stream is not advanced.
      const affixes = rollAffixes(affixStream(quality.rng, GEAR.drops.affixSalt), getItemDef(defId)?.slot, rarity.value).value;
      if (getItemDef(defId) && draft.inventory.items.length < draft.inventory.capacity) {
        const itemId = `${defId}#${draft.nextItemSerial}`;
        draft.nextItemSerial += 1;
        draft.inventory.items.push(makeItem(defId, 1, itemId, { quality: quality.value, rarity: rarity.value, affixes }));
        bump(rewards.items, defId, 1);
        rewards.gear = { itemId, defId, rarity: rarity.value, quality: quality.value };
      } else {
        bump(rewards.itemsLost, defId, 1);
      }
    }
    for (const drop of r.drops) {
      const roll = chance(draft.rng, drop.chance);
      draft.rng = roll.rng;
      if (!roll.value) continue;
      const { added, lost } = addStackable(draft.inventory, drop.itemId, 1);
      bump(rewards.items, drop.itemId, added);
      bump(rewards.itemsLost, drop.itemId, lost);
    }
  }

  draft.dungeon.lastFight = {
    dungeonId: bossId,
    difficulty,
    enemyId: outcome.enemyId,
    heroFirstStrikeMs: outcome.heroFirstStrikeMs,
    enemyFirstStrikeMs: outcome.enemyFirstStrikeMs,
    won,
    endReason: outcome.endReason,
    durationMs: outcome.durationMs,
    heroHpStart: outcome.heroHpStart,
    heroHpEnd: draft.character.hp,
    heroMaxHp: outcome.heroMaxHp,
    enemyMaxHp: outcome.enemyMaxHp,
    enemyHpEnd: outcome.enemyHpEnd,
    mobs: outcome.mobs,
    rewards,
    log: outcome.log,
  };
  events.push({ type: 'FIGHT_RESOLVED', dungeonId: bossId, won });
  recordBossResults(draft, bossId, difficulty, won ? 1 : 0, won ? 0 : 1, summary, events);

  if (summary) {
    summary.boss.fights += 1;
    if (won) summary.boss.wins += 1;
    else summary.boss.losses += 1;
    const tally = harderTally(summary, difficulty);
    if (tally) {
      tally.bossFights += 1;
      if (won) tally.bossWins += 1;
      else tally.bossLosses += 1;
    }
    summary.goldGained += rewards.gold;
    for (const [id, n] of Object.entries(rewards.items)) bump(summary.itemsGained, id, n);
    for (const [id, n] of Object.entries(rewards.itemsLost)) bump(summary.itemsLost, id, n);
  }

  // One fight per entry: the hero is idle now.
  draft.activity = null;
}

// ---------- views ----------

export type BossRunView = {
  kind: 'boss';
  bossId: BossId;
  difficulty: Difficulty;
  fight: DungeonFightView;
};

/** The boss fight on screen (read-only). */
export function bossRunView(state: GameState): BossRunView | null {
  const a = state.activity;
  if (a?.kind !== 'boss') return null;
  return { kind: 'boss', bossId: a.bossId, difficulty: a.difficulty, fight: fightView(state.character.hp, a.fight) };
}
