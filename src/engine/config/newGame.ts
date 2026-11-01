// Starting hero for newGame(). Weaker than the old UI mock: level 1, basic gear.
import type { Attributes, SkillKey } from '../types';

export const STARTING_HERO = {
  name: 'Lucius',
  title: 'Novice Gladiator',
  gold: 25,
  attributes: {
    strength: 10,
    dexterity: 10,
    endurance: 10,
    intelligence: 10,
  } satisfies Attributes,
  /** Equipped item definition ids. */
  equipment: ['rusty_gladius', 'linen_tunic', 'worn_sandals', 'wooden_axe', 'wooden_pickaxe'],
  /** Starting inventory stacks. */
  inventory: [{ itemId: 'bread', quantity: 3 }],
  skills: ['woodcutting', 'mining', 'fishing'] satisfies SkillKey[],
} as const;
