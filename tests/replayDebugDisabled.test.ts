// A build with the debug tools switched off must still replay logs that contain DEBUG_* rows.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/engine/config/dev', () => ({ DEV_TOOLS_ENABLED: false }));

const { applyCommand, newGame, replayLog } = await import('../src/engine');
const { T0, HOUR } = await import('./helpers');

describe('replay with DEV_TOOLS_ENABLED = false', () => {
  it('live play rejects DEBUG_* commands', () => {
    const cmds = [
      { id: 'x', type: 'DEBUG_GRANT_HERO_XP', amount: 10 },
      { id: 'y', type: 'DEBUG_SPEND_STAMINA', amount: 10 },
      { id: 'z', type: 'DEBUG_REFILL_STAMINA' },
      { id: 'w', type: 'DEBUG_ADD_ATTRIBUTE', attribute: 'strength', amount: 1 },
      { id: 'v', type: 'DEBUG_SET_HERO_HP', hp: 1 },
      { id: 'u', type: 'DEBUG_FINISH_DUNGEON_RUN' },
      { id: 't', type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'rat_cellar', amount: 10 },
    ] as const;
    for (const c of cmds) {
      const res = applyCommand(newGame(1, T0), c, T0);
      expect(res).toEqual({ ok: false, error: expect.objectContaining({ code: 'DEBUG_DISABLED' }) });
    }
  });

  it('replay still accepts every DEBUG_* row type and flags the save', () => {
    const state = replayLog([
      { type: 'NEW_GAME', payload: { seed: 5 }, clientTime: T0 },
      { type: 'DEBUG_GRANT_HERO_XP', payload: { id: 'd1', type: 'DEBUG_GRANT_HERO_XP', amount: 10_000 }, clientTime: T0 },
      { type: 'DEBUG_SPEND_STAMINA', payload: { id: 'd2', type: 'DEBUG_SPEND_STAMINA', amount: 10 }, clientTime: T0 },
      { type: 'DEBUG_REFILL_STAMINA', payload: { id: 'd3', type: 'DEBUG_REFILL_STAMINA' }, clientTime: T0 },
      { type: 'DEBUG_ADD_ATTRIBUTE', payload: { id: 'd4', type: 'DEBUG_ADD_ATTRIBUTE', attribute: 'endurance', amount: 1 }, clientTime: T0 },
      { type: 'START_ACTIVITY', payload: { id: 'd5', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, clientTime: T0 },
      { type: 'DEBUG_SET_HERO_HP', payload: { id: 'd6', type: 'DEBUG_SET_HERO_HP', hp: 1 }, clientTime: T0 },
      { type: 'DEBUG_FINISH_DUNGEON_RUN', payload: { id: 'd7', type: 'DEBUG_FINISH_DUNGEON_RUN' }, clientTime: T0 },
      { type: 'DEBUG_ADD_DUNGEON_WINS', payload: { id: 'd8', type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'rat_cellar', amount: 10 }, clientTime: T0 },
      { type: 'DEBUG_CLOCK_OFFSET', payload: { deltaMs: HOUR, offsetMs: HOUR }, clientTime: T0 + HOUR },
      { type: 'RESUME', payload: {}, clientTime: T0 + HOUR },
      { type: 'DEBUG_RESET_SAVE', payload: {}, clientTime: T0 + HOUR },
      { type: 'NEW_GAME', payload: { seed: 6, reason: 'debug_reset', debugUsed: true }, clientTime: T0 + HOUR },
    ]);
    expect(state?.flags.debugUsed).toBe(true);
    expect(state?.character.level).toBe(1);
  });
});
