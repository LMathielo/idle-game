// The fight view's display clock (UI only: the engine's log, outcome and save never depend on it).
// The engine plays a fight in whole ticks, so when the view opens on a fresh fight its first strikes are already in the log. The view draws
// the log on a display clock that starts FIGHT_VIEW_LEAD_MS behind fight time 0: the hero's opening hit shows ~0.1 s after the screen
// opens, the monster's (300 ms into the fight) ~0.3 s after that, and the rest in step. The display never runs ahead of the engine, and
// it never lags it by more than FIGHT_VIEW_MAX_LAG_MS (a view opened on a fight well underway, or a resume from the background, snaps).
import type { DungeonFightView, FightLogEntry, MobView } from '../../engine';

/** How long after the fight view opens on a fresh fight the display clock reaches fight time 0. The one place this is set. */
export const FIGHT_VIEW_LEAD_MS = 100;
/** The display clock never trails engine time by more than this; a fight already further along when the view opens is not delayed at all. */
export const FIGHT_VIEW_MAX_LAG_MS = 1500;

/** A view opened on a fight at this engine time (ms) plays the lead-in; a fight further along is shown as it stands. */
export function isFreshFight(engineMs: number): boolean {
  return engineMs < FIGHT_VIEW_MAX_LAG_MS;
}

/**
 * The fight time the view has played to. `sinceOpenMs` is real time since the view opened (or since the fight began, for a fight that
 * replaced the one on screen). Not fresh: engine time. Fresh: the real-time clock minus the lead-in, capped at engine time and floored
 * at engine time minus the max lag.
 */
export function displayClockMs(engineMs: number, sinceOpenMs: number, fresh: boolean): number {
  if (!fresh) return engineMs;
  const clock = sinceOpenMs - FIGHT_VIEW_LEAD_MS;
  return Math.min(engineMs, Math.max(clock, engineMs - FIGHT_VIEW_MAX_LAG_MS));
}

/** The entries of a time-ordered log that have landed by display time `displayMs` (a tie shows: `atMs <= displayMs`). */
export function visibleEntries(log: readonly FightLogEntry[], displayMs: number): readonly FightLogEntry[] {
  let n = log.length;
  while (n > 0 && log[n - 1].atMs > displayMs) n -= 1;
  return n === log.length ? log : log.slice(0, n);
}

/**
 * The fight as the display clock has it: the log cut at `displayMs`, the bars and the stun counter recomputed from what is shown. At or
 * past engine time it is the view unchanged (nothing is hidden, so nothing is skipped or shown twice).
 */
export function displayedFight(fight: DungeonFightView, displayMs: number): DungeonFightView {
  const log = visibleEntries(fight.log, displayMs);
  if (log === fight.log) return fight;
  let heroHp = fight.heroHp;
  for (let i = log.length; i < fight.log.length; i++) if (fight.log[i].actor === 'enemy') heroHp += fight.log[i].dealt; // damage not shown yet
  heroHp = Math.max(0, Math.min(heroHp, fight.heroMaxHp));
  const hp = fight.mobs.map((m) => m.maxHp);
  let stun = 0;
  for (const e of log) {
    const at = e.mob ?? 0;
    if (e.actor === 'hero') hp[at] = e.targetHpAfter;
    if (e.enemyHpAfter !== undefined) hp[at] = e.enemyHpAfter;
    if (e.stunned) stun = Math.max(0, stun - 1);
    else if (e.stun) stun = Math.max(stun, e.stun);
  }
  const mobs: MobView[] = fight.mobs.map((m, i) => ({ ...m, hp: hp[i], alive: hp[i] > 0 }));
  return {
    ...fight,
    elapsedMs: Math.max(0, Math.min(displayMs, fight.elapsedMs)),
    heroHp,
    enemyHp: hp.reduce((n, h) => n + h, 0),
    mobs,
    targetIndex: mobs.findIndex((m) => m.alive),
    heroStunStrikes: stun,
    log,
  };
}
