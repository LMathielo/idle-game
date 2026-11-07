// Advances the game to `now`. The only place where time turns into rewards.
// Same code path for live ticks (1s) and offline catch-up (up to the cap).
import { type BeltClock, beltNextEventMs, beltPass, equippedBelt, walkWithBelt } from './belt';
import { advanceDungeon, dungeonNextEventMs } from './dungeon';
import { advanceMining } from './mining';
import { regenHeroPools } from './hp';
import { isBuilt } from './buildings';
import { regenMerchantCharges } from './merchant';
import { regenStamina } from './stamina';
import { advanceTraining } from './training';
import { advanceWoodcutting } from './woodcutting';
import { onUpgraded } from './upgradeEffects';
import { advanceWorld, heroNextEventMs } from './world';
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
 * Stamina, HP, mana and merchant refresh charges regenerate on the accepted elapsed time (rules b, c and e grant none), but NOT on the
 * capped time: their max already bounds them, so a long absence can fill both (docs/ENGINE.md).
 *
 * Gathering (woodcutting, mining), dungeon runs, boss fights and training share this path. Dungeon runs, boss fights and training level-ups interleave with
 * HP and mana regen in time order (advanceDungeon, advanceTraining); otherwise HP and mana simply regenerate over the whole
 * elapsed time. The builder (and the worker crews) run side by side with the hero's activity on the granted time,
 * in time order (advanceWorld, world.ts).
 *
 * **Potion Belt (1.27.0):** while a belt is worn the hero's steps are cut at every hero event and every potion cooldown end, HP regenerates
 * step by step (not once at the end), and the belt's drink pass runs at the start, after every cut and after every fight event (belt.ts).
 * A fight in progress when the offline cap falls is finished with the belt too; the rest of the forfeited time only regenerates.
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

  // The Potion Belt (1.27.0): `clock.at` is the engine time the walk is at (the walk starts at the last simulated time).
  const belt = equippedBelt(draft) !== null;
  const clock: BeltClock = { at: lastSimulatedAt };
  // What a command left behind (a belt just worn or filled, HP lowered) drinks at the start of the walk.
  if (belt) beltPass(draft, clock.at, summary);

  // Uncapped on purpose: requestedMs, not grantedMs. Same object when nothing changed.
  draft.stamina = regenStamina(state.stamina, requestedMs);
  // Merchant refresh charges follow the same rule: uncapped, bounded by their max. An unbuilt Merchant (1.18.0) banks nothing.
  draft.merchant = isBuilt(state, 'merchant') ? regenMerchantCharges(state.merchant, requestedMs) : state.merchant;

  // The hero's activity, one step of the world walk at a time. Dungeon runs and training interleave HP / mana regen with
  // their own events; gathering never touches them, so its regen is done once at the end ("plain" regen).
  let plainRegenMs = 0;
  const stepOnce = (ms: number) => {
    const a = draft.activity;
    if (a?.kind === 'dungeon' || a?.kind === 'boss') advanceDungeon(draft, a, ms, ms, summary, events, belt ? { clock } : undefined);
    else if (a?.kind === 'training') advanceTraining(draft, a, ms, ms, summary, events);
    else {
      if (a?.kind === 'woodcutting') advanceWoodcutting(draft, a, ms, summary, events);
      if (a?.kind === 'mining') advanceMining(draft, a, ms, summary, events);
      // With a belt worn HP must be current at every step (a drink reads it); without one it regenerates once at the end, as always.
      if (belt) regenHeroPools(draft, ms);
      else plainRegenMs += ms;
    }
  };
  const heroStep = (ms: number) => {
    if (!(ms > 0)) return;
    if (belt) walkWithBelt(draft, clock, ms, () => heroNextEventMs(draft), stepOnce, summary);
    else stepOnce(ms);
  };
  // Granted (capped) time: the hero's activity and the village (builder) side by side, in time order.
  advanceWorld(draft, grantedMs, heroStep, summary, events, onUpgraded);

  // Beyond the cap only a dungeon or boss fight in progress finishes (and HP and mana regenerate); see advanceDungeon.
  let beyondCapMs = requestedMs - grantedMs;
  if (belt) {
    // The fight that was in progress at the cap finishes with the belt, piece by piece (its events, and the cooldown ends inside it).
    let guard = 0;
    for (;;) {
      const a = draft.activity;
      const inFight = (a?.kind === 'boss' && a.fight) || (a?.kind === 'dungeon' && a.phase === 'fight' && a.fight);
      if (!(beyondCapMs > 0) || !inFight || (a?.kind !== 'boss' && a?.kind !== 'dungeon') || guard >= MAX_ACTIONS_PER_SIMULATION) break;
      const dt = Math.max(1, Math.min(beyondCapMs, dungeonNextEventMs(draft), beltNextEventMs(draft, clock.at)));
      clock.at += dt;
      advanceDungeon(draft, a, 0, dt, summary, events, { clock });
      beyondCapMs -= dt;
      guard += 1;
      beltPass(draft, clock.at, summary);
    }
  }
  if (draft.activity?.kind === 'dungeon' || draft.activity?.kind === 'boss') advanceDungeon(draft, draft.activity, 0, beyondCapMs, summary, events);
  else plainRegenMs += beyondCapMs;
  // HP and mana (1.17.0) together. Same object when nothing changed (both full).
  regenHeroPools(draft, plainRegenMs);

  return { state: draft, events, summary };
}
