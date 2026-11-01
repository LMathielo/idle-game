// Golden tests: if one of these changes, the rules changed outcomes.
// Bump ENGINE_VERSION (src/engine/version.ts), check the change is intended, then update the hash.
// History: 1.1.0 → 1.2.0 (2026-10-26): save v3 (4 attributes, item defIds, no stored hp, stamina). The
// script gained stamina and attribute debug commands so stamina regen and the clock rules are pinned too.
// 1.2.0 → 1.3.0 (2026-10-26): save v4 (current HP + regen, dungeon state). Woodcutting outcomes did not
// change (same actions, levels, nests and stamina in the first part of the script); the hash changed
// because of the new fields. The script gained a dungeon segment: start, skip, HP debug, 3h of auto-repeat
// runs, then woodcutting cancels the run in progress. Council round 1 (still 1.3.0, save v4 not shipped):
// FightRecord gained `endReason` and SKIP_DUNGEON_RUN carries `run` + `maxCost`; the hash changed
// for that field only (same runs, wins, gold, HP and stamina).
// 1.3.0 → 1.4.0 (2026-10-26): save v5 (dungeon tiers 1–5, per-dungeon counters, `rat_cellar_1` renamed
// `rat_cellar`). Rat Cellar outcomes did not change (same 38 runs/wins, gold 162, HP, stamina and level
// at the end of the old script); the hash changed because of the new `byDungeon` field and the id. The
// script gained a tier segment: DEBUG_ADD_DUNGEON_WINS unlocks Bat Cave, a locked Wolf Den start is
// refused, then 2 h of Bat Cave runs.
// 1.4.0 → 1.5.0 (2026-10-26): save v6 (training state: gold-bought tiers, per-attribute training levels;
// effective attributes = base + trained feed every rule). Every outcome of the 1.4.0 script is unchanged (a
// golden test pins it: same actions, runs, gold, HP, stamina, levels, loot); the hash changed because of the
// new `training` field. The script gained a training segment: Tier 1 bought, STR trained 30 min, switch to
// END, debug XP and gold, Tier 2 bought, 10 h capped training, debug XP to the cap (auto-stop), then a Rat
// Cellar hour with the trained attributes.
// 1.5.0 → 1.6.0 (2026-10-27): save v7 (woodcutting trees, woodcutting strength, axe slot with the Wooden Axe,
// stamina speed-up for training). The old 3 s / 10 XP woodcutting rule is gone: the woodcutting segment now
// cuts Oak (1:50 per log, 25 XP), so far fewer logs and nest rolls happen and the seeded RNG stream shifts. The
// earlier pins were re-pinned: dungeon runs, wins, levels, HP and stamina are unchanged, gold differs (the
// gold rolls draw from a shifted RNG stream). The script gained a 1.6.0 segment: Oak (cancels the Rat Cellar
// run), a bound SKIP_WOODCUT, DEBUG_ADD_WOODCUTTING_LEVEL ×4, switch to Birch (WS 106 ≥ 100), 2 h of Birch,
// then STR training with SPEEDUP_TRAINING +10 min and "to next level".
// 1.6.0 → 1.7.0 (2026-10-27): save v8 (merchant: refresh charges, stock, buy/sell; equip/unequip/use; item
// quality is catalog-only, so instances lost their `rarity`). Every 1.6.0 outcome is unchanged (a golden test
// pins the whole 1.6.0 script); the hash changed because of the new `merchant` / `nextItemSerial` fields and
// the dropped `rarity`. The script gained a 1.7.0 segment: debug gold, buy 3 potions and the Iron Axe, equip it
// (the Wooden Axe returns), HP debug + potion, sell logs and the Wooden Axe, refresh, 5 h of charge regen,
// debug charge, and a buy while woodcutting runs.
// 1.7.0 → 1.8.0 (2026-10-27): save v9 (live combat: a run is a search, then a fight that plays out in engine
// time; hero XP curve base 100; Rat XP 35; searches 2/3/5/8/12 min). Outcomes changed on purpose, so every pin
// was re-pinned. The script's first skip now names the run and cost on screen mid-search (the old fixed
// `run: 1, maxCost: 3` two minutes in would land after the 1:50 search), and the debug XP grant is 16k instead
// of 250k so the hero stays around Lv11 on the new curve. The script gained a 1.8.0 segment: Rat
// Cellar (cancels the Birch log), a search skip, a simulate boundary mid-fight, a debug HP change mid-fight, then
// 1 h of search + fight runs.
// 1.8.0 → 1.9.0 (2026-10-28): save v10 (buildings: Woodcutting, Mine Shaft, Town Hall and Training Grounds start
// locked; mining and the pickaxe slot; a fight in progress at the offline cap is finished). The script builds
// Woodcutting with DEBUG_BUILD before its first log, and builds the Training Grounds with DEBUG_BUILD instead of
// buying Tier 1 (the building comes with Tier 1), so every later gold value is 100 higher; nothing else in the
// earlier script changed (same actions, runs, wins, levels, HP, stamina, loot, training). The merchant now stocks
// the Iron Pickaxe after the Iron Axe, so the Iron Helm buy names slot 4. The script gained a 1.9.0 segment: a real
// BUILD of the Mine Shaft, 1 h of Stone, a bound SKIP_MINE, debug mining levels, the Iron Pickaxe bought and
// equipped for Copper, the Wooden Pickaxe re-equipped (Copper stops: MS too low), a real BUILD of the Town Hall
// (logs, stone and gold consumed), then the Rat Cellar and 20 h away (capped).
// 1.9.0 → 1.10.0 (2026-10-28): save v11 (building upgrades and the builder, workers, the Merchant as a building).
// Power-based yield (items per action = power ÷ requirement, the fraction rolled: one more RNG draw per log and ore;
// Oak and Stone need 20), so every pin was re-pinned (more logs, a shifted RNG stream, different gold). Refreshes now
// roll the merchant stock (seeded): the script's Iron Helm buy after the refreshes became the Iron Gloves that slot
// holds now (the Iron Pickaxe buy still finds it in slot 2). The script gained a 1.10.0 segment: two hires, crews on
// Oak and Stone during Rat Cellar runs, the hero on Oak beside the Oak crew, a real Town Hall upgrade with a simulate
// boundary mid-build, a third worker, then ~10 h away (capped).
// 1.13.0 → 1.14.0 (2026-11-01): save v14 (gear quality and rarity on every gear instance, gear crafting). Gear stats in
// the catalog are 100% maxima and every instance from before is 25% / common, which gives the old numbers. A restock
// now rolls each gear listing's quality and rarity on its own stream (the main RNG does not move), so the script resets
// its gear listings to the 1.13.0 terms after each refresh (`as113Stock`): seen in the v13 shape (`asV13`) the whole
// 1.13.0 script still hashes to the 1.13.0 pin. The script gained a 1.14.0 segment (a real refresh and a rolled buy,
// three gear jobs with invested stamina, a cancel, an insta, ready pipes through 2 h, Done, equip).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getItemDef,
  applyCommand,
  type Command,
  craftJobView,
  craftingView,
  CURRENT_SAVE_VERSION,
  dungeonRunView,
  ENGINE_VERSION,
  type GameState,
  getDerivedStats,
  hashState,
  loadSave,
  newGame,
  newTrainingState,
  RELEASED_ENGINES,
  simulate,
  mineActivityView,
  trainingView,
  woodcutActivityView,
  woodcuttingView,
} from '../src/engine';
import { HOUR, MIN, SEC, T0, v12Skills, withBuilt, withoutGearRolls } from './helpers';

/** End of the 1.5.0 script; the 1.6.0 segment starts here. */
const B = T0 + 47 * HOUR + 411 * SEC + 30 * MIN + 30 * SEC;
/** End of the 1.6.0 script; the 1.7.0 segment starts here. */
const C = B + 7 * SEC + 3 * HOUR + 30 * MIN;
/** End of the 1.7.0 script; the 1.8.0 segment starts here. */
const D = C + 15 * SEC + 6 * HOUR;

/** The search skip the UI would send for the run on screen. */
const skipShown = (id: string) => (s: GameState): Command => {
  const v = dungeonRunView(s)!;
  return { id, type: 'SKIP_DUNGEON_RUN', run: v.run, maxCost: v.skipCost! };
};

/** `id` names a step whose command is built from the state (so tests can stop the script just before it). */
/** A command, a simulate to `at` (no cmd), or (1.14.0) a `patch` of the state made by the test at `at` (no simulate). */
type Step = { at: number; cmd?: Command | ((s: GameState) => Command); id?: string; patch?: (s: GameState) => GameState };

/** End of the 1.8.0 script; the 1.9.0 segment starts here. */
const E = D + 31 * SEC + HOUR;
/** End of the 1.9.0 script; the 1.10.0 segment starts here. */
const F = E + 10 * SEC + 22 * HOUR;
/** End of the 1.10.0 script; the 1.11.0 segment starts here. */
const G = F + 10 * SEC + 12 * HOUR;
/** End of the 1.11.0 script (unchanged in 1.12.0); the 1.13.0 segment starts here. */
const H = G + 4 * SEC + 2 * HOUR;

/** End of the 1.13.0 script; the 1.14.0 segment starts here. */
const I = H + 21 * MIN + 2 * SEC + 9 * HOUR;

/** BUY_ITEM of the first gear listing in the stock at the price shown (1.14.0: gear prices follow the rolled quality). */
const buyFirstGear = (id: string, s: GameState): Command => {
  const slot = s.merchant.stock.findIndex((l) => l?.qualityBp !== undefined);
  const l = s.merchant.stock[slot]!;
  return { id, type: 'BUY_ITEM', slot, defId: l.defId, quantity: 1, maxUnitPrice: l.unitPrice };
};

/** The insta the UI would send for the craft on screen in `pipe`. */
const instaShown = (id: string, pipe: number) => (s: GameState): Command => {
  const j = craftJobView(s, pipe)!;
  return { id, type: 'INSTA_CRAFT', pipe, jobId: j.id, craft: j.craftNumber, maxCost: j.instaCost };
};

/** A START_CRAFT with the stamina cost the screen shows (x10 mode). */
const craftShown = (id: string, pipe: number, recipeId: 'stone_brick', quantity: number) => (s: GameState): Command => {
  const r = craftingView(s).recipes.find((x) => x.recipeId === recipeId)!;
  return { id, type: 'START_CRAFT', pipe, recipeId, quantity, mode: 'x10', maxCost: r.x10StaminaPerCraft * quantity };
};

/**
 * A 1.13.0 state seen in the v12 shape: without the Crafting house and its pipes, with the (never used) smithing skill
 * back, at save v12. For a script that never touches crafting this is exactly what the 1.12.0 engine produced, so its
 * hash must equal the 1.12.0 pin.
 */
function asV12(s: GameState): unknown {
  const { crafting: _c, buildings: { crafting: _b, ...buildings }, character, ...rest } = asV13(s);
  return { ...rest, saveVersion: 12, buildings, character: { ...character, skills: { ...character.skills, smithing: { level: 1, xp: 0, xpToNext: 100 } } } };
}

/**
 * A 1.14.0 state seen in the v13 shape: no `qualityBp` / `rarity` on any gear instance or listing, at save v13. For a
 * script whose gear is all 25% / common (the v14 default) this is exactly what the 1.13.0 engine produced.
 */
function asV13(s: GameState): GameState {
  return withoutGearRolls(s);
}

/**
 * 1.14.0: a restock rolls each gear listing's quality and rarity (on its own stream: the main RNG does not move). The
 * steps written before 1.14.0 buy rolled gear (Iron Gloves, Iron Pickaxe, Iron Shield); to keep their outcomes exactly
 * as the 1.13.0 engine produced them, the script resets the gear listings to the 1.13.0 terms (25%, common, catalog
 * price) right after each of its refreshes. The 1.14.0 segment buys rolled gear for real.
 */
function as113Stock(s: GameState): GameState {
  const stock = s.merchant.stock.map((l) => (l && l.qualityBp !== undefined ? { ...l, qualityBp: 2500, rarity: 'common' as const, unitPrice: getItemDef(l.defId)!.buyPrice! } : l));
  return { ...s, merchant: { ...s.merchant, stock } };
}

const SCRIPT: Step[] = [
  { at: T0, cmd: { id: 'b0', type: 'DEBUG_BUILD', buildingId: 'woodcutting' } }, // 1.9.0: Woodcutting starts locked
  { at: T0 + SEC, cmd: { id: 'g1', type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' } },
  { at: T0 + 37 * MIN },
  { at: T0 + 5 * HOUR },
  { at: T0 + 5 * HOUR + 3 * SEC, cmd: { id: 'g2', type: 'DEBUG_GRANT_HERO_XP', amount: 16_000 } }, // 1.8.0: was 250k on the base-1500 curve; ~Lv11 either way
  { at: T0 + 5 * HOUR + 4 * SEC, cmd: { id: 'g4', type: 'DEBUG_SPEND_STAMINA', amount: 30 } },
  { at: T0 + 5 * HOUR + 5 * SEC, cmd: { id: 'g5', type: 'DEBUG_ADD_ATTRIBUTE', attribute: 'strength', amount: 3 } },
  { at: T0 + 30 * HOUR }, // forward_capped (stamina refills: not bound by the 8h cap)
  { at: T0 + 28 * HOUR }, // backward
  { at: T0 + 28 * HOUR + SEC, cmd: { id: 'g6', type: 'DEBUG_SPEND_STAMINA', amount: 40 } }, // paused clock
  { at: T0 + 31 * HOUR, cmd: { id: 'g3', type: 'STOP_ACTIVITY' } }, // 1h past highestSeenAt: +12
  { at: T0 + 31 * HOUR + 123 * SEC }, // remainder banked
  { at: T0 + 31 * HOUR + 200 * SEC, cmd: { id: 'd1', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' } },
  { at: T0 + 31 * HOUR + 260 * SEC, cmd: skipShown('d2') }, // 0:50 of the search left → 1 stamina; the fight plays live
  { at: T0 + 31 * HOUR + 330 * SEC, cmd: { id: 'd3', type: 'DEBUG_SET_HERO_HP', hp: 1 } },
  { at: T0 + 34 * HOUR + 330 * SEC }, // 3h of runs, HP regen interleaved
  { at: T0 + 34 * HOUR + 400 * SEC, cmd: { id: 'd4', type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' } }, // run lost
  { at: T0 + 34 * HOUR + 401 * SEC, cmd: { id: 'd5', type: 'STOP_ACTIVITY' } },
  // 1.4.0: tiers. 38 Rat Cellar wins already unlock Bat Cave; +10 debug wins in Bat Cave (15 needed for Wolf Den).
  { at: T0 + 34 * HOUR + 402 * SEC, cmd: { id: 't1', type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'bat_cave', amount: 10 } },
  { at: T0 + 34 * HOUR + 403 * SEC, cmd: { id: 't2', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'bat_cave' } },
  { at: T0 + 36 * HOUR + 403 * SEC }, // 2h of Bat Cave runs (DEX 10 → 6:50 each)
  // 1.5.0: training. 1.9.0: the Training Grounds (debug-built) come with Tier 1, which this row used to buy for 100 gold.
  // Training STR cancels the Bat Cave run in progress.
  { at: T0 + 36 * HOUR + 404 * SEC, cmd: { id: 'r1', type: 'DEBUG_BUILD', buildingId: 'training_grounds' } },
  { at: T0 + 36 * HOUR + 405 * SEC, cmd: { id: 'r2', type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' } },
  { at: T0 + 36 * HOUR + 405 * SEC + 30 * MIN + 30 * SEC }, // STR Lv2 (5 + 15 min), 10 XP + 30 s toward Lv3
  { at: T0 + 36 * HOUR + 406 * SEC + 30 * MIN + 30 * SEC, cmd: { id: 'r3', type: 'START_ACTIVITY', kind: 'training', attribute: 'endurance' } },
  { at: T0 + 36 * HOUR + 407 * SEC + 30 * MIN + 30 * SEC, cmd: { id: 'r4', type: 'DEBUG_ADD_TRAINING_XP', xp: 60 } },
  { at: T0 + 36 * HOUR + 408 * SEC + 30 * MIN + 30 * SEC, cmd: { id: 'r5', type: 'DEBUG_ADD_GOLD', amount: 1000 } },
  { at: T0 + 36 * HOUR + 409 * SEC + 30 * MIN + 30 * SEC, cmd: { id: 'r6', type: 'UNLOCK_TRAINING_TIER', tier: 2 } },
  { at: T0 + 46 * HOUR + 409 * SEC + 30 * MIN + 30 * SEC }, // 10 h away: capped at 8 h of END training
  { at: T0 + 46 * HOUR + 410 * SEC + 30 * MIN + 30 * SEC, cmd: { id: 'r7', type: 'DEBUG_ADD_TRAINING_XP', xp: 100_000 } }, // END → 40, stops
  { at: T0 + 46 * HOUR + 411 * SEC + 30 * MIN + 30 * SEC, cmd: { id: 'r8', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' } },
  { at: B }, // 1 h of Rat Cellar with trained STR/END
  // 1.6.0: trees, woodcutting strength, axe, stamina speed-up. Woodcutting Oak cancels the Rat Cellar run.
  { at: B + SEC, cmd: { id: 'w1', type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' } },
  { at: B + SEC + HOUR }, // 1 h of Oak logs (1:50 each at DEX 10)
  // Skip the log on screen, bound to its number and the cost shown (as the UI sends it).
  { at: B + 2 * SEC + HOUR, cmd: (s) => ({ id: 'w2', type: 'SKIP_WOODCUT', log: s.stats.totalActions + 1, maxCost: woodcutActivityView(s)!.skipCost }) },
  { at: B + 3 * SEC + HOUR, cmd: { id: 'w3', type: 'DEBUG_ADD_WOODCUTTING_LEVEL', levels: 4 } },
  { at: B + 4 * SEC + HOUR, cmd: { id: 'w4', type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'birch' } }, // switch tree
  { at: B + 4 * SEC + 3 * HOUR }, // 2 h of Birch logs (4:50 each)
  // Training STR again stops woodcutting; 10 stamina buys 10 minutes, then the rest of the level.
  { at: B + 5 * SEC + 3 * HOUR, cmd: { id: 'w5', type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' } },
  { at: B + 6 * SEC + 3 * HOUR, cmd: { id: 'w6', type: 'SPEEDUP_TRAINING', minutes: 10, maxCost: 10 } },
  {
    at: B + 7 * SEC + 3 * HOUR,
    cmd: (s) => {
      const n = trainingView(s).attributes.find((a) => a.attribute === 'strength')!.speedupToNextLevel;
      return { id: 'w7', type: 'SPEEDUP_TRAINING', minutes: n, maxCost: n };
    },
  },
  { at: C }, // 30 min of STR training
  // 1.7.0: merchant, equip, use. Not an activity: STR training keeps running through the trades.
  { at: C + 1 * SEC, cmd: { id: 'm1', type: 'DEBUG_ADD_GOLD', amount: 1000 } },
  { at: C + 2 * SEC, cmd: { id: 'm2', type: 'BUY_ITEM', slot: 0, defId: 'health_potion_t1', quantity: 3, maxUnitPrice: 12 } },
  { at: C + 3 * SEC, cmd: { id: 'm3', type: 'BUY_ITEM', slot: 1, defId: 'iron_axe', quantity: 1, maxUnitPrice: 600 } },
  { at: C + 4 * SEC, cmd: { id: 'm4', type: 'EQUIP_ITEM', itemId: 'iron_axe#1' } },
  { at: C + 5 * SEC, cmd: { id: 'm5', type: 'DEBUG_SET_HERO_HP', hp: 60 } },
  { at: C + 6 * SEC, cmd: { id: 'm6', type: 'USE_ITEM', itemId: 'health_potion_t1' } },
  { at: C + 7 * SEC, cmd: { id: 'm7', type: 'SELL_ITEM', itemId: 'oak_logs', quantity: 100 } },
  { at: C + 8 * SEC, cmd: { id: 'm8', type: 'SELL_ITEM', itemId: 'start-wooden_axe', quantity: 1 } },
  { at: C + 9 * SEC, cmd: { id: 'm9', type: 'REFRESH_MERCHANT' } },
  { at: C + 9 * SEC, patch: as113Stock }, // 1.14.0: gear listings on the 1.13.0 terms
  { at: C + 9 * SEC + 5 * HOUR }, // charges: 4 → 5 after 2 h, then full (no banked time)
  { at: C + 10 * SEC + 5 * HOUR, cmd: { id: 'm10', type: 'REFRESH_MERCHANT' } },
  { at: C + 10 * SEC + 5 * HOUR, patch: as113Stock }, // 1.14.0: gear listings on the 1.13.0 terms
  { at: C + 11 * SEC + 5 * HOUR, cmd: { id: 'm11', type: 'REFRESH_MERCHANT' } },
  { at: C + 11 * SEC + 5 * HOUR, patch: as113Stock }, // 1.14.0: gear listings on the 1.13.0 terms
  { at: C + 12 * SEC + 5 * HOUR, cmd: { id: 'm12', type: 'DEBUG_ADD_MERCHANT_CHARGE' } },
  { at: C + 13 * SEC + 5 * HOUR, cmd: { id: 'm13', type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'birch' } },
  // 1.10.0: refreshes roll the stock (seeded); this one holds Iron Gloves in slot 4 (it held the Iron Helm before).
  { at: C + 14 * SEC + 5 * HOUR, cmd: { id: 'm14', type: 'BUY_ITEM', slot: 4, defId: 'iron_gloves', quantity: 1, maxUnitPrice: 250 } },
  { at: C + 15 * SEC + 5 * HOUR, cmd: { id: 'm15', type: 'EQUIP_ITEM', itemId: 'iron_gloves#2' } },
  { at: D }, // 1 h of Birch
  // 1.8.0: live combat. Rat Cellar cancels the Birch log; skip the search; a simulate boundary mid-fight.
  { at: D + 1 * SEC, cmd: { id: 'l1', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' } },
  { at: D + 31 * SEC, cmd: skipShown('l2') }, // 1:20 left → 2 stamina
  { at: D + 31 * SEC + 1500 }, // mid-fight: the first strikes have landed
  { at: D + 31 * SEC + 1600, cmd: { id: 'l3', type: 'DEBUG_SET_HERO_HP', hp: 30 } }, // mid-fight HP change
  { at: E }, // 1 h of search + fight runs
  // 1.9.0: buildings and mining. A real BUILD pays 50 gold for the Mine Shaft; Stone cancels the Rat Cellar run.
  { at: E + 1 * SEC, cmd: { id: 'n1', type: 'BUILD', buildingId: 'mine_shaft' } },
  { at: E + 2 * SEC, cmd: { id: 'n2', type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' } },
  { at: E + 2 * SEC + HOUR }, // 1 h of Stone (1:50 per ore at DEX 10)
  { at: E + 3 * SEC + HOUR, cmd: (s) => ({ id: 'n3', type: 'SKIP_MINE', ore: s.stats.totalActions + 1, maxCost: mineActivityView(s)!.skipCost }) },
  { at: E + 4 * SEC + HOUR, cmd: { id: 'n4', type: 'DEBUG_ADD_MINING_LEVEL', levels: 4 } },
  { at: E + 5 * SEC + HOUR, cmd: { id: 'n5', type: 'BUY_ITEM', slot: 2, defId: 'iron_pickaxe', quantity: 1, maxUnitPrice: 600 } },
  { at: E + 6 * SEC + HOUR, cmd: { id: 'n6', type: 'EQUIP_ITEM', itemId: 'iron_pickaxe#3' } },
  { at: E + 7 * SEC + HOUR, cmd: { id: 'n7', type: 'START_ACTIVITY', kind: 'mining', rockId: 'copper' } }, // MS ≥ 100
  { at: E + 7 * SEC + 2 * HOUR }, // 1 h of Copper (4:50 per ore)
  { at: E + 8 * SEC + 2 * HOUR, cmd: { id: 'n8', type: 'EQUIP_ITEM', itemId: 'start-wooden_pickaxe' } }, // MS < 100: Copper stops
  { at: E + 9 * SEC + 2 * HOUR, cmd: { id: 'n9', type: 'BUILD', buildingId: 'town_hall' } }, // 20 Oak Logs, 20 Stone, 100 gold
  { at: E + 10 * SEC + 2 * HOUR, cmd: { id: 'n10', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' } },
  { at: E + 10 * SEC + 22 * HOUR }, // 20 h away: 8 h of runs (a fight in progress at the cap would be finished)
  // 1.10.0: workers, the builder, upkeep. Two hires, crews on Oak and Stone while the Rat Cellar runs (dungeon gold and
  // upkeep side by side), the hero then cuts Oak next to the Oak crew, a real Town Hall upgrade, a third worker.
  { at: F + 1 * SEC, cmd: { id: 'o1', type: 'HIRE_WORKER', maxCost: 100 } },
  { at: F + 2 * SEC, cmd: { id: 'o2', type: 'HIRE_WORKER', maxCost: 200 } },
  { at: F + 3 * SEC, cmd: { id: 'o3', type: 'ASSIGN_WORKER', workerId: 'w1', node: 'oak' } },
  { at: F + 4 * SEC, cmd: { id: 'o4', type: 'ASSIGN_WORKER', workerId: 'w2', node: 'stone' } },
  { at: F + 4 * SEC + HOUR }, // 1 h: Rat Cellar runs and two crews
  { at: F + 5 * SEC + HOUR, cmd: { id: 'o5', type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' } },
  { at: F + 5 * SEC + 2 * HOUR }, // 1 h: the hero and the Oak crew on the same tree
  { at: F + 6 * SEC + 2 * HOUR, cmd: { id: 'o6', type: 'DEBUG_ADD_GOLD', amount: 1000 } },
  { at: F + 7 * SEC + 2 * HOUR, cmd: { id: 'o7', type: 'UPGRADE_BUILDING', buildingId: 'town_hall', level: 2 } }, // 500 g, 50 Oak, 50 Stone
  { at: F + 7 * SEC + 2 * HOUR + 20 * MIN + 500 }, // a simulate boundary mid-upgrade
  { at: F + 8 * SEC + 2 * HOUR + 20 * MIN + 500, cmd: { id: 'o8', type: 'HIRE_WORKER', maxCost: 400 } },
  { at: F + 9 * SEC + 2 * HOUR + 20 * MIN + 500, cmd: { id: 'o9', type: 'ASSIGN_WORKER', workerId: 'w3', node: 'oak' } },
  { at: G }, // ~10 h away (capped at 8 h): the upgrade completes, +20% yield after it
  // 1.11.0: Training Grounds upgrades. A real upgrade to Lv2 (15 min), STR training started while it builds, a simulate
  // boundary mid-build, the upgrade completing mid-training (1 → 2 XP/min from that instant), a speed-up at 2 XP/min.
  { at: G + 1 * SEC, cmd: { id: 'p1', type: 'DEBUG_ADD_GOLD', amount: 2000 } },
  { at: G + 2 * SEC, cmd: { id: 'p2', type: 'UPGRADE_BUILDING', buildingId: 'training_grounds', level: 2 } }, // 250 g, 25 Oak, 25 Stone
  { at: G + 3 * SEC, cmd: { id: 'p3', type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' } },
  { at: G + 3 * SEC + 5 * MIN + 250 }, // mid-build: still 1 XP/min
  { at: G + 3 * SEC + 40 * MIN }, // Lv2 since G + 2 s + 15 min: 2 XP/min after it
  { at: G + 4 * SEC + 40 * MIN, cmd: { id: 'p4', type: 'SPEEDUP_TRAINING', minutes: 10, maxCost: 10 } }, // 10 stamina = 20 XP
  { at: H }, // more training at 2 XP/min
  // 1.13.0: the Crafting house. A real BUILD; Oak Planks ×300 (x1) in pipe 1 and Stone Bricks ×5 in x10 mode in pipe 2
  // (stamina paid up front); a simulate boundary mid-craft; a real house upgrade to Lv2 mid-job (−10% from the next craft);
  // an insta; the x10 job cancelled (unfinished crafts' stone and unstarted crafts' stamina back); then a full inventory
  // (gear unequipped, a shield bought) holds the Copper Ingot pipe opened by debug, a sale frees a slot and it delivers;
  // ~8 h away. STR training runs beside all of it.
  { at: H + 1 * SEC, cmd: { id: 'c1', type: 'BUILD', buildingId: 'crafting' } }, // 30 Oak Logs, 30 Stone, 150 gold
  { at: H + 2 * SEC, cmd: { id: 'c2', type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank', quantity: 300, mode: 'x1', maxCost: 0 } },
  { at: H + 3 * SEC, cmd: craftShown('c3', 1, 'stone_brick', 5), id: 'c3' },
  { at: H + 10 * SEC + 500 }, // mid-craft in both pipes
  { at: H + 12 * SEC, cmd: { id: 'c4', type: 'UPGRADE_BUILDING', buildingId: 'crafting', level: 2 } }, // 250 g, 25 Oak, 25 Stone, 15 min
  { at: H + 15 * SEC, cmd: (s) => ({ id: 'c5', type: 'CANCEL_CRAFT', pipe: 1, jobId: craftJobView(s, 1)!.id }), id: 'c5' },
  { at: H + 20 * SEC }, // the screen at that moment
  { at: H + 20 * SEC, cmd: instaShown('c6', 0), id: 'c6' },
  { at: H + 20 * MIN }, // the upgrade completed at H + 12 s + 15 min, mid-job
  { at: H + 20 * MIN + 1 * SEC, cmd: { id: 'c7', type: 'UNEQUIP_ITEM', slot: 'weapon' } },
  { at: H + 20 * MIN + 2 * SEC, cmd: { id: 'c8', type: 'UNEQUIP_ITEM', slot: 'armor' } },
  { at: H + 20 * MIN + 3 * SEC, cmd: { id: 'c9', type: 'UNEQUIP_ITEM', slot: 'boots' } },
  { at: H + 20 * MIN + 4 * SEC, cmd: { id: 'c10', type: 'UNEQUIP_ITEM', slot: 'gloves' } },
  { at: H + 20 * MIN + 5 * SEC, cmd: { id: 'c11', type: 'UNEQUIP_ITEM', slot: 'axe' } },
  { at: H + 20 * MIN + 6 * SEC, cmd: { id: 'c12', type: 'UNEQUIP_ITEM', slot: 'pickaxe' } },
  { at: H + 20 * MIN + 7 * SEC, cmd: { id: 'c13', type: 'BUY_ITEM', slot: 1, defId: 'iron_shield', quantity: 1, maxUnitPrice: 550 } }, // 19 of 20 slots
  { at: H + 20 * MIN + 8 * SEC, cmd: { id: 'c14', type: 'DEBUG_UNLOCK_PIPE' } },
  { at: H + 20 * MIN + 9 * SEC, cmd: { id: 'c15', type: 'START_CRAFT', pipe: 1, recipeId: 'birch_plank', quantity: 3, mode: 'x1', maxCost: 0 } },
  { at: H + 20 * MIN + 9 * SEC, cmd: { id: 'c16', type: 'START_CRAFT', pipe: 2, recipeId: 'copper_ingot', quantity: 3, mode: 'x1', maxCost: 0 } }, // 12 of 16 ore: the stack stays
  { at: H + 21 * MIN }, // the Birch Plank took the last slot; the Copper Ingot pipe is held
  { at: H + 21 * MIN + 1 * SEC, cmd: { id: 'c17', type: 'SELL_ITEM', itemId: 'bread', quantity: 3 } }, // a free slot: it delivers at once
  { at: H + 21 * MIN + 2 * SEC + 9 * HOUR }, // ~9 h away (capped at 8 h)
  // 1.14.0: gear quality and rarity. Debug gold, then a real refresh rolls the gear listings (own stream); the shield is sold by its
  // quality and the first rolled piece is bought at the price shown. Gear crafting: a Stone Sword with 20 stamina invested
  // (pipe 1), a Stone Helm with none (pipe 2), a Stone Gloves cancelled mid-craft (materials back, 5 stamina lost),
  // a simulate boundary mid-craft, an insta on the helm (ready at once), 2 h away (the sword waits, ready), Done on both,
  // the sword equipped, 1 h of STR training with it on.
  { at: I + 500, cmd: { id: 'q0', type: 'DEBUG_ADD_GOLD', amount: 5000 } },
  { at: I + 1 * SEC, cmd: { id: 'q1', type: 'REFRESH_MERCHANT' } },
  { at: I + 2 * SEC, cmd: (s) => ({ id: 'q2', type: 'SELL_ITEM', itemId: s.inventory.items.find((i) => i.defId === 'iron_shield')!.id, quantity: 1 }), id: 'q2' },
  { at: I + 3 * SEC, cmd: (s) => buyFirstGear('q3', s), id: 'q3' },
  { at: I + 4 * SEC, cmd: { id: 'q4', type: 'START_CRAFT', pipe: 0, recipeId: 'stone_sword', quantity: 1, mode: 'x1', maxCost: 20, stamina: 20 } },
  { at: I + 5 * SEC, cmd: { id: 'q5', type: 'START_CRAFT', pipe: 1, recipeId: 'stone_helm', quantity: 1, mode: 'x1', maxCost: 0, stamina: 0 } },
  { at: I + 6 * SEC, cmd: { id: 'q6', type: 'START_CRAFT', pipe: 2, recipeId: 'stone_gloves', quantity: 1, mode: 'x1', maxCost: 5, stamina: 5 } },
  { at: I + 1 * MIN + 500 }, // mid-craft in three pipes
  { at: I + 1 * MIN + 1 * SEC, cmd: (s) => ({ id: 'q7', type: 'CANCEL_CRAFT', pipe: 2, jobId: craftJobView(s, 2)!.id }), id: 'q7' },
  { at: I + 1 * MIN + 2 * SEC, cmd: instaShown('q8', 1), id: 'q8' },
  { at: I + 2 * HOUR }, // the sword finished long ago and waits, ready
  { at: I + 2 * HOUR + 500, cmd: { id: 'q8b', type: 'SELL_ITEM', itemId: 'start-rusty_gladius', quantity: 1 } }, // 25%: 1.13.0's price
  { at: I + 2 * HOUR + 600, cmd: { id: 'q8c', type: 'SELL_ITEM', itemId: 'start-linen_tunic', quantity: 1 } }, // room for two pieces
  { at: I + 2 * HOUR + 1 * SEC, cmd: (s) => ({ id: 'q9', type: 'COLLECT_CRAFT', pipe: 0, jobId: craftJobView(s, 0)!.id }), id: 'q9' },
  { at: I + 2 * HOUR + 2 * SEC, cmd: (s) => ({ id: 'q10', type: 'COLLECT_CRAFT', pipe: 1, jobId: craftJobView(s, 1)!.id }), id: 'q10' },
  { at: I + 2 * HOUR + 3 * SEC, cmd: (s) => ({ id: 'q11', type: 'EQUIP_ITEM', itemId: s.inventory.items.find((i) => i.defId === 'stone_sword')!.id }), id: 'q11' },
  { at: I + 3 * HOUR + 3 * SEC }, // 1 h more
];

function runScript(steps: Step[] = SCRIPT) {
  let s = newGame(0xc0ffee, T0);
  for (const step of steps) {
    if (step.patch) {
      s = step.patch(s);
    } else if (step.cmd) {
      const c = typeof step.cmd === 'function' ? step.cmd(s) : step.cmd;
      const r = applyCommand(s, c, step.at);
      if (!r.ok) throw new Error(r.error.message);
      s = r.state;
    } else {
      s = simulate(s, step.at).state;
    }
  }
  return s;
}

describe('save version ↔ engine version (RELEASED_ENGINES)', () => {
  // Rule (docs/ENGINE.md): every save-version bump ships with an ENGINE_VERSION bump, and every engine
  // bump appends a row to RELEASED_ENGINES (src/engine/version.ts). Replay trusts no other labels.
  const semver = (v: string) => v.split('.').map(Number) as [number, number, number];
  const cmp = (a: string, b: string) => {
    const [x, y] = [semver(a), semver(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  };

  it('the last released engine is the current one, writing the current save version', () => {
    expect(RELEASED_ENGINES.at(-1)).toEqual({ engine: ENGINE_VERSION, save: CURRENT_SAVE_VERSION });
  });

  it('engines strictly increase; save versions never go down and only change with a new engine', () => {
    for (let i = 1; i < RELEASED_ENGINES.length; i++) {
      const [prev, next] = [RELEASED_ENGINES[i - 1], RELEASED_ENGINES[i]];
      expect(cmp(next.engine, prev.engine)).toBeGreaterThan(0);
      expect(next.save).toBeGreaterThanOrEqual(prev.save);
    }
    expect(RELEASED_ENGINES.map((r) => [r.engine, r.save])).toEqual([
      ['1.0.0', 1],
      ['1.1.0', 2],
      ['1.2.0', 3],
      ['1.3.0', 4],
      ['1.4.0', 5],
      ['1.5.0', 6],
      ['1.6.0', 7],
      ['1.7.0', 8],
      ['1.8.0', 9],
      ['1.9.0', 10],
      ['1.10.0', 11],
      ['1.11.0', 11],
      ['1.12.0', 12],
      ['1.13.0', 13],
      ['1.14.0', 14],
    ]);
  });
});

describe('golden', () => {
  it('the 1.3.0 part of the script (re-pinned in 1.6.0 for Oak and in 1.8.0 for live combat)', () => {
    const s = runScript(SCRIPT.slice(0, SCRIPT.findIndex((x) => typeof x.cmd === 'object' && x.cmd.id === 't1')));
    expect({
      heroLevel: s.character.level,
      actions: s.stats.totalActions,
      stamina: s.stamina,
      hp: [s.character.hp, s.character.hpRegenProgress],
      gold: s.character.gold,
      dungeon: s.dungeon.totals,
      lastFightMs: s.dungeon.lastFight?.durationMs,
    }).toMatchInlineSnapshot(`
      {
        "actions": 458,
        "dungeon": {
          "losses": 0,
          "runs": 98,
          "wins": 98,
        },
        "gold": 373,
        "heroLevel": 12,
        "hp": [
          160,
          0,
        ],
        "lastFightMs": 3000,
        "stamina": {
          "current": 100,
          "max": 100,
          "progressMs": 0,
        },
      }
    `);
    // A locked tier is refused at this point (Wolf Den needs 15 Bat Cave wins).
    const locked = applyCommand(s, { id: 'lk', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'wolf_den' }, T0 + 34 * HOUR + 402 * SEC);
    expect(locked).toEqual({ ok: false, error: expect.objectContaining({ code: 'DUNGEON_LOCKED' }) });
  });

  it('the 1.4.0 script (re-pinned in 1.6.0 and 1.8.0)', () => {
    const s = runScript(SCRIPT.slice(0, SCRIPT.findIndex((x) => typeof x.cmd === 'object' && x.cmd.id === 'r1')));
    expect({
      actions: s.stats.totalActions,
      batWings: s.inventory.items.find((i) => i.defId === 'bat_wing')?.quantity,
      byDungeon: s.dungeon.byDungeon,
      gold: s.character.gold,
      heroLevel: s.character.level,
      hp: [s.character.hp, s.character.hpRegenProgress],
      lastFightMs: s.dungeon.lastFight?.durationMs,
      nests: s.stats.itemsGathered.bird_nest,
      stamina: s.stamina,
      strength: s.character.attributes.strength,
      woodcutting: s.character.skills.woodcutting.level,
    }).toMatchInlineSnapshot(`
      {
        "actions": 458,
        "batWings": 12,
        "byDungeon": {
          "bat_cave": {
            "losses": 0,
            "runs": 51,
            "wins": 51,
          },
          "rat_cellar": {
            "losses": 0,
            "runs": 98,
            "wins": 98,
          },
        },
        "gold": 734,
        "heroLevel": 12,
        "hp": [
          143,
          15000,
        ],
        "lastFightMs": 5000,
        "nests": 2,
        "stamina": {
          "current": 100,
          "max": 100,
          "progressMs": 0,
        },
        "strength": 13,
        "woodcutting": 10,
      }
    `);
    expect(s.training).toEqual(newTrainingState());
  });

  it('the 1.6.0 script (unchanged in 1.7.0, re-pinned in 1.8.0; 1.9.0: +100 gold, Tier 1 came free)', () => {
    const s = runScript(SCRIPT.slice(0, SCRIPT.findIndex((x) => typeof x.cmd === 'object' && x.cmd.id === 'm1')));
    expect(s.time.lastSimulatedAt).toBe(C);
    expect({
      actions: s.stats.totalActions,
      activity: s.activity?.kind ?? null,
      gold: s.character.gold,
      hp: [s.character.hp, s.character.hpRegenProgress],
      heroLevel: s.character.level,
      stamina: s.stamina,
      woodcutting: s.character.skills.woodcutting,
      logs: Object.fromEntries(s.inventory.items.filter((i) => i.defId.endsWith('_logs')).map((i) => [i.defId, i.quantity])),
      dungeon: s.dungeon,
      training: s.training,
      rng: s.rng,
    }).toMatchInlineSnapshot(`
      {
        "actions": 515,
        "activity": "training",
        "dungeon": {
          "byDungeon": {
            "bat_cave": {
              "losses": 0,
              "runs": 51,
              "wins": 51,
            },
            "rat_cellar": {
              "losses": 0,
              "runs": 130,
              "wins": 130,
            },
          },
          "lastFight": {
            "dungeonId": "rat_cellar",
            "durationMs": 2000,
            "endReason": "enemy_defeated",
            "enemyHpEnd": 0,
            "enemyId": "rat",
            "enemyMaxHp": 30,
            "heroHpEnd": 168,
            "heroHpStart": 170,
            "heroMaxHp": 170,
            "log": [
              {
                "actor": "hero",
                "atMs": 1000,
                "dealt": 16,
                "roll": 17,
                "strike": 1,
                "targetHpAfter": 14,
              },
              {
                "actor": "enemy",
                "atMs": 1000,
                "dealt": 2,
                "roll": 5,
                "strike": 1,
                "targetHpAfter": 168,
              },
              {
                "actor": "hero",
                "atMs": 2000,
                "dealt": 16,
                "roll": 17,
                "strike": 2,
                "targetHpAfter": 0,
              },
            ],
            "rewards": {
              "gold": 4,
              "heroXp": 35,
              "items": {},
              "itemsLost": {},
            },
            "won": true,
          },
          "totals": {
            "losses": 0,
            "runs": 181,
            "wins": 181,
          },
        },
        "gold": 1041,
        "heroLevel": 13,
        "hp": [
          170,
          0,
        ],
        "logs": {
          "birch_logs": 37,
          "oak_logs": 2072,
        },
        "rng": {
          "seed": 3241514865,
        },
        "stamina": {
          "current": 91,
          "max": 100,
          "progressMs": 1000,
        },
        "training": {
          "attributes": {
            "dexterity": {
              "level": 0,
              "progressMs": 0,
              "xp": 0,
            },
            "endurance": {
              "level": 40,
              "progressMs": 0,
              "xp": 0,
            },
            "intelligence": {
              "level": 0,
              "progressMs": 0,
              "xp": 0,
            },
            "strength": {
              "level": 3,
              "progressMs": 33000,
              "xp": 30,
            },
          },
          "tier": 2,
        },
        "woodcutting": {
          "level": 14,
          "xp": 4025,
          "xpToNext": 5238,
        },
      }
    `);
    expect(s.training.attributes.strength).toEqual({ level: 3, xp: 30, progressMs: 33000 });
  });

  it('the 1.8.0 script is unchanged in 1.9.0 but for +100 gold (Tier 1 came with the Training Grounds)', () => {
    const s = runScript(SCRIPT.slice(0, SCRIPT.findIndex((x) => typeof x.cmd === 'object' && x.cmd.id === 'n1')));
    expect(s.time.lastSimulatedAt).toBe(E);
    expect({
      actions: s.stats.totalActions,
      gold: s.character.gold,
      heroLevel: s.character.level,
      hp: [s.character.hp, s.character.hpRegenProgress],
      dungeon: s.dungeon.totals,
      nests: s.stats.itemsGathered.bird_nest,
      logs: Object.fromEntries(s.inventory.items.filter((i) => i.defId.endsWith('_logs')).map((i) => [i.defId, i.quantity])),
      tier: s.training.tier,
      xp: s.character.xp,
      stamina: s.stamina,
      seed: s.rng.seed,
      nextItemSerial: s.nextItemSerial,
      inventory: s.inventory,
      // 1.10.0: re-pinned (power-based yield: more logs per cut, one more RNG draw per cut).
    }).toMatchInlineSnapshot(`
      {
        "actions": 527,
        "dungeon": {
          "losses": 0,
          "runs": 214,
          "wins": 214,
        },
        "gold": 1377,
        "heroLevel": 13,
        "hp": [
          170,
          0,
        ],
        "inventory": {
          "capacity": 20,
          "items": [
            {
              "defId": "bread",
              "icon": "🍞",
              "id": "bread",
              "name": "Bread",
              "quantity": 3,
              "stackable": true,
            },
            {
              "defId": "oak_logs",
              "icon": "🪵",
              "id": "oak_logs",
              "name": "Oak Logs",
              "quantity": 1972,
              "stackable": true,
            },
            {
              "defId": "bird_nest",
              "icon": "🪺",
              "id": "bird_nest",
              "name": "Bird Nest",
              "quantity": 2,
              "stackable": true,
            },
            {
              "defId": "rat_skin",
              "icon": "🐾",
              "id": "rat_skin",
              "name": "Rat Skin",
              "quantity": 75,
              "stackable": true,
            },
            {
              "defId": "bat_wing",
              "icon": "🪽",
              "id": "bat_wing",
              "name": "Bat Wing",
              "quantity": 12,
              "stackable": true,
            },
            {
              "defId": "birch_logs",
              "icon": "🪵",
              "id": "birch_logs",
              "name": "Birch Logs",
              "quantity": 61,
              "stackable": true,
            },
            {
              "defId": "health_potion_t1",
              "icon": "🧪",
              "id": "health_potion_t1",
              "name": "Health Potion (T1)",
              "quantity": 2,
              "stackable": true,
            },
          ],
        },
        "logs": {
          "birch_logs": 61,
          "oak_logs": 1972,
        },
        "nests": 2,
        "nextItemSerial": 3,
        "seed": 2019055822,
        "stamina": {
          "current": 100,
          "max": 100,
          "progressMs": 0,
        },
        "tier": 2,
        "xp": 2092,
      }
    `);
  });

  it('the 1.10.0 script: its hash re-pinned in 1.12.0 (faster skills); in 1.11.0 its Training Grounds stayed Lv1', () => {
    const s = runScript(SCRIPT.slice(0, SCRIPT.findIndex((x) => typeof x.cmd === 'object' && x.cmd.id === 'p1')));
    expect(s.time.lastSimulatedAt).toBe(G);
    // 1.12.0: the skill curve (base 100) levels woodcutting and mining faster, so WS / MS and the yield rise. Was 1aed0f53.
    // 1.13.0: unchanged outcomes; seen in the v12 shape (no Crafting house, smithing back) the hash is the 1.12.0 one.
    expect(hashState(asV12(s))).toBe('d6b0bd86');
  });

  it('the 1.11.0 segment: Training Grounds Lv2 completes mid-training (1 → 2 XP/min at that instant), speed-up at 2 XP/min', () => {
    const at = (id: string) => runScript(SCRIPT.slice(0, SCRIPT.findIndex((x) => typeof x.cmd === 'object' && x.cmd.id === id)));
    const before = at('p3');
    expect(before.construction).toMatchObject({ buildingId: 'training_grounds', level: 2, durationMs: 15 * MIN });
    const str0 = before.training.attributes.strength;
    const s = at('c1');
    expect(s.buildings.training_grounds).toEqual({ state: 'built', level: 2 });
    expect(s.construction).toBeNull();
    expect(trainingView(s).xpPerMinute).toBe(2);
    // Trained time from G + 3 s: 1 XP/min until the upgrade completes at G + 2 s + 15 min, then 2 XP/min until
    // G + 4 s + 2 h, plus the 10-minute speed-up at 2 XP/min.
    const xpOf = (t: { level: number; xp: number; progressMs: number }) => {
      let total = 0;
      for (let l = 0; l < t.level; l += 1) total += 5 + 10 * l;
      return total * 60_000 + t.xp * 60_000 + t.progressMs;
    };
    const trainedMs = xpOf(s.training.attributes.strength) - xpOf(str0);
    expect(trainedMs).toBe((15 * MIN - SEC) * 1 + (2 * HOUR + 2 * SEC - 15 * MIN) * 2 + 10 * MIN * 2);
    expect(s.activity).toEqual(expect.objectContaining({ kind: 'training', attribute: 'strength' }));
  });

  it('the whole 1.12.0 script is unchanged in 1.13.0 (hash in the v12 shape = the 1.12.0 pin)', () => {
    const s = runScript(SCRIPT.slice(0, SCRIPT.findIndex((x) => typeof x.cmd === 'object' && x.cmd.id === 'c1')));
    expect(s.time.lastSimulatedAt).toBe(H);
    expect(s.buildings.crafting).toEqual({ state: 'locked', level: 0 });
    expect(s.crafting).toEqual(newGame(1, T0).crafting);
    expect({
      engineVersion: '1.12.0',
      hash: hashState(asV12(s)),
      heroLevel: s.character.level,
      woodcutting: s.character.skills.woodcutting.level,
      actions: s.stats.totalActions,
      nests: s.stats.itemsGathered.bird_nest,
      stamina: s.stamina,
      strength: s.character.attributes.strength,
      hp: [s.character.hp, s.character.hpRegenProgress],
      gold: s.character.gold,
      dungeon: s.dungeon.totals,
      byDungeon: s.dungeon.byDungeon,
      lastFightMs: s.dungeon.lastFight?.durationMs,
      batWings: s.inventory.items.find((i) => i.defId === 'bat_wing')?.quantity,
      training: s.training,
      activity: s.activity?.kind ?? null,
      woodcuttingXp: s.character.skills.woodcutting.xp,
      logs: Object.fromEntries(s.inventory.items.filter((i) => i.defId.endsWith('_logs')).map((i) => [i.defId, i.quantity])),
      axe: s.character.equipment.axe?.defId,
      gloves: s.character.equipment.gloves?.id, // 1.10.0: the post-refresh buy is the Iron Gloves (was the Iron Helm)
      merchant: { charges: s.merchant.charges, chargeProgressMs: s.merchant.chargeProgressMs, stock: asV13(s).merchant.stock.slice(0, 5) },
      nextItemSerial: s.nextItemSerial,
      potions: s.inventory.items.find((i) => i.defId === 'health_potion_t1')?.quantity,
      woodenAxe: s.inventory.items.some((i) => i.defId === 'wooden_axe'),
      buildings: (asV12(s) as GameState).buildings,
      mining: s.character.skills.mining,
      pickaxe: s.character.equipment.pickaxe?.id,
      ores: Object.fromEntries(s.inventory.items.filter((i) => ['stone', 'copper_ore', 'geode'].includes(i.defId)).map((i) => [i.defId, i.quantity])),
      lastFight: s.dungeon.lastFight && { won: s.dungeon.lastFight.won, endReason: s.dungeon.lastFight.endReason },
      dungeonActivity: s.activity?.kind === 'dungeon' ? { phase: s.activity.phase, progressMs: s.activity.progressMs } : null,
      workers: s.workers,
      construction: s.construction,
    }).toMatchInlineSnapshot(`
      {
        "actions": 877,
        "activity": "training",
        "axe": "iron_axe",
        "batWings": 12,
        "buildings": {
          "merchant": {
            "level": 1,
            "state": "built",
          },
          "mine_shaft": {
            "level": 1,
            "state": "built",
          },
          "town_hall": {
            "level": 2,
            "state": "built",
          },
          "training_grounds": {
            "level": 2,
            "state": "built",
          },
          "woodcutting": {
            "level": 1,
            "state": "built",
          },
        },
        "byDungeon": {
          "bat_cave": {
            "losses": 0,
            "runs": 51,
            "wins": 51,
          },
          "rat_cellar": {
            "losses": 0,
            "runs": 452,
            "wins": 452,
          },
        },
        "construction": null,
        "dungeon": {
          "losses": 0,
          "runs": 503,
          "wins": 503,
        },
        "dungeonActivity": null,
        "engineVersion": "1.12.0",
        "gloves": "iron_gloves#2",
        "gold": 1387,
        "hash": "94897c6a",
        "heroLevel": 15,
        "hp": [
          190,
          0,
        ],
        "lastFight": {
          "endReason": "enemy_defeated",
          "won": true,
        },
        "lastFightMs": 2000,
        "logs": {
          "birch_logs": 61,
          "oak_logs": 7500,
        },
        "merchant": {
          "chargeProgressMs": 0,
          "charges": 5,
          "stock": [
            {
              "defId": "health_potion_t1",
              "quantity": 10,
              "unitPrice": 12,
            },
            {
              "defId": "iron_shield",
              "quantity": 1,
              "unitPrice": 550,
            },
            null,
            {
              "defId": "iron_chestplate",
              "quantity": 1,
              "unitPrice": 700,
            },
            null,
          ],
        },
        "mining": {
          "level": 8,
          "xp": 18,
          "xpToNext": 2263,
        },
        "nests": 2,
        "nextItemSerial": 4,
        "ores": {
          "copper_ore": 16,
          "stone": 450,
        },
        "pickaxe": "start-wooden_pickaxe",
        "potions": 2,
        "stamina": {
          "current": 100,
          "max": 100,
          "progressMs": 0,
        },
        "strength": 13,
        "training": {
          "attributes": {
            "dexterity": {
              "level": 0,
              "progressMs": 0,
              "xp": 0,
            },
            "endurance": {
              "level": 40,
              "progressMs": 0,
              "xp": 0,
            },
            "intelligence": {
              "level": 0,
              "progressMs": 0,
              "xp": 0,
            },
            "strength": {
              "level": 11,
              "progressMs": 49000,
              "xp": 15,
            },
          },
          "tier": 2,
        },
        "woodcutting": 16,
        "woodcuttingXp": 2031,
        "woodenAxe": false,
        "workers": {
          "crews": {
            "oak": {
              "idle": false,
              "progressMs": 3000,
              "workMs": 6000,
            },
            "stone": {
              "idle": false,
              "progressMs": 2000,
              "workMs": 2000,
            },
          },
          "list": [
            {
              "id": "w1",
              "node": "oak",
            },
            {
              "id": "w2",
              "node": "stone",
            },
            {
              "id": "w3",
              "node": "oak",
            },
          ],
          "minuteLeftMs": 57000,
          "nextSerial": 4,
          "paidPerMin": 3,
          "paused": false,
        },
      }
    `);
  });

  it('frozen v1 save (tests/fixtures/save-v1.json) still loads, migrates and plays', () => {
    const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'save-v1.json'), 'utf8'));
    expect(raw.saveVersion).toBe(1);
    const s = loadSave(raw);
    expect(s.saveVersion).toBe(CURRENT_SAVE_VERSION);
    expect(s.flags).toEqual({ debugUsed: false });
    expect(s.character.attributes).toEqual({ strength: 10, dexterity: 10, endurance: 10, intelligence: 10 });
    expect(s.stats.totalActions).toBe(2499);
    // v10: woodcutting stops (the Woodcutting building starts locked). Built again, Oak cuts every 1:50 at DEX 10.
    expect(s.activity).toBeNull();
    expect(s.buildings.woodcutting).toEqual({ state: 'locked', level: 0 });
    const at = s.time.lastSimulatedAt;
    const oak = applyCommand(withBuilt(s, ['woodcutting']), { id: 'v1-oak', type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, at);
    if (!oak.ok) throw new Error(oak.error.message);
    expect(simulate(oak.state, at + 4 * MIN).summary.actions).toBe(2);
    expect(hashState(loadSave(raw))).toBe(hashState(s)); // migration is deterministic
  });

  it('frozen v2 save (tests/fixtures/save-v2.json) migrates to the current save without losing progress, and plays on', () => {
    // Produced by the 1.1.0 engine (save v2): woodcutting ~3h, +20k hero XP via debug.
    const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'save-v2.json'), 'utf8'));
    expect(raw.saveVersion).toBe(2);
    const s = loadSave(raw);
    expect(s.saveVersion).toBe(CURRENT_SAVE_VERSION);

    // Progress kept: level, XP, skills, woodcutting banked time, inventory, stats, rng, time, flags.
    expect(s.character.level).toBe(raw.character.level);
    expect(s.character.level).toBe(4);
    // v9: XP clamped into progress toward Lv5 on the base-100 curve (Lv4 needs 800).
    expect(raw.character.xp).toBeGreaterThan(799);
    expect([s.character.xp, s.character.xpToNext]).toEqual([799, 800]);
    expect(s.character.gold).toBe(raw.character.gold);
    // v12 (1.12.0): each skill keeps its total XP; levels recomputed on the base-100 skill curve (WC Lv8 → Lv16).
    expect(s.character.skills).toEqual(v12Skills(raw.character.skills));
    expect(raw.character.skills.woodcutting.level).toBe(8);
    expect(s.character.skills.woodcutting).toEqual({ level: 16, xp: 43, xpToNext: 6848 });
    expect(s.activity).toBeNull(); // v10: woodcutting stops (its building starts locked)
    expect(s.stats).toEqual(raw.stats);
    expect(s.rng).toEqual(raw.rng);
    expect(s.time).toEqual(raw.time);
    expect(s.offline).toEqual(raw.offline);
    expect(s.flags).toEqual({ debugUsed: true });
    expect(s.inventory.capacity).toBe(raw.inventory.capacity);
    expect(s.inventory.items.map((i) => [i.id, i.defId, i.quantity])).toEqual([
      ['bread', 'bread', 3],
      ['oak_logs', 'oak_logs', 3785],
      ['bird_nest', 'bird_nest', 20],
    ]);

    // Shape changes. The fixture had 5 everywhere: raised to the new-hero baseline of 10.
    expect(raw.character.attributes).toMatchObject({ strength: 5, dexterity: 5, constitution: 5, intelligence: 5 });
    expect(s.character.attributes).toEqual({ strength: 10, dexterity: 10, endurance: 10, intelligence: 10 });
    expect(s.character).not.toHaveProperty('maxHp');
    expect(s.character.hp).toBe(80); // v4: full at level 4 (the v2 hp field was dropped by v3)
    expect(s.stamina).toEqual({ current: 100, max: 100, progressMs: 0 });
    expect(Object.values(s.character.equipment).map((i) => [i!.id, i!.defId])).toEqual([
      ['start-rusty_gladius', 'rusty_gladius'],
      ['start-linen_tunic', 'linen_tunic'],
      ['start-worn_sandals', 'worn_sandals'],
      ['start-wooden_axe', 'wooden_axe'],
      ['start-wooden_pickaxe', 'wooden_pickaxe'], // v10
    ]);

    // Stats come from the catalog through the new defIds: 2–4 + 10 STR, 3 armor + 10 END, level 4 pools.
    const d = getDerivedStats(s);
    expect([d.damage.min, d.damage.max, d.defense.value, d.maxHp.value, d.maxMana.value]).toEqual([12, 14, 13, 80, 35]);

    // Plays on: with Woodcutting built again, Oak logs every 1:50 at DEX 10.
    const oak = applyCommand(withBuilt(s, ['woodcutting']), { id: 'v2-oak', type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, s.time.lastSimulatedAt);
    if (!oak.ok) throw new Error(oak.error.message);
    const next = simulate(oak.state, s.time.lastSimulatedAt + 4 * MIN);
    expect(next.summary.actions).toBe(2);
    // Logs keep stacking on the migrated stack (matched by defId).
    expect(next.state.inventory.items.filter((i) => i.defId === 'oak_logs')).toHaveLength(1);
    // WC Lv16 (1.12.0): WS 171 on Oak (20) = 8.55 logs per cut (1.10.0 yield), so 2 cuts give 17 or 18.
    expect(next.summary.itemsGained.oak_logs).toBeGreaterThanOrEqual(17);
    expect(next.state.inventory.items.find((i) => i.defId === 'oak_logs')?.quantity).toBe(3785 + (next.summary.itemsGained.oak_logs ?? 0));
    // And commands work on the migrated save.
    const spent = applyCommand(next.state, { id: 'v2-spend', type: 'DEBUG_SPEND_STAMINA', amount: 10 }, s.time.lastSimulatedAt + 4 * MIN);
    expect(spent.ok && spent.state.stamina.current).toBe(90);
    expect(hashState(loadSave(raw))).toBe(hashState(s)); // migration is deterministic
  });

  it('frozen v3 save (tests/fixtures/save-v3.json) migrates to the current save (via v4: full HP) and plays on, dungeon included', () => {
    // Produced by the 1.2.0 engine (save v3), before the dungeon: woodcutting ~3h, +30k hero XP,
    // +5 DEX, +2 END and 40 stamina spent via debug.
    const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'save-v3.json'), 'utf8'));
    expect(raw.saveVersion).toBe(3);
    expect(raw.character).not.toHaveProperty('hp');
    const s = loadSave(raw);
    expect(s.saveVersion).toBe(CURRENT_SAVE_VERSION);
    expect(hashState(loadSave(raw))).toBe(hashState(s)); // deterministic

    // Everything from v3 survives as it was.
    const { hp, hpRegenProgress, xp, xpToNext, equipment: { axe, pickaxe, ...equipment }, ...character } = s.character;
    // v9: Lv5 kept, XP clamped into progress toward Lv6 on the base-100 curve (Lv5 needs 1118).
    expect([raw.character.xp, xp, xpToNext]).toEqual([4463, 1117, 1118]);
    // v8 dropped the per-instance `rarity` (quality is catalog-only).
    const noRarity = (i: Record<string, unknown>) => {
      const { rarity: _r, ...x } = i;
      return x;
    };
    expect({ ...character, equipment }).toEqual({
      ...raw.character,
      skills: v12Skills(raw.character.skills), // v12: levels recomputed from total XP (WC Lv8 → Lv16)
      xp: undefined,
      xpToNext: undefined,
      // v14: every gear instance gets the default roll (25% quality, common).
      equipment: Object.fromEntries(Object.entries(raw.character.equipment).map(([k, v]) => [k, { ...noRarity(v as Record<string, unknown>), rarity: 'common', qualityBp: 2500 }])),
    });
    expect(axe?.defId).toBe('wooden_axe');
    expect(pickaxe?.defId).toBe('wooden_pickaxe');
    const { dungeon, training, activity, merchant, nextItemSerial, inventory, buildings: _b, construction: _k, workers: _w, crafting: _cr, character: _c, saveVersion: _v, ...rest } = s;
    expect(merchant.charges).toBe(5);
    expect(nextItemSerial).toBe(1);
    expect(inventory).toEqual({ ...raw.inventory, items: raw.inventory.items.map(noRarity) });
    expect(activity).toBeNull(); // v10: woodcutting stops (its building starts locked)
    expect(training).toEqual(newTrainingState());
    const { character: _rc, saveVersion: _rv, activity: _ra, inventory: _ri, ...rawRest } = raw;
    expect(rest).toEqual(rawRest);

    // New: full HP at level 5 (50 + 10 × 4), empty fight state.
    expect(s.character.level).toBe(5);
    expect([hp, hpRegenProgress]).toEqual([90, 0]);
    expect(dungeon).toEqual({ lastFight: null, totals: { runs: 0, wins: 0, losses: 0 }, byDungeon: {} });

    // Plays on: Oak (Woodcutting built again) with DEX 15 cuts a log every 1:45, then a dungeon with DEX 15
    // searches 1:45 and fights.
    const oak = applyCommand(withBuilt(s, ['woodcutting']), { id: 'v3-oak', type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, s.time.lastSimulatedAt);
    if (!oak.ok) throw new Error(oak.error.message);
    const next = simulate(oak.state, s.time.lastSimulatedAt + MIN);
    expect(simulate(oak.state, s.time.lastSimulatedAt + 105 * SEC).summary.actions).toBe(1);
    const at = s.time.lastSimulatedAt + MIN;
    const d = applyCommand(next.state, { id: 'v3-d', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, at);
    if (!d.ok) throw new Error(d.error.message);
    expect(simulate(d.state, at + 105 * SEC - 1).state.activity).toMatchObject({ phase: 'search' });
    expect(simulate(d.state, at + 105 * SEC).state.activity).toMatchObject({ phase: 'fight' });
    const run = simulate(d.state, at + 105 * SEC + 60 * SEC).state;
    expect(run.dungeon.totals.runs).toBe(1);
    expect(run.dungeon.lastFight?.heroMaxHp).toBe(90);
  });
});

describe('golden 1.13.0: the Crafting house', () => {
  const at = (id: string) => runScript(SCRIPT.slice(0, SCRIPT.findIndex((x) => (x.id ?? (typeof x.cmd === 'object' ? x.cmd.id : undefined)) === id)));
  it('build, two pipes (x1 and x10 paid up front), a cancel with refunds, an insta, an upgrade mid-job, a held pipe, ~8 h away', () => {
    // BUILD paid 150 gold, 30 Oak Logs and 30 Stone; x1 jobs cost no stamina, the x10 job 1 stamina per craft up front.
    const c3 = at('c3');
    expect(c3.buildings.crafting).toEqual({ state: 'built', level: 1 });
    expect(c3.crafting.pipes[0]).toMatchObject({ id: 1, recipeId: 'oak_plank', quantity: 300, done: 0, craftMs: 4584, status: 'running' }); // 5 s × (1 − 8.33%)
    expect(c3.stamina.current).toBe(100);
    const c4 = at('c4');
    expect(c4.crafting.pipes[1]).toMatchObject({ mode: 'x10', quantity: 5, staminaPerCraft: 1, craftMs: 4584 });
    expect(c4.stamina.current).toBe(95);
    // Cancel at H + 15 s: crafts 1–2 delivered (20 bricks), craft 3 in progress → 3 crafts × 20 Stone back; crafts 4–5 not started → 2 stamina back.
    const c5 = at('c5');
    const c6 = at('c6');
    expect(c6.crafting.pipes[1]).toBeNull();
    expect(c6.stamina.current).toBe(97);
    expect(qtyOf(c6, 'stone') - qtyOf(c5, 'stone')).toBe(60);
    expect(qtyOf(c6, 'stone_brick')).toBe(20);
    // The upgrade to Lv2 completed mid-job: the crafts after it take 4,126 ms (×0.9), the earlier ones 4,584 ms.
    const c7 = at('c7');
    expect(c7.buildings.crafting.level).toBe(2);
    expect(c7.crafting.pipes[0]).toMatchObject({ craftMs: 4126 });
    // A full inventory holds the Copper Ingot pipe (the Birch Plank took the last slot); a sale frees a slot and it delivers.
    const c17 = at('c17');
    expect(c17.inventory.items).toHaveLength(20);
    expect(c17.crafting.pipes[2]).toMatchObject({ recipeId: 'copper_ingot', done: 0, status: 'held', progressMs: 8251, craftMs: 8251 });
    expect(c17.crafting.pipesUnlocked).toBe(3);
    const s = at('q0'); // the whole 1.13.0 script
    expect(s.crafting.pipes.every((p) => p === null)).toBe(true);
    expect([qtyOf(s, 'oak_plank'), qtyOf(s, 'stone_brick'), qtyOf(s, 'birch_plank'), qtyOf(s, 'copper_ingot')]).toEqual([300, 20, 3, 3]);
    expect(s.flags.debugUsed).toBe(true);
    expect(s.activity).toEqual(expect.objectContaining({ kind: 'training', attribute: 'strength' })); // pipes never touch the hero
    // 1.14.0: in the v13 shape (no gear rolls) the whole 1.13.0 script still hashes to the 1.13.0 pin.
    expect({ engineVersion: '1.13.0', hash: hashState(asV13(s)) }).toEqual({ engineVersion: '1.13.0', hash: '073a47bf' });
  });
});

const qtyOf = (s: GameState, defId: string) => s.inventory.items.filter((i) => i.defId === defId).reduce((n, i) => n + (i.quantity ?? 1), 0);

describe('golden 1.14.0: gear quality, rarity and gear crafting', () => {
  const at = (id: string) => runScript(SCRIPT.slice(0, SCRIPT.findIndex((x) => (x.id ?? (typeof x.cmd === 'object' ? x.cmd.id : undefined)) === id)));
  it('a rolled stock, a bought piece, gear jobs with invested stamina, a cancel, an insta, ready pipes, Done, equip', () => {
    // The refresh rolls each gear listing (0–50%, common / uncommon / rare) and fixes its price.
    const q3 = at('q3');
    expect(q3.merchant.stock).toEqual([
      { defId: 'health_potion_t1', quantity: 10, unitPrice: 12 },
      { defId: 'iron_pickaxe', quantity: 1, unitPrice: 609, qualityBp: 2704, rarity: 'uncommon' },
      { defId: 'iron_boots', quantity: 1, unitPrice: 293, qualityBp: 4661, rarity: 'common' },
      { defId: 'steel_pickaxe', quantity: 1, unitPrice: 2600, qualityBp: 3003, rarity: 'uncommon' },
      { defId: 'steel_axe', quantity: 1, unitPrice: 2342, qualityBp: 1711, rarity: 'uncommon' },
    ]);
    const q4 = at('q4');
    expect(q4.inventory.items.find((i) => i.id === 'iron_pickaxe#5')).toMatchObject({ qualityBp: 2704, rarity: 'uncommon' });
    expect(q3.character.gold - q4.character.gold).toBe(609);
    // Gear jobs: inputs and invested stamina paid at start; the roll is on the job (sword: floor 20%).
    const q7 = at('q7');
    expect(q7.crafting.pipes.slice(0, 3).map((j) => j && { recipeId: j.recipeId, gear: j.gear, status: j.status })).toEqual([
      { recipeId: 'stone_sword', gear: { staminaInvested: 20, qualityBp: 9921, rarity: 'rare' }, status: 'running' },
      { recipeId: 'stone_helm', gear: { staminaInvested: 0, qualityBp: 2126, rarity: 'epic' }, status: 'running' },
      { recipeId: 'stone_gloves', gear: { staminaInvested: 5, qualityBp: expect.any(Number), rarity: expect.any(String) }, status: 'running' },
    ]);
    // Cancel: the gloves' 2 bricks and 1 plank come back; the 5 stamina do not.
    const q8 = at('q8');
    expect(q8.crafting.pipes[2]).toBeNull();
    expect([qtyOf(q8, 'stone_brick') - qtyOf(q7, 'stone_brick'), qtyOf(q8, 'oak_plank') - qtyOf(q7, 'oak_plank')]).toEqual([2, 1]);
    expect(q8.stamina.current).toBe(q7.stamina.current);
    // Insta: the helm is ready at once and waits; the sword finished during the 2 h and waits too.
    const q8b = at('q8b');
    expect(q8b.crafting.pipes.slice(0, 2).map((j) => j?.status)).toEqual(['ready', 'ready']);
    const s = runScript();
    expect(s.crafting.pipes.every((p) => p === null)).toBe(true);
    expect(s.character.equipment.weapon).toMatchObject({ id: 'stone_sword#6', qualityBp: 9921, rarity: 'rare' });
    expect(s.inventory.items.find((i) => i.defId === 'stone_helm')).toMatchObject({ id: 'stone_helm#7', qualityBp: 2126, rarity: 'epic' });
    expect(getDerivedStats(s).damage.breakdown[0]).toMatchObject({ source: 'weapon', min: 4, max: 6 }); // 99.21% of 4–6
    expect(qtyOf(s, 'stone_brick')).toBe(13);
    expect({ engineVersion: ENGINE_VERSION, gold: s.character.gold, hash: hashState(s) }).toEqual({ engineVersion: '1.14.0', gold: 4053, hash: '8a4ca97f' });
  });
});
