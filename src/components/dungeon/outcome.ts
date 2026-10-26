import { COMBAT, type FightEndReason } from '../../engine';

/** Outcome labels, keyed by the engine's end reason (never recomputed from config or the log). */
export const OUTCOME_LABELS: Record<FightEndReason, string> = {
  enemy_defeated: 'Victory',
  hero_defeated: 'Defeat',
  round_cap: `Defeat (out of time, ${COMBAT.maxRounds} rounds)`,
  no_hp: 'Defeat (no HP to fight)',
};
