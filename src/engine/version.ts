/** Engine rules version, stored on every action_log row. Bump when rules change outcomes. */
export const ENGINE_VERSION = '1.6.0';

/**
 * Every engine version that ever shipped, oldest first, with the save version it wrote. Append a row on
 * every ENGINE_VERSION bump (the last row is always the current engine). Replay refuses log rows labelled
 * with any version not listed here (see replayLogReport), and every save-version bump comes with an
 * engine bump (guard test in tests/golden.test.ts).
 */
export const RELEASED_ENGINES: readonly { engine: string; save: number }[] = [
  { engine: '1.0.0', save: 1 },
  { engine: '1.1.0', save: 2 },
  { engine: '1.2.0', save: 3 },
  { engine: '1.3.0', save: 4 },
  { engine: '1.4.0', save: 5 },
  { engine: '1.5.0', save: 6 },
  { engine: '1.6.0', save: 7 },
];

/** Position of a released engine version in RELEASED_ENGINES, or -1 when it never shipped. */
export function releasedEngineIndex(engine: unknown): number {
  return typeof engine === 'string' ? RELEASED_ENGINES.findIndex((r) => r.engine === engine) : -1;
}
