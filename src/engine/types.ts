// Core game data model. Pure TypeScript: no React, no I/O.
// These shapes are what the engine (and later the server) will own.
// The whole GameState is one JSON document (see docs/ENGINE.md), so every
// field must stay JSON-serializable: no Dates, Maps, classes or undefined values.

/** The hero's attributes, in display order. Single source: AttributeKey derives from it. */
export const ATTRIBUTE_KEYS = ['strength', 'dexterity', 'endurance', 'intelligence'] as const;

export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

/** Plain integers. Raised later by Training (gold + time, M3); read by getDerivedStats(). */
export type Attributes = Record<AttributeKey, number>;

export type EquipmentSlot = 'helmet' | 'amulet' | 'armor' | 'weapon' | 'shield' | 'gloves' | 'ring1' | 'ring2' | 'boots';

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic';

export type Item = {
  /** Stackable items use their definition id (e.g. `oak_logs`); unique items use an instance id. */
  id: string;
  /**
   * Item definition id (key of ITEMS in config/items.ts). BASE combat stats (damage, armor) are read
   * from the catalog by this id and never copied onto the instance, so balance changes need no save
   * migration. Rolled affixes (M4 loot) will be stored on the instance, since they differ per drop.
   */
  defId: string;
  name: string;
  icon: string; // placeholder glyph until we have pixel sprites
  rarity: ItemRarity;
  slot?: EquipmentSlot; // equippable items only
  stackable?: boolean;
  quantity?: number;
};

export type SkillKey = 'woodcutting' | 'mining' | 'fishing' | 'smithing';

/** Anything that levels: the hero and every skill. */
export type LevelProgress = { level: number; xp: number; xpToNext: number };

export type Skill = LevelProgress;

export type Character = {
  name: string;
  title: string;
  level: number;
  xp: number;
  xpToNext: number;
  /**
   * Current HP, 0..maxHp. Max HP is derived (getDerivedStats), never stored. Regenerates in simulate()
   * at 5 + END HP per minute (config/stats.ts); fights spend it. A level-up raises max, not current.
   */
  hp: number;
  /**
   * Regen banked towards the next HP, in "HP·ms per minute" units: each ms adds the regen rate
   * (HP/min) and every 60 000 units is 1 HP. Kept across resumes like stamina's progressMs, and
   * exact even when the rate changes. Always 0 while hp >= maxHp.
   */
  hpRegenProgress: number;
  gold: number;
  attributes: Attributes;
  equipment: Partial<Record<EquipmentSlot, Item>>;
  skills: Record<SkillKey, Skill>;
};

export type Inventory = {
  /** Number of stacks / unique items the inventory can hold. */
  capacity: number;
  items: Item[];
};

/** Seeded PRNG state (mulberry32). `seed` is a uint32 that advances on every draw. */
export type RngState = { seed: number };

/** Gathering skills: one action per interval (config/activities.ts). */
export type GatheringKind = 'woodcutting';

/** Only one activity runs at a time: a gathering skill or auto-repeating dungeon runs. */
export type ActivityKind = GatheringKind | 'dungeon';

export type DungeonId = 'rat_cellar_1';

export type EnemyId = 'rat';

type ActivityBase = {
  /** Engine time (epoch ms) the activity started. Informational only. */
  startedAt: number;
  /** Time banked towards the next action (gathering) or into the current run (dungeon), in ms. Never lost between resumes. */
  progressMs: number;
};

export type GatheringActivity = ActivityBase & { kind: GatheringKind };

/** Auto-repeat: runs follow each other back-to-back until stopped. Stopping loses the current run. */
export type DungeonActivity = ActivityBase & { kind: 'dungeon'; dungeonId: DungeonId };

export type Activity = GatheringActivity | DungeonActivity;

// ---------- Combat ----------

/** One strike. The engine produces it; the UI only replays it. */
export type FightLogEntry = {
  round: number;
  actor: 'hero' | 'enemy';
  /** Raw damage roll, a whole number in [min, max]. */
  roll: number;
  /** Damage after the target's defense (at least 1). */
  dealt: number;
  targetHpAfter: number;
};

export type FightRewards = {
  heroXp: number;
  gold: number;
  /** Items that went into the inventory. */
  items: Record<string, number>;
  /** Items that dropped but did not fit (inventory full). */
  itemsLost: Record<string, number>;
};

/** The last fight only (saves stay small). Earlier fights live on as counters. */
export type FightRecord = {
  dungeonId: DungeonId;
  enemyId: EnemyId;
  won: boolean;
  /** Rounds started; a fight that starts at 0 HP has 0. */
  rounds: number;
  heroHpStart: number;
  heroHpEnd: number;
  /** Max HP at the moment of the fight, for the replay bars. */
  heroMaxHp: number;
  enemyMaxHp: number;
  enemyHpEnd: number;
  rewards: FightRewards;
  log: FightLogEntry[];
};

export type DungeonState = {
  lastFight: FightRecord | null;
  /** Lifetime counters. */
  totals: { runs: number; wins: number; losses: number };
};

export type GameStats = {
  totalActions: number;
  itemsGathered: Record<string, number>;
};

export type GameFlags = {
  /** Set forever once any DEBUG_* command touched this save. A future server can ignore or reset such saves. */
  debugUsed: boolean;
};

/** Pays for skipping dungeon runs. Regenerates in simulate(); see docs/ENGINE.md. */
export type Stamina = {
  current: number;
  /** Per player so a future upgrade can raise it. */
  max: number;
  /** Time banked towards the next point. Always 0 while current >= max. */
  progressMs: number;
};

export type GameState = {
  saveVersion: 4;
  rng: RngState;
  time: {
    /** Engine time up to which the state has been simulated (epoch ms). */
    lastSimulatedAt: number;
    /** Highest clock value ever accepted. Never moves backwards. */
    highestSeenAt: number;
  };
  /** Per player so a future upgrade can raise them. */
  offline: { capMs: number; efficiency: number };
  activity: Activity | null;
  stamina: Stamina;
  dungeon: DungeonState;
  stats: GameStats;
  flags: GameFlags;
  character: Character;
  inventory: Inventory;
};

// ---------- Events & summaries ----------

export type ClockAnomalyEvent =
  | { type: 'CLOCK_ANOMALY'; kind: 'backward'; deltaMs: number }
  | { type: 'CLOCK_ANOMALY'; kind: 'forward_capped'; requestedMs: number; grantedMs: number };

export type GameEvent =
  | ClockAnomalyEvent
  | { type: 'ERROR'; code: 'INVALID_TIME'; message: string }
  | { type: 'ACTIVITY_STARTED'; kind: ActivityKind }
  | { type: 'ACTIVITY_STOPPED'; kind: ActivityKind }
  | { type: 'SKILL_LEVEL_UP'; skill: SkillKey; level: number }
  | { type: 'HERO_LEVEL_UP'; level: number }
  | { type: 'RARE_DROP'; itemId: string }
  | { type: 'DUNGEON_RUN_CANCELLED'; dungeonId: DungeonId }
  | { type: 'FIGHT_RESOLVED'; dungeonId: DungeonId; won: boolean };

/** What happened during one simulate() call. Shown in the "While you were away" modal. */
export type SimulationSummary = {
  /** Time the clock says passed (0 when the clock moved backwards). */
  requestedMs: number;
  /** Time actually credited (after the offline cap). */
  grantedMs: number;
  actions: number;
  itemsGained: Record<string, number>;
  /** Items that did not fit because the inventory had no free slot. */
  itemsLost: Record<string, number>;
  skillXpGained: Partial<Record<SkillKey, number>>;
  skillLevelsGained: Partial<Record<SkillKey, number>>;
  heroXpGained: number;
  heroLevelsGained: number;
  goldGained: number;
  /** Dungeon runs resolved (won + lost). */
  dungeon: { runs: number; wins: number; losses: number };
  anomalies: ClockAnomalyEvent[];
};
