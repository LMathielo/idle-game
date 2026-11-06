// Pure state machine behind InfoPopover's item-switch crossfade (no React / RN imports, tests/popoverCrossfade.test.ts).
//
//   idle -switch-> fadingOut -outDone-> waitingMeasure -ready-> fadingIn -inDone-> idle
//                       |  ready: the new box was measured while the old one fades out (skips waitingMeasure)
//
// `hasPrev`: the old box (a snapshot of what was on screen) is still rendered. `ready`: the new box is measured (or its
// safety timeout fired). Reduce-motion: no fades; the old box is held until the new one is ready, then swapped at once.

import { FADE_IN_MS } from './popoverLayout';

export type Phase = 'idle' | 'fadingOut' | 'waitingMeasure' | 'fadingIn';

export type Crossfade = { phase: Phase; hasPrev: boolean; ready: boolean };

export type CrossfadeEvent =
  /** The anchor changed while the Modal stayed visible. `prevShown`: a box was on screen (measured / timed out). */
  | { t: 'switch'; prevShown: boolean; reduce: boolean }
  /** The current box was measured (or the safety timeout fired). */
  | { t: 'ready'; reduce: boolean }
  | { t: 'outDone' }
  | { t: 'inDone' };

export const IDLE: Crossfade = { phase: 'idle', hasPrev: false, ready: false };

export function crossfade(m: Crossfade, e: CrossfadeEvent): Crossfade {
  switch (e.t) {
    case 'switch':
      switch (m.phase) {
        case 'idle':
          if (!e.prevShown) return IDLE; // nothing was visible to fade: plain mount
          return e.reduce ? { phase: 'waitingMeasure', hasPrev: true, ready: false } : { phase: 'fadingOut', hasPrev: true, ready: false };
        case 'fadingIn': // the half-faded-in box becomes the one that fades out
          return { phase: 'fadingOut', hasPrev: true, ready: false };
        default: // fadingOut keeps fading the same old box; waitingMeasure keeps what it holds (nothing, or the held old box)
          return { ...m, ready: false };
      }
    case 'ready':
      if (m.phase === 'fadingOut') return { ...m, ready: true };
      if (m.phase === 'waitingMeasure') return e.reduce ? IDLE : { phase: 'fadingIn', hasPrev: false, ready: true };
      return m;
    case 'outDone':
      if (m.phase !== 'fadingOut') return m;
      return m.ready ? { phase: 'fadingIn', hasPrev: false, ready: true } : { phase: 'waitingMeasure', hasPrev: false, ready: false };
    case 'inDone':
      return m.phase === 'fadingIn' ? IDLE : m;
  }
}

/** Opacity of a box that has been fading in for `elapsedMs` (linear), used to start its fade-out from where it is. */
export function fadeInProgress(elapsedMs: number): number {
  return Math.max(0, Math.min(1, elapsedMs / FADE_IN_MS));
}
