// Gear crafting (engine 1.14.0): gear recipes, one piece per job, stamina invested for the quality floor, the roll at
// START_CRAFT (seeded, stored on the job, never shown before Done), the `ready` pipe, COLLECT_CRAFT, inventory-full,
// cancel rules, insta, and the time rules (split invariance across simulate boundaries and offline).
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  craftingSign,
  craftingView,
  craftJobView,
  craftMs,
  type GameState,
  getItemDef,
  hashState,
  RECIPE_IDS,
  RECIPES,
  simulate,
} from '../src/engine';
import { cloneState } from '../src/engine/clone';
import { addStackable, makeItem } from '../src/engine/inventory';
import { builtGame, cmd, HOUR, MIN, qty, SEC, T0 } from './helpers';

type Input = Parameters<typeof cmd>[0];

const MATS = { stone_brick: 200, oak_plank: 200, copper_ingot: 50, birch_plank: 50, iron_ingot: 50, maple_plank: 50 };

function game(seed = 7, items: Record<string, number> = MATS): GameState {
  const s = cloneState(builtGame(seed, T0));
  for (const [id, n] of Object.entries(items)) addStackable(s.inventory, id, n);
  return s;
}

function ok(s: GameState, c: Input, at = T0): GameState {
  const r = applyCommand(s, cmd(c), at);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
}

function code(s: GameState, c: Input, at = T0): string {
  const r = applyCommand(s, cmd(c), at);
  return r.ok ? 'ok' : r.error.code;
}

type StartCraft = Extract<Input, { type: 'START_CRAFT' }>;

const gear = (pipe: number, recipeId: string, stamina = 0): StartCraft => ({ type: 'START_CRAFT', pipe, recipeId, quantity: 1, mode: 'x1', maxCost: stamina, stamina });

describe('gear recipes (owner-approved 2026-11-01)', () => {
  it('30 recipes: tier n uses tier n bricks / ingots + planks, fixed counts, T1 times doubling per tier, one piece', () => {
    const pieces = { sword: [4, 2, 5], helm: [3, 1, 4], chestplate: [6, 2, 8], shield: [3, 3, 5], gloves: [2, 1, 2], boots: [2, 1, 2] } as const;
    const sets = [
      ['stone', 'stone_brick', 'oak_plank'],
      ['copper', 'copper_ingot', 'birch_plank'],
      ['iron', 'iron_ingot', 'maple_plank'],
      ['silver', 'silver_ingot', 'yew_plank'],
      ['gold', 'gold_ingot', 'ironwood_plank'],
    ] as const;
    const ids = RECIPE_IDS.filter((id) => RECIPES[id].kind === 'gear');
    expect(ids).toHaveLength(30);
    sets.forEach(([set, bar, plank], t) => {
      for (const [piece, [bars, planks, min]] of Object.entries(pieces)) {
        const r = RECIPES[`${set}_${piece}` as (typeof RECIPE_IDS)[number]];
        expect(r).toMatchObject({ kind: 'gear', tier: t + 1, output: { defId: `${set}_${piece}`, quantity: 1 }, baseMs: min * MIN * 2 ** t });
        expect(r.inputs).toEqual([
          { defId: bar, quantity: bars },
          { defId: plank, quantity: planks },
        ]);
        expect(getItemDef(r.output.defId)?.slot).toBeDefined();
      }
    });
  });

  it('views: Equipment recipes carry max stats, odds and the stamina rule; x10 is never offered', () => {
    const s = game();
    const v = craftingView(s).recipes.find((r) => r.recipeId === 'stone_sword')!;
    expect(v.gear).toEqual({
      slot: 'weapon',
      maxStats: { damage: { min: 4, max: 6 } },
      rarityOdds: [
        { rarity: 'uncommon', pct: 75 },
        { rarity: 'rare', pct: 20 },
        { rarity: 'epic', pct: 5 },
      ],
      maxStamina: 50,
      qualityBpPerStamina: 100,
      minQualityBp: 0,
    });
    expect(v.max).toEqual({ x1: 1, x10: 0 });
    expect(v.craftMs).toBe(craftMs(s, 'stone_sword')); // house × INT, like materials
    expect(craftingView(s).recipes.find((r) => r.recipeId === 'oak_plank')!.gear).toBeNull();
  });
});

describe('START_CRAFT for gear', () => {
  it('refuses x10, more than one piece, stamina outside 0..50, stamina on materials, a cost above maxCost', () => {
    const s = game();
    expect(code(s, { ...gear(0, 'stone_sword'), mode: 'x10' })).toBe('INVALID_COMMAND');
    expect(code(s, { ...gear(0, 'stone_sword'), quantity: 2 })).toBe('INVALID_AMOUNT');
    expect(code(s, gear(0, 'stone_sword', 51))).toBe('INVALID_AMOUNT');
    expect(code(s, gear(0, 'stone_sword', -1))).toBe('INVALID_AMOUNT');
    expect(code(s, { ...gear(0, 'stone_sword', 20), maxCost: 19 })).toBe('COST_CHANGED');
    expect(code(s, { type: 'START_CRAFT', pipe: 0, recipeId: 'oak_plank', quantity: 1, mode: 'x1', maxCost: 5, stamina: 5 })).toBe('INVALID_AMOUNT');
    const tired = cloneState(s);
    tired.stamina.current = 10;
    expect(code(tired, gear(0, 'stone_sword', 20))).toBe('NOT_ENOUGH_STAMINA');
    expect(code(game(7, { stone_brick: 3, oak_plank: 2 }), gear(0, 'stone_sword'))).toBe('NOT_ENOUGH_ITEMS');
  });

  it('pays inputs and the invested stamina at once and rolls quality ≥ the floor and a rarity, stored on the job', () => {
    const s = game();
    const after = ok(s, gear(0, 'stone_sword', 20));
    expect(qty(after, 'stone_brick')).toBe(196);
    expect(qty(after, 'oak_plank')).toBe(198);
    expect(after.stamina.current).toBe(s.stamina.current - 20);
    const job = after.crafting.pipes[0]!;
    expect(job).toMatchObject({ recipeId: 'stone_sword', quantity: 1, mode: 'x1', staminaPerCraft: 0, status: 'running' });
    expect(job.gear!.staminaInvested).toBe(20);
    expect(job.gear!.qualityBp).toBeGreaterThanOrEqual(2000);
    expect(job.gear!.qualityBp).toBeLessThanOrEqual(10_000);
    expect(['uncommon', 'rare', 'epic']).toContain(job.gear!.rarity);
    expect(after.rng).not.toEqual(s.rng); // two draws of the main stream
    // Deterministic: the same state and command roll the same piece.
    expect(ok(s, gear(0, 'stone_sword', 20)).crafting.pipes[0]).toEqual(job);
    // The view never shows the roll.
    const view = craftJobView(after, 0)!;
    expect(view).not.toHaveProperty('gear');
    expect(JSON.stringify(view)).not.toContain('qualityBp');
    expect(view).toMatchObject({ kind: 'gear', staminaInvested: 20, ready: false });
  });

  it('quality bounds: floor = 100 bp per stamina (50 → 50%), uniform up to 100%; rarity odds ≈ 75 / 20 / 5', () => {
    const counts: Record<string, number> = {};
    const N = 3000;
    let lo50 = 10_000;
    let lo0 = 10_000;
    let hi0 = 0;
    for (let i = 0; i < N; i += 1) {
      const s = game(1000 + i, { stone_brick: 4, oak_plank: 2 });
      const a = ok(s, gear(0, 'stone_sword', 50)).crafting.pipes[0]!.gear!;
      const b = ok(s, gear(0, 'stone_sword', 0)).crafting.pipes[0]!.gear!;
      lo50 = Math.min(lo50, a.qualityBp);
      lo0 = Math.min(lo0, b.qualityBp);
      hi0 = Math.max(hi0, b.qualityBp);
      counts[b.rarity] = (counts[b.rarity] ?? 0) + 1;
    }
    expect(lo50).toBeGreaterThanOrEqual(5000);
    expect(lo50).toBeLessThan(5200);
    expect(lo0).toBeLessThan(300);
    expect(hi0).toBeGreaterThan(9700);
    expect(Object.keys(counts).sort()).toEqual(['epic', 'rare', 'uncommon']);
    expect(counts.uncommon / N).toBeCloseTo(0.75, 1);
    expect(counts.rare / N).toBeCloseTo(0.2, 1);
    expect(counts.epic / N).toBeCloseTo(0.05, 1);
  });

  it('stamina never changes the rarity odds: the same seed rolls the same rarity at 0 and 50 stamina', () => {
    for (let i = 0; i < 200; i += 1) {
      const s = game(500 + i, { stone_brick: 4, oak_plank: 2 });
      expect(ok(s, gear(0, 'stone_sword', 50)).crafting.pipes[0]!.gear!.rarity).toBe(ok(s, gear(0, 'stone_sword', 0)).crafting.pipes[0]!.gear!.rarity);
    }
  });

  it('a recipe override replaces the default odds (config hook, unused)', () => {
    const r = RECIPES.stone_sword;
    const saved = r.rarityWeights;
    try {
      (r as { rarityWeights?: unknown }).rarityWeights = [{ value: 'legendary', weight: 1 }];
      expect(ok(game(), gear(0, 'stone_sword')).crafting.pipes[0]!.gear!.rarity).toBe('legendary');
    } finally {
      (r as { rarityWeights?: unknown }).rarityWeights = saved;
    }
  });
});

describe('ready → Done (COLLECT_CRAFT)', () => {
  const ms = (s: GameState) => craftMs(s, 'stone_sword');

  it('the finished piece waits in the pipe (ready, 100%), starts nothing else, offline too; Done moves it into the inventory', () => {
    const s0 = ok(game(), gear(0, 'stone_sword', 20));
    const roll = s0.crafting.pipes[0]!.gear!;
    const sim = simulate(s0, T0 + ms(s0) + 8 * HOUR);
    const s = sim.state;
    expect(s.crafting.pipes[0]).toMatchObject({ status: 'ready', progressMs: ms(s0), craftMs: ms(s0) });
    expect(sim.summary.craftsReady).toEqual({ stone_sword: 1 });
    expect(sim.summary.craftsCompleted).toBe(0);
    expect(sim.events.filter((e) => e.type === 'CRAFT_READY')).toHaveLength(1);
    expect(craftJobView(s, 0)).toMatchObject({ ready: true, fraction: 1, remainingMs: 0 });
    expect(craftingSign(s)).toMatchObject({ readyName: 'Stone Sword' });
    expect(craftingView(s).ready).toBe(1);
    expect(s.inventory.items.some((i) => i.defId === 'stone_sword')).toBe(false);

    expect(code(s, { type: 'COLLECT_CRAFT', pipe: 0, jobId: 999 })).toBe('CRAFT_CHANGED');
    const done = ok(s, { type: 'COLLECT_CRAFT', pipe: 0, jobId: s.crafting.pipes[0]!.id });
    const item = done.inventory.items.find((i) => i.defId === 'stone_sword')!;
    expect(item).toEqual(makeItem('stone_sword', 1, `stone_sword#${s.nextItemSerial}`, { qualityBp: roll.qualityBp, rarity: roll.rarity }));
    expect(done.nextItemSerial).toBe(s.nextItemSerial + 1);
    expect(done.crafting.pipes[0]).toBeNull();
    // Equipped, it gives its scaled damage.
    const eq = ok(done, { type: 'EQUIP_ITEM', itemId: item.id });
    expect(eq.character.equipment.weapon?.id).toBe(item.id);
  });

  it('refused while crafting (CRAFT_NOT_READY), on an idle pipe (NO_CRAFT_JOB), and with no free slot (INVENTORY_FULL: the piece stays)', () => {
    const s0 = ok(game(), gear(0, 'stone_sword'));
    const id = s0.crafting.pipes[0]!.id;
    expect(code(s0, { type: 'COLLECT_CRAFT', pipe: 0, jobId: id })).toBe('CRAFT_NOT_READY');
    expect(code(s0, { type: 'COLLECT_CRAFT', pipe: 1, jobId: id })).toBe('NO_CRAFT_JOB');
    const ready = simulate(s0, T0 + HOUR).state;
    const full = cloneState(ready);
    while (full.inventory.items.length < full.inventory.capacity) full.inventory.items.push(makeItem('bread', 1, `junk${full.inventory.items.length}`));
    expect(code(full, { type: 'COLLECT_CRAFT', pipe: 0, jobId: id }, T0 + HOUR)).toBe('INVENTORY_FULL');
    // Still there after more time; a free slot lets it out.
    const later = simulate(full, T0 + 3 * HOUR).state;
    expect(later.crafting.pipes[0]).toMatchObject({ status: 'ready' });
    const sold = ok(later, { type: 'SELL_ITEM', itemId: `junk${full.inventory.capacity - 1}`, quantity: 1 }, T0 + 3 * HOUR);
    expect(sold.crafting.pipes[0]).toMatchObject({ status: 'ready' }); // a ready piece is never auto-delivered
    expect(code(sold, { type: 'COLLECT_CRAFT', pipe: 0, jobId: id }, T0 + 3 * HOUR)).toBe('ok');
  });

  it('cancel: while crafting refunds the materials, never the invested stamina; a ready job cannot be cancelled', () => {
    const s0 = game();
    const started = ok(s0, gear(0, 'stone_sword', 30));
    const id = started.crafting.pipes[0]!.id;
    expect(craftJobView(started, 0)!.refund).toEqual({ items: [{ defId: 'stone_brick', quantity: 4 }, { defId: 'oak_plank', quantity: 2 }], stamina: 0 });
    const cancelled = ok(started, { type: 'CANCEL_CRAFT', pipe: 0, jobId: id }, T0 + MIN);
    expect([qty(cancelled, 'stone_brick'), qty(cancelled, 'oak_plank')]).toEqual([200, 200]);
    expect(cancelled.stamina.current).toBe(started.stamina.current); // the 30 invested are not refunded
    expect(cancelled.stamina.current).toBe(s0.stamina.current - 30);
    expect(cancelled.crafting.pipes[0]).toBeNull();
    const ready = simulate(started, T0 + HOUR).state;
    expect(code(ready, { type: 'CANCEL_CRAFT', pipe: 0, jobId: id }, T0 + HOUR)).toBe('CRAFT_READY');
    expect(code(ready, { type: 'INSTA_CRAFT', pipe: 0, jobId: id, craft: 1, maxCost: 99 }, T0 + HOUR)).toBe('CRAFT_READY');
  });

  it('insta on a gear craft costs ceil(minutes left) and takes the job to ready (no room needed: it waits in the pipe)', () => {
    const s0 = ok(game(), gear(0, 'stone_chestplate'));
    const full = cloneState(s0);
    while (full.inventory.items.length < full.inventory.capacity) full.inventory.items.push(makeItem('bread', 1, `junk${full.inventory.items.length}`));
    const v = craftJobView(full, 0)!;
    expect(v.instaCost).toBe(Math.ceil(v.remainingMs / MIN));
    const after = ok(full, { type: 'INSTA_CRAFT', pipe: 0, jobId: v.id, craft: 1, maxCost: v.instaCost });
    expect(after.crafting.pipes[0]).toMatchObject({ status: 'ready', progressMs: v.craftMs });
    expect(after.stamina.current).toBe(full.stamina.current - v.instaCost);
  });
});

describe('time rules', () => {
  it('split invariance: one simulate = many small ones = a command mid-way (the roll was fixed at start)', () => {
    const s0 = ok(ok(game(7, { ...MATS, oak_logs: 40 }), gear(0, 'stone_sword', 10)), { type: 'START_CRAFT', pipe: 1, recipeId: 'oak_plank', quantity: 20, mode: 'x1', maxCost: 0 });
    const end = T0 + 2 * HOUR;
    const once = simulate(s0, end).state;
    let steps = s0;
    for (let t = T0 + 7 * SEC; t < end; t += 7 * SEC + 13) steps = simulate(steps, t).state;
    steps = simulate(steps, end).state;
    expect(hashState(steps)).toBe(hashState(once));
    // An unrelated command mid-craft changes nothing about the piece.
    const mid = ok(s0, { type: 'DEBUG_ADD_GOLD', amount: 1 }, T0 + 2 * MIN);
    const withCmd = simulate(mid, end).state;
    expect(withCmd.crafting.pipes[0]).toEqual(once.crafting.pipes[0]);
  });

  it('offline: the piece is ready after the cap and its roll is the one paid for', () => {
    const s0 = ok(game(), gear(0, 'stone_sword'));
    const roll = s0.crafting.pipes[0]!.gear;
    const back = simulate(s0, T0 + 30 * HOUR).state; // capped at 8 h
    expect(back.crafting.pipes[0]).toMatchObject({ status: 'ready', gear: roll });
  });
});
