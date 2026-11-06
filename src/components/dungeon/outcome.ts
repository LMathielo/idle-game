import { BOSSES, COMBAT, DIFFICULTY, type Difficulty, type DungeonOrBossId, ENEMIES, type FightEndReason, isBossId, type MobVariant, mobName } from '../../engine';

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

/** "Normal" / "Hard" / "Extreme". */
export function difficultyName(difficulty: Difficulty): string {
  return DIFFICULTY[difficulty].name;
}

/**
 * The name of mob `index` in a pack of `size`: "Veteran Troll #3" in a pack, "Veteran Troll" when it fights alone (a pack of one, or
 * Normal). The fight log, the pack rows and the screen reader labels all use it.
 */
export function mobLabel(enemyName: string, variant: MobVariant, index: number, size: number): string {
  const name = mobName(enemyName, variant);
  return size > 1 ? `${name} #${index + 1}` : name;
}

/** "Pack of 4 mobs" / "1 mob": the size of a fight's pack. */
export function packText(size: number): string {
  return size === 1 ? '1 mob' : `${size} mobs`;
}
