// Golden 1.19.0 (save v19): a whole game from a plain `newGame` under the CURRENT rules, with no debug command and no edited
// config: 500 gold and nothing built, the village built with real BUILD commands, level-up points spent into a build, gathering
// for the Town Hall and Merchant, a Merchant refresh and buy, then dungeon runs (Rat Cellar, then the Bat Cave it opens) with
// crits, magic and 0.2-per-point regen. If a pin here moves, the rules changed outcomes: bump ENGINE_VERSION, check the change is
// intended, update the pin. (The older scripts, from the 1.17.0 start, are in tests/golden.test.ts.)
//
// 1.20.0 (save v20, first boss): this script plays no boss, so every OUTCOME pin below (gold 1221, hp [145,0], rng, runs 146/58)
// is unchanged from 1.19.0. Only the whole-state `hash` moved, because the v20 state has new fields (dungeon.bosses, the fight's
// regen/skill/stun fields, side.skills). golden.test.ts proves it: the older scripts' 1.19.0 hashes still hold in the v19 shape (asV19).
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  type Command,
  ENGINE_VERSION,
  type GameState,
  getDerivedStats,
  hashState,
  newGame,
  simulate,
} from '../src/engine';
import type { CommandInput } from '../src/client/types';
import { asV21, HOUR, MIN, SEC, T0 } from './helpers';

type Step = { at: number; cmd?: (s: GameState) => CommandInput };

const SEED = 0x119;
let n = 0;
const withId = (c: CommandInput): Command => ({ ...c, id: `g119-${++n}` }) as Command;

/** Everything unspent goes into a mixed build: half STR, a quarter DEX, an eighth END, the rest INT. */
const spendAll = (s: GameState): CommandInput => {
  const u = s.character.unspentPoints;
  const strength = Math.floor(u / 2);
  const dexterity = Math.floor(u / 4);
  const endurance = Math.floor(u / 8);
  return { type: 'SPEND_ATTRIBUTE_POINTS', points: { strength, dexterity, endurance, intelligence: u - strength - dexterity - endurance } };
};

const buyFirstPotion = (s: GameState): CommandInput => {
  const slot = s.merchant.stock.findIndex((l) => l?.defId === 'health_potion_t1');
  return { type: 'BUY_ITEM', slot, defId: 'health_potion_t1', quantity: 2, maxUnitPrice: s.merchant.stock[slot]!.unitPrice };
};

const RAT = { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' } as const;
const BAT = { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'bat_cave' } as const;

const A = T0 + 5 * SEC;
const B = A + 4 * HOUR;
const C = B + 10 * SEC;
const D = C + 2 * HOUR;
const E = D + 10 * SEC;
const F = E + 2 * HOUR;
const G = F + 10 * SEC;
const H = G + 3 * HOUR;

const SCRIPT: Step[] = [
  { at: T0, cmd: () => ({ type: 'BUILD', buildingId: 'woodcutting' }) },
  { at: T0 + 1 * SEC, cmd: () => ({ type: 'BUILD', buildingId: 'mine_shaft' }) },
  // 4 h of Rat Cellar runs: the hero levels up (5 points to spend per level), its HP regenerates at 15 per minute between fights.
  { at: T0 + 2 * SEC, cmd: () => RAT },
  { at: B },
  { at: B + 1 * SEC, cmd: spendAll },
  // 2 h of Oak, then 2 h of Stone for the Town Hall (20 + 20) and the Merchant (10 + 10).
  { at: C, cmd: () => ({ type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }) },
  { at: D },
  { at: E, cmd: () => ({ type: 'START_ACTIVITY', kind: 'mining', rockId: 'stone' }) },
  { at: F },
  { at: F + 1 * SEC, cmd: () => ({ type: 'BUILD', buildingId: 'town_hall' }) },
  { at: F + 2 * SEC, cmd: () => ({ type: 'BUILD', buildingId: 'merchant' }) },
  { at: F + 3 * SEC, cmd: () => ({ type: 'REFRESH_MERCHANT' }) },
  { at: F + 4 * SEC, cmd: buyFirstPotion },
  // Back to the dungeons: the Rat Cellar again, then the Bat Cave it opened after 10 wins.
  { at: G, cmd: () => RAT },
  { at: G + 1 * HOUR },
  { at: G + 1 * HOUR + 1 * SEC, cmd: () => BAT },
  { at: H },
];

function play(until: number = Infinity): GameState {
  n = 0;
  let s = newGame(SEED, T0);
  for (const step of SCRIPT) {
    if (step.at > until) break;
    if (step.cmd) {
      const r = applyCommand(s, withId(step.cmd(s)), step.at);
      if (!r.ok) throw new Error(`${step.at - T0} ms: ${r.error.code}: ${r.error.message}`);
      s = r.state;
    } else {
      s = simulate(s, step.at).state;
    }
  }
  return s;
}

describe('golden 1.19.0: a whole game from newGame', () => {
  it('starts with 500 gold and nothing built; the first two real BUILD commands cost 50 gold each', () => {
    expect(ENGINE_VERSION).toBe('1.25.0');
    const s0 = newGame(SEED, T0);
    expect(s0.character.gold).toBe(500);
    expect(Object.values(s0.buildings).every((b) => b.state === 'locked')).toBe(true);
    const s = play(T0 + 2 * SEC - 1);
    expect(s.buildings.woodcutting.state).toBe('built');
    expect(s.buildings.mine_shaft.state).toBe('built');
    expect(s.character.gold).toBe(400);
  });

  it('4 h of Rat Cellar: the hero levels up and gets points to spend, the build puts them into a mixed hero', () => {
    const before = play(B);
    expect(before.character.level).toBeGreaterThanOrEqual(5);
    expect(before.character.unspentPoints).toBe(5 * (before.character.level - 1));
    expect(before.dungeon.totals.losses).toBe(0);
    const after = play(B + 2 * SEC);
    expect(after.character.unspentPoints).toBe(0);
    const sp = after.character.spentPoints;
    expect(sp.strength + sp.dexterity + sp.endurance + sp.intelligence).toBe(before.character.unspentPoints);
    // flat stats from the plain points, no core points yet: no crit chance, a 1.5x + 0.01 x DEX multiplier
    const d = getDerivedStats(after);
    expect(d.critChanceBp.value).toBe(0);
    expect(d.critMultiplierBp.value).toBe(15_000 + 100 * sp.dexterity);
    expect(d.magicDamage.value).toBe(sp.intelligence);
    expect(d.maxHp.value).toBe(50 + 10 * (after.character.level - 1) + 5 * sp.endurance);
    expect(d.maxMana.value).toBe(20 + 5 * (after.character.level - 1) + 5 * sp.intelligence);
  });

  it('gathering feeds the Town Hall and the Merchant (real BUILD commands consume gold, logs and stone)', () => {
    const before = play(F);
    const after = play(F + 4 * SEC);
    expect(after.buildings.town_hall).toEqual({ state: 'built', level: 1 });
    expect(after.buildings.merchant).toEqual({ state: 'built', level: 1 });
    expect(before.character.gold - after.character.gold).toBeGreaterThanOrEqual(200 + 2 * 12 - 0); // 100 + 100 + the 2 potions
    expect(after.inventory.items.some((i) => i.defId === 'health_potion_t1')).toBe(true);
    expect(after.flags.debugUsed).toBe(false);
  });

  it('the whole script: no debug command, no loss in the Rat Cellar, the Bat Cave opened; strikes carry crit / physical / magic', () => {
    const s = play();
    expect(s.flags.debugUsed).toBe(false);
    expect(s.dungeon.byDungeon.rat_cellar!.losses).toBe(0);
    expect(s.dungeon.byDungeon.bat_cave!.runs).toBeGreaterThan(0);
    const last = s.dungeon.lastFight!;
    for (const e of last.log) {
      expect(e.dealt).toBe(Math.max(1, e.physical + e.magic));
      if (e.actor === 'enemy') expect([e.crit, e.magic]).toEqual([false, 0]);
    }
    expect(last.log.some((e) => e.actor === 'hero' && e.magic > 0)).toBe(true);
    expect(s.character.hp).toBeLessThanOrEqual(getDerivedStats(s).maxHp.value);
  });

  it('pins', () => {
    const s = play();
    // 1.22.0: the whole-state hash moved only because saveVersion is 21 now (this game never holds a rare or epic piece): in the v20 shape
    // it is still the 1.20.0 pin, so no outcome of the game changed.
    // 1.24.0: and seen in the v21 shape (asV21: no difficulty fields) the whole-state hash of the game is the 1.22.0 one.
    expect(hashState({ ...asV21(s), saveVersion: 20 } as unknown as GameState)).toBe('2adc197d'); // 1.25.0: re-pinned (was 2e1282a3): the combat opening shifts every fight
    expect({
      level: s.character.level,
      gold: s.character.gold,
      hp: [s.character.hp, s.character.hpRegenProgress],
      mana: [s.character.mana, s.character.manaRegenProgress],
      spent: s.character.spentPoints,
      dungeon: s.dungeon.byDungeon,
      lastFight: { dungeonId: s.dungeon.lastFight!.dungeonId, won: s.dungeon.lastFight!.won, ms: s.dungeon.lastFight!.durationMs, strikes: s.dungeon.lastFight!.log.length },
      rng: s.rng,
      hash: hashState(asV21(s)),
    }).toMatchInlineSnapshot(`
      {
        "dungeon": {
          "bat_cave": {
            "losses": 0,
            "runs": 59,
            "wins": 59,
          },
          "rat_cellar": {
            "losses": 0,
            "runs": 147,
            "wins": 147,
          },
        },
        "gold": 1211,
        "hash": "13541eac",
        "hp": [
          135,
          4212000,
        ],
        "lastFight": {
          "dungeonId": "bat_cave",
          "ms": 2000,
          "strikes": 5,
          "won": true,
        },
        "level": 9,
        "mana": [
          80,
          0,
        ],
        "rng": {
          "seed": 1837312982,
        },
        "spent": {
          "dexterity": 6,
          "endurance": 3,
          "intelligence": 4,
          "strength": 12,
        },
      }
    `);
  });

  it('is deterministic and split-invariant across the whole script', () => {
    expect(hashState(play())).toBe(hashState(play()));
    // the same final state if every simulate is cut in pieces of 7 min 13 s
    n = 0;
    let s = newGame(SEED, T0);
    let t = T0;
    const advance = (to: number) => {
      while (t < to) {
        t = Math.min(to, t + 7 * MIN + 13 * SEC);
        s = simulate(s, t).state;
      }
    };
    for (const step of SCRIPT) {
      if (step.cmd) {
        const r = applyCommand(s, withId(step.cmd(s)), step.at);
        if (!r.ok) throw new Error(r.error.message);
        s = r.state;
        t = step.at;
      } else {
        advance(step.at);
      }
    }
    expect(hashState(s)).toBe(hashState(play()));
  });
});
