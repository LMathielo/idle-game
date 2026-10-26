// Golden tests: if one of these changes, the rules changed outcomes.
// Bump ENGINE_VERSION (src/engine/version.ts), check the change is intended, then update the hash.
// History: 1.1.0 → 1.2.0 (2026-10-26): save v3 (4 attributes, item defIds, no stored hp, stamina). The
// script gained stamina and attribute debug commands so stamina regen and the clock rules are pinned too.
// 1.2.0 → 1.3.0 (2026-10-26): save v4 (current HP + regen, dungeon state). Woodcutting outcomes did not
// change (same actions, levels, nests and stamina in the first part of the script); the hash changed
// because of the new fields. The script gained a dungeon segment: start, skip, HP debug, 3h of auto-repeat
// runs, then woodcutting cancels the run in progress. Council round 1 (still 1.3.0, save v4 not shipped):
// FightRecord gained `endReason` and SKIP_DUNGEON_RUN carries `run` + `maxCost`; the hash changed
// for that field only (same runs, wins, gold, HP and stamina).
// 1.3.0 → 1.4.0 (2026-10-26): save v5 (dungeon tiers 1–5, per-dungeon counters, `rat_cellar_1` renamed
// `rat_cellar`). Rat Cellar outcomes did not change (same 38 runs/wins, gold 162, HP, stamina and level
// at the end of the old script); the hash changed because of the new `byDungeon` field and the id. The
// script gained a tier segment: DEBUG_ADD_DUNGEON_WINS unlocks Bat Cave, a locked Wolf Den start is
// refused, then 2 h of Bat Cave runs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCommand, type Command, CURRENT_SAVE_VERSION, ENGINE_VERSION, RELEASED_ENGINES, getDerivedStats, hashState, loadSave, newGame, simulate } from '../src/engine';
import { actionIntervalMs, ACTIVITIES } from '../src/engine';
import { HOUR, MIN, SEC, T0 } from './helpers';

const SCRIPT: { at: number; cmd?: Command }[] = [
  { at: T0 + SEC, cmd: { id: 'g1', type: 'START_ACTIVITY', kind: 'woodcutting' } },
  { at: T0 + 37 * MIN },
  { at: T0 + 5 * HOUR },
  { at: T0 + 5 * HOUR + 3 * SEC, cmd: { id: 'g2', type: 'DEBUG_GRANT_HERO_XP', amount: 250_000 } },
  { at: T0 + 5 * HOUR + 4 * SEC, cmd: { id: 'g4', type: 'DEBUG_SPEND_STAMINA', amount: 30 } },
  { at: T0 + 5 * HOUR + 5 * SEC, cmd: { id: 'g5', type: 'DEBUG_ADD_ATTRIBUTE', attribute: 'strength', amount: 3 } },
  { at: T0 + 30 * HOUR }, // forward_capped (stamina refills: not bound by the 8h cap)
  { at: T0 + 28 * HOUR }, // backward
  { at: T0 + 28 * HOUR + SEC, cmd: { id: 'g6', type: 'DEBUG_SPEND_STAMINA', amount: 40 } }, // paused clock
  { at: T0 + 31 * HOUR, cmd: { id: 'g3', type: 'STOP_ACTIVITY' } }, // 1h past highestSeenAt: +12
  { at: T0 + 31 * HOUR + 123 * SEC }, // remainder banked
  { at: T0 + 31 * HOUR + 200 * SEC, cmd: { id: 'd1', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' } },
  { at: T0 + 31 * HOUR + 320 * SEC, cmd: { id: 'd2', type: 'SKIP_DUNGEON_RUN', run: 1, maxCost: 3 } }, // 2:50 left → 3 stamina
  { at: T0 + 31 * HOUR + 330 * SEC, cmd: { id: 'd3', type: 'DEBUG_SET_HERO_HP', hp: 1 } },
  { at: T0 + 34 * HOUR + 330 * SEC }, // 3h of runs, HP regen interleaved
  { at: T0 + 34 * HOUR + 400 * SEC, cmd: { id: 'd4', type: 'START_ACTIVITY', kind: 'woodcutting' } }, // run lost
  { at: T0 + 34 * HOUR + 401 * SEC, cmd: { id: 'd5', type: 'STOP_ACTIVITY' } },
  // 1.4.0: tiers. 38 Rat Cellar wins already unlock Bat Cave; +10 debug wins in Bat Cave (15 needed for Wolf Den).
  { at: T0 + 34 * HOUR + 402 * SEC, cmd: { id: 't1', type: 'DEBUG_ADD_DUNGEON_WINS', dungeonId: 'bat_cave', amount: 10 } },
  { at: T0 + 34 * HOUR + 403 * SEC, cmd: { id: 't2', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'bat_cave' } },
  { at: T0 + 36 * HOUR + 403 * SEC }, // 2h of Bat Cave runs (DEX 10 → 6:50 each)
];

function runScript(steps = SCRIPT) {
  let s = newGame(0xc0ffee, T0);
  for (const step of steps) {
    if (step.cmd) {
      const r = applyCommand(s, step.cmd, step.at);
      if (!r.ok) throw new Error(r.error.message);
      s = r.state;
    } else {
      s = simulate(s, step.at).state;
    }
  }
  return s;
}

describe('save version ↔ engine version (RELEASED_ENGINES)', () => {
  // Rule (docs/ENGINE.md): every save-version bump ships with an ENGINE_VERSION bump, and every engine
  // bump appends a row to RELEASED_ENGINES (src/engine/version.ts). Replay trusts no other labels.
  const semver = (v: string) => v.split('.').map(Number) as [number, number, number];
  const cmp = (a: string, b: string) => {
    const [x, y] = [semver(a), semver(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  };

  it('the last released engine is the current one, writing the current save version', () => {
    expect(RELEASED_ENGINES.at(-1)).toEqual({ engine: ENGINE_VERSION, save: CURRENT_SAVE_VERSION });
  });

  it('engines strictly increase; save versions never go down and only change with a new engine', () => {
    for (let i = 1; i < RELEASED_ENGINES.length; i++) {
      const [prev, next] = [RELEASED_ENGINES[i - 1], RELEASED_ENGINES[i]];
      expect(cmp(next.engine, prev.engine)).toBeGreaterThan(0);
      expect(next.save).toBeGreaterThanOrEqual(prev.save);
    }
    expect(RELEASED_ENGINES.map((r) => [r.engine, r.save])).toEqual([
      ['1.0.0', 1],
      ['1.1.0', 2],
      ['1.2.0', 3],
      ['1.3.0', 4],
      ['1.4.0', 5],
    ]);
  });
});

describe('golden', () => {
  it('the 1.3.0 part of the script keeps its exact outcomes (Rat Cellar rules unchanged in 1.4.0)', () => {
    const s = runScript(SCRIPT.slice(0, SCRIPT.findIndex((x) => x.cmd?.id === 't1')));
    expect({
      heroLevel: s.character.level,
      actions: s.stats.totalActions,
      stamina: s.stamina,
      hp: [s.character.hp, s.character.hpRegenProgress],
      gold: s.character.gold,
      dungeon: s.dungeon.totals,
      lastFightRounds: s.dungeon.lastFight?.rounds,
    }).toEqual({
      heroLevel: 11,
      actions: 18670,
      stamina: { current: 100, max: 100, progressMs: 0 },
      hp: [150, 0],
      gold: 162,
      dungeon: { runs: 38, wins: 38, losses: 0 },
      lastFightRounds: 2,
    });
    expect(s.dungeon.byDungeon).toEqual({ rat_cellar: { runs: 38, wins: 38, losses: 0 } });
    // A locked tier is refused at this point (Wolf Den needs 15 Bat Cave wins).
    const locked = applyCommand(s, { id: 'lk', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'wolf_den' }, T0 + 34 * HOUR + 402 * SEC);
    expect(locked).toEqual({ ok: false, error: expect.objectContaining({ code: 'DUNGEON_LOCKED' }) });
  });

  it('fixed seed + fixed script → fixed final state hash', () => {
    const s = runScript();
    expect({
      engineVersion: ENGINE_VERSION,
      hash: hashState(s),
      heroLevel: s.character.level,
      woodcutting: s.character.skills.woodcutting.level,
      actions: s.stats.totalActions,
      nests: s.stats.itemsGathered.bird_nest,
      stamina: s.stamina,
      strength: s.character.attributes.strength,
      hp: [s.character.hp, s.character.hpRegenProgress],
      gold: s.character.gold,
      dungeon: s.dungeon.totals,
      byDungeon: s.dungeon.byDungeon,
      lastFightRounds: s.dungeon.lastFight?.rounds,
      batWings: s.inventory.items.find((i) => i.defId === 'bat_wing')?.quantity,
    }).toMatchInlineSnapshot(`
      {
        "actions": 18670,
        "batWings": 9,
        "byDungeon": {
          "bat_cave": {
            "losses": 0,
            "runs": 27,
            "wins": 27,
          },
          "rat_cellar": {
            "losses": 0,
            "runs": 38,
            "wins": 38,
          },
        },
        "dungeon": {
          "losses": 0,
          "runs": 65,
          "wins": 65,
        },
        "engineVersion": "1.4.0",
        "gold": 300,
        "hash": "1a586ed3",
        "heroLevel": 11,
        "hp": [
          150,
          0,
        ],
        "lastFightRounds": 5,
        "nests": 113,
        "stamina": {
          "current": 100,
          "max": 100,
          "progressMs": 0,
        },
        "strength": 13,
        "woodcutting": 15,
      }
    `);
  });

  it('frozen v1 save (tests/fixtures/save-v1.json) still loads, migrates and plays', () => {
    const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'save-v1.json'), 'utf8'));
    expect(raw.saveVersion).toBe(1);
    const s = loadSave(raw);
    expect(s.saveVersion).toBe(5);
    expect(s.flags).toEqual({ debugUsed: false });
    expect(s.character.attributes).toEqual({ strength: 10, dexterity: 10, endurance: 10, intelligence: 10 });
    expect(s.stats.totalActions).toBe(2499);
    // Banked progress carries over: 60s plus the stored remainder, at the stored skill level's interval.
    const interval = actionIntervalMs(ACTIVITIES.woodcutting, s.character.skills.woodcutting.level);
    const next = simulate(s, s.time.lastSimulatedAt + MIN);
    expect(next.summary.actions).toBe(Math.floor((MIN + s.activity!.progressMs) / interval));
    expect(next.summary.actions).toBeGreaterThan(0);
    expect(hashState(loadSave(raw))).toBe(hashState(s)); // migration is deterministic
  });

  it('frozen v2 save (tests/fixtures/save-v2.json) migrates to v5 without losing progress, and plays on', () => {
    // Produced by the 1.1.0 engine (save v2): woodcutting ~3h, +20k hero XP via debug.
    const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'save-v2.json'), 'utf8'));
    expect(raw.saveVersion).toBe(2);
    const s = loadSave(raw);
    expect(s.saveVersion).toBe(5);

    // Progress kept: level, XP, skills, woodcutting banked time, inventory, stats, rng, time, flags.
    expect(s.character.level).toBe(raw.character.level);
    expect(s.character.level).toBe(4);
    expect(s.character.xp).toBe(raw.character.xp);
    expect(s.character.gold).toBe(raw.character.gold);
    expect(s.character.skills).toEqual(raw.character.skills);
    expect(s.character.skills.woodcutting.level).toBe(8);
    expect(s.activity).toEqual(raw.activity);
    expect(s.stats).toEqual(raw.stats);
    expect(s.rng).toEqual(raw.rng);
    expect(s.time).toEqual(raw.time);
    expect(s.offline).toEqual(raw.offline);
    expect(s.flags).toEqual({ debugUsed: true });
    expect(s.inventory.capacity).toBe(raw.inventory.capacity);
    expect(s.inventory.items.map((i) => [i.id, i.defId, i.quantity])).toEqual([
      ['bread', 'bread', 3],
      ['oak_logs', 'oak_logs', 3785],
      ['bird_nest', 'bird_nest', 20],
    ]);

    // Shape changes. The fixture had 5 everywhere: raised to the new-hero baseline of 10.
    expect(raw.character.attributes).toMatchObject({ strength: 5, dexterity: 5, constitution: 5, intelligence: 5 });
    expect(s.character.attributes).toEqual({ strength: 10, dexterity: 10, endurance: 10, intelligence: 10 });
    expect(s.character).not.toHaveProperty('maxHp');
    expect(s.character.hp).toBe(80); // v4: full at level 4 (the v2 hp field was dropped by v3)
    expect(s.stamina).toEqual({ current: 100, max: 100, progressMs: 0 });
    expect(Object.values(s.character.equipment).map((i) => [i!.id, i!.defId])).toEqual([
      ['start-rusty_gladius', 'rusty_gladius'],
      ['start-linen_tunic', 'linen_tunic'],
      ['start-worn_sandals', 'worn_sandals'],
    ]);

    // Stats come from the catalog through the new defIds: 2–4 + 10 STR, 3 armor + 10 END, level 4 pools.
    const d = getDerivedStats(s);
    expect([d.damage.min, d.damage.max, d.defense.value, d.maxHp.value, d.maxMana.value]).toEqual([12, 14, 13, 80, 35]);

    // Plays on: banked woodcutting progress carries over and actions run.
    const interval = actionIntervalMs(ACTIVITIES.woodcutting, s.character.skills.woodcutting.level);
    const next = simulate(s, s.time.lastSimulatedAt + MIN);
    expect(next.summary.actions).toBe(Math.floor((MIN + s.activity!.progressMs) / interval));
    expect(next.summary.actions).toBeGreaterThan(0);
    // Logs keep stacking on the migrated stack (matched by defId).
    expect(next.state.inventory.items.filter((i) => i.defId === 'oak_logs')).toHaveLength(1);
    expect(next.state.inventory.items.find((i) => i.defId === 'oak_logs')?.quantity).toBe(3785 + next.summary.actions);
    // And commands work on the migrated save.
    const spent = applyCommand(next.state, { id: 'v2-spend', type: 'DEBUG_SPEND_STAMINA', amount: 10 }, s.time.lastSimulatedAt + MIN);
    expect(spent.ok && spent.state.stamina.current).toBe(90);
    expect(hashState(loadSave(raw))).toBe(hashState(s)); // migration is deterministic
  });

  it('frozen v3 save (tests/fixtures/save-v3.json) migrates to v5 (via v4: full HP) and plays on, dungeon included', () => {
    // Produced by the 1.2.0 engine (save v3), before the dungeon: woodcutting ~3h, +30k hero XP,
    // +5 DEX, +2 END and 40 stamina spent via debug.
    const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'save-v3.json'), 'utf8'));
    expect(raw.saveVersion).toBe(3);
    expect(raw.character).not.toHaveProperty('hp');
    const s = loadSave(raw);
    expect(s.saveVersion).toBe(5);
    expect(hashState(loadSave(raw))).toBe(hashState(s)); // deterministic

    // Everything from v3 survives as it was.
    const { hp, hpRegenProgress, ...character } = s.character;
    expect(character).toEqual(raw.character);
    const { dungeon, character: _c, saveVersion: _v, ...rest } = s;
    const { character: _rc, saveVersion: _rv, ...rawRest } = raw;
    expect(rest).toEqual(rawRest);

    // New: full HP at level 5 (50 + 10 × 4), empty fight state.
    expect(s.character.level).toBe(5);
    expect([hp, hpRegenProgress]).toEqual([90, 0]);
    expect(dungeon).toEqual({ lastFight: null, totals: { runs: 0, wins: 0, losses: 0 }, byDungeon: {} });
    expect(s.activity?.kind).toBe('woodcutting');

    // Plays on: woodcutting banked progress carries over, then a dungeon with DEX 15 runs 4:45.
    const interval = actionIntervalMs(ACTIVITIES.woodcutting, s.character.skills.woodcutting.level);
    const next = simulate(s, s.time.lastSimulatedAt + MIN);
    expect(next.summary.actions).toBe(Math.floor((MIN + (s.activity?.progressMs ?? 0)) / interval));
    const at = s.time.lastSimulatedAt + MIN;
    const d = applyCommand(next.state, { id: 'v3-d', type: 'START_ACTIVITY', kind: 'dungeon', dungeonId: 'rat_cellar' }, at);
    if (!d.ok) throw new Error(d.error.message);
    expect(simulate(d.state, at + 285 * SEC - 1).state.dungeon.totals.runs).toBe(0);
    const run = simulate(d.state, at + 285 * SEC).state;
    expect(run.dungeon.totals.runs).toBe(1);
    expect(run.dungeon.lastFight?.heroMaxHp).toBe(90);
  });
});
