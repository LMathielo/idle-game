// Balance report for Hard and Extreme (engine 1.24.0). NOT a rule test: skipped unless BALANCE_SIM is set, and it only REPORTS (no tuning).
//
//   BALANCE_SIM=1 BALANCE_SIM_OUT=/tmp/difficulty-balance.md npx vitest run tests/balanceSimDifficulty.test.ts
//
// Plays N seeded fights per cell with resolveFight (the same strike code the live and offline fight uses; no hero regen inside a fight,
// no potions, every fight from full HP) for each Tier 1 stage and the Troll Chieftain, on Hard and on Extreme. A stage fight rolls its
// pack with rollPack (the engine's own roll); the boss is the single scaled Chieftain with its regen and 120 s limit. "Win" = the
// whole pack dead inside 60 s with the hero alive; the table is the share of such fights.
//
// Heroes (STR+END, the level-up points split evenly, no core, no training upgrades):
//   Iron q25 / Iron q50    the merchant's Iron set (common) and a green Iron set, at levels 20 / 25 / 30
//   Gold q50 purple        the best Gold-tier set (7 pieces incl. greaves) at quality 50, every piece EPIC with the best affixes for the build
//                          (Strength + Endurance) and the damage perk on the weapon / the armor perk elsewhere, at levels 25 / 30
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bossDangerHint,
  createRng,
  dangerHint,
  type Difficulty,
  DUNGEON_TIERS,
  DUNGEONS,
  ENEMIES,
  type EquipmentSlot,
  type GameState,
  getDerivedStats,
  resolveFight,
  rollPack,
} from '../src/engine';
import { bossEnemyAt } from '../src/engine';
import { enemyCombatSide, enemyFightOptions, heroCombatSide } from '../src/engine/combat';
import { makeItem } from '../src/engine/inventory';
import { bossHero } from './helpers';

const N = Number(process.env.BALANCE_SIM_N ?? 1000);

type Hero = { label: string; state: GameState };

const GOLD_SET: [EquipmentSlot, string, 'max_damage' | 'max_armor'][] = [
  ['weapon', 'gold_sword', 'max_damage'],
  ['helmet', 'gold_helm', 'max_armor'],
  ['armor', 'gold_chestplate', 'max_armor'],
  ['legs', 'gold_greaves', 'max_armor'],
  ['shield', 'gold_shield', 'max_armor'],
  ['gloves', 'gold_gloves', 'max_armor'],
  ['boots', 'gold_boots', 'max_armor'],
];

function goldHero(level: number): GameState {
  const base = bossHero(level, 'STR+END', 50, 'epic');
  const equipment = { ...base.character.equipment };
  for (const [slot, defId, perk] of GOLD_SET) {
    equipment[slot] = makeItem(defId, 1, `${defId}#hero`, { quality: 50, rarity: 'epic', affixes: { attributes: ['strength', 'endurance'], perk } });
  }
  const s: GameState = { ...base, character: { ...base.character, equipment } };
  return { ...s, character: { ...s.character, hp: getDerivedStats(s).maxHp.value } };
}

function heroes(): Hero[] {
  const out: Hero[] = [];
  for (const level of [20, 25, 30]) {
    out.push({ label: `L${level} Iron q25`, state: bossHero(level, 'STR+END', 25, 'common') });
    out.push({ label: `L${level} Iron q50`, state: bossHero(level, 'STR+END', 50, 'uncommon') });
  }
  for (const level of [25, 30]) out.push({ label: `L${level} Gold q50 purple`, state: goldHero(level) });
  return out;
}

function stageWinRate(s: GameState, stage: keyof typeof DUNGEONS, d: Difficulty, seed: number): number {
  const stats = getDerivedStats(s);
  const hero = { hp: stats.maxHp.value, ...heroCombatSide(stats) };
  const enemy = ENEMIES[DUNGEONS[stage].enemyId];
  let wins = 0;
  for (let i = 0; i < N; i++) {
    const rng = createRng(seed + i * 7919);
    const pack = rollPack(rng, enemy, d);
    const mobs = pack.mobs.map((m) => ({ ...enemyCombatSide(m.enemy), hp: m.enemy.hp }));
    if (resolveFight(hero, mobs, pack.rng).won) wins += 1;
  }
  return wins / N;
}

function bossWinRate(s: GameState, d: Difficulty, seed: number): number {
  const stats = getDerivedStats(s);
  const hero = { hp: stats.maxHp.value, ...heroCombatSide(stats) };
  const enemy = bossEnemyAt('troll_chieftain', d);
  const opts = enemyFightOptions(enemy);
  let wins = 0;
  for (let i = 0; i < N; i++) {
    if (resolveFight(hero, { hp: enemy.hp, ...enemyCombatSide(enemy) }, createRng(seed + i * 7919), opts.maxFightMs, opts).won) wins += 1;
  }
  return wins / N;
}

describe.skipIf(!process.env.BALANCE_SIM)('Hard / Extreme balance sim (report only)', () => {
  it('writes the tables', () => {
    const stages = DUNGEON_TIERS[0].stages;
    const lines: string[] = [`${N} seeded fights per cell, every fight from full HP, no potions, no hero regen inside a fight. Win % = the whole pack dead within 60 s (the boss: within 120 s).`, ''];
    for (const d of ['hard', 'extreme'] as const) {
      lines.push(`### ${d === 'hard' ? 'Hard' : 'Extreme'}`, '');
      lines.push(`| Hero | Max HP | ${stages.map((id) => DUNGEONS[id].name).join(' | ')} | Troll Chieftain |`);
      lines.push(`| --- | --- | ${stages.map(() => '---').join(' | ')} | --- |`);
      for (const h of heroes()) {
        const seed = 9000 + h.label.length;
        const cells = stages.map((id) => `${Math.round(stageWinRate(h.state, id, d, seed) * 100)}`);
        const boss = Math.round(bossWinRate(h.state, d, seed) * 100);
        lines.push(`| ${h.label} | ${getDerivedStats(h.state).maxHp.value} | ${cells.join(' | ')} | ${boss} |`);
      }
      lines.push('');
    }
    lines.push('### Danger hints (same heroes, average pack)', '', '| Hero | Difficulty | Troll Bridge hint | Boss hint |', '| --- | --- | --- | --- |');
    for (const h of heroes()) {
      for (const d of ['hard', 'extreme'] as const) {
        const a = dangerHint(h.state, 'troll_bridge', d);
        const b = bossDangerHint(h.state, 'troll_chieftain', d);
        lines.push(`| ${h.label} | ${d} | ${a.level} (${a.percent}%) | ${b.level} (${b.percent}%) |`);
      }
    }
    const out = lines.join('\n');
    if (process.env.BALANCE_SIM_OUT) writeFileSync(process.env.BALANCE_SIM_OUT, out + '\n');
    expect(out.length).toBeGreaterThan(100);
  }, 600_000);
});
