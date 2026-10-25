import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = join(__dirname, '..', 'src', 'engine');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|jsx)$/.test(name) ? [p] : [];
  });
}

const FORBIDDEN_MODULE = /^(react|react-native|expo|@expo\/|expo-|@react-native)/;
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm;

describe('engine purity guard', () => {
  const files = walk(ENGINE_DIR);

  it('finds the engine sources', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((f) => [relative(ENGINE_DIR, f), f]))('%s imports nothing from react/react-native/expo*', (_name, file) => {
    const src = readFileSync(file, 'utf8');
    const bad: string[] = [];
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (spec && (FORBIDDEN_MODULE.test(spec) || !spec.startsWith('.'))) bad.push(spec);
    }
    expect(bad).toEqual([]);
  });

  it.each(files.map((f) => [relative(ENGINE_DIR, f), f]))('%s does not read the clock or Math.random', (_name, file) => {
    const src = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/Date\.now|new Date\(|Math\.random|performance\.now/);
  });

  // Not correctly rounded in IEEE 754: results may differ between Hermes (phone) and V8 (server).
  it.each(files.map((f) => [relative(ENGINE_DIR, f), f]))('%s avoids runtime-dependent Math functions', (_name, file) => {
    const src = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/Math\.(pow|exp|expm1|log|log2|log10|log1p|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|cbrt|hypot)\b|\*\*/);
  });
});
