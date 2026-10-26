// Read-only helpers for UIs (pure).
import { currentActionIntervalMs } from './activities';
import { ACTIVITIES } from './config/activities';
import { dungeonRunView, type DungeonRunView } from './dungeon';
import { attributeTrainingView, type AttributeTrainingView } from './training';
import type { GameState, GatheringKind } from './types';

export type GatheringView = {
  kind: GatheringKind;
  skillLevel: number;
  intervalMs: number;
  /** Progress of the current action, 0..1. */
  fraction: number;
  /** ms left until the next action completes. */
  remainingMs: number;
};

/** The attribute being trained (progress toward its next level). */
export type TrainingActivityView = AttributeTrainingView & { kind: 'training' };

export type ActivityView = GatheringView | DungeonRunView | TrainingActivityView;

export function activityView(state: GameState): ActivityView | null {
  const a = state.activity;
  if (!a) return null;
  if (a.kind === 'dungeon') return dungeonRunView(state);
  if (a.kind === 'training') return { kind: 'training', ...attributeTrainingView(state, a.attribute) };
  const intervalMs = currentActionIntervalMs(state, a.kind);
  const progress = Math.min(a.progressMs, intervalMs);
  return {
    kind: a.kind,
    skillLevel: state.character.skills[ACTIVITIES[a.kind].skill].level,
    intervalMs,
    fraction: intervalMs > 0 ? progress / intervalMs : 0,
    remainingMs: Math.max(0, intervalMs - progress),
  };
}

/** Total quantity of an item definition across the inventory. */
export function itemQuantity(state: GameState, defId: string): number {
  return state.inventory.items.filter((i) => i.defId === defId).reduce((n, i) => n + (i.quantity ?? 1), 0);
}
