// Effective attributes (pure, read-only): base (stored in character.attributes) + training level.
// Every rule that reads an attribute (damage, defense, HP regen, DEX run time) goes through this.
import { ATTRIBUTE_KEYS, type AttributeKey, type AttributeTraining, type Attributes, type Character } from './types';

/** The training slice an effective attribute needs. A GameState fits. */
export type TrainingLevels = { attributes: Record<AttributeKey, Pick<AttributeTraining, 'level'>> };

/** What effectiveAttributes reads. A GameState fits; UIs can pass just these slices. */
export type AttributeInput = { character: Pick<Character, 'attributes'>; training: TrainingLevels };

/** effective = base + training level, for every attribute. */
export function effectiveAttributes(state: AttributeInput): Attributes {
  const base = state.character.attributes;
  const trained = state.training.attributes;
  const out = {} as Attributes;
  for (const k of ATTRIBUTE_KEYS) out[k] = base[k] + trained[k].level;
  return out;
}
