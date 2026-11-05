// Balance check for the stats rework (engine 1.19.0). NOT a rule test: it is skipped unless BALANCE_SIM is set, and it only reports.
//
//   BALANCE_SIM=1 BALANCE_SIM_OUT=/tmp/balance.md npx vitest run tests/balanceSim.test.ts
//
// For a hero at level 1 / 5 / 10 / 15 with all level-up points (5 per level above 1) spent in one attribute (STR, DEX, END, INT) or
// spread evenly (balanced), at core 0 / 10 / 20 on all four attributes, with the starting gear, it plays N seeded fights from full HP
// against each of the five enemies (resolveFight: no regen inside the fight) and writes the win rate, the average fight time, the
// average HP lost (a loss costs all the HP the hero had) and the danger label. The same heroes are played on the 1.18.0 formulas
// (damage = weapon + 10 + total STR, armor = gear + 10 + total END, max HP = 50 + 10 per level, no crits, no magic) for comparison.
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_POINTS,
  createRng,
  dangerHint,
  DUNGEON_IDS,
  DUNGEONS,
  ENEMIES,
  type EnemyId,
  type GameState,
  getDerivedStats,
  resolveFight,
} from '../src/engine';
import { enemyCombatSide, heroCombatSide } from '../src/engine/dungeon';
import { builtGame, fightSide, T0, withCore } from './helpers';

const N = Number(process.env.BALANCE_SIM_N ?? 400);
const LEVELS = [1, 5, 10, 15] as const;
const CORES = [0, 10, 20] as const;
type Build = 'STR' | 'DEX' | 'END' | 'INT' | 'balanced';
const BUILDS: Build[] = ['STR', 'DEX', 'END', 'INT', 'balanced'];
const KEYS = { STR: 'strength', DEX: 'dexterity', END: 'endurance', INT: 'intelligence' } as const;

function heroAt(level: number, build: Build, core: number): GameState {
  const points = ATTRIBUTE_POINTS.unspentPerLevel * (level - 1);
  const spent = { strength: 0, dexterity: 0, endurance: 0, intelligence: 0 };
  if (build === 'balanced') {
    const q = Math.floor(points / 4);
    spent.strength = spent.dexterity = spent.endurance = spent.intelligence = q;
    spent.strength += points - 4 * q; // the remainder goes to STR
  } else {
    spent[KEYS[build]] = points;
  }
  const s = withCore(builtGame(1, T0), { strength: core, dexterity: core, endurance: core, intelligence: core });
  return { ...s, character: { ...s.character, level, spentPoints: spent } };
}

type Cell = { win: number; ms: number; hpLost: number };

function play(hero: ReturnType<typeof fightSide> & { hp: number }, enemyId: EnemyId, seed: number): Cell {
  const enemy = { hp: ENEMIES[enemyId].hp, ...enemyCombatSide(ENEMIES[enemyId]) };
  let wins = 0;
  let ms = 0;
  let lost = 0;
  for (let i = 0; i < N; i++) {
    const r = resolveFight(hero, enemy, createRng(seed + i * 7919));
    if (r.won) wins++;
    ms += r.durationMs;
    lost += hero.hp - r.heroHp;
  }
  return { win: wins / N, ms: ms / N, hpLost: lost / N };
}

const fmt = (c: Cell) => `${Math.round(c.win * 100)}% ${(c.ms / 1000).toFixed(1)}s -${Math.round(c.hpLost)}`;

/** The 1.18.0 hero: no crits, no magic, END is only armor and HP regen (not max HP). */
function hero118(s: GameState) {
  const d = getDerivedStats(s);
  const total = (k: keyof GameState['character']['spentPoints']) => s.character.spentPoints[k] + s.training.attributes[k].level;
  const weapon = d.damage.breakdown[0];
  const armorGear = d.armor.breakdown.filter((p) => p.source === 'armor').reduce((n, p) => n + p.value, 0);
  const maxHp = 50 + 10 * (s.character.level - 1);
  return {
    hp: maxHp,
    maxHp,
    ...fightSide({ damage: { min: weapon.min + 10 + total('strength'), max: weapon.max + 10 + total('strength') }, armor: armorGear + 10 + total('endurance'), magicResist: 0 }),
  };
}

function danger118(hero: ReturnType<typeof hero118>, enemyId: EnemyId): string {
  // the 1.18.0 hint: average over every roll (armor-reduced), enemy hits before the kill, as a percent of max HP
  const e = ENEMIES[enemyId];
  const red = (raw: number, armor: number) => Math.max(1, Math.floor((2 * raw * 50 + (armor + 50)) / (2 * (armor + 50))));
  const avg = (min: number, max: number, armor: number) => {
    let sum = 0;
    for (let r = min; r <= max; r++) sum += red(r, armor);
    return sum / (max - min + 1);
  };
  const heroAvg = avg(hero.damage.min, hero.damage.max, e.armor);
  const enemyAvg = avg(e.damage.min, e.damage.max, hero.armor);
  const hits = Math.ceil(e.hp / heroAvg);
  const fightMs = hits * 1000;
  const enemyHits = Math.max(0, Math.ceil(fightMs / e.attackIntervalMs) - 1);
  const pct = Math.round((Math.round(enemyHits * enemyAvg) * 100) / hero.maxHp);
  return fightMs > 60_000 || pct >= 100 ? 'deadly' : pct >= 40 ? 'tough' : 'easy';
}

describe.skipIf(!process.env.BALANCE_SIM)('stats rework balance sim', () => {
  it('writes the table', () => {
    const enemies = DUNGEON_IDS.map((id) => DUNGEONS[id].enemyId);
    const lines: string[] = [];
    const head = `| Hero | ${enemies.map((e) => ENEMIES[e].name).join(' | ')} |`;
    const sep = `| --- | ${enemies.map(() => '---').join(' | ')} |`;
    const summary: Record<string, { new: number; old: number }> = {};
    for (const [title, version] of [['1.19.0 (new)', 'new'], ['1.18.0 formulas (before)', 'old']] as const) {
      lines.push(`### ${title}`, '', `Each cell: win rate, average fight time, average HP lost per fight (a loss costs the hero's whole HP), danger label. ${N} fights per cell.`, '');
      lines.push(head, sep);
      for (const level of LEVELS) {
        for (const build of BUILDS) {
          for (const core of CORES) {
            if (level === 1 && build !== 'balanced') continue; // no points to spend at level 1: one row
            const s = heroAt(level, build, core);
            const cells = enemies.map((enemyId, i) => {
              const seed = 1000 + level * 100 + i;
              if (version === 'new') {
                const d = getDerivedStats(s);
                const hero = { hp: d.maxHp.value, ...heroCombatSide(d) };
                const c = play(hero, enemyId, seed);
                const key = `L${level} ${build} c${core} ${enemyId}`;
                (summary[key] ??= { new: 0, old: 0 }).new = c.win;
                return `${fmt(c)} ${dangerHint(s, DUNGEON_IDS[i]).level}`;
              }
              const h = hero118(s);
              const c = play(h, enemyId, seed);
              (summary[`L${level} ${build} c${core} ${enemyId}`] ??= { new: 0, old: 0 }).old = c.win;
              return `${fmt(c)} ${danger118(h, enemyId)}`;
            });
            lines.push(`| L${level} ${level === 1 ? 'new hero' : build} core ${core} | ${cells.join(' | ')} |`);
          }
        }
      }
      lines.push('');
    }
    const out = lines.join('\n');
    if (process.env.BALANCE_SIM_OUT) writeFileSync(process.env.BALANCE_SIM_OUT, out + '\n');
    expect(out.length).toBeGreaterThan(100);
  }, 600_000);
});
