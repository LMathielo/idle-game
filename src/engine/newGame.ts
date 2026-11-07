import { merchantStockSlots } from './bonuses';
import { newBuildingsState } from './buildings';
import { newCraftingState } from './crafting';
import { DUNGEON_TIERS } from './config/dungeons';
import { STARTING_HERO } from './config/newGame';
import { INVENTORY_CAPACITY } from './config/items';
import { STAMINA } from './config/stamina';
import { DEFAULT_OFFLINE_CAP_MS, DEFAULT_OFFLINE_EFFICIENCY } from './config/time';
import { HERO_XP_CURVE, SKILL_XP_CURVE } from './config/xpCurve';
import { maxHpOf } from './hp';
import { maxManaOf } from './mana';
import { makeItem, placeInBag } from './inventory';
import { newMerchantState } from './merchant';
import { newProgress } from './progression';
import { createRng } from './rng';
import { newTrainingState } from './training';
import { newWorkersState } from './workers';
import type { Character, GameState, Inventory, SkillKey } from './types';
import { CURRENT_SAVE_VERSION } from './migrations';

/** Fresh level-1 hero. `seed` is any uint32, `now` the engine time in epoch ms. */
export function newGame(seed: number, now: number): GameState {
  if (!Number.isFinite(seed)) throw new RangeError(`newGame: invalid seed ${seed}`);
  if (!Number.isFinite(now)) throw new RangeError(`newGame: invalid time ${now}`);

  const equipment: Character['equipment'] = {};
  for (const defId of STARTING_HERO.equipment) {
    const item = makeItem(defId, 1, `start-${defId}`);
    if (item.slot) equipment[item.slot] = item;
  }

  const skills = {} as Record<SkillKey, ReturnType<typeof newProgress>>;
  for (const k of STARTING_HERO.skills) skills[k] = newProgress(SKILL_XP_CURVE);

  const hero = newProgress(HERO_XP_CURVE);
  const inventory: Inventory = { capacity: INVENTORY_CAPACITY, items: [] };
  for (const s of STARTING_HERO.inventory) placeInBag(inventory, makeItem(s.itemId, s.quantity));
  const attributes = { ...STARTING_HERO.attributes };
  const training = newTrainingState();
  const buildings = newBuildingsState();
  const spentPoints = { strength: 0, dexterity: 0, endurance: 0, intelligence: 0 };
  const pools = { character: { level: hero.level, attributes, spentPoints, equipment }, training };
  const maxHp = maxHpOf(pools);
  const maxMana = maxManaOf(pools);

  return {
    saveVersion: CURRENT_SAVE_VERSION,
    rng: createRng(seed),
    time: { lastSimulatedAt: now, highestSeenAt: now },
    offline: { capMs: DEFAULT_OFFLINE_CAP_MS, efficiency: DEFAULT_OFFLINE_EFFICIENCY },
    activity: null,
    stamina: { current: STAMINA.startMax, max: STAMINA.startMax, progressMs: 0 },
    dungeon: {
      lastFight: null,
      totals: { runs: 0, wins: 0, losses: 0 },
      byDungeon: {},
      bosses: {},
      harder: { hard: { byDungeon: {}, bosses: {} }, extreme: { byDungeon: {}, bosses: {} } },
      difficulty: Object.fromEntries(DUNGEON_TIERS.map((t) => [String(t.tier), 'normal' as const])),
    },
    training,
    merchant: newMerchantState(merchantStockSlots({ buildings })),
    buildings,
    construction: null,
    workers: newWorkersState(),
    crafting: newCraftingState(),
    potionCooldowns: {},
    nextItemSerial: 1,
    stats: { totalActions: 0, itemsGathered: {} },
    flags: { debugUsed: false },
    character: {
      name: STARTING_HERO.name,
      title: STARTING_HERO.title,
      level: hero.level,
      xp: hero.xp,
      xpToNext: hero.xpToNext,
      hp: maxHp,
      hpRegenProgress: 0,
      mana: maxMana,
      manaRegenProgress: 0,
      gold: STARTING_HERO.gold,
      attributes,
      spentPoints,
      unspentPoints: 0,
      equipment,
      skills,
    },
    inventory,
    storage: { items: [] },
  };
}
