// Crafting house (engine 1.13.0; continuous material pipes 1.15.0): pipes, material recipes, craft time (house × INT,
// diminishing), inputs per craft and waiting, pipe order, the ×10 tap, insta, Stop refunds, the yield fraction ledger,
// inventory-full holds, and the time rules (split invariance with waiting pipes, cap, clock, away lines).
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  BUILDINGS,
  type Command,
  craftingSign,
  craftingView,
  craftJobView,
  craftMsFor,
  diminishingBp,
  type GameState,
  hashState,
  intCraftReductionBp,
  mergeSummaries,
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
import { apply, builtGame, cmd, debugBuild, HOUR, makeClient, MIN, qty, SEC, T0, withCore } from './helpers';

type Input = Parameters<typeof cmd>[0];

/**
 * A built game (every building) with these stacks added, and core INT 10 (−8.33% craft time: the numbers below were pinned
 * when a new hero had INT 10; since 1.16.0 only core INT counts and a new hero has 0).
 */
function game(items: Record<string, number> = { oak_logs: 1000, stone: 1000 }, seed = 7): GameState {
  const s = cloneState(withCore(builtGame(seed, T0), { intelligence: 10 }));
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

/** START_CRAFT in `pipe`, or (undefined) in the first free open pipe, as the Recipes view sends it. */
const start = (pipe: number | undefined, recipeId: string): Input => (pipe === undefined ? { type: 'START_CRAFT', recipeId } : { type: 'START_CRAFT', pipe, recipeId });

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

  it('reads the CORE INT only (training level, 1.16.0) and the house level', () => {
    expect(craftingView(builtGame(7, T0)).recipes[0].craftMs).toBe(5000); // a new hero: core INT 0
    let s = game();
    expect(intCraftReductionBp(s)).toBe(833);
    expect(craftingView(s).recipes[0].craftMs).toBe(4584);
    // Normal INT (level points, extra) never shortens crafting.
    const normal = { ...s, character: { ...s.character, level: 30, attributes: { ...s.character.attributes, intelligence: 500 } } };
    expect(intCraftReductionBp(normal)).toBe(833);
    s = withCore(s, { intelligence: 50 });
    expect(intCraftReductionBp(s)).toBe(2500); // core 50
    expect(craftingView(withLevel(s, 3)).recipes[0].craftMs).toBe(3038); // 5000 × 0.81 × 0.75 = 3037.5
  });

  it("each craft's duration is fixed when it starts: INT gained mid-job counts from the next craft", () => {
    let s = apply(game(), start(0, 'oak_plank'), T0);
    expect(s.crafting.pipes[0]!.craftMs).toBe(4584);
    s = simulate(s, T0 + 1000).state;
    s = withCore(s, { intelligence: 50 }); // core INT 10 → 50 mid-craft (as training levels would)
    expect(s.crafting.pipes[0]!.craftMs).toBe(4584); // the craft in progress keeps its time
    s = simulate(s, T0 + 4584).state;
    expect(s.crafting.pipes[0]).toMatchObject({ done: 1, craftMs: 3750, progressMs: 0 }); // core INT 50 → −25%
  });
});

describe('START_CRAFT (1.15.0: continuous material pipes)', () => {
  it("takes only the first craft's inputs and starts the pipe; no quantity, no mode, no stamina; not an activity", () => {
    const s0 = game();
    const r = run(s0, start(0, 'oak_plank'));
    if (!r.ok) throw new Error(r.error.message);
    expect(qty(r.state, 'oak_logs')).toBe(1000 - 2);
    expect(r.state.crafting.pipes[0]).toEqual({ id: 1, recipeId: 'oak_plank', done: 0, craftMs: 4584, progressMs: 0, x10: false, status: 'running', startedAt: T0 });
    expect(r.state.crafting.nextJobSerial).toBe(2);
    expect(r.state.activity).toBeNull();
    expect(r.state.stamina).toEqual(s0.stamina);
    expect(r.events).toContainEqual({ type: 'CRAFT_STARTED', pipe: 0, jobId: 1, recipeId: 'oak_plank' });
  });

  it('typed errors change nothing', () => {
    const s = game({ oak_logs: 10 });
    const locked = { ...s, buildings: { ...s.buildings, crafting: { state: 'locked' as const, level: 0 } } };
    expectError(locked, start(0, 'oak_plank'), 'BUILDING_LOCKED');
    expectError(s, start(2, 'oak_plank'), 'PIPE_LOCKED');
    expectError(s, start(7, 'oak_plank'), 'PIPE_LOCKED');
    expectError(s, start(8, 'oak_plank'), 'INVALID_COMMAND');
    expectError(s, start(-1, 'oak_plank'), 'INVALID_COMMAND');
    expectError(s, start(0, 'mithril_bar'), 'UNKNOWN_RECIPE');
    expectError(s, { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank', maxCost: -1 }, 'INVALID_AMOUNT');
    expectError(s, { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank', maxCost: 5, stamina: 5 }, 'INVALID_AMOUNT'); // only gear takes stamina
    const busy = apply(s, start(0, 'oak_plank'), T0);
    expectError(busy, start(0, 'stone_brick'), 'PIPE_BUSY');
    const frozen = JSON.parse(JSON.stringify(busy));
    run(busy, start(0, 'stone_brick'));
    expect(busy).toEqual(frozen);
  });

  it('Recipes view: no pipe → the first free open pipe; ALL_PIPES_BUSY when every open pipe is busy', () => {
    let s = apply(game(), start(0, 'oak_plank'), T0);
    expect(craftingView(s).freePipe).toBe(1);
    const r = run(s, start(undefined, 'stone_brick'));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.crafting.pipes[1]).toMatchObject({ recipeId: 'stone_brick', status: 'running' });
    s = r.state;
    expect(craftingView(s).freePipe).toBeNull();
    expectError(s, start(undefined, 'oak_plank'), 'ALL_PIPES_BUSY');
    // A locked pipe is never chosen; a freed one is.
    s = apply(s, { type: 'STOP_CRAFT', pipe: 0, jobId: 1 }, T0);
    expect(apply(s, start(undefined, 'birch_plank'), T0).crafting.pipes[0]).toMatchObject({ recipeId: 'birch_plank', status: 'waiting' });
  });

  it('with too few inputs the pipe starts waiting ("Waiting for Oak Logs (1/2)"): no time passes, nothing is taken', () => {
    const r = run(game({ oak_logs: 1 }), start(0, 'oak_plank'));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.crafting.pipes[0]).toMatchObject({ status: 'waiting', done: 0, craftMs: 0, progressMs: 0 });
    expect(r.events).toContainEqual({ type: 'CRAFT_WAITING', pipe: 0, jobId: 1 });
    expect(qty(r.state, 'oak_logs')).toBe(1);
    const v = craftJobView(r.state, 0)!;
    expect([v.waitingFor, v.remainingMs, v.fraction, v.x10Tap, v.refund]).toEqual([[{ defId: 'oak_logs', have: 1, need: 2 }], 0, 0, null, []]);
    const later = simulate(r.state, T0 + HOUR);
    expect(later.state.crafting.pipes[0]).toEqual(r.state.crafting.pipes[0]);
    expect(qty(later.state, 'oak_logs')).toBe(1);
    expect(later.summary.craftWaits).toEqual([{ pipe: 0, defId: 'oak_logs' }]);
    expectError(later.state, { type: 'INSTA_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: 1 }, 'CRAFT_WAITING', T0 + HOUR);
    expect(craftingSign(later.state)).toMatchObject({ busy: 1, waiting: true });
  });
});

describe('continuous crafting', () => {
  it('crafts back to back, each craft taking its 2 logs when it starts, until the logs run out; then it waits', () => {
    let s = apply(game({ oak_logs: 7 }), start(0, 'oak_plank'), T0);
    expect(qty(s, 'oak_logs')).toBe(5);
    s = simulate(s, T0 + 2 * 4584).state;
    expect(s.crafting.pipes[0]).toMatchObject({ done: 2, status: 'running', progressMs: 0 });
    expect(qty(s, 'oak_logs')).toBe(1); // craft 3 took its 2 at T0 + 9 168
    const r = simulate(s, T0 + HOUR);
    expect(qty(r.state, 'oak_plank')).toBe(3);
    expect(r.state.crafting.pipes[0]).toMatchObject({ done: 3, status: 'waiting' });
    expect(craftJobView(r.state, 0)!.waitingFor).toEqual([{ defId: 'oak_logs', have: 1, need: 2 }]);
    expect(r.summary.craftWaits).toEqual([{ pipe: 0, defId: 'oak_logs' }]);
  });

  it('a command that brings the inputs (a refund here) starts a waiting pipe at that instant', () => {
    let s = apply(game({ oak_logs: 3 }), start(0, 'oak_plank'), T0);
    s = apply(s, start(1, 'oak_plank'), T0);
    expect(s.crafting.pipes[1]).toMatchObject({ status: 'waiting' });
    const r = run(s, { type: 'STOP_CRAFT', pipe: 0, jobId: 1 }, T0 + 1000);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.crafting.pipes[0]).toBeNull();
    expect(r.state.crafting.pipes[1]).toMatchObject({ status: 'running', progressMs: 0, craftMs: 4584 });
    expect(qty(r.state, 'oak_logs')).toBe(1);
  });

  it('pipes share one inventory: at one instant they draw in pipe order', () => {
    // Pipes 1 and 2 wait for Oak Logs; one craft's worth arrives: pipe 1 takes it, pipe 2 keeps waiting.
    let s = apply(game({ oak_logs: 0 }), start(1, 'oak_plank'), T0);
    s = apply(s, start(0, 'oak_plank'), T0);
    const fed = cloneState(s);
    addStackable(fed.inventory, 'oak_logs', 3);
    const t = simulate(fed, T0 + 1000).state;
    expect([t.crafting.pipes[0]!.status, t.crafting.pipes[1]!.status]).toEqual(['running', 'waiting']);
    expect(qty(t, 'oak_logs')).toBe(1);
  });

  it('resumes at the exact instant of a log cut (woodcutting), split or not', () => {
    // No logs: the pipe waits; the hero cuts Oak beside it.
    let s = apply(game({ oak_logs: 0 }), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0);
    s = apply(s, start(0, 'oak_plank'), T0);
    const alone = apply(game({ oak_logs: 0 }), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0);
    // The first instant the hero alone has ≥ 2 logs.
    let lo = T0;
    let hi = T0 + 10 * MIN;
    while (hi - lo > 1) {
      const m = Math.floor((lo + hi) / 2);
      if (qty(simulate(alone, m).state, 'oak_logs') >= 2) hi = m;
      else lo = m;
    }
    const cut = hi;
    expect(simulate(s, cut - 1).state.crafting.pipes[0]!.status).toBe('waiting');
    const at = simulate(s, cut).state;
    expect(at.crafting.pipes[0]).toMatchObject({ status: 'running', progressMs: 0 }); // started at that very instant
    expect(qty(at, 'oak_logs')).toBe(qty(simulate(alone, cut).state, 'oak_logs') - 2);
    const big = simulate(s, cut + 700).state;
    expect(big.crafting.pipes[0]).toMatchObject({ status: 'running', progressMs: 700 });
    let split = s;
    for (let t = T0 + 999; t < cut + 700; t += 999) split = simulate(split, t).state;
    expect(hashState(simulate(split, cut + 700).state)).toBe(hashState(big));
  });
});

describe('×10 tap (X10_CRAFT)', () => {
  const tap = (s: GameState, pipe = 0): Extract<Input, { type: 'X10_CRAFT' }> => {
    const v = craftJobView(s, pipe)!;
    return { type: 'X10_CRAFT', pipe, jobId: v.id, craft: v.craftNumber, maxCost: v.x10Tap?.stamina ?? 1 };
  };

  it('stamina = max(1, ceil(9 × craftMs / 1 min)) (unchanged)', () => {
    expect([1000, 4584, 6666, 6667, 60_000, 73_336].map(x10StaminaPerCraft)).toEqual([1, 1, 1, 2, 9, 12]);
  });

  it('takes 9× the inputs now and the stamina; that craft makes 10× in the same time, progress kept; the next is ×1', () => {
    let s = apply(game({ oak_logs: 100 }), start(0, 'oak_plank'), T0);
    s = simulate(s, T0 + 2000).state;
    expect(craftJobView(s, 0)!.x10Tap).toEqual({ items: [{ defId: 'oak_logs', quantity: 18 }], stamina: 1, blocked: null });
    const r = run(s, tap(s), T0 + 2000);
    if (!r.ok) throw new Error(r.error.message);
    s = r.state;
    expect([qty(s, 'oak_logs'), s.stamina.current]).toEqual([100 - 2 - 18, 99]);
    expect(s.crafting.pipes[0]).toMatchObject({ x10: true, progressMs: 2000, craftMs: 4584, done: 0 });
    expect(r.events).toContainEqual({ type: 'CRAFT_X10', pipe: 0, jobId: 1, craft: 1, stamina: 1 });
    expect(craftJobView(s, 0)!.x10Tap).toBeNull(); // already ×10
    s = simulate(s, T0 + 4584).state;
    expect(qty(s, 'oak_plank')).toBe(10);
    expect(s.crafting.pipes[0]).toMatchObject({ x10: false, done: 1, progressMs: 0 });
    expect(qty(s, 'oak_logs')).toBe(78);
  });

  it('a long craft: 12 stamina for a Gold Ingot (73 336 ms); insta works on a ×10 craft', () => {
    let s = apply(game({ gold_ore: 640 }), start(0, 'gold_ingot'), T0);
    s = simulate(s, T0 + 10_000).state;
    expect(craftJobView(s, 0)!.x10Tap).toMatchObject({ items: [{ defId: 'gold_ore', quantity: 288 }], stamina: 12 });
    s = apply(s, tap(s), T0 + 10_000);
    expect(s.stamina.current).toBe(88);
    const v = craftJobView(s, 0)!;
    s = apply(s, { type: 'INSTA_CRAFT', pipe: 0, jobId: v.id, craft: v.craftNumber, maxCost: v.instaCost }, T0 + 10_000);
    expect(qty(s, 'gold_ingot')).toBe(10);
    expect(s.stamina.current).toBe(88 - 2);
    expect(s.crafting.pipes[0]).toMatchObject({ x10: false, done: 1 });
  });

  it('every rule and error; refused taps change nothing', () => {
    let s = apply(game({ oak_logs: 12 }), start(0, 'oak_plank'), T0); // 10 logs left: not enough for 18
    s = simulate(s, T0 + 1000).state;
    const ok = tap(s);
    expect(craftJobView(s, 0)!.x10Tap).toMatchObject({ stamina: 1, blocked: 'Needs 18 Oak Logs' });
    expectError(s, ok, 'NOT_ENOUGH_ITEMS', T0 + 1000);
    s = cloneState(s);
    addStackable(s.inventory, 'oak_logs', 100);
    expectError(s, { ...ok, maxCost: 0 }, 'INVALID_AMOUNT', T0 + 1000);
    expectError(s, { ...ok, craft: 0 }, 'INVALID_COMMAND', T0 + 1000);
    expectError(s, { ...ok, pipe: 9 }, 'INVALID_COMMAND', T0 + 1000);
    expectError(s, { ...ok, pipe: 1 }, 'NO_CRAFT_JOB', T0 + 1000);
    expectError(s, { ...ok, jobId: 2 }, 'CRAFT_CHANGED', T0 + 1000);
    expectError(s, { ...ok, craft: 2 }, 'CRAFT_CHANGED', T0 + 1000);
    expectError(s, ok, 'CRAFT_CHANGED', T0 + 4584); // that craft finished meanwhile
    const tired = { ...s, stamina: { ...s.stamina, current: 0 } };
    expect(craftJobView(tired, 0)!.x10Tap!.blocked).toBe('Not enough stamina');
    expectError(tired, ok, 'NOT_ENOUGH_STAMINA', T0 + 1000);
    const slow = { ...s, crafting: { ...s.crafting, pipes: s.crafting.pipes.map((j, i) => (i === 0 && j ? { ...j, craftMs: 60_000 } : j)) } };
    expectError(slow, ok, 'COST_CHANGED', T0 + 1000); // 9 stamina now, 1 shown
    const tapped = apply(s, ok, T0 + 1000);
    expectError(tapped, ok, 'ALREADY_X10', T0 + 1000);
    // Waiting, held and gear pipes have no ×10.
    const waiting = apply(game({ oak_logs: 1 }), start(0, 'oak_plank'), T0);
    expectError(waiting, { type: 'X10_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: 1 }, 'CRAFT_WAITING');
    const held = simulate(fill(apply(game({ oak_logs: 100 }), start(0, 'oak_plank'), T0)), T0 + HOUR).state;
    expect(held.crafting.pipes[0]!.status).toBe('held');
    expect(craftJobView(held, 0)!.x10Tap).toBeNull();
    expectError(held, { type: 'X10_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: 1 }, 'INVENTORY_FULL', T0 + HOUR);
    const gear = apply(game({ stone_brick: 10, oak_plank: 10 }), { type: 'START_CRAFT', pipe: 0, recipeId: 'stone_sword', maxCost: 0, stamina: 0 }, T0);
    expect(craftJobView(gear, 0)!.x10Tap).toBeNull();
    expectError(gear, { type: 'X10_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: 100 }, 'INVALID_COMMAND');
    const frozen = JSON.parse(JSON.stringify(s));
    run(s, { ...ok, maxCost: 0 }, T0 + 1000);
    expect(s).toEqual(frozen);
  });
});

describe('Stop and insta', () => {
  it('STOP_CRAFT refunds the craft in progress (a ×10 one: all 20 inputs), never its stamina; bound to the job shown', () => {
    let s = apply(game({ stone: 200 }), start(0, 'stone_brick'), T0);
    s = simulate(s, T0 + 4584 + 100).state; // craft 1 delivered, craft 2 in progress
    s = apply(s, { type: 'X10_CRAFT', pipe: 0, jobId: 1, craft: 2, maxCost: 1 }, T0 + 4684);
    expect([qty(s, 'stone'), qty(s, 'stone_brick'), s.stamina.current]).toEqual([200 - 2 - 2 - 18, 1, 99]);
    expectError(s, { type: 'STOP_CRAFT', pipe: 0, jobId: 99 }, 'CRAFT_CHANGED', T0 + 4700);
    expectError(s, { type: 'STOP_CRAFT', pipe: 1, jobId: 1 }, 'NO_CRAFT_JOB', T0 + 4700);
    expectError(s, { type: 'CANCEL_CRAFT', pipe: 0, jobId: 1 }, 'INVALID_COMMAND', T0 + 4700); // Cancel is for gear
    expect(craftJobView(s, 0)!.refund).toEqual([{ defId: 'stone', quantity: 20 }]);
    const r = run(s, { type: 'STOP_CRAFT', pipe: 0, jobId: 1 }, T0 + 4700);
    if (!r.ok) throw new Error(r.error.message);
    expect([qty(r.state, 'stone'), qty(r.state, 'stone_brick'), r.state.stamina.current]).toEqual([198, 1, 99]);
    expect(r.state.crafting.pipes[0]).toBeNull();
    expect(r.events).toContainEqual({ type: 'CRAFT_STOPPED', pipe: 0, jobId: 1 });
  });

  it('a waiting pipe just becomes free; a refund that would not fit is refused (nothing lost)', () => {
    const waiting = apply(game({ oak_logs: 1 }), start(0, 'oak_plank'), T0);
    const r = run(waiting, { type: 'STOP_CRAFT', pipe: 0, jobId: 1 }, T0);
    expect(r.ok && [r.state.crafting.pipes[0], qty(r.state, 'oak_logs')]).toEqual([null, 1]);
    // The first craft took the last 2 logs (stack gone); every slot filled: the refund has no room.
    const full = fill(apply(game({ oak_logs: 2 }), start(0, 'oak_plank'), T0));
    expectError(full, { type: 'STOP_CRAFT', pipe: 0, jobId: 1 }, 'INVENTORY_FULL');
  });

  it('INSTA_CRAFT: ceil(remaining minutes) stamina (≥ 1) finishes the current craft now; bound to the craft and cost shown', () => {
    let s = apply(game({ gold_ore: 64 }), start(0, 'gold_ingot'), T0); // 73 336 ms per craft
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
    expect(s.crafting.pipes[0]).toMatchObject({ done: 1, progressMs: 0, status: 'running' });
    // The second craft took the last 32 ore; insta on it: the pipe then waits.
    s = apply(s, { type: 'INSTA_CRAFT', pipe: 0, jobId: 1, craft: 2, maxCost: 2 }, T0 + 10_000);
    expect(s.crafting.pipes[0]).toMatchObject({ done: 2, status: 'waiting' });
    expect(qty(s, 'gold_ingot')).toBe(2);
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
    let s = fill(apply(game({ oak_logs: 10 }), start(0, 'oak_plank'), T0)); // no oak_plank stack yet
    const r = simulate(s, T0 + HOUR);
    s = r.state;
    expect(s.crafting.pipes[0]).toMatchObject({ done: 0, status: 'held', progressMs: 4584 });
    expect(r.events).toContainEqual({ type: 'CRAFT_HELD', pipe: 0, jobId: 1 });
    expect(r.summary.craftsCompleted).toBe(0);
    expect(qty(s, 'oak_logs')).toBe(8); // held: the next craft has not taken anything
    expectError(s, { type: 'INSTA_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: 1 }, 'INVENTORY_FULL', T0 + HOUR);
    // A sale frees a slot: the held craft delivers at once, the next craft starts then.
    s = apply(s, { type: 'SELL_ITEM', itemId: 'helm#0', quantity: 1 }, T0 + HOUR);
    expect(qty(s, 'oak_plank')).toBe(1);
    expect(s.crafting.pipes[0]).toMatchObject({ done: 1, status: 'running', progressMs: 0 });
    s = simulate(s, T0 + 2 * HOUR).state;
    expect(qty(s, 'oak_plank')).toBe(5);
    expect(s.crafting.pipes[0]).toMatchObject({ done: 5, status: 'waiting' });
  });

  it('an existing stack always takes the output; insta is refused when the output has no room', () => {
    let s = apply(game({ oak_logs: 10, oak_plank: 1 }), start(0, 'oak_plank'), T0);
    s = fill(s);
    s = simulate(s, T0 + 2 * 4584).state;
    expect(qty(s, 'oak_plank')).toBe(3);
    let t = fill(apply(game({ oak_logs: 10 }), start(0, 'oak_plank'), T0));
    expectError(t, { type: 'INSTA_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: 1 }, 'INVENTORY_FULL');
    t = simulate(t, T0 + 1000).state;
    expect(t.stamina.current).toBe(100);
  });
});

describe('yield and the fraction ledger', () => {
  it('Lv5: 10 crafts of 1 → 12 planks, whole numbers only, the rest in thousandths', () => {
    let s = apply(withLevel(game({ oak_logs: 20 }), 5), start(0, 'oak_plank'), T0);
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
    expect(r.state.crafting.pipes[0]).toMatchObject({ done: 10, status: 'waiting' }); // 20 logs = 10 crafts
    expect(r.state.inventory.items.every((i) => Number.isSafeInteger(i.quantity ?? 1))).toBe(true);
  });

  it('Lv4 ×10: +10% of the whole output (11 for one ×10 craft); sale prices unchanged', () => {
    let s = apply(withLevel(game({ stone: 20 }), 4), start(0, 'stone_brick'), T0);
    s = apply(s, { type: 'X10_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: 1 }, T0);
    s = simulate(s, T0 + HOUR).state;
    expect(qty(s, 'stone_brick')).toBe(11);
    expect(sellPriceOf(s, 'stone_brick')).toBe(2);
  });
});

describe('time rules', () => {
  /** Two Oak pipes competing for the hero's and a crew's logs, a Stone pipe waiting all along, and a house upgrade. */
  function busy(): GameState {
    let s = game({ oak_logs: 30, stone: 25 }, 11);
    s = { ...s, character: { ...s.character, gold: 10_000 }, buildings: { ...s.buildings, town_hall: { state: 'built', level: 3 } } };
    s = apply(s, { type: 'UPGRADE_BUILDING', buildingId: 'crafting', level: 2 }, T0); // 25 Oak, 25 Stone: 5 logs left
    s = apply(s, { type: 'DEBUG_UNLOCK_PIPE' }, T0);
    s = apply(s, start(0, 'oak_plank'), T0 + 1000);
    s = apply(s, start(1, 'oak_plank'), T0 + 1234);
    s = apply(s, start(2, 'stone_brick'), T0 + 1234);
    s = apply(s, { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0 + 2000);
    s = apply(s, { type: 'HIRE_WORKER', maxCost: 100 }, T0 + 2000);
    s = apply(s, { type: 'ASSIGN_WORKER', workerId: 'w1', node: 'oak' }, T0 + 3000);
    return s;
  }

  it('split invariance with waiting pipes: 1 s ticks = 7 s / 13 s splits = one big simulate, byte for byte', () => {
    const s0 = busy();
    const end = T0 + 3000 + 30 * MIN;
    const big = simulate(s0, end);
    for (const step of [1000, 7000, 13_000]) {
      let s = s0;
      for (let t = T0 + 3000 + step; t < end; t += step) s = simulate(s, t).state;
      s = simulate(s, end).state;
      expect(hashState(s)).toBe(hashState(big.state));
    }
    expect(big.state.buildings.crafting.level).toBe(2);
    // Both Oak pipes crafted from what the hero and the crew cut; pipe 1 waited at times, the Stone pipe all along.
    expect(big.state.crafting.pipes[0]!.done + big.state.crafting.pipes[1]!.done).toBe(qty(big.state, 'oak_plank'));
    expect(big.state.crafting.pipes[0]!.done).toBeGreaterThan(big.state.crafting.pipes[1]!.done);
    expect(big.state.crafting.pipes[2]).toMatchObject({ status: 'waiting', done: 0 });
    expect(big.summary.craftWaits).toEqual(expect.arrayContaining([{ pipe: 1, defId: 'oak_logs' }, { pipe: 2, defId: 'stone' }]));
  });

  it('offline cap: 10 h away crafts only 8 h, waiting pipes included; a backward clock grants nothing; garbage time is a no-op', () => {
    let s0 = apply(game({ oak_logs: 100_000 }), start(0, 'oak_plank'), T0);
    s0 = apply(s0, start(1, 'stone_brick'), T0); // no stone: waits the whole time
    const r = simulate(s0, T0 + 10 * HOUR);
    expect(r.summary.craftsCompleted).toBe(Math.floor((8 * HOUR) / 4584));
    expect(r.summary.itemsCrafted.oak_plank).toBe(Math.floor((8 * HOUR) / 4584));
    expect(r.summary.craftWaits).toEqual([{ pipe: 1, defId: 'stone' }]);
    expect(r.state.crafting.pipes[1]).toEqual(s0.crafting.pipes[1]);
    const back = simulate(r.state, T0 + 5 * HOUR);
    expect(back.state).toBe(r.state);
    expect(back.summary.anomalies[0]).toMatchObject({ kind: 'backward' });
    expect(simulate(r.state, Number.NaN).state).toBe(r.state);
  });

  it('a waiting pipe fed during an 8 h stretch away resumes then, and the away lines merge per pipe and item', () => {
    let s = apply(game({ oak_logs: 0 }), { type: 'START_ACTIVITY', kind: 'woodcutting', treeId: 'oak' }, T0);
    s = apply(s, start(0, 'oak_plank'), T0);
    s = apply(s, start(1, 'oak_plank'), T0);
    const away = simulate(s, T0 + 10 * HOUR);
    expect(away.summary.craftsCompleted).toBeGreaterThan(0);
    expect(away.summary.craftWaits).toEqual([
      { pipe: 0, defId: 'oak_logs' },
      { pipe: 1, defId: 'oak_logs' },
    ]);
    expect(mergeSummaries(away.summary, away.summary).craftWaits).toEqual(away.summary.craftWaits);
  });

  it('pipes never use the hero: a dungeon, training or woodcutting starts and stops beside them', () => {
    let s = apply(game(), start(0, 'oak_plank'), T0);
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
    expect(qty(client.getState(), 'oak_logs')).toBeGreaterThan(20);
    const send = async (c: Input) => {
      const r = await client.dispatch(c);
      if (!r.ok) throw new Error(r.error.message);
    };
    await send(start(0, 'oak_plank'));
    await send({ type: 'DEBUG_UNLOCK_PIPE' });
    await send(start(undefined, 'stone_brick')); // no stone: waits in pipe 2
    clock.advance(2 * SEC);
    await client.tick();
    let j = craftJobView(client.getState(), 0)!;
    await send({ type: 'X10_CRAFT', pipe: 0, jobId: j.id, craft: j.craftNumber, maxCost: j.x10Tap!.stamina });
    await send({ type: 'INSTA_CRAFT', pipe: 0, jobId: j.id, craft: j.craftNumber, maxCost: j.instaCost });
    j = craftJobView(client.getState(), 0)!;
    await send({ type: 'STOP_CRAFT', pipe: 0, jobId: j.id });
    await send({ type: 'STOP_CRAFT', pipe: 1, jobId: craftJobView(client.getState(), 1)!.id });
    clock.advance(10 * MIN);
    await client.resume();
    const rows = await repo.getAllLog();
    for (const t of ['START_CRAFT', 'X10_CRAFT', 'INSTA_CRAFT', 'STOP_CRAFT', 'DEBUG_UNLOCK_PIPE']) expect(rows.some((r) => r.type === t)).toBe(true);
    const report = replayLogReport(rows.map(({ seq: _s, synced: _y, ...r }) => r));
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});

// Keeps the Command import used for readers: every crafting command is part of the union.
export type _CraftCommands = Extract<Command, { type: 'START_CRAFT' | 'INSTA_CRAFT' | 'X10_CRAFT' | 'STOP_CRAFT' | 'CANCEL_CRAFT' | 'DEBUG_UNLOCK_PIPE' }>;
