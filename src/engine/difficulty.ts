// Difficulty rules (pure, 1.24.0): which difficulties are open, the selected one per tier, the per-difficulty counters, stat scaling and
// the pack roll. Data in src/engine/config/difficulty.ts; docs/ENGINE.md ("Difficulty and packs") and docs/PRODUCT.md ("Difficulty").
//
// This file imports no fight or dungeon code (dungeon.ts and boss.ts import it), only config and types.
import { BOSS_IDS, BOSSES, DUNGEON_IDS, DUNGEON_TIERS, DUNGEONS, type EnemyDef, ENEMIES } from './config/dungeons';
import { DIFFICULTIES, DIFFICULTY, isDifficulty, variantCreature } from './config/difficulty';
import { BASIS_POINTS } from './config/stats';
import { nextInt } from './rng';
import type { BossId, Difficulty, DifficultyCounters, DungeonId, DungeonState, DungeonTotals, EnemyId, GameEvent, MobVariant, RngState, SimulationSummary } from './types';

export { DIFFICULTIES, isDifficulty };

const ZERO_TOTALS: DungeonTotals = { runs: 0, wins: 0, losses: 0 };

// ---------- scaling ----------

/**
 * `value` × `bp` ÷ 10 000, rounded half up, integers only: floor((value × bp + 5 000) / 10 000). The one rounding rule of the
 * difficulty system (mob and boss stats, XP and gold rewards). 10 000 bp is the identity.
 */
export function scaleStat(value: number, bp: number): number {
  return Math.floor((value * bp + BASIS_POINTS / 2) / BASIS_POINTS);
}

/** An enemy with HP, damage min / max, armor and magic resist scaled by `bp`. Attack interval, regen %, skills and limit are kept. */
export function scaledEnemy(enemy: EnemyDef, bp: number): EnemyDef {
  if (bp === BASIS_POINTS) return enemy;
  return {
    ...enemy,
    hp: scaleStat(enemy.hp, bp),
    damage: { min: scaleStat(enemy.damage.min, bp), max: scaleStat(enemy.damage.max, bp) },
    armor: scaleStat(enemy.armor, bp),
    magicResist: scaleStat(enemy.magicResist, bp),
  };
}

/**
 * What a mob is called: its variant creature's name from the data table (config/difficulty.ts ENEMY_VARIANTS: "Giant Rat" / "Blight Rat" for
 * the rat's Veteran / Extreme variants), or the enemy's own name for the plain mob (and for an enemy without variants, the boss).
 */
export function mobName(enemyId: EnemyId, variant: MobVariant): string {
  return variantCreature(enemyId, variant)?.name ?? ENEMIES[enemyId].name;
}

// ---------- packs ----------

/** One mob of a stage fight before it is made: its variant, its multiplier (also its reward multiplier) and its scaled stats. */
export type PackMobSpec = { variant: MobVariant; multBp: number; enemy: EnemyDef };

/**
 * The mobs of a stage fight on `difficulty`. Normal (no pack rule): one plain mob, no RNG draw. Otherwise, in this fixed order on the
 * main RNG: ONE draw for the pack size (uniform in the rule's range), then ONE draw per mob in pack order for its variant roll
 * (`nextInt(0, 9999) < chanceBp` makes it the upgrade, which replaces the base).
 */
export function rollPack(rng: RngState, enemy: EnemyDef, difficulty: Difficulty): { mobs: PackMobSpec[]; rng: RngState } {
  const rule = DIFFICULTY[difficulty].pack;
  if (!rule) return { mobs: [{ variant: 'base', multBp: BASIS_POINTS, enemy }], rng };
  const size = nextInt(rng, rule.size.min, rule.size.max);
  let r = size.rng;
  const mobs: PackMobSpec[] = [];
  for (let i = 0; i < size.value; i++) {
    const roll = nextInt(r, 0, BASIS_POINTS - 1);
    r = roll.rng;
    const tier = roll.value < rule.upgrade.chanceBp ? rule.upgrade : rule.base;
    mobs.push({ variant: tier.variant, multBp: tier.bp, enemy: scaledEnemy(enemy, tier.bp) });
  }
  return { mobs, rng: r };
}

/** The pack size range of a difficulty (1-1 on Normal). Read-only, for the UI. */
export function packSizeRange(difficulty: Difficulty): { min: number; max: number } {
  const rule = DIFFICULTY[difficulty].pack;
  return rule ? { ...rule.size } : { min: 1, max: 1 };
}

/** One kind of mob a difficulty can send: its variant, name, multiplier, chance (bp per mob) and scaled stats. */
export type MobTypeView = { variant: MobVariant; name: string; multBp: number; chanceBp: number; enemy: EnemyDef };

/**
 * The mob kinds of a stage on a difficulty, base first (Normal: one, 100%; Hard: plain x2 at 75% and Veteran x3 at 25%; Extreme: Veteran
 * x12 at 75% and Extreme x16 at 25%). Read-only, for the stage detail.
 */
export function mobTypes(enemy: EnemyDef, difficulty: Difficulty): MobTypeView[] {
  const rule = DIFFICULTY[difficulty].pack;
  if (!rule) return [{ variant: 'base', name: enemy.name, multBp: BASIS_POINTS, chanceBp: BASIS_POINTS, enemy }];
  const up = rule.upgrade;
  return [
    { variant: rule.base.variant, name: mobName(enemy.id, rule.base.variant), multBp: rule.base.bp, chanceBp: BASIS_POINTS - up.chanceBp, enemy: scaledEnemy(enemy, rule.base.bp) },
    { variant: up.variant, name: mobName(enemy.id, up.variant), multBp: up.bp, chanceBp: up.chanceBp, enemy: scaledEnemy(enemy, up.bp) },
  ];
}

/** The plain mob of a difficulty, no roll: what a fight that starts at 0 HP (an immediate loss, no rolls) records. */
export function plainMob(enemy: EnemyDef, difficulty: Difficulty): PackMobSpec {
  const tier = DIFFICULTY[difficulty].pack?.base ?? { variant: 'base' as const, bp: BASIS_POINTS };
  return { variant: tier.variant, multBp: tier.bp, enemy: scaledEnemy(enemy, tier.bp) };
}

// ---------- counters ----------

type DungeonCounters = Pick<DungeonState, 'byDungeon' | 'bosses' | 'harder' | 'difficulty'>;

/** The per-dungeon and per-boss counters of one difficulty. Normal's are the original fields of the dungeon state. */
export function countersOf(dungeon: Pick<DungeonState, 'byDungeon' | 'bosses' | 'harder'>, difficulty: Difficulty): DifficultyCounters {
  return difficulty === 'normal' ? dungeon : dungeon.harder[difficulty];
}

/** Lifetime runs / wins / losses in one stage dungeon on a difficulty (0/0/0 before the first). Read-only. */
export function stageTotalsAt(state: { dungeon: Pick<DungeonState, 'byDungeon' | 'bosses' | 'harder'> }, dungeonId: DungeonId, difficulty: Difficulty = 'normal'): DungeonTotals {
  return countersOf(state.dungeon, difficulty).byDungeon[dungeonId] ?? ZERO_TOTALS;
}

/** Lifetime fights / wins / losses against a boss on a difficulty. Read-only. */
export function bossTotalsAt(state: { dungeon: Pick<DungeonState, 'byDungeon' | 'bosses' | 'harder'> }, bossId: BossId, difficulty: Difficulty = 'normal'): DungeonTotals {
  return countersOf(state.dungeon, difficulty).bosses[bossId] ?? ZERO_TOTALS;
}

/** Replaces one stage dungeon's counters on a difficulty. Mutates `dungeon`, which the caller must own. */
export function setStageTotals(dungeon: DungeonCounters, difficulty: Difficulty, dungeonId: DungeonId, totals: DungeonTotals): void {
  if (difficulty === 'normal') dungeon.byDungeon = { ...dungeon.byDungeon, [dungeonId]: totals };
  else dungeon.harder = { ...dungeon.harder, [difficulty]: { ...dungeon.harder[difficulty], byDungeon: { ...dungeon.harder[difficulty].byDungeon, [dungeonId]: totals } } };
}

/** Replaces one boss's counters on a difficulty. Mutates `dungeon`, which the caller must own. */
export function setBossTotals(dungeon: DungeonCounters, difficulty: Difficulty, bossId: BossId, totals: DungeonTotals): void {
  if (difficulty === 'normal') dungeon.bosses = { ...dungeon.bosses, [bossId]: totals };
  else dungeon.harder = { ...dungeon.harder, [difficulty]: { ...dungeon.harder[difficulty], bosses: { ...dungeon.harder[difficulty].bosses, [bossId]: totals } } };
}

// ---------- unlocks and the selection ----------

/** The boss that caps a dungeon tier, or null (an unknown tier, or a tier without one). */
export function bossOfTier(tier: number): BossId | null {
  return DUNGEON_TIERS.find((t) => t.tier === tier)?.boss ?? null;
}

export function isTier(tier: unknown): tier is number {
  return typeof tier === 'number' && DUNGEON_TIERS.some((t) => t.tier === tier);
}

/** The tier a stage dungeon or a boss belongs to. */
export function tierOfDungeon(dungeonId: DungeonId): number {
  return DUNGEONS[dungeonId].tier;
}

export function tierOfBoss(bossId: BossId): number {
  return BOSSES[bossId].tier;
}

/**
 * True when `difficulty` is open for the tier: Normal always; Hard after the first win against the tier's boss on Normal; Extreme after
 * the first win against it on Hard (`DifficultyDef.unlockedBy`). Permanent: boss wins never go down. A tier without a boss opens nothing.
 */
export function isDifficultyUnlocked(state: { dungeon: Pick<DungeonState, 'byDungeon' | 'bosses' | 'harder'> }, tier: number, difficulty: Difficulty): boolean {
  const by = DIFFICULTY[difficulty].unlockedBy;
  if (by === null) return true;
  const bossId = bossOfTier(tier);
  return bossId !== null && bossTotalsAt(state, bossId, by).wins >= 1;
}

/** Why a difficulty is locked, for an error and the popover: "Kill the Troll Chieftain on Hard to unlock Extreme". null when it is open. */
export function difficultyLockReason(state: { dungeon: Pick<DungeonState, 'byDungeon' | 'bosses' | 'harder'> }, tier: number, difficulty: Difficulty): string | null {
  if (isDifficultyUnlocked(state, tier, difficulty)) return null;
  const by = DIFFICULTY[difficulty].unlockedBy!;
  const bossId = bossOfTier(tier);
  if (!bossId) return `${DIFFICULTY[difficulty].name} is not available for this tier`;
  return `Kill the ${BOSSES[bossId].name} on ${DIFFICULTY[by].name} to unlock ${DIFFICULTY[difficulty].name}`;
}

/** The difficulty selected for a tier (Normal when none is stored). Always an unlocked one in a state the engine produced. */
export function selectedDifficulty(state: { dungeon: Pick<DungeonState, 'difficulty'> }, tier: number): Difficulty {
  const d = state.dungeon.difficulty?.[String(tier)];
  return isDifficulty(d) ? d : 'normal';
}

/** The wins that open a stage or boss on `difficulty`: its Normal count x the difficulty's `unlockScale` (Normal x1, Hard x2, Extreme x8). */
export function scaledUnlockWins(normalWins: number, difficulty: Difficulty): number {
  return normalWins * DIFFICULTY[difficulty].unlockScale;
}

/**
 * True when the stage is open on `difficulty`: the difficulty is open AND, for every stage after the first, the previous stage (its unlock rule)
 * has the scaled number of wins ON THAT DIFFICULTY. Each difficulty has its own chain; Normal wins never count toward Hard / Extreme.
 */
export function isStageUnlocked(state: { dungeon: Pick<DungeonState, 'byDungeon' | 'bosses' | 'harder'> }, dungeonId: DungeonId, difficulty: Difficulty = 'normal'): boolean {
  if (!isDifficultyUnlocked(state, DUNGEONS[dungeonId].tier, difficulty)) return false;
  const rule = DUNGEONS[dungeonId].unlock;
  return !rule || stageTotalsAt(state, rule.dungeonId, difficulty).wins >= scaledUnlockWins(rule.wins, difficulty);
}

/** Wins in the boss's unlock stage dungeon, on the same difficulty, that open the boss there (Normal 50, Hard 100, Extreme 400). */
export function bossUnlockWins(bossId: BossId, difficulty: Difficulty): number {
  return scaledUnlockWins(BOSSES[bossId].unlock.wins, difficulty);
}

/** True once the boss is open on `difficulty`: the difficulty is open AND enough wins in its unlock stage on that difficulty. */
export function isBossUnlockedAt(state: { dungeon: Pick<DungeonState, 'byDungeon' | 'bosses' | 'harder'> }, bossId: BossId, difficulty: Difficulty = 'normal'): boolean {
  if (!isDifficultyUnlocked(state, BOSSES[bossId].tier, difficulty)) return false;
  return stageTotalsAt(state, BOSSES[bossId].unlock.dungeonId, difficulty).wins >= bossUnlockWins(bossId, difficulty);
}

// ---------- unlock events ----------

type UnlockState = { dungeon: Pick<DungeonState, 'byDungeon' | 'bosses' | 'harder'> };

/**
 * Every thing that can unlock, in the order its events are emitted: stages (per difficulty), bosses (per difficulty), harder difficulties.
 * A first stage (no rule) on Hard / Extreme opens with the difficulty, whose own event covers it, so it has no key of its own.
 */
function unlockKeys(state: UnlockState): string[] {
  const keys: string[] = [];
  for (const id of DUNGEON_IDS) {
    for (const d of DIFFICULTIES) {
      if (d !== 'normal' && !DUNGEONS[id].unlock) continue;
      if (isStageUnlocked(state, id, d)) keys.push(d === 'normal' ? `stage:${id}` : `stage:${id}:${d}`);
    }
  }
  for (const id of BOSS_IDS) for (const d of DIFFICULTIES) if (isBossUnlockedAt(state, id, d)) keys.push(`boss:${id}:${d}`);
  for (const t of DUNGEON_TIERS) for (const d of DIFFICULTIES) if (d !== 'normal' && isDifficultyUnlocked(state, t.tier, d)) keys.push(`difficulty:${t.tier}:${d}`);
  return keys;
}

/** What is unlocked right now; give it to emitNewUnlocks() after the counters changed. */
export function snapshotUnlocks(state: UnlockState): ReadonlySet<string> {
  return new Set(unlockKeys(state));
}

/**
 * Emits DUNGEON_UNLOCKED / DIFFICULTY_UNLOCKED for everything unlocked now that was not in `before`, and notes it in the summary.
 * Compared through the unlock predicates, so any future unlock condition is covered without changing this.
 */
export function emitNewUnlocks(before: ReadonlySet<string>, state: UnlockState, summary: SimulationSummary | null, events: GameEvent[]): void {
  for (const key of unlockKeys(state)) {
    if (before.has(key)) continue;
    const [kind, a, b] = key.split(':');
    if (kind === 'stage' && b) {
      events.push({ type: 'DUNGEON_UNLOCKED', dungeonId: a as DungeonId, difficulty: b as Difficulty });
      summary?.harderUnlocks.push({ kind: 'stage', dungeonId: a as DungeonId, difficulty: b as Difficulty });
    } else if (kind === 'stage') {
      events.push({ type: 'DUNGEON_UNLOCKED', dungeonId: a as DungeonId });
      summary?.dungeonsUnlocked.push(a as DungeonId);
    } else if (kind === 'boss' && b === 'normal') {
      events.push({ type: 'DUNGEON_UNLOCKED', dungeonId: a as BossId });
      summary?.dungeonsUnlocked.push(a as BossId);
    } else if (kind === 'boss') {
      events.push({ type: 'DUNGEON_UNLOCKED', dungeonId: a as BossId, difficulty: b as Difficulty });
      summary?.harderUnlocks.push({ kind: 'boss', bossId: a as BossId, difficulty: b as Difficulty });
    } else {
      events.push({ type: 'DIFFICULTY_UNLOCKED', tier: Number(a), difficulty: b as Difficulty });
      summary?.harderUnlocks.push({ kind: 'difficulty', tier: Number(a), difficulty: b as Difficulty });
    }
  }
}

export type DifficultyErrorCode = 'UNKNOWN_TIER' | 'UNKNOWN_DIFFICULTY' | 'DIFFICULTY_LOCKED';
export type DifficultyError = { code: DifficultyErrorCode; message: string };

/** Validates a (tier, difficulty) pair from a command: a known tier, a known difficulty, and it is unlocked. */
export function checkDifficulty(state: { dungeon: Pick<DungeonState, 'byDungeon' | 'bosses' | 'harder'> }, tier: unknown, difficulty: unknown): DifficultyError | null {
  if (!isTier(tier)) return { code: 'UNKNOWN_TIER', message: `Unknown dungeon tier ${String(tier)}` };
  if (!isDifficulty(difficulty)) return { code: 'UNKNOWN_DIFFICULTY', message: `Unknown difficulty ${String(difficulty)}` };
  const reason = difficultyLockReason(state, tier, difficulty);
  return reason ? { code: 'DIFFICULTY_LOCKED', message: reason } : null;
}

export type DifficultyView = {
  difficulty: Difficulty;
  name: string;
  unlocked: boolean;
  selected: boolean;
  /** Why it is locked (null when open): shown in the popover on the padlock. */
  lockReason: string | null;
};

/** The three skulls of a tier header: all difficulties, whether each is open, which is selected. Read-only. */
export function difficultyViews(state: { dungeon: DungeonCounters }, tier: number): DifficultyView[] {
  const sel = selectedDifficulty(state, tier);
  return DIFFICULTIES.map((difficulty) => ({
    difficulty,
    name: DIFFICULTY[difficulty].name,
    unlocked: isDifficultyUnlocked(state, tier, difficulty),
    selected: sel === difficulty,
    lockReason: difficultyLockReason(state, tier, difficulty),
  }));
}
