import { COMBAT, type FightEndReason } from '../../engine';

/** Outcome labels, keyed by the engine's end reason (never recomputed from config or the log). */
export const OUTCOME_LABELS: Record<FightEndReason, string> = {
  enemy_defeated: 'Victory',
  hero_defeated: 'Defeat',
  time_limit: `Defeat (out of time, ${COMBAT.maxFightMs / 1000}s)`,
  no_hp: 'Defeat (no HP to fight)',
  forfeit: 'Defeat (fled)',
};
