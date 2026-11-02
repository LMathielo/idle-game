// Stamina and attribute debug commands: they set flags.debugUsed, are logged, and replay exactly.
import { describe, expect, it } from 'vitest';
import type { MemoryGameRepository } from '../src/client/memoryRepository';
import { applyCommand, type GameState, getDerivedStats, hashState, newGame, replayLog, replayStep } from '../src/engine';
import { current, HOUR, makeClient, MIN, T0 } from './helpers';

async function verifyLog(repo: MemoryGameRepository): Promise<GameState> {
  const rows = await repo.getAllLog();
  let state: GameState | null = null;
  for (const row of rows) {
    state = replayStep(state, { type: row.type, payload: row.payload, clientTime: row.clientTime });
    expect({ seq: row.seq, type: row.type, hash: hashState(state) }).toEqual({ seq: row.seq, type: row.type, hash: row.stateHash });
  }
  return state!;
}

describe('debug: stamina and attributes', () => {
  it('each command sets flags.debugUsed', () => {
    const cmds = [
      { id: 'a', type: 'DEBUG_SPEND_STAMINA', amount: 10 },
      { id: 'b', type: 'DEBUG_REFILL_STAMINA' },
      { id: 'c', type: 'DEBUG_ADD_ATTRIBUTE', attribute: 'dexterity', amount: 1 },
    ] as const;
    for (const c of cmds) {
      const r = applyCommand(newGame(1, T0), c, T0);
      expect(r.ok && r.state.flags.debugUsed).toBe(true);
    }
  });

  it('rejected commands change nothing', () => {
    const s = newGame(1, T0);
    expect(applyCommand(s, { id: 'a', type: 'DEBUG_SPEND_STAMINA', amount: 101 }, T0)).toMatchObject({
      ok: false,
      error: { code: 'NOT_ENOUGH_STAMINA' },
    });
    expect(
      applyCommand(s, { id: 'b', type: 'DEBUG_ADD_ATTRIBUTE', attribute: 'agility' as never, amount: 1 }, T0),
    ).toMatchObject({ ok: false, error: { code: 'UNKNOWN_ATTRIBUTE' } });
    for (const amount of [0, -1, 1.5, 1001]) {
      expect(applyCommand(s, { id: 'c', type: 'DEBUG_ADD_ATTRIBUTE', attribute: 'strength', amount }, T0)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_AMOUNT' },
      });
    }
    expect(s.flags.debugUsed).toBe(false);
    expect(s.character.attributes.strength).toBe(0);
  });

  it('refill sets the bar full and clears the timer', () => {
    let s = applyCommand(newGame(1, T0), { id: 'a', type: 'DEBUG_SPEND_STAMINA', amount: 40 }, T0);
    if (!s.ok) throw new Error();
    const r = applyCommand(s.state, { id: 'b', type: 'DEBUG_REFILL_STAMINA' }, T0 + 7 * MIN);
    expect(r.ok && r.state.stamina).toEqual({ current: 100, max: 100, progressMs: 0 });
  });

  it('phone flow through the client: spend → countdown → +1 after 5 min → clock −2h pauses; log replays', async () => {
    const { repo, clock, client } = makeClient({ prefix: 'dbg' });
    await client.load();

    expect((await client.debug.addAttribute('strength')).ok).toBe(true);
    expect((await client.debug.addAttribute('endurance')).ok).toBe(true);
    const d = getDerivedStats(client.getState());
    expect([d.damage.min, d.damage.max, d.defense.value]).toEqual([13, 15, 14]);

    expect((await client.debug.spendStamina(10)).ok).toBe(true);
    expect(client.getState().stamina).toEqual({ current: 90, max: 100, progressMs: 0 });
    expect(client.getState().flags.debugUsed).toBe(true);

    clock.advance(5 * MIN);
    await client.tick();
    expect(client.getState().stamina.current).toBe(91);

    await client.debug.shiftClock(-2 * HOUR);
    clock.advance(30 * MIN);
    await client.tick();
    await client.resume();
    expect(client.getState().stamina).toEqual({ current: 91, max: 100, progressMs: 0 });

    const rejected = await client.debug.spendStamina(500);
    expect(rejected).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_STAMINA' } });

    expect((await client.debug.refillStamina()).ok).toBe(true);
    await client.debug.addAttribute('intelligence', 3);
    await client.persist();

    const types = (await repo.getAllLog()).map((r) => r.type);
    expect(types).toEqual(
      expect.arrayContaining(['DEBUG_ADD_ATTRIBUTE', 'DEBUG_SPEND_STAMINA', 'DEBUG_REFILL_STAMINA', 'DEBUG_CLOCK_OFFSET']),
    );
    const replayed = await verifyLog(repo);
    expect(hashState(replayed)).toBe(hashState(client.getState()));
    expect(replayed.character.attributes).toEqual({ strength: 1, dexterity: 0, endurance: 1, intelligence: 3 }); // extra normal points
    expect(replayed.stamina.current).toBe(100);
  });

  it('replayLog accepts the new debug rows', () => {
    const state = replayLog(current([
      { type: 'NEW_GAME', payload: { seed: 5 }, clientTime: T0 },
      { type: 'DEBUG_SPEND_STAMINA', payload: { id: 's', type: 'DEBUG_SPEND_STAMINA', amount: 30 }, clientTime: T0 + MIN },
      { type: 'DEBUG_ADD_ATTRIBUTE', payload: { id: 'a', type: 'DEBUG_ADD_ATTRIBUTE', attribute: 'strength', amount: 2 }, clientTime: T0 + MIN },
      { type: 'RESUME', payload: {}, clientTime: T0 + MIN + HOUR },
    ]));
    expect(state?.flags.debugUsed).toBe(true);
    expect(state?.character.attributes.strength).toBe(2);
    expect(state?.stamina).toEqual({ current: 82, max: 100, progressMs: 0 });
  });
});
