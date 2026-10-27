// Contrast of item quality colors on the panels they appear on (WCAG AA: ≥ 4.5:1 for text).
import { describe, expect, it } from 'vitest';
import { ITEM_QUALITIES } from '../src/engine';
import { colors, qualityColors } from '../src/theme';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('quality colors', () => {
  it('cover every quality and pass 4.5:1 on the item sheet and slot backgrounds', () => {
    expect(Object.keys(qualityColors).sort()).toEqual([...ITEM_QUALITIES].sort());
    for (const q of ITEM_QUALITIES) {
      expect(contrast(qualityColors[q], colors.sheet)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(qualityColors[q], colors.slot)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(qualityColors[q], colors.night)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
