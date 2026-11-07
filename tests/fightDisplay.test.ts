// The fight view's display clock (UI only): pure helpers in src/components/dungeon/fightDisplay.ts.
import { describe, expect, it } from 'vitest';
import type { DungeonFightView, FightLogEntry } from '../src/engine';
import { displayClockMs, displayedFight, FIGHT_VIEW_LEAD_MS, FIGHT_VIEW_MAX_LAG_MS, isCatchingUp, isFreshFight, visibleEntries } from '../src/components/dungeon/fightDisplay';

const entry = (actor: 'hero' | 'enemy' | 'belt', atMs: number, dealt: number, targetHpAfter: number, extra: Partial<FightLogEntry> = {}): FightLogEntry => ({
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
    expect(displayClockMs(900, 0, 0, true)).toBe(-100);
    expect(visibleEntries(LOG, displayClockMs(900, 0, 99, true))).toHaveLength(0);
    expect(visibleEntries(LOG, displayClockMs(900, 0, 100, true)).map((e) => e.atMs)).toEqual([0]);
    expect(visibleEntries(LOG, displayClockMs(900, 0, 399, true))).toHaveLength(1);
    expect(visibleEntries(LOG, displayClockMs(900, 0, 400, true)).map((e) => e.atMs)).toEqual([0, 300]);
  });

  it('never runs ahead of the engine, and never trails it by more than the max lag', () => {
    expect(displayClockMs(500, 0, 10_000, true)).toBe(500);
    expect(displayClockMs(60_000, 0, 0, true)).toBe(60_000 - FIGHT_VIEW_MAX_LAG_MS); // a resume from the background snaps
  });

  it('a fight well underway when the view opens is not delayed', () => {
    expect(isFreshFight(FIGHT_VIEW_MAX_LAG_MS)).toBe(false);
    expect(displayClockMs(20_000, 20_000, 0, false)).toBe(20_000);
  });
});

describe('a view opened mid-fight', () => {
  it('opened at engine time 1000 ms it shows the history at once and trails only by the lead, then catches up and stops redrawing', () => {
    expect(displayClockMs(1000, 1000, 0, true)).toBe(900); // not 1000 - 1100: the history up to 900 ms is there at open
    expect(visibleEntries(LOG, displayClockMs(1000, 1000, 0, true)).map((e) => e.atMs)).toEqual([0, 300]);
    expect(isCatchingUp(displayClockMs(1000, 1000, 99, true), 1000)).toBe(true);
    expect(displayClockMs(1000, 1000, 100, true)).toBe(1000);
    expect(isCatchingUp(displayClockMs(1000, 1000, 100, true), 1000)).toBe(false);
    // The next engine tick (+1000 ms) lands 1000 ms of real time later: the display is 100 ms behind for 100 ms, then caught up (timer off).
    expect(displayClockMs(2000, 1000, 1000, true)).toBe(1900);
    expect(displayClockMs(2000, 1000, 1100, true)).toBe(2000);
    expect(isCatchingUp(displayClockMs(2000, 1000, 1100, true), 2000)).toBe(false);
  });

  it('opened at fight time 0 keeps the whole lead, and the timer runs only during it', () => {
    expect(isCatchingUp(displayClockMs(0, 0, 0, true), 0)).toBe(true);
    expect(isCatchingUp(displayClockMs(0, 0, 100, true), 0)).toBe(false);
  });
});

describe('visibleEntries / displayedFight', () => {
  it('hero HP is the last shown enemy strike, not the current HP plus hidden damage (regen after those strikes does not leak in)', () => {
    const v = { ...view(1300), heroHp: 50 }; // 46 and 42 were hit, then regen brought him to 50
    expect(displayedFight(v, 300).heroHp).toBe(46);
    expect(displayedFight(v, 1000).heroHp).toBe(46);
    expect(displayedFight(v, 1300)).toBe(v);
  });

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

  it('a Potion Belt drink (actor belt) moves the hero HP like a strike: shown ones win, hidden ones are taken off the fallback', () => {
    // Max HP 50: the hero took 4 (46), drank at 600 ms for +4 (back to 50), then took 4 more (46).
    const log = [entry('hero', 0, 10, 20), entry('enemy', 300, 4, 46), entry('belt', 600, 0, 50, { potion: 'health_potion_t1', heal: 4 }), entry('enemy', 1300, 4, 46)];
    const v = { ...view(1300), heroHp: 46, log };
    expect(displayedFight(v, 300).heroHp).toBe(46);
    expect(displayedFight(v, 600).heroHp).toBe(50); // the drink's targetHpAfter is the hero's HP
    expect(displayedFight(v, 1000).heroHp).toBe(50);
    // Nothing shown yet: current 46 + 4 (enemy strike) + 4 (enemy strike) - 4 (the drink) = 50.
    expect(displayedFight(v, -50).heroHp).toBe(50);
    // The drink does not touch the mob bars.
    expect(displayedFight(v, 600).enemyHp).toBe(20);
  });

  it('a stun is counted from what is shown', () => {
    const log = [entry('hero', 0, 10, 20), entry('enemy', 300, 4, 46, { skill: 'heavy_bash', stun: 2 }), entry('hero', 1000, 0, 20, { stunned: true })];
    const v = { ...view(1000), log, heroStunStrikes: 1 };
    expect(displayedFight(v, 0).heroStunStrikes).toBe(0);
    expect(displayedFight(v, 300).heroStunStrikes).toBe(2);
  });
});
