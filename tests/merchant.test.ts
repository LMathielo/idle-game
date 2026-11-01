// Merchant, item quality, equip / unequip / use (engine 1.7.0, save v8).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/client/clock';
import { META_ENGINE_VERSION } from '../src/client/LocalGameClient';
import { MemoryGameRepository } from '../src/client/memoryRepository';
import type { CommandInput, LogRow } from '../src/client/types';
import {
  applyCommand,
  CURRENT_SAVE_VERSION,
  ENGINE_VERSION,
  type GameState,
  getDerivedStats,
  getItemDef,
  type ItemDef,
  hashState,
  ITEMS,
  loadSave,
  maxBuyable,
  MERCHANT,
  migrateDoc,
  MIGRATIONS,
  merchantView,
  type MigratePayload,
  newGame,
  type ReplayEntry,
  replayLogReport,
  rollStock,
  simulate,
  STARTING_HERO,
  woodcuttingStrength,
} from '../src/engine';
import { apply, cmd, HOUR, makeClient, MIN, qty, SEC, T0, builtGame } from './helpers';

const FIXTURES = join(__dirname, 'fixtures');
/** Frozen v7 save + its action log, written by the 1.6.0 engine before the merchant (tests/fixtures). */
const V7_SAVE = JSON.parse(readFileSync(join(FIXTURES, 'save-v7.json'), 'utf8'));
const V7_LOG: LogRow[] = JSON.parse(readFileSync(join(FIXTURES, 'log-v7.json'), 'utf8'));

const CHARGE_MS = MERCHANT.chargeIntervalMs;

/** What the v7 → v8 migration writes (frozen literals): the 4 listings, then empty slots up to 20. */
const FROZEN_V8_STOCK = [
  { defId: 'health_potion_t1', quantity: 10, unitPrice: 12 },
  { defId: 'iron_axe', quantity: 1, unitPrice: 600 },
  { defId: 'iron_sword', quantity: 1, unitPrice: 500 },
  { defId: 'iron_helm', quantity: 1, unitPrice: 400 },
  ...Array.from({ length: 16 }, () => null),
];


function run(state: GameState, c: CommandInput, now = state.time.lastSimulatedAt) {
  return applyCommand(state, cmd(c), now);
}

function code(state: GameState, c: CommandInput, now?: number) {
  const r = run(state, c, now);
  return r.ok ? 'OK' : r.error.code;
}

const richHero = (gold = 5000) => {
  const s = builtGame(7, T0);
  s.character.gold = gold;
  return s;
};

/** Fills the inventory with junk stacks up to `free` free slots. */
function fill(state: GameState, free = 0): GameState {
  const s = structuredClone(state);
  let n = 0;
  while (s.inventory.items.length < s.inventory.capacity - free) {
    s.inventory.items.push({ id: `junk-${n}`, defId: `junk-${n}`, name: 'Junk', icon: '?' });
    n += 1;
  }
  return s;
}

const entries = (rows: LogRow[]): ReplayEntry[] =>
  rows.map((r) => ({ type: r.type, payload: r.payload, clientTime: r.clientTime, stateHash: r.stateHash, engineVersion: r.engineVersion }));

describe('catalog: quality and prices (config/items.ts)', () => {
  const junk = ['rat_skin', 'bat_wing', 'wolf_pelt', 'old_bone', 'troll_hide'];
  const logs = ['oak_logs', 'birch_logs', 'maple_logs', 'yew_logs', 'ironwood_logs'];

  it('every item has a quality, a description and a whole sellPrice ≥ 1', () => {
    for (const def of Object.values(ITEMS)) {
      expect(['junk', 'common', 'uncommon', 'rare', 'epic', 'legendary']).toContain(def.rarity);
      expect(def.description.length).toBeGreaterThan(0);
      expect(Number.isSafeInteger(def.sellPrice) && def.sellPrice >= 1).toBe(true);
    }
  });

  it('qualities match the brief', () => {
    for (const id of junk) expect(getItemDef(id)?.rarity).toBe('junk');
    for (const id of [...logs, 'rusty_gladius', 'linen_tunic', 'worn_sandals', 'wooden_axe', 'iron_axe', 'iron_sword', 'iron_helm', 'health_potion_t1']) {
      expect(getItemDef(id)?.rarity).toBe('common');
    }
    expect(getItemDef('bird_nest')?.rarity).toBe('uncommon');
  });

  it('sell prices match the brief; starting gear 1–5', () => {
    const sell = Object.fromEntries(Object.values(ITEMS).map((d) => [d.id, d.sellPrice]));
    expect(sell).toMatchObject({
      rat_skin: 2, bat_wing: 5, wolf_pelt: 12, old_bone: 25, troll_hide: 60,
      oak_logs: 1, birch_logs: 3, maple_logs: 8, yew_logs: 20, ironwood_logs: 50,
      bird_nest: 30, health_potion_t1: 5, iron_axe: 180, iron_sword: 150, iron_helm: 120, wooden_axe: 1,
    });
    for (const id of STARTING_HERO.equipment) expect(sell[id]).toBeGreaterThanOrEqual(1);
    for (const id of STARTING_HERO.equipment) expect(sell[id]).toBeLessThanOrEqual(5);
  });

  it('new items: stats and buy prices; every buyable sells for less than it costs (no buy→sell profit)', () => {
    expect(getItemDef('health_potion_t1')).toMatchObject({ stackable: true, heal: 50, buyPrice: 12 });
    expect(getItemDef('health_potion_t1')).not.toHaveProperty('slot');
    expect(getItemDef('iron_axe')).toMatchObject({ slot: 'axe', woodcuttingStrength: 64, buyPrice: 600, stackable: false });
    expect(getItemDef('iron_sword')).toMatchObject({ slot: 'weapon', damage: { min: 10, max: 14 }, buyPrice: 500, stackable: false });
    expect(getItemDef('iron_helm')).toMatchObject({ slot: 'helmet', armor: 6, buyPrice: 400, stackable: false });
    for (const def of Object.values(ITEMS) as ItemDef[]) if (def.buyPrice !== undefined) expect(def.sellPrice).toBeLessThan(def.buyPrice);
  });

  it('the stock pool only holds buyable catalog items', () => {
    for (const e of MERCHANT.pool) expect(getItemDef(e.defId)?.buyPrice).toBeGreaterThan(0);
    expect(getItemDef('__proto__')).toBeUndefined();
  });
});

describe('merchant stock and refresh charges', () => {
  it('a new hero: 5/5 charges and the starter stock (not rolled): 5 slots at Merchant Lv1, potions then the iron gear', () => {
    const s = builtGame(1, T0);
    expect(s.merchant.charges).toBe(5);
    expect(s.merchant.stock).toHaveLength(5);
    expect(s.merchant.stock).toEqual([
      { defId: 'health_potion_t1', quantity: 10, unitPrice: 12 },
      { defId: 'iron_axe', quantity: 1, unitPrice: 600, qualityBp: 2500, rarity: 'common' }, // 1.14.0: the starter stock is 25% / common
      { defId: 'iron_pickaxe', quantity: 1, unitPrice: 600, qualityBp: 2500, rarity: 'common' },
      { defId: 'iron_sword', quantity: 1, unitPrice: 500, qualityBp: 2500, rarity: 'common' },
      { defId: 'iron_helm', quantity: 1, unitPrice: 400, qualityBp: 2500, rarity: 'common' },
    ]);
    expect(rollStock({ seed: 1 }, 2).stock).toHaveLength(2);
  });

  it('REFRESH_MERCHANT spends 1 charge, rolls a new stock (seeded), starts the 2 h timer; errors at 0', () => {
    let s = richHero();
    s = apply(s, { type: 'BUY_ITEM', slot: 0, defId: 'health_potion_t1', quantity: 10, maxUnitPrice: 12 }, T0);
    s = apply(s, { type: 'BUY_ITEM', slot: 3, defId: 'iron_sword', quantity: 1, maxUnitPrice: 500 }, T0);
    expect(s.merchant.stock[0]).toBeNull();
    const before = s;
    s = apply(s, { type: 'REFRESH_MERCHANT' }, T0);
    expect(s.merchant.charges).toBe(4);
    const rolled = rollStock(before.rng, 5);
    expect(s.merchant.stock).toEqual(rolled.stock);
    expect(s.rng).toEqual(rolled.rng);
    expect(merchantView(s)).toMatchObject({ charges: 4, maxCharges: 5, full: false, nextInMs: 2 * HOUR });
    for (let i = 0; i < 4; i++) s = apply(s, { type: 'REFRESH_MERCHANT' }, T0);
    expect(s.merchant.charges).toBe(0);
    expect(code(s, { type: 'REFRESH_MERCHANT' }, T0)).toBe('NO_REFRESH_CHARGES');
  });

  it('+1 charge per 2 h, remainder kept, max 5 (extras lost, no banked time at max)', () => {
    let s = builtGame(1, T0);
    for (let i = 0; i < 5; i++) s = apply(s, { type: 'REFRESH_MERCHANT' }, T0);
    s = simulate(s, T0 + CHARGE_MS - 1).state;
    expect(s.merchant).toMatchObject({ charges: 0, chargeProgressMs: CHARGE_MS - 1 });
    s = simulate(s, T0 + CHARGE_MS + 30 * MIN).state;
    expect(s.merchant).toMatchObject({ charges: 1, chargeProgressMs: 30 * MIN });
    // Many small resumes = one big one.
    let small = s;
    for (let t = 1; t <= 90; t++) small = simulate(small, T0 + CHARGE_MS + 30 * MIN + t * MIN).state;
    const big = simulate(s, T0 + CHARGE_MS + 120 * MIN).state;
    expect(small.merchant).toEqual(big.merchant);
    expect(big.merchant).toMatchObject({ charges: 2, chargeProgressMs: 0 });
    const full = simulate(s, T0 + 40 * HOUR).state; // way past 5 charges' worth
    expect(full.merchant).toMatchObject({ charges: 5, chargeProgressMs: 0 });
  });

  it('not limited by the 8 h offline cap; the backward clock pauses regen', () => {
    let s = builtGame(1, T0);
    for (let i = 0; i < 5; i++) s = apply(s, { type: 'REFRESH_MERCHANT' }, T0);
    const long = simulate(s, T0 + 9 * HOUR);
    expect(long.summary.grantedMs).toBe(8 * HOUR);
    expect(long.state.merchant).toMatchObject({ charges: 4, chargeProgressMs: HOUR }); // 9 h → 4 charges + 1 h
    const ahead = simulate(s, T0 + 3 * HOUR).state; // 1 charge + 1 h
    const back = simulate(ahead, T0 + HOUR); // clock moved back 2 h
    expect(back.summary.anomalies[0]).toMatchObject({ kind: 'backward' });
    expect(back.state.merchant).toEqual(ahead.merchant);
    // Real time has to pass the highest time seen before regen resumes.
    expect(simulate(back.state, T0 + 3 * HOUR - SEC).state.merchant).toEqual(ahead.merchant);
    expect(simulate(back.state, T0 + 4 * HOUR).state.merchant).toMatchObject({ charges: 2, chargeProgressMs: 0 });
  });
});

describe('BUY_ITEM', () => {
  const potions = (quantity: number, maxUnitPrice = 12) => ({ type: 'BUY_ITEM', slot: 0, defId: 'health_potion_t1', quantity, maxUnitPrice }) as const;

  it('buys 3 potions for 36 g; the slot shows 7 left; stacks merge', () => {
    let s = richHero(100);
    s = apply(s, potions(3), T0);
    expect(s.character.gold).toBe(64);
    expect(qty(s, 'health_potion_t1')).toBe(3);
    expect(s.merchant.stock[0]).toEqual({ defId: 'health_potion_t1', quantity: 7, unitPrice: 12 });
    s = apply(s, potions(2), T0);
    expect(qty(s, 'health_potion_t1')).toBe(5);
    expect(s.inventory.items.filter((i) => i.defId === 'health_potion_t1')).toHaveLength(1);
  });

  it('quantity is 1..remaining; bought-out slot empties until the next refresh', () => {
    let s = richHero();
    expect(code(s, potions(0))).toBe('INVALID_AMOUNT');
    expect(code(s, potions(11))).toBe('INVALID_AMOUNT');
    expect(code(s, potions(1.5))).toBe('INVALID_AMOUNT');
    s = apply(s, potions(10), T0);
    expect(s.merchant.stock[0]).toBeNull();
    expect(code(s, potions(1))).toBe('SLOT_EMPTY');
    expect(code(s, { type: 'BUY_ITEM', slot: 99, defId: 'x', quantity: 1, maxUnitPrice: 1 })).toBe('UNKNOWN_SLOT');
    expect(code(s, { type: 'BUY_ITEM', slot: 7, defId: 'x', quantity: 1, maxUnitPrice: 1 })).toBe('UNKNOWN_SLOT'); // 5 slots at Merchant Lv1
  });

  it('gold never goes negative: NOT_ENOUGH_GOLD and nothing changes', () => {
    const s = richHero(35);
    expect(code(s, potions(3))).toBe('NOT_ENOUGH_GOLD');
    expect(code(s, { type: 'BUY_ITEM', slot: 1, defId: 'iron_axe', quantity: 1, maxUnitPrice: 600 })).toBe('NOT_ENOUGH_GOLD');
    expect(apply(s, potions(2), T0).character.gold).toBe(11);
    expect(maxBuyable(s, 0)).toBe(2);
  });

  it('inventory capacity: a new stack or a unique item needs a free slot; an existing stack merges when full', () => {
    const full = fill(richHero());
    expect(code(full, potions(1))).toBe('INVENTORY_FULL');
    expect(code(full, { type: 'BUY_ITEM', slot: 3, defId: 'iron_sword', quantity: 1, maxUnitPrice: 500 })).toBe('INVENTORY_FULL');
    expect(maxBuyable(full, 0)).toBe(0);
    const withStack = fill(apply(richHero(), potions(1), T0));
    expect(withStack.inventory.items.length).toBe(withStack.inventory.capacity);
    expect(qty(apply(withStack, potions(4), T0), 'health_potion_t1')).toBe(5);
    expect(maxBuyable(withStack, 0)).toBe(9);
  });

  it('PRICE_CHANGED when the price is above the one shown; STOCK_CHANGED when the slot holds another item', () => {
    const s = richHero();
    expect(code(s, potions(1, 11))).toBe('PRICE_CHANGED');
    expect(code(s, { type: 'BUY_ITEM', slot: 0, defId: 'iron_axe', quantity: 1, maxUnitPrice: 600 })).toBe('STOCK_CHANGED');
  });

  it('unique items get their own instance ids from a serial that only goes up', () => {
    let s = richHero();
    s = apply(s, { type: 'BUY_ITEM', slot: 1, defId: 'iron_axe', quantity: 1, maxUnitPrice: 600 }, T0);
    s = apply(s, { type: 'BUY_ITEM', slot: 3, defId: 'iron_sword', quantity: 1, maxUnitPrice: 500 }, T0);
    expect(s.inventory.items.map((i) => i.id)).toEqual(['bread', 'iron_axe#1', 'iron_sword#2']);
    expect(s.nextItemSerial).toBe(3);
    expect(s.character.gold).toBe(5000 - 1100);
  });
});

describe('SELL_ITEM', () => {
  it('sells 10 Oak Logs for 10 g; quantity 1..owned; the stack goes when sold out', () => {
    let s = builtGame(1, T0);
    s.inventory.items.push({ id: 'oak_logs', defId: 'oak_logs', name: 'Oak Logs', icon: '🪵', stackable: true, quantity: 12 });
    const gold = s.character.gold;
    expect(code(s, { type: 'SELL_ITEM', itemId: 'oak_logs', quantity: 13 })).toBe('INVALID_AMOUNT');
    expect(code(s, { type: 'SELL_ITEM', itemId: 'oak_logs', quantity: 0 })).toBe('INVALID_AMOUNT');
    s = apply(s, { type: 'SELL_ITEM', itemId: 'oak_logs', quantity: 10 }, T0);
    expect(s.character.gold).toBe(gold + 10);
    expect(qty(s, 'oak_logs')).toBe(2);
    s = apply(s, { type: 'SELL_ITEM', itemId: 'oak_logs', quantity: 2 }, T0);
    expect(s.inventory.items.some((i) => i.id === 'oak_logs')).toBe(false);
    expect(code(s, { type: 'SELL_ITEM', itemId: 'oak_logs', quantity: 1 })).toBe('NOT_IN_INVENTORY');
  });

  it('equipped items are refused until unequipped; then they sell at their sellPrice', () => {
    let s = builtGame(1, T0);
    expect(code(s, { type: 'SELL_ITEM', itemId: 'start-rusty_gladius', quantity: 1 })).toBe('ITEM_EQUIPPED');
    s = apply(s, { type: 'UNEQUIP_ITEM', slot: 'weapon' }, T0);
    expect(code(s, { type: 'SELL_ITEM', itemId: 'start-rusty_gladius', quantity: 2 })).toBe('INVALID_AMOUNT');
    const sold = apply(s, { type: 'SELL_ITEM', itemId: 'start-rusty_gladius', quantity: 1 }, T0);
    expect(sold.character.gold).toBe(s.character.gold + ITEMS.rusty_gladius.sellPrice);
  });

  it('an item the catalog does not know cannot be sold', () => {
    const s = fill(builtGame(1, T0), 18);
    expect(code(s, { type: 'SELL_ITEM', itemId: 'junk-0', quantity: 1 })).toBe('NOT_SELLABLE');
  });
});

describe('EQUIP_ITEM / UNEQUIP_ITEM', () => {
  const bought = () => {
    let s = richHero();
    s = apply(s, { type: 'BUY_ITEM', slot: 1, defId: 'iron_axe', quantity: 1, maxUnitPrice: 600 }, T0);
    return apply(s, { type: 'BUY_ITEM', slot: 4, defId: 'iron_helm', quantity: 1, maxUnitPrice: 400 }, T0);
  };

  it('equipping the Iron Axe swaps the Wooden Axe back into its inventory place; WS +39 (40 − 1)', () => {
    const s = bought();
    const ws = woodcuttingStrength(s).value;
    const e = apply(s, { type: 'EQUIP_ITEM', itemId: 'iron_axe#1' }, T0);
    expect(e.character.equipment.axe?.id).toBe('iron_axe#1');
    expect(e.inventory.items.map((i) => i.id)).toEqual(['bread', 'start-wooden_axe', 'iron_helm#2']);
    expect(woodcuttingStrength(e).value).toBe(ws + 39);
    expect(woodcuttingStrength(e).breakdown.axe).toBe(40);
  });

  it('equipping into an empty slot; derived armor follows', () => {
    const s = bought();
    const e = apply(s, { type: 'EQUIP_ITEM', itemId: 'iron_helm#2' }, T0);
    expect(e.character.equipment.helmet?.id).toBe('iron_helm#2');
    expect(e.inventory.items).toHaveLength(s.inventory.items.length - 1);
    expect(getDerivedStats(e).defense.value).toBe(getDerivedStats(s).defense.value + 4);
  });

  it('a swap works with a full inventory and never loses or duplicates an item', () => {
    const s = fill(bought());
    const count = (x: GameState) => x.inventory.items.length + Object.keys(x.character.equipment).length;
    const e = apply(s, { type: 'EQUIP_ITEM', itemId: 'iron_axe#1' }, T0);
    expect(count(e)).toBe(count(s));
    const ids = [...e.inventory.items.map((i) => i.id), ...Object.values(e.character.equipment).map((i) => i!.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('start-wooden_axe');
    // Unequip needs a free slot: refused, nothing changes.
    expect(code(e, { type: 'UNEQUIP_ITEM', slot: 'axe' })).toBe('INVENTORY_FULL');
  });

  it('errors: not equippable, not in inventory, unknown or empty slot', () => {
    let s = bought();
    expect(code(s, { type: 'EQUIP_ITEM', itemId: 'bread' })).toBe('NOT_EQUIPPABLE');
    expect(code(s, { type: 'EQUIP_ITEM', itemId: 'nope' })).toBe('NOT_IN_INVENTORY');
    expect(code(s, { type: 'EQUIP_ITEM', itemId: 'start-rusty_gladius' })).toBe('NOT_IN_INVENTORY'); // already equipped
    expect(code(s, { type: 'UNEQUIP_ITEM', slot: 'helmet' })).toBe('SLOT_EMPTY');
    expect(code(s, { type: 'UNEQUIP_ITEM', slot: 'tail' as never })).toBe('UNKNOWN_SLOT');
    s = apply(s, { type: 'UNEQUIP_ITEM', slot: 'weapon' }, T0);
    expect(s.character.equipment.weapon).toBeUndefined();
    expect(s.inventory.items.at(-1)?.id).toBe('start-rusty_gladius');
    expect(getDerivedStats(s).damage).toMatchObject({ min: 11, max: 12 }); // unarmed 1–2 + STR 10
  });
});

describe('woodcutting stops when an equipment change drops WS below the tree requirement', () => {
  /** Birch needs WC 5 and 100 WS. WC 5 + STR 10 + Iron Axe 40 = exactly 100. */
  const birchWithIronAxe = () => {
    let s = richHero();
    s.character.skills.woodcutting = { ...s.character.skills.woodcutting, level: 5 };
    s = apply(s, { type: 'BUY_ITEM', slot: 1, defId: 'iron_axe', quantity: 1, maxUnitPrice: 600 }, T0);
    s = apply(s, { type: 'EQUIP_ITEM', itemId: 'iron_axe#1' }, T0);
    expect(woodcuttingStrength(s).value).toBe(100);
    return apply(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'birch' }, T0);
  };
  const birchMs = 290 * SEC; // 5:00 − 10 s (DEX 10)

  it('unequipping the axe stops it with ACTIVITY_STOPPED, after banking the logs already cut', () => {
    const s = birchWithIronAxe();
    const at = T0 + 2 * birchMs + MIN;
    const r = applyCommand(s, cmd({ type: 'UNEQUIP_ITEM', slot: 'axe' }), at);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.activity).toBeNull();
    expect(r.events).toContainEqual({ type: 'ACTIVITY_STOPPED', kind: 'woodcutting' });
    expect(qty(r.state, 'birch_logs')).toBe(2);
    expect(r.state.inventory.items.some((i) => i.id === 'iron_axe#1')).toBe(true);
  });

  it('swapping to a weaker axe stops it too', () => {
    const s = birchWithIronAxe();
    const r = applyCommand(s, cmd({ type: 'EQUIP_ITEM', itemId: 'start-wooden_axe' }), T0 + MIN);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.character.equipment.axe?.id).toBe('start-wooden_axe');
    expect(r.state.activity).toBeNull();
    expect(r.events).toContainEqual({ type: 'ACTIVITY_STOPPED', kind: 'woodcutting' });
  });

  it('staying at or above the requirement keeps it running, progress kept', () => {
    // WC 9 + STR 10 + Wooden Axe 1 = 101; without the axe 100, still enough for Birch.
    let s = builtGame(1, T0);
    s.character.skills.woodcutting = { ...s.character.skills.woodcutting, level: 9 };
    s = apply(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'birch' }, T0);
    const r = applyCommand(s, cmd({ type: 'UNEQUIP_ITEM', slot: 'axe' }), T0 + MIN);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.activity).toMatchObject({ kind: 'woodcutting', treeId: 'birch', progressMs: MIN });
    expect(r.events.some((e) => e.type === 'ACTIVITY_STOPPED')).toBe(false);
    // Other activities are never stopped by an equipment change.
    const d = apply(builtGame(1, T0), { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0);
    expect(apply(d, { type: 'UNEQUIP_ITEM', slot: 'axe' }, T0 + MIN).activity?.kind).toBe('dungeon');
  });
});

describe('USE_ITEM', () => {
  const withPotions = (hp: number, n = 2) => {
    let s = richHero();
    s = apply(s, { type: 'BUY_ITEM', slot: 0, defId: 'health_potion_t1', quantity: n, maxUnitPrice: 12 }, T0);
    s.character.hp = hp;
    s.character.hpRegenProgress = 1234;
    return s;
  };

  it('heals +50 and consumes 1', () => {
    const s = apply(withPotions(0), { type: 'USE_ITEM', itemId: 'health_potion_t1' }, T0);
    expect(s.character.hp).toBe(50); // max 50 at Lv1
    expect(s.character.hpRegenProgress).toBe(0); // full: nothing banked
    expect(qty(s, 'health_potion_t1')).toBe(1);
  });

  it('caps at max HP, keeps the regen remainder below max, removes the last one', () => {
    const s = withPotions(30, 1);
    s.character.level = 5; // max 90
    const used = apply(s, { type: 'USE_ITEM', itemId: 'health_potion_t1' }, T0);
    expect(used.character).toMatchObject({ hp: 80, hpRegenProgress: 1234 });
    expect(used.inventory.items.some((i) => i.defId === 'health_potion_t1')).toBe(false);
    const capped = withPotions(45);
    expect(apply(capped, { type: 'USE_ITEM', itemId: 'health_potion_t1' }, T0).character.hp).toBe(50);
  });

  it('HP_FULL at max HP; NOT_USABLE for anything else; NOT_IN_INVENTORY', () => {
    const s = withPotions(50);
    expect(code(s, { type: 'USE_ITEM', itemId: 'health_potion_t1' })).toBe('HP_FULL');
    expect(code(withPotions(1), { type: 'USE_ITEM', itemId: 'bread' })).toBe('NOT_USABLE');
    expect(code(builtGame(1, T0), { type: 'USE_ITEM', itemId: 'health_potion_t1' })).toBe('NOT_IN_INVENTORY');
  });
});

describe('the merchant is not an activity', () => {
  it('buy, sell, equip, use and refresh while woodcutting, training or in a dungeon run; the activity keeps its progress', () => {
    const base = richHero();
    base.training.tier = 1;
    const starts: CommandInput[] = [
      { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' },
      { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' },
      { type: 'START_ACTIVITY', kind: 'training', attribute: 'strength' },
    ];
    for (const start of starts) {
      let s = apply(base, start, T0);
      s = simulate(s, T0 + MIN).state;
      const activity = s.activity;
      s = apply(s, { type: 'BUY_ITEM', slot: 0, defId: 'health_potion_t1', quantity: 2, maxUnitPrice: 12 }, T0 + MIN);
      s = apply(s, { type: 'BUY_ITEM', slot: 3, defId: 'iron_sword', quantity: 1, maxUnitPrice: 500 }, T0 + MIN);
      s = apply(s, { type: 'EQUIP_ITEM', itemId: 'iron_sword#1' }, T0 + MIN);
      s = apply(s, { type: 'SELL_ITEM', itemId: 'start-rusty_gladius', quantity: 1 }, T0 + MIN);
      s = apply(s, { type: 'REFRESH_MERCHANT' }, T0 + MIN);
      s.character.hp = 10;
      s = apply(s, { type: 'USE_ITEM', itemId: 'health_potion_t1' }, T0 + MIN);
      expect(s.activity).toEqual(activity);
    }
  });
});

describe('debug: +1 merchant refresh', () => {
  it('adds a charge, sets debugUsed, refuses at max', () => {
    let s = builtGame(1, T0);
    expect(code(s, { type: 'DEBUG_ADD_MERCHANT_CHARGE' })).toBe('CHARGES_FULL');
    s = apply(s, { type: 'REFRESH_MERCHANT' }, T0);
    s = simulate(s, T0 + HOUR).state;
    s = apply(s, { type: 'DEBUG_ADD_MERCHANT_CHARGE' }, T0 + HOUR);
    expect(s.merchant).toMatchObject({ charges: 5, chargeProgressMs: 0 });
    expect(s.flags.debugUsed).toBe(true);
    expect(applyCommand(s, cmd({ type: 'DEBUG_ADD_MERCHANT_CHARGE' }), T0 + HOUR, { allowDebug: false })).toMatchObject({ ok: false, error: { code: 'DEBUG_DISABLED' } });
  });

  it('merchant and debug rows replay to the same hashes', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'mr' });
    await client.load();
    await client.debug.addGold(2000);
    await client.dispatch({ type: 'BUY_ITEM', slot: 0, defId: 'health_potion_t1', quantity: 3, maxUnitPrice: 12 });
    await client.dispatch({ type: 'BUY_ITEM', slot: 1, defId: 'iron_axe', quantity: 1, maxUnitPrice: 600 });
    await client.dispatch({ type: 'EQUIP_ITEM', itemId: 'iron_axe#1' });
    await client.dispatch({ type: 'SELL_ITEM', itemId: 'start-wooden_axe', quantity: 1 });
    await client.dispatch({ type: 'REFRESH_MERCHANT' });
    clock.advance(30 * MIN);
    await client.debug.setHeroHp(5);
    await client.dispatch({ type: 'USE_ITEM', itemId: 'health_potion_t1' });
    await client.debug.addMerchantCharge();
    await client.dispatch({ type: 'UNEQUIP_ITEM', slot: 'helmet' }); // refused: not logged
    expect(client.getState().merchant.charges).toBe(5);
    const rows = await repo.getAllLog();
    expect(rows.map((r) => r.type)).toEqual(expect.arrayContaining(['BUY_ITEM', 'EQUIP_ITEM', 'SELL_ITEM', 'REFRESH_MERCHANT', 'USE_ITEM', 'DEBUG_ADD_MERCHANT_CHARGE']));
    const report = replayLogReport(entries(rows));
    expect(hashState(report.state)).toBe(hashState(client.getState()));
  });
});

describe('frozen v7 save (tests/fixtures/save-v7.json) → v8', () => {
  async function v7Phone() {
    const repo = new MemoryGameRepository();
    await repo.init();
    await repo.commit(
      V7_LOG.map(({ seq: _seq, synced: _synced, ...r }) => r),
      V7_SAVE as GameState,
      { [META_ENGINE_VERSION]: '1.6.0', device_id: 'phone' },
    );
    const clock = new FakeClock(V7_SAVE.time.lastSimulatedAt + 3 * MIN);
    return makeClient({ repo, clock, prefix: 'v8' });
  }

  it('is what the 1.6.0 engine wrote: Oak mid-log, 1120 gold, 123 Oak Logs, 12 Rat Skins, no merchant', () => {
    expect(V7_SAVE.saveVersion).toBe(7);
    expect(V7_SAVE.activity).toMatchObject({ kind: 'woodcutting', treeId: 'oak', progressMs: 70000 });
    expect(V7_SAVE.character.gold).toBe(1120);
    expect(V7_SAVE).not.toHaveProperty('merchant');
    expect(V7_SAVE.character.equipment.axe).toHaveProperty('rarity', 'common');
    expect(new Set(V7_LOG.map((r) => r.engineVersion))).toEqual(new Set(['1.6.0']));
  });

  it('migrates: 5/5 charges, fresh first 4 slots, everything else kept (minus the instance rarity); pure', () => {
    const frozen = JSON.parse(JSON.stringify(V7_SAVE));
    const s = migrateDoc(V7_SAVE, MIGRATIONS, 8) as unknown as GameState; // the v7 → v8 step only (v9 has its own test)
    expect(V7_SAVE).toEqual(frozen);
    expect(s.saveVersion).toBe(8);
    expect(s.merchant).toEqual({ charges: 5, chargeProgressMs: 0, stock: FROZEN_V8_STOCK });
    expect(s.nextItemSerial).toBe(1);
    expect(s.activity).toEqual(V7_SAVE.activity);
    expect(qty(s, 'oak_logs')).toBe(123);
    expect(qty(s, 'rat_skin')).toBe(12);
    expect(s.character.gold).toBe(1120);
    const strip = ({ rarity: _r, ...i }: Record<string, unknown>) => i;
    expect(s.inventory.items).toEqual(V7_SAVE.inventory.items.map(strip));
    expect(JSON.stringify(s)).not.toContain('rarity');
    const { merchant: _m, nextItemSerial: _n, saveVersion: _v, character, inventory: _i, ...rest } = s;
    const { saveVersion: _rv, character: rawCharacter, inventory: _ri, ...rawRest } = V7_SAVE;
    expect(rest).toEqual(rawRest);
    expect({ ...character, equipment: undefined }).toEqual({ ...rawCharacter, equipment: undefined });
    expect(hashState(migrateDoc(V7_SAVE, MIGRATIONS, 8) as unknown as GameState)).toBe(hashState(s));
    expect(loadSave(V7_SAVE).saveVersion).toBe(CURRENT_SAVE_VERSION); // and on through v9
  });

  it('loading writes a MIGRATE anchor (save 7 → 8, engine 1.6.0 → 1.7.0), trades work, and the whole log replays', async () => {
    const { repo, clock, client } = await v7Phone();
    await client.load();
    const m = (await repo.getAllLog()).filter((r) => r.type === 'MIGRATE');
    expect(m).toHaveLength(1);
    const p = m[0].payload as MigratePayload;
    expect({ ...p, snapshot: undefined }).toEqual({
      fromSave: 7,
      toSave: CURRENT_SAVE_VERSION,
      fromEngine: '1.6.0',
      toEngine: ENGINE_VERSION,
      fromHash: V7_LOG.at(-1)!.stateHash,
      snapshot: undefined,
    });
    expect(p.snapshot).toEqual(loadSave(V7_SAVE));
    expect((await client.dispatch({ type: 'SELL_ITEM', itemId: 'rat_skin', quantity: 12 })).ok).toBe(true);
    expect((await client.dispatch({ type: 'BUY_ITEM', slot: 1, defId: 'iron_axe', quantity: 1, maxUnitPrice: 600 })).ok).toBe(true);
    expect((await client.dispatch({ type: 'EQUIP_ITEM', itemId: 'iron_axe#1' })).ok).toBe(true);
    clock.advance(HOUR);
    await client.resume();
    const report = replayLogReport(entries(await repo.getAllLog()));
    expect(report).toMatchObject({ anchors: 1, skippedOldEngine: V7_LOG.length });
    expect(hashState(report.state)).toBe(hashState(client.getState()));
  });
});
