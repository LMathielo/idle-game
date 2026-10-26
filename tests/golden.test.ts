// Golden tests: if one of these changes, the rules changed outcomes.
// Bump ENGINE_VERSION (src/engine/version.ts), check the change is intended, then update the hash.
// History: 1.1.0 → 1.2.0 (2026-10-26): save v3 (4 attributes, item defIds, no stored hp, stamina). The
// script gained stamina and attribute debug commands so stamina regen and the clock rules are pinned too.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCommand, type Command, ENGINE_VERSION, getDerivedStats, hashState, loadSave, newGame, simulate } from '../src/engine';
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
];

function runScript() {
  let s = newGame(0xc0ffee, T0);
  for (const step of SCRIPT) {
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

describe('golden', () => {
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
    }).toMatchInlineSnapshot(`
      {
        "actions": 18670,
        "engineVersion": "1.2.0",
        "hash": "c9727496",
        "heroLevel": 11,
        "nests": 113,
        "stamina": {
          "current": 72,
          "max": 100,
          "progressMs": 123000,
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
    expect(s.saveVersion).toBe(3);
    expect(s.flags).toEqual({ debugUsed: false });
    expect(s.character.attributes).toEqual({ strength: 5, dexterity: 5, endurance: 5, intelligence: 5 });
    expect(s.stats.totalActions).toBe(2499);
    // Banked progress carries over: 60s plus the stored remainder, at the stored skill level's interval.
    const interval = actionIntervalMs(ACTIVITIES.woodcutting, s.character.skills.woodcutting.level);
    const next = simulate(s, s.time.lastSimulatedAt + MIN);
    expect(next.summary.actions).toBe(Math.floor((MIN + s.activity!.progressMs) / interval));
    expect(next.summary.actions).toBeGreaterThan(0);
    expect(hashState(loadSave(raw))).toBe(hashState(s)); // migration is deterministic
  });

  it('frozen v2 save (tests/fixtures/save-v2.json) migrates to v3 without losing progress, and plays on', () => {
    // Produced by the 1.1.0 engine (save v2): woodcutting ~3h, +20k hero XP via debug.
    const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'save-v2.json'), 'utf8'));
    expect(raw.saveVersion).toBe(2);
    const s = loadSave(raw);
    expect(s.saveVersion).toBe(3);

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

    // Shape changes.
    expect(s.character.attributes).toEqual({ strength: 5, dexterity: 5, endurance: 5, intelligence: 5 });
    expect(s.character).not.toHaveProperty('hp');
    expect(s.character).not.toHaveProperty('maxHp');
    expect(s.stamina).toEqual({ current: 100, max: 100, progressMs: 0 });
    expect(Object.values(s.character.equipment).map((i) => [i!.id, i!.defId])).toEqual([
      ['start-rusty_gladius', 'rusty_gladius'],
      ['start-linen_tunic', 'linen_tunic'],
      ['start-worn_sandals', 'worn_sandals'],
    ]);

    // Stats come from the catalog through the new defIds: 2–4 + 5 STR, 3 armor + 5 END, level 4 pools.
    const d = getDerivedStats(s);
    expect([d.damage.min, d.damage.max, d.defense.value, d.maxHp.value, d.maxMana.value]).toEqual([7, 9, 8, 80, 35]);

    // Plays on: banked woodcutting progress carries over and actions run.
    const interval = actionIntervalMs(ACTIVITIES.woodcutting, s.character.skills.woodcutting.level);
    const next = simulate(s, s.time.lastSimulatedAt + MIN);
    expect(next.summary.actions).toBe(Math.floor((MIN + s.activity!.progressMs) / interval));
    expect(next.summary.actions).toBeGreaterThan(0);
    // And commands work on the migrated save.
    const spent = applyCommand(next.state, { id: 'v2-spend', type: 'DEBUG_SPEND_STAMINA', amount: 10 }, s.time.lastSimulatedAt + MIN);
    expect(spent.ok && spent.state.stamina.current).toBe(90);
    expect(hashState(loadSave(raw))).toBe(hashState(s)); // migration is deterministic
  });
});
