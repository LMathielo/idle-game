// A build with the debug tools switched off must still replay logs that contain DEBUG_* rows.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/engine/config/dev', () => ({ DEV_TOOLS_ENABLED: false }));

const { applyCommand, newGame, replayLog } = await import('../src/engine');
const { T0, HOUR } = await import('./helpers');

describe('replay with DEV_TOOLS_ENABLED = false', () => {
  it('live play rejects DEBUG_* commands', () => {
    const res = applyCommand(newGame(1, T0), { id: 'x', type: 'DEBUG_GRANT_HERO_XP', amount: 10 }, T0);
    expect(res).toEqual({ ok: false, error: expect.objectContaining({ code: 'DEBUG_DISABLED' }) });
  });

  it('replay still accepts every DEBUG_* row type and flags the save', () => {
    const state = replayLog([
      { type: 'NEW_GAME', payload: { seed: 5 }, clientTime: T0 },
      { type: 'DEBUG_GRANT_HERO_XP', payload: { id: 'd1', type: 'DEBUG_GRANT_HERO_XP', amount: 10_000 }, clientTime: T0 },
      { type: 'DEBUG_CLOCK_OFFSET', payload: { deltaMs: HOUR, offsetMs: HOUR }, clientTime: T0 + HOUR },
      { type: 'RESUME', payload: {}, clientTime: T0 + HOUR },
      { type: 'DEBUG_RESET_SAVE', payload: {}, clientTime: T0 + HOUR },
      { type: 'NEW_GAME', payload: { seed: 6, reason: 'debug_reset', debugUsed: true }, clientTime: T0 + HOUR },
    ]);
    expect(state?.flags.debugUsed).toBe(true);
    expect(state?.character.level).toBe(1);
  });
});
