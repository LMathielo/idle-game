// What an upgrade changes besides the building's level, applied when the builder finishes (pure).
import type { BuildingId, GameState } from './types';

/** Effects of reaching `level`. Bonuses read the level directly, so only stored state needs a change here. */
export function onUpgraded(_draft: GameState, _buildingId: BuildingId, _level: number): void {
  // Nothing stored changes yet.
}
