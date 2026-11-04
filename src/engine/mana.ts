// Current mana and its regen (pure, 1.17.0, owner-approved 2026-11-03). Mirrors current HP (src/engine/hp.ts).
// Max mana is derived (getDerivedStats: 20 + 5 per level above 1); current mana is stored on the character.
//
//   regen per minute = manaRegen.basePerMin + manaRegen.perIntelligence × total INT     (INT 0 → 5/min)
//
// The remainder is banked in character.manaRegenProgress with the same integer "units per minute" banking as HP
// (src/engine/regen.ts), so it is exact across resumes and rate changes. Mana regenerates wherever HP does (regenHeroPools
// in hp.ts: idle, gathering, training, dungeon search and fight, beyond the offline cap, offline). A level-up raises max
// mana, not current mana (as HP). Nothing spends mana yet.
import { type AttributeInput, effectiveAttributes, type TrainingLevels } from './attributes';
import { STATS } from './config/stats';
import { msUntilFull, regenAmount } from './regen';
import { getDerivedStats, type StatsInput } from './stats';
import type { Character } from './types';

/** Uses the TOTAL intelligence (normal + core). */
export function manaRegenPerMinute(state: AttributeInput): number {
  const rate = STATS.manaRegen.basePerMin + STATS.manaRegen.perIntelligence * effectiveAttributes(state).intelligence;
  return Math.max(0, rate);
}

export function maxManaOf(state: StatsInput): number {
  return getDerivedStats(state).maxMana.value;
}

export type ManaPool = { mana: number; manaRegenProgress: number };

/** Adds regen for `elapsedMs` of sanitized time. Never above max; 0 banked while full. Same object when nothing changes. */
export function regenMana<P extends ManaPool>(pool: P, maxMana: number, ratePerMin: number, elapsedMs: number): P {
  const r = regenAmount(pool.mana, pool.manaRegenProgress, maxMana, ratePerMin, elapsedMs);
  return r ? { ...pool, mana: r[0], manaRegenProgress: r[1] } : pool;
}

export type ManaView = {
  mana: number;
  maxMana: number;
  regenPerMin: number;
  full: boolean;
  /** ms until full (0 when full). */
  fullInMs: number;
};

/** Read-only view for UIs. */
export function manaView(state: {
  character: Pick<Character, 'level' | 'attributes' | 'spentPoints' | 'equipment' | 'mana' | 'manaRegenProgress'>;
  training: TrainingLevels;
}): ManaView {
  const c = state.character;
  const maxMana = maxManaOf(state);
  const regenPerMin = manaRegenPerMinute(state);
  const mana = Math.min(c.mana, maxMana);
  const full = mana >= maxMana;
  return { mana, maxMana, regenPerMin, full, fullInMs: full ? 0 : msUntilFull(mana, c.manaRegenProgress, maxMana, regenPerMin) };
}
