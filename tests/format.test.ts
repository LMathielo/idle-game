// Display formatting used by the "While you were away" modal.
import { describe, expect, it } from 'vitest';
import { formatAwayDuration } from '../src/components/format';

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
