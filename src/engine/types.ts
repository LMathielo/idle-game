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

export type EquipmentSlot = 'helmet' | 'amulet' | 'armor' | 'weapon' | 'shield' | 'gloves' | 'ring1' | 'ring2' | 'boots' | 'axe' | 'pickaxe';

/**
 * Item quality (catalog only, by defId). `junk` is sell-only; `common` has a game use (gear, logs, potions);
 * uncommon → legendary are rarity tiers (only the Bird Nest uses one for now).
 */
export const ITEM_QUALITIES = ['junk', 'common', 'uncommon', 'rare', 'epic', 'legendary'] as const;

export type ItemQuality = (typeof ITEM_QUALITIES)[number];

export const EQUIPMENT_SLOTS = ['helmet', 'amulet', 'armor', 'weapon', 'shield', 'gloves', 'ring1', 'ring2', 'boots', 'axe', 'pickaxe'] as const satisfies readonly EquipmentSlot[];

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

/** Skills on the Hero tab. `smithing` was removed in save v13 (crafting has no skill). */
export type SkillKey = 'woodcutting' | 'mining' | 'fishing';

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

/** Gathering skills (config/woodcutting.ts, config/mining.ts). */
export type GatheringKind = 'woodcutting' | 'mining';

/** Woodcutting trees 1–5, in order. Data lives in config/woodcutting.ts. */
export type TreeId = 'oak' | 'birch' | 'maple' | 'yew' | 'ironwood';

/** Mine Shaft rocks 1–5, in order. Data lives in config/mining.ts. */
export type RockId = 'stone' | 'copper' | 'iron' | 'silver' | 'gold';

/** Only one activity runs at a time: a gathering skill, auto-repeating dungeon runs, or training one attribute. */
export type ActivityKind = GatheringKind | 'dungeon' | 'training';

/** Dungeon tiers 1–5, in order. Data lives in config/dungeons.ts. */
export type DungeonId = 'rat_cellar' | 'bat_cave' | 'wolf_den' | 'forgotten_crypt' | 'troll_bridge';

export type EnemyId = 'rat' | 'bat' | 'wolf' | 'skeleton' | 'troll';

type ActivityBase = {
  /** Engine time (epoch ms) the activity started. Informational only. */
  startedAt: number;
  /**
   * Time banked into the current log (woodcutting), the current ore (mining) or the current search (dungeon, search phase; 0 during the
   * fight, whose time is `fight.elapsedMs`), in ms. Never lost between resumes.
   */
  progressMs: number;
};

/** Cuts logs from one tree back-to-back until stopped. Switching tree starts a new log. */
export type WoodcuttingActivity = ActivityBase & { kind: 'woodcutting'; treeId: TreeId };

/** Mines one rock back-to-back until stopped. Switching rock starts a new ore. */
export type MiningActivity = ActivityBase & { kind: 'mining'; rockId: RockId };

export type GatheringActivity = WoodcuttingActivity | MiningActivity;

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

// ---------- Buildings (save v10) ----------

/**
 * Village buildings stored in the save. Woodcutting, Mine Shaft, Town Hall and Training Grounds have to be built
 * before use; the Merchant is always built (save v11, so it can be upgraded). Dungeon and Storage are always there
 * and are not stored. Requirements and upgrade costs are data (config/buildings.ts).
 */
export type BuildingId = 'woodcutting' | 'mine_shaft' | 'town_hall' | 'training_grounds' | 'merchant' | 'crafting';

export type BuildingStatus = 'locked' | 'built';

/** `level` is 0 while locked and 1 once built; upgrades raise it up to BUILDING_MAX_LEVEL (save v11). */
export type BuildingState = { state: BuildingStatus; level: number };

/**
 * The one builder's job (save v11): an upgrade of `buildingId` to `level`, paid up front. It progresses in
 * simulate() on the granted (capped) time, like every activity, and completes when `progressMs` reaches
 * `durationMs` (fixed when it started). It never blocks the hero's activity. No cancel.
 */
export type Construction = { buildingId: BuildingId; level: number; durationMs: number; progressMs: number; startedAt: number };

// ---------- Workers (save v11) ----------

/** A node workers can be assigned to: any tree or rock (tree and rock ids never overlap). */
export type WorkerNodeId = TreeId | RockId;

/** One hired worker. `node` null = unassigned (costs nothing). */
export type Worker = { id: string; node: WorkerNodeId | null };

/**
 * The crew on one node (every worker assigned to it). It works on the node's base action time (no DEX); its timer
 * only runs while it works. `workMs` = worker·ms worked during the current action, so the yield reflects the
 * average crew size over the action. `idle` = the hero can't work this node right now (power or level below its
 * requirement): the crew stays assigned and waits.
 */
export type CrewState = { progressMs: number; workMs: number; idle: boolean };

export type WorkersState = {
  /** Hired workers, in hiring order. */
  list: Worker[];
  /** Serial for worker ids (`w<n>`). Only goes up. */
  nextSerial: number;
  /** One entry per node with at least one assigned worker. */
  crews: Partial<Record<WorkerNodeId, CrewState>>;
  /** Upkeep could not be paid: every crew waits until gold covers it again. */
  paused: boolean;
  /** Paid work left in the current upkeep minute, ms (0 = the next minute is due). */
  minuteLeftMs: number;
  /** Upkeep per minute already paid for the current minute (a crew joining mid-minute pays the difference). */
  paidPerMin: number;
};

// ---------- Crafting (save v13) ----------

/** x1 crafts the recipe as written; x10 crafts ten times the inputs and output in the same time (stamina per craft). */
export type CraftMode = 'x1' | 'x10';

/**
 * A pipe's job state. `running`: the current craft's timer runs. `held`: the current craft finished but its output did
 * not fit (no stack, no free slot); the timer is held and the output is delivered as soon as room appears. `ready`:
 * reserved for gear crafting (PR B: a single rolled item waiting for a Done tap); nothing produces it yet.
 */
export type CraftJobStatus = 'running' | 'held' | 'ready';

/**
 * One crafting job in a pipe: `quantity` crafts of `recipeId`, back to back. Every input (and, in x10 mode, every
 * craft's stamina) was paid when the job started. Each craft's duration is fixed when that craft starts (`craftMs`), so
 * a house upgrade or trained INT counts from the next craft. Output goes to the inventory as each craft finishes.
 */
export type CraftJob = {
  /** Job serial (`crafting.nextJobSerial` when it started): commands name the job they were shown. */
  id: number;
  recipeId: string;
  mode: CraftMode;
  /** Crafts in the job, ≥ 1. */
  quantity: number;
  /** Crafts finished and delivered, 0..quantity − 1 while the job exists. The current craft is number done + 1. */
  done: number;
  /** Duration of the current craft, ms (fixed when it started). */
  craftMs: number;
  /** Time into the current craft, ms (= craftMs while held). */
  progressMs: number;
  /** Stamina paid per craft at job start (x10 mode; 0 in x1): a cancel refunds it for the crafts not yet started. */
  staminaPerCraft: number;
  status: CraftJobStatus;
  /** Engine time the job started. Informational only. */
  startedAt: number;
};

export type CraftingState = {
  /** Open pipes (2 on a new save, up to 8). Pipe i (0-based) is open when i < pipesUnlocked. */
  pipesUnlocked: number;
  /** One entry per pipe slot (8): its job, or null when idle. */
  pipes: (CraftJob | null)[];
  /**
   * Hidden yield fractions per output item, in thousandths (the house's yield bonus): when one reaches 1000 it adds one
   * more item and keeps the rest. Missing = 0. No RNG.
   */
  remainders: Record<string, number>;
  /** Serial for job ids. Only goes up. */
  nextJobSerial: number;
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
  saveVersion: 13;
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
  /** Save v10. Every stored building (BuildingId), locked or built, with its level (upgrades since save v11). */
  buildings: Record<BuildingId, BuildingState>;
  /** Save v11. The one builder's current upgrade, or null when the builder is idle. */
  construction: Construction | null;
  /** Save v11. Hired workers and their crews (Town Hall). */
  workers: WorkersState;
  /** Save v13. The Crafting house's pipes and the yield fraction ledger. Not an activity: runs beside everything. */
  crafting: CraftingState;
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
  | { type: 'TRAINING_MAXED'; attribute: AttributeKey }
  | { type: 'BUILDING_BUILT'; buildingId: BuildingId }
  /** UPGRADE_BUILDING paid and the builder started. */
  | { type: 'CONSTRUCTION_STARTED'; buildingId: BuildingId; level: number }
  /** The builder finished: the building is now at `level`. */
  | { type: 'BUILDING_UPGRADED'; buildingId: BuildingId; level: number }
  | { type: 'WORKER_HIRED'; workerId: string }
  /** The hero can no longer work this node (an equip change): its crew waits, still assigned. */
  | { type: 'CREW_IDLE'; node: WorkerNodeId }
  /** The hero can work this node again: its idle crew resumes. */
  | { type: 'CREW_ACTIVE'; node: WorkerNodeId }
  /** Gold can't cover the next minute of upkeep: every crew waits. */
  | { type: 'WORKERS_PAUSED'; upkeepDue: number }
  /** Upkeep is covered again: the crews resume. */
  | { type: 'WORKERS_RESUMED' }
  /** START_CRAFT paid and the pipe started its job. */
  | { type: 'CRAFT_STARTED'; pipe: number; jobId: number; recipeId: string; quantity: number; mode: CraftMode }
  /** One craft finished and its output went into the inventory. */
  | { type: 'CRAFT_COMPLETED'; pipe: number; jobId: number; itemId: string; quantity: number }
  /** A craft finished but its output does not fit: the pipe waits for room (nothing is lost). */
  | { type: 'CRAFT_HELD'; pipe: number; jobId: number }
  /** The job's last craft was delivered: the pipe is idle. */
  | { type: 'CRAFT_JOB_DONE'; pipe: number; jobId: number }
  /** CANCEL_CRAFT: the job ended early, unfinished crafts refunded. */
  | { type: 'CRAFT_JOB_CANCELLED'; pipe: number; jobId: number }
  | { type: 'PIPE_UNLOCKED'; pipes: number };

/** What happened during one simulate() call. Shown in the "While you were away" modal. */
export type SimulationSummary = {
  /** Time the clock says passed (0 when the clock moved backwards). */
  requestedMs: number;
  /** Time actually credited (after the offline cap). */
  grantedMs: number;
  /** Logs cut (woodcutting). Per log type: itemsGained / itemsLost under each tree's log item. */
  actions: number;
  /** Ores mined (mining, save v10). Per ore type: itemsGained / itemsLost under each rock's ore item. */
  oresMined: number;
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
  /** Upgrades the builder finished during this period, in order (save v11). */
  buildingsUpgraded: { buildingId: BuildingId; level: number }[];
  /** Actions completed by worker crews (save v11). Their items are under workerItemsGained / workerItemsLost. */
  workerActions: number;
  workerItemsGained: Record<string, number>;
  /** Worker items that did not fit (inventory full). */
  workerItemsLost: Record<string, number>;
  /** Gold paid in worker upkeep during this period. */
  upkeepPaid: number;
  /** Crafts finished by the Crafting house's pipes (save v13); their items per output type in itemsCrafted. */
  craftsCompleted: number;
  itemsCrafted: Record<string, number>;
  anomalies: ClockAnomalyEvent[];
};
