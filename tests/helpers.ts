import { FakeClock } from '../src/client/clock';
import { LocalGameClient } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { CommandInput } from '../src/client/types';
import { makeItem } from '../src/engine/inventory';
import { ATTRIBUTE_POINTS, applyCommand, type AttributeKey, BUILDING_IDS, BUILDINGS, type BuildingId, type Command, type CombatSide, ENGINE_VERSION, type GameState, getDerivedStats, type EquipmentSlot, newGame, type ReplayEntry, v12SkillProgress } from '../src/engine';

export const T0 = Date.UTC(2026, 9, 25, 12, 0, 0); // fixed epoch for deterministic tests
export const SEC = 1000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;

export function idSource(prefix = 'id') {
  let n = 0;
  let seed = 12345;
  return {
    uuid: () => `${prefix}-${++n}`,
    seed: () => (seed = (seed * 1103515245 + 12345) >>> 0),
  };
}

export function makeClient(opts: { repo?: MemoryGameRepository; clock?: FakeClock; prefix?: string } = {}) {
  const repo = opts.repo ?? new MemoryGameRepository();
  const clock = opts.clock ?? new FakeClock(T0);
  const client = new LocalGameClient(repo, clock, idSource(opts.prefix));
  return { repo, clock, client };
}

let cmdN = 0;
export function cmd(c: CommandInput): Command {
  return { ...c, id: `cmd-${++cmdN}` } as Command;
}

export function apply(state: GameState, c: CommandInput, now: number): GameState {
  const res = applyCommand(state, cmd(c), now);
  if (!res.ok) throw new Error(`${res.error.code}: ${res.error.message}`);
  return res.state;
}

/**
 * The state with buildings marked built and their build effects applied (the Training Grounds raise the training
 * tier to at least 1), as a real build would leave it; no gold or items are spent. For engine tests of the rules
 * inside a building; BUILD itself is tested in tests/buildings.test.ts.
 */
export function withBuilt(state: GameState, ids: readonly BuildingId[] = BUILDING_IDS): GameState {
  const buildings = { ...state.buildings };
  let training = state.training;
  for (const id of ids) {
    buildings[id] = { state: 'built', level: 1 };
    const tier = BUILDINGS[id].grantsTrainingTier;
    if (tier !== undefined && training.tier < tier) training = { ...training, tier };
  }
  return { ...state, buildings, training };
}

/**
 * A new game as 1.17.0 started it (before the locked start of 1.18.0): 25 gold and the Merchant built (Lv1, the same
 * starter stock and full charges). The golden scripts written before 1.18.0 begin here so their outcomes stay what they
 * were; only their hashes moved (save v18 has the `storage` building). Storage stays unbuilt (a v17 save migrates so).
 */
export function v17Start(seed: number, now: number): GameState {
  const s = newGame(seed, now);
  return { ...s, character: { ...s.character, gold: 25 }, buildings: { ...s.buildings, merchant: { state: 'built', level: 1 } } };
}

/** newGame() with every building already built (see withBuilt): Training Tier 1 comes with the Training Grounds. */
export function builtGame(seed: number, now: number): GameState {
  return withBuilt(newGame(seed, now));
}

/**
 * Builds buildings through the client with logged DEBUG_BUILD rows, so the log still replays. Sets debugUsed;
 * the Training Grounds also grant Training Tier 1. Default: Woodcutting and Mine Shaft.
 */
export async function debugBuild(client: LocalGameClient, ids: readonly BuildingId[] = ['woodcutting', 'mine_shaft']) {
  for (const id of ids) {
    const r = await client.debug.build(id);
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  }
}

/** New game at T0 (buildings built) with woodcutting running. */
export function woodcuttingGame(seed = 42): GameState {
  return apply(builtGame(seed, T0), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0);
}

export function qty(state: GameState, id: string): number {
  return state.inventory.items.find((i) => i.id === id)?.quantity ?? 0;
}

/** Hand-written log rows, stamped with the current engine (replayLog requires every row's engineVersion). */
export function current(rows: ReplayEntry[]): ReplayEntry[] {
  return rows.map((r) => ({ engineVersion: ENGINE_VERSION, ...r }));
}

/** Banked time of a gathering or dungeon activity (training keeps its progress per attribute instead). */
export function progressMs(state: GameState): number | undefined {
  const a = state.activity;
  return a && 'progressMs' in a ? a.progressMs : undefined;
}

/**
 * Skills as the migrations leave them: v11 → v12 (total XP kept, level recomputed on the 1.12.0 skill curve), then
 * v12 → v13 (the unused `smithing` skill dropped).
 */
export function v12Skills<T extends Record<string, unknown>>(skills: T): T {
  return Object.fromEntries(Object.entries(skills).filter(([k]) => k !== 'smithing').map(([k, v]) => [k, v12SkillProgress(v)])) as T;
}

/** What the v12 → v13 migration adds to a document (frozen: Crafting locked, 2 of 8 pipes open, idle, empty ledger). */
export const V13_ADDED = {
  crafting: { pipesUnlocked: 2, pipes: [null, null, null, null, null, null, null, null], remainders: {}, nextJobSerial: 1 },
  craftingBuilding: { state: 'locked', level: 0 },
} as const;

/** What the v17 → v18 migration adds (1.18.0): Storage, unbuilt. Frozen literal. */
export const V18_ADDED = { storageBuilding: { state: 'locked', level: 0 } } as const;

/**
 * A state (or save document) without the v13 → v14 additions: no `quality` / `rarity` on any equipped item, inventory
 * item or merchant listing, at save 13. Tests written before 1.14.0 compare migrated saves in this shape: the v14 step
 * only adds the default gear roll (25% / common, see tests/migrationV14.test.ts).
 */
export function withoutGearRolls<T>(s: T): T {
  const strip = (x: unknown) => {
    if (!x || typeof x !== 'object') return x;
    const { quality: _q, rarity: _r, ...rest } = x as Record<string, unknown>;
    return rest;
  };
  const d = JSON.parse(JSON.stringify(s)) as Record<string, any>;
  if (d.character?.equipment) for (const k of Object.keys(d.character.equipment)) d.character.equipment[k] = strip(d.character.equipment[k]);
  if (Array.isArray(d.inventory?.items)) d.inventory.items = d.inventory.items.map(strip);
  if (Array.isArray(d.merchant?.stock)) d.merchant.stock = d.merchant.stock.map(strip);
  if (d.saveVersion === 14) d.saveVersion = 13;
  return d as T;
}

/**
 * The state with these CORE points (training levels; xp and progress 0). Since 1.16.0 core points drive WS / MS (STR) and
 * the DEX / INT time curves; stored extra points (character.attributes) only add to the totals.
 */
export function withCore(state: GameState, core: Partial<Record<AttributeKey, number>>): GameState {
  const attributes = { ...state.training.attributes };
  for (const [k, level] of Object.entries(core) as [AttributeKey, number][]) attributes[k] = { level, xp: 0, progressMs: 0 };
  return { ...state, training: { ...state.training, attributes } };
}

/**
 * What the v16 → v17 migration adds to a character (1.17.0): nothing spent, 5 unspent points per level above 1, mana full
 * at the 1.16.0 max (20 + 5 per level above 1). Spread it over a raw older character to get the migrated one.
 */
export function v17Added(level: number) {
  return {
    spentPoints: { strength: 0, dexterity: 0, endurance: 0, intelligence: 0 },
    unspentPoints: 5 * (level - 1),
    mana: 20 + 5 * (level - 1),
    manaRegenProgress: 0,
  };
}

/** What the v15 → v16 migration does to stored attributes: they become extra normal points, max(0, old − 10). */
export function v16Attributes<T extends Record<string, number>>(attributes: T): T {
  return Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k, Math.max(0, v - 10)])) as T;
}

/** A combat side with the 1.19.0 fields neutral (no magic, no crits): override what a test is about. */
export function fightSide(s: Partial<CombatSide> = {}): CombatSide {
  return { damage: { min: 1, max: 1 }, armor: 0, magicDamage: 0, magicResist: 0, critChanceBp: 0, critMultBp: 10_000, attackIntervalMs: 1000, skills: [], ...s };
}

/**
 * What the v18 → v19 migration does to a raw older character: the banked HP / mana regen moves to the finer unit (×100).
 * Tests that compare a migrated old fixture with its raw document wrap the raw character in this.
 */
export function v19Regen<C extends { hpRegenProgress?: number; manaRegenProgress?: number }>(character: C): C {
  return { ...character, hpRegenProgress: (character.hpRegenProgress ?? 0) * 100, manaRegenProgress: (character.manaRegenProgress ?? 0) * 100 };
}

/**
 * What the v18 → v19 and v19 → v20 migrations do to a raw older `dungeon` slice: every strike of the last fight's log gets
 * `crit: false`, `physical` = the damage dealt and `magic: 0` (exactly what a 1.18.0 strike was), and the boss kill counters start
 * empty (`bosses: {}`, v20; the logs need nothing more, the v20 log fields only exist when they apply).
 */
export function v19Dungeon<D extends { lastFight: { log: { dealt: number }[] } | null }>(dungeon: D): D & { bosses: Record<string, never> } {
  if (!dungeon.lastFight) return { ...dungeon, bosses: {} };
  const log = dungeon.lastFight.log.map((e) => ({ ...e, crit: false, physical: e.dealt, magic: 0 }));
  return { ...dungeon, lastFight: { ...dungeon.lastFight, log }, bosses: {} };
}

// ---------- first boss (1.20.0) ----------

export type BossBuild = 'STR' | 'DEX' | 'END' | 'INT' | 'balanced' | 'STR+END';
const BUILD_KEYS = { STR: 'strength', DEX: 'dexterity', END: 'endurance', INT: 'intelligence' } as const;
const IRON_SET: [EquipmentSlot, string][] = [
  ['weapon', 'iron_sword'],
  ['helmet', 'iron_helm'],
  ['armor', 'iron_chestplate'],
  ['shield', 'iron_shield'],
  ['gloves', 'iron_gloves'],
  ['boots', 'iron_boots'],
];

/**
 * A built game whose hero is `level` with every level-up point spent by `build` (no core, no training), wearing the whole Iron set at
 * `quality`, at full HP. `STR+END` splits the points evenly between STR and END (the remainder to STR). The tests and the balance
 * sim (tests/balanceSimBoss.test.ts) use the same hero.
 */
export function bossHero(level: number, build: BossBuild, quality = 25, rarity: 'common' | 'uncommon' | 'rare' = 'common'): GameState {
  const points = ATTRIBUTE_POINTS.unspentPerLevel * (level - 1);
  const spent = { strength: 0, dexterity: 0, endurance: 0, intelligence: 0 };
  if (build === 'balanced') {
    const q = Math.floor(points / 4);
    spent.strength = spent.dexterity = spent.endurance = spent.intelligence = q;
    spent.strength += points - 4 * q;
  } else if (build === 'STR+END') {
    spent.endurance = Math.floor(points / 2);
    spent.strength = points - spent.endurance;
  } else {
    spent[BUILD_KEYS[build]] = points;
  }
  const s = builtGame(1, T0);
  const equipment = { ...s.character.equipment };
  for (const [slot, defId] of IRON_SET) equipment[slot] = makeItem(defId, 1, `${defId}#hero`, { quality, rarity });
  const withGear: GameState = { ...s, character: { ...s.character, level, unspentPoints: 0, spentPoints: spent, equipment } };
  return { ...withGear, character: { ...withGear.character, hp: getDerivedStats(withGear).maxHp.value } };
}

/** The state with `wins` lifetime Troll Bridge wins on the books (50 opens the Troll Chieftain), no debug command used. */
export function withTrollBridgeWins(state: GameState, wins = 50): GameState {
  const before = state.dungeon.byDungeon.troll_bridge ?? { runs: 0, wins: 0, losses: 0 };
  return { ...state, dungeon: { ...state.dungeon, byDungeon: { ...state.dungeon.byDungeon, troll_bridge: { ...before, runs: before.runs + wins, wins: before.wins + wins } } } };
}

/** An unbeatable hero (huge STR): kills the Troll Chieftain with his first strike, before it acts. Boss unlocked, full HP. */
export function bossSlayer(seed = 1): GameState {
  const base = withTrollBridgeWins(builtGame(seed, T0));
  const s: GameState = { ...base, character: { ...base.character, spentPoints: { ...base.character.spentPoints, strength: 5000 } } };
  return { ...s, character: { ...s.character, hp: getDerivedStats(s).maxHp.value } };
}
