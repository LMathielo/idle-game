import { describe, expect, it } from 'vitest';
import { applyPercent, type GameState, getDerivedStats, newGame, STATS } from '../src/engine';
import { apply, T0 } from './helpers';

const fresh = () => newGame(1, T0);

function withCharacter(s: GameState, patch: Partial<GameState['character']>): GameState {
  return { ...s, character: { ...s.character, ...patch } };
}

describe('derived stats', () => {
  it('new hero: STR/DEX/END/INT 10, damage 12–14, defense 13, HP 50, mana 20, with breakdowns', () => {
    const s = fresh();
    expect(s.character.attributes).toEqual({ strength: 10, dexterity: 10, endurance: 10, intelligence: 10 });
    const d = getDerivedStats(s);
    expect(d.damage).toEqual({
      min: 12,
      max: 14,
      breakdown: [
        { source: 'weapon', min: 2, max: 4, defId: 'rusty_gladius', slot: 'weapon' },
        { source: 'strength', min: 10, max: 10 },
      ],
    });
    expect(d.defense).toEqual({
      value: 13,
      breakdown: [
        { source: 'armor', value: 2, defId: 'linen_tunic', slot: 'armor' },
        { source: 'armor', value: 1, defId: 'worn_sandals', slot: 'boots' },
        { source: 'endurance', value: 10 },
      ],
    });
    expect(d.maxHp.value).toBe(50);
    expect(d.maxMana.value).toBe(20);
  });

  it('breakdown parts always add up to the final value', () => {
    const s = withCharacter(fresh(), { level: 9, attributes: { strength: 37, dexterity: 1, endurance: 23, intelligence: 4 } });
    const bonuses = { damage: [{ source: 't', bp: 1234 }], defense: [{ source: 't', bp: 777 }] };
    const d = getDerivedStats(s, bonuses);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(sum(d.damage.breakdown.map((p) => p.min))).toBe(d.damage.min);
    expect(sum(d.damage.breakdown.map((p) => p.max))).toBe(d.damage.max);
    expect(sum(d.defense.breakdown.map((p) => p.value))).toBe(d.defense.value);
    expect(sum(d.maxHp.breakdown.map((p) => p.value))).toBe(d.maxHp.value);
    expect(sum(d.maxMana.breakdown.map((p) => p.value))).toBe(d.maxMana.value);
  });

  it('+1 STR → damage 13–15; +1 END → defense 14; DEX and INT change nothing', () => {
    let s = fresh();
    s = apply(s, { type: 'DEBUG_ADD_ATTRIBUTE', attribute: 'strength', amount: 1 }, T0);
    expect([getDerivedStats(s).damage.min, getDerivedStats(s).damage.max]).toEqual([13, 15]);
    s = apply(s, { type: 'DEBUG_ADD_ATTRIBUTE', attribute: 'endurance', amount: 1 }, T0);
    expect(getDerivedStats(s).defense.value).toBe(14);
    const before = getDerivedStats(s);
    s = apply(s, { type: 'DEBUG_ADD_ATTRIBUTE', attribute: 'dexterity', amount: 5 }, T0);
    s = apply(s, { type: 'DEBUG_ADD_ATTRIBUTE', attribute: 'intelligence', amount: 5 }, T0);
    expect(getDerivedStats(s)).toEqual(before);
  });

  it('a percent bonus scales only the base part, never the STR/END flat part', () => {
    const s = fresh();
    // +50%: weapon 2–4 → 3–6, then +10 STR. Armor 3 → 4.5 → 5 (half-up), then +10 END.
    const d = getDerivedStats(s, { damage: [{ source: 'test', bp: 5000 }], defense: [{ source: 'test', bp: 5000 }] });
    expect([d.damage.min, d.damage.max]).toEqual([13, 16]);
    expect(d.damage.breakdown).toEqual([
      { source: 'weapon', min: 2, max: 4, defId: 'rusty_gladius', slot: 'weapon' },
      { source: 'percent', min: 1, max: 2 },
      { source: 'strength', min: 10, max: 10 },
    ]);
    expect(d.defense.value).toBe(15);
    expect(d.defense.breakdown.at(-2)).toEqual({ source: 'percent', value: 2 });
    expect(d.defense.breakdown.at(-1)).toEqual({ source: 'endurance', value: 10 });

    // The flat part stays exactly the attribute value, however large the bonus.
    const strong = withCharacter(s, { attributes: { ...s.character.attributes, strength: 1000 } });
    const big = getDerivedStats(strong, { damage: [{ source: 'test', bp: 90_000 }], defense: [] });
    expect(big.damage.min).toBe(2 * 10 + 1000);
    expect(big.damage.max).toBe(4 * 10 + 1000);
  });

  it('several bonuses add up before rounding; a huge negative bonus floors the base at 0', () => {
    const s = fresh();
    const two = getDerivedStats(s, { damage: [{ source: 'a', bp: 2500 }, { source: 'b', bp: 2500 }], defense: [] });
    expect([two.damage.min, two.damage.max]).toEqual([13, 16]);
    const neg = getDerivedStats(s, { damage: [{ source: 'curse', bp: -20_000 }], defense: [{ source: 'curse', bp: -20_000 }] });
    expect([neg.damage.min, neg.damage.max, neg.defense.value]).toEqual([10, 10, 10]);
  });

  it('applyPercent: integer half-up rounding, rejects non-integer bonuses', () => {
    expect(applyPercent(3, [])).toBe(3);
    expect(applyPercent(3, [{ source: 'x', bp: 5000 }])).toBe(5); // 4.5 → 5
    expect(applyPercent(5, [{ source: 'x', bp: 1000 }])).toBe(6); // 5.5 → 6
    expect(applyPercent(7, [{ source: 'x', bp: -1000 }])).toBe(6); // 6.3 → 6
    expect(applyPercent(0, [{ source: 'x', bp: 9999 }])).toBe(0);
    expect(() => applyPercent(3, [{ source: 'x', bp: 0.5 }])).toThrow(RangeError);
  });

  it('unarmed: no weapon (or a weapon the catalog does not know) deals 1–2 + STR', () => {
    const s = fresh();
    const { weapon: _w, ...noWeapon } = s.character.equipment;
    const unarmed = getDerivedStats(withCharacter(s, { equipment: noWeapon }));
    expect(unarmed.damage).toEqual({
      min: STATS.unarmedDamage.min + 10,
      max: STATS.unarmedDamage.max + 10,
      breakdown: [
        { source: 'unarmed', min: 1, max: 2 },
        { source: 'strength', min: 10, max: 10 },
      ],
    });
    expect([unarmed.damage.min, unarmed.damage.max]).toEqual([11, 12]);

    const mystery = { ...s.character.equipment.weapon!, defId: 'no_such_item' };
    const unknown = getDerivedStats(withCharacter(s, { equipment: { ...s.character.equipment, weapon: mystery } }));
    expect([unknown.damage.min, unknown.damage.max]).toEqual([11, 12]);
  });

  it('naked hero: defense is only END', () => {
    const d = getDerivedStats(withCharacter(fresh(), { equipment: {} }));
    expect(d.defense).toEqual({ value: 10, breakdown: [{ source: 'endurance', value: 10 }] });
  });

  it('item stats come from the catalog, not from the stored item', () => {
    const s = fresh();
    // A stored item carrying stale or forged stats has no effect: only defId is read.
    const forged = { ...s.character.equipment.weapon!, damage: { min: 999, max: 999 } } as never;
    const d = getDerivedStats(withCharacter(s, { equipment: { ...s.character.equipment, weapon: forged } }));
    expect([d.damage.min, d.damage.max]).toEqual([12, 14]);
  });

  it('HP and mana grow with hero level', () => {
    const at = (level: number) => getDerivedStats(withCharacter(fresh(), { level }));
    expect([at(1).maxHp.value, at(1).maxMana.value]).toEqual([50, 20]);
    expect([at(2).maxHp.value, at(2).maxMana.value]).toEqual([60, 25]);
    expect([at(11).maxHp.value, at(11).maxMana.value]).toEqual([150, 70]);
    expect(at(11).maxHp.breakdown).toEqual([
      { source: 'base', value: 50 },
      { source: 'level', value: 100 },
    ]);
  });

  it('derived stats are never stored in the save', () => {
    const s = fresh();
    expect(s.character).not.toHaveProperty('hp');
    expect(s.character).not.toHaveProperty('maxHp');
    expect(JSON.stringify(s)).not.toMatch(/"(damage|defense|maxMana|maxHp)"/);
  });
});
