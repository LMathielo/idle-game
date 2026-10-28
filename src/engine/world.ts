// The world walk (pure): runs the hero's activity side by side with the village's own timers (the builder, and
// the worker crews) over the granted time, in time order. See docs/ENGINE.md ("The world walk").
//
// The granted time is cut into steps that end at the next village event (an upgrade completing, ...). Inside a step
// nothing in the village changes, so the hero's activity just advances by the step (every activity is already
// split-invariant: many small advances = one big one). At the end of a step, in this order at the same instant:
//   1. the hero's events due at that instant (a log cut, a fight ending with its gold, a training level),
//   2. the builder (an upgrade completing),
// so the result does not depend on where simulate() calls are split. Without anything in the village the walk is a
// single step: exactly the hero's activity over the whole granted time.
import { advanceConstruction, constructionRemainingMs, type UpgradeEffect } from './buildings';
import { MAX_ACTIONS_PER_SIMULATION } from './config/time';
import type { GameEvent, GameState, SimulationSummary } from './types';

/** Advances the hero's activity by exactly `ms` of granted time (one step of the walk). */
export type HeroStep = (ms: number) => void;

/** True when the village has its own timers to walk (else the hero's activity runs alone). */
export function villageIsBusy(state: Pick<GameState, 'construction'>): boolean {
  return state.construction !== null;
}

/**
 * Walks `grantedMs` of granted (capped) time. `draft` comes from simulate(): sub-objects may still be shared with
 * the input state, so the parts the village touches are copied once before the first step.
 */
export function advanceWorld(
  draft: GameState,
  grantedMs: number,
  heroStep: HeroStep,
  summary: SimulationSummary,
  events: GameEvent[],
  onUpgraded?: UpgradeEffect,
): void {
  if (!villageIsBusy(draft)) {
    heroStep(grantedMs);
    return;
  }
  let left = grantedMs;
  let guard = 0;
  while (left > 0 && guard < MAX_ACTIONS_PER_SIMULATION) {
    let dt = left;
    const build = constructionRemainingMs(draft);
    if (build !== null) dt = Math.min(dt, build);
    heroStep(dt);
    advanceConstruction(draft, dt, events, summary, onUpgraded);
    left -= dt;
    guard += 1;
    if (!villageIsBusy(draft)) {
      heroStep(left);
      return;
    }
  }
}
