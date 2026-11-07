// Worklets run on the UI runtime, compiled by the Reanimated / Worklets Babel plugin (babel-preset-expo adds it). Vitest runs the source
// as plain TypeScript, so a worklet bug that exists only in the compiled UI-runtime copy passes every other test and then kills the app on
// the phone. This happened to the Potion Belt drag (PR #44; the drop-target worklet now lives in the shared drag kit, ui/drag/dropTargets.ts): `slotAt(rects, x, y, slop = DROP_SLOP)` compiles to
//   function slotAt(rects, x, y, slop = DROP_SLOP) { const [DROP_SLOP] = this.__closure; ... }
// where the default is read BEFORE the closure is destructured: "Property 'DROP_SLOP' doesn't exist", thrown on the UI runtime on the
// first onUpdate of the drag (fatal in Expo Go). So here every worklet in src/ is compiled with the real plugin and:
//   1. no parameter default may read a closure variable (static scan of all the compiled worklets), and
//   2. the shared drag kit's drop-target worklet is run the way the UI runtime runs it (init-data code + `this.__closure`).
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { slotAt as slotAtSource } from '../src/components/ui/drag/dropTargets';

const ROOT = join(__dirname, '..');
const req = createRequire(join(ROOT, 'package.json'));
const presetPath = req.resolve('babel-preset-expo', { paths: [dirname(req.resolve('expo/package.json'))] });
const fromPreset = createRequire(presetPath);
const babel = fromPreset('@babel/core') as { transformSync: (code: string, opts: Record<string, unknown>) => { code: string } };
const parser = fromPreset('@babel/parser') as { parseExpression: (code: string) => AstNode };

type AstNode = { type: string; [key: string]: unknown };

/** Compiles `code` (TypeScript) like Metro does for iOS in dev: the worklet plugin included. CommonJS out. */
function compile(code: string, filename: string): string {
  const out = babel.transformSync(code, {
    cwd: ROOT,
    root: ROOT,
    filename,
    presets: [presetPath],
    babelrc: false,
    configFile: false,
    caller: { name: 'metro', platform: 'ios', bundler: 'metro', isDev: true, supportsStaticESM: false, engine: 'hermes' },
  });
  return out.code;
}

/** The UI-runtime source of every worklet in compiled code (the plugin's init-data `code` strings). */
function workletSources(compiled: string): string[] {
  const out: string[] = [];
  for (const m of compiled.matchAll(/code:("(?:[^"\\]|\\.)*"),location/g)) out.push(JSON.parse(m[1]) as string);
  return out;
}

function identifiersIn(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) identifiersIn(n, into);
  } else if (node && typeof node === 'object') {
    const n = node as AstNode;
    if (n.type === 'Identifier' && typeof n.name === 'string') into.add(n.name);
    for (const [key, v] of Object.entries(n)) if (key !== 'loc' && key !== 'extra') identifiersIn(v, into);
  }
}

/** Defaults inside the parameter list (`(a, b = X)`, `({ a = X })`): the right-hand sides. */
function paramDefaults(node: unknown, into: AstNode[]): void {
  if (Array.isArray(node)) {
    for (const n of node) paramDefaults(n, into);
  } else if (node && typeof node === 'object') {
    const n = node as AstNode;
    if (n.type === 'AssignmentPattern') into.push(n.right as AstNode);
    for (const [key, v] of Object.entries(n)) if (key !== 'loc' && key !== 'extra') paramDefaults(v, into);
  }
}

/** Names of closure variables the worklet's parameter defaults read (should be none), for one UI-runtime source. */
export function closureReadsInParamDefaults(source: string): string[] {
  const fn = parser.parseExpression(source) as AstNode & { params: unknown[]; body: { body: AstNode[] } };
  const first = fn.body.body[0] as (AstNode & { declarations?: { id: AstNode & { elements: ({ name: string } | null)[] }; init: AstNode }[] }) | undefined;
  const decl = first?.type === 'VariableDeclaration' ? first.declarations?.[0] : undefined;
  const closure = new Set<string>();
  if (decl && decl.id.type === 'ArrayPattern') for (const el of decl.id.elements) if (el) closure.add(el.name);
  if (closure.size === 0) return [];
  const defaults: AstNode[] = [];
  paramDefaults(fn.params, defaults);
  const used = new Set<string>();
  identifiersIn(defaults, used);
  return [...used].filter((name) => closure.has(name));
}

/** A worklet as the UI runtime runs it: the init-data source, evaluated, with `this.__closure` bound. */
function asOnUiRuntime(worklet: ((...args: never[]) => unknown) & { __initData?: { code: string }; __closure?: unknown }): (...args: unknown[]) => unknown {
  const code = worklet.__initData?.code;
  if (!code) throw new Error('not a compiled worklet');
  const fn = (0, eval)(code) as (...args: unknown[]) => unknown;
  return fn.bind({ __closure: worklet.__closure });
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
}

/** The plugin reads the file it compiles (source maps), so snippets are compiled under the name of a real file. */
const SNIPPET_FILE = join(ROOT, 'src', 'components', 'ui', 'drag', 'dropTargets.ts');
const WORKLET_HINT = /'worklet'|usePanGesture|usePinchGesture|useAnimatedStyle|useAnimatedProps|useAnimatedReaction|useDerivedValue|useAnimatedScrollHandler|scheduleOnUI|runOnUI/;

describe('worklets compiled for the UI runtime', () => {
  it('the scan catches the bug that crashed the belt drag (a default parameter reading a closure variable)', () => {
    const bad = compile("const K = 10;\nexport function f(x: number, s: number = K) {\n  'worklet';\n  return x + s;\n}\n", SNIPPET_FILE);
    const sources = workletSources(bad);
    expect(sources).toHaveLength(1);
    expect(closureReadsInParamDefaults(sources[0])).toEqual(['K']);
    const good = compile("const K = 10;\nexport function f(x: number, s?: number) {\n  'worklet';\n  return x + (s === undefined ? K : s);\n}\n", SNIPPET_FILE);
    expect(closureReadsInParamDefaults(workletSources(good)[0])).toEqual([]);
  });

  it('no worklet in src/ has a parameter default that reads a closure variable', () => {
    const files = walk(join(ROOT, 'src')).filter((f) => WORKLET_HINT.test(readFileSync(f, 'utf8')));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    let worklets = 0;
    for (const file of files) {
      for (const source of workletSources(compile(readFileSync(file, 'utf8'), file))) {
        worklets += 1;
        const reads = closureReadsInParamDefaults(source);
        if (reads.length > 0) offenders.push(`${file.slice(ROOT.length + 1)}: ${/function (\w+)/.exec(source)?.[1] ?? '?'} reads ${reads.join(', ')} in a parameter default`);
      }
    }
    expect(worklets).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  }, 60_000);

  it('slotAt runs on the UI runtime copy (init-data code + this.__closure) and agrees with the source', () => {
    const file = join(ROOT, 'src', 'components', 'ui', 'drag', 'dropTargets.ts');
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    new Function('exports', 'module', 'require', compile(readFileSync(file, 'utf8'), file))(mod.exports, mod, () => ({}));
    const compiled = mod.exports.slotAt as Parameters<typeof asOnUiRuntime>[0];
    const onUi = asOnUiRuntime(compiled);
    const rects = [0, 1, 2, 3].map((i) => ({ x: 20 + i * 80, y: 100, width: 64, height: 64 }));
    for (const [x, y] of [[50, 130], [120, 110], [300, 160], [88, 130], [96, 130], [10, 90], [9, 130], [400, 300]] as const) {
      expect(onUi(rects, x, y), `at ${x},${y} (default margin)`).toBe(slotAtSource(rects, x, y));
    }
    expect(onUi(rects, 85, 130, 0)).toBe(-1); // an explicit margin of 0 still works
  });
});
