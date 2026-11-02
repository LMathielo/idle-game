// Current HP and its regen (pure). Max HP is derived (getDerivedStats); current HP is stored.
//
//   regen per minute = hpRegen.basePerMin + hpRegen.perEndurance × total END     (END 0 → 15/min, 1.16.0)
//
// The remainder is banked in character.hpRegenProgress in "HP·ms per minute" units: each ms adds the
// rate, and every 60 000 units is 1 HP. Integer math only, exact across resumes and rate changes.
import { type AttributeInput, effectiveAttributes, type TrainingLevels } from './attributes';
import { STATS } from './config/stats';
import { getDerivedStats, type StatsInput } from './stats';
import type { Character } from './types';

/** Units of hpRegenProgress per HP: one minute. */
export const HP_REGEN_UNIT = 60_000;

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
 * Adds regen for `elapsedMs` of sanitized time. Never above max; at max the remainder is 0 (time spent
 * full is not banked). Returns the same object when nothing changes.
 *
 * No overflow: the product elapsed × rate is only formed when it is below the HP still missing (so
 * a year of elapsed time at a huge debug END is fine).
 */
export function regenHp<P extends HpPool>(pool: P, maxHp: number, ratePerMin: number, elapsedMs: number): P {
  if (pool.hp >= maxHp) {
    return pool.hp === maxHp && pool.hpRegenProgress === 0 ? pool : { ...pool, hp: maxHp, hpRegenProgress: 0 };
  }
  if (!(elapsedMs > 0) || !(ratePerMin > 0)) return pool;
  const hp = Math.max(0, pool.hp);
  const needed = (maxHp - hp) * HP_REGEN_UNIT - pool.hpRegenProgress; // units until full, > 0
  if (elapsedMs >= Math.ceil(needed / ratePerMin)) return { ...pool, hp: maxHp, hpRegenProgress: 0 };
  const banked = pool.hpRegenProgress + elapsedMs * ratePerMin;
  const gained = Math.floor(banked / HP_REGEN_UNIT);
  return { ...pool, hp: hp + gained, hpRegenProgress: banked - gained * HP_REGEN_UNIT };
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
  character: Pick<Character, 'level' | 'attributes' | 'equipment' | 'hp' | 'hpRegenProgress'>;
  training: TrainingLevels;
}): HpView {
  const c = state.character;
  const maxHp = maxHpOf(state);
  const regenPerMin = hpRegenPerMinute(state);
  const hp = Math.min(c.hp, maxHp);
  if (hp >= maxHp) return { hp, maxHp, regenPerMin, full: true, fullInMs: 0 };
  const needed = (maxHp - hp) * HP_REGEN_UNIT - c.hpRegenProgress;
  return { hp, maxHp, regenPerMin, full: false, fullInMs: regenPerMin > 0 ? Math.ceil(needed / regenPerMin) : Number.POSITIVE_INFINITY };
}
