// Crafting house (engine 1.13.0): pipes, material recipes, craft time (house × INT, diminishing), x10 mode, insta,
// cancel refunds, the yield fraction ledger, inventory-full holds, and the time rules (split invariance, cap, clock).
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  BUILDINGS,
  type Command,
  CRAFTING,
  craftingView,
  craftJobView,
  craftMsFor,
  diminishingBp,
  type GameState,
  hashState,
  intCraftReductionBp,
  newGame,
  RECIPE_IDS,
  RECIPES,
  replayLogReport,
  sellPriceOf,
  simulate,
  STAT_EFFECTS,
  x10StaminaPerCraft,
} from '../src/engine';
import { cloneState } from '../src/engine/clone';
import { getItemDef } from '../src/engine/config/items';
import { addStackable } from '../src/engine/inventory';
import { apply, builtGame, cmd, debugBuild, HOUR, makeClient, MIN, qty, SEC, T0 } from './helpers';

type Input = Parameters<typeof cmd>[0];

/** A built game (every building) with these stacks added. */
function game(items: Record<string, number> = { oak_logs: 1000, stone: 1000 }, seed = 7): GameState {
  const s = cloneState(builtGame(seed, T0));
  for (const [id, n] of Object.entries(items)) addStackable(s.inventory, id, n);
  return s;
}

function run(s: GameState, c: Input, at = T0) {
  return applyCommand(s, cmd(c), at);
}

function expectError(s: GameState, c: Input, code: string, at = T0) {
  const r = run(s, c, at);
  expect(r.ok ? 'ok' : r.error.code).toBe(code);
}

const start = (pipe: number, recipeId: string, quantity: number, mode: 'x1' | 'x10' = 'x1', maxCost = 1000): Input => ({ type: 'START_CRAFT', pipe, recipeId, quantity, mode, maxCost });

function withLevel(s: GameState, level: number): GameState {
  return { ...s, buildings: { ...s.buildings, town_hall: { state: 'built', level: 5 }, crafting: { state: 'built', level } } };
}

describe('data (owner-approved 2026-11-01)', () => {
  it('ten material recipes: inputs and time double every tier, one common output whose sell price = the inputs', () => {
    const materials = RECIPE_IDS.filter((id) => RECIPES[id].kind === 'material');
    expect(materials).toHaveLength(10);
    expect(RECIPE_IDS).toHaveLength(40); // + 30 gear recipes (1.14.0, tests/gearCrafting.test.ts)
    for (const id of materials) {
      const r = RECIPES[id];
      const scale = [1, 2, 4, 8, 16][r.tier - 1];
      expect(r.inputs).toEqual([{ defId: r.inputs[0].defId, quantity: 2 * scale }]);
      expect(r.baseMs).toBe(5000 * scale);
      expect(r.output.quantity).toBe(1);
      const out = getItemDef(r.output.defId)!;
      expect(out).toMatchObject({ rarity: 'common', stackable: true, name: r.name });
      expect(out.sellPrice).toBe(r.inputs[0].quantity * getItemDef(r.inputs[0].defId)!.sellPrice);
    }
    expect(materials.map((id) => [RECIPES[id].name, getItemDef(RECIPES[id].output.defId)!.sellPrice])).toEqual([
      ['Oak Plank', 2],
      ['Stone Brick', 2],
      ['Birch Plank', 12],
      ['Copper Ingot', 12],
      ['Maple Plank', 64],
      ['Iron Ingot', 64],
      ['Yew Plank', 320],
      ['Silver Ingot', 320],
      ['Ironwood Plank', 1600],
      ['Gold Ingot', 1600],
    ]);
  });

  it('house bonuses per level: time 100 / 90 / 81 / 72.9 / 65.61 %, +10 / +20 % yield at Lv4 / Lv5', () => {
    expect(BUILDINGS.crafting.levels).toEqual([
      { craftTimeBp: 10_000 },
      { craftTimeBp: 9_000 },
      { craftTimeBp: 8_100 },
      { craftTimeBp: 7_290, craftYieldBp: 1_000 },
      { craftTimeBp: 6_561, craftYieldBp: 2_000 },
    ]);
    expect(BUILDINGS.crafting.cappedByTownHall).toBe(true);
    expect(newGame(1, T0).buildings.crafting).toEqual({ state: 'locked', level: 0 });
    expect(newGame(1, T0).crafting.pipesUnlocked).toBe(2);
  });
});

describe('craft time', () => {
  it('diminishing helper: INT 10 → 833 bp, 50 → 2500, 100 → 3333, 210 → 4038; 0 at 0, never the cap', () => {
    const { capBp, k } = STAT_EFFECTS.intelligence.craftTime;
    expect([capBp, k]).toEqual([5000, 50]);
    expect([10, 50, 100, 210].map((v) => diminishingBp(v, capBp, k))).toEqual([833, 2500, 3333, 4038]);
    expect(diminishingBp(0, capBp, k)).toBe(0);
    expect(diminishingBp(-5, capBp, k)).toBe(0);
    expect(diminishingBp(Number.NaN, capBp, k)).toBe(0);
    expect(diminishingBp(1_000_000, capBp, k)).toBe(4999);
    expect(diminishingBp(Number.POSITIVE_INFINITY, capBp, k)).toBeLessThan(capBp);
    for (let v = 0; v < 500; v += 7) expect(diminishingBp(v + 1, capBp, k)).toBeGreaterThanOrEqual(diminishingBp(v, capBp, k));
  });

  it('craftMs = max(1 s, ceil(base × house × (1 − INT))), integer ms, the reductions multiply', () => {
    expect(craftMsFor(5000, 10_000, 833)).toBe(4584); // 4583.5 → up
    expect(craftMsFor(5000, 6_561, 833)).toBe(3008); // 5000 × 0.6561 × 0.9167 = 3007.25 → 3008
    expect(craftMsFor(80_000, 6_561, 4038)).toBe(31_294); // 80 000 × 0.6561 × 0.5962 = 31 293.6
    expect(craftMsFor(5000, 6_561, 4999)).toBe(1641);
    expect(craftMsFor(1000, 6_561, 4999)).toBe(1000); // the 1 s floor
    expect(craftMsFor(5000, 10_000, 0)).toBe(5000);
  });

  it('reads the EFFECTIVE INT (base + trained) and the house level', () => {
    let s = game();
    expect(intCraftReductionBp(s)).toBe(833);
    expect(craftingView(s).recipes[0].craftMs).toBe(4584);
    s = { ...s, training: { ...s.training, attributes: { ...s.training.attributes, intelligence: { level: 40, xp: 0, progressMs: 0 } } } };
    expect(intCraftReductionBp(s)).toBe(2500); // 10 base + 40 trained
    expect(craftingView(withLevel(s, 3)).recipes[0].craftMs).toBe(3038); // 5000 × 0.81 × 0.75 = 3037.5
  });

  it("each craft's duration is fixed when it starts: INT gained mid-job counts from the next craft", () => {
    let s = apply(game(), start(0, 'oak_plank', 3), T0);
    expect(s.crafting.pipes[0]!.craftMs).toBe(4584);
    s = apply(s, { type: 'DEBUG_ADD_ATTRIBUTE', attribute: 'intelligence', amount: 40 }, T0 + 1000);
    expect(s.crafting.pipes[0]!.craftMs).toBe(4584); // the craft in progress keeps its time
    s = simulate(s, T0 + 4584).state;
    expect(s.crafting.pipes[0]).toMatchObject({ done: 1, craftMs: 3750, progressMs: 0 }); // INT 50 → −25%
  });
});

describe('START_CRAFT', () => {
  it('consumes every input of the whole job at once and starts the pipe; not an activity', () => {
    const s0 = game();
    const r = run(s0, start(0, 'oak_plank', 20));
    if (!r.ok) throw new Error(r.error.message);
    expect(qty(r.state, 'oak_logs')).toBe(1000 - 40);
    expect(r.state.crafting.pipes[0]).toMatchObject({ id: 1, recipeId: 'oak_plank', mode: 'x1', quantity: 20, done: 0, progressMs: 0, staminaPerCraft: 0, status: 'running' });
    expect(r.state.crafting.nextJobSerial).toBe(2);
    expect(r.state.activity).toBeNull();
    expect(r.state.stamina).toEqual(s0.stamina);
    expect(r.events).toContainEqual({ type: 'CRAFT_STARTED', pipe: 0, jobId: 1, recipeId: 'oak_plank', quantity: 20, mode: 'x1' });
  });

  it('typed errors change nothing', () => {
    const s = game({ oak_logs: 10, stone: 100 });
    const locked = { ...s, buildings: { ...s.buildings, crafting: { state: 'locked' as const, level: 0 } } };
    expectError(locked, start(0, 'oak_plank', 1), 'BUILDING_LOCKED');
    expectError(s, start(2, 'oak_plank', 1), 'PIPE_LOCKED');
    expectError(s, start(7, 'oak_plank', 1), 'PIPE_LOCKED');
    expectError(s, start(8, 'oak_plank', 1), 'INVALID_COMMAND');
    expectError(s, start(-1, 'oak_plank', 1), 'INVALID_COMMAND');
    expectError(s, start(0, 'mithril_bar', 1), 'UNKNOWN_RECIPE');
    expectError(s, { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank', quantity: 1, mode: 'x3' as 'x1', maxCost: 0 }, 'INVALID_COMMAND');
    for (const q of [0, -1, 1.5, CRAFTING.maxJobQuantity + 1, Number.NaN]) expectError(s, start(0, 'oak_plank', q), 'INVALID_AMOUNT');
    expectError(s, start(0, 'oak_plank', 1, 'x1', -1), 'INVALID_AMOUNT');
    expectError(s, start(0, 'oak_plank', 6), 'NOT_ENOUGH_ITEMS'); // 12 logs needed, 10 held
    expectError(s, start(0, 'birch_plank', 1), 'NOT_ENOUGH_ITEMS');
    expectError(s, start(0, 'stone_brick', 3, 'x10', 2), 'COST_CHANGED'); // 3 crafts × 1 stamina shown as 2
    const tired = { ...s, stamina: { ...s.stamina, current: 2 } };
    expectError(tired, start(0, 'stone_brick', 3, 'x10', 3), 'NOT_ENOUGH_STAMINA');
    const busy = apply(s, start(0, 'oak_plank', 1), T0);
    expectError(busy, start(0, 'stone_brick', 1), 'PIPE_BUSY');
    // A refused command never touches its input.
    const frozen = JSON.parse(JSON.stringify(s));
    run(s, start(0, 'oak_plank', 6));
    expect(s).toEqual(frozen);
  });

  it('pipes never compete for materials: the second job only sees what the first left', () => {
    let s = game({ oak_logs: 10 });
    s = apply(s, start(0, 'oak_plank', 4), T0);
    expectError(s, start(1, 'oak_plank', 2), 'NOT_ENOUGH_ITEMS');
    s = apply(s, start(1, 'oak_plank', 1), T0);
    expect(qty(s, 'oak_logs')).toBe(0);
    s = simulate(s, T0 + HOUR).state;
    expect(qty(s, 'oak_plank')).toBe(5);
  });
});

describe('x10 mode', () => {
  it('10× inputs and output in the same time; stamina per craft = max(1, ceil(9 × craftMs / 1 min)), paid up front', () => {
    expect([1000, 4584, 6666, 6667, 60_000, 73_336].map(x10StaminaPerCraft)).toEqual([1, 1, 1, 2, 9, 12]);
    const s0 = game({ gold_ore: 640 });
    const view = craftingView(s0).recipes.find((r) => r.recipeId === 'gold_ingot')!;
    expect(view.craftMs).toBe(73_336); // 80 s × 0.9167
    expect(view.x10StaminaPerCraft).toBe(12);
    expect(view.max).toEqual({ x1: 20, x10: 2 });
    let s = apply(s0, start(0, 'gold_ingot', 2, 'x10', 24), T0);
    expect(s.stamina.current).toBe(100 - 24);
    expect(qty(s, 'gold_ore')).toBe(0);
    s = simulate(s, T0 + 73_336).state;
    expect(qty(s, 'gold_ingot')).toBe(10);
    expect(s.crafting.pipes[0]).toMatchObject({ done: 1 });
  });

  it('the Max button respects stamina too', () => {
    const s = { ...game({ stone: 1000 }), stamina: { current: 7, max: 100, progressMs: 0 } };
    expect(craftingView(s).recipes.find((r) => r.recipeId === 'stone_brick')!.max).toEqual({ x1: 500, x10: 7 });
  });
});

describe('cancel and insta', () => {
  it('CANCEL_CRAFT: inputs of every craft not delivered back (the one in progress too), stamina of every x10 craft not started', () => {
    let s = apply(game({ stone: 200 }), start(0, 'stone_brick', 5, 'x10', 5), T0); // 100 stone, 5 stamina
    expect([qty(s, 'stone'), s.stamina.current]).toEqual([100, 95]);
    s = simulate(s, T0 + 4584 * 2 + 100).state; // 2 crafts delivered, the third in progress
    expect(qty(s, 'stone_brick')).toBe(20);
    expectError(s, { type: 'CANCEL_CRAFT', pipe: 0, jobId: 99 }, 'CRAFT_CHANGED', T0 + 9300);
    expectError(s, { type: 'CANCEL_CRAFT', pipe: 1, jobId: 1 }, 'NO_CRAFT_JOB', T0 + 9300);
    const r = run(s, { type: 'CANCEL_CRAFT', pipe: 0, jobId: 1 }, T0 + 9300);
    if (!r.ok) throw new Error(r.error.message);
    expect(qty(r.state, 'stone')).toBe(100 + 3 * 20);
    expect(qty(r.state, 'stone_brick')).toBe(20);
    expect(r.state.stamina.current).toBe(95 + 2);
    expect(r.state.crafting.pipes[0]).toBeNull();
    expect(r.events).toContainEqual({ type: 'CRAFT_JOB_CANCELLED', pipe: 0, jobId: 1 });
  });

  it('the stamina refund never goes above max; a refund that would not fit is refused (nothing lost)', () => {
    let s = apply(game({ stone: 200 }), start(0, 'stone_brick', 10, 'x10', 10), T0);
    s = { ...s, stamina: { ...s.stamina, current: 99 } };
    const r = run(s, { type: 'CANCEL_CRAFT', pipe: 0, jobId: 1 }, T0);
    expect(r.ok && r.state.stamina).toEqual({ current: 100, max: 100, progressMs: 0 });
    // All 200 stone went into the job (stack gone); fill every slot: the refund has no room.
    const full = cloneState(s);
    for (let i = 0; full.inventory.items.length < full.inventory.capacity; i += 1) full.inventory.items.push({ id: `x${i}`, defId: 'iron_helm', name: 'Iron Helm', icon: '⛑️', slot: 'helmet' });
    expectError(full, { type: 'CANCEL_CRAFT', pipe: 0, jobId: 1 }, 'INVENTORY_FULL');
  });

  it('INSTA_CRAFT: ceil(remaining minutes) stamina (≥ 1) finishes the current craft now; bound to the craft and cost shown', () => {
    let s = apply(game({ gold_ore: 64 }), start(0, 'gold_ingot', 2), T0); // 73 336 ms per craft
    s = simulate(s, T0 + 10_000).state;
    const v = craftJobView(s, 0)!;
    expect([v.remainingMs, v.instaCost, v.craftNumber]).toEqual([63_336, 2, 1]);
    expectError(s, { type: 'INSTA_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: 1 }, 'COST_CHANGED', T0 + 10_000);
    expectError(s, { type: 'INSTA_CRAFT', pipe: 0, jobId: 1, craft: 2, maxCost: 2 }, 'CRAFT_CHANGED', T0 + 10_000);
    expectError(s, { type: 'INSTA_CRAFT', pipe: 0, jobId: 2, craft: 1, maxCost: 2 }, 'CRAFT_CHANGED', T0 + 10_000);
    expectError(s, { type: 'INSTA_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: 0 }, 'INVALID_AMOUNT', T0 + 10_000);
    expectError({ ...s, stamina: { ...s.stamina, current: 1 } }, { type: 'INSTA_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: 2 }, 'NOT_ENOUGH_STAMINA', T0 + 10_000);
    s = apply(s, { type: 'INSTA_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: 2 }, T0 + 10_000);
    expect(qty(s, 'gold_ingot')).toBe(1);
    expect(s.stamina.current).toBe(98);
    expect(s.crafting.pipes[0]).toMatchObject({ done: 1, progressMs: 0 });
    // The last craft: the pipe goes idle.
    s = apply(s, { type: 'INSTA_CRAFT', pipe: 0, jobId: 1, craft: 2, maxCost: 2 }, T0 + 10_000);
    expect(s.crafting.pipes[0]).toBeNull();
    expect(qty(s, 'gold_ingot')).toBe(2);
    expectError(s, { type: 'INSTA_CRAFT', pipe: 0, jobId: 1, craft: 3, maxCost: 2 }, 'NO_CRAFT_JOB', T0 + 10_000);
  });
});

/** Fills every free slot with unique junk so a new stack can't be added. */
function fill(s: GameState): GameState {
  const out = cloneState(s);
  for (let i = 0; out.inventory.items.length < out.inventory.capacity; i += 1) out.inventory.items.push({ id: `helm#${i}`, defId: 'iron_helm', name: 'Iron Helm', icon: '⛑️', slot: 'helmet' });
  return out;
}

describe('inventory full', () => {
  it('a finished craft whose output does not fit holds the pipe (timer held, nothing lost) and delivers when room appears', () => {
    let s = fill(apply(game({ oak_logs: 10 }), start(0, 'oak_plank', 3), T0)); // no oak_plank stack yet
    const r = simulate(s, T0 + HOUR);
    s = r.state;
    expect(s.crafting.pipes[0]).toMatchObject({ done: 0, status: 'held', progressMs: 4584 });
    expect(r.events).toContainEqual({ type: 'CRAFT_HELD', pipe: 0, jobId: 1 });
    expect(r.summary.craftsCompleted).toBe(0);
    expectError(s, { type: 'INSTA_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: 1 }, 'INVENTORY_FULL', T0 + HOUR);
    // A sale frees a slot: the held craft delivers at once, the next craft starts then.
    s = apply(s, { type: 'SELL_ITEM', itemId: 'helm#0', quantity: 1 }, T0 + HOUR);
    expect(qty(s, 'oak_plank')).toBe(1);
    expect(s.crafting.pipes[0]).toMatchObject({ done: 1, status: 'running', progressMs: 0 });
    s = simulate(s, T0 + HOUR + 2 * 4584).state;
    expect(qty(s, 'oak_plank')).toBe(3);
    expect(s.crafting.pipes[0]).toBeNull();
  });

  it('an existing stack always takes the output; insta is refused when the output has no room', () => {
    let s = apply(game({ oak_logs: 10, oak_plank: 1 }), start(0, 'oak_plank', 2), T0);
    s = fill(s);
    s = simulate(s, T0 + 2 * 4584).state;
    expect(qty(s, 'oak_plank')).toBe(3);
    let t = fill(apply(game({ oak_logs: 10 }), start(0, 'oak_plank', 2), T0));
    expectError(t, { type: 'INSTA_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: 1 }, 'INVENTORY_FULL');
    t = simulate(t, T0 + 1000).state;
    expect(t.stamina.current).toBe(100);
  });
});

describe('yield and the fraction ledger', () => {
  it('Lv5: 10 crafts of 1 → 12 planks, whole numbers only, the rest in thousandths', () => {
    let s = apply(withLevel(game({ oak_logs: 100 }), 5), start(0, 'oak_plank', 10), T0);
    const ms = s.crafting.pipes[0]!.craftMs;
    expect(ms).toBe(3008);
    s = simulate(s, T0 + 3 * ms).state;
    expect(qty(s, 'oak_plank')).toBe(3); // 1.2 × 3 = 3.6
    expect(s.crafting.remainders).toEqual({ oak_plank: 600 });
    s = simulate(s, T0 + 5 * ms).state;
    expect(qty(s, 'oak_plank')).toBe(6); // 6.0: the ledger paid one out
    expect(s.crafting.remainders).toEqual({});
    const r = simulate(s, T0 + 10 * ms);
    expect(qty(r.state, 'oak_plank')).toBe(12);
    expect(r.summary.itemsCrafted).toEqual({ oak_plank: 6 });
    expect(r.state.inventory.items.every((i) => Number.isSafeInteger(i.quantity ?? 1))).toBe(true);
  });

  it('Lv4 x10: +10% of the whole output (11 per craft); sale prices unchanged', () => {
    let s = apply(withLevel(game({ stone: 100 }), 4), start(0, 'stone_brick', 5, 'x10'), T0);
    s = simulate(s, T0 + HOUR).state;
    expect(qty(s, 'stone_brick')).toBe(55);
    expect(sellPriceOf(s, 'stone_brick')).toBe(2);
  });
});

describe('time rules', () => {
  /** Two pipes, woodcutting, an Oak crew and a house upgrade, all at once. */
  function busy(): GameState {
    let s = game({ oak_logs: 2000, stone: 2000 }, 11);
    s = { ...s, character: { ...s.character, gold: 10_000 }, buildings: { ...s.buildings, town_hall: { state: 'built', level: 3 } } };
    s = apply(s, start(0, 'oak_plank', 200), T0);
    s = apply(s, start(1, 'stone_brick', 40, 'x10', 40), T0 + 1234);
    s = apply(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0 + 2000);
    s = apply(s, { type: 'HIRE_WORKER', maxCost: 100 }, T0 + 2000);
    s = apply(s, { type: 'ASSIGN_WORKER', workerId: 'w1', node: 'oak' }, T0 + 2000);
    s = apply(s, { type: 'UPGRADE_BUILDING', buildingId: 'crafting', level: 2 }, T0 + 3000);
    return s;
  }

  it('split invariance: 1 s ticks = 7 s / 13 s splits = one big simulate, byte for byte', () => {
    const s0 = busy();
    const end = T0 + 3000 + 30 * MIN;
    const big = simulate(s0, end).state;
    for (const step of [1000, 7000, 13_000]) {
      let s = s0;
      for (let t = T0 + 3000 + step; t < end; t += step) s = simulate(s, t).state;
      s = simulate(s, end).state;
      expect(hashState(s)).toBe(hashState(big));
    }
    expect(big.buildings.crafting.level).toBe(2);
    expect(qty(big, 'oak_plank')).toBeGreaterThan(200 - 1); // done before 30 min
    expect(big.crafting.pipes[1]).toBeNull();
  });

  it('offline cap: 10 h away crafts only 8 h; a backward clock grants nothing; garbage time is a no-op', () => {
    const s0 = apply(game({ oak_logs: 100_000 }), start(0, 'oak_plank', 10_000), T0);
    const r = simulate(s0, T0 + 10 * HOUR);
    expect(r.summary.craftsCompleted).toBe(Math.floor((8 * HOUR) / 4584));
    expect(r.summary.itemsCrafted.oak_plank).toBe(Math.floor((8 * HOUR) / 4584));
    const back = simulate(r.state, T0 + 5 * HOUR);
    expect(back.state).toBe(r.state);
    expect(back.summary.anomalies[0]).toMatchObject({ kind: 'backward' });
    expect(simulate(r.state, Number.NaN).state).toBe(r.state);
  });

  it('pipes never use the hero: a dungeon, training or woodcutting starts and stops beside them', () => {
    let s = apply(game(), start(0, 'oak_plank', 100), T0);
    s = apply(s, { type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, T0 + 1000);
    s = apply(s, { type: 'START_ACTIVITY', kind: 'training', attribute: 'intelligence' }, T0 + 2000);
    s = apply(s, { type: 'STOP_ACTIVITY' }, T0 + 3000);
    expect(s.crafting.pipes[0]).toMatchObject({ status: 'running', done: 0 });
    const r = simulate(s, T0 + 10 * 4584);
    expect(r.state.crafting.pipes[0]!.done).toBe(10);
    expect(r.summary.craftsCompleted).toBe(10);
  });
});

describe('debug and the client', () => {
  it('DEBUG_UNLOCK_PIPE opens the next pipe up to 8 and marks the save; refused without debug tools', () => {
    let s = game();
    const r = applyCommand(s, cmd({ type: 'DEBUG_UNLOCK_PIPE' }), T0, { allowDebug: false });
    expect(!r.ok && r.error.code).toBe('DEBUG_DISABLED');
    for (let n = 3; n <= 8; n += 1) {
      s = apply(s, { type: 'DEBUG_UNLOCK_PIPE' }, T0);
      expect(s.crafting.pipesUnlocked).toBe(n);
    }
    expect(s.flags.debugUsed).toBe(true);
    expectError(s, { type: 'DEBUG_UNLOCK_PIPE' }, 'PIPES_MAXED');
    expect(craftingView(s).pipes.map((p) => p.slot)).toEqual(Array(8).fill('open'));
    expect(craftingView(game()).pipes.map((p) => p.slot)).toEqual(['open', 'open', 'later', 'later', 'premium', 'premium', 'premium', 'premium']);
  });

  it('logged commands replay to the same hash (memory repository)', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'craft' });
    await client.load();
    await debugBuild(client, ['woodcutting', 'mine_shaft', 'crafting']);
    await client.debug.addGold(1000);
    await client.dispatch({ type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' });
    clock.advance(HOUR);
    await client.resume();
    const logs = qty(client.getState(), 'oak_logs');
    expect(logs).toBeGreaterThan(20);
    const send = async (c: Input) => {
      const r = await client.dispatch(c);
      if (!r.ok) throw new Error(r.error.message);
    };
    await send(start(0, 'oak_plank', Math.floor(logs / 4)));
    await send({ type: 'DEBUG_UNLOCK_PIPE' });
    await send(start(2, 'oak_plank', 1, 'x1', 0));
    clock.advance(5 * SEC);
    await client.tick();
    const j = craftJobView(client.getState(), 0)!;
    await send({ type: 'INSTA_CRAFT', pipe: 0, jobId: j.id, craft: j.craftNumber, maxCost: j.instaCost });
    await send({ type: 'CANCEL_CRAFT', pipe: 0, jobId: j.id });
    clock.advance(10 * MIN);
    await client.resume();
    const rows = await repo.getAllLog();
    for (const t of ['START_CRAFT', 'INSTA_CRAFT', 'CANCEL_CRAFT', 'DEBUG_UNLOCK_PIPE']) expect(rows.some((r) => r.type === t)).toBe(true);
    const report = replayLogReport(rows.map(({ seq: _s, synced: _y, ...r }) => r));
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});

// Keeps the Command import used for readers: every crafting command is part of the union.
export type _CraftCommands = Extract<Command, { type: 'START_CRAFT' | 'INSTA_CRAFT' | 'CANCEL_CRAFT' | 'DEBUG_UNLOCK_PIPE' }>;
