// Mob drops (engine 1.26.0, owner decisions 2026-11-06): every entry of a monster's drop table rolls on its own; the Skeleton (5%) and the
// Troll (10%) drop Copper gear pieces, both a Wild Sage (5%); the same on Normal, Hard and Extreme (each mob of a pack rolls its own loot);
// stage gear is added with no reveal and is listed on the fight (`rewards.gears`); a piece that does not fit is lost and reported.
// The boss's table (Troll Head, unique Potion Belt) is covered in tests/firstBoss.test.ts.
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  chance,
  COMBAT,
  createRng,
  type Difficulty,
  DUNGEONS,
  type DungeonId,
  type FightRecord,
  type GameState,
  nextFloat,
  nextInt,
  searchMsFor,
  simulate,
  weightedPick,
} from '../src/engine';
import { rollQuality, rollRarity } from '../src/engine/gear';
import { getItemDef } from '../src/engine/config/items';
import { makeItem } from '../src/engine/inventory';
import { bossHero, cmd, HOUR, SEC, T0 } from './helpers';

const COPPER = ['copper_sword', 'copper_helm', 'copper_chestplate', 'copper_shield', 'copper_greaves', 'copper_gloves', 'copper_boots'];
// Pinned from the 1.26.0 engine (the golden rolls): seed 440 is a Troll kill with a Troll Hide, a Copper piece and a Wild Sage at once.
const TRIPLE_SEED = 440;
const GOLDEN_FIRST_PIECES = ['3:copper_gloves:common:24', '4:copper_helm:common:3', '13:copper_sword:common:4', '24:copper_shield:common:13', '26:copper_gloves:common:50', '31:copper_chestplate:common:3'];
const GOLDEN_PIECE_COUNT = 378;
const tb = (wins: number) => ({ runs: wins, wins, losses: 0 });

/** A hero no stage or pack can stop (huge STR and END), every stage open on every difficulty, a big bag. */
function god(): GameState {
  const s = structuredClone(bossHero(30, 'STR+END', 50, 'uncommon'));
  s.dungeon.byDungeon = { rat_cellar: tb(10), bat_cave: tb(15), wolf_den: tb(25), forgotten_crypt: tb(40), troll_bridge: tb(50) };
  s.dungeon.totals = { runs: 140, wins: 140, losses: 0 };
  s.dungeon.bosses = { troll_chieftain: tb(1) };
  s.dungeon.harder.hard.bosses = { troll_chieftain: tb(1) };
  const chain = (k: number) => ({ rat_cellar: tb(10 * k), bat_cave: tb(15 * k), wolf_den: tb(25 * k), forgotten_crypt: tb(40 * k), troll_bridge: tb(50 * k) });
  s.dungeon.harder.hard.byDungeon = chain(2);
  s.dungeon.harder.extreme.byDungeon = chain(8);
  s.character.spentPoints = { ...s.character.spentPoints, strength: 20_000, endurance: 3000 };
  s.character.hp = 1_000_000_000; // soaks anything a pack can do (as in tests/difficultyPacks.test.ts)
  s.inventory.capacity = 500;
  return s;
}

const GOD = god();

/** One WIN in `id` on `difficulty` from `seed`: starts a run and plays until its first fight is over (the next search is then underway). */
function kill(id: DungeonId, seed: number, difficulty: Difficulty = 'normal', base: GameState = GOD) {
  const start = applyCommand({ ...base, rng: createRng(seed) }, cmd({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: id, difficulty }), T0);
  if (!start.ok) throw new Error(`${start.error.code}: ${start.error.message}`);
  const sim = simulate(start.state, T0 + searchMsFor(id, start.state) + COMBAT.maxFightMs);
  const fight = sim.state.dungeon.lastFight as FightRecord;
  if (!fight.won) throw new Error('the god hero lost');
  return { state: sim.state, fight, summary: sim.summary, before: start.state };
}

const count = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const copperCount = (f: FightRecord) => Object.entries(f.rewards.items).filter(([k]) => k.startsWith('copper_')).reduce((n, [, v]) => n + v, 0);
const herb = (f: FightRecord) => f.rewards.items.wild_sage ?? 0;

describe('data (owner decisions 2026-11-06)', () => {
  it('Skeleton 5% and Troll 10% Copper gear: the seven combat pieces at equal weight, white 75 / green 25, quality 0..50, no tools', () => {
    for (const [id, p] of [['forgotten_crypt', 0.05], ['troll_bridge', 0.1]] as const) {
      const g = DUNGEONS[id].rewards.gear!;
      expect(g.chance).toBe(p);
      expect(g.pieces).toEqual(COPPER.map((itemId) => ({ itemId, weight: 1 })));
      expect(g.rarityWeights).toEqual([{ value: 'common', weight: 75 }, { value: 'uncommon', weight: 25 }]);
      expect(g.quality).toEqual({ min: 0, max: 50 });
      for (const piece of g.pieces) expect(getItemDef(piece.itemId)).toMatchObject({ slot: expect.any(String), stackable: false });
    }
  });

  it('the Wild Sage (5%) is a separate entry after the stage material, only for the Skeleton and the Troll; Rat, Bat and Wolf have no gear and no herb', () => {
    expect(DUNGEONS.forgotten_crypt.rewards.drops).toEqual([{ itemId: 'old_bone', chance: 0.25 }, { itemId: 'wild_sage', chance: 0.05 }]);
    expect(DUNGEONS.troll_bridge.rewards.drops).toEqual([{ itemId: 'troll_hide', chance: 0.2 }, { itemId: 'wild_sage', chance: 0.05 }]);
    for (const id of ['rat_cellar', 'bat_cave', 'wolf_den'] as const) {
      expect(DUNGEONS[id].rewards.gear).toBeUndefined();
      expect(DUNGEONS[id].rewards.drops.map((d) => d.itemId)).not.toContain('wild_sage');
    }
  });

  it('Wild Sage: a stackable common herb that sells for 10 and says it is a potion ingredient', () => {
    expect(getItemDef('wild_sage')).toMatchObject({ name: 'Wild Sage', rarity: 'common', stackable: true, sellPrice: 10 });
    expect(getItemDef('wild_sage')!.description).toMatch(/potion/i);
  });
});

describe('rates and independence (seeded, many kills)', () => {
  it('Forgotten Crypt on Normal: gear ~5%, Wild Sage ~5%, Old Bone ~25%; only a Skeleton gives them, nothing else drops', () => {
    const N = 4000;
    let gear = 0;
    let sage = 0;
    let bone = 0;
    for (const seed of count(N)) {
      const { fight } = kill('forgotten_crypt', seed);
      gear += copperCount(fight);
      sage += herb(fight);
      bone += fight.rewards.items.old_bone ?? 0;
      for (const k of Object.keys(fight.rewards.items)) expect(['old_bone', 'wild_sage', ...COPPER]).toContain(k);
    }
    expect(Math.abs(gear / N - 0.05)).toBeLessThan(0.016);
    expect(Math.abs(sage / N - 0.05)).toBeLessThan(0.016);
    expect(Math.abs(bone / N - 0.25)).toBeLessThan(0.03);
  });

  it('Troll Bridge on Normal: gear ~10%, Wild Sage ~5%, Troll Hide ~20%; the pieces, colours and quality follow the table', () => {
    const N = 4000;
    let gear = 0;
    let sage = 0;
    let hide = 0;
    const pieces: Record<string, number> = {};
    const colours: Record<string, number> = {};
    let qMin = 100;
    let qMax = 0;
    for (const seed of count(N)) {
      const { fight, state } = kill('troll_bridge', seed);
      sage += herb(fight);
      hide += fight.rewards.items.troll_hide ?? 0;
      for (const g of fight.rewards.gears ?? []) {
        gear += 1;
        pieces[g.defId] = (pieces[g.defId] ?? 0) + 1;
        colours[g.rarity] = (colours[g.rarity] ?? 0) + 1;
        qMin = Math.min(qMin, g.quality);
        qMax = Math.max(qMax, g.quality);
        const item = state.inventory.items.find((i) => i.id === g.itemId)!;
        expect(item).toMatchObject({ defId: g.defId, rarity: g.rarity, quality: g.quality, slot: expect.any(String) });
        expect(item.affixes).toBeUndefined(); // white and green pieces have no affixes
      }
    }
    expect(Math.abs(gear / N - 0.1)).toBeLessThan(0.02);
    expect(Math.abs(sage / N - 0.05)).toBeLessThan(0.016);
    expect(Math.abs(hide / N - 0.2)).toBeLessThan(0.03);
    expect(Object.keys(pieces).sort()).toEqual([...COPPER].sort());
    for (const n of Object.values(pieces)) expect(n / gear).toBeGreaterThan(0.08); // ~1/7 each
    expect(Object.keys(colours).sort()).toEqual(['common', 'uncommon']);
    expect(Math.abs(colours.common / gear - 0.75)).toBeLessThan(0.08);
    expect(qMin).toBeLessThanOrEqual(3);
    expect(qMax).toBeGreaterThanOrEqual(47);
    expect(qMax).toBeLessThanOrEqual(50);
  });

  it('INDEPENDENT: one Troll kill can give the Troll Hide, a Copper piece and a Wild Sage at once (seeded)', () => {
    const { fight, state } = kill('troll_bridge', TRIPLE_SEED);
    expect(fight.rewards.items.troll_hide).toBe(1);
    expect(herb(fight)).toBe(1);
    expect(copperCount(fight)).toBe(1);
    expect(fight.rewards.gears).toHaveLength(1);
    expect(state.inventory.items.some((i) => i.defId === 'wild_sage')).toBe(true);
  });

  it('INDEPENDENT: a gear hit does not change the herb or the material rate, and the herb does not change the gear rate', () => {
    const N = 8000;
    let kills = 0;
    let withGear = 0;
    let sageGivenGear = 0;
    let hideGivenGear = 0;
    let sage = 0;
    let gearGivenSage = 0;
    for (const seed of count(N)) {
      const { fight } = kill('troll_bridge', seed + 100_000);
      kills += 1;
      const g = copperCount(fight) > 0;
      const h = herb(fight) > 0;
      if (g) {
        withGear += 1;
        if (h) sageGivenGear += 1;
        if (fight.rewards.items.troll_hide) hideGivenGear += 1;
      }
      if (h) {
        sage += 1;
        if (g) gearGivenSage += 1;
      }
    }
    expect(kills).toBe(N);
    expect(Math.abs(sageGivenGear / withGear - 0.05)).toBeLessThan(0.04);
    expect(Math.abs(hideGivenGear / withGear - 0.2)).toBeLessThan(0.07);
    expect(Math.abs(gearGivenSage / sage - 0.1)).toBeLessThan(0.06);
  });

  it('Rat, Bat and Wolf drop no gear and no herb', () => {
    for (const id of ['rat_cellar', 'bat_cave', 'wolf_den'] as const) {
      for (const seed of count(300)) {
        const { fight } = kill(id, seed);
        expect(fight.rewards.gears).toBeUndefined();
        expect(fight.rewards.items.wild_sage).toBeUndefined();
        expect(Object.keys(fight.rewards.items).every((k) => k === DUNGEONS[id].rewards.drops[0].itemId)).toBe(true);
      }
    }
  });
});

describe('the roll order and the draws (deterministic)', () => {
  it('Normal kill: gold, gear chance, [piece, colour, quality], then the material, then the herb, all on the main stream', () => {
    const rule = DUNGEONS.troll_bridge.rewards;
    for (const seed of count(300)) {
      const { fight, state } = kill('troll_bridge', seed);
      // The god hero kills the Troll with his opening strike: 2 draws (roll, crit check), then the rewards.
      let rng = nextFloat(nextFloat(createRng(seed)).rng).rng;
      const gold = nextInt(rng, rule.gold.min, rule.gold.max);
      rng = gold.rng;
      expect(fight.rewards.gold).toBe(gold.value);
      const hit = chance(rng, rule.gear!.chance);
      rng = hit.rng;
      expect((fight.rewards.gears ?? []).length).toBe(hit.value ? 1 : 0);
      if (hit.value) {
        const piece = weightedPick(rng, rule.gear!.pieces.map((p) => ({ value: p.itemId, weight: p.weight })));
        const rarity = rollRarity(piece.rng, rule.gear!.rarityWeights);
        const quality = rollQuality(rarity.rng, 0, 50);
        rng = quality.rng;
        expect(fight.rewards.gears![0]).toMatchObject({ defId: piece.value, rarity: rarity.value, quality: quality.value });
      }
      const hide = chance(rng, 0.2);
      rng = hide.rng;
      expect((fight.rewards.items.troll_hide ?? 0) > 0).toBe(hide.value);
      const sage = chance(rng, 0.05);
      rng = sage.rng;
      expect(herb(fight) > 0).toBe(sage.value);
      expect(state.rng).toEqual(rng); // exactly these draws, nothing else (the affix stream is salted: the main one is not advanced)
    }
  });

  it('golden: Troll Bridge seeds 1..4000 give a fixed set of Copper pieces (colour and quality) and a fixed final stream', () => {
    const lines: string[] = [];
    for (const seed of count(4000)) {
      const { fight } = kill('troll_bridge', seed);
      for (const g of fight.rewards.gears ?? []) lines.push(`${seed}:${g.defId}:${g.rarity}:${g.quality}`);
    }
    expect(lines.slice(0, 6)).toEqual(GOLDEN_FIRST_PIECES);
    expect(lines).toHaveLength(GOLDEN_PIECE_COUNT);
  });

  it('is deterministic: the same seed gives the same kill; live play and one big simulate agree', () => {
    const a = kill('forgotten_crypt', 77);
    const b = kill('forgotten_crypt', 77);
    expect(b.state).toEqual(a.state);
    const start = applyCommand({ ...GOD, rng: createRng(5) }, cmd({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'troll_bridge', difficulty: 'normal' }), T0);
    if (!start.ok) throw new Error('start');
    const once = simulate(start.state, T0 + 3 * HOUR).state;
    let split = start.state;
    for (let t = 1; t <= 18; t++) split = simulate(split, T0 + t * 10 * 60 * SEC).state;
    expect(split).toEqual(once);
  });
});

describe('difficulty does not change the colour table, the chance or the quality; each mob of a pack rolls its own loot', () => {
  for (const difficulty of ['normal', 'hard', 'extreme'] as const) {
    it(`${difficulty}: Troll Bridge gear ~10% PER MOB, white 75 / green 25, quality 0..50, never a rarer colour`, () => {
      const N = difficulty === 'normal' ? 3000 : 500;
      let mobs = 0;
      let gear = 0;
      let common = 0;
      let qMax = 0;
      let sage = 0;
      let several = 0;
      for (const seed of count(N)) {
        const { fight, state } = kill('troll_bridge', seed, difficulty);
        mobs += fight.mobs.length;
        const gs = fight.rewards.gears ?? [];
        gear += gs.length;
        sage += herb(fight);
        if (gs.length > 1) several += 1;
        expect(copperCount(fight)).toBe(gs.length);
        for (const g of gs) {
          expect(['common', 'uncommon']).toContain(g.rarity);
          if (g.rarity === 'common') common += 1;
          qMax = Math.max(qMax, g.quality);
          expect(state.inventory.items.find((i) => i.id === g.itemId)).toBeDefined();
        }
      }
      expect(Math.abs(gear / mobs - 0.1)).toBeLessThan(0.02);
      expect(Math.abs(sage / mobs - 0.05)).toBeLessThan(0.015);
      expect(Math.abs(common / gear - 0.75)).toBeLessThan(0.08);
      expect(qMax).toBeLessThanOrEqual(50);
      if (difficulty === 'extreme') expect(several).toBeGreaterThan(0); // 7-10 mobs: a pack can drop several pieces
      if (difficulty === 'normal') expect(several).toBe(0); // one mob, at most one piece
    });
  }
});

describe('a full bag (stage gear and herb are lost and reported)', () => {
  const fillUp = (s: GameState): GameState => {
    const junk = Array.from({ length: s.inventory.capacity - s.inventory.items.length }, (_, i) => ({ ...makeItem('troll_hide', 1, `junk#${i}`), stackable: false as const }));
    return { ...s, inventory: { ...s.inventory, items: [...s.inventory.items, ...junk.map(({ quantity: _q, ...j }) => j)] } };
  };

  it('a Copper hit does not fit: reported in itemsLost (and the summary), no `gears` entry, no serial burned; the fight still pays', () => {
    const full = fillUp(GOD);
    let lostGear: ReturnType<typeof kill> | undefined;
    let lostHerb = false;
    for (const seed of count(600)) {
      const r = kill('troll_bridge', seed, 'normal', full);
      const lost = r.fight.rewards.itemsLost;
      expect(r.fight.rewards.gears).toBeUndefined();
      expect(copperCount(r.fight)).toBe(0);
      expect(r.state.inventory.items.length).toBe(full.inventory.items.length);
      expect(r.state.nextItemSerial).toBe(full.nextItemSerial);
      expect(r.summary.itemsLost).toEqual(lost);
      expect(r.fight.rewards.heroXp).toBe(DUNGEONS.troll_bridge.rewards.heroXp);
      if (Object.keys(lost).some((k) => k.startsWith('copper_'))) lostGear = r;
      if (lost.wild_sage) lostHerb = true;
    }
    expect(lostGear).toBeDefined();
    expect(lostHerb).toBe(true);
  });

  it('an owned Wild Sage stack still takes the herb when the bag is full (a stack needs no slot)', () => {
    const base = fillUp({ ...GOD, inventory: { ...GOD.inventory, items: [...GOD.inventory.items, makeItem('wild_sage', 3)] } });
    const withStack = { ...base, inventory: { ...base.inventory, items: base.inventory.items.slice(0, -1) } }; // keep it exactly full
    let got = false;
    for (const seed of count(600)) {
      const r = kill('troll_bridge', seed, 'normal', withStack);
      if (herb(r.fight) > 0) {
        got = true;
        expect(r.fight.rewards.itemsLost.wild_sage).toBeUndefined();
        expect(r.state.inventory.items.find((i) => i.defId === 'wild_sage')!.quantity).toBeGreaterThan(3);
      }
    }
    expect(got).toBe(true);
  });
});

describe('the away summary counts the gear gained and lost', () => {
  it('8 h of Forgotten Crypt runs: the summary lists each Copper piece gained (= the bag) and the herb; a small bag reports the rest as lost', () => {
    const base = { ...GOD, inventory: { ...GOD.inventory, capacity: GOD.inventory.items.length + 6 } };
    const start = applyCommand({ ...base, rng: createRng(11) }, cmd({ type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'forgotten_crypt', difficulty: 'normal' }), T0);
    if (!start.ok) throw new Error('start');
    const r = simulate(start.state, T0 + 8 * HOUR);
    const gainedCopper = Object.entries(r.summary.itemsGained).filter(([k]) => k.startsWith('copper_')).reduce((n, [, v]) => n + v, 0);
    const lostCopper = Object.entries(r.summary.itemsLost).filter(([k]) => k.startsWith('copper_')).reduce((n, [, v]) => n + v, 0);
    const inBag = r.state.inventory.items.filter((i) => i.defId.startsWith('copper_')).length;
    const before = start.state.inventory.items.filter((i) => i.defId.startsWith('copper_')).length;
    expect(gainedCopper).toBe(inBag - before);
    expect(gainedCopper + lostCopper).toBeGreaterThan(6); // ~240 runs x 5% = 12 hits: the bag (6 free slots) overflowed
    expect(lostCopper).toBeGreaterThan(0);
    expect(r.state.inventory.items.length).toBeLessThanOrEqual(r.state.inventory.capacity);
    expect(r.summary.itemsGained.old_bone).toBeGreaterThan(0);
  });
});
