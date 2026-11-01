import { AWAY_SUMMARY_MIN_MS } from './config/time';
import type { SimulationSummary } from './types';

export function emptySummary(): SimulationSummary {
  return {
    requestedMs: 0,
    grantedMs: 0,
    actions: 0,
    oresMined: 0,
    itemsGained: {},
    itemsLost: {},
    skillXpGained: {},
    skillLevelsGained: {},
    heroXpGained: 0,
    heroLevelsGained: 0,
    goldGained: 0,
    dungeon: { runs: 0, wins: 0, losses: 0 },
    dungeonsUnlocked: [],
    trainingXpGained: {},
    trainingLevelsGained: {},
    trainingMaxed: [],
    buildingsUpgraded: [],
    workerActions: 0,
    workerItemsGained: {},
    workerItemsLost: {},
    upkeepPaid: 0,
    craftsCompleted: 0,
    itemsCrafted: {},
    anomalies: [],
  };
}

function addMaps<M extends Partial<Record<string, number>>>(a: M, b: M): M {
  const out: Record<string, number> = { ...(a as Record<string, number>) };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + (v ?? 0);
  return out as M;
}

/** Combines two consecutive summaries (used to aggregate live ticks). */
export function mergeSummaries(a: SimulationSummary, b: SimulationSummary): SimulationSummary {
  return {
    requestedMs: a.requestedMs + b.requestedMs,
    grantedMs: a.grantedMs + b.grantedMs,
    actions: a.actions + b.actions,
    oresMined: a.oresMined + b.oresMined,
    itemsGained: addMaps(a.itemsGained, b.itemsGained),
    itemsLost: addMaps(a.itemsLost, b.itemsLost),
    skillXpGained: addMaps(a.skillXpGained, b.skillXpGained),
    skillLevelsGained: addMaps(a.skillLevelsGained, b.skillLevelsGained),
    heroXpGained: a.heroXpGained + b.heroXpGained,
    heroLevelsGained: a.heroLevelsGained + b.heroLevelsGained,
    goldGained: a.goldGained + b.goldGained,
    dungeon: {
      runs: a.dungeon.runs + b.dungeon.runs,
      wins: a.dungeon.wins + b.dungeon.wins,
      losses: a.dungeon.losses + b.dungeon.losses,
    },
    dungeonsUnlocked: [...a.dungeonsUnlocked, ...b.dungeonsUnlocked],
    trainingXpGained: addMaps(a.trainingXpGained, b.trainingXpGained),
    trainingLevelsGained: addMaps(a.trainingLevelsGained, b.trainingLevelsGained),
    trainingMaxed: [...a.trainingMaxed, ...b.trainingMaxed],
    buildingsUpgraded: [...a.buildingsUpgraded, ...b.buildingsUpgraded],
    workerActions: a.workerActions + b.workerActions,
    workerItemsGained: addMaps(a.workerItemsGained, b.workerItemsGained),
    workerItemsLost: addMaps(a.workerItemsLost, b.workerItemsLost),
    upkeepPaid: a.upkeepPaid + b.upkeepPaid,
    craftsCompleted: a.craftsCompleted + b.craftsCompleted,
    itemsCrafted: addMaps(a.itemsCrafted, b.itemsCrafted),
    anomalies: [...a.anomalies, ...b.anomalies],
  };
}

/** Total training XP in a summary, over every attribute. */
export function trainingXpTotal(s: Pick<SimulationSummary, 'trainingXpGained'>): number {
  return Object.values(s.trainingXpGained).reduce<number>((n, v) => n + (v ?? 0), 0);
}

/**
 * Worth showing in "While you were away": any clock anomaly, or at least AWAY_SUMMARY_MIN_MS of real time
 * away with at least one log cut, ore mined, dungeon run, training XP point, training cap reached, upgrade finished,
 * worker action or craft finished. A quick
 * app switch never opens the modal.
 */
export function isNoteworthy(s: SimulationSummary, minAwayMs: number = AWAY_SUMMARY_MIN_MS): boolean {
  const progressed =
    s.actions > 0 || s.oresMined > 0 || s.dungeon.runs > 0 || trainingXpTotal(s) > 0 || s.trainingMaxed.length > 0 || s.buildingsUpgraded.length > 0 || s.workerActions > 0 || s.craftsCompleted > 0;
  return s.anomalies.length > 0 || (s.requestedMs >= minAwayMs && progressed);
}
