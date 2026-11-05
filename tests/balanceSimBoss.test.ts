// Balance check for the first boss (engine 1.20.0). NOT a rule test: skipped unless BALANCE_SIM is set, and it only reports.
//
//   BALANCE_SIM=1 BALANCE_SIM_OUT=/tmp/boss-balance.md npx vitest run tests/balanceSimBoss.test.ts
//
// Plays N seeded Troll Chieftain fights (resolveFight with the boss's regen / skills / 120 s limit: the same strike code the live
// and offline fight uses, no hero regen inside the fight, no potions) from full HP for reference heroes:
//   "just unlocked": level from the XP of the unlock path (the stage wins that open the Troll Bridge, then its 50 wins), all level-up
//                    points in one attribute or spread, the merchant's Iron set at quality 25 (what the Merchant stocks, common)
//   "one step up":   the same hero in the Iron set at quality 50 (a green drop)
// Targets (owner, 2026-11-05): just unlocked ~30-40%, one gear step better ~80%. Also prints the Troll Bridge hint for the same hero
// and the boss danger hint. Reference hero for the PR report: STR+END (points split evenly) at level 20, no core, no training upgrades.
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BOSSES,
  bossDangerHint,
  createRng,
  dangerHint,
  ENEMIES,
  type GameState,
  getDerivedStats,
  resolveFight,
} from '../src/engine';
import { HERO_XP_CURVE } from '../src/engine/config/xpCurve';
import { enemyCombatSide, enemyFightOptions, heroCombatSide } from '../src/engine/combat';
import { cumulativeXp } from '../src/engine/progression';
import { type BossBuild, bossHero } from './helpers';

const N = Number(process.env.BALANCE_SIM_N ?? 2000);
const BUILDS: BossBuild[] = ['STR', 'DEX', 'END', 'INT', 'balanced', 'STR+END'];

/** XP of the unlock path: the wins that open each stage, then the 50 Troll Bridge wins. */
const UNLOCK_PATH_XP = 10 * 35 + 15 * 60 + 25 * 140 + 40 * 300 + 50 * 650;

function levelFromXp(xp: number): number {
  let level = 1;
  while (cumulativeXp(HERO_XP_CURVE, level + 1) <= xp) level++;
  return level;
}

function winRate(s: GameState, bossId: 'troll_chieftain', seed: number) {
  const d = getDerivedStats(s);
  const enemyDef = ENEMIES[BOSSES[bossId].enemyId];
  const hero = { hp: d.maxHp.value, ...heroCombatSide(d) };
  const enemy = { hp: enemyDef.hp, ...enemyCombatSide(enemyDef) };
  const opts = enemyFightOptions(enemyDef);
  let wins = 0;
  let ms = 0;
  let hpLeft = 0;
  let timeouts = 0;
  for (let i = 0; i < N; i++) {
    const r = resolveFight(hero, enemy, createRng(seed + i * 7919), opts.maxFightMs, opts);
    if (r.won) {
      wins++;
      hpLeft += r.heroHp;
    }
    if (r.endReason === 'time_limit') timeouts++;
    ms += r.durationMs;
  }
  return { win: wins / N, ms: ms / N, hpLeft: wins ? hpLeft / wins : 0, timeouts: timeouts / N, maxHp: d.maxHp.value };
}

describe.skipIf(!process.env.BALANCE_SIM)('first boss balance sim', () => {
  it('writes the table', () => {
    const lvl = levelFromXp(UNLOCK_PATH_XP);
    const levels = [lvl, lvl + 2, lvl + 3, lvl + 4, lvl + 6];
    const lines: string[] = [
      `Troll Chieftain: HP ${ENEMIES.troll_chieftain.hp}, damage ${ENEMIES.troll_chieftain.damage.min}-${ENEMIES.troll_chieftain.damage.max}, armor ${ENEMIES.troll_chieftain.armor}, magic resist ${ENEMIES.troll_chieftain.magicResist}. ${N} fights per cell, full HP, no potions, no hero regen in the fight.`,
      `Unlock-path XP ${UNLOCK_PATH_XP} = level ${lvl}.`,
      '',
      '| Hero | Gear | Win % | Avg fight s | Avg HP left on a win | Timeouts % | Max HP | Troll Bridge hint | Boss hint |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ];
    for (const level of levels) {
      for (const build of BUILDS) {
        for (const [label, q, rar] of [['Iron q25', 25, 'common'], ['Iron q50 green', 50, 'uncommon']] as const) {
          const s = bossHero(level, build, q, rar);
          const r = winRate(s, 'troll_chieftain', 5000 + level);
          const tb = dangerHint(s, 'troll_bridge');
          const bh = bossDangerHint(s, 'troll_chieftain');
          lines.push(`| L${level} ${build} | ${label} | ${Math.round(r.win * 100)} | ${(r.ms / 1000).toFixed(1)} | ${Math.round(r.hpLeft)} | ${Math.round(r.timeouts * 100)} | ${r.maxHp} | ${tb.level} (${tb.percent}%) | ${bh.level} (${bh.percent}%) |`);
        }
      }
    }
    const out = lines.join('\n');
    if (process.env.BALANCE_SIM_OUT) writeFileSync(process.env.BALANCE_SIM_OUT, out + '\n');
    expect(out.length).toBeGreaterThan(100);
  }, 600_000);
});
