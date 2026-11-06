// Gear rarity tiers and affixes (engine 1.22.0, save v21, owner-approved 2026-11-05): the gear level, the rarity multiplier on the
// main stat, the attribute bonuses (rare 1, epic 2 different), the perks (epic), how they enter the stat pipeline (plain points,
// final separate multipliers), rolling on salted sub-streams, and the recipe details selector. The save v21 migration is in
// tests/migrationV20.test.ts.
import { describe, expect, it } from 'vitest';
import {
  ALL_SLOTS_ORDER,
  affixAttributeMax,
  affixValue,
  applyCommand,
  attributeViews,
  craftingView,
  EQUIPMENT_SLOTS,
  type EquipmentSlot,
  effectiveAttributes,
  expectedCrewYieldBp,
  type GameState,
  gearAttributePoints,
  gearPerkTotals,
  gearStatsAt,
  getDerivedStats,
  getItemDef,
  heroPower,
  hpRegenPerMinute,
  hpRegenRate,
  type Item,
  type ItemDef,
  type ItemRarity,
  ITEMS,
  isGearDef,
  manaRegenRate,
  miningStrength,
  normalAttributes,
  perkMax,
  perkOf,
  RECIPES,
  scaleGearStat,
  simulate,
  woodcuttingStrength,
} from '../src/engine';
import { cloneState } from '../src/engine/clone';
import { GEAR, GEAR_PIECES, GEAR_SETS } from '../src/engine/config/gear';
import { affixStream, attributeBonusesOf, baseSellPrice, gearRarityDetail, rollAffixes } from '../src/engine/gear';
import { addStackable, makeItem } from '../src/engine/inventory';
import { createRng, nextFloat } from '../src/engine/rng';
import { rollPoolListings, rollStock } from '../src/engine/merchant';
import type { GearAffixes } from '../src/engine/types';
import { bossSlayer, builtGame, cmd, HOUR, T0, withCore } from './helpers';

type Input = Parameters<typeof cmd>[0];

function ok(s: GameState, c: Input, at = T0): GameState {
  const r = applyCommand(s, cmd(c), at);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
}

/** A built game with `pieces` equipped (id → [defId, quality, rarity, affixes]). */
function wearing(pieces: [string, number, ItemRarity, GearAffixes?][], seed = 1): GameState {
  const s = cloneState(builtGame(seed, T0));
  pieces.forEach(([defId, quality, rarity, affixes], i) => {
    const item = makeItem(defId, 1, `${defId}#${i}`, { quality, rarity, affixes });
    s.character.equipment[item.slot!] = item;
  });
  return s;
}

const GEAR_DEFS = (Object.values(ITEMS) as ItemDef[]).filter((d) => isGearDef(d));

describe('gear level (catalog data)', () => {
  it('every gear item has an integer gear level; nothing else does', () => {
    for (const def of Object.values(ITEMS) as ItemDef[]) {
      if (isGearDef(def)) expect(Number.isInteger(def.gearLevel) && def.gearLevel! >= 1, def.id).toBe(true);
      else expect(def.gearLevel, def.id).toBeUndefined();
    }
  });

  it('set pieces (all 9 piece types, tools included) are 5 × the set tier: Stone 5, Copper 10, Iron 15, Silver 20, Gold 25', () => {
    expect(GEAR_SETS.map((s) => [s.id, 5 * s.tier])).toEqual([['stone', 5], ['copper', 10], ['iron', 15], ['silver', 20], ['gold', 25]]);
    for (const set of GEAR_SETS) {
      for (const piece of Object.keys(GEAR_PIECES)) expect(getItemDef(`${set.id}_${piece}`)?.gearLevel, `${set.id}_${piece}`).toBe(5 * set.tier);
    }
  });

  it('the existing iron items are the Iron set (15); starter and wooden gear 1; Steel 20; that is the whole non-set catalog', () => {
    const lv = (id: string) => getItemDef(id)?.gearLevel;
    for (const id of ['iron_sword', 'iron_helm', 'iron_chestplate', 'iron_shield', 'iron_gloves', 'iron_boots', 'iron_axe', 'iron_pickaxe', 'iron_greaves']) expect(lv(id), id).toBe(15);
    for (const id of ['rusty_gladius', 'linen_tunic', 'worn_sandals', 'wooden_axe', 'wooden_pickaxe']) expect(lv(id), id).toBe(1);
    for (const id of ['steel_sword', 'steel_axe', 'steel_pickaxe']) expect(lv(id), id).toBe(20);
    const setIds = new Set(GEAR_SETS.flatMap((s) => Object.keys(GEAR_PIECES).map((p) => `${s.id}_${p}`)));
    const nonSet = GEAR_DEFS.map((d) => d.id).filter((id) => !setIds.has(id)).sort();
    expect(nonSet).toEqual(['linen_tunic', 'rusty_gladius', 'steel_axe', 'steel_pickaxe', 'steel_sword', 'wooden_axe', 'wooden_pickaxe', 'worn_sandals']);
  });
});

describe('rarity multiplier on the main stat', () => {
  // effective = max(1, round_half_up(max × (100 + quality) × ratioPct ÷ 20000)), one rounding, integers.
  const ref = (max: number, q: number, pct: number) => Math.max(1, Math.floor((max * (100 + q) * pct + 10_000) / 20_000));

  it('the percents are data: common 100, uncommon 110, rare 125, epic 150 (junk and legendary ×1)', () => {
    expect(GEAR.rarityStatPct).toEqual({ junk: 100, common: 100, uncommon: 110, rare: 125, epic: 150, legendary: 100 });
  });

  it('matches the integer formula for every rarity, quality and a spread of catalog maxima; one rounding', () => {
    const pct = GEAR.rarityStatPct;
    for (const r of ['junk', 'common', 'uncommon', 'rare', 'epic', 'legendary'] as ItemRarity[]) {
      for (const max of [1, 2, 3, 6, 8, 10, 14, 22, 34, 64, 128, 256]) {
        for (let q = 0; q <= 100; q += 1) expect(scaleGearStat(max, q, r)).toBe(ref(max, q, pct[r]));
      }
    }
  });

  it('worked values', () => {
    // 64 (Iron axe WS) at quality 50: common 48, uncommon 52.8 -> 53, rare 60, epic 72
    expect((['common', 'uncommon', 'rare', 'epic'] as const).map((r) => scaleGearStat(64, 50, r))).toEqual([48, 53, 60, 72]);
    expect(scaleGearStat(10, 100, 'epic')).toBe(15); // exactly 1.5x
    expect(scaleGearStat(34, 100, 'rare')).toBe(43); // 42.5 rounds half up
    expect(scaleGearStat(4, 0, 'uncommon')).toBe(2); // 2.2 -> 2
    expect(scaleGearStat(1, 0, 'common')).toBe(1); // never below 1
    expect(scaleGearStat(1, 0)).toBe(1); // default rarity = common: the pre-1.22.0 formula
    // the rounding is ONE: 5 at quality 10, epic = 5 × 110 ÷ 200 × 1.5 = 4.125 -> 4 (rounding the quality part first, round(2.75) = 3, then × 1.5 = 4.5 -> 5, would differ)
    expect(scaleGearStat(5, 10, 'epic')).toBe(4);
  });

  it('gear stats of an instance follow its rarity: damage min and max, armor, WS and MS (tools too)', () => {
    const sword = gearStatsAt(getItemDef('gold_sword'), 100, 'epic');
    expect(sword.damage).toEqual({ min: 36, max: 51 }); // 24 × 2 × 1.5, 34 × 2 × 1.5
    expect(gearStatsAt(getItemDef('gold_helm'), 100, 'rare').armor).toBe(Math.floor((15 * 200 * 125 + 10_000) / 20_000)); // 18.75 -> 19
    expect(gearStatsAt(getItemDef('gold_axe'), 100, 'epic').woodcuttingStrength).toBe(384); // 256 × 2 × 1.5 ÷ 2
    expect(gearStatsAt(getItemDef('iron_pickaxe'), 50, 'epic').miningStrength).toBe(72);
    const s = wearing([['iron_axe', 50, 'epic'], ['iron_pickaxe', 50, 'uncommon']]);
    expect(woodcuttingStrength(s).breakdown.axe).toBe(72);
    expect(miningStrength(s).breakdown.pickaxe).toBe(53);
  });

  it('the attack interval modifier is never scaled', () => {
    const def = { ...getItemDef('iron_sword')!, attackIntervalModMs: -150 };
    for (const r of ['common', 'uncommon', 'rare', 'epic'] as const) expect(gearStatsAt(def, 70, r).attackIntervalModMs).toBe(-150);
  });

  it('applies to every gear instance, an existing save’s too: a green / blue / purple piece in the equipment gets stronger', () => {
    const base = getDerivedStats(wearing([['iron_chestplate', 40, 'common']])).armor.value;
    const green = getDerivedStats(wearing([['iron_chestplate', 40, 'uncommon']])).armor.value;
    const purple = getDerivedStats(wearing([['iron_chestplate', 40, 'epic']])).armor.value;
    expect(base).toBeLessThan(green);
    expect(green).toBeLessThan(purple);
    expect(purple - base).toBe(scaleGearStat(10, 40, 'epic') - scaleGearStat(10, 40, 'common'));
  });

  it('prices do not change: sell value ignores affixes and quality, and follows the colour only', () => {
    const plain = makeItem('iron_sword', 1, 'a', { quality: 90, rarity: 'epic' });
    const rolled = makeItem('iron_sword', 1, 'b', { quality: 10, rarity: 'epic', affixes: { attributes: ['strength', 'endurance'], perk: 'max_damage' } });
    expect(baseSellPrice(rolled)).toBe(baseSellPrice(plain));
    expect(baseSellPrice(plain)).toBe(Math.floor((getItemDef('iron_sword')!.sellPrice * 400) / 100));
  });
});

describe('affix values (owner examples)', () => {
  it('attribute maxima: rare = gear level; epic = floor(1.5 × gear level) (lv 5 -> 7, lv 25 -> 37); none below rare', () => {
    expect([affixAttributeMax(5, 'rare'), affixAttributeMax(5, 'epic'), affixAttributeMax(25, 'epic'), affixAttributeMax(15, 'epic')]).toEqual([5, 7, 37, 22]);
    expect([affixAttributeMax(5, 'common'), affixAttributeMax(5, 'uncommon'), affixAttributeMax(5, 'legendary')]).toEqual([0, 0, 0]);
  });

  it('value = max(1, floor(max × quality ÷ 100)): lv5 blue q100 = 5, q99 = 4, q0 = 1', () => {
    expect(affixValue(5, 100)).toBe(5);
    expect(affixValue(5, 99)).toBe(4);
    expect(affixValue(5, 0)).toBe(1);
    expect(affixValue(7, 100)).toBe(7);
    expect(affixValue(37, 50)).toBe(18);
    for (let q = 0; q <= 100; q += 1) expect(affixValue(37, q)).toBe(Math.max(1, Math.floor((37 * q) / 100)));
  });

  it('on an instance (a Stone Sword, gear level 5): blue q100 +5, q99 +4, q0 +1; purple max 7 each; both attributes get the same value', () => {
    const blue = (quality: number) => makeItem('stone_sword', 1, 'b', { quality, rarity: 'rare', affixes: { attributes: ['endurance'] } });
    expect(attributeBonusesOf(blue(100))).toEqual([{ attribute: 'endurance', value: 5 }]);
    expect(attributeBonusesOf(blue(99))).toEqual([{ attribute: 'endurance', value: 4 }]);
    expect(attributeBonusesOf(blue(0))).toEqual([{ attribute: 'endurance', value: 1 }]);
    const purple = makeItem('stone_sword', 1, 'p', { quality: 100, rarity: 'epic', affixes: { attributes: ['strength', 'intelligence'], perk: 'max_damage' } });
    expect(attributeBonusesOf(purple)).toEqual([{ attribute: 'strength', value: 7 }, { attribute: 'intelligence', value: 7 }]);
    const gold = makeItem('gold_sword', 1, 'g', { quality: 100, rarity: 'epic', affixes: { attributes: ['dexterity', 'endurance'], perk: 'hp_regen' } });
    expect(attributeBonusesOf(gold).map((b) => b.value)).toEqual([37, 37]);
  });

  it('no bonus on common / uncommon, even if a stray affix is stored; a rare shows only its first attribute', () => {
    const stray: GearAffixes = { attributes: ['strength', 'endurance'], perk: 'max_armor' };
    expect(attributeBonusesOf(makeItem('stone_sword', 1, 'x', { quality: 80, rarity: 'common', affixes: stray }))).toEqual([]);
    expect(attributeBonusesOf(makeItem('stone_sword', 1, 'x', { quality: 80, rarity: 'uncommon', affixes: stray }))).toEqual([]);
    expect(perkOf(makeItem('stone_sword', 1, 'x', { quality: 80, rarity: 'rare', affixes: stray }))).toBeNull();
    expect(attributeBonusesOf(makeItem('stone_sword', 1, 'x', { quality: 80, rarity: 'rare', affixes: stray }))).toHaveLength(1);
  });

  it('perk value = max(1, floor(gear level × quality ÷ 100)) percent (lv 5 -> up to 5%, Gold up to 25%)', () => {
    const perk = (defId: string, quality: number) => perkOf(makeItem(defId, 1, 'p', { quality, rarity: 'epic', affixes: { attributes: ['strength', 'endurance'], perk: 'max_armor' } }));
    expect(perk('stone_helm', 100)).toEqual({ kind: 'max_armor', value: 5 });
    expect(perk('stone_helm', 0)).toEqual({ kind: 'max_armor', value: 1 });
    expect(perk('stone_helm', 99)).toEqual({ kind: 'max_armor', value: 4 });
    expect(perk('gold_helm', 100)?.value).toBe(25);
    expect(perk('gold_helm', 50)?.value).toBe(12);
    expect(perkMax(25, 'epic')).toBe(25);
    expect(perkMax(25, 'rare')).toBe(0);
  });
});

describe('rolling affixes', () => {
  it('common and uncommon get none and do not touch the stream; rare 1 attribute; epic 2 different + a perk', () => {
    const r0 = createRng(99);
    for (const rarity of ['junk', 'common', 'uncommon', 'legendary'] as const) {
      const a = rollAffixes(r0, 'weapon', rarity);
      expect(a.value).toBeUndefined();
      expect(a.rng).toEqual(r0);
    }
    const rare = rollAffixes(r0, 'weapon', 'rare');
    expect(rare.value!.attributes).toHaveLength(1);
    expect(rare.value!.perk).toBeUndefined();
    const epic = rollAffixes(r0, 'weapon', 'epic');
    expect(epic.value!.attributes).toHaveLength(2);
    expect(new Set(epic.value!.attributes).size).toBe(2);
    expect(['max_damage', 'max_armor', 'hp_regen', 'mana_regen']).toContain(epic.value!.perk);
  });

  it('purple attributes are always distinct; odds are uniform (attributes and the four combat perks), over many seeds', () => {
    const N = 24_000;
    const attrs: Record<string, number> = {};
    const first: Record<string, number> = {};
    const perks: Record<string, number> = {};
    const rareAttr: Record<string, number> = {};
    for (let seed = 1; seed <= N; seed += 1) {
      const e = rollAffixes(createRng(seed * 2654435761), 'helmet', 'epic').value!;
      expect(e.attributes[0]).not.toBe(e.attributes[1]);
      for (const a of e.attributes) attrs[a] = (attrs[a] ?? 0) + 1;
      first[e.attributes[0]] = (first[e.attributes[0]] ?? 0) + 1;
      perks[e.perk!] = (perks[e.perk!] ?? 0) + 1;
      const r = rollAffixes(createRng(seed * 40503 + 7), 'helmet', 'rare').value!;
      rareAttr[r.attributes[0]] = (rareAttr[r.attributes[0]] ?? 0) + 1;
    }
    const near = (n: number, expected: number) => expect(Math.abs(n - expected) / expected).toBeLessThan(0.04);
    expect(Object.keys(perks).sort()).toEqual(['hp_regen', 'mana_regen', 'max_armor', 'max_damage']);
    for (const k of Object.keys(perks)) near(perks[k], N / 4);
    expect(Object.keys(attrs).sort()).toEqual(['dexterity', 'endurance', 'intelligence', 'strength']);
    for (const k of Object.keys(attrs)) near(attrs[k], N / 2); // each attribute is in half of the pairs
    for (const k of Object.keys(first)) near(first[k], N / 4);
    for (const k of Object.keys(rareAttr)) near(rareAttr[k], N / 4);
  });

  it('a tool’s perk is fixed by its type: axe -> woodcutting strength, pickaxe -> mining strength (and draws nothing for it)', () => {
    const r0 = createRng(5);
    expect(rollAffixes(r0, 'axe', 'epic').value!.perk).toBe('woodcutting_strength');
    expect(rollAffixes(r0, 'pickaxe', 'epic').value!.perk).toBe('mining_strength');
    // two attribute draws only for a tool epic, three for a combat epic
    let two = r0;
    two = nextFloat(nextFloat(two).rng).rng;
    expect(rollAffixes(r0, 'axe', 'epic').rng).toEqual(two);
    expect(rollAffixes(r0, 'weapon', 'epic').rng).toEqual(nextFloat(two).rng);
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const e = rollAffixes(createRng(seed), 'axe', 'epic').value!;
      expect(e.perk).toBe('woodcutting_strength');
    }
  });

  it('same seed -> same affixes', () => {
    for (const seed of [1, 77, 123456]) {
      expect(rollAffixes(createRng(seed), 'shield', 'epic')).toEqual(rollAffixes(createRng(seed), 'shield', 'epic'));
    }
  });
});

describe('attribute bonuses are plain points from the equipment (never core, never in character.attributes)', () => {
  const blueEnd = (q = 100): [string, number, ItemRarity, GearAffixes] => ['stone_sword', q, 'rare', { attributes: ['endurance'] }]; // +5 END at q100

  it('count in the total and the normal part, not the core; the save’s attributes are untouched', () => {
    const s = wearing([blueEnd()]);
    expect(gearAttributePoints(s.character.equipment)).toEqual({ strength: 0, dexterity: 0, endurance: 5, intelligence: 0 });
    expect(normalAttributes(s).endurance).toBe(5);
    expect(effectiveAttributes(s).endurance).toBe(5);
    expect(s.character.attributes).toEqual({ strength: 0, dexterity: 0, endurance: 0, intelligence: 0 });
    expect(s.character.spentPoints.endurance).toBe(0);
    const [, , end] = attributeViews(s);
    expect(end).toMatchObject({ attribute: 'endurance', total: 5, normal: 5, spent: 0, extra: 0, gear: 5, core: 0 });
    const core = withCore(s, { endurance: 20 });
    expect(attributeViews(core)[2]).toMatchObject({ total: 25, normal: 5, gear: 5, core: 20 });
  });

  it('END gives HP, armor and HP regen; STR gives damage and WS / MS; INT gives magic and mana; the gear sums across pieces', () => {
    const none = wearing([]);
    const end = wearing([blueEnd()]);
    const dNone = getDerivedStats(none);
    const dEnd = getDerivedStats(end);
    expect(dEnd.maxHp.value - dNone.maxHp.value).toBe(25); // 5 per END point
    expect(dEnd.armor.value - dNone.armor.value).toBe(5); // 1 per END point (no armor on the sword)
    expect(hpRegenPerMinute(end) - hpRegenPerMinute(none)).toBeCloseTo(1, 10); // 0.2 per END point
    const str = wearing([['stone_helm', 100, 'rare', { attributes: ['strength'] }], ['stone_gloves', 100, 'rare', { attributes: ['strength'] }]]);
    expect(getDerivedStats(str).damage.min - dNone.damage.min).toBe(10); // +5 and +5 STR, 1 damage per point
    expect(woodcuttingStrength(str).value - woodcuttingStrength(none).value).toBe(10);
    expect(miningStrength(str).value - miningStrength(none).value).toBe(10);
    const int = wearing([['stone_boots', 100, 'rare', { attributes: ['intelligence'] }]]);
    expect(getDerivedStats(int).magicDamage.value).toBe(5);
    expect(getDerivedStats(int).magicResist.value).toBe(5);
    expect(getDerivedStats(int).maxMana.value - dNone.maxMana.value).toBe(25);
    expect(manaRegenRate(int) - manaRegenRate(none)).toBe(100); // 5 INT × 0.2/min = 1.00/min = 100 units
    const dex = wearing([['stone_boots', 100, 'rare', { attributes: ['dexterity'] }]]);
    expect(getDerivedStats(dex).critMultiplierBp.value).toBe(15_000 + 5 * 100);
    expect(getDerivedStats(dex).critChanceBp.value).toBe(0); // plain DEX: no crit chance (core DEX only)
  });

  it('the total is the same through every reader: a woodcutting crew inherits the STR bonus through the hero’s WS', () => {
    const s = wearing([['stone_helm', 100, 'rare', { attributes: ['strength'] }]]);
    expect(heroPower(s, 'woodcutting')).toBe(woodcuttingStrength(s).value);
    expect(effectiveAttributes(s).strength).toBe(5);
  });

  it('equipping and unequipping lowers max HP and brings current HP down to it (nothing above max)', () => {
    let s = wearing([]);
    s.inventory.items.push(makeItem('stone_sword', 1, 'sw', { quality: 100, rarity: 'rare', affixes: { attributes: ['endurance'] } }));
    s.character.equipment.weapon = undefined;
    delete s.character.equipment.weapon;
    s = ok(s, { type: 'EQUIP_ITEM', itemId: 'sw' });
    const maxWith = getDerivedStats(s).maxHp.value;
    // The room it gave fills by regen: current HP did not rise on equip.
    expect(s.character.hp).toBeLessThan(maxWith);
    s.character.hp = maxWith; // heal to the new max (a potion would)
    s.character.hpRegenProgress = 0;
    s = ok(s, { type: 'UNEQUIP_ITEM', slot: 'weapon' });
    expect(s.character.hp).toBe(getDerivedStats(s).maxHp.value);
    expect(s.character.hp).toBe(maxWith - 25);
  });
});

describe('perks: add across pieces, then multiply once, separately from core and last', () => {
  it('same-kind perks ADD (P% in total), and each kind is a final multiplier after the core percent', () => {
    // Stone helm (lv 5) q100 -> perk 5%, Copper gloves (lv 10) q100 -> 10%: 15% in all.
    const pieces: [string, number, ItemRarity, GearAffixes?][] = [
      ['stone_helm', 100, 'epic', { attributes: ['dexterity', 'endurance'], perk: 'max_damage' }],
      ['copper_gloves', 100, 'epic', { attributes: ['dexterity', 'intelligence'], perk: 'max_damage' }],
    ];
    expect(gearPerkTotals(wearing(pieces).character.equipment).max_damage).toBe(15);
    // spent STR 20, core STR 50 (+25%; core also counts as plain STR: 70 in all), the starting Rusty Gladius (2-4 at q25).
    const bare = withCore(wearing([]), { strength: 50 });
    bare.character.spentPoints.strength = 20;
    const perked = withCore(wearing(pieces), { strength: 50 });
    perked.character.spentPoints.strength = 20;
    const dBare = getDerivedStats(bare).damage;
    const dPerk = getDerivedStats(perked).damage;
    // pre-core: weapon 2..4 + 10 base + 70 STR (the +DEX / +END / +INT bonuses add no STR) = 82..84; core +25% -> 102.5, 105 -> 103, 105;
    // then the perk: x1.15 (once, a separate step) -> 118.45 -> 118, 120.75 -> 121.
    expect([dBare.min, dBare.max]).toEqual([103, 105]);
    expect([dPerk.min, dPerk.max]).toEqual([118, 121]);
    // Not added into the core percent: that would be 82..84 x 1.40 = 114.8..117.6 -> 115, 118.
    expect([dPerk.min, dPerk.max]).not.toEqual([115, 118]);
    const parts = getDerivedStats(perked).damage.breakdown;
    expect(parts.at(-1)).toEqual({ source: 'perk', min: 15, max: 16 });
    expect(parts.at(-2)).toMatchObject({ source: 'core', attribute: 'strength' });
    expect(parts.reduce((n, p) => n + p.min, 0)).toBe(dPerk.min); // the parts still add up
    expect(parts.reduce((n, p) => n + p.max, 0)).toBe(dPerk.max);
  });

  it('max damage also lifts magic damage (final); max armor is armor only, not magic resist', () => {
    const s = withCore(wearing([['gold_helm', 100, 'epic', { attributes: ['intelligence', 'endurance'], perk: 'max_damage' }]]), { intelligence: 50, endurance: 50 });
    s.character.spentPoints.intelligence = 30;
    s.character.spentPoints.endurance = 10;
    const d = getDerivedStats(s);
    // INT 30 spent + 37 gold helm bonus + 50 core (core counts as plain too) = 117 magic; core INT 50 x1.25 -> 146.25 -> 146;
    // the gold helm's max damage perk (25% at q100) x1.25 -> 182.5 -> 183.
    const half = (v: number, pct: number) => Math.floor((v * (100 + pct) + 50) / 100);
    expect(d.magicDamage.value).toBe(half(half(30 + 37 + 50, 25), 25));
    expect(d.magicDamage.value).toBe(183);
    expect(d.magicDamage.breakdown.at(-1)).toMatchObject({ source: 'perk' });
    const armorS = withCore(wearing([['gold_helm', 100, 'epic', { attributes: ['intelligence', 'endurance'], perk: 'max_armor' }]]), { endurance: 50 });
    const noPerk = withCore(wearing([['gold_helm', 100, 'epic', { attributes: ['intelligence', 'endurance'] }]]), { endurance: 50 });
    const dA = getDerivedStats(armorS);
    const dN = getDerivedStats(noPerk);
    expect(dA.armor.value).toBe(Math.floor((dN.armor.value * 125 + 50) / 100));
    expect(dA.magicResist.value).toBe(dN.magicResist.value); // untouched
    expect(dA.damage).toEqual(dN.damage); // a different kind does not leak
  });

  it('a hero with core and perks on every kind: each kind multiplies once at the end (hand-computed)', () => {
    const s = withCore(
      wearing([
        ['silver_sword', 100, 'epic', { attributes: ['strength', 'endurance'], perk: 'max_damage' }], // lv 20: perk 20%, STR/END +30
        ['silver_chestplate', 100, 'epic', { attributes: ['strength', 'endurance'], perk: 'max_armor' }], // +30, +30; perk 20%
      ]),
      { strength: 50, endurance: 50 },
    );
    const d = getDerivedStats(s);
    const sword = gearStatsAt(getItemDef('silver_sword'), 100, 'epic').damage!;
    const chest = gearStatsAt(getItemDef('silver_chestplate'), 100, 'epic').armor!;
    const strTotal = 30 + 30 + 50; // two STR bonuses + core 50 counted as plain
    const endTotal = 30 + 30 + 50;
    const half = (v: number, pct: number) => Math.floor((v * (100 + pct) + 50) / 100);
    expect(d.damage.min).toBe(half(half(sword.min + 10 + strTotal, 25), 20));
    expect(d.damage.max).toBe(half(half(sword.max + 10 + strTotal, 25), 20));
    // armor: only the chestplate has armor here besides the Linen... the starter armor slot is replaced by the chestplate; boots stay
    const boots = gearStatsAt(getItemDef('worn_sandals'), 25, 'common').armor!;
    expect(d.armor.value).toBe(half(half(chest + boots + 10 + endTotal, 25), 20));
  });

  it('perks are separate kinds: damage, armor, regens, WS, MS never share a total', () => {
    const s = wearing([
      ['stone_sword', 100, 'epic', { attributes: ['strength', 'dexterity'], perk: 'max_damage' }],
      ['stone_helm', 100, 'epic', { attributes: ['strength', 'dexterity'], perk: 'max_armor' }],
      ['stone_gloves', 100, 'epic', { attributes: ['strength', 'dexterity'], perk: 'hp_regen' }],
      ['stone_boots', 100, 'epic', { attributes: ['strength', 'dexterity'], perk: 'mana_regen' }],
      ['stone_axe', 100, 'epic', { attributes: ['strength', 'dexterity'], perk: 'woodcutting_strength' }],
      ['stone_pickaxe', 100, 'epic', { attributes: ['strength', 'dexterity'], perk: 'mining_strength' }],
    ]);
    expect(gearPerkTotals(s.character.equipment)).toEqual({ max_damage: 5, max_armor: 5, hp_regen: 5, mana_regen: 5, woodcutting_strength: 5, mining_strength: 5 });
  });

  it('no cap: perks keep adding (two Gold pieces = 50%)', () => {
    const s = wearing([
      ['gold_sword', 100, 'epic', { attributes: ['strength', 'dexterity'], perk: 'max_damage' }],
      ['gold_helm', 100, 'epic', { attributes: ['strength', 'dexterity'], perk: 'max_damage' }],
    ]);
    expect(gearPerkTotals(s.character.equipment).max_damage).toBe(50);
  });

  it('HP and mana regen perks multiply the whole rate, exact in hundredths of a point per minute (half up)', () => {
    const none = wearing([]);
    expect(hpRegenRate(none)).toBe(1500);
    expect(manaRegenRate(none)).toBe(500);
    const hp5 = wearing([['stone_helm', 100, 'epic', { attributes: ['dexterity', 'intelligence'], perk: 'hp_regen' }]]); // +5%
    expect(hpRegenRate(hp5)).toBe(1575); // 1500 x 1.05
    expect(hpRegenPerMinute(hp5)).toBe(15.75);
    // the helm's own END bonus is 7 (epic, lv 5, q100): 15 + 0.2 x 7 = 16.4/min = 1640 units, x1.05 = 1722 exactly
    const withEnd = wearing([['stone_helm', 100, 'epic', { attributes: ['endurance', 'intelligence'], perk: 'hp_regen' }]]);
    expect(effectiveAttributes(withEnd).endurance).toBe(7);
    expect(hpRegenRate(withEnd)).toBe(1722);
    const odd = wearing([['stone_helm', 100, 'epic', { attributes: ['endurance', 'intelligence'], perk: 'hp_regen' }]]);
    odd.character.spentPoints.endurance = 3; // 10 END: 1500 + 200 = 1700 x 1.05 = 1785
    expect(hpRegenRate(odd)).toBe(1785);
    const rounding = wearing([['stone_helm', 100, 'epic', { attributes: ['strength', 'intelligence'], perk: 'hp_regen' }]]);
    rounding.character.spentPoints.endurance = 1; // 1520 x 1.05 = 1596 exactly; 1 END more: 1540 x 1.05 = 1617
    expect(hpRegenRate(rounding)).toBe(1596);
    rounding.character.spentPoints.endurance = 2;
    expect(hpRegenRate(rounding)).toBe(1617);
    const mp = wearing([['stone_helm', 100, 'epic', { attributes: ['dexterity', 'strength'], perk: 'mana_regen' }]]);
    expect(manaRegenRate(mp)).toBe(525);
    // half up: a rate that lands on .5 of a unit rounds up (1 unit = 0.01/min)
    const tiny = wearing([['stone_helm', 50, 'epic', { attributes: ['dexterity', 'strength'], perk: 'hp_regen' }]]); // 5 x 50 / 100 = 2%
    expect(hpRegenRate(tiny)).toBe(1530);
  });

  it('regen perks keep the banking exact and split-invariant: simulate(a) then simulate(b) == simulate(a + b)', () => {
    const s0 = wearing([['stone_helm', 100, 'epic', { attributes: ['endurance', 'intelligence'], perk: 'hp_regen' }]]);
    s0.character.hp = 1;
    s0.character.mana = 0;
    s0.time = { lastSimulatedAt: T0, highestSeenAt: T0 };
    const whole = simulate(s0, T0 + 61_237).state;
    const part = simulate(simulate(s0, T0 + 20_011).state, T0 + 61_237).state;
    expect(part.character).toEqual(whole.character);
    // exactly rate x ms in banked units (6 000 000 per HP), whatever the split
    const bank = (whole.character.hp - 1) * 6_000_000 + whole.character.hpRegenProgress;
    expect(bank).toBe(61_237 * hpRegenRate(s0));
  });
});

describe('woodcutting / mining strength perks feed gathering and workers', () => {
  const axe: [string, number, ItemRarity, GearAffixes] = ['iron_axe', 100, 'epic', { attributes: ['dexterity', 'intelligence'], perk: 'woodcutting_strength' }]; // 15%
  const pick: [string, number, ItemRarity, GearAffixes] = ['iron_pickaxe', 100, 'epic', { attributes: ['dexterity', 'intelligence'], perk: 'mining_strength' }];

  it('WS = (level + base + STR + axe) x (1 + perk), half up, once; the breakdown names the perk and still adds up', () => {
    const plain = wearing([['iron_axe', 100, 'epic']]);
    const perked = wearing([axe]);
    const a = woodcuttingStrength(plain);
    const b = woodcuttingStrength(perked);
    expect(a.breakdown.axe).toBe(96); // 64 x 2 x 1.5
    const pre = 10 + 10 + 0 + 96;
    expect(a.value).toBe(pre);
    expect(b.value).toBe(Math.floor((pre * 115 + 50) / 100)); // 133.4 -> 133
    expect(b.breakdown.perk).toBe(b.value - pre);
    expect(b.breakdown.level + b.breakdown.base + b.breakdown.strength + b.breakdown.axe + b.breakdown.perk).toBe(b.value);
  });

  it('MS the same; the other tool’s perk does not leak', () => {
    const s = wearing([pick, ['iron_axe', 100, 'epic']]);
    const m = miningStrength(s);
    const pre = 10 + 10 + 96;
    expect(m.value).toBe(Math.floor((pre * 115 + 50) / 100));
    expect(woodcuttingStrength(s).value).toBe(10 + 10 + 96);
  });

  it('a perk lifts the hero’s WS, so trees open and crews inherit it', () => {
    const plain = wearing([['iron_axe', 100, 'epic']]);
    const perked = wearing([axe]);
    expect(heroPower(perked, 'woodcutting')).toBeGreaterThan(heroPower(plain, 'woodcutting'));
    expect(heroPower(perked, 'woodcutting')).toBe(woodcuttingStrength(perked).value);
    // workers: yield = hero power x share ÷ requirement, so the expected crew yield rises with the perk
    expect(expectedCrewYieldBp(perked, 'oak', 1)).toBeGreaterThanOrEqual(expectedCrewYieldBp(plain, 'oak', 1));
    const bigAxe = wearing([['gold_axe', 100, 'epic', { attributes: ['dexterity', 'intelligence'], perk: 'woodcutting_strength' }]]);
    const bigPlain = wearing([['gold_axe', 100, 'epic']]);
    expect(expectedCrewYieldBp(bigAxe, 'oak', 2)).toBeGreaterThan(expectedCrewYieldBp(bigPlain, 'oak', 2));
  });

  it('the cutting yield uses it: a perked axe cuts more per log over time (same seed)', () => {
    const logs = (s: GameState) => {
      const started = ok(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' });
      return simulate(started, T0 + 2 * HOUR).state.inventory.items.find((i) => i.defId === 'oak_logs')?.quantity ?? 0;
    };
    const base = wearing([['gold_axe', 100, 'epic']], 11);
    const perked = wearing([['gold_axe', 100, 'epic', { attributes: ['dexterity', 'intelligence'], perk: 'woodcutting_strength' }]], 11);
    expect(logs(perked)).toBeGreaterThan(logs(base));
  });
});

describe('where affixes are rolled', () => {
  /** A craft with the stamina rule off, collected; returns the new item. */
  function craftOne(seed: number, recipeId: keyof typeof RECIPES): { item: Item; before: GameState; after: GameState } {
    let s = cloneState(builtGame(seed, T0));
    for (const i of RECIPES[recipeId].inputs) addStackable(s.inventory, i.defId, i.quantity);
    const before = s;
    s = ok(s, { type: 'START_CRAFT', pipe: 0, recipeId, maxCost: 0, stamina: 0 });
    const afterStart = s;
    s = simulate(s, T0 + 200 * HOUR).state;
    const ids = new Set(s.inventory.items.map((i) => i.id));
    s = ok(s, { type: 'COLLECT_CRAFT', pipe: 0, jobId: s.crafting.pipes[0]!.id }, T0 + 200 * HOUR);
    return { item: s.inventory.items.find((i) => !ids.has(i.id))!, before, after: afterStart };
  }

  it('crafting: rolled at job start (hidden on the job), by the piece’s rarity; the item gets them at Done; same seed -> same piece', () => {
    const seen: Record<string, number> = {};
    for (let seed = 1; seed <= 60; seed += 1) {
      const { item, after } = craftOne(seed, 'copper_axe');
      const job = after.crafting.pipes[0]!;
      expect(item.rarity).toBe(job.gear!.rarity);
      expect(item.affixes).toEqual(job.gear!.affixes);
      seen[item.rarity!] = (seen[item.rarity!] ?? 0) + 1;
      if (item.rarity === 'uncommon') expect(item.affixes).toBeUndefined();
      if (item.rarity === 'rare') {
        expect(item.affixes!.attributes).toHaveLength(1);
        expect(item.affixes!.perk).toBeUndefined();
      }
      if (item.rarity === 'epic') {
        expect(item.affixes!.attributes).toHaveLength(2);
        expect(item.affixes!.perk).toBe('woodcutting_strength'); // an axe
      }
      expect(craftOne(seed, 'copper_axe').item).toEqual(item);
    }
    expect(Object.keys(seen).sort()).toEqual(['epic', 'rare', 'uncommon']);
  });

  it('crafting does not move the main RNG stream: still exactly the two draws of quality and rarity', () => {
    const s0 = cloneState(builtGame(31, T0));
    for (const i of RECIPES.stone_sword.inputs) addStackable(s0.inventory, i.defId, i.quantity);
    const s = ok(s0, { type: 'START_CRAFT', pipe: 0, recipeId: 'stone_sword', maxCost: 0, stamina: 0 });
    let r = s0.rng;
    r = nextFloat(nextFloat(r).rng).rng;
    expect(s.rng).toEqual(r);
  });

  it('crafted combat epics roll a combat perk, tools their fixed perk', () => {
    let epicSeen = 0;
    for (let seed = 1; seed <= 400 && epicSeen < 3; seed += 1) {
      const { item } = craftOne(seed, 'stone_helm');
      if (item.rarity !== 'epic') continue;
      epicSeen += 1;
      expect(['max_damage', 'max_armor', 'hp_regen', 'mana_regen']).toContain(item.affixes!.perk);
    }
    expect(epicSeen).toBe(3);
  });

  it('Merchant: gear listings get affixes by rarity from a second salted stream; the main stream and the quality / rarity rolls are exactly what they were', () => {
    let rares = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const a = rollStock(createRng(seed), 8);
      const b = rollStock(createRng(seed), 8);
      expect(b).toEqual(a); // same seed -> same stock, affixes included
      for (const l of a.stock) {
        if (!l || l.quality === undefined) continue;
        if (l.rarity === 'rare') {
          rares += 1;
          expect(l.affixes!.attributes).toHaveLength(1);
          expect(l.affixes!.perk).toBeUndefined();
        } else {
          expect(l.affixes).toBeUndefined(); // the Merchant never rolls epic; common / uncommon none
        }
      }
      // The main stream: the picks only (one nextInt per pick); gear rolls and affixes use salted sub-streams.
      const picks = rollPoolListings(createRng(seed), 7, new Set(['health_potion_t1'])).rng;
      expect(a.rng).toEqual(picks);
    }
    expect(rares).toBeGreaterThan(10);
  });

  it('Merchant: buying a rolled piece keeps its affixes and the price follows the colour only', () => {
    let s = cloneState(builtGame(5, T0));
    s.buildings.merchant = { state: 'built', level: 1 };
    s.character.gold = 100_000;
    s.merchant.stock = [
      null,
      { defId: 'iron_sword', quantity: 1, unitPrice: 1000, quality: 60, rarity: 'rare', affixes: { attributes: ['dexterity'] } },
      null,
    ];
    s = ok(s, { type: 'BUY_ITEM', slot: 1, defId: 'iron_sword', quantity: 1, maxUnitPrice: 1000 });
    const bought = s.inventory.items.find((i) => i.defId === 'iron_sword')!;
    expect(bought).toMatchObject({ quality: 60, rarity: 'rare', affixes: { attributes: ['dexterity'] } });
    expect(s.character.gold).toBe(99_000);
    expect(attributeBonusesOf(bought)).toEqual([{ attribute: 'dexterity', value: 9 }]); // lv 15 x 60 / 100
  });

  it('the stored affixes are a copy: changing the item never changes the roll it came from', () => {
    const roll: GearAffixes = { attributes: ['strength', 'endurance'], perk: 'max_armor' };
    const item = makeItem('iron_helm', 1, 'h', { quality: 50, rarity: 'epic', affixes: roll });
    item.affixes!.attributes.push('dexterity');
    expect(roll.attributes).toEqual(['strength', 'endurance']);
  });
});

describe('boss gear drop', () => {
  /** A whole Troll Chieftain fight by a hero who one-shots it (the drop rolls draw from the main stream exactly as before 1.22.0). */
  function win(seed: number) {
    const s0 = bossSlayer(seed);
    const entered = ok(s0, { type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10 });
    const sim = simulate(entered, T0 + 130_000);
    return { before: s0, after: sim.state, fight: sim.state.dungeon.lastFight! };
  }

  it('a dropped piece rolls its affixes by rarity (green none, blue 1 attribute; never epic); same seed -> same piece; the main stream is the same either way', () => {
    let blue = 0;
    let green = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const r = win(seed);
      const g = r.fight.rewards.gear;
      if (!g) continue;
      const item = r.after.inventory.items.find((i) => i.id === g.itemId)!;
      expect(item).toMatchObject({ rarity: g.rarity, quality: g.quality });
      if (g.rarity === 'rare') {
        blue += 1;
        expect(item.affixes!.attributes).toHaveLength(1);
        expect(item.affixes!.perk).toBeUndefined();
      } else {
        green += 1;
        expect(item.affixes).toBeUndefined();
      }
      if (seed <= 40) expect(win(seed).after.inventory.items.find((i) => i.id === g.itemId)).toEqual(item);
    }
    expect(blue).toBeGreaterThan(10);
    expect(green).toBeGreaterThan(30);
  });
});

describe('ALL_SLOTS_ORDER covers every equipment slot (PR #35 council finding)', () => {
  it('every slot is in it exactly once, so a pickaxe’s attack interval modifier counts', () => {
    expect([...ALL_SLOTS_ORDER].sort()).toEqual([...EQUIPMENT_SLOTS].sort());
    expect(new Set(ALL_SLOTS_ORDER).size).toBe(EQUIPMENT_SLOTS.length);
    expect(ALL_SLOTS_ORDER).toContain('pickaxe' satisfies EquipmentSlot);
  });
});

describe('recipe details (the Crafting house’s read-only selector)', () => {
  it('gearRarityDetail: Iron Axe (lv 15): green none, blue 1 attribute 1..15, purple 2 attributes 1..22 and a fixed WS perk 1..15', () => {
    const def = getItemDef('iron_axe');
    const green = gearRarityDetail(def, 'uncommon', 75);
    const blue = gearRarityDetail(def, 'rare', 20);
    const purple = gearRarityDetail(def, 'epic', 5);
    expect(green).toMatchObject({ chancePct: 75, statPct: 110, attributes: null, perk: null });
    expect(green.atQuality0.woodcuttingStrength).toBe(scaleGearStat(64, 0, 'uncommon'));
    expect(green.atQuality100.woodcuttingStrength).toBe(scaleGearStat(64, 100, 'uncommon'));
    expect(blue).toMatchObject({ chancePct: 20, statPct: 125, attributes: { count: 1, min: 1, max: 15 }, perk: null });
    expect(purple).toMatchObject({ chancePct: 5, statPct: 150, attributes: { count: 2, min: 1, max: 22 }, perk: { kinds: ['woodcutting_strength'], min: 1, max: 15 } });
    expect(purple.atQuality100.woodcuttingStrength).toBe(96);
    expect(gearRarityDetail(getItemDef('iron_pickaxe'), 'epic', 5).perk?.kinds).toEqual(['mining_strength']);
    expect(gearRarityDetail(getItemDef('gold_sword'), 'epic', 5).perk).toEqual({ kinds: ['max_damage', 'max_armor', 'hp_regen', 'mana_regen'], min: 1, max: 25 });
  });

  it('every gear recipe card carries three colours (75 / 20 / 5) from the engine, matching the catalog; materials carry none', () => {
    const s = builtGame(1, T0);
    const cards = craftingView(s).recipes.filter((v) => v.gear);
    expect(cards).toHaveLength(45);
    for (const card of cards) {
      const def = getItemDef(card.output.defId)!;
      const d = card.gear!.rarityDetails;
      expect(d.map((x) => [x.rarity, x.chancePct])).toEqual([['uncommon', 75], ['rare', 20], ['epic', 5]]);
      expect(d.map((x) => x.statPct)).toEqual([110, 125, 150]);
      const lv = def.gearLevel!;
      expect(d[0]).toMatchObject({ attributes: null, perk: null });
      expect(d[1].attributes).toEqual({ count: 1, min: 1, max: lv });
      expect(d[2].attributes).toEqual({ count: 2, min: 1, max: Math.floor(1.5 * lv) });
      expect(d[2].perk).toMatchObject({ min: 1, max: lv });
      expect(d[2].perk!.kinds).toEqual(def.slot === 'axe' ? ['woodcutting_strength'] : def.slot === 'pickaxe' ? ['mining_strength'] : ['max_damage', 'max_armor', 'hp_regen', 'mana_regen']);
      for (const x of d) {
        expect(x.atQuality0).toEqual(gearStatsAt(def, 0, x.rarity));
        expect(x.atQuality100).toEqual(gearStatsAt(def, 100, x.rarity));
      }
    }
    expect(craftingView(s).recipes.filter((v) => !v.gear).every((v) => v.kind === 'material')).toBe(true);
  });
});

describe('affix streams', () => {
  it('affixStream never advances the main stream and differs per salt', () => {
    const base = createRng(123);
    const a = affixStream(base, GEAR.craft.affixSalt);
    const b = affixStream(base, GEAR.merchant.affixSalt);
    const c = affixStream(base, GEAR.drops.affixSalt);
    expect(base).toEqual({ seed: 123 });
    expect(new Set([a.seed, b.seed, c.seed, base.seed]).size).toBe(4);
    expect(new Set([GEAR.craft.affixSalt, GEAR.merchant.affixSalt, GEAR.drops.affixSalt, GEAR.merchant.rollSalt]).size).toBe(4);
  });
});
