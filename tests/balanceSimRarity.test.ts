// Balance note for gear rarity tiers and affixes (engine 1.22.0). NOT a rule test: skipped unless BALANCE_SIM is set, and it only reports.
//
//   BALANCE_SIM=1 BALANCE_SIM_OUT=/tmp/rarity-balance.md npx vitest run tests/balanceSimRarity.test.ts
//
// The level-20 STR+END hero (no core, no training upgrades) in a full Iron set at the same quality, all green (uncommon) vs all blue (rare)
// vs all purple (epic), fights the Troll Chieftain (same strike code as the live fight: no hero regen inside, no potions, full HP).
// Blue and purple average over AFFIX_ROLLS different affix rolls of the whole set (their attributes and perks are random).
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { BOSSES, createRng, ENEMIES, type GameState, getDerivedStats, resolveFight } from '../src/engine';
import { enemyCombatSide, enemyFightOptions, heroCombatSide } from '../src/engine/combat';
import { bossHero } from './helpers';

const N = Number(process.env.BALANCE_SIM_N ?? 2000);
const AFFIX_ROLLS = Number(process.env.BALANCE_SIM_ROLLS ?? 40);
const LEVEL = 20;

function winRate(s: GameState, seed: number) {
  const d = getDerivedStats(s);
  const enemyDef = ENEMIES[BOSSES.troll_chieftain.enemyId];
  const hero = { hp: d.maxHp.value, ...heroCombatSide(d) };
  const enemy = { hp: enemyDef.hp, ...enemyCombatSide(enemyDef) };
  const opts = enemyFightOptions(enemyDef);
  let wins = 0;
  for (let i = 0; i < N; i++) {
    if (resolveFight(hero, enemy, createRng(seed + i * 7919), opts.maxFightMs, opts).won) wins++;
  }
  return { win: wins / N, maxHp: d.maxHp.value, dmg: d.damage };
}

describe.skipIf(!process.env.BALANCE_SIM)('gear rarity balance sim', () => {
  it('writes the table', () => {
    const lines = [
      `Level ${LEVEL} STR+END hero, full Iron set, Troll Chieftain, ${N} fights per cell; blue / purple average ${AFFIX_ROLLS} affix rolls.`,
      '',
      '| Quality | Green win % | Blue win % | Purple win % | Green max HP | Purple max HP (avg) | Green dmg | Purple dmg (avg) |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ];
    for (const q of [25, 50, 75, 100]) {
      const green = winRate(bossHero(LEVEL, 'STR+END', q, 'uncommon'), 9000 + q);
      const avg = (rarity: 'rare' | 'epic') => {
        let win = 0;
        let hp = 0;
        let min = 0;
        let max = 0;
        for (let k = 0; k < AFFIX_ROLLS; k++) {
          const r = winRate(bossHero(LEVEL, 'STR+END', q, rarity, 1000 + k), 9000 + q);
          win += r.win;
          hp += r.maxHp;
          min += r.dmg.min;
          max += r.dmg.max;
        }
        return { win: win / AFFIX_ROLLS, hp: hp / AFFIX_ROLLS, min: min / AFFIX_ROLLS, max: max / AFFIX_ROLLS };
      };
      const blue = avg('rare');
      const purple = avg('epic');
      lines.push(
        `| ${q} | ${(green.win * 100).toFixed(1)} | ${(blue.win * 100).toFixed(1)} | ${(purple.win * 100).toFixed(1)} | ${green.maxHp} | ${purple.hp.toFixed(0)} | ${green.dmg.min}-${green.dmg.max} | ${purple.min.toFixed(0)}-${purple.max.toFixed(0)} |`,
      );
    }
    const out = lines.join('\n');
    console.log(out);
    if (process.env.BALANCE_SIM_OUT) writeFileSync(process.env.BALANCE_SIM_OUT, out + '\n');
  }, 600_000);
});
