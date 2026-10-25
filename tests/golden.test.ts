// Golden tests: if one of these changes, the rules changed outcomes.
// Bump ENGINE_VERSION (src/engine/version.ts), check the change is intended, then update the hash.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCommand, type Command, ENGINE_VERSION, hashState, loadSave, newGame, simulate } from '../src/engine';
import { actionIntervalMs, ACTIVITIES } from '../src/engine';
import { HOUR, MIN, SEC, T0 } from './helpers';

const SCRIPT: { at: number; cmd?: Command }[] = [
  { at: T0 + SEC, cmd: { id: 'g1', type: 'START_ACTIVITY', kind: 'woodcutting' } },
  { at: T0 + 37 * MIN },
  { at: T0 + 5 * HOUR },
  { at: T0 + 5 * HOUR + 3 * SEC, cmd: { id: 'g2', type: 'DEBUG_GRANT_HERO_XP', amount: 250_000 } },
  { at: T0 + 30 * HOUR }, // forward_capped
  { at: T0 + 28 * HOUR }, // backward
  { at: T0 + 31 * HOUR, cmd: { id: 'g3', type: 'STOP_ACTIVITY' } },
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
    }).toMatchInlineSnapshot(`
      {
        "actions": 18670,
        "engineVersion": "1.1.0",
        "hash": "3d9c290d",
        "heroLevel": 11,
        "nests": 113,
        "woodcutting": 15,
      }
    `);
  });

  it('frozen v1 save (tests/fixtures/save-v1.json) still loads, migrates and plays', () => {
    const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'save-v1.json'), 'utf8'));
    expect(raw.saveVersion).toBe(1);
    const s = loadSave(raw);
    expect(s.saveVersion).toBe(2);
    expect(s.flags).toEqual({ debugUsed: false });
    expect(s.stats.totalActions).toBe(2499);
    // Banked progress carries over: 60s plus the stored remainder, at the stored skill level's interval.
    const interval = actionIntervalMs(ACTIVITIES.woodcutting, s.character.skills.woodcutting.level);
    const next = simulate(s, s.time.lastSimulatedAt + MIN);
    expect(next.summary.actions).toBe(Math.floor((MIN + s.activity!.progressMs) / interval));
    expect(next.summary.actions).toBeGreaterThan(0);
    expect(hashState(loadSave(raw))).toBe(hashState(s)); // migration is deterministic
  });
});
