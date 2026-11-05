// Combat skills (data). A skill is cast by a combatant INSTEAD of a normal strike when it is ready. Today only enemies cast
// them (the Troll Chieftain's Heavy Bash, 1.20.0); the shape is generic so a hero skill can reuse it later. Rules and the
// fixed RNG draw order: src/engine/combat.ts (strike) and docs/ENGINE.md ("Bosses and combat skills").
//
//   cast       a skill is ready when the caster's NEXT strike number >= its readiness (starts at firstReadyStrike); a ready skill
//              is always cast (no chance to cast). After a cast on strike n it is ready again on strike n + cooldownStrikes.
//   damage     the strike's damage roll × damageMultBp ÷ 10 000 (half up), then armor and magic resist as a normal strike
//              (minimum damage applies)
//   effects    applied in listed order after the damage. `stun`: one check (always drawn); on success the target loses its next
//              `strikes` strikes (its strike timer keeps running, the lost strikes are logged as stunned, no RNG for them).
//              Stuns never stack: a new one only raises the strikes left to `strikes`.
import type { CombatSkillId } from '../types';

export type SkillEffect = { type: 'stun'; chanceBp: number; strikes: number };

export type CombatSkillDef = {
  id: CombatSkillId;
  name: string;
  /** One line for the UI. */
  description: string;
  /** Damage multiplier on the roll, basis points (14 000 = 1.4x). */
  damageMultBp: number;
  effects: readonly SkillEffect[];
  /** Strikes of the caster between a cast and the next time it is ready. Must be larger than any stun's `strikes` (no stun-lock). */
  cooldownStrikes: number;
  /** The caster's first strike on which it is ready (1 = its first strike). */
  firstReadyStrike: number;
};

export const COMBAT_SKILLS: Record<CombatSkillId, CombatSkillDef> = {
  heavy_bash: {
    id: 'heavy_bash',
    name: 'Heavy Bash',
    description: 'A crushing blow: 1.4x damage and a 35% chance to stun for 3 strikes. Ready on his 3rd strike, then every 7 strikes.',
    damageMultBp: 14_000,
    effects: [{ type: 'stun', chanceBp: 3500, strikes: 3 }],
    cooldownStrikes: 7,
    firstReadyStrike: 3,
  },
};

export function isCombatSkillId(id: unknown): id is CombatSkillId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(COMBAT_SKILLS, id);
}
