import { describe, expect, it } from 'vitest';
import { type Crossfade, type CrossfadeEvent, IDLE, crossfade, fadeInProgress } from '../src/components/ui/popoverCrossfade';
import { FADE_IN_MS } from '../src/components/ui/popoverLayout';

const run = (events: CrossfadeEvent[], from: Crossfade = IDLE) => events.reduce(crossfade, from);
const sw: CrossfadeEvent = { t: 'switch', prevShown: true, reduce: false };
const swReduce: CrossfadeEvent = { t: 'switch', prevShown: true, reduce: true };

describe('popover crossfade', () => {
  it('switch: idle -> fadingOut -> waitingMeasure -> fadingIn -> idle', () => {
    let m = crossfade(IDLE, sw);
    expect(m).toEqual({ phase: 'fadingOut', hasPrev: true, ready: false });
    m = crossfade(m, { t: 'outDone' });
    expect(m).toEqual({ phase: 'waitingMeasure', hasPrev: false, ready: false });
    m = crossfade(m, { t: 'ready', reduce: false });
    expect(m).toEqual({ phase: 'fadingIn', hasPrev: false, ready: true });
    expect(crossfade(m, { t: 'inDone' })).toEqual(IDLE);
  });

  it('measured during the fade-out: fade-in starts right after it', () => {
    const m = run([sw, { t: 'ready', reduce: false }]);
    expect(m).toEqual({ phase: 'fadingOut', hasPrev: true, ready: true });
    expect(crossfade(m, { t: 'outDone' })).toEqual({ phase: 'fadingIn', hasPrev: false, ready: true });
  });

  it('nothing on screen to fade: stays idle (plain mount)', () => {
    expect(crossfade(IDLE, { t: 'switch', prevShown: false, reduce: false })).toEqual(IDLE);
  });

  it('A -> B -> C during the fade-out settles on the last: old box kept, ready reset', () => {
    const m = run([sw, { t: 'ready', reduce: false }, sw]);
    expect(m).toEqual({ phase: 'fadingOut', hasPrev: true, ready: false });
    expect(run([{ t: 'outDone' }, { t: 'ready', reduce: false }, { t: 'inDone' }], m)).toEqual(IDLE);
  });

  it('switch while waiting: nothing to fade, still waiting for the newest box', () => {
    const m = run([sw, { t: 'outDone' }, sw]);
    expect(m).toEqual({ phase: 'waitingMeasure', hasPrev: false, ready: false });
  });

  it('switch while fading in: the half-visible box fades out', () => {
    const m = run([sw, { t: 'outDone' }, { t: 'ready', reduce: false }, sw]);
    expect(m).toEqual({ phase: 'fadingOut', hasPrev: true, ready: false });
  });

  it('ignores stale events', () => {
    expect(crossfade(IDLE, { t: 'outDone' })).toEqual(IDLE);
    expect(crossfade(IDLE, { t: 'inDone' })).toEqual(IDLE);
    expect(crossfade(IDLE, { t: 'ready', reduce: false })).toEqual(IDLE);
    const fadingIn = run([sw, { t: 'outDone' }, { t: 'ready', reduce: false }]);
    expect(crossfade(fadingIn, { t: 'outDone' })).toEqual(fadingIn);
  });

  it('every event order ends idle once outDone / ready / inDone have all fired (never stuck)', () => {
    const settle: CrossfadeEvent[] = [{ t: 'ready', reduce: false }, { t: 'outDone' }, { t: 'inDone' }, { t: 'ready', reduce: false }, { t: 'inDone' }];
    for (const seq of [[sw], [sw, sw], [sw, sw, sw], [sw, { t: 'outDone' } as const, sw], [sw, { t: 'outDone' } as const, { t: 'ready', reduce: false } as const, sw, sw]] as CrossfadeEvent[][]) {
      expect(run([...seq, ...settle]).phase).toBe('idle');
    }
  });

  describe('reduce-motion', () => {
    it('holds the old box until the new one is ready, then swaps instantly', () => {
      let m = crossfade(IDLE, swReduce);
      expect(m).toEqual({ phase: 'waitingMeasure', hasPrev: true, ready: false });
      m = crossfade(m, swReduce);
      expect(m).toEqual({ phase: 'waitingMeasure', hasPrev: true, ready: false });
      expect(crossfade(m, { t: 'ready', reduce: true })).toEqual(IDLE);
    });
  });

  it('fadeInProgress is linear and clamped', () => {
    expect(fadeInProgress(-5)).toBe(0);
    expect(fadeInProgress(FADE_IN_MS / 2)).toBe(0.5);
    expect(fadeInProgress(FADE_IN_MS * 3)).toBe(1);
  });
});
