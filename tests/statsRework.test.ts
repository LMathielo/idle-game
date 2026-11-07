// The stats rework (engine 1.19.0, save v19): STR physical damage, DEX crits, END toughness, INT magic. Plain (total) points give
// flat stats; core (training) points give a capped percent multiplier on the diminishing curve. Pins every formula, the strike
// (one crit draw per hero strike, physical crit, magic part, minimum), the fractional regen (0.2 per point, exact across
// resumes), property tests and the v18 -> v19 migration of a frozen v18 save.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { LogRow } from '../src/client/types';
import {
  type ActiveFight,
  attributeViews,
  COMBAT,
  critDamage,
  CURRENT_SAVE_VERSION,
  dangerHint,
  dexCritChanceBp,
  diminishingBp,
  DUNGEON_IDS,
  endArmorBonusBp,
  ENEMIES,
  ENGINE_VERSION,
  type GameState,
  getDerivedStats,
  hashState,
  hpRegenPerMinute,
  hpRegenRate,
  hpView,
  intMagicDamageBonusBp,
  loadSave,
  manaRegenPerMinute,
  manaRegenRate,
  manaView,
  type MigratePayload,
  MIGRATIONS,
  msUntilFull,
  nextFloat,
  newGame,
  reducedDamage,
  REGEN_RATE_SCALE,
  REGEN_UNIT,
  regenAmount,
  regenRateUnits,
  replayLogReport,
  type ReplayEntry,
  resolveFight,
  createRng,
  simulate,
  STAT_EFFECTS,
  STATS,
  strDamageBonusBp,
} from '../src/engine';
import { critMultiplierBp } from '../src/engine/attributes';
import { newFight, strike } from '../src/engine/combat';
import { apply, builtGame, fightSide, HOUR, makeClient, MIN, SEC, T0, v22Dungeon, withCore } from './helpers';

type Attrs = Partial<Record<'strength' | 'dexterity' | 'endurance' | 'intelligence', number>>;

/** A hero with spent (level-up) points; `core` sets the training levels. Level 1 unless given. */
function hero(spent: Attrs = {}, core: Attrs = {}, level = 1, seed = 1): GameState {
  const s = withCore(builtGame(seed, T0), core);
  return { ...s, character: { ...s.character, level, spentPoints: { ...s.character.spentPoints, ...spent } } };
}

describe('core curves (diminishing, k = 50)', () => {
  it('cap 50% (STR damage, END armor and resist, INT magic): core 10 -> 8.33%, 20 -> 14.28%, 50 -> 25%, 100 -> 33.33%', () => {
    for (const [core, bp] of [[0, 0], [10, 833], [20, 1428], [50, 2500], [100, 3333]] as const) {
      const s = hero({}, { strength: core, endurance: core, intelligence: core });
      expect([strDamageBonusBp(s), endArmorBonusBp(s), intMagicDamageBonusBp(s)], `core ${core}`).toEqual([bp, bp, bp]);
    }
    for (const stat of [STAT_EFFECTS.strength.damageMult, STAT_EFFECTS.endurance.armorMult, STAT_EFFECTS.intelligence.magicDamageMult]) {
      expect(stat).toEqual({ capBp: 5000, k: 50 });
    }
  });

  it('cap 40% (DEX crit chance): core 10 -> 6.66%, 50 -> 20%, 100 -> 26.66%', () => {
    expect(STAT_EFFECTS.dexterity.critChance).toEqual({ capBp: 4000, k: 50 });
    for (const [core, bp] of [[0, 0], [10, 666], [20, 1142], [50, 2000], [100, 2666]] as const) {
      expect(dexCritChanceBp(hero({}, { dexterity: core })), `core ${core}`).toBe(bp);
    }
  });

  it('core effects read the CORE part only: spent and extra points never move a multiplier', () => {
    const s = hero({ strength: 80, dexterity: 80, endurance: 80, intelligence: 80 });
    expect([strDamageBonusBp(s), dexCritChanceBp(s), endArmorBonusBp(s), intMagicDamageBonusBp(s)]).toEqual([0, 0, 0, 0]);
  });

  it('the old core effects are unchanged: DEX activity time and INT craft time', () => {
    expect(STAT_EFFECTS.dexterity.activityTime).toEqual({ capBp: 5000, k: 50 });
    expect(STAT_EFFECTS.intelligence.craftTime).toEqual({ capBp: 5000, k: 50 });
  });
});

describe('plain effects (the TOTAL = spent + extra + core)', () => {
  it('crit multiplier: 15 000 bp + 100 per total DEX, linear and uncapped (1 DEX -> 15 100, 100 -> 25 000)', () => {
    expect(STATS.crit).toEqual({ multiplierBaseBp: 15_000, multiplierPerDexterityBp: 100 });
    expect(critMultiplierBp(hero())).toBe(15_000);
    expect(critMultiplierBp(hero({ dexterity: 1 }))).toBe(15_100);
    expect(critMultiplierBp(hero({ dexterity: 100 }))).toBe(25_000);
    expect(critMultiplierBp(hero({ dexterity: 40 }, { dexterity: 60 }))).toBe(25_000); // spent + core both count
    expect(critMultiplierBp(hero({ dexterity: 5000 }))).toBe(515_000); // no cap
    expect(getDerivedStats(hero({ dexterity: 100 })).critMultiplierBp.value).toBe(25_000);
  });

  it('max HP = 50 + 10 per level above 1 + 5 per total END; max mana = 20 + 5 per level above 1 + 5 per total INT', () => {
    expect(STATS.hp).toEqual({ base: 50, perLevel: 10, perEndurance: 5 });
    expect(STATS.mana).toEqual({ base: 20, perLevel: 5, perIntelligence: 5 });
    const d = getDerivedStats(hero({ endurance: 10, intelligence: 7 }, { endurance: 3, intelligence: 1 }, 5));
    expect(d.maxHp.value).toBe(50 + 40 + 5 * 13);
    expect(d.maxMana.value).toBe(20 + 20 + 5 * 8);
    expect(d.maxHp.breakdown).toEqual([{ source: 'base', value: 50 }, { source: 'level', value: 40 }, { source: 'endurance', value: 65 }]);
    // DEX and STR add no HP or mana
    expect(getDerivedStats(hero({ strength: 50, dexterity: 50 })).maxHp.value).toBe(50);
    expect(getDerivedStats(hero({ strength: 50, dexterity: 50 })).maxMana.value).toBe(20);
  });

  it('magic damage and magic resist: +1 per total INT each', () => {
    const d = getDerivedStats(hero({ intelligence: 12 }, { intelligence: 8 }));
    expect([d.magicDamage.value, d.magicResist.value]).toEqual([20 + Math.round((20 * diminishingBp(8, 5000, 50)) / 10_000), 20]);
  });

  it('armor: +1 per total END; STR adds no armor, END adds no damage', () => {
    expect(getDerivedStats(hero({ endurance: 6 })).armor.value).toBe(13 + 6);
    expect(getDerivedStats(hero({ strength: 6 })).armor.value).toBe(13);
    expect(getDerivedStats(hero({ endurance: 6 })).damage).toEqual(getDerivedStats(hero()).damage);
  });
});

describe('core multipliers act on the FINAL value, rounded once (half-up)', () => {
  it('STR: (weapon + 10 base + total STR) x (1 + core STR), min and max each', () => {
    // total STR 70 (20 spent + 50 core): rusty gladius 2-4 + 10 + 70 = 82-84, x1.25 (2500 bp) = 102.5 -> 103, 105
    const d = getDerivedStats(hero({ strength: 20 }, { strength: 50 }));
    expect([d.damage.min, d.damage.max]).toEqual([103, 105]);
    expect(d.damage.breakdown.at(-1)).toEqual({ source: 'core', attribute: 'strength', min: 21, max: 21 });
    expect(d.damage.breakdown.reduce((n, p) => n + p.min, 0)).toBe(d.damage.min);
    expect(d.damage.breakdown.reduce((n, p) => n + p.max, 0)).toBe(d.damage.max);
  });

  it('a percent bonus scales the weapon first; the core multiplier then scales everything', () => {
    const s = hero({ strength: 10 }, { strength: 10 }); // total 20: 2-4 + 10 + 20; core 833 bp
    const d = getDerivedStats(s, { damage: [{ source: 't', bp: 5000 }], armor: [] });
    // weapon 3-6 after +50%; + 10 + 20 = 33-36; x1.0833 = 35.75 -> 36, 38.99 -> 39
    expect([d.damage.min, d.damage.max]).toEqual([36, 39]);
  });

  it('INT: magic damage = round(total INT x (1 + core INT))', () => {
    expect(getDerivedStats(hero({ intelligence: 20 }, { intelligence: 50 })).magicDamage.value).toBe(88); // 70 x 1.25 = 87.5
    expect(getDerivedStats(hero({}, {})).magicDamage.value).toBe(0);
  });

  it('END: armor and magic resist share ONE core factor, each a separate multiplier on its final value', () => {
    const s = hero({ endurance: 10, intelligence: 70 }, { endurance: 10 }); // core END 10 -> 833 bp; total END 20
    const d = getDerivedStats(s);
    expect(d.armor.value).toBe(Math.round((13 + 20) * 1.0833)); // 33 x 1.0833 = 35.75 -> 36
    expect(d.armor.value).toBe(36);
    expect(d.magicResist.value).toBe(76); // 70 x 1.0833 = 75.83
    expect(d.armor.breakdown.at(-1)).toEqual({ source: 'core', attribute: 'endurance', value: 3 });
    expect(d.magicResist.breakdown.at(-1)).toEqual({ source: 'core', attribute: 'endurance', value: 6 });
  });

  it('DEX: crit chance from core only, 40% cap; crit multiplier from total', () => {
    const d = getDerivedStats(hero({ dexterity: 30 }, { dexterity: 50 }));
    expect([d.critChanceBp.value, d.critMultiplierBp.value]).toEqual([2000, 15_000 + 100 * 80]);
    expect(getDerivedStats(hero({}, { dexterity: 1_000_000 })).critChanceBp.value).toBeLessThan(4000);
  });
});

describe('the attribute views list plain and core effects with numbers', () => {
  it('END 10 + core 10: +50 HP, +2 HP/min, +20 armor; core +8.33% armor and magic resist', () => {
    const [, , end] = attributeViews(hero({ endurance: 5 }, { endurance: 5 }));
    expect(end.linear).toEqual([{ kind: 'maxHp', amount: 50 }, { kind: 'hpRegen', amount: 2 }, { kind: 'armor', amount: 10 }]);
    expect(end.coreEffects).toEqual([{ kind: 'armorMult', bp: diminishingBp(5, 5000, 50) }]);
  });

  it('fractional regen is exact: 3 END = 0.6 HP/min (not 0.6000000000000001)', () => {
    const [, , end, int] = attributeViews(hero({ endurance: 3, intelligence: 3 }));
    expect(end.linear[1]).toEqual({ kind: 'hpRegen', amount: 0.6 });
    expect(int.linear[3]).toEqual({ kind: 'manaRegen', amount: 0.6 });
  });

  it('every attribute lists its plain effects and a core multiplier', () => {
    const v = attributeViews(hero({ strength: 2, dexterity: 2, endurance: 2, intelligence: 2 }, { strength: 1, dexterity: 1, endurance: 1, intelligence: 1 }));
    expect(v.map((a) => a.linear.map((e) => e.kind))).toEqual([
      ['damage', 'gatheringPower'],
      ['critMultiplier'],
      ['maxHp', 'hpRegen', 'armor'],
      ['magicDamage', 'magicResist', 'maxMana', 'manaRegen'],
    ]);
    expect(v.map((a) => a.coreEffects.map((e) => e.kind))).toEqual([['damageMult'], ['critChance', 'activityTime'], ['armorMult'], ['magicDamageMult', 'craftTime']]);
  });
});

describe('regen at 0.2 per point is exact', () => {
  it('rates are integer hundredths: 15 + 0.2 x END HP/min, 5 + 0.2 x INT mana/min', () => {
    expect(REGEN_RATE_SCALE).toBe(100);
    expect(REGEN_UNIT).toBe(6_000_000);
    expect(regenRateUnits(0.2)).toBe(20);
    expect(regenRateUnits(15)).toBe(1500);
    expect(regenRateUnits(NaN)).toBe(0);
    expect(regenRateUnits(-3)).toBe(0);
    expect(hpRegenRate(hero())).toBe(1500);
    expect(hpRegenRate(hero({ endurance: 1 }))).toBe(1520);
    expect(hpRegenRate(hero({ endurance: 3 }, { endurance: 2 }))).toBe(1600);
    expect(manaRegenRate(hero())).toBe(500);
    expect(manaRegenRate(hero({ intelligence: 1 }))).toBe(520);
    expect(hpRegenPerMinute(hero({ endurance: 3 }))).toBe(15.6);
    expect(manaRegenPerMinute(hero({ intelligence: 7 }))).toBe(6.4);
  });

  const hurt = (s: GameState, hp = 1, mana = 0): GameState => ({ ...s, character: { ...s.character, hp, mana, hpRegenProgress: 0, manaRegenProgress: 0 } });

  it('1 END: after 1 minute +15 HP and 0.2 HP banked; after 5 minutes exactly +76 HP and nothing banked', () => {
    const s = hurt(hero({ endurance: 1 }, {}, 100)); // level 100: room to regenerate
    const one = simulate(s, T0 + MIN).state.character;
    expect([one.hp, one.hpRegenProgress]).toEqual([1 + 15, 0.2 * REGEN_UNIT]);
    const five = simulate(s, T0 + 5 * MIN).state.character;
    expect([five.hp, five.hpRegenProgress]).toEqual([1 + 76, 0]);
  });

  it('3 INT: mana 5.6 per minute; 5 minutes = exactly 28', () => {
    const s = hurt(hero({ intelligence: 3 }, {}, 100));
    const five = simulate(s, T0 + 5 * MIN).state.character;
    expect([five.mana, five.manaRegenProgress]).toEqual([28, 0]);
    const one = simulate(s, T0 + MIN).state.character;
    expect([one.mana, one.manaRegenProgress]).toEqual([5, Math.round(0.6 * REGEN_UNIT)]);
  });

  it('banked units always equal elapsed x rate (no drift): hp x unit + progress == start + ms x rate', () => {
    const s = hurt(hero({ endurance: 7, intelligence: 3 }, { endurance: 4 }, 100), 10, 10); // total END 11 -> 1720 units, INT 3 -> 560
    for (const ms of [1, 999, 4_321, 59_999, 60_000, 123_457, 7 * MIN + 13]) {
      const c = simulate(s, T0 + ms).state.character;
      expect(c.hp * REGEN_UNIT + c.hpRegenProgress, `hp ${ms}`).toBe(10 * REGEN_UNIT + ms * 1720);
      expect(c.mana * REGEN_UNIT + c.manaRegenProgress, `mana ${ms}`).toBe(10 * REGEN_UNIT + ms * 560);
    }
  });

  it('split resumes are exact: simulate(a) then (b) == simulate(a + b), for 40 random splits, idle', () => {
    const s = hurt(hero({ endurance: 9, intelligence: 4 }, { endurance: 6, intelligence: 2 }, 100), 3, 3);
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed % n;
    };
    const end = T0 + 3 * HOUR + 777;
    const once = simulate(s, end).state;
    for (let trial = 0; trial < 40; trial++) {
      let cur = s;
      let t = T0;
      while (t < end) {
        t = Math.min(end, t + 1 + rnd(40 * MIN));
        cur = simulate(cur, t).state;
      }
      expect(hashState(cur)).toBe(hashState(once));
      expect(cur.character).toEqual(once.character);
    }
  });

  it('split resumes are exact through a dungeon (search and fight), at fractional rates for HP and mana', () => {
    const base = hurt(hero({ endurance: 3, intelligence: 3 }, { intelligence: 2 }, 6), 40, 5);
    const s = apply(base, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    const end = T0 + 21 * MIN + 17 * SEC + 321;
    const once = simulate(s, end).state;
    for (const step of [999, 7 * SEC, 61 * SEC, 3 * MIN + 1]) {
      let cur = s;
      for (let t = T0 + step; t < end; t += step) cur = simulate(cur, t).state;
      cur = simulate(cur, end).state;
      expect(hashState(cur), `step ${step}`).toBe(hashState(once));
    }
    expect(once.dungeon.totals.runs).toBeGreaterThan(5);
  });

  it('regenAmount / msUntilFull / views agree at a fractional rate', () => {
    // 15.2 HP/min = 1520 units: to heal 10 HP takes ceil(10 x 6 000 000 / 1520) ms
    expect(msUntilFull(0, 0, 10, 1520)).toBe(Math.ceil((10 * REGEN_UNIT) / 1520));
    const ms = msUntilFull(0, 0, 10, 1520);
    expect(regenAmount(0, 0, 10, 1520, ms)).toEqual([10, 0]);
    expect(regenAmount(0, 0, 10, 1520, ms - 1)![0]).toBe(9);
    const s = hurt(hero({ endurance: 1 }), 20);
    expect(hpView(s)).toMatchObject({ hp: 20, maxHp: 55, regenPerMin: 15.2, full: false, fullInMs: msUntilFull(20, 0, 55, 1520) });
    expect(manaView(hurt(hero({ intelligence: 2 }), 1, 4))).toMatchObject({ mana: 4, maxMana: 30, regenPerMin: 5.4 });
  });

  it('a higher max does not raise current HP or mana; it fills by regen. A lower max clamps what the views and regen show', () => {
    const s = hero({ endurance: 4, intelligence: 4 });
    const full = { ...s, character: { ...s.character, hp: 50, mana: 20 } }; // before the points counted
    expect([hpView(full).hp, hpView(full).maxHp, manaView(full).mana, manaView(full).maxMana]).toEqual([50, 70, 20, 40]);
    expect([full.character.hp, full.character.mana]).toEqual([50, 20]);
    const filled = simulate(full, T0 + 30 * MIN).state.character;
    expect([filled.hp, filled.mana]).toEqual([70, 40]);
    // the other way: stored above max (a max that dropped) is brought down by regen and shown clamped
    const over = { ...hero(), character: { ...hero().character, hp: 999, mana: 999 } };
    expect([hpView(over).hp, manaView(over).mana]).toEqual([50, 20]);
    const settled = simulate(over, T0 + SEC).state.character;
    expect([settled.hp, settled.mana, settled.hpRegenProgress, settled.manaRegenProgress]).toEqual([50, 20, 0, 0]);
  });
});

describe('the hero strike (1.19.0)', () => {
  const dummy = (hp = 1000) => ({ hp, ...fightSide({ damage: { min: 1, max: 1 } }) });
  const strikeOnce = (hero: ReturnType<typeof fightSide>, enemy: ReturnType<typeof fightSide>, seed = 7) => {
    const fight: ActiveFight = newFight('rat', hero, enemy, 1000, 1000, 100_000);
    const res = strike(fight, 'hero', 1000, 1000, createRng(seed));
    return { entry: fight.log[0], rng: res.rng, fight };
  };

  it('draws twice per hero strike (roll, then ONE crit check) and once per enemy strike, whatever the chance', () => {
    for (const critChanceBp of [0, 1234, 10_000]) {
      const { rng } = strikeOnce(fightSide({ damage: { min: 5, max: 9 }, critChanceBp }), fightSide());
      expect(rng).toEqual(nextFloat(nextFloat(createRng(7)).rng).rng);
    }
    const fight = newFight('rat', fightSide(), fightSide({ damage: { min: 2, max: 6 } }), 100, 100, 100);
    const e = strike(fight, 'enemy', 1000, 100, createRng(7));
    expect(e.rng).toEqual(nextFloat(createRng(7)).rng);
    expect(fight.log[0]).toMatchObject({ actor: 'enemy', crit: false, magic: 0 });
  });

  it('the RNG stream does not depend on the crit chance: same strike times, same final seed, same rolls (0% vs 100%)', () => {
    const tank = { hp: 1_000_000, ...fightSide({ armor: 1_000_000, magicResist: 1_000_000, damage: { min: 3, max: 30 } }) };
    const noCrit = resolveFight({ ...tank, critChanceBp: 0 }, tank, createRng(99), 30_000);
    const allCrit = resolveFight({ ...tank, critChanceBp: 10_000 }, tank, createRng(99), 30_000);
    expect(allCrit.rng).toEqual(noCrit.rng);
    expect(allCrit.log.map((e) => e.roll)).toEqual(noCrit.log.map((e) => e.roll));
    expect(noCrit.log.filter((e) => e.actor === 'hero').every((e) => !e.crit)).toBe(true);
    expect(allCrit.log.filter((e) => e.actor === 'hero').every((e) => e.crit)).toBe(true);
    expect(allCrit.log.filter((e) => e.actor === 'enemy').every((e) => !e.crit)).toBe(true);
  });

  it('a crit multiplies the physical roll (bp, half-up) before the enemy armor', () => {
    expect(critDamage(10, 15_000)).toBe(15);
    expect(critDamage(7, 15_100)).toBe(11); // 10.57
    expect(critDamage(3, 15_000)).toBe(5); // 4.5 rounds up
    const hero = fightSide({ damage: { min: 10, max: 10 }, critChanceBp: 10_000, critMultBp: 20_000 });
    const plain = strikeOnce({ ...hero, critChanceBp: 0 }, fightSide({ armor: 50 })).entry;
    const crit = strikeOnce(hero, fightSide({ armor: 50 })).entry;
    expect(plain).toMatchObject({ roll: 10, crit: false, physical: 5, magic: 0, dealt: 5 }); // 10 x 50 / 100
    expect(crit).toMatchObject({ roll: 10, crit: true, physical: 10, magic: 0, dealt: 10 }); // 20 x 50 / 100
  });

  it('the magic part is magic damage reduced by the enemy magic resist, never rolled, never critical; the total is the sum', () => {
    expect(COMBAT.armorK).toBe(50);
    expect(reducedDamage(30, 10)).toBe(25); // 30 x 50 / 60
    const hero = fightSide({ damage: { min: 10, max: 10 }, magicDamage: 30, critChanceBp: 10_000, critMultBp: 20_000 });
    const enemy = fightSide({ armor: 50, magicResist: 10 });
    const e = strikeOnce(hero, enemy).entry;
    expect(e).toMatchObject({ crit: true, physical: 10, magic: 25, dealt: 35 }); // the crit doubled the physical part only
    expect(strikeOnce({ ...hero, critChanceBp: 0 }, enemy).entry).toMatchObject({ crit: false, physical: 5, magic: 25, dealt: 30 });
    // magic ignores the armor, physical ignores the magic resist
    expect(strikeOnce(hero, fightSide({ armor: 0, magicResist: 1_000_000 })).entry).toMatchObject({ physical: 20, magic: 0, dealt: 20 });
  });

  it('a strike always deals at least COMBAT.minDamage; no magic means magic 0', () => {
    const e = strikeOnce(fightSide({ damage: { min: 1, max: 1 } }), fightSide({ armor: 1_000_000, magicResist: 1_000_000 })).entry;
    expect(e).toMatchObject({ physical: 0, magic: 0, dealt: COMBAT.minDamage });
    expect(strikeOnce(fightSide({ damage: { min: 8, max: 8 } }), fightSide()).entry.magic).toBe(0);
  });

  it('enemy strikes stay physical: armor only, no crit, the hero magic resist has no effect yet', () => {
    const enemy = fightSide({ damage: { min: 20, max: 20 } });
    const a = newFight('rat', fightSide({ armor: 50, magicResist: 0 }), enemy, 100, 100, 100);
    const b = newFight('rat', fightSide({ armor: 50, magicResist: 9999 }), enemy, 100, 100, 100);
    strike(a, 'enemy', 1000, 100, createRng(3));
    strike(b, 'enemy', 1000, 100, createRng(3));
    expect(a.log[0]).toEqual(b.log[0]);
    expect(a.log[0]).toMatchObject({ roll: 20, physical: 10, magic: 0, dealt: 10, crit: false });
  });

  it('crit rate follows the chance: 25% over 4000 strikes lands near 1000 (seeded)', () => {
    const hero = { hp: 1_000_000, ...fightSide({ damage: { min: 5, max: 5 }, critChanceBp: 2500 }) };
    const enemy = { hp: 1_000_000_000, ...fightSide({ armor: 0 }) };
    const r = resolveFight(hero, enemy, createRng(2026), 4_000_000);
    const heroStrikes = r.log.filter((e) => e.actor === 'hero');
    expect(heroStrikes).toHaveLength(4001); // 1.25.0: the hero opens at 0, so the strike due at exactly 4,000 s lands too (it was 4000)
    const crits = heroStrikes.filter((e) => e.crit).length;
    expect(crits).toBeGreaterThan(900);
    expect(crits).toBeLessThan(1100);
  });

  it('a real hero fight: the live loop logs crit / physical / magic and they add up', () => {
    const s = apply(hero({ strength: 5, dexterity: 40, intelligence: 30 }, { dexterity: 100 }, 3), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    const r = simulate(s, T0 + 2 * HOUR).state;
    expect(r.dungeon.totals.runs).toBeGreaterThan(10);
    const log = r.dungeon.lastFight!.log;
    for (const e of log) {
      expect(e.dealt).toBe(Math.max(1, e.physical + e.magic));
      if (e.actor === 'enemy') expect([e.crit, e.magic]).toEqual([false, 0]);
    }
    expect(log.some((e) => e.actor === 'hero' && e.magic > 0)).toBe(true);
  });
});

describe('the danger hint counts the expected crit and the magic part', () => {
  it('fresh hero: no crit, no magic; an INT hero adds the magic part; a DEX hero adds chance x multiplier on the physical part', () => {
    const fresh = dangerHint(hero(), 'rat_cellar');
    expect([fresh.heroMagicAvg, fresh.critChanceBp, fresh.critMultBp]).toEqual([0, 0, 15_000]);
    const mage = dangerHint(hero({ intelligence: 20 }), 'rat_cellar');
    expect(mage.heroMagicAvg).toBe(reducedDamage(20, ENEMIES.rat.magicResist));
    expect(mage.heroAvg).toBeCloseTo(fresh.heroAvg + mage.heroMagicAvg, 9);
    const dex = dangerHint(hero({ dexterity: 50 }, { dexterity: 50 }), 'wolf_den');
    const plain = dangerHint(hero({ dexterity: 0 }), 'wolf_den');
    expect(dex.critChanceBp).toBe(2000);
    expect(dex.critMultBp).toBe(15_000 + 100 * 100);
    expect(dex.heroAvg).toBeGreaterThan(plain.heroAvg * 1.2); // 20% x (2.5x - 1) = +30% on the physical part
  });

  it('is finite for every build and dungeon', () => {
    for (const id of DUNGEON_IDS) {
      const d = dangerHint(hero({ strength: 40, dexterity: 40, endurance: 40, intelligence: 40 }, { strength: 30, dexterity: 30, endurance: 30, intelligence: 30 }, 10), id);
      expect(Number.isFinite(d.heroAvg) && Number.isFinite(d.expectedHpLoss) && d.heroHits > 0).toBe(true);
    }
  });
});

describe('property tests (seeded random builds)', () => {
  let seed = 424242;
  const rnd = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const randomHero = () =>
    hero(
      { strength: rnd(200), dexterity: rnd(200), endurance: rnd(200), intelligence: rnd(200) },
      { strength: rnd(400), dexterity: rnd(400), endurance: rnd(400), intelligence: rnd(400) },
      1 + rnd(60),
    );

  it('derived stats are integers, finite and within their caps for 300 random heroes', () => {
    for (let i = 0; i < 300; i++) {
      const s = randomHero();
      const d = getDerivedStats(s);
      const ints = [d.damage.min, d.damage.max, d.magicDamage.value, d.armor.value, d.magicResist.value, d.critChanceBp.value, d.critMultiplierBp.value, d.maxHp.value, d.maxMana.value];
      for (const v of ints) expect(Number.isSafeInteger(v)).toBe(true);
      expect(d.damage.min).toBeLessThanOrEqual(d.damage.max);
      expect(d.critChanceBp.value).toBeLessThanOrEqual(4000);
      expect(d.critMultiplierBp.value).toBeGreaterThanOrEqual(15_000);
      for (const bp of [strDamageBonusBp(s), endArmorBonusBp(s), intMagicDamageBonusBp(s)]) {
        expect(bp).toBeGreaterThanOrEqual(0);
        expect(bp).toBeLessThanOrEqual(5000);
      }
      expect(d.maxHp.value).toBeGreaterThanOrEqual(50);
      expect(hpRegenPerMinute(s)).toBeGreaterThanOrEqual(15);
      expect(manaRegenPerMinute(s)).toBeGreaterThanOrEqual(5);
    }
  });

  it('a strike never deals less than the minimum and never produces NaN / Infinity, for random sides', () => {
    for (let i = 0; i < 400; i++) {
      const hero = fightSide({
        damage: { min: rnd(50), max: 50 + rnd(500) },
        armor: rnd(400),
        magicDamage: rnd(300),
        magicResist: rnd(400),
        critChanceBp: rnd(4001),
        critMultBp: 15_000 + rnd(30_000),
      });
      const enemy = fightSide({ damage: { min: 1 + rnd(20), max: 21 + rnd(80) }, armor: rnd(300), magicResist: rnd(300) });
      const f = newFight('rat', hero, enemy, 500, 500, 400);
      let r = createRng(1 + rnd(1_000_000));
      for (let k = 0; k < 6; k++) {
        r = strike(f, k % 2 === 0 ? 'hero' : 'enemy', 1000 * (k + 1), 500, r).rng;
      }
      for (const e of f.log) {
        expect(Number.isSafeInteger(e.dealt) && e.dealt >= COMBAT.minDamage).toBe(true);
        expect(e.physical).toBeGreaterThanOrEqual(0);
        expect(e.magic).toBeGreaterThanOrEqual(0);
        expect(e.dealt).toBe(Math.max(COMBAT.minDamage, e.physical + e.magic));
        expect(e.targetHpAfter).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('regen is never negative, never above max, never loses banked progress below one unit', () => {
    for (let i = 0; i < 2000; i++) {
      const max = 1 + rnd(5000);
      const value = rnd(max + 1);
      const progress = rnd(REGEN_UNIT);
      const rate = rnd(4000);
      const elapsed = rnd(3 * HOUR);
      const r = regenAmount(value, progress, max, rate, elapsed);
      if (r === null) continue;
      expect(r[0]).toBeGreaterThanOrEqual(value);
      expect(r[0]).toBeLessThanOrEqual(max);
      expect(r[1]).toBeGreaterThanOrEqual(0);
      expect(r[1]).toBeLessThan(REGEN_UNIT);
      if (r[0] === max) expect(r[1]).toBe(0);
    }
  });
});

describe('save v19 migration (v18 -> v19) of a frozen v18 save', () => {
  const FIXTURES = join(__dirname, 'fixtures');
  /** Written by the untouched 1.18.0 engine: Lv5, a Bat Cave fight in progress (1 s in), 7,000 HP and 44,000 mana units banked, a last fight with 9 strikes. */
  const V18_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v18.json'), 'utf8'));
  const V18_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v18.json'), 'utf8'));
  const entries = (rows: LogRow[]): ReplayEntry[] => rows.map(({ seq: _s, synced: _y, ...r }) => r);

  it('the fixture is what 1.18.0 wrote', () => {
    expect(V18_SAVE.saveVersion).toBe(18);
    expect(new Set(V18_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.18.0']));
    expect(hashState(V18_SAVE)).toBe(V18_LOG.at(-1)!.stateHash);
    expect(V18_SAVE.activity.fight.hero).toEqual({ damage: { min: 15, max: 17 }, defense: 17, attackIntervalMs: 1000 });
    expect(V18_SAVE.activity.fight.log[0]).not.toHaveProperty('crit');
    expect([V18_SAVE.character.hp, V18_SAVE.character.hpRegenProgress, V18_SAVE.character.manaRegenProgress]).toEqual([69, 7000, 44_000]);
  });

  it('banked regen keeps the same fraction of a point (x100 for the finer unit); HP and mana themselves are kept', () => {
    const s = loadSave(V18_SAVE);
    expect(s.saveVersion).toBe(CURRENT_SAVE_VERSION);
    expect(s.character.hp).toBe(V18_SAVE.character.hp);
    expect(s.character.mana).toBe(V18_SAVE.character.mana);
    expect(s.character.hpRegenProgress).toBe(700_000);
    expect(s.character.manaRegenProgress).toBe(4_400_000);
    expect(s.character.hpRegenProgress / REGEN_UNIT).toBeCloseTo(V18_SAVE.character.hpRegenProgress / 60_000, 12);
    expect(s.character.manaRegenProgress / REGEN_UNIT).toBeCloseTo(V18_SAVE.character.manaRegenProgress / 60_000, 12);
  });

  it('the fight in progress: defense -> armor, no magic, no crits (1.5x), the Bat keeps its resist; logged strikes widened; the rest untouched', () => {
    const s = loadSave(V18_SAVE);
    const f = (s.activity as { fight: ActiveFight }).fight;
    // (and the v20 step on top: no skills on either side)
    expect(f.hero).toEqual({ damage: { min: 15, max: 17 }, armor: 17, magicDamage: 0, magicResist: 0, critChanceBp: 0, critMultBp: 15_000, attackIntervalMs: 1000, skills: [] });
    expect(f.mobs[0].side).toEqual({ damage: { min: 6, max: 9 }, armor: 6, magicDamage: 0, magicResist: 6, critChanceBp: 0, critMultBp: 10_000, attackIntervalMs: 1000, skills: [] });
    expect(f.log).toEqual(V18_SAVE.activity.fight.log.map((e: { dealt: number }) => ({ ...e, crit: false, physical: e.dealt, magic: 0 })));
    const { hero: _h, mobs: _m, log: _l, ...fightRest } = f;
    const { hero: _rh, enemy: _re, enemyHp: rawHp, enemyMaxHp: rawMax, enemyStrikes: rawStrikes, log: _rl, ...rawFightRest } = V18_SAVE.activity.fight;
    // v20: the frozen 60 s limit, no enemy regen, no skills ready, no stun (tests/firstBoss.test.ts covers the v19 → v20 step)
    // v23: stamped with the old opening (first strikes one interval in) so it finishes the way it was going to
    expect(fightRest).toEqual({ ...rawFightRest, maxFightMs: 60_000, heroStunStrikes: 0, heroFirstStrikeMs: 1000, enemyFirstStrikeMs: 1000 });
    // v22: the one enemy is mob 0 of the pack, unchanged
    expect(f.mobs).toHaveLength(1);
    expect(f.mobs[0]).toMatchObject({ variant: 'base', multBp: 10_000, hp: rawHp, maxHp: rawMax, strikes: rawStrikes, regenBp: 0, regenProgress: 0, regenAtMs: rawFightRest.elapsedMs, skillReady: {} });
    expect(s.dungeon.lastFight!.log).toHaveLength(9);
    expect(s.dungeon.lastFight!.log).toEqual(V18_SAVE.dungeon.lastFight.log.map((e: { dealt: number }) => ({ ...e, crit: false, physical: e.dealt, magic: 0 })));
  });

  it('nothing else moves; deterministic and pure', () => {
    const frozen = JSON.parse(JSON.stringify(V18_SAVE));
    const s = loadSave(V18_SAVE);
    expect(V18_SAVE).toEqual(frozen); // the input is not mutated
    const { saveVersion: _v, character, activity: _a, dungeon, ...rest } = s;
    const { saveVersion: _rv, character: rawCharacter, activity: _ra, dungeon: rawDungeon, ...rawRest } = V18_SAVE;
    expect(rest).toEqual(rawRest);
    const { hpRegenProgress: _p, manaRegenProgress: _q, ...c } = character;
    const { hpRegenProgress: _rp, manaRegenProgress: _rq, ...rc } = rawCharacter;
    expect(c).toEqual(rc);
    expect({ ...dungeon, lastFight: null }).toEqual({ ...v22Dungeon({ ...rawDungeon, lastFight: null }), bosses: {} }); // v20: boss counters; v22: difficulty fields
    expect(hashState(loadSave(V18_SAVE))).toBe(hashState(s));
  });

  it('is tolerant: no fight, no activity, junk numbers', () => {
    expect(MIGRATIONS[18]({ saveVersion: 18 })).toEqual({ saveVersion: 19 });
    expect(MIGRATIONS[18]({ saveVersion: 18, activity: null, dungeon: { lastFight: null } })).toEqual({ saveVersion: 19, activity: null, dungeon: { lastFight: null } });
    const odd = MIGRATIONS[18]({ saveVersion: 18, character: { hpRegenProgress: 'x', manaRegenProgress: 12 } }) as { character: Record<string, number> };
    expect(odd.character).toEqual({ hpRegenProgress: 0, manaRegenProgress: 1200 });
  });

  it('plays on: the fight finishes under the 1.19.0 rules, regen keeps going, nothing breaks', () => {
    const s = loadSave(V18_SAVE);
    const later = simulate(s, V18_SAVE.time.lastSimulatedAt + 2 * HOUR).state;
    expect(later.dungeon.totals.runs).toBeGreaterThan(V18_SAVE.dungeon.totals.runs);
    expect(Number.isSafeInteger(later.character.hp)).toBe(true);
    expect(later.character.hp).toBeGreaterThanOrEqual(0);
    expect(later.character.hp).toBeLessThanOrEqual(getDerivedStats(later).maxHp.value);
    expect(later.character.hpRegenProgress).toBeLessThan(REGEN_UNIT);
    // the strikes after the migration are 1.19.0 strikes: crit field present on every new hero strike
    expect(later.dungeon.lastFight!.log.every((e) => typeof e.crit === 'boolean')).toBe(true);
  });

  it('loading writes a MIGRATE anchor (save 18 -> current, engine 1.18.0 -> current); the whole log replays', async () => {
    const repo = new MemoryGameRepository();
    await repo.init();
    await repo.commit(
      V18_LOG.map(({ seq: _seq, synced: _synced, ...r }) => r),
      V18_SAVE as GameState,
      { [META_ENGINE_VERSION]: '1.18.0', device_id: 'phone' },
    );
    const clock = new FakeClock(V18_SAVE.time.lastSimulatedAt + 3 * MIN);
    const { client } = makeClient({ repo, clock, prefix: 'v19' });
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({ fromSave: 18, toSave: CURRENT_SAVE_VERSION, fromEngine: '1.18.0', toEngine: ENGINE_VERSION, fromHash: V18_LOG.at(-1)!.stateHash, snapshot: undefined });
    expect(p.snapshot).toEqual(loadSave(V18_SAVE));
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: V18_LOG.length });
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});

describe('a new game is a v23 game', () => {
  it('saveVersion 23, engine 1.26.0 (the stats rework shipped as 1.19.0 / v19)', () => {
    expect(newGame(1, T0).saveVersion).toBe(23);
    expect(ENGINE_VERSION).toBe('1.26.0');
  });
});
