// Owner decision (2026-11-04): no emoji in any text the player sees. Symbols are pixel-art images next to the text
// (src/components/art). Allowed: engine/migrations.ts (it describes legacy saves) and the engine config `icon` fields
// (unused by the UI; tech debt, docs/TECH_DEBT.md). Plain ✕ ✓ ✗ are text, not emoji.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}]/u;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|jsx)$/.test(name) ? [p] : [];
  });
}

/** An engine config line that only sets an `icon` (a field, or the icon argument of an item helper). */
const CONFIG_ICON = /\bicon\s*:\s*'[^']*'|^\s*\w+:\s*(?:crafted|ore|junk)\('\w+',\s*'[^']*',\s*'[^']*'/;

describe('no emoji in src', () => {
  it('finds the sources', () => {
    expect(walk(SRC).length).toBeGreaterThan(20);
  });

  it('only engine/migrations.ts and engine config icon fields hold emoji', () => {
    const found: string[] = [];
    for (const file of walk(SRC)) {
      const name = relative(SRC, file).split('\\').join('/');
      if (name === 'engine/migrations.ts') continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!EMOJI.test(line)) return;
          if (name.startsWith('engine/config/') && CONFIG_ICON.test(line) && !EMOJI.test(line.replace(new RegExp(CONFIG_ICON.source, 'g'), ''))) return;
          found.push(`${name}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(found).toEqual([]);
  });
});
