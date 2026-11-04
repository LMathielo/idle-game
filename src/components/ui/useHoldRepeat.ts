// Hold-to-repeat for buttons (PixelButton `repeat`). A tap is one action. Holding: the first action fires when the
// press registers, then after HOLD_DELAY_MS (the hold confirms intent) it repeats every HOLD_INTERVAL_MS while held.
// Each action is awaited before the next one is scheduled, so commands never overlap. The repeat stops on release,
// when an action is rejected (it returns false or throws: no stamina, no gold), when the button turns disabled, or on
// unmount. Repeat ticks get `{ repeat: true }` so the screen can stay silent (no dialog per tick).
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

export const HOLD_DELAY_MS = 400;
export const HOLD_INTERVAL_MS = 100;
/**
 * Touch-down delay before a repeat button acts (Pressable `unstable_pressDelay`). A drag that starts on the button
 * becomes a scroll before this, so scrolling a list never fires a stamina skip. iOS scroll views wait ~150 ms too.
 * A quick tap still fires once (on release).
 */
export const PRESS_IN_DELAY_MS = 130;

/** Return false (or a promise of false) when the action was rejected: the repeat stops. */
export type RepeatAction = (info: { repeat: boolean }) => unknown;

export function useHoldRepeat(action: RepeatAction | undefined, enabled: boolean) {
  const actionRef = useRef(action);
  useLayoutEffect(() => {
    actionRef.current = action;
  });
  const holding = useRef(false);
  /** Set when this press already acted on press-in, so the onPress that follows the release doesn't act again. */
  const actedThisPress = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    holding.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const run = useCallback(async (repeat: boolean): Promise<boolean> => {
    const fn = actionRef.current;
    if (!fn) return false;
    try {
      return (await fn({ repeat })) !== false;
    } catch {
      return false;
    }
  }, []);

  const tick = useCallback(async () => {
    timer.current = null;
    if (!holding.current) return;
    const ok = await run(true);
    if (!holding.current) return;
    if (!ok) {
      stop();
      return;
    }
    timer.current = setTimeout(tick, HOLD_INTERVAL_MS);
  }, [run, stop]);

  const onPressIn = useCallback(() => {
    if (!enabled) return;
    stop();
    holding.current = true;
    actedThisPress.current = true;
    const startedAt = Date.now();
    void run(false).then((ok) => {
      if (!holding.current) return;
      if (!ok) {
        stop();
        return;
      }
      timer.current = setTimeout(tick, Math.max(0, HOLD_DELAY_MS - (Date.now() - startedAt)));
    });
  }, [enabled, run, stop, tick]);

  const onPressOut = useCallback(() => {
    stop();
    // On a normal release onPress follows synchronously: clear the flag after it.
    setTimeout(() => {
      actedThisPress.current = false;
    }, 0);
  }, [stop]);

  /** An accessibility activation (e.g. TalkBack) can arrive as onPress without onPressIn: act once. */
  const onPress = useCallback(() => {
    if (actedThisPress.current || !enabled) return;
    void run(false);
  }, [enabled, run]);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);
  useEffect(() => stop, [stop]);

  return { onPressIn, onPressOut, onPress };
}
