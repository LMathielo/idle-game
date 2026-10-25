// Read-only helpers for UIs (pure).
import { currentActionIntervalMs } from './activities';
import { ACTIVITIES } from './config/activities';
import type { ActivityKind, GameState } from './types';

export type ActivityView = {
  kind: ActivityKind;
  skillLevel: number;
  intervalMs: number;
  /** Progress of the current action, 0..1. */
  fraction: number;
  /** ms left until the next action completes. */
  remainingMs: number;
};

export function activityView(state: GameState): ActivityView | null {
  const a = state.activity;
  if (!a) return null;
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

export function itemQuantity(state: GameState, itemId: string): number {
  return state.inventory.items.filter((i) => i.id === itemId).reduce((n, i) => n + (i.quantity ?? 1), 0);
}
