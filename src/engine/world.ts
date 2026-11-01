// The world walk (pure): runs the hero's activity side by side with the village's own timers (the builder, the
// worker crews and the Crafting house's pipes) over the granted time, in time order. See docs/ENGINE.md ("The world walk").
//
// The granted time is cut into steps that end at the next village event: an upgrade completing, a crew action
// completing, the paid upkeep minute running out, a craft finishing in a pipe, and (while a crew is idle or the workers are paused) the hero's
// next event, since that can make a node workable again or bring gold. Inside a step nothing in the village changes,
// so the hero's activity just advances by the step (every activity is already split-invariant: many small advances
// = one big one). At the same instant, in this order:
//   1. the hero's events due at that instant (a log cut, a fight ending with its gold, a training level),
//   2. the builder (an upgrade completing, so its bonus counts for the crews right after),
//   3. the crews' actions due at that instant (in WORKER_NODE_IDS order),
//   4. the pipes' crafts due at that instant (in pipe order): each delivers (or holds while the inventory is full) and
//      the next craft starts with a duration read right then (house level and INT after 1–2),
//   5. at the start of the next step: idle flags and upkeep (settleWorkers: a new minute is charged, or the crews
//      pause / resume on gold), then held pipes deliver if their output fits now (settleCrafting).
// So the result does not depend on where simulate() calls are split. Without anything in the village the walk is a
// single step: exactly the hero's activity over the whole granted time.
import { advanceConstruction, constructionRemainingMs, type UpgradeEffect } from './buildings';
import { cloneState } from './clone';
import { advancePipes, anyPipeRunning, pipesNextEventMs, settleCrafting } from './crafting';
import { MAX_ACTIONS_PER_SIMULATION } from './config/time';
import { dungeonNextEventMs } from './dungeon';
import { miningNextEventMs } from './mining';
import { trainingNextEventMs } from './training';
import type { GameEvent, GameState, SimulationSummary } from './types';
import { woodcuttingNextEventMs } from './woodcutting';
import { advanceCrews, crewsNextEventMs, settleWorkers } from './workers';

/** Advances the hero's activity by exactly `ms` of granted time (one step of the walk). */
export type HeroStep = (ms: number) => void;

/** True when the village has its own timers to walk (else the hero's activity runs alone). */
export function villageIsBusy(state: Pick<GameState, 'construction' | 'workers' | 'crafting'>): boolean {
  return state.construction !== null || anyCrew(state) || anyPipeRunning(state);
}

function anyCrew(state: Pick<GameState, 'workers'>): boolean {
  for (const k in state.workers.crews) if (state.workers.crews[k as keyof typeof state.workers.crews]) return true;
  return false;
}

/** Wall ms to the hero's next event (never below 1, so a step always moves time), Infinity without an activity. */
export function heroNextEventMs(state: GameState): number {
  const a = state.activity;
  if (!a) return Number.POSITIVE_INFINITY;
  const ms =
    a.kind === 'dungeon'
      ? dungeonNextEventMs(state)
      : a.kind === 'training'
        ? trainingNextEventMs(state)
        : a.kind === 'mining'
          ? miningNextEventMs(state)
          : woodcuttingNextEventMs(state);
  return Math.max(1, ms);
}

/** A crew is waiting on the hero (idle) or the workforce on gold (paused): the hero's events matter to the village. */
function waitingOnHero(state: GameState): boolean {
  if (state.workers.paused) return true;
  for (const k in state.workers.crews) if (state.workers.crews[k as keyof typeof state.workers.crews]?.idle) return true;
  return false;
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
  // The village mutates these in place: copy them once (simulate() shares sub-objects with its input).
  draft.workers = cloneState(draft.workers);
  draft.character = { ...draft.character };
  draft.inventory = cloneState(draft.inventory);
  draft.rng = { ...draft.rng };
  draft.crafting = cloneState(draft.crafting);
  let left = grantedMs;
  let guard = 0;
  while (left > 0 && guard < MAX_ACTIONS_PER_SIMULATION) {
    settleWorkers(draft, events, summary);
    settleCrafting(draft, events, summary);
    let dt = left;
    const build = constructionRemainingMs(draft);
    if (build !== null) dt = Math.min(dt, build);
    dt = Math.min(dt, crewsNextEventMs(draft));
    dt = Math.min(dt, pipesNextEventMs(draft));
    if (waitingOnHero(draft)) dt = Math.min(dt, heroNextEventMs(draft));
    heroStep(dt);
    advanceConstruction(draft, dt, events, summary, onUpgraded);
    advanceCrews(draft, dt, summary);
    advancePipes(draft, dt, events, summary);
    left -= dt;
    guard += 1;
    if (!villageIsBusy(draft)) {
      heroStep(left);
      return;
    }
  }
}
