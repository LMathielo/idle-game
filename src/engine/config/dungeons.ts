// Dungeons, enemies and combat (data). Rules in src/engine/combat.ts and src/engine/dungeon.ts;
// formulas in docs/ENGINE.md ("Dungeon & combat").
import type { BossId, CombatSkillId, DungeonId, DungeonOrBossId, EnemyId, ItemRarity } from '../types';
import { GEAR, type RarityWeight } from './gear';

const SEC_MS = 1000;
const MIN_MS = 60 * SEC_MS;

/**
 * Rules shared by every dungeon. A run = a search for an opponent (timed per dungeon, DungeonDef.search),
 * then a live fight (COMBAT.maxFightMs at most).
 */
export const DUNGEON_RUN = {
  /**
   * Skip cost for the SEARCH: `staminaPerStep` per started `stepMs` of search left (rounded up, at least one
   * step). The fight is never skippable.
   */
  skip: { stepMs: 1 * MIN_MS, staminaPerStep: 1 },
} as const;

/** searchMs = max(minMs, ceil(baseMs × (1 − core DEX reduction))) (STAT_EFFECTS.dexterity.activityTime, 1.16.0). */
export type SearchTiming = { baseMs: number; minMs: number };

export const COMBAT = {
  /**
   * Armor and magic resist reduce damage the same way: reduced = round(raw × K / (resist + K)) (13 armor blocks ~21%).
   * A strike deals max(minDamage, physical + magic).
   */
  armorK: 50,
  minDamage: 1,
  /**
   * The fight's opening (1.25.0, owner decision 2026-11-06). Strike n (1-based) of a side lands at
   *   firstStrikeMs + (n - 1) x its attackIntervalMs        (fight time, ms from the fight's start)
   * The hero opens at 0 (his first strike is the fight's first tick); every monster of a pack opens at 300 ms. Before 1.25.0 a side's
   * first strike landed one interval in (offset = its interval): a fight already in progress at the update keeps that, stored on the
   * fight itself (ActiveFight.heroFirstStrikeMs / enemyFirstStrikeMs, save v23). On a tie the hero strikes first, then the mobs in pack order.
   */
  heroFirstStrikeMs: 0,
  enemyFirstStrikeMs: 300,
  /**
   * Fight time limit (engine time from the fight's start). Strikes due at exactly this time still land;
   * a fight with both sides alive after them is a loss (`time_limit`), with the usual loss rules.
   */
  maxFightMs: 60 * SEC_MS,
} as const;

export type EnemyDef = {
  id: EnemyId;
  name: string;
  icon: string;
  hp: number;
  damage: { min: number; max: number };
  armor: number;
  /** Reduces the hero's magic damage (1.19.0). Equal to the armor for now; no enemy deals magic damage yet. */
  magicResist: number;
  /** Time between two of its strikes. Its first strike lands at COMBAT.enemyFirstStrikeMs (1.25.0; before that, one interval in). */
  attackIntervalMs: number;
  /** Bosses (1.20.0): HP regenerated per second while it fights, in basis points of its max HP (50 = 0.5% per second). Missing = none. */
  regenBpPerSec?: number;
  /** Bosses (1.20.0): overrides COMBAT.maxFightMs for a fight against it. Missing = COMBAT.maxFightMs. */
  maxFightMs?: number;
  /** Combat skills it casts (ids into COMBAT_SKILLS, config/skills.ts), in priority order. Missing = none. */
  skills?: readonly CombatSkillId[];
};

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  rat: { id: 'rat', name: 'Rat', icon: '🐀', hp: 30, damage: { min: 3, max: 5 }, armor: 2, magicResist: 2, attackIntervalMs: 1000 },
  bat: { id: 'bat', name: 'Bat', icon: '🦇', hp: 60, damage: { min: 6, max: 9 }, armor: 6, magicResist: 6, attackIntervalMs: 1000 },
  wolf: { id: 'wolf', name: 'Wolf', icon: '🐺', hp: 110, damage: { min: 10, max: 14 }, armor: 12, magicResist: 12, attackIntervalMs: 1000 },
  skeleton: { id: 'skeleton', name: 'Skeleton', icon: '💀', hp: 180, damage: { min: 15, max: 20 }, armor: 20, magicResist: 20, attackIntervalMs: 1000 },
  troll: { id: 'troll', name: 'Troll', icon: '👹', hp: 300, damage: { min: 22, max: 30 }, armor: 30, magicResist: 30, attackIntervalMs: 1000 },
  // The Tier 1 boss (1.20.0, owner-approved 2026-11-05). The starting numbers are unchanged after the balance sim
  // (tests/balanceSimBoss.test.ts; results and the keep-as-is decision in docs/ENGINE.md "Bosses and combat skills").
  troll_chieftain: {
    id: 'troll_chieftain',
    name: 'Troll Chieftain',
    icon: '👹',
    hp: 1000,
    damage: { min: 26, max: 36 },
    armor: 40,
    magicResist: 40,
    attackIntervalMs: 1000,
    regenBpPerSec: 50,
    maxFightMs: 120 * SEC_MS,
    skills: ['heavy_bash'],
  },
};

/**
 * What opens a dungeon. Today: a number of lifetime WINS in another dungeon (losses never count).
 * Wins never go down, so an unlock is permanent. More conditions (e.g. hero level) can be added here
 * as optional fields; isDungeonUnlocked() requires all of them.
 */
export type UnlockRule = { dungeonId: DungeonId; wins: number };

export type DungeonDef = {
  id: DungeonId;
  name: string;
  /** The dungeon tier it belongs to (DUNGEON_TIERS); 1 for all five stages today. */
  tier: number;
  /** 1-based stage inside its tier, "Stage 3 · Wolf Den" (these were "tiers" 1–5 before 1.20.0); the list is shown in this order. */
  stage: number;
  icon: string;
  enemyId: EnemyId;
  /** How long the search for an opponent takes (the first phase of a run). */
  search: SearchTiming;
  /** null = open from the start. */
  unlock: UnlockRule | null;
  /**
   * Win only. A loss gives nothing. Per mob (a pack rolls once per mob), in this order on the main RNG stream: gold, the gear drop's
   * chance (1.26.0; on a hit: the piece, its colour, its quality), then each item drop in this order. EVERY entry rolls on its own,
   * whatever else dropped (docs/ENGINE.md "Drop tables").
   */
  rewards: {
    heroXp: number;
    gold: { min: number; max: number };
    /** Optional gear drop (Skeleton and Troll: Copper pieces). Same on every difficulty. */
    gear?: GearDropDef;
    drops: readonly { itemId: string; chance: number }[];
  };
};

/** Every tier: 2:00 at core DEX 0 (owner decision 2026-11-05, engine 1.18.0); core DEX shortens it on the diminishing curve, never under 1:00. */
const searchFrom = (baseMinutes: number): SearchTiming => ({ baseMs: baseMinutes * MIN_MS, minMs: 1 * MIN_MS });

/**
 * The Copper combat pieces a Skeleton or Troll kill can drop (no tools): equal weights. Owner decision 2026-11-06: the same piece list,
 * colour table (white 75 / green 25), quality (0..50) on Normal, Hard and Extreme; only the chance differs per monster.
 */
const COPPER_GEAR_PIECES = ['copper_sword', 'copper_helm', 'copper_chestplate', 'copper_shield', 'copper_greaves', 'copper_gloves', 'copper_boots'].map((itemId) => ({
  itemId,
  weight: 1,
}));

const copperGearDrop = (chance: number): GearDropDef => ({
  chance,
  pieces: COPPER_GEAR_PIECES,
  rarityWeights: [
    { value: 'common' as ItemRarity, weight: 75 },
    { value: 'uncommon' as ItemRarity, weight: 25 },
  ],
  quality: { min: 0, max: 50 },
});

// Owner-approved tier table (2026-10-26; search times and Rat XP rebalanced 2026-10-27; every search 2:00 since 2026-11-05). Tiers 4–5 are out of reach until Training raises attributes.
// Insertion order is the display order (DUNGEON_IDS).
export const DUNGEONS: Record<DungeonId, DungeonDef> = {
  rat_cellar: {
    id: 'rat_cellar',
    name: 'Rat Cellar',
    tier: 1,
    stage: 1,
    icon: '🕳️',
    enemyId: 'rat',
    search: searchFrom(2), // core DEX 0 → 2:00, 10 → 1:51
    unlock: null,
    rewards: { heroXp: 35, gold: { min: 2, max: 5 }, drops: [{ itemId: 'rat_skin', chance: 0.5 }] },
  },
  bat_cave: {
    id: 'bat_cave',
    name: 'Bat Cave',
    tier: 1,
    stage: 2,
    icon: '⛰️',
    enemyId: 'bat',
    search: searchFrom(2), // core DEX 0 → 2:00
    unlock: { dungeonId: 'rat_cellar', wins: 10 },
    rewards: { heroXp: 60, gold: { min: 6, max: 12 }, drops: [{ itemId: 'bat_wing', chance: 0.4 }] },
  },
  wolf_den: {
    id: 'wolf_den',
    name: 'Wolf Den',
    tier: 1,
    stage: 3,
    icon: '🌲',
    enemyId: 'wolf',
    search: searchFrom(2), // core DEX 0 → 2:00
    unlock: { dungeonId: 'bat_cave', wins: 15 },
    rewards: { heroXp: 140, gold: { min: 15, max: 30 }, drops: [{ itemId: 'wolf_pelt', chance: 0.3 }] },
  },
  forgotten_crypt: {
    id: 'forgotten_crypt',
    name: 'Forgotten Crypt',
    tier: 1,
    stage: 4,
    icon: '⚰️',
    enemyId: 'skeleton',
    search: searchFrom(2), // core DEX 0 → 2:00
    unlock: { dungeonId: 'wolf_den', wins: 25 },
    // 1.26.0: 5% Copper gear per kill and a Wild Sage (5%), each independent of the Old Bone.
    rewards: {
      heroXp: 300,
      gold: { min: 35, max: 60 },
      gear: copperGearDrop(0.05),
      drops: [
        { itemId: 'old_bone', chance: 0.25 },
        { itemId: 'wild_sage', chance: 0.05 },
      ],
    },
  },
  troll_bridge: {
    id: 'troll_bridge',
    name: 'Troll Bridge',
    tier: 1,
    stage: 5,
    icon: '🌉',
    enemyId: 'troll',
    search: searchFrom(2), // core DEX 0 → 2:00
    unlock: { dungeonId: 'forgotten_crypt', wins: 40 },
    // 1.26.0: 10% Copper gear per kill and a Wild Sage (5%), each independent of the Troll Hide.
    rewards: {
      heroXp: 650,
      gold: { min: 80, max: 130 },
      gear: copperGearDrop(0.1),
      drops: [
        { itemId: 'troll_hide', chance: 0.2 },
        { itemId: 'wild_sage', chance: 0.05 },
      ],
    },
  },
};

// ---------- bosses and dungeon tiers (1.20.0) ----------

/** A monster's drop of one gear piece (rolled with the existing gear machinery: colour table, then a quality in [min, max]). */
export type GearDropDef = {
  chance: number;
  /** One piece is picked by weight. */
  pieces: readonly { itemId: string; weight: number }[];
  rarityWeights: readonly RarityWeight[];
  quality: { min: number; max: number };
};

/** Kept for readers of the 1.20.0 name. */
export type BossGearDrop = GearDropDef;

export type BossDef = {
  id: BossId;
  name: string;
  icon: string;
  /** The dungeon tier it caps (DUNGEON_TIERS). */
  tier: number;
  enemyId: EnemyId;
  /** What opens it: lifetime wins in a stage dungeon (permanent, same rule as the stages). */
  unlock: UnlockRule;
  /** Paid up front when the fight is entered; never refunded (lost, fled or timed out). */
  entryStamina: number;
  /**
   * Win only. Rolled in this order on the main RNG stream: gold, the gear drop's chance (then, on a hit: the piece, its colour,
   * its quality), then each material drop (independent of the gear drop). A drop that does not fit is lost.
   */
  rewards: {
    heroXp: number;
    gold: { min: number; max: number };
    gear: GearDropDef;
    /** Rolled in this order, each on its own; an item with ItemDef.unique that the hero owns is skipped (after its draw). */
    drops: readonly { itemId: string; chance: number }[];
  };
};

export const BOSSES: Record<BossId, BossDef> = {
  troll_chieftain: {
    id: 'troll_chieftain',
    name: 'Troll Chieftain',
    icon: '👹',
    tier: 1,
    enemyId: 'troll_chieftain',
    unlock: { dungeonId: 'troll_bridge', wins: 50 },
    entryStamina: 10,
    rewards: {
      heroXp: 2000,
      gold: { min: 300, max: 450 },
      gear: {
        chance: 0.35,
        pieces: ['iron_sword', 'iron_helm', 'iron_chestplate', 'iron_shield', 'iron_gloves', 'iron_boots'].map((itemId) => ({ itemId, weight: 1 })),
        rarityWeights: [
          { value: 'uncommon' as ItemRarity, weight: 75 },
          { value: 'rare' as ItemRarity, weight: 25 },
        ],
        quality: { min: 0, max: GEAR.drops.maxQuality },
      },
      // Chieftain's Tusk removed from the table in 1.26.0 (owner decision 2026-11-06); the Troll Head replaces it. The belt is 100% but
      // unique: it is skipped while the hero owns one (its chance is still drawn, see rollItemDrop).
      drops: [
        { itemId: 'troll_head', chance: 0.25 },
        { itemId: 'potion_belt', chance: 1 },
      ],
    },
  },
};

export const BOSS_IDS = Object.keys(BOSSES) as BossId[];

export function isBossId(id: unknown): id is BossId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(BOSSES, id);
}

/**
 * Dungeon tiers: a group of stage dungeons and the boss that caps it. Tier 1 is the five existing dungeons (stages 1–5) and the
 * Troll Chieftain; Tier 2 will be more data here. The UI lists a tier as a header, its stages in order, then its boss.
 */
export type DungeonTierDef = { tier: number; name: string; stages: readonly DungeonId[]; boss: BossId | null };

export const DUNGEON_TIERS: readonly DungeonTierDef[] = [
  { tier: 1, name: 'Tier 1', stages: ['rat_cellar', 'bat_cave', 'wolf_den', 'forgotten_crypt', 'troll_bridge'], boss: 'troll_chieftain' },
];

/** "Rat Cellar" / "Troll Chieftain": the name of a stage dungeon or a boss. */
export function dungeonOrBossName(id: DungeonOrBossId): string {
  return isBossId(id) ? BOSSES[id].name : DUNGEONS[id].name;
}

/**
 * Danger hint shown before a run (dangerHint in src/engine/danger.ts): expected HP lost per fight, with
 * average rolls, as a percent of max HP. Below `toughAtPercent` → Easy; below `deadlyAtPercent` → Tough;
 * otherwise (or when the hero can't win within the fight time limit) → Deadly.
 */
export const DANGER = { toughAtPercent: 40, deadlyAtPercent: 100 } as const;

/** All stage dungeons, by tier then stage (the list order in the UI). Bosses are in BOSS_IDS. */
export const DUNGEON_IDS = (Object.keys(DUNGEONS) as DungeonId[]).sort((a, b) => DUNGEONS[a].tier - DUNGEONS[b].tier || DUNGEONS[a].stage - DUNGEONS[b].stage);

export function isDungeonId(id: unknown): id is DungeonId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(DUNGEONS, id);
}
