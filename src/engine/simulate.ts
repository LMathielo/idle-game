// Advances the game to `now`. The only place where time turns into rewards.
// Same code path for live ticks (1s) and offline catch-up (up to the cap).
import { currentActionIntervalMs, performAction } from './activities';
import { cloneState } from './clone';
import { advanceDungeon } from './dungeon';
import { hpRegenPerMinute, maxHpOf, regenHp } from './hp';
import { regenStamina } from './stamina';
import { CLOCK_BACKWARD_TOLERANCE_MS, MAX_ACTIONS_PER_SIMULATION } from './config/time';
import { emptySummary } from './summary';
import type { GameEvent, GameState, SimulationSummary } from './types';

export type SimulationResult = { state: GameState; events: GameEvent[]; summary: SimulationSummary };

/**
 * Time rules (docs/ENGINE.md):
 *  a. elapsed = now − lastSimulatedAt
 *  b. now < highestSeenAt − tolerance → clock moved back: grant 0, move nothing, CLOCK_ANOMALY 'backward'.
 *     Progress stays paused until real time passes highestSeenAt again.
 *  c. backward jitter within tolerance → 0 elapsed, no anomaly.
 *  d. elapsed > offline.capMs → grant exactly the cap, CLOCK_ANOMALY 'forward_capped', lastSimulatedAt = now.
 *  e. non-finite now → no-op + ERROR event.
 *  f. highestSeenAt = max(highestSeenAt, now) whenever now is accepted.
 *
 * Stamina and HP regenerate on the accepted elapsed time (rules b, c and e grant none), but NOT on the
 * capped time: their max already bounds them, so a long absence can fill both (docs/ENGINE.md).
 *
 * Gathering and dungeon runs share this path. Dungeon runs interleave with HP regen in time order
 * (advanceDungeon); otherwise HP simply regenerates over the whole elapsed time.
 */
export function simulate(state: GameState, now: number): SimulationResult {
  const summary = emptySummary();
  const events: GameEvent[] = [];

  // e. Garbage time never touches the state.
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    events.push({ type: 'ERROR', code: 'INVALID_TIME', message: `simulate: non-finite time ${String(now)}` });
    return { state, events, summary };
  }

  const { lastSimulatedAt, highestSeenAt } = state.time;

  // b + c. Anything before the highest accepted time grants nothing and moves nothing.
  if (now < highestSeenAt) {
    const deltaMs = highestSeenAt - now;
    if (deltaMs > CLOCK_BACKWARD_TOLERANCE_MS) {
      const anomaly = { type: 'CLOCK_ANOMALY', kind: 'backward', deltaMs } as const;
      events.push(anomaly);
      summary.anomalies.push(anomaly);
    }
    return { state, events, summary };
  }

  // a. now >= highestSeenAt >= lastSimulatedAt, so elapsed >= 0.
  const requestedMs = now - lastSimulatedAt;
  if (requestedMs === 0 && now === highestSeenAt) return { state, events, summary }; // nothing to do
  let grantedMs = requestedMs;

  // d. Cap: the excess is forfeited, never banked.
  if (requestedMs > state.offline.capMs) {
    grantedMs = state.offline.capMs;
    const anomaly = { type: 'CLOCK_ANOMALY', kind: 'forward_capped', requestedMs, grantedMs } as const;
    events.push(anomaly);
    summary.anomalies.push(anomaly);
  }
  summary.requestedMs = requestedMs;
  summary.grantedMs = grantedMs;

  // Structural sharing: parts no action touches keep their identity, so UIs can skip re-renders.
  const draft: GameState = {
    ...state,
    time: { lastSimulatedAt: now, highestSeenAt: Math.max(highestSeenAt, now) }, // f.
    activity: state.activity ? { ...state.activity } : null,
  };

  // Uncapped on purpose: requestedMs, not grantedMs. Same object when nothing changed.
  draft.stamina = regenStamina(state.stamina, requestedMs);

  const activity = draft.activity;
  if (activity?.kind === 'dungeon') {
    advanceDungeon(draft, activity, grantedMs, requestedMs, summary, events);
    return { state: draft, events, summary };
  }

  if (activity && grantedMs > 0) {
    const kind = activity.kind;
    activity.progressMs += grantedMs * draft.offline.efficiency;
    let interval = currentActionIntervalMs(draft, kind);
    let cloned = false;
    let guard = 0;
    // One action at a time so a level-up shortens the next interval immediately.
    while (activity.progressMs >= interval && guard < MAX_ACTIONS_PER_SIMULATION) {
      if (!cloned) {
        // Actions mutate these: copy them once, never touch the caller's objects.
        draft.rng = { ...state.rng };
        draft.stats = cloneState(state.stats);
        // Actions change hero level/xp and skills only; attributes and equipment keep their identity.
        draft.character = { ...state.character, skills: cloneState(state.character.skills) };
        draft.inventory = cloneState(state.inventory);
        cloned = true;
      }
      activity.progressMs -= interval;
      performAction(draft, kind, summary, events);
      interval = currentActionIntervalMs(draft, kind);
      guard += 1;
    }
  }

  // Gathering never touches HP, so regen over the whole (uncapped) time is the same in any order.
  // Same object when nothing changed (full HP).
  draft.character = regenHp(draft.character, maxHpOf(draft), hpRegenPerMinute(draft.character.attributes), requestedMs);

  return { state: draft, events, summary };
}
