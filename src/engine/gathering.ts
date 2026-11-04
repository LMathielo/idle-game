// Gathering yield (pure, integer math). Shared by woodcutting, mining and the worker crews; every number they use
// lives in their own config. See docs/ENGINE.md ("Gathering yield").
//
//   yield (basis points) = floor(power × multiplierBp / requirement)        10 000 bp = 1 item
//   items per action     = whole part, plus 1 more with chance (fraction part / 10 000)   (one seeded draw, always)
//
// No floats decide an outcome: the fraction is compared with a whole roll in [0, 9 999].
import { BASIS_POINTS } from './config/stats';
import { nextInt } from './rng';
import type { RngState } from './types';

/** Expected items per action in basis points (10 000 = 1 item). 0 when power or the multiplier is not positive. */
export function yieldBp(power: number, requirement: number, multiplierBp: number): number {
  if (!(power > 0) || !(multiplierBp > 0)) return 0;
  const req = Math.max(1, requirement);
  return Math.floor((power * multiplierBp) / req);
}

/**
 * Items one completed action gives: the whole part of `bp` always, plus one more when a roll in [0, 9 999] lands
 * below the fraction part. Always consumes exactly one draw, so the RNG stream does not depend on the numbers.
 */
export function rollYield(rng: RngState, bp: number): { count: number; rng: RngState } {
  const whole = Math.floor(bp / BASIS_POINTS);
  const fraction = bp - whole * BASIS_POINTS;
  const roll = nextInt(rng, 0, BASIS_POINTS - 1);
  return { count: whole + (roll.value < fraction ? 1 : 0), rng: roll.rng };
}
