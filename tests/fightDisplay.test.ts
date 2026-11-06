// The fight view's display clock (UI only): pure helpers in src/components/dungeon/fightDisplay.ts.
import { describe, expect, it } from 'vitest';
import type { DungeonFightView, FightLogEntry } from '../src/engine';
import { displayClockMs, displayedFight, FIGHT_VIEW_LEAD_MS, FIGHT_VIEW_MAX_LAG_MS, isFreshFight, visibleEntries } from '../src/components/dungeon/fightDisplay';

const entry = (actor: 'hero' | 'enemy', atMs: number, dealt: number, targetHpAfter: number, extra: Partial<FightLogEntry> = {}): FightLogEntry => ({
  atMs, actor, strike: 1, roll: dealt, crit: false, physical: dealt, magic: 0, dealt, targetHpAfter, ...extra,
});
const LOG = [entry('hero', 0, 10, 20), entry('enemy', 300, 4, 46), entry('hero', 1000, 10, 10), entry('enemy', 1300, 4, 42)];
const view = (elapsedMs: number): DungeonFightView => ({
  enemyId: 'rat', elapsedMs, maxFightMs: 60_000, heroHp: 42, heroMaxHp: 50, enemyHp: 10, enemyMaxHp: 30,
  mobs: [{ variant: 'base', hp: 10, maxHp: 30, alive: true }], targetIndex: 0, enemyRegenBp: 0, heroStunStrikes: 0, log: LOG,
});

describe('display clock', () => {
  it('a fresh fight starts 100 ms behind fight time 0: the opening hit shows 0.1 s after opening, the monster 0.3 s after that', () => {
    expect(FIGHT_VIEW_LEAD_MS).toBe(100);
    expect(isFreshFight(0)).toBe(true);
    expect(displayClockMs(900, 0, true)).toBe(-100);
    expect(visibleEntries(LOG, displayClockMs(900, 99, true))).toHaveLength(0);
    expect(visibleEntries(LOG, displayClockMs(900, 100, true)).map((e) => e.atMs)).toEqual([0]);
    expect(visibleEntries(LOG, displayClockMs(900, 399, true))).toHaveLength(1);
    expect(visibleEntries(LOG, displayClockMs(900, 400, true)).map((e) => e.atMs)).toEqual([0, 300]);
  });

  it('never runs ahead of the engine, and never trails it by more than the max lag', () => {
    expect(displayClockMs(500, 10_000, true)).toBe(500);
    expect(displayClockMs(60_000, 0, true)).toBe(60_000 - FIGHT_VIEW_MAX_LAG_MS); // a resume from the background snaps
  });

  it('a fight well underway when the view opens is not delayed', () => {
    expect(isFreshFight(FIGHT_VIEW_MAX_LAG_MS)).toBe(false);
    expect(displayClockMs(20_000, 0, false)).toBe(20_000);
  });
});

describe('visibleEntries / displayedFight', () => {
  it('shows entries with atMs <= displayMs, in order, none twice', () => {
    expect(visibleEntries(LOG, -1)).toEqual([]);
    expect(visibleEntries(LOG, 300).map((e) => e.atMs)).toEqual([0, 300]);
    expect(visibleEntries(LOG, 1300)).toBe(LOG);
    expect(visibleEntries(LOG, 99_999)).toBe(LOG);
  });

  it('caught up it is the engine view itself; behind it, bars come from the shown entries', () => {
    const v = view(1300);
    expect(displayedFight(v, 1300)).toBe(v);
    const none = displayedFight(v, -50);
    expect(none.log).toHaveLength(0);
    expect([none.heroHp, none.enemyHp]).toEqual([50, 30]); // 42 + 4 + 4 not yet shown
    const one = displayedFight(v, 0);
    expect(one.log.map((e) => e.atMs)).toEqual([0]);
    expect([one.heroHp, one.enemyHp, one.mobs[0].hp]).toEqual([50, 20, 20]);
    const two = displayedFight(v, 300);
    expect([two.heroHp, two.enemyHp]).toEqual([46, 20]);
    expect(two.elapsedMs).toBe(300);
  });

  it('a stun is counted from what is shown', () => {
    const log = [entry('hero', 0, 10, 20), entry('enemy', 300, 4, 46, { skill: 'heavy_bash', stun: 2 }), entry('hero', 1000, 0, 20, { stunned: true })];
    const v = { ...view(1000), log, heroStunStrikes: 1 };
    expect(displayedFight(v, 0).heroStunStrikes).toBe(0);
    expect(displayedFight(v, 300).heroStunStrikes).toBe(2);
  });
});
