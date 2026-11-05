import { BOSSES, COMBAT, type DungeonOrBossId, ENEMIES, type FightEndReason, isBossId } from '../../engine';

/** The time limit of a fight in this dungeon or boss, ms (60 s for a stage, the boss's own for a boss). */
export function fightLimitMs(dungeonId: DungeonOrBossId): number {
  return isBossId(dungeonId) ? (ENEMIES[BOSSES[dungeonId].enemyId].maxFightMs ?? COMBAT.maxFightMs) : COMBAT.maxFightMs;
}

/** Outcome label, keyed by the engine's end reason (never recomputed from the log); the time limit depends on where the fight was. */
export function outcomeLabel(endReason: FightEndReason, dungeonId: DungeonOrBossId): string {
  switch (endReason) {
    case 'enemy_defeated':
      return 'Victory';
    case 'hero_defeated':
      return 'Defeat';
    case 'time_limit':
      return `Defeat (out of time, ${fightLimitMs(dungeonId) / 1000}s)`;
    case 'no_hp':
      return 'Defeat (no HP to fight)';
    case 'forfeit':
      return 'Defeat (fled)';
  }
}
