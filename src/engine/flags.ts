import type { GameState } from './types';

/** Marks the save as touched by a DEBUG_* command. Permanent: nothing ever clears it. Pure. */
export function markDebugUsed(state: GameState): GameState {
  if (state.flags.debugUsed) return state;
  return { ...state, flags: { ...state.flags, debugUsed: true } };
}
