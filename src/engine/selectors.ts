// Read-only helpers for UIs (pure).
import { bossRunView, type BossRunView } from './boss';
import { dungeonRunView, type DungeonRunView } from './dungeon';
import { mineActivityView, type MineActivityView } from './mining';
import { countItem } from './stock';
import { attributeTrainingView, type AttributeTrainingView } from './training';
import type { GameState } from './types';
import { woodcutActivityView, type WoodcutActivityView } from './woodcutting';

/** The log being cut (woodcutting) or the ore being mined (mining). */
export type GatheringView = WoodcutActivityView | MineActivityView;

/** The attribute being trained (progress toward its next level). */
export type TrainingActivityView = AttributeTrainingView & { kind: 'training' };

export type ActivityView = GatheringView | DungeonRunView | BossRunView | TrainingActivityView;

export function activityView(state: GameState): ActivityView | null {
  const a = state.activity;
  if (!a) return null;
  if (a.kind === 'dungeon') return dungeonRunView(state);
  if (a.kind === 'boss') return bossRunView(state);
  if (a.kind === 'training') return { kind: 'training', ...attributeTrainingView(state, a.attribute) };
  if (a.kind === 'mining') return mineActivityView(state);
  return woodcutActivityView(state);
}

/** Total quantity of an item definition the hero can pay with: the storage and the bag together (1.29.0; stock.ts). */
export function itemQuantity(state: GameState, defId: string): number {
  return countItem(state, defId);
}
