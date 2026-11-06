// Crafting debug commands (engine 1.23.0): DEBUG_FORCE_CRAFT (the first craft takes and needs no materials) and
// DEBUG_FINISH_CRAFT (INSTA_CRAFT's effect for free). Both are debug-only, mark the save, are logged and replay.
import { describe, expect, it } from 'vitest';
import { applyCommand, craftJobView, ENGINE_VERSION, type GameState, hashState, replayLogReport, simulate } from '../src/engine';
import { cloneState } from '../src/engine/clone';
import { addStackable } from '../src/engine/inventory';
import { apply, builtGame, cmd, debugBuild, HOUR, makeClient, MIN, qty, SEC, T0 } from './helpers';

type Input = Parameters<typeof cmd>[0];

/** A built game; only these stacks are in the bag (no crafting materials by default). */
function game(items: Record<string, number> = {}, seed = 7): GameState {
  const s = cloneState(builtGame(seed, T0));
  for (const [id, n] of Object.entries(items)) addStackable(s.inventory, id, n);
  return s;
}

function code(s: GameState, c: Input, at = T0, allowDebug?: boolean): string {
  const r = applyCommand(s, cmd(c), at, allowDebug === undefined ? undefined : { allowDebug });
  return r.ok ? 'ok' : r.error.code;
}

const force = (pipe: number | undefined, recipeId: string, stamina?: number): Input => ({
  type: 'DEBUG_FORCE_CRAFT',
  recipeId,
  ...(pipe === undefined ? {} : { pipe }),
  ...(stamina === undefined ? {} : { stamina, maxCost: stamina }),
});
const startGear = (pipe: number, recipeId: string, stamina = 0): Input => ({ type: 'START_CRAFT', pipe, recipeId, stamina, maxCost: stamina });
const finish = (s: GameState, pipe: number, withCraft = true): Input => {
  const j = craftJobView(s, pipe)!;
  return { type: 'DEBUG_FINISH_CRAFT', pipe, jobId: j.id, ...(withCraft ? { craft: j.craftNumber } : {}) };
};

/** Every item in the bag, by def, so "nothing was minted" is one comparison. */
const bag = (s: GameState) => Object.fromEntries(s.inventory.items.map((i) => [i.defId ?? i.id, i.quantity ?? 1]));

describe('DEBUG_FORCE_CRAFT: materials', () => {
  it('starts a material job with zero materials, takes nothing, marks the save, uses the first free pipe', () => {
    const s0 = game();
    expect(qty(s0, 'oak_logs')).toBe(0);
    const r = applyCommand(s0, cmd(force(undefined, 'oak_plank')), T0);
    if (!r.ok) throw new Error(r.error.code);
    const s = r.state;
    expect(s.flags.debugUsed).toBe(true);
    expect(r.events).toContainEqual({ type: 'CRAFT_STARTED', pipe: 0, jobId: 1, recipeId: 'oak_plank' });
    expect(s.crafting.pipes[0]).toMatchObject({ recipeId: 'oak_plank', status: 'running', free: true, done: 0, progressMs: 0 });
    expect(s.crafting.pipes[0]!.craftMs).toBeGreaterThan(0);
    expect(qty(s, 'oak_logs')).toBe(0);
    // The second pipe is the next free one; a named busy pipe is refused as START_CRAFT refuses it.
    expect(apply(s, force(undefined, 'oak_plank'), T0).crafting.pipes[1]).toMatchObject({ free: true });
    expect(code(s, force(0, 'oak_plank'))).toBe('PIPE_BUSY');
  });

  it('refuses like START_CRAFT: pipe rules, unknown recipe, bad amounts, all pipes busy', () => {
    let s = apply(apply(game(), force(0, 'oak_plank'), T0), force(1, 'oak_plank'), T0);
    expect(code(s, force(undefined, 'oak_plank'))).toBe('ALL_PIPES_BUSY');
    s = game();
    expect(code(s, force(5, 'oak_plank'))).toBe('PIPE_LOCKED');
    expect(code(s, force(0, 'nope'))).toBe('UNKNOWN_RECIPE');
    expect(code(s, { type: 'DEBUG_FORCE_CRAFT', recipeId: 'oak_plank', stamina: 3, maxCost: 3 })).toBe('INVALID_AMOUNT'); // materials take no stamina
  });

  it('only the first craft is free: the second takes materials, or waits when they are short', () => {
    let s = apply(game(), force(0, 'oak_plank'), T0);
    const ms = s.crafting.pipes[0]!.craftMs;
    // No materials: the second craft waits (nothing taken, the free mark is gone).
    const r = simulate(s, T0 + ms);
    expect(r.state.crafting.pipes[0]).toMatchObject({ done: 1, status: 'waiting' });
    expect(r.state.crafting.pipes[0]!.free).toBeUndefined();
    expect(qty(r.state, 'oak_plank')).toBe(1);
    // With materials at hand the second craft takes its inputs (2 Oak Logs) when it starts.
    s = apply(game({ oak_logs: 10 }), force(0, 'oak_plank'), T0);
    s = simulate(s, T0 + ms).state;
    expect(s.crafting.pipes[0]).toMatchObject({ done: 1, status: 'running' });
    expect(s.crafting.pipes[0]!.free).toBeUndefined();
    expect(qty(s, 'oak_logs')).toBe(8);
  });

  it('Stop refunds nothing for the free craft (no minting), also after it was ×10; ×10 refunds only what it added', () => {
    const s0 = game();
    let s = apply(s0, force(0, 'oak_plank'), T0);
    s = apply(s, { type: 'STOP_CRAFT', pipe: 0, jobId: 1 }, T0);
    expect(bag(s)).toEqual(bag(s0));
    expect(s.crafting.pipes[0]).toBeNull();
    // ×10 on a free craft takes 9x the inputs (18 logs) and 9x stamina; Stop gives back exactly those 18.
    const s1 = game({ oak_logs: 18 });
    s = apply(s1, force(0, 'oak_plank'), T0);
    const j = craftJobView(s, 0)!;
    expect(j.refund).toEqual([]);
    s = apply(s, { type: 'X10_CRAFT', pipe: 0, jobId: j.id, craft: j.craftNumber, maxCost: j.x10Tap!.stamina }, T0);
    expect(qty(s, 'oak_logs')).toBe(0);
    expect(craftJobView(s, 0)!.refund).toEqual([{ defId: 'oak_logs', quantity: 18 }]);
    s = apply(s, { type: 'STOP_CRAFT', pipe: 0, jobId: 1 }, T0);
    expect(qty(s, 'oak_logs')).toBe(18);
    // A free ×10 craft delivers 10x the output.
    s = apply(game({ oak_logs: 18 }), force(0, 'oak_plank'), T0);
    s = apply(s, { type: 'X10_CRAFT', pipe: 0, jobId: 1, craft: 1, maxCost: j.x10Tap!.stamina }, T0);
    s = simulate(s, T0 + HOUR / 100).state;
    expect(qty(s, 'oak_plank')).toBeGreaterThanOrEqual(10);
  });
});

describe('DEBUG_FORCE_CRAFT: gear', () => {
  it('one free piece with zero materials; it rolls exactly like a normal craft (same stream, same stored roll)', () => {
    const mats = { stone_brick: 100, oak_plank: 100 };
    const normal = apply(game(mats), startGear(0, 'stone_sword', 10), T0);
    const forced = apply(game(mats), force(0, 'stone_sword', 10), T0);
    expect(forced.crafting.pipes[0]!.gear).toEqual(normal.crafting.pipes[0]!.gear);
    expect(forced.rng).toEqual(normal.rng);
    expect(forced.crafting.pipes[0]!.craftMs).toBe(normal.crafting.pipes[0]!.craftMs);
    expect(qty(forced, 'stone_brick')).toBe(100); // nothing taken even though the player had them
    expect(forced.stamina.current).toBe(normal.stamina.current); // the invested stamina is still paid
    // And with nothing in the bag it still starts, with the same roll as the normal craft would give.
    const empty = apply(game(), force(0, 'stone_sword', 10), T0);
    expect(empty.crafting.pipes[0]).toMatchObject({ status: 'running', free: true });
    expect(empty.crafting.pipes[0]!.gear).toEqual(normal.crafting.pipes[0]!.gear);
    expect(empty.stamina.current).toBe(game().stamina.current - 10);
  });

  it('keeps the stamina rules: NOT_ENOUGH_STAMINA, COST_CHANGED, range', () => {
    const s = game();
    expect(code({ ...s, stamina: { ...s.stamina, current: 3 } }, force(0, 'stone_sword', 5))).toBe('NOT_ENOUGH_STAMINA');
    expect(code(s, { type: 'DEBUG_FORCE_CRAFT', pipe: 0, recipeId: 'stone_sword', stamina: 5, maxCost: 2 })).toBe('COST_CHANGED');
    expect(code(s, force(0, 'stone_sword', 51))).toBe('INVALID_AMOUNT');
  });

  it('Cancel refunds nothing for a free piece (no minting); the stamina is lost as usual', () => {
    const s0 = game();
    let s = apply(s0, force(0, 'stone_sword', 4), T0);
    expect(craftJobView(s, 0)!.refund).toEqual([]);
    s = apply(s, { type: 'CANCEL_CRAFT', pipe: 0, jobId: 1 }, T0);
    expect(bag(s)).toEqual(bag(s0));
    expect(s.stamina.current).toBe(s0.stamina.current - 4);
    // A normal (paid) piece still refunds its inputs.
    const paid = apply(apply(game({ stone_brick: 9, oak_plank: 9 }), startGear(0, 'stone_sword'), T0), { type: 'CANCEL_CRAFT', pipe: 0, jobId: 1 }, T0);
    expect(qty(paid, 'stone_brick')).toBe(9);
  });

  it('finishes into a ready piece that Done collects', () => {
    let s = simulate(apply(game(), force(0, 'stone_sword'), T0), T0 + MIN).state;
    s = apply(s, finish(s, 0), T0 + MIN);
    expect(s.crafting.pipes[0]).toMatchObject({ status: 'ready' });
    s = apply(s, { type: 'COLLECT_CRAFT', pipe: 0, jobId: 1 }, T0 + MIN);
    expect(s.inventory.items.some((i) => i.defId === 'stone_sword')).toBe(true);
  });
});

describe('DEBUG_FINISH_CRAFT', () => {
  const MATS = { oak_logs: 100 };

  it('finishes exactly one material craft per tap at no stamina; the next craft starts as normal', () => {
    let s = apply(game(MATS), { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank' }, T0);
    expect(qty(s, 'oak_logs')).toBe(98);
    const stamina = s.stamina.current;
    s = apply(s, finish(s, 0), T0);
    expect(qty(s, 'oak_plank')).toBe(1);
    expect(s.crafting.pipes[0]).toMatchObject({ done: 1, status: 'running', progressMs: 0 });
    expect(qty(s, 'oak_logs')).toBe(96); // the next craft took its inputs
    s = apply(s, finish(s, 0), T0);
    expect(qty(s, 'oak_plank')).toBe(2);
    expect(s.stamina.current).toBe(stamina);
    expect(s.flags.debugUsed).toBe(true);
  });

  it('has INSTA_CRAFT\'s effect: same crafting slice and bag, minus the stamina', () => {
    const base = apply(game(MATS), { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank' }, T0);
    const j = craftJobView(base, 0)!;
    const insta = apply(base, { type: 'INSTA_CRAFT', pipe: 0, jobId: j.id, craft: j.craftNumber, maxCost: j.instaCost }, T0);
    const dbg = apply(base, finish(base, 0), T0);
    expect(dbg.crafting).toEqual(insta.crafting);
    expect(bag(dbg)).toEqual(bag(insta));
    expect(dbg.stamina.current).toBe(base.stamina.current);
    expect(insta.stamina.current).toBeLessThan(base.stamina.current);
  });

  it('finishing a free first craft delivers its output and leaves a normal second craft (waiting when short)', () => {
    let s = apply(game(), force(0, 'oak_plank'), T0);
    s = apply(s, finish(s, 0), T0);
    expect(qty(s, 'oak_plank')).toBe(1);
    expect(s.crafting.pipes[0]).toMatchObject({ done: 1, status: 'waiting' });
    expect(s.crafting.pipes[0]!.free).toBeUndefined();
  });

  it('is bound to the job and craft shown (CRAFT_CHANGED), and the craft number is optional', () => {
    const s = apply(game(MATS), { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank' }, T0);
    expect(code(s, { type: 'DEBUG_FINISH_CRAFT', pipe: 0, jobId: 1, craft: 2 })).toBe('CRAFT_CHANGED');
    expect(code(s, { type: 'DEBUG_FINISH_CRAFT', pipe: 0, jobId: 2, craft: 1 })).toBe('CRAFT_CHANGED');
    expect(code(s, { type: 'DEBUG_FINISH_CRAFT', pipe: 0, jobId: 1, craft: 0 })).toBe('INVALID_COMMAND');
    expect(code(s, { type: 'DEBUG_FINISH_CRAFT', pipe: 9, jobId: 1 })).toBe('INVALID_COMMAND');
    expect(code(s, { type: 'DEBUG_FINISH_CRAFT', pipe: 0, jobId: 1 })).toBe('ok');
    // A tap that arrives after the craft finished (stale craft number) is refused, not applied to the next craft.
    const after = apply(s, finish(s, 0), T0);
    expect(code(after, { type: 'DEBUG_FINISH_CRAFT', pipe: 0, jobId: 1, craft: 1 })).toBe('CRAFT_CHANGED');
  });

  it('is refused on idle, waiting and held pipes', () => {
    const s = game();
    expect(code(s, { type: 'DEBUG_FINISH_CRAFT', pipe: 0, jobId: 1, craft: 1 })).toBe('NO_CRAFT_JOB');
    const waiting = apply(s, { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank' }, T0);
    expect(waiting.crafting.pipes[0]!.status).toBe('waiting');
    expect(code(waiting, { type: 'DEBUG_FINISH_CRAFT', pipe: 0, jobId: 1, craft: 1 })).toBe('CRAFT_WAITING');
    // Held: the output has no room.
    let held = apply(game({ oak_logs: 10 }), { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank' }, T0);
    for (let i = 0; held.inventory.items.length < held.inventory.capacity; i += 1) held.inventory.items.push({ id: `helm#${i}`, defId: 'iron_helm', name: 'Iron Helm', icon: '', slot: 'helmet' });
    held = simulate(held, T0 + HOUR).state;
    expect(held.crafting.pipes[0]!.status).toBe('held');
    expect(code(held, { type: 'DEBUG_FINISH_CRAFT', pipe: 0, jobId: 1, craft: 1 }, T0 + HOUR)).toBe('INVENTORY_FULL');
  });

  it('a ready gear job (and a ready pipe) is refused with CRAFT_READY', () => {
    const s = simulate(apply(game(), force(0, 'stone_sword'), T0), T0 + HOUR).state;
    expect(s.crafting.pipes[0]!.status).toBe('ready');
    expect(code(s, { type: 'DEBUG_FINISH_CRAFT', pipe: 0, jobId: 1, craft: 1 }, T0 + HOUR)).toBe('CRAFT_READY');
  });
});

describe('debug gate and replay', () => {
  it('both are DEBUG_DISABLED without debug tools, and change nothing', () => {
    const s = apply(game({ oak_logs: 10 }), { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank' }, T0);
    const before = hashState(s);
    expect(code(s, force(1, 'oak_plank'), T0, false)).toBe('DEBUG_DISABLED');
    expect(code(s, { type: 'DEBUG_FINISH_CRAFT', pipe: 0, jobId: 1, craft: 1 }, T0, false)).toBe('DEBUG_DISABLED');
    expect(hashState(s)).toBe(before);
    expect(s.flags.debugUsed).toBe(false);
  });

  it('a refused debug command does not mark the save', () => {
    const s = game();
    const r = applyCommand(s, cmd({ type: 'DEBUG_FINISH_CRAFT', pipe: 0, jobId: 1 }), T0);
    expect(r.ok).toBe(false);
    expect(s.flags.debugUsed).toBe(false);
  });

  it('the engine is 1.24.0 (the crafting debug commands shipped in 1.23.0)', () => {
    expect(ENGINE_VERSION).toBe('1.24.0');
  });

  it('logged through the client, the rows replay to the same hash (and restore Stop with no minting)', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'cdbg' });
    await client.load();
    await debugBuild(client, ['woodcutting', 'mine_shaft', 'crafting']);
    const ok = async (p: Promise<{ ok: boolean }>) => expect((await p).ok).toBe(true);
    await ok(client.debug.forceCraft({ recipeId: 'oak_plank' }));
    await ok(client.debug.forceCraft({ recipeId: 'stone_sword', stamina: 6, maxCost: 6 }));
    clock.advance(2 * SEC);
    await client.tick();
    const j0 = craftJobView(client.getState(), 0)!;
    await ok(client.debug.finishCraft({ pipe: 0, jobId: j0.id, craft: j0.craftNumber }));
    const j1 = craftJobView(client.getState(), 1)!;
    await ok(client.debug.finishCraft({ pipe: 1, jobId: j1.id }));
    expect(craftJobView(client.getState(), 1)!.ready).toBe(true);
    await ok(client.dispatch({ type: 'STOP_CRAFT', pipe: 0, jobId: j0.id }));
    clock.advance(10 * MIN);
    await client.resume();
    const rows = await repo.getAllLog();
    for (const t of ['DEBUG_FORCE_CRAFT', 'DEBUG_FINISH_CRAFT']) expect(rows.some((r) => r.type === t)).toBe(true);
    expect(client.getState().flags.debugUsed).toBe(true);
    const report = replayLogReport(rows.map(({ seq: _s, synced: _y, ...r }) => r));
    expect(hashState(report.state!)).toBe(hashState(client.getState()));
  });
});
