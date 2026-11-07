// Potion Belt tunables (data, 1.27.0). The belt is the unique item `potion_belt` (config/items.ts), worn in the `accessory` slot.
// Rules: docs/ENGINE.md "Potion Belt".
import type { BeltRule } from '../types';

export const BELT = {
  /** Slots on the belt. Each holds ONE potion type (the same type may sit in two slots). */
  slots: 4,
  /** Most potions one slot holds. */
  maxPerSlot: 25,
  /** The rule a slot gets when potions are put into an empty slot. */
  defaultRule: 'hp_below_50',
} as const satisfies { slots: number; maxPerSlot: number; defaultRule: BeltRule };

/**
 * The rules, in the order the UI lists them (`description`: the line the slot's popover shows). `maxHpPct`: the slot drinks when HP is at or under that percent of max HP (an integer
 * compare: hp x 100 <= maxHp x pct); null = whenever HP is below max. No rule drinks at full HP.
 */
export const BELT_RULES: Readonly<Record<BeltRule, { label: string; maxHpPct: number | null; description: string }>> = {
  hp_below_50: { label: 'On 50% HP', maxHpPct: 50, description: 'Drinks when your HP is at or under half of your max HP.' },
  hp_below_25: { label: 'On 25% HP', maxHpPct: 25, description: 'Drinks when your HP is at or under a quarter of your max HP.' },
  always: { label: 'Always', maxHpPct: null, description: 'Drinks whenever it is ready and your HP is below max, until you are full.' },
};

export const BELT_RULE_IDS: readonly BeltRule[] = ['hp_below_50', 'hp_below_25', 'always'];

export function isBeltRule(rule: unknown): rule is BeltRule {
  return typeof rule === 'string' && Object.prototype.hasOwnProperty.call(BELT_RULES, rule);
}

/** Cooldown of a T1 / Greater health potion type after one is drunk, ms (a field of the potion's ItemDef). */
export const HEALTH_POTION_COOLDOWN_MS = 20_000;
