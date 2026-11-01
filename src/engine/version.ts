/** Engine rules version, stored on every action_log row. Bump when rules change outcomes. */
export const ENGINE_VERSION = '1.14.0';

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
  { engine: '1.7.0', save: 8 },
  { engine: '1.8.0', save: 9 },
  { engine: '1.9.0', save: 10 },
  { engine: '1.10.0', save: 11 },
  { engine: '1.11.0', save: 11 }, // engine-only bump: Training Grounds upgrades (training XP/min by level)
  { engine: '1.12.0', save: 12 }, // skill XP curve base 500 → 100, own segments; skills keep their total XP
  { engine: '1.13.0', save: 13 }, // Crafting house, pipes, material recipes; INT craft time; smithing removed
  { engine: '1.14.0', save: 14 }, // gear crafting; gear quality (stats and prices) and instance rarity; Merchant gear rolls
];

/** Position of a released engine version in RELEASED_ENGINES, or -1 when it never shipped. */
export function releasedEngineIndex(engine: unknown): number {
  return typeof engine === 'string' ? RELEASED_ENGINES.findIndex((r) => r.engine === engine) : -1;
}
