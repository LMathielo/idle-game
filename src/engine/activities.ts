// Shared reward helpers (pure, operate on a draft state). Woodcutting rules live in woodcutting.ts.
import { HERO_XP_CURVE } from './config/xpCurve';
import { addXp } from './progression';
import type { GameEvent, GameState, SimulationSummary } from './types';

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
