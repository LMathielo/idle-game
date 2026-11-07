// The Potion Belt (engine 1.27.0, owner decisions 2026-11-06): an accessory whose item instance holds 4 slots of potions that drink
// by rules at exact engine times (live == offline, split-invariant), with per-type cooldowns shared with manual USE_ITEM.
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  bagPotions,
  BELT,
  type BeltRule,
  type BeltSlot,
  beltView,
  type FightLogEntry,
  type GameState,
  hashState,
  heroOwnsItem,
  isNoteworthy,
  ITEMS,
  maxHpOf,
  potionReadyAt,
  ruleSatisfied,
  simulate,
} from '../src/engine';
import { newPackFight } from '../src/engine/combat';
import { makeItem } from '../src/engine/inventory';
import { apply, bossHero, bossSlayer, builtGame, cmd, fightSide, SEC, T0, withTrollBridgeWins } from './helpers';

const T1 = 'health_potion_t1';
const GREATER = 'greater_health_potion';
const slotOf = (defId = T1, count = 25, rule: BeltRule = 'hp_below_50'): BeltSlot => ({ defId, count, rule });

/** The state wearing a Potion Belt with `slots` (up to 4; the rest empty). */
function belted(state: GameState, slots: BeltSlot[] = []): GameState {
  const belt = makeItem('potion_belt');
  belt.belt = [0, 1, 2, 3].map((i) => slots[i] ?? null);
  return { ...state, character: { ...state.character, equipment: { ...state.character.equipment, accessory: belt } } };
}

/** The state with the belt in the bag (not worn). */
const beltInBag = (state: GameState, slots: BeltSlot[] = []): GameState => {
  const w = belted(state, slots);
  const { accessory, ...equipment } = w.character.equipment;
  return { ...w, character: { ...w.character, equipment }, inventory: { ...w.inventory, items: [...w.inventory.items, accessory!] } };
};

/** The state with potion stacks in the bag, [defId, quantity] each (a stack that already exists is replaced). */
function withBag(state: GameState, stacks: [string, number][]): GameState {
  const items = state.inventory.items.filter((i) => !stacks.some(([d]) => d === i.defId));
  for (const [defId, n] of stacks) items.push(makeItem(defId, n));
  return { ...state, inventory: { ...state.inventory, items } };
}

const withHp = (state: GameState, hp: number): GameState => ({ ...state, character: { ...state.character, hp, hpRegenProgress: 0 } });
const beltOf = (s: GameState) => s.character.equipment.accessory!.belt!;
const countIn = (s: GameState, slot: number) => beltOf(s)[slot]?.count ?? 0;
const code = (s: GameState, c: Parameters<typeof cmd>[0], now = T0) => {
  const r = applyCommand(s, cmd(c), now);
  return r.ok ? 'ok' : r.error.code;
};
const bagCount = (s: GameState, defId: string) => s.inventory.items.filter((i) => i.defId === defId).reduce((n, i) => n + (i.quantity ?? 1), 0);
const MS = 1;

/** A level-20 hero (475 max HP): room for several 50 HP drinks. Idle. */
const big = () => bossHero(20, 'STR+END', 25);
const MAX = maxHpOf(big());

describe('the rules, exactly', () => {
  it('hp_below_50: at or under half of max HP (integer compare); hp_below_25 likewise; always: any HP below max; never at full', () => {
    expect(MAX).toBe(475);
    expect(ruleSatisfied('hp_below_50', 237, 475)).toBe(true); // 23 700 <= 23 750
    expect(ruleSatisfied('hp_below_50', 238, 475)).toBe(false);
    expect(ruleSatisfied('hp_below_50', 50, 100)).toBe(true); // exactly 50% counts
    expect(ruleSatisfied('hp_below_50', 51, 100)).toBe(false);
    expect(ruleSatisfied('hp_below_25', 118, 475)).toBe(true); // 11 800 <= 11 875
    expect(ruleSatisfied('hp_below_25', 119, 475)).toBe(false);
    expect(ruleSatisfied('hp_below_25', 25, 100)).toBe(true);
    expect(ruleSatisfied('always', 474, 475)).toBe(true);
    for (const rule of ['hp_below_50', 'hp_below_25', 'always'] as const) {
      expect(ruleSatisfied(rule, 475, 475)).toBe(false);
      expect(ruleSatisfied(rule, 0, 475)).toBe(true);
    }
  });

  it('the data: 4 slots, 25 each, default rule On 50% HP; the potions have a 20 s cooldown', () => {
    expect(BELT).toMatchObject({ slots: 4, maxPerSlot: 25, defaultRule: 'hp_below_50' });
    expect(ITEMS.health_potion_t1.cooldownMs).toBe(20_000);
    expect(ITEMS.greater_health_potion.cooldownMs).toBe(20_000);
  });
});

describe('the accessory slot', () => {
  it('only the Potion Belt fits it', () => {
    const accessories = Object.values(ITEMS).filter((d) => 'slot' in d && d.slot === 'accessory');
    expect(accessories.map((d) => d.id)).toEqual(['potion_belt']);
  });

  it('EQUIP_ITEM wears the belt; UNEQUIP_ITEM takes it off; the contents stay inside both ways', () => {
    const s = beltInBag(builtGame(1, T0), [slotOf(T1, 7), null as unknown as BeltSlot, slotOf(GREATER, 3, 'always')]);
    const worn = apply(s, { type: 'EQUIP_ITEM', itemId: 'potion_belt' }, T0);
    expect(worn.character.equipment.accessory).toMatchObject({ defId: 'potion_belt', belt: [slotOf(T1, 7), null, slotOf(GREATER, 3, 'always'), null] });
    expect(worn.inventory.items.some((i) => i.defId === 'potion_belt')).toBe(false);
    const off = apply(worn, { type: 'UNEQUIP_ITEM', slot: 'accessory' }, T0);
    expect(off.character.equipment.accessory).toBeUndefined();
    expect(off.inventory.items.find((i) => i.defId === 'potion_belt')!.belt).toEqual([slotOf(T1, 7), null, slotOf(GREATER, 3, 'always'), null]);
    expect(bagCount(off, T1)).toBe(0); // inside the belt, not in the bag
  });

  it('a new Potion Belt has four empty slots, no rarity roll and no quality (it is not gear)', () => {
    const belt = makeItem('potion_belt');
    expect(belt).toMatchObject({ slot: 'accessory', belt: [null, null, null, null] });
    expect(belt.quality).toBeUndefined();
    expect(belt.rarity).toBeUndefined();
  });

  it('heroOwnsItem counts a worn belt (the bag and the accessory slot)', () => {
    const s = builtGame(1, T0);
    expect(heroOwnsItem(s, 'potion_belt')).toBe(false);
    expect(heroOwnsItem(beltInBag(s), 'potion_belt')).toBe(true);
    expect(heroOwnsItem(belted(s), 'potion_belt')).toBe(true);
  });

  it('the Chieftain does not drop a second belt while one is worn, and the roll still draws (the stream does not depend on it)', () => {
    const run = (s: GameState) => {
      const e = applyCommand(s, cmd({ type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10 }), T0);
      if (!e.ok) throw new Error(e.error.message);
      return simulate(e.state, T0 + 130 * SEC).state;
    };
    const none = run(bossSlayer(5));
    expect(none.dungeon.lastFight!.rewards.items.potion_belt).toBe(1);
    const worn = run(belted(bossSlayer(5)));
    expect(worn.dungeon.lastFight!.rewards.items.potion_belt).toBeUndefined();
    expect(worn.dungeon.lastFight!.rewards.itemsLost.potion_belt).toBeUndefined();
    expect(worn.inventory.items.some((i) => i.defId === 'potion_belt')).toBe(false);
    expect(worn.rng).toEqual(none.rng);
    expect(worn.dungeon.lastFight!.rewards.gold).toBe(none.dungeon.lastFight!.rewards.gold);
  });

  it('selling the belt destroys its contents (a worn belt cannot be sold at all)', () => {
    const s = beltInBag(builtGame(1, T0), [slotOf(T1, 3)]);
    const gold = s.character.gold;
    const sold = apply(s, { type: 'SELL_ITEM', itemId: 'potion_belt', quantity: 1 }, T0);
    expect(sold.character.gold - gold).toBe(100);
    expect(sold.inventory.items.some((i) => i.defId === 'potion_belt')).toBe(false);
    expect(bagCount(sold, T1)).toBe(0); // the three potions are gone
    expect(code(belted(builtGame(1, T0), [slotOf(T1, 3)]), { type: 'SELL_ITEM', itemId: 'potion_belt', quantity: 1 })).toBe('ITEM_EQUIPPED');
  });
});

describe('BELT_PUT', () => {
  const base = () => belted(withBag(builtGame(1, T0), [[T1, 30]]));

  it('moves as many as fit (25 a slot): they leave the bag, an empty slot gets the default rule', () => {
    const s = apply(base(), { type: 'BELT_PUT', itemId: T1, slot: 0 }, T0);
    expect(beltOf(s)[0]).toEqual({ defId: T1, count: 25, rule: 'hp_below_50' });
    expect(bagCount(s, T1)).toBe(5);
  });

  it('a stack that is used up leaves the bag, freeing its place', () => {
    const start = belted(withBag(builtGame(1, T0), [[T1, 10]]));
    const s = apply(start, { type: 'BELT_PUT', itemId: T1, slot: 2 }, T0);
    expect(beltOf(s)[2]).toEqual({ defId: T1, count: 10, rule: 'hp_below_50' });
    expect(s.inventory.items.length).toBe(start.inventory.items.length - 1);
    expect(s.inventory.items.some((i) => i.defId === T1)).toBe(false);
  });

  it('tops a filled slot up to 25 and keeps its rule; a full slot is refused', () => {
    const s = belted(withBag(builtGame(1, T0), [[T1, 10]]), [slotOf(T1, 20, 'always')]);
    const r = apply(s, { type: 'BELT_PUT', itemId: T1, slot: 0 }, T0);
    expect(beltOf(r)[0]).toEqual({ defId: T1, count: 25, rule: 'always' });
    expect(bagCount(r, T1)).toBe(5);
    expect(code(r, { type: 'BELT_PUT', itemId: T1, slot: 0 })).toBe('BELT_SLOT_FULL');
  });

  it('one potion type per slot; the same type may sit in two slots', () => {
    const s = belted(withBag(builtGame(1, T0), [[T1, 5], [GREATER, 5]]), [slotOf(T1, 3)]);
    expect(code(s, { type: 'BELT_PUT', itemId: GREATER, slot: 0 })).toBe('BELT_SLOT_TAKEN');
    const two = apply(s, { type: 'BELT_PUT', itemId: T1, slot: 1 }, T0);
    expect(beltOf(two).map((x) => x?.defId ?? null)).toEqual([T1, T1, null, null]);
  });

  it('refusals change nothing: not worn, unknown slot, not in the bag, not a potion', () => {
    const bag = withBag(builtGame(1, T0), [[T1, 5]]);
    expect(code(beltInBag(bag), { type: 'BELT_PUT', itemId: T1, slot: 0 })).toBe('BELT_NOT_EQUIPPED');
    expect(code(builtGame(1, T0), { type: 'BELT_PUT', itemId: T1, slot: 0 })).toBe('BELT_NOT_EQUIPPED');
    const s = belted(bag);
    for (const slot of [-1, 4, 1.5, NaN]) expect(code(s, { type: 'BELT_PUT', itemId: T1, slot })).toBe('UNKNOWN_SLOT');
    expect(code(s, { type: 'BELT_PUT', itemId: 'nope', slot: 0 })).toBe('NOT_IN_INVENTORY');
    const sage = { ...s, inventory: { ...s.inventory, items: [...s.inventory.items, makeItem('wild_sage', 3)] } };
    expect(code(sage, { type: 'BELT_PUT', itemId: 'wild_sage', slot: 0 })).toBe('NOT_A_POTION');
  });
});

describe('BELT_TAKE and BELT_SET_RULE', () => {
  it('take returns everything to the bag stack; the slot is empty', () => {
    const s = belted(withBag(builtGame(1, T0), [[T1, 3]]), [slotOf(T1, 7, 'always')]);
    const r = apply(s, { type: 'BELT_TAKE', slot: 0 }, T0);
    expect(bagCount(r, T1)).toBe(10);
    expect(beltOf(r)[0]).toBeNull();
  });

  it('take with no stack in the bag needs a free place, else it is refused and nothing moves', () => {
    const s = belted(builtGame(1, T0), [slotOf(T1, 7)]);
    const r = apply(s, { type: 'BELT_TAKE', slot: 0 }, T0);
    expect(r.inventory.items.find((i) => i.defId === T1)).toMatchObject({ quantity: 7 });
    const full = { ...s, inventory: { ...s.inventory, capacity: s.inventory.items.length } };
    const refused = applyCommand(full, cmd({ type: 'BELT_TAKE', slot: 0 }), T0);
    expect(refused).toMatchObject({ ok: false, error: { code: 'INVENTORY_FULL' } });
    // ... but a stack already in the bag always has room
    const stacked = withBag(full, [[T1, 1]]);
    const ok = apply({ ...stacked, inventory: { ...stacked.inventory, capacity: stacked.inventory.items.length } }, { type: 'BELT_TAKE', slot: 0 }, T0);
    expect(bagCount(ok, T1)).toBe(8);
  });

  it('refusals: empty slot, unknown slot, not worn', () => {
    const s = belted(builtGame(1, T0), [slotOf(T1, 7)]);
    expect(code(s, { type: 'BELT_TAKE', slot: 1 })).toBe('SLOT_EMPTY');
    expect(code(s, { type: 'BELT_TAKE', slot: 9 })).toBe('UNKNOWN_SLOT');
    expect(code(beltInBag(builtGame(1, T0), [slotOf(T1, 7)]), { type: 'BELT_TAKE', slot: 0 })).toBe('BELT_NOT_EQUIPPED');
  });

  it('set rule: any of the three on a filled slot; an empty slot or an unknown rule is refused', () => {
    let s = belted(builtGame(1, T0), [slotOf(T1, 7)]);
    for (const rule of ['hp_below_25', 'always', 'hp_below_50'] as const) {
      s = apply(s, { type: 'BELT_SET_RULE', slot: 0, rule }, T0);
      expect(beltOf(s)[0]).toEqual({ defId: T1, count: 7, rule });
    }
    expect(code(s, { type: 'BELT_SET_RULE', slot: 1, rule: 'always' })).toBe('SLOT_EMPTY');
    expect(code(s, { type: 'BELT_SET_RULE', slot: 0, rule: 'sometimes' as BeltRule })).toBe('INVALID_RULE');
    expect(code(s, { type: 'BELT_SET_RULE', slot: 7, rule: 'always' })).toBe('UNKNOWN_SLOT');
  });
});

describe('manual USE_ITEM and the per-type cooldown', () => {
  it('a drink starts the type\'s cooldown (engine time); the same type is refused until it ends, other types are not', () => {
    const s = withHp(withBag(big(), [[T1, 5], [GREATER, 5]]), 100);
    const a = apply(s, { type: 'USE_ITEM', itemId: T1 }, T0);
    expect(a.character.hp).toBe(150);
    expect(a.potionCooldowns[T1]).toBe(T0 + 20_000);
    const early = applyCommand(a, cmd({ type: 'USE_ITEM', itemId: T1 }), T0 + 5 * SEC);
    expect(early).toMatchObject({ ok: false, error: { code: 'ON_COOLDOWN' } });
    expect(!early.ok && early.error.message).toMatch(/15 s/);
    expect(code(a, { type: 'USE_ITEM', itemId: GREATER }, T0 + 5 * SEC)).toBe('ok'); // another type
    expect(code(a, { type: 'USE_ITEM', itemId: T1 }, T0 + 20 * SEC - 1)).toBe('ON_COOLDOWN');
    expect(code(a, { type: 'USE_ITEM', itemId: T1 }, T0 + 20 * SEC)).toBe('ok');
  });

  it('a refused drink changes nothing (HP full is checked first)', () => {
    const s = withBag(big(), [[T1, 5]]);
    expect(code(s, { type: 'USE_ITEM', itemId: T1 })).toBe('HP_FULL');
  });
});

describe('drinking out of a fight (idle), live == offline', () => {
  const idle = (hp: number, slots: BeltSlot[], state = big()) => belted(withHp(state, hp), slots);

  it('the three rules at their exact edges', () => {
    const drank = (hp: number, rule: BeltRule) => countIn(simulate(idle(hp, [slotOf(T1, 5, rule)]), T0 + MS).state, 0) < 5;
    expect(drank(237, 'hp_below_50')).toBe(true);
    expect(drank(238, 'hp_below_50')).toBe(false);
    expect(drank(118, 'hp_below_25')).toBe(true);
    expect(drank(119, 'hp_below_25')).toBe(false);
    expect(drank(474, 'always')).toBe(true);
    expect(drank(475, 'always')).toBe(false); // never at full HP
  });

  it('a drink heals the potion\'s amount, capped at max HP (no banked regen at full), starts the cooldown at the engine time and is counted', () => {
    const r = simulate(idle(470, [slotOf(T1, 5, 'always')]), T0 + 1000);
    expect(r.state.character.hp).toBe(MAX);
    expect(r.state.character.hpRegenProgress).toBe(0);
    expect(countIn(r.state, 0)).toBe(4);
    expect(potionReadyAt(r.state, T1)).toBe(T0 + 20_000); // the pass runs at the start of the walk, at lastSimulatedAt
    expect(r.summary.potionsUsed).toEqual({ [T1]: 1 });
    const w = simulate(idle(1, [slotOf(T1, 5, 'always')]), T0 + 1000).state.character.hp;
    expect(w).toBeGreaterThanOrEqual(51);
    expect(w).toBeLessThan(55);
  });

  it('draws no RNG', () => {
    const s = idle(1, [slotOf(T1, 5, 'always')]);
    expect(simulate(s, T0 + 5 * 60 * SEC).state.rng).toEqual(s.rng);
  });

  it('a threshold rule waiting on its cooldown drinks at the exact engine time the cooldown ends', () => {
    const s = idle(1, [slotOf(T1, 25, 'hp_below_50')]);
    expect(countIn(simulate(s, T0 + 19_999).state, 0)).toBe(24);
    const at = simulate(s, T0 + 20_000).state;
    expect(countIn(at, 0)).toBe(23);
    expect(potionReadyAt(at, T1)).toBe(T0 + 40_000);
    // 1 -> 51 -> 101 -> 151 -> 201 -> 251+: five drinks (t = 0, 20, 40, 60, 80 s), then the rule is false
    const end = simulate(s, T0 + 200 * SEC).state;
    expect(countIn(end, 0)).toBe(20);
    expect(end.character.hp).toBeGreaterThan(237);
  });

  it('always drinks again every 20 s while HP is below max: t = 0, 20, 40, 60', () => {
    const s = idle(1, [slotOf(T1, 25, 'always')]);
    expect([19_999, 20_000, 39_999, 40_000, 60_000].map((ms) => 25 - countIn(simulate(s, T0 + ms).state, 0))).toEqual([1, 2, 2, 3, 4]);
  });

  it('slot order on a tie: slot 1 first, and its drink can make the later slots\' rules false', () => {
    const run = (slots: BeltSlot[], hp: number) => simulate(idle(hp, slots), T0 + MS).state;
    // hp 200 <= 237: the Greater (+60 = 260) first makes the T1 slot's rule (<= 237) false; the T1 first (+50 = 250) does the same
    let r = run([slotOf(GREATER), slotOf(T1)], 200);
    expect([countIn(r, 0), countIn(r, 1), r.character.hp]).toEqual([24, 25, 260]);
    r = run([slotOf(T1), slotOf(GREATER)], 200);
    expect([countIn(r, 0), countIn(r, 1), r.character.hp]).toEqual([24, 25, 250]);
    // hp 100: both are still eligible after the first: both drink at the same instant, slot 1 then slot 2
    r = run([slotOf(GREATER), slotOf(T1)], 100);
    expect([countIn(r, 0), countIn(r, 1), r.character.hp]).toEqual([24, 24, 210]);
  });

  it('the cooldown is per potion TYPE: two slots of one type drink one after the other; two types drink together', () => {
    const same = idle(1, [slotOf(T1, 3, 'always'), slotOf(T1, 3, 'always')]);
    let r = simulate(same, T0 + MS).state;
    expect([countIn(r, 0), countIn(r, 1)]).toEqual([2, 3]);
    r = simulate(same, T0 + 20 * SEC).state;
    expect([countIn(r, 0), countIn(r, 1)]).toEqual([1, 3]);
    r = simulate(same, T0 + 60 * SEC).state; // slot 1 empties at t = 40 s (its 3rd), slot 2 takes over at 60 s
    expect(beltOf(r)[0]).toBeNull();
    expect(countIn(r, 1)).toBe(2);
    const mixed = simulate(idle(1, [slotOf(T1, 3, 'always'), slotOf(GREATER, 3, 'always')]), T0 + MS).state;
    expect([countIn(mixed, 0), countIn(mixed, 1)]).toEqual([2, 2]);
    expect(potionReadyAt(mixed, GREATER)).toBe(T0 + 20_000);
  });

  it('the last potion empties the slot', () => {
    const r = simulate(idle(1, [slotOf(T1, 1, 'always')]), T0 + MS).state;
    expect(beltOf(r)[0]).toBeNull();
  });

  it('a manual drink\'s cooldown holds the belt back, and a belt drink blocks a manual one', () => {
    const s = idle(1, [slotOf(T1, 5, 'always')], withBag(big(), [[T1, 2]]));
    const manual = apply(s, { type: 'USE_ITEM', itemId: T1 }, T0);
    expect(countIn(simulate(manual, T0 + 19_999).state, 0)).toBe(5);
    expect(countIn(simulate(manual, T0 + 20_000).state, 0)).toBe(4);
    const belt = simulate(s, T0 + MS).state;
    expect(code(belt, { type: 'USE_ITEM', itemId: T1 }, T0 + 2 * SEC)).toBe('ON_COOLDOWN');
  });

  it('a belt in the bag drinks nothing, and a worn empty belt changes nothing', () => {
    const bagged = beltInBag(withHp(big(), 1), [slotOf(T1, 5, 'always')]);
    expect(simulate(bagged, T0 + 60 * SEC).summary.potionsUsed).toEqual({});
    const empty = simulate(belted(withHp(big(), 1)), T0 + 60 * SEC).state;
    const plain = simulate(withHp(big(), 1), T0 + 60 * SEC).state;
    expect(empty.character.hp).toBe(plain.character.hp);
    expect(empty.rng).toEqual(plain.rng);
  });

  it('the summary counts every drink by type; merged ticks add up', () => {
    const r = simulate(idle(1, [slotOf(T1, 25, 'always'), slotOf(GREATER, 25, 'always')]), T0 + 45 * SEC);
    expect(r.summary.potionsUsed).toEqual({ [T1]: 3, [GREATER]: 3 });
  });

  it('woodcutting, a dungeon search, training and idle: one simulate == any split == a tick every second', () => {
    const games: [string, GameState][] = [
      ['idle', idle(1, [slotOf(T1, 25, 'always')])],
      ['woodcutting', apply(idle(1, [slotOf(T1, 25, 'always')]), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0)],
      ['search', apply(idle(1, [slotOf(T1, 25, 'always'), slotOf(GREATER, 25, 'hp_below_50')]), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0)],
      ['training', apply(idle(1, [slotOf(T1, 25, 'always')]), { type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' }, T0)],
    ];
    for (const [name, s] of games) {
      const end = T0 + 3 * 60 * SEC;
      const once = simulate(s, end).state;
      for (const at of [1, 999, 19_999, 20_000, 20_001, 40_000, 61_234]) {
        expect(hashState(simulate(simulate(s, T0 + at).state, end).state), `${name} split at ${at}`).toBe(hashState(once));
      }
      let live = s;
      for (let t = 1; t <= 180; t++) live = simulate(live, T0 + t * SEC).state;
      expect(hashState(live), `${name} live`).toBe(hashState(once));
    }
  });
});

describe('drinking in a fight', () => {
  const enteredBoss = (slots: BeltSlot[]) => {
    const s = belted(withTrollBridgeWins(big()), slots);
    const e = applyCommand(s, cmd({ type: 'ENTER_BOSS', bossId: 'troll_chieftain', maxCost: 10 }), T0);
    if (!e.ok) throw new Error(e.error.message);
    return e.state;
  };
  const beltEntries = (log: readonly FightLogEntry[]) => log.filter((e) => e.actor === 'belt');

  it('"always" drinks right after the first hit, then every 20 s: at most 3 T1 drinks in a 60 s fight, logged with the potion and the heal', () => {
    const s = enteredBoss([slotOf(T1, 25, 'always')]);
    const r = simulate(s, T0 + 130 * SEC);
    const f = r.state.dungeon.lastFight!;
    const drinks = beltEntries(f.log);
    expect(drinks.length).toBeGreaterThanOrEqual(1);
    expect(drinks.length).toBeLessThanOrEqual(3);
    expect(drinks.map((d) => d.atMs)).toEqual([300, 20_300, 40_300].slice(0, drinks.length)); // the first monster hit lands at 300 ms
    for (const [i, d] of drinks.entries()) {
      expect(d).toMatchObject({ actor: 'belt', potion: T1, strike: i + 1, dealt: 0, roll: 0, crit: false });
      expect(d.heal).toBeGreaterThan(0);
      expect(d.heal).toBeLessThanOrEqual(50);
      expect(d.targetHpAfter).toBeLessThanOrEqual(MAX);
    }
    expect(drinks.length).toBe(Math.floor((f.durationMs - 300) / 20_000) + 1);
    // the log stays in time order
    for (let i = 1; i < f.log.length; i++) expect(f.log[i].atMs).toBeGreaterThanOrEqual(f.log[i - 1].atMs);
    // The summary counts every drink, in the fight and after it (the boss fight is over at ~35 s; the hero is idle and hurt, so "always" goes on).
    expect(r.summary.potionsUsed[T1]).toBeGreaterThan(drinks.length);
    expect(25 - countIn(r.state, 0)).toBe(r.summary.potionsUsed[T1]);
  });

  it('a fight that lasts the whole 60 s: drinks at 0, 20 and 40 s are in it; the one due at the very instant the time limit ends it happens right after, outside', () => {
    // A hero at 100 / 475 HP (rule always) against a mob that cannot kill him or be killed: the fight runs to the time limit.
    const s = belted(withHp(big(), 100), [slotOf(T1, 25, 'always')]);
    const hero = fightSide({ damage: { min: 1, max: 1 } });
    const fight = newPackFight('rat', hero, [{ side: fightSide({ damage: { min: 1, max: 1 } }), hp: 100_000 }], 475, 100);
    const inFight: GameState = { ...s, activity: { kind: 'dungeon', dungeonId: 'rat_cellar', difficulty: 'normal', phase: 'fight', fight, startedAt: T0, progressMs: 0 } };
    const r = simulate(inFight, T0 + 70 * SEC);
    const f = r.state.dungeon.lastFight!;
    expect(f.endReason).toBe('time_limit');
    expect(f.durationMs).toBe(60_000);
    expect(beltEntries(f.log).map((e) => e.atMs)).toEqual([0, 20_000, 40_000]); // at most 3 in a 60 s fight
    expect(r.summary.potionsUsed[T1]).toBe(4); // the 4th (t = 60 s) is outside the fight, still counted
    // Same for any split of the time, and live.
    for (const at of [1, 19_999, 20_000, 59_999, 60_000, 60_001]) {
      expect(hashState(simulate(simulate(inFight, T0 + at).state, T0 + 70 * SEC).state), `split at ${at}`).toBe(hashState(r.state));
    }
  });

  it('the live fight view shows the drinks as they land', () => {
    const s = enteredBoss([slotOf(T1, 25, 'always')]);
    const mid = simulate(s, T0 + 21 * SEC).state;
    const a = mid.activity;
    const log = a && a.kind === 'boss' ? a.fight.log : [];
    expect(beltEntries(log).map((e) => e.atMs)).toEqual([300, 20_300]);
  });

  it('a drink between two strikes of the same instant: a pack\'s strikes each get their own pass', () => {
    // Three mobs strike together at 300 ms for 130 each. 475 -> 345 -> 215 (<= 237): the belt drinks BEFORE the third strike.
    const s = belted(withHp(big(), 475), [slotOf(T1, 5, 'hp_below_50')]);
    const hero = fightSide({ damage: { min: 1, max: 1 } });
    const mob = () => ({ side: fightSide({ damage: { min: 130, max: 130 } }), hp: 100_000 });
    const fight = newPackFight('rat', hero, [mob(), mob(), mob()], 475, 475);
    const inFight: GameState = { ...s, activity: { kind: 'dungeon', dungeonId: 'rat_cellar', difficulty: 'normal', phase: 'fight', fight, startedAt: T0, progressMs: 0 } };
    const r = simulate(inFight, T0 + 300).state;
    const a = r.activity;
    const log = a && a.kind === 'dungeon' && a.fight ? a.fight.log : [];
    expect(log.filter((e) => e.atMs === 300).map((e) => (e.actor === 'enemy' ? `enemy${e.mob}` : e.actor))).toEqual(['enemy0', 'enemy1', 'belt', 'enemy2']);
    const hp = log.filter((e) => e.atMs === 300).map((e) => e.targetHpAfter);
    expect(hp).toEqual([345, 215, 265, 135]);
  });

  it('live == offline == any split, across the fight and its aftermath', () => {
    const s = enteredBoss([slotOf(T1, 25, 'always'), slotOf(GREATER, 25, 'hp_below_25')]);
    const end = T0 + 4 * 60 * SEC;
    const once = simulate(s, end).state;
    for (const at of [1, 299, 300, 301, 5000, 19_999, 20_000, 20_299, 20_300, 20_301, 35_000, 40_299, 40_300, 65_000, 100_000]) {
      expect(hashState(simulate(simulate(s, T0 + at).state, end).state), `split at ${at}`).toBe(hashState(once));
    }
    let live = s;
    for (let t = 1; t <= 240; t++) live = simulate(live, T0 + t * SEC).state;
    expect(hashState(live)).toBe(hashState(once));
  });

  it('the offline cap: a fight in progress when the cap falls is finished WITH the belt, exactly as live play plays it', () => {
    const s = enteredBoss([slotOf(T1, 25, 'always')]);
    const live = simulate(s, T0 + 130 * SEC).state.dungeon.lastFight!;
    expect(beltEntries(live.log).length).toBeGreaterThanOrEqual(2);
    for (const capMs of [1000, 10_000, 25_000]) {
      const capped = simulate({ ...s, offline: { ...s.offline, capMs } }, T0 + 130 * SEC).state.dungeon.lastFight!;
      expect(capped, `cap ${capMs}`).toEqual(live);
    }
  });

  it('a lost fight leaves 0 HP and the belt drinks afterwards, outside the fight (it counts in the summary, not in the log)', () => {
    // A level-1 hero (50 HP) in the Troll Bridge dies in a few strikes; the belt (rule always) keeps him drinking.
    const weak = belted(builtGame(1, T0), [slotOf(T1, 25, 'hp_below_25')]);
    const s = apply({ ...weak, dungeon: { ...weak.dungeon } }, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    expect(s.activity).toBeTruthy();
    const troll = { ...s, activity: { ...s.activity!, dungeonId: 'troll_bridge' } } as GameState;
    const end = simulate(troll, T0 + 5 * 60 * SEC);
    expect(end.state.dungeon.lastFight).toBeTruthy();
    const total = Object.values(end.summary.potionsUsed).reduce((n, x) => n + x, 0);
    expect(25 - countIn(end.state, 0)).toBe(total);
    expect(total).toBeGreaterThan(0);
  });
});

describe('the views', () => {
  it('beltView: slots, total, cooldown seconds, dimmed when every filled type is on cooldown (or nothing is inside)', () => {
    const none = beltView(builtGame(1, T0));
    expect(none).toMatchObject({ equipped: false, total: 0 });
    const s = belted(withHp(big(), 1), [slotOf(T1, 4, 'always'), slotOf(GREATER, 2)]);
    const v0 = beltView(s);
    expect(v0).toMatchObject({ equipped: true, total: 6, dimmed: false, maxPerSlot: 25 });
    expect(v0.slots[2]).toMatchObject({ defId: null, count: 0 });
    expect(v0.slots[1]).toMatchObject({ defId: GREATER, name: 'Greater Health Potion', ruleLabel: 'On 50% HP' });
    const r = simulate(s, T0 + MS).state; // both drank (hp 1 <= 237)
    const v1 = beltView(r);
    expect(v1.slots[0].cooldownLeftMs).toBe(19_999);
    expect(v1.dimmed).toBe(true);
    expect(beltView(simulate(s, T0 + 20_000).state).slots[0].cooldownLeftMs).toBeGreaterThan(0); // drank again at 20 s
    expect(beltView(belted(big())).dimmed).toBe(true); // nothing inside
  });

  it('bagPotions lists the potion stacks with their cooldown', () => {
    const s = withBag(builtGame(1, T0), [[T1, 5], [GREATER, 2]]);
    expect(bagPotions(s).map((p) => [p.defId, p.quantity, p.cooldownLeftMs])).toEqual(expect.arrayContaining([[T1, 5, 0], [GREATER, 2, 0]]));
  });
});

describe('the away summary', () => {
  it('potions the belt drank while away make a summary worth showing, counted by type', () => {
    const idle = belted(withHp(big(), 1), [slotOf(T1, 3, 'always')]);
    const r = simulate(idle, T0 + 60 * SEC);
    expect(r.summary.potionsUsed).toEqual({ [T1]: 3 }); // 0 s, 20 s, 40 s
    expect(r.summary.actions + r.summary.dungeon.runs).toBe(0); // no other progress: the potions alone count
    expect(isNoteworthy(r.summary, 0)).toBe(true);
    expect(isNoteworthy(simulate(belted(big(), [slotOf(T1, 3)]), T0 + 60 * SEC).summary, 0)).toBe(false); // full HP: nothing drunk
  });
});
