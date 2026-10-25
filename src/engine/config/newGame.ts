// Starting hero for newGame(). Weaker than the old UI mock: level 1, basic gear.
import type { Attributes, SkillKey } from '../types';

export const STARTING_HERO = {
  name: 'Lucius',
  title: 'Novice Gladiator',
  maxHp: 50,
  gold: 25,
  attributes: {
    strength: 5,
    dexterity: 5,
    agility: 5,
    constitution: 5,
    charisma: 5,
    intelligence: 5,
  } satisfies Attributes,
  /** Equipped item definition ids. */
  equipment: ['rusty_gladius', 'linen_tunic', 'worn_sandals'],
  /** Starting inventory stacks. */
  inventory: [{ itemId: 'bread', quantity: 3 }],
  skills: ['woodcutting', 'mining', 'fishing', 'smithing'] satisfies SkillKey[],
} as const;
