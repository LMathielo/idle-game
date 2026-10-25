import type { SimulationSummary } from './types';

export function emptySummary(): SimulationSummary {
  return {
    requestedMs: 0,
    grantedMs: 0,
    actions: 0,
    itemsGained: {},
    itemsLost: {},
    skillXpGained: {},
    skillLevelsGained: {},
    heroXpGained: 0,
    heroLevelsGained: 0,
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
    itemsGained: addMaps(a.itemsGained, b.itemsGained),
    itemsLost: addMaps(a.itemsLost, b.itemsLost),
    skillXpGained: addMaps(a.skillXpGained, b.skillXpGained),
    skillLevelsGained: addMaps(a.skillLevelsGained, b.skillLevelsGained),
    heroXpGained: a.heroXpGained + b.heroXpGained,
    heroLevelsGained: a.heroLevelsGained + b.heroLevelsGained,
    anomalies: [...a.anomalies, ...b.anomalies],
  };
}

/** Worth showing in "While you were away": at least one action or any clock anomaly. */
export function isNoteworthy(s: SimulationSummary): boolean {
  return s.actions > 0 || s.anomalies.length > 0;
}
