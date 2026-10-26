// Acted skills: interval and one action. Pure, operates on a draft state.
import { ACTIVITIES, type ActivityConfig } from './config/activities';
import { HERO_XP_CURVE, SKILL_XP_CURVE } from './config/xpCurve';
import { addStackable } from './inventory';
import { addXp } from './progression';
import { chance } from './rng';
import type { GameEvent, GameState, GatheringKind, SimulationSummary } from './types';

/** Action interval for a skill level: base −1% of base per level above 1, floored. */
export function actionIntervalMs(cfg: ActivityConfig, skillLevel: number): number {
  const raw = cfg.baseIntervalMs * (1 - cfg.intervalReductionPerLevel * (skillLevel - 1));
  return Math.max(cfg.minIntervalMs, Math.round(raw));
}

export function currentActionIntervalMs(state: GameState, kind: GatheringKind): number {
  const cfg = ACTIVITIES[kind];
  return actionIntervalMs(cfg, state.character.skills[cfg.skill].level);
}

function bump(map: Record<string, number>, key: string, by: number) {
  if (by === 0) return;
  map[key] = (map[key] ?? 0) + by;
}

/** Performs one action on `draft` (mutated), recording into `summary` and `events`. */
export function performAction(
  draft: GameState,
  kind: GatheringKind,
  summary: SimulationSummary,
  events: GameEvent[],
): void {
  const cfg = ACTIVITIES[kind];

  const gain = (itemId: string, qty: number) => {
    const { added, lost } = addStackable(draft.inventory, itemId, qty);
    bump(summary.itemsGained, itemId, added);
    bump(summary.itemsLost, itemId, lost);
    bump(draft.stats.itemsGathered, itemId, added);
  };

  for (const r of cfg.rewards) gain(r.itemId, r.quantity);

  for (const drop of cfg.rareDrops) {
    const roll = chance(draft.rng, drop.chance);
    draft.rng = roll.rng;
    if (roll.value) {
      gain(drop.itemId, 1);
      events.push({ type: 'RARE_DROP', itemId: drop.itemId });
    }
  }

  if (cfg.skillXpPerAction > 0) {
    const skill = draft.character.skills[cfg.skill];
    const res = addXp(skill, cfg.skillXpPerAction, SKILL_XP_CURVE);
    draft.character.skills[cfg.skill] = res.progress;
    summary.skillXpGained[cfg.skill] = (summary.skillXpGained[cfg.skill] ?? 0) + cfg.skillXpPerAction;
    if (res.levelsGained > 0) {
      summary.skillLevelsGained[cfg.skill] = (summary.skillLevelsGained[cfg.skill] ?? 0) + res.levelsGained;
      events.push({ type: 'SKILL_LEVEL_UP', skill: cfg.skill, level: res.progress.level });
    }
  }

  if (cfg.heroXpPerAction > 0) grantHeroXp(draft, cfg.heroXpPerAction, summary, events);

  draft.stats.totalActions += 1;
  summary.actions += 1;
}

export function grantHeroXp(draft: GameState, amount: number, summary: SimulationSummary | null, events: GameEvent[]) {
  const c = draft.character;
  const res = addXp({ level: c.level, xp: c.xp, xpToNext: c.xpToNext }, amount, HERO_XP_CURVE);
  c.level = res.progress.level;
  c.xp = res.progress.xp;
  c.xpToNext = res.progress.xpToNext;
  if (summary) {
    summary.heroXpGained += amount;
    summary.heroLevelsGained += res.levelsGained;
  }
  if (res.levelsGained > 0) events.push({ type: 'HERO_LEVEL_UP', level: c.level });
}
