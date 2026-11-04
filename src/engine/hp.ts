// Current HP and its regen (pure). Max HP is derived (getDerivedStats); current HP is stored.
//
//   regen per minute = hpRegen.basePerMin + hpRegen.perEndurance × total END     (END 0 → 15/min, 1.16.0)
//
// The remainder is banked in character.hpRegenProgress in "HP·ms per minute" units: each ms adds the
// rate, and every 60 000 units is 1 HP (src/engine/regen.ts, shared with mana). Integer math only, exact across resumes
// and rate changes. A level-up raises max HP, not current HP.
import { type AttributeInput, effectiveAttributes, type TrainingLevels } from './attributes';
import { STATS } from './config/stats';
import { manaRegenPerMinute, regenMana } from './mana';
import { msUntilFull, REGEN_UNIT, regenAmount } from './regen';
import { getDerivedStats, type StatsInput } from './stats';
import type { Character, GameState } from './types';

/** Units of hpRegenProgress per HP: one minute. */
export const HP_REGEN_UNIT = REGEN_UNIT;

/** Uses the TOTAL endurance (normal + core). */
export function hpRegenPerMinute(state: AttributeInput): number {
  const rate = STATS.hpRegen.basePerMin + STATS.hpRegen.perEndurance * effectiveAttributes(state).endurance;
  return Math.max(0, rate);
}

export function maxHpOf(state: StatsInput): number {
  return getDerivedStats(state).maxHp.value;
}

export type HpPool = { hp: number; hpRegenProgress: number };

/**
 * Adds regen for `elapsedMs` of sanitized time (regenAmount, src/engine/regen.ts). Never above max; at max the
 * remainder is 0 (time spent full is not banked). Returns the same object when nothing changes.
 */
export function regenHp<P extends HpPool>(pool: P, maxHp: number, ratePerMin: number, elapsedMs: number): P {
  const r = regenAmount(pool.hp, pool.hpRegenProgress, maxHp, ratePerMin, elapsedMs);
  return r ? { ...pool, hp: r[0], hpRegenProgress: r[1] } : pool;
}

/**
 * Regenerates the hero's pools (current HP and current mana) for `elapsedMs`, at the rates and maxima of this moment.
 * Every regen in simulate() goes through here (idle, gathering, training, dungeon search and fight, beyond the cap), so
 * mana regenerates exactly where HP does. Keeps the same character object when nothing changes.
 */
export function regenHeroPools(draft: GameState, elapsedMs: number): void {
  if (!(elapsedMs > 0)) return;
  const stats = getDerivedStats(draft);
  const withHp = regenHp(draft.character, stats.maxHp.value, hpRegenPerMinute(draft), elapsedMs);
  draft.character = regenMana(withHp, stats.maxMana.value, manaRegenPerMinute(draft), elapsedMs);
}

export type HpView = {
  hp: number;
  maxHp: number;
  regenPerMin: number;
  full: boolean;
  /** ms until full (0 when full). */
  fullInMs: number;
};

/** Read-only view for UIs. */
export function hpView(state: {
  character: Pick<Character, 'level' | 'attributes' | 'spentPoints' | 'equipment' | 'hp' | 'hpRegenProgress'>;
  training: TrainingLevels;
}): HpView {
  const c = state.character;
  const maxHp = maxHpOf(state);
  const regenPerMin = hpRegenPerMinute(state);
  const hp = Math.min(c.hp, maxHp);
  if (hp >= maxHp) return { hp, maxHp, regenPerMin, full: true, fullInMs: 0 };
  return { hp, maxHp, regenPerMin, full: false, fullInMs: msUntilFull(hp, c.hpRegenProgress, maxHp, regenPerMin) };
}
