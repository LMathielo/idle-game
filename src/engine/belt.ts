// The Potion Belt (1.27.0, pure). A unique accessory whose item instance holds BELT.slots slots, each empty or ONE potion type with a count
// (up to BELT.maxPerSlot) and a rule. While the belt is WORN, simulate() drinks from it by its rules at exact engine times; see
// docs/ENGINE.md "Potion Belt".
//
//   drink pass (`beltPass`, at engine time T): for slot 1, 2, 3, 4 in that order, a slot drinks when
//     - it holds at least one potion,
//     - its potion TYPE is off cooldown (state.potionCooldowns[defId] <= T),
//     - its rule holds for the hero's CURRENT HP (read again after every drink): hp_below_50 = hp x 100 <= maxHp x 50, hp_below_25 likewise,
//       always = hp < maxHp. No rule drinks at full HP.
//     A drink heals the potion's `heal`, capped at max HP (like USE_ITEM), takes one potion out of the slot (an emptied slot becomes empty:
//     its rule is gone), starts the type's cooldown (T + the potion's cooldownMs) and counts in the summary. In a fight it is also a log
//     entry (actor 'belt'). It draws no RNG.
//   WHEN: the pass runs at the start of every simulate() (what a command changed), after every hero event (a strike, a fight's end, a
//     level-up, a training level) and at every cooldown end, so a rule fires at the exact engine time its condition starts to hold.
//     Regen only ever raises HP, so nothing can start to hold between those instants. Same code live and offline, any split of time.
//     A drink due at the very instant a fight's time limit ends it is taken right AFTER the fight (outside it): 3 in a 60 s fight.
//     Forfeited offline time (beyond the cap) is not walked, except to finish a fight that was in progress when the cap fell.
import { BELT, BELT_RULES, isBeltRule } from './config/belt';
import { getItemDef, type ItemDef } from './config/items';
import { MAX_ACTIONS_PER_SIMULATION } from './config/time';
import { maxHpOf } from './hp';
import { freeSlots, makeItem } from './inventory';
import type { ItemError } from './merchant';
import type { ActiveFight, BeltRule, BeltSlot, GameState, Item, SimulationSummary } from './types';

const err = (code: NonNullable<ItemError>['code'], message: string): ItemError => ({ code, message });

/** A potion: a stackable consumable that heals. */
export function isPotionDef(def: ItemDef | undefined): boolean {
  return !!def && def.stackable && (def.heal ?? 0) > 0;
}

/** The worn Potion Belt (the accessory slot's item, when it is the belt), else null. */
export function equippedBelt(state: Pick<GameState, 'character'>): Item | null {
  const item = state.character.equipment.accessory;
  return item && getItemDef(item.defId)?.belt && Array.isArray(item.belt) ? item : null;
}

/** The belt's slots, always BELT.slots long (a missing entry is empty). */
export function beltSlotsOf(item: Pick<Item, 'belt'>): BeltSlot[] {
  return Array.from({ length: BELT.slots }, (_, i) => item.belt?.[i] ?? null);
}

/** Potions inside a belt, all slots. */
export function beltPotionCount(item: Pick<Item, 'belt'> | null | undefined): number {
  return item ? beltSlotsOf(item).reduce((n, s) => n + (s?.count ?? 0), 0) : 0;
}

/** Engine time (ms) the potion type can be drunk again; a time in the past (or 0) means ready. */
export function potionReadyAt(state: Pick<GameState, 'potionCooldowns'>, defId: string): number {
  return state.potionCooldowns?.[defId] ?? 0;
}

/** Ms of cooldown the potion type has left at engine time `at` (0 = ready). */
export function potionCooldownLeftMs(state: Pick<GameState, 'potionCooldowns'>, defId: string, at: number): number {
  return Math.max(0, potionReadyAt(state, defId) - at);
}

/** Starts the type's cooldown at engine time `at` (a drink). Replaces the map (the caller's draft may share it with the input state). */
export function startPotionCooldown(draft: GameState, defId: string, at: number): void {
  const ms = getItemDef(defId)?.cooldownMs ?? 0;
  if (ms > 0) draft.potionCooldowns = { ...draft.potionCooldowns, [defId]: at + ms };
}

/** The rule test: never at full HP; a percent rule needs hp x 100 <= maxHp x pct (integers); `always` is any HP below max. */
export function ruleSatisfied(rule: BeltRule, hp: number, maxHp: number): boolean {
  if (!(hp < maxHp)) return false;
  const pct = BELT_RULES[rule].maxHpPct;
  return pct === null || hp * 100 <= maxHp * pct;
}

// ---------- commands (validated; they mutate a full draft copy) ----------

const slotIndexOk = (slot: unknown): slot is number => typeof slot === 'number' && Number.isSafeInteger(slot) && slot >= 0 && slot < BELT.slots;

type Worn = { belt: Item; slots: BeltSlot[] };

/** The worn belt with its slots normalized (BELT.slots long), or the typed refusal. */
function wornBelt(draft: GameState): Worn | { error: NonNullable<ItemError> } {
  const belt = equippedBelt(draft);
  if (!belt) return { error: { code: 'BELT_NOT_EQUIPPED', message: 'Wear the Potion Belt first' } };
  belt.belt = beltSlotsOf(belt);
  return { belt, slots: belt.belt };
}

/**
 * BELT_PUT: moves potions from a bag stack into belt slot `slot`. As many as fit (the slot holds BELT.maxPerSlot of ONE type); they leave
 * the bag (the stack goes when it is used up, freeing its place). An empty slot gets the default rule. Refused: BELT_NOT_EQUIPPED,
 * UNKNOWN_SLOT, NOT_IN_INVENTORY, NOT_A_POTION, BELT_SLOT_TAKEN (another potion type in the slot), BELT_SLOT_FULL.
 */
export function beltPut(draft: GameState, itemId: unknown, slot: unknown): ItemError {
  const worn = wornBelt(draft);
  if ('error' in worn) return worn.error;
  if (!slotIndexOk(slot)) return err('UNKNOWN_SLOT', `Unknown belt slot ${String(slot)}`);
  const items = draft.inventory.items;
  const index = items.findIndex((i) => i.id === itemId);
  if (typeof itemId !== 'string' || index < 0) return err('NOT_IN_INVENTORY', 'That item is not in the inventory');
  const item = items[index];
  const def = getItemDef(item.defId);
  if (!isPotionDef(def)) return err('NOT_A_POTION', `${item.name} is not a potion`);
  const current = worn.slots[slot];
  if (current && current.defId !== item.defId) return err('BELT_SLOT_TAKEN', `That slot holds ${getItemDef(current.defId)?.name ?? current.defId}: one potion type per slot`);
  const room = BELT.maxPerSlot - (current?.count ?? 0);
  if (room <= 0) return err('BELT_SLOT_FULL', `That slot is full (${BELT.maxPerSlot})`);
  const have = item.quantity ?? 1;
  const moved = Math.min(room, have);
  worn.slots[slot] = { defId: item.defId, count: (current?.count ?? 0) + moved, rule: current?.rule ?? BELT.defaultRule };
  if (moved >= have) items.splice(index, 1);
  else item.quantity = have - moved;
  return null;
}

/**
 * BELT_TAKE: moves everything in belt slot `slot` back to the bag (the existing stack, else a new stack in a free place). The slot is empty
 * afterwards. Refused: BELT_NOT_EQUIPPED, UNKNOWN_SLOT, SLOT_EMPTY, INVENTORY_FULL (no stack to join and no free place: nothing moves).
 */
export function beltTake(draft: GameState, slot: unknown): ItemError {
  const worn = wornBelt(draft);
  if ('error' in worn) return worn.error;
  if (!slotIndexOk(slot)) return err('UNKNOWN_SLOT', `Unknown belt slot ${String(slot)}`);
  const held = worn.slots[slot];
  if (!held) return err('SLOT_EMPTY', 'That belt slot is empty');
  const stack = draft.inventory.items.find((i) => i.stackable && i.defId === held.defId);
  if (stack) stack.quantity = (stack.quantity ?? 0) + held.count;
  else if (freeSlots(draft.inventory) < 1) {
    return err('INVENTORY_FULL', `No room in the bag for ${held.count} ${getItemDef(held.defId)?.name ?? held.defId}`);
  } else draft.inventory.items.push(makeItem(held.defId, held.count));
  worn.slots[slot] = null;
  return null;
}

/** BELT_SET_RULE: changes the rule of a filled slot. Refused: BELT_NOT_EQUIPPED, UNKNOWN_SLOT, SLOT_EMPTY, INVALID_RULE. */
export function beltSetRule(draft: GameState, slot: unknown, rule: unknown): ItemError {
  const worn = wornBelt(draft);
  if ('error' in worn) return worn.error;
  if (!slotIndexOk(slot)) return err('UNKNOWN_SLOT', `Unknown belt slot ${String(slot)}`);
  if (!isBeltRule(rule)) return err('INVALID_RULE', `Unknown rule ${String(rule)}`);
  const held = worn.slots[slot];
  if (!held) return err('SLOT_EMPTY', 'That belt slot is empty');
  worn.slots[slot] = { ...held, rule };
  return null;
}

// ---------- the drink pass ----------

/** The fight in progress, if any (a dungeon fight or a boss fight). */
function activeFight(draft: GameState): ActiveFight | null {
  const a = draft.activity;
  if (a?.kind === 'boss') return a.fight;
  if (a?.kind === 'dungeon' && a.phase === 'fight') return a.fight;
  return null;
}

/** True when the worn belt holds at least one potion. */
export function beltHasPotions(state: Pick<GameState, 'character'>): boolean {
  return beltPotionCount(equippedBelt(state)) > 0;
}

/**
 * The drink pass at engine time `at` (see the header). Mutates `draft` copy-on-write (its character, the belt item, the cooldown map and
 * the fight are replaced, never edited in place, because simulate() shares them with its input). Returns how many potions were drunk.
 */
export function beltPass(draft: GameState, at: number, summary: SimulationSummary | null): number {
  const worn = equippedBelt(draft);
  if (!worn || beltPotionCount(worn) === 0) return 0;
  let slots = beltSlotsOf(worn);
  let drunk = 0;
  for (let i = 0; i < slots.length; i++) {
    const held = slots[i];
    if (!held || held.count <= 0) continue;
    const def = getItemDef(held.defId);
    if (!def || !isPotionDef(def)) continue;
    if (potionReadyAt(draft, held.defId) > at) continue;
    const maxHp = maxHpOf(draft);
    const hpBefore = Math.max(0, draft.character.hp);
    if (!ruleSatisfied(held.rule, hpBefore, maxHp)) continue;
    const hp = Math.min(maxHp, hpBefore + (def.heal ?? 0));
    // The character, the belt and its slots are copied on the first drink of a pass; later drinks edit those copies.
    if (drunk === 0) {
      slots = [...slots];
      draft.character = { ...draft.character, equipment: { ...draft.character.equipment, accessory: { ...worn, belt: slots } } };
    }
    draft.character.hp = hp;
    if (hp >= maxHp) draft.character.hpRegenProgress = 0; // no banked regen while full (hp.ts)
    slots[i] = held.count > 1 ? { ...held, count: held.count - 1 } : null;
    startPotionCooldown(draft, held.defId, at);
    drunk += 1;
    if (summary) {
      summary.potionsUsed ??= {};
      summary.potionsUsed[held.defId] = (summary.potionsUsed[held.defId] ?? 0) + 1;
    }
    const fight = activeFight(draft);
    const a = draft.activity;
    if (fight && (a?.kind === 'boss' || a?.kind === 'dungeon')) {
      const entry = {
        atMs: fight.elapsedMs,
        actor: 'belt' as const,
        strike: fight.log.reduce((n, e) => n + (e.actor === 'belt' ? 1 : 0), 0) + 1,
        roll: 0,
        crit: false,
        physical: 0,
        magic: 0,
        dealt: 0,
        targetHpAfter: hp,
        potion: held.defId,
        heal: hp - hpBefore,
      };
      a.fight = { ...fight, log: [...fight.log, entry] };
    }
  }
  return drunk;
}

/**
 * Wall ms from `at` to the next cooldown end of a potion type the belt holds (a pass is due then: a slot may be waiting on it), or Infinity.
 */
export function beltNextEventMs(draft: GameState, at: number): number {
  const worn = equippedBelt(draft);
  if (!worn) return Number.POSITIVE_INFINITY;
  let next = Number.POSITIVE_INFINITY;
  for (const held of beltSlotsOf(worn)) {
    if (!held || held.count <= 0) continue;
    const ready = potionReadyAt(draft, held.defId);
    if (ready > at) next = Math.min(next, ready - at);
  }
  return next;
}

/** The engine time the belt-aware walks of one simulate() call are at (set to the END of a step before it runs, so strikes inside it are at that instant). */
export type BeltClock = { at: number };

/**
 * Walks `ms` of granted time with the belt: cut at every hero event (`heroNextMs`, wall ms from now) and every cooldown end, runs `step(dt)`
 * for each piece and the drink pass at its end. While the belt holds no potion nothing can drink, so the rest goes in one piece.
 */
export function walkWithBelt(draft: GameState, clock: BeltClock, ms: number, heroNextMs: () => number, step: (dt: number) => void, summary: SimulationSummary): void {
  let left = ms;
  let guard = 0;
  while (left > 0) {
    if (!beltHasPotions(draft) || guard >= MAX_ACTIONS_PER_SIMULATION) {
      clock.at += left;
      step(left);
      return;
    }
    const dt = Math.max(1, Math.min(left, heroNextMs(), beltNextEventMs(draft, clock.at)));
    clock.at += dt;
    step(dt);
    left -= dt;
    guard += 1;
    beltPass(draft, clock.at, summary);
  }
}

// ---------- read-only views (for UIs) ----------

export type BeltSlotView = {
  index: number;
  /** null = an empty slot. */
  defId: string | null;
  name: string | null;
  count: number;
  rule: BeltRule | null;
  ruleLabel: string | null;
  /** Ms the slot's potion type still has on cooldown at the state's engine time (0 = ready, or an empty slot). */
  cooldownLeftMs: number;
};

export type BeltView = {
  /** The belt is worn (the button, the panel and the drinks exist only then). */
  equipped: boolean;
  slots: BeltSlotView[];
  /** Potions in all slots. */
  total: number;
  /** Every filled slot's type is on cooldown, or the belt holds nothing: the button is dimmed. */
  dimmed: boolean;
  maxPerSlot: number;
};

/** The worn belt for the screen, at the state's engine time (`state.time.lastSimulatedAt`, which the client ticks every second). */
export function beltView(state: Pick<GameState, 'character' | 'potionCooldowns' | 'time'>): BeltView {
  const worn = equippedBelt(state);
  const at = state.time.lastSimulatedAt;
  const slots: BeltSlotView[] = beltSlotsOf(worn ?? {}).map((s, index) => {
    if (!s || s.count <= 0) return { index, defId: null, name: null, count: 0, rule: null, ruleLabel: null, cooldownLeftMs: 0 };
    return {
      index,
      defId: s.defId,
      name: getItemDef(s.defId)?.name ?? s.defId,
      count: s.count,
      rule: s.rule,
      ruleLabel: BELT_RULES[s.rule]?.label ?? s.rule,
      cooldownLeftMs: potionCooldownLeftMs(state, s.defId, at),
    };
  });
  const filled = slots.filter((s) => s.defId !== null);
  return {
    equipped: worn !== null,
    slots,
    total: filled.reduce((n, s) => n + s.count, 0),
    dimmed: filled.every((s) => s.cooldownLeftMs > 0),
    maxPerSlot: BELT.maxPerSlot,
  };
}

/** A potion stack in the bag, for the belt panel's list. */
export type BagPotionView = { itemId: string; defId: string; name: string; quantity: number; cooldownLeftMs: number };

/** The bag's potion stacks (what the belt panel can put into a slot), in bag order. */
export function bagPotions(state: Pick<GameState, 'inventory' | 'potionCooldowns' | 'time'>): BagPotionView[] {
  const at = state.time.lastSimulatedAt;
  const out: BagPotionView[] = [];
  for (const i of state.inventory.items) {
    const def = getItemDef(i.defId);
    if (!isPotionDef(def)) continue;
    out.push({ itemId: i.id, defId: i.defId, name: i.name, quantity: i.quantity ?? 1, cooldownLeftMs: potionCooldownLeftMs(state, i.defId, at) });
  }
  return out;
}
