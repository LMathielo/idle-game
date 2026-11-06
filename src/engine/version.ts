/** Engine rules version, stored on every action_log row. Bump when rules change outcomes. */
export const ENGINE_VERSION = '1.25.0';

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
  { engine: '1.15.0', save: 15 }, // continuous material pipes (inputs per craft, waiting), ×10 tap, Stop
  { engine: '1.16.0', save: 16 }, // normal + core attributes, +5 per level, new hero at 0; core DEX time curve, core STR power
  { engine: '1.17.0', save: 17 }, // spendable level-up points (5 per level), total STR → WS / MS, current mana + regen
  { engine: '1.18.0', save: 18 }, // locked start: Merchant + Storage unbuilt on a new save (Storage is a building), 500 starting gold, every search 2:00
  { engine: '1.19.0', save: 19 }, // stats rework: STR damage, DEX crits, END toughness, INT magic; core multipliers; 0.2 regen per point (exact), defense renamed armor
  { engine: '1.20.0', save: 20 }, // first boss: dungeon tiers, ENTER_BOSS (stamina entry), enemy regen + skills (Heavy Bash, stun), boss rewards, Chieftain's Tusk
  { engine: '1.21.0', save: 20 }, // engine-only bump (PR #35): the Legs slot, greaves / axe / pickaxe recipes; the row was added with 1.22.0, which is the first to bump the code
  { engine: '1.22.0', save: 21 }, // gear rarity tiers: rarity multiplier on the main stat, attribute-bonus affixes (rare / epic), perks (epic), gear level
  { engine: '1.23.0', save: 21 }, // engine-only bump: DEBUG_FORCE_CRAFT / DEBUG_FINISH_CRAFT; optional `free` flag on a craft job (absent = false)
  { engine: '1.24.0', save: 22 }, // difficulties: Hard / Extreme packs and bosses, per-difficulty counters, SET_DUNGEON_DIFFICULTY, pack fights (mobs)
  { engine: '1.25.0', save: 23 }, // combat opening: the hero strikes at 0, monsters at 300 ms; the opening offsets are stored on the fight
];

/** Position of a released engine version in RELEASED_ENGINES, or -1 when it never shipped. */
export function releasedEngineIndex(engine: unknown): number {
  return typeof engine === 'string' ? RELEASED_ENGINES.findIndex((r) => r.engine === engine) : -1;
}
