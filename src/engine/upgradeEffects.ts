// What an upgrade changes besides the building's level, applied when the builder finishes (pure).
import { growStock } from './merchant';
import type { BuildingId, GameState } from './types';

/**
 * Effects of reaching `level`. Most bonuses are read from the level directly; only stored state changes here:
 * the Merchant fills its new stock slots at once.
 */
export function onUpgraded(draft: GameState, buildingId: BuildingId, _level: number): void {
  if (buildingId === 'merchant') growStock(draft);
}
