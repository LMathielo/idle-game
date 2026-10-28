// Passive bonuses (pure). Every gathering yield is multiplied by yieldMultiplierBp(); see docs/ENGINE.md.
import { BASIS_POINTS } from './config/stats';
import type { GameState, GatheringKind } from './types';

/** Yield multiplier for a gathering skill, in basis points (10 000 = ×1). Applies to the hero and to workers. */
export function yieldMultiplierBp(_state: Pick<GameState, 'buildings'>, _kind: GatheringKind): number {
  return BASIS_POINTS;
}
