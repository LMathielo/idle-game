// Player-facing lines for a building's passive bonuses at one level (config/buildings.ts LevelBonuses).
import type { LevelBonuses } from '../../engine';
import { formatBonusBp } from '../format';

const SKILL_ITEMS = { woodcutting: 'log', mining: 'stone & ore' } as const;

/** One short line per bonus, e.g. "+20% log yield", "5 worker slots", "2 training XP per minute". Empty when there is none. */
export function bonusLines(b: LevelBonuses): string[] {
  const out: string[] = [];
  const y = b.yieldBp ?? {};
  if (y.woodcutting && y.mining && y.woodcutting === y.mining) out.push(`${formatBonusBp(y.woodcutting)} wood, stone & ore yield`);
  else {
    if (y.woodcutting) out.push(`${formatBonusBp(y.woodcutting)} ${SKILL_ITEMS.woodcutting} yield`);
    if (y.mining) out.push(`${formatBonusBp(y.mining)} ${SKILL_ITEMS.mining} yield`);
  }
  if (b.sellPriceBp) out.push(`${formatBonusBp(b.sellPriceBp)} merchant sell prices`);
  if (b.workerCap) out.push(`${b.workerCap} worker slots`);
  if (b.stockSlots) out.push(`${b.stockSlots} stock slots`);
  if (b.trainingXpPerMin) out.push(`${b.trainingXpPerMin} training XP per minute`);
  return out;
}

/** How the training rate grows per level (e.g. "+1 XP/min per level"), or null when the level change gives none. */
export function trainingRateStep(now: LevelBonuses, next: LevelBonuses | null): string | null {
  const step = (next?.trainingXpPerMin ?? 0) - (now.trainingXpPerMin ?? 0);
  return next?.trainingXpPerMin && step > 0 ? `+${step} XP/min per level` : null;
}
