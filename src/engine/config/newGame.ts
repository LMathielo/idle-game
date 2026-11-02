// Starting hero for newGame(). Weaker than the old UI mock: level 1, basic gear.
import type { Attributes, SkillKey } from '../types';

export const STARTING_HERO = {
  name: 'Lucius',
  title: 'Novice Gladiator',
  gold: 25,
  /** Stored extra normal points (1.16.0: a new hero starts at 0 normal and 0 core; the old 10 is in the hero base numbers). */
  attributes: {
    strength: 0,
    dexterity: 0,
    endurance: 0,
    intelligence: 0,
  } satisfies Attributes,
  /** Equipped item definition ids. */
  equipment: ['rusty_gladius', 'linen_tunic', 'worn_sandals', 'wooden_axe', 'wooden_pickaxe'],
  /** Starting inventory stacks. */
  inventory: [{ itemId: 'bread', quantity: 3 }],
  skills: ['woodcutting', 'mining', 'fishing'] satisfies SkillKey[],
} as const;
