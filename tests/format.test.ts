// Display formatting used by the "While you were away" modal.
import { describe, expect, it } from 'vitest';
import { formatAwayDuration, formatBonusBp, formatBp, formatCountdown, formatPerMin } from '../src/components/format';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('formatAwayDuration', () => {
  it('shows hours and minutes, dropping seconds', () => {
    expect(formatAwayDuration(9 * HOUR + 12 * MIN + 59_000)).toBe('9h 12m');
    expect(formatAwayDuration(8 * HOUR)).toBe('8h');
    expect(formatAwayDuration(30 * HOUR + 5 * MIN)).toBe('30h 5m');
  });

  it('shows minutes only under an hour, seconds only under a minute', () => {
    expect(formatAwayDuration(35 * MIN + 40_000)).toBe('35m');
    expect(formatAwayDuration(40_000)).toBe('40s');
    expect(formatAwayDuration(-5)).toBe('0s');
  });
});

describe('1.10.0 helpers', () => {
  it('formatCountdown: m:ss under an hour, h:mm:ss above', () => {
    expect(formatCountdown(42_000)).toBe('0:42');
    expect(formatCountdown(12 * 60_000 + 34_000)).toBe('12:34');
    expect(formatCountdown(24 * 3_600_000 - 1000)).toBe('23:59:59');
  });
  it('formatBp / formatBonusBp / formatPerMin', () => {
    expect(formatBp(10_500)).toBe('1.05');
    expect(formatBp(21_000)).toBe('2.10');
    expect(formatBp(2625)).toBe('0.26');
    expect(formatBonusBp(2000)).toBe('+20%');
    expect(formatPerMin(0.13125)).toBe('0.13');
    expect(formatPerMin(1.6)).toBe('1.6');
    expect(formatPerMin(0)).toBe('0');
  });
});
