// Done's reveal (fix, UI only): the collected piece's id comes from the engine's CRAFT_COLLECTED event. A guess made
// from the state shown before the dispatch (collectedItemId) is wrong when the time the dispatch simulates first moves
// nextItemSerial (a boss gear drop in that span, or any item given meanwhile).
import { describe, expect, it } from 'vitest';
import { collectedItemIdOf } from '../src/client/dispatchEvents';
import type { DispatchResult } from '../src/client/types';
import { applyCommand, collectedItemId, craftJobView, type GameState, getItemDef } from '../src/engine';
import { cloneState } from '../src/engine/clone';
import { addStackable } from '../src/engine/inventory';
import { builtGame, cmd, HOUR, T0 } from './helpers';

function readyGear(): GameState {
  const s = cloneState(builtGame(7, T0));
  addStackable(s.inventory, 'stone_brick', 50);
  addStackable(s.inventory, 'oak_plank', 50);
  const r = applyCommand(s, cmd({ type: 'START_CRAFT', pipe: 0, recipeId: 'stone_sword', maxCost: 0, stamina: 0 }), T0);
  if (!r.ok) throw new Error(r.error.message);
  return r.state;
}

/** What LocalGameClient.dispatch resolves for an accepted command. */
function dispatchLike(state: GameState, c: Parameters<typeof cmd>[0], at: number): DispatchResult {
  const r = applyCommand(state, cmd(c), at);
  return r.ok ? { ok: true, duplicate: false, state: r.state, events: r.events } : { ok: false, error: r.error };
}

describe('collectedItemIdOf', () => {
  it('is null for a refusal, a duplicate and a result without a CRAFT_COLLECTED event', () => {
    const s = readyGear();
    expect(collectedItemIdOf({ ok: false, error: { code: 'INVALID_COMMAND', message: 'x' } })).toBeNull();
    expect(collectedItemIdOf({ ok: true, duplicate: true, state: s, events: [] })).toBeNull();
    const early = dispatchLike(s, { type: 'COLLECT_CRAFT', pipe: 0, jobId: s.crafting.pipes[0]!.id }, T0);
    expect(early.ok).toBe(false); // still crafting
    expect(collectedItemIdOf(early)).toBeNull();
  });

  it('returns the id of the piece the engine put in the inventory', () => {
    const s = readyGear();
    const at = T0 + 2 * HOUR;
    const job = craftJobView(s, 0)!;
    const res = dispatchLike(s, { type: 'COLLECT_CRAFT', pipe: 0, jobId: job.id }, at);
    expect(res.ok).toBe(true);
    const id = collectedItemIdOf(res, job.id);
    expect(id).toBe(collectedItemId(s, job.outputDefId));
    expect(res.ok && res.state.inventory.items.some((i) => i.id === id)).toBe(true);
    expect(collectedItemIdOf(res, job.id + 99)).toBeNull(); // another job's collect is not this one
  });

  it('still resolves when the serial moved between the screen and the collect (the old prediction missed)', () => {
    const shown = readyGear(); // what the screen held when Done was tapped
    const job = craftJobView(shown, 0)!;
    const predicted = collectedItemId(shown, job.outputDefId);
    const moved = cloneState(shown);
    moved.nextItemSerial += 2; // e.g. a boss gear drop in the simulated span
    const res = dispatchLike(moved, { type: 'COLLECT_CRAFT', pipe: 0, jobId: job.id }, T0 + 2 * HOUR);
    expect(res.ok).toBe(true);
    const actual = collectedItemIdOf(res, job.id)!;
    expect(actual).not.toBe(predicted);
    expect(res.ok && res.state.inventory.items.some((i) => i.id === predicted)).toBe(false); // the guess would show nothing
    expect(res.ok && res.state.inventory.items.find((i) => i.id === actual)?.defId).toBe(job.outputDefId);
    expect(getItemDef(job.outputDefId)).toBeTruthy();
  });
});
