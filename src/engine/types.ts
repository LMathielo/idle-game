// Core game data model. Pure TypeScript: no React, no I/O.
// These shapes are what the engine (and later the server) will own.
// The whole GameState is one JSON document (see docs/ENGINE.md), so every
// field must stay JSON-serializable: no Dates, Maps, classes or undefined values.

/** The hero's attributes, in display order. Single source: AttributeKey derives from it. */
export const ATTRIBUTE_KEYS = ['strength', 'dexterity', 'endurance', 'intelligence'] as const;

export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

/**
 * Plain integers. `character.attributes` holds the BASE values (10 for a new hero, plus debug points); the
 * training levels in `state.training` add to them. Rules always read effective = base + trained
 * (effectiveAttributes() in src/engine/attributes.ts).
 */
export type Attributes = Record<AttributeKey, number>;

export type EquipmentSlot = 'helmet' | 'amulet' | 'armor' | 'weapon' | 'shield' | 'gloves' | 'ring1' | 'ring2' | 'boots' | 'axe';

/**
 * Item quality (catalog only, by defId). `junk` is sell-only; `common` has a game use (gear, logs, potions);
 * uncommon → legendary are rarity tiers (only the Bird Nest uses one for now).
 */
export const ITEM_QUALITIES = ['junk', 'common', 'uncommon', 'rare', 'epic', 'legendary'] as const;

export type ItemQuality = (typeof ITEM_QUALITIES)[number];

export const EQUIPMENT_SLOTS = ['helmet', 'amulet', 'armor', 'weapon', 'shield', 'gloves', 'ring1', 'ring2', 'boots', 'axe'] as const satisfies readonly EquipmentSlot[];

export type Item = {
  /** Stackable items use their definition id (e.g. `oak_logs`); unique items use an instance id. */
  id: string;
  /**
   * Item definition id (key of ITEMS in config/items.ts). BASE combat stats (damage, armor) are read
   * from the catalog by this id and never copied onto the instance, so balance changes need no save
   * migration. Quality, description and prices are catalog-only too (save v8 dropped the old instance
   * `rarity`). Rolled affixes (M4 loot) will be stored on the instance, since they differ per drop.
   */
  defId: string;
  name: string;
  icon: string; // placeholder glyph until we have pixel sprites
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

/** Gathering skills (config/woodcutting.ts). */
export type GatheringKind = 'woodcutting';

/** Woodcutting trees 1–5, in order. Data lives in config/woodcutting.ts. */
export type TreeId = 'oak' | 'birch' | 'maple' | 'yew' | 'ironwood';

/** Only one activity runs at a time: a gathering skill, auto-repeating dungeon runs, or training one attribute. */
export type ActivityKind = GatheringKind | 'dungeon' | 'training';

/** Dungeon tiers 1–5, in order. Data lives in config/dungeons.ts. */
export type DungeonId = 'rat_cellar' | 'bat_cave' | 'wolf_den' | 'forgotten_crypt' | 'troll_bridge';

export type EnemyId = 'rat' | 'bat' | 'wolf' | 'skeleton' | 'troll';

type ActivityBase = {
  /** Engine time (epoch ms) the activity started. Informational only. */
  startedAt: number;
  /**
   * Time banked into the current log (woodcutting) or the current search (dungeon, search phase; 0 during the
   * fight, whose time is `fight.elapsedMs`), in ms. Never lost between resumes.
   */
  progressMs: number;
};

/** Cuts logs from one tree back-to-back until stopped. Switching tree starts a new log. */
export type WoodcuttingActivity = ActivityBase & { kind: 'woodcutting'; treeId: TreeId };

export type GatheringActivity = WoodcuttingActivity;

/** A run is a search for an opponent, then a live fight. */
export type DungeonPhase = 'search' | 'fight';

/** One side's combat numbers, frozen when the fight starts (gear changed mid-fight counts from the next fight). */
export type CombatSide = {
  damage: { min: number; max: number };
  defense: number;
  /** ms between two strikes; the first strike lands this long after the fight starts. */
  attackIntervalMs: number;
};

/**
 * The fight in progress (save v9). It plays out in engine time inside simulate(): each strike happens at its
 * exact time (strike n of a side at n × its interval; on a tie the hero strikes first), HP regenerates
 * between strikes, and the outcome is applied when it ends. The hero's HP is `character.hp` throughout.
 */
export type ActiveFight = {
  enemyId: EnemyId;
  /** Engine time into the fight, ms. Never lost between resumes. */
  elapsedMs: number;
  heroHpStart: number;
  /** Max HP when the fight started, for the bars. */
  heroMaxHp: number;
  enemyHp: number;
  enemyMaxHp: number;
  hero: CombatSide;
  enemy: CombatSide;
  /** Strikes each side has made so far. The next one is due at (strikes + 1) × attackIntervalMs. */
  heroStrikes: number;
  enemyStrikes: number;
  /** Strikes that have landed so far, in time order. */
  log: FightLogEntry[];
};

/**
 * Auto-repeat: runs follow each other back-to-back until stopped. Stopping loses the current run (in either
 * phase). `fight` is set exactly when `phase` is 'fight'.
 */
export type DungeonActivity = ActivityBase & { kind: 'dungeon'; dungeonId: DungeonId; phase: DungeonPhase; fight: ActiveFight | null };

/**
 * Trains one attribute. Its progress lives in `state.training.attributes[attribute]`, not here, so pausing
 * or switching never loses XP.
 */
export type TrainingActivity = { kind: 'training'; attribute: AttributeKey; startedAt: number };

export type Activity = GatheringActivity | DungeonActivity | TrainingActivity;

// ---------- Training ----------

/** One attribute's training progress. Kept forever (pause, switch, sessions). */
export type AttributeTraining = {
  /** Training level, 0..cap of the current tier. Adds to the base attribute. */
  level: number;
  /** Whole training XP toward the next level (1 XP per trained minute at the base rate). */
  xp: number;
  /** Trained time toward the next XP point, 0..msPerXp − 1. Never lost between resumes. 0 at the cap. */
  progressMs: number;
};

export type TrainingState = {
  /** Unlocked training tier, 0..10. Global for all attributes; tier t allows levels up to 20 × t. 0 = nothing trainable. */
  tier: number;
  attributes: Record<AttributeKey, AttributeTraining>;
};

// ---------- Combat ----------

/** One strike. The engine produces it; the UI only shows or replays it. */
export type FightLogEntry = {
  /** Engine time into the fight when it landed, ms. */
  atMs: number;
  actor: 'hero' | 'enemy';
  /** 1-based: this side's n-th strike. */
  strike: number;
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

/**
 * Why a fight ended: the enemy or the hero reached 0 HP, the fight time limit was reached (a loss), the hero
 * had no HP at the start (an immediate loss with no rolls), or the player stopped the dungeon (or started another
 * activity) during the fight (`forfeit`, a loss).
 */
export type FightEndReason = 'enemy_defeated' | 'hero_defeated' | 'time_limit' | 'no_hp' | 'forfeit';

/** The last finished fight only (saves stay small). Earlier fights live on as counters. */
export type FightRecord = {
  dungeonId: DungeonId;
  enemyId: EnemyId;
  won: boolean;
  endReason: FightEndReason;
  /** Engine time from the fight's start to its end, ms; 0 for a fight that starts at 0 HP. */
  durationMs: number;
  heroHpStart: number;
  heroHpEnd: number;
  /** Max HP at the moment of the fight, for the replay bars. */
  heroMaxHp: number;
  enemyMaxHp: number;
  enemyHpEnd: number;
  rewards: FightRewards;
  log: FightLogEntry[];
};

export type DungeonTotals = { runs: number; wins: number; losses: number };

export type DungeonState = {
  lastFight: FightRecord | null;
  /**
   * Lifetime counters over every dungeon (always the sum of `byDungeon`). `runs + 1` numbers the run in
   * progress, which a skip names, so it stays unique across dungeons.
   */
  totals: DungeonTotals;
  /**
   * Lifetime counters per dungeon (save v5). An entry appears with the dungeon's first run; a missing
   * entry means 0/0/0. Wins only ever go up, so an unlock based on them is permanent.
   */
  byDungeon: Partial<Record<DungeonId, DungeonTotals>>;
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

// ---------- Merchant ----------

/** One merchant stock slot: `quantity` left of `defId` at `unitPrice` gold each (fixed when the stock was rolled). */
export type MerchantListing = { defId: string; quantity: number; unitPrice: number };

export type MerchantState = {
  /** Stored refresh charges, 0..MERCHANT.maxCharges. */
  charges: number;
  /** Time banked toward the next charge. Always 0 while charges are at max. */
  chargeProgressMs: number;
  /** Stock slots (as many as the inventory had when it was rolled); null = empty or bought out. */
  stock: (MerchantListing | null)[];
};

export type GameState = {
  saveVersion: 9;
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
  /** Save v6. Gold-bought tiers and per-attribute training progress. */
  training: TrainingState;
  /** Save v8. Not an activity: buying and selling work while any activity runs. */
  merchant: MerchantState;
  /** Save v8. Serial for unique item instance ids (bought gear: `<defId>#<n>`). Only goes up. */
  nextItemSerial: number;
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
  | { type: 'FIGHT_RESOLVED'; dungeonId: DungeonId; won: boolean }
  /** A dungeon's unlock requirement was just met (a win, or the debug win grant). */
  | { type: 'DUNGEON_UNLOCKED'; dungeonId: DungeonId }
  | { type: 'TRAINING_TIER_UNLOCKED'; tier: number }
  /** One per level gained, also when several levels come in one simulate() call. */
  | { type: 'TRAINING_LEVEL_UP'; attribute: AttributeKey; level: number }
  /** The attribute reached its tier's cap: training stopped by itself. */
  | { type: 'TRAINING_MAXED'; attribute: AttributeKey };

/** What happened during one simulate() call. Shown in the "While you were away" modal. */
export type SimulationSummary = {
  /** Time the clock says passed (0 when the clock moved backwards). */
  requestedMs: number;
  /** Time actually credited (after the offline cap). */
  grantedMs: number;
  /** Gathering actions (logs cut). Per log type: itemsGained / itemsLost under each tree's log item. */
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
  /** Dungeons unlocked during this period, in the order they unlocked. */
  dungeonsUnlocked: DungeonId[];
  /** Training XP (whole points) earned per attribute. */
  trainingXpGained: Partial<Record<AttributeKey, number>>;
  /** Training levels gained per attribute. */
  trainingLevelsGained: Partial<Record<AttributeKey, number>>;
  /** Attributes that hit their tier cap (training stopped), in order. */
  trainingMaxed: AttributeKey[];
  anomalies: ClockAnomalyEvent[];
};
