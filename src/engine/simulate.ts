// Advances the game to `now`. The only place where time turns into rewards.
// Same code path for live ticks (1s) and offline catch-up (up to the cap).
import { advanceDungeon } from './dungeon';
import { advanceMining } from './mining';
import { hpRegenPerMinute, maxHpOf, regenHp } from './hp';
import { regenMerchantCharges } from './merchant';
import { regenStamina } from './stamina';
import { advanceTraining } from './training';
import { advanceWoodcutting } from './woodcutting';
import { onUpgraded } from './upgradeEffects';
import { advanceWorld } from './world';
import { CLOCK_BACKWARD_TOLERANCE_MS } from './config/time';
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
 * Stamina, HP and merchant refresh charges regenerate on the accepted elapsed time (rules b, c and e grant none), but NOT on the
 * capped time: their max already bounds them, so a long absence can fill both (docs/ENGINE.md).
 *
 * Gathering (woodcutting, mining), dungeon runs and training share this path. Dungeon runs and training level-ups interleave with
 * HP regen in time order (advanceDungeon, advanceTraining); otherwise HP simply regenerates over the whole
 * elapsed time. The builder (and the worker crews) run side by side with the hero's activity on the granted time,
 * in time order (advanceWorld, world.ts).
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
  // Merchant refresh charges follow the same rule: uncapped, bounded by their max.
  draft.merchant = regenMerchantCharges(state.merchant, requestedMs);

  // The hero's activity, one step of the world walk at a time. Dungeon runs and training interleave HP regen with
  // their own events; gathering never touches HP, so its regen is done once at the end ("plain" regen).
  let plainRegenMs = 0;
  const heroStep = (ms: number) => {
    if (!(ms > 0)) return;
    const a = draft.activity;
    if (a?.kind === 'dungeon') advanceDungeon(draft, a, ms, ms, summary, events);
    else if (a?.kind === 'training') advanceTraining(draft, a, ms, ms, summary, events);
    else {
      if (a?.kind === 'woodcutting') advanceWoodcutting(draft, a, ms, summary, events);
      if (a?.kind === 'mining') advanceMining(draft, a, ms, summary, events);
      plainRegenMs += ms;
    }
  };
  // Granted (capped) time: the hero's activity and the village (builder) side by side, in time order.
  advanceWorld(draft, grantedMs, heroStep, summary, events, onUpgraded);

  // Beyond the cap only a dungeon fight in progress finishes (and HP regenerates); see advanceDungeon.
  const beyondCapMs = requestedMs - grantedMs;
  if (draft.activity?.kind === 'dungeon') advanceDungeon(draft, draft.activity, 0, beyondCapMs, summary, events);
  else plainRegenMs += beyondCapMs;
  // Same object when nothing changed (full HP).
  if (plainRegenMs > 0) draft.character = regenHp(draft.character, maxHpOf(draft), hpRegenPerMinute(draft), plainRegenMs);

  return { state: draft, events, summary };
}
