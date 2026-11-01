// Display formatting used by the "While you were away" modal and the building modals.
import { describe, expect, it } from 'vitest';
import { currentBonusLine } from '../src/components/buildings/bonusText';
import { formatAwayDuration, formatBonusBp, formatBp, formatCountdown, formatPercentBp, formatPerMin } from '../src/components/format';
import { BUILDINGS } from '../src/engine';

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

describe('building bonus lines (UI rule 2026-11-01: current level under every building modal header)', () => {
  it('formatPercentBp: up to 2 decimals, no trailing zeros', () => {
    expect([1900, 2710, 3439, 833, 1000, 10_000].map(formatPercentBp)).toEqual(['19%', '27.1%', '34.39%', '8.33%', '10%', '100%']);
  });
  it('Crafting: craft time as a reduction, yield from Lv4; Lv1 has no bonus yet', () => {
    expect(BUILDINGS.crafting.levels.map((b, i) => currentBonusLine(i + 1, b))).toEqual([
      'Lv1 · no bonus yet',
      'Lv2 · −10% craft time',
      'Lv3 · −19% craft time',
      'Lv4 · −27.1% craft time · +10% crafted yield',
      'Lv5 · −34.39% craft time · +20% crafted yield',
    ]);
  });
  it('every building: Lv2 woodcutting, Lv1 merchant / town hall / training grounds', () => {
    expect(currentBonusLine(2, BUILDINGS.woodcutting.levels[1])).toBe('Lv2 · +20% log yield');
    expect(currentBonusLine(1, BUILDINGS.woodcutting.levels[0])).toBe('Lv1 · no bonus yet');
    expect(currentBonusLine(1, BUILDINGS.merchant.levels[0])).toBe('Lv1 · 5 stock slots');
    expect(currentBonusLine(1, BUILDINGS.town_hall.levels[0])).toBe('Lv1 · 5 worker slots');
    expect(currentBonusLine(1, BUILDINGS.training_grounds.levels[0])).toBe('Lv1 · 1 training XP per minute');
  });
});
