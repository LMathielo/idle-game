// Read-only helpers for UIs (pure).
import { dungeonRunView, type DungeonRunView } from './dungeon';
import { attributeTrainingView, type AttributeTrainingView } from './training';
import type { GameState } from './types';
import { woodcutActivityView, type WoodcutActivityView } from './woodcutting';

/** The log being cut (woodcutting). */
export type GatheringView = WoodcutActivityView;

/** The attribute being trained (progress toward its next level). */
export type TrainingActivityView = AttributeTrainingView & { kind: 'training' };

export type ActivityView = GatheringView | DungeonRunView | TrainingActivityView;

export function activityView(state: GameState): ActivityView | null {
  const a = state.activity;
  if (!a) return null;
  if (a.kind === 'dungeon') return dungeonRunView(state);
  if (a.kind === 'training') return { kind: 'training', ...attributeTrainingView(state, a.attribute) };
  return woodcutActivityView(state);
}

/** Total quantity of an item definition across the inventory. */
export function itemQuantity(state: GameState, defId: string): number {
  return state.inventory.items.filter((i) => i.defId === defId).reduce((n, i) => n + (i.quantity ?? 1), 0);
}
