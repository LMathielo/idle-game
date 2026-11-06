// Current HP and its regen (pure). Max HP is derived (getDerivedStats); current HP is stored.
//
//   regen per minute = (hpRegen.basePerMin + hpRegen.perEndurance × total END) × (1 + gear perk hp_regen)     (END 0 → 15/min; 0.2 per END point since 1.19.0)
//
// The rate is held in hundredths of an HP per minute (an integer, so 0.2 per point is exact). The gear perk (epic, 1.22.0) multiplies
// the whole rate once, in rate units, half up (so 15.2/min with +5% is 1520 × 1.05 = 1596 units = 15.96/min). The remainder is banked in
// character.hpRegenProgress in "rate-unit·ms" units: each ms adds the rate, and every REGEN_UNIT (6 000 000, save v19) units
// is 1 HP (src/engine/regen.ts, shared with mana). Integer math only, exact across resumes and rate changes. A level-up
// raises max HP, not current HP.
import { type AttributeInput, effectiveAttributes, type TrainingLevels } from './attributes';
import { STATS } from './config/stats';
import { applyPerk, gearPerkTotals } from './gear';
import { manaRegenRate, regenMana } from './mana';
import { msUntilFull, REGEN_RATE_SCALE, REGEN_UNIT, regenAmount, regenRateUnits } from './regen';
import { getDerivedStats, type StatsInput } from './stats';
import type { Character, GameState } from './types';

/** Units of hpRegenProgress per HP (6 000 000 since save v19). */
export const HP_REGEN_UNIT = REGEN_UNIT;

/** The regen rate in hundredths of an HP per minute (an integer): 15.2/min = 1520. Uses the TOTAL endurance (normal + core, gear included); the gear perk multiplies it last. */
export function hpRegenRate(state: AttributeInput): number {
  const base = regenRateUnits(STATS.hpRegen.basePerMin) + regenRateUnits(STATS.hpRegen.perEndurance) * effectiveAttributes(state).endurance;
  return applyPerk(base, gearPerkTotals(state.character.equipment).hp_regen);
}

/** HP per minute for display (15.2): the rate units ÷ 100, exact to two decimals. Uses the TOTAL endurance. */
export function hpRegenPerMinute(state: AttributeInput): number {
  return hpRegenRate(state) / REGEN_RATE_SCALE;
}

export function maxHpOf(state: StatsInput): number {
  return getDerivedStats(state).maxHp.value;
}

export type HpPool = { hp: number; hpRegenProgress: number };

/**
 * Adds regen for `elapsedMs` of sanitized time at `rateUnits` (hundredths of an HP per minute, hpRegenRate; regenAmount in
 * src/engine/regen.ts). Never above max; at max the remainder is 0 (time spent full is not banked). Returns the same object
 * when nothing changes.
 */
export function regenHp<P extends HpPool>(pool: P, maxHp: number, rateUnits: number, elapsedMs: number): P {
  const r = regenAmount(pool.hp, pool.hpRegenProgress, maxHp, rateUnits, elapsedMs);
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
  const withHp = regenHp(draft.character, stats.maxHp.value, hpRegenRate(draft), elapsedMs);
  draft.character = regenMana(withHp, stats.maxMana.value, manaRegenRate(draft), elapsedMs);
}

export type HpView = {
  hp: number;
  maxHp: number;
  /** HP per minute, fractional (15.2). */
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
  const rate = hpRegenRate(state);
  const regenPerMin = rate / REGEN_RATE_SCALE;
  const hp = Math.min(c.hp, maxHp);
  if (hp >= maxHp) return { hp, maxHp, regenPerMin, full: true, fullInMs: 0 };
  return { hp, maxHp, regenPerMin, full: false, fullInMs: msUntilFull(hp, c.hpRegenProgress, maxHp, rate) };
}
