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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  type Command,
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
import { HOUR, MIN, SEC, T0, withBuilt } from './helpers';

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

type Step = { at: number; cmd?: Command | ((s: GameState) => Command) };

/** End of the 1.8.0 script; the 1.9.0 segment starts here. */
const E = D + 31 * SEC + HOUR;

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
  { at: C + 9 * SEC + 5 * HOUR }, // charges: 4 → 5 after 2 h, then full (no banked time)
  { at: C + 10 * SEC + 5 * HOUR, cmd: { id: 'm10', type: 'REFRESH_MERCHANT' } },
  { at: C + 11 * SEC + 5 * HOUR, cmd: { id: 'm11', type: 'REFRESH_MERCHANT' } },
  { at: C + 12 * SEC + 5 * HOUR, cmd: { id: 'm12', type: 'DEBUG_ADD_MERCHANT_CHARGE' } },
  { at: C + 13 * SEC + 5 * HOUR, cmd: { id: 'm13', type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'birch' } },
  { at: C + 14 * SEC + 5 * HOUR, cmd: { id: 'm14', type: 'BUY_ITEM', slot: 4, defId: 'iron_helm', quantity: 1, maxUnitPrice: 400 } },
  { at: C + 15 * SEC + 5 * HOUR, cmd: { id: 'm15', type: 'EQUIP_ITEM', itemId: 'iron_helm#2' } },
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
];

function runScript(steps: Step[] = SCRIPT) {
  let s = newGame(0xc0ffee, T0);
  for (const step of steps) {
    if (step.cmd) {
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
        "gold": 368,
        "heroLevel": 12,
        "hp": [
          160,
          0,
        ],
        "lastFightMs": 2000,
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
        "gold": 738,
        "heroLevel": 12,
        "hp": [
          141,
          30000,
        ],
        "lastFightMs": 5000,
        "nests": undefined,
        "stamina": {
          "current": 100,
          "max": 100,
          "progressMs": 0,
        },
        "strength": 13,
        "woodcutting": 5,
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
    }).toEqual({
      actions: 515,
      activity: 'training',
      gold: 1047, // 1.9.0: was 947; the Training Grounds gave Tier 1 instead of selling it for 100
      hp: [170, 0],
      heroLevel: 13,
      stamina: { current: 91, max: 100, progressMs: 1000 },
      woodcutting: expect.objectContaining({ level: 9, xp: 6619 }),
      logs: { oak_logs: 491, birch_logs: 24 },
      dungeon: expect.objectContaining({ totals: { runs: 181, wins: 181, losses: 0 } }),
      training: expect.objectContaining({ tier: 2 }),
      rng: expect.anything(),
    });
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
    }).toEqual({
      // Values from running the 1.8.0 script on dev (engine 1.8.0, 2026-10-28); only gold differs.
      actions: 527,
      gold: 1228, // 1.8.0: 1128
      heroLevel: 13,
      hp: [170, 0],
      dungeon: { runs: 214, wins: 214, losses: 0 },
      nests: 1,
      logs: { oak_logs: 391, birch_logs: 36 },
      tier: 2,
      xp: 2092,
      stamina: { current: 100, max: 100, progressMs: 0 },
      seed: 2143607419,
      nextItemSerial: 3,
      inventory: {
        capacity: 20,
        items: [
          { id: 'bread', defId: 'bread', name: 'Bread', icon: '🍞', stackable: true, quantity: 3 },
          { id: 'oak_logs', defId: 'oak_logs', name: 'Oak Logs', icon: '🪵', stackable: true, quantity: 391 },
          { id: 'rat_skin', defId: 'rat_skin', name: 'Rat Skin', icon: '🐾', stackable: true, quantity: 75 },
          { id: 'bat_wing', defId: 'bat_wing', name: 'Bat Wing', icon: '🪽', stackable: true, quantity: 12 },
          { id: 'bird_nest', defId: 'bird_nest', name: 'Bird Nest', icon: '🪺', stackable: true, quantity: 1 },
          { id: 'birch_logs', defId: 'birch_logs', name: 'Birch Logs', icon: '🪵', stackable: true, quantity: 36 },
          { id: 'health_potion_t1', defId: 'health_potion_t1', name: 'Health Potion (T1)', icon: '🧪', stackable: true, quantity: 2 },
        ],
      },
    });
  });

  it('fixed seed + fixed script → fixed final state hash', () => {
    const s = runScript();
    expect({
      engineVersion: ENGINE_VERSION,
      hash: hashState(s),
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
      helmet: s.character.equipment.helmet?.id,
      merchant: { charges: s.merchant.charges, chargeProgressMs: s.merchant.chargeProgressMs, stock: s.merchant.stock.slice(0, 5) },
      nextItemSerial: s.nextItemSerial,
      potions: s.inventory.items.find((i) => i.defId === 'health_potion_t1')?.quantity,
      woodenAxe: s.inventory.items.some((i) => i.defId === 'wooden_axe'),
      buildings: s.buildings,
      mining: s.character.skills.mining,
      pickaxe: s.character.equipment.pickaxe?.id,
      ores: Object.fromEntries(s.inventory.items.filter((i) => ['stone', 'copper_ore', 'geode'].includes(i.defId)).map((i) => [i.defId, i.quantity])),
      lastFight: s.dungeon.lastFight && { won: s.dungeon.lastFight.won, endReason: s.dungeon.lastFight.endReason },
      dungeonActivity: s.activity?.kind === 'dungeon' ? { phase: s.activity.phase, progressMs: s.activity.progressMs } : null,
    }).toMatchInlineSnapshot(`
      {
        "actions": 572,
        "activity": "dungeon",
        "axe": "iron_axe",
        "batWings": 12,
        "buildings": {
          "mine_shaft": {
            "level": 1,
            "state": "built",
          },
          "town_hall": {
            "level": 1,
            "state": "built",
          },
          "training_grounds": {
            "level": 1,
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
            "runs": 420,
            "wins": 420,
          },
        },
        "dungeon": {
          "losses": 0,
          "runs": 471,
          "wins": 471,
        },
        "dungeonActivity": {
          "phase": "search",
          "progressMs": 16000,
        },
        "engineVersion": "1.9.0",
        "gold": 1370,
        "hash": "4f740730",
        "helmet": "iron_helm#2",
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
          "birch_logs": 36,
          "oak_logs": 371,
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
              "defId": "iron_axe",
              "quantity": 1,
              "unitPrice": 600,
            },
            null,
            {
              "defId": "iron_sword",
              "quantity": 1,
              "unitPrice": 500,
            },
            null,
          ],
        },
        "mining": {
          "level": 6,
          "xp": 1753,
          "xpToNext": 7348,
        },
        "nests": 1,
        "nextItemSerial": 4,
        "ores": {
          "copper_ore": 12,
          "stone": 13,
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
              "level": 8,
              "progressMs": 46000,
              "xp": 55,
            },
          },
          "tier": 2,
        },
        "woodcutting": 9,
        "woodcuttingXp": 8047,
        "woodenAxe": false,
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
    expect(s.character.skills).toEqual(raw.character.skills);
    expect(s.character.skills.woodcutting.level).toBe(8);
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
    expect(next.state.inventory.items.find((i) => i.defId === 'oak_logs')?.quantity).toBe(3785 + next.summary.actions);
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
      xp: undefined,
      xpToNext: undefined,
      equipment: Object.fromEntries(Object.entries(raw.character.equipment).map(([k, v]) => [k, noRarity(v as Record<string, unknown>)])),
    });
    expect(axe?.defId).toBe('wooden_axe');
    expect(pickaxe?.defId).toBe('wooden_pickaxe');
    const { dungeon, training, activity, merchant, nextItemSerial, inventory, buildings: _b, character: _c, saveVersion: _v, ...rest } = s;
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
