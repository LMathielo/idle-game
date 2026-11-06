import { describe, expect, it } from 'vitest';
import { type Crossfade, type CrossfadeEvent, IDLE, crossfade, fadeInProgress, liveTouchable } from '../src/components/ui/popoverCrossfade';
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

  it('nothing on screen to fade: measure, then fade the new box in (no old box)', () => {
    const m = crossfade(IDLE, { t: 'switch', prevShown: false, reduce: false });
    expect(m).toEqual({ phase: 'waitingMeasure', hasPrev: false, ready: false });
    expect(crossfade(IDLE, { t: 'switch', prevShown: false, reduce: true })).toEqual(IDLE);
  });

  it('open: measure, fade in, idle; reduce-motion: idle at once', () => {
    const m = crossfade(IDLE, { t: 'open', reduce: false });
    expect(m).toEqual({ phase: 'waitingMeasure', hasPrev: false, ready: false });
    expect(run([{ t: 'ready', reduce: false }, { t: 'inDone' }], m)).toEqual(IDLE);
    expect(crossfade(IDLE, { t: 'open', reduce: true })).toEqual(IDLE);
  });

  describe('close (dismiss)', () => {
    const closing = { phase: 'closing', hasPrev: true, ready: false };
    it('a shown box fades out, then the machine is idle (Modal hidden)', () => {
      expect(crossfade(IDLE, { t: 'close', shown: true, reduce: false })).toEqual(closing);
      expect(run([{ t: 'close', shown: true, reduce: false }, { t: 'outDone' }])).toEqual(IDLE);
    });
    it('nothing visible (not measured yet, or waiting): closes at once', () => {
      expect(crossfade(IDLE, { t: 'close', shown: false, reduce: false })).toEqual(IDLE);
      expect(crossfade(crossfade(IDLE, { t: 'open', reduce: false }), { t: 'close', shown: false, reduce: false })).toEqual(IDLE);
    });
    it('reduce-motion: closes at once from any phase', () => {
      for (const m of [IDLE, run([sw]), run([sw, { t: 'outDone' }, { t: 'ready', reduce: false }])]) {
        expect(crossfade(m, { t: 'close', shown: true, reduce: true })).toEqual(IDLE);
      }
    });
    it('during a switch fade-out the old box carries on fading; fading in: the half-visible box fades out', () => {
      expect(crossfade(run([sw, { t: 'ready', reduce: false }]), { t: 'close', shown: true, reduce: false })).toEqual(closing);
      expect(crossfade(run([sw, { t: 'outDone' }, { t: 'ready', reduce: false }]), { t: 'close', shown: true, reduce: false })).toEqual(closing);
    });
    it('during a switch wait (old box gone, new not shown) it closes at once', () => {
      expect(crossfade(run([sw, { t: 'outDone' }]), { t: 'close', shown: false, reduce: false })).toEqual(IDLE);
    });
    it('closing ignores ready / inDone / a second close, and never takes touches', () => {
      const m = crossfade(IDLE, { t: 'close', shown: true, reduce: false });
      expect(crossfade(m, { t: 'ready', reduce: false })).toEqual(m);
      expect(crossfade(m, { t: 'inDone' })).toEqual(m);
      expect(crossfade(m, { t: 'close', shown: true, reduce: false })).toEqual(m);
      expect(liveTouchable('closing', true)).toBe(false);
    });
    it('always settles to idle after outDone', () => {
      for (const from of [IDLE, run([sw]), run([sw, { t: 'ready', reduce: false }]), run([sw, { t: 'outDone' }, { t: 'ready', reduce: false }])]) {
        expect(run([{ t: 'close', shown: true, reduce: false }, { t: 'outDone' }], from).phase).toBe('idle');
      }
    });
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

  it('the new box takes touches only once visible', () => {
    expect(liveTouchable('fadingOut', true)).toBe(false);
    expect(liveTouchable('waitingMeasure', true)).toBe(false);
    expect(liveTouchable('fadingIn', true)).toBe(true);
    expect(liveTouchable('idle', false)).toBe(false);
    expect(liveTouchable('idle', true)).toBe(true);
  });
});
