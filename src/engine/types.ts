// Core game data model. Pure TypeScript: no React, no I/O.
// These shapes are what the engine (and later the server) will own.
// The whole GameState is one JSON document (see docs/ENGINE.md), so every
// field must stay JSON-serializable: no Dates, Maps, classes or undefined values.

export type AttributeKey = 'strength' | 'dexterity' | 'agility' | 'constitution' | 'charisma' | 'intelligence';

export type Attributes = Record<AttributeKey, number>;

export type EquipmentSlot = 'helmet' | 'amulet' | 'armor' | 'weapon' | 'shield' | 'gloves' | 'ring1' | 'ring2' | 'boots';

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic';

export type Item = {
  /** Stackable items use their definition id (e.g. `oak_logs`); unique items use an instance id. */
  id: string;
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
  hp: number;
  maxHp: number;
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

export type ActivityKind = 'woodcutting';

export type Activity = {
  kind: ActivityKind;
  /** Engine time (epoch ms) the activity started. Informational only. */
  startedAt: number;
  /** Time banked towards the next action, in ms. Never lost between resumes. */
  progressMs: number;
};

export type GameStats = {
  totalActions: number;
  itemsGathered: Record<string, number>;
};

export type GameState = {
  saveVersion: 1;
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
  stats: GameStats;
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
  | { type: 'RARE_DROP'; itemId: string };

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
  anomalies: ClockAnomalyEvent[];
};
