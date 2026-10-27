// Player commands. Serializable, validated here (never in the UI), applied after simulating to `now`.
import { grantHeroXp } from './activities';
import { effectiveAttributes } from './attributes';
import { cloneState } from './clone';
import { isGatheringKind, isTreeId, TREES } from './config/woodcutting';
import { SKILL_XP_CURVE } from './config/xpCurve';
import { xpToNext } from './progression';
import { DEV_TOOLS_ENABLED } from './config/dev';
import { DUNGEONS, isDungeonId } from './config/dungeons';
import { beginFight, forfeitFight, isDungeonUnlocked, recordDungeonResults, searchMsFor, skipCost } from './dungeon';
import { equipItem, unequipItem, useItem } from './equipment';
import { markDebugUsed } from './flags';
import { addMerchantCharge, buyItem, type ItemError, type ItemErrorCode, refreshMerchant, sellItem } from './merchant';
import { maxHpOf } from './hp';
import { simulate } from './simulate';
import { refillStamina, spendStamina } from './stamina';
import { TRAINING } from './config/training';
import { grantTrainingMs, grantTrainingXp, speedupPlan, trainingBlock, trainingCap, trainingTierPrice } from './training';
import { cutLog, logMsFor, treeCheck, woodcutSkipCost, woodcuttingStrength } from './woodcutting';
import {
  type Activity,
  ATTRIBUTE_KEYS,
  type AttributeKey,
  type DungeonId,
  type EquipmentSlot,
  type GameEvent,
  type GameState,
  type SimulationSummary,
  type TreeId,
} from './types';

export type Command =
  /** Cuts logs from one tree back-to-back. Needs the tree's level and WS. Same tree again = no-op; another tree switches (the log in progress restarts). */
  | { id: string; type: 'START_ACTIVITY'; kind: 'woodcutting'; treeId: TreeId }
  /** Starts auto-repeating runs. Only one activity at a time: a running one is stopped (a dungeon run in progress is lost). */
  | { id: string; type: 'START_ACTIVITY'; kind: 'dungeon'; dungeonId: DungeonId }
  /**
   * Trains one attribute (XP is kept per attribute). Needs tier ≥ 1 and the attribute below the tier's cap.
   * Same attribute again = no-op; another attribute switches. Stops any other activity (a dungeon run is lost).
   */
  | { id: string; type: 'START_ACTIVITY'; kind: 'training'; attribute: AttributeKey }
  /** Buys the next training tier with gold. `tier` must be the current tier + 1, so a double tap never buys two. */
  | { id: string; type: 'UNLOCK_TRAINING_TIER'; tier: number }
  /** Stops the activity. A dungeon run in progress is lost and gives nothing; training keeps its XP (a pause). */
  | { id: string; type: 'STOP_ACTIVITY' }
  /**
   * Spends ceil(remaining minutes) stamina to end the current run's SEARCH now: the fight starts at once and
   * plays live (it is never skipped; refused with FIGHT_IN_PROGRESS during the fight). No HP regen for the
   * skipped time. `run` is the run the player saw (DungeonRunView.run) and `maxCost` the cost the button showed:
   * if that run already finished, or the real cost is higher, the skip fails with RUN_CHANGED and nothing changes.
   */
  | { id: string; type: 'SKIP_DUNGEON_RUN'; run: number; maxCost: number }
  /**
   * Spends ceil(remaining minutes) stamina to finish the current log now (exactly one log). `log` is the log
   * the player saw (WoodcutActivityView.log) and `maxCost` the cost shown: if that log already finished, or the
   * real cost is higher, it fails with LOG_CHANGED and nothing changes.
   */
  | { id: string; type: 'SKIP_WOODCUT'; log: number; maxCost: number }
  /**
   * Spends 1 stamina per minute to add that much training progress to the attribute being trained right away.
   * Minutes beyond the tier cap are never charged (clamped). `maxCost` is the cost the button showed:
   * a higher real cost fails with COST_CHANGED.
   */
  | { id: string; type: 'SPEEDUP_TRAINING'; minutes: number; maxCost: number }
  /** Adds woodcutting levels (XP toward the next level is kept), so tree unlocks can be tested on a phone. */
  | { id: string; type: 'DEBUG_ADD_WOODCUTTING_LEVEL'; levels: number }
  | { id: string; type: 'DEBUG_SET_HERO_HP'; hp: number }
  /** Adds wins (and runs) to an unlocked dungeon's lifetime counters, so unlocks can be tested on a phone. */
  | { id: string; type: 'DEBUG_ADD_DUNGEON_WINS'; dungeonId: DungeonId; amount: number }
  /** Ends the current run's search now, for free: the fight starts at once (refused during the fight). */
  | { id: string; type: 'DEBUG_FINISH_DUNGEON_RUN' }
  | { id: string; type: 'DEBUG_GRANT_HERO_XP'; amount: number }
  | { id: string; type: 'DEBUG_SPEND_STAMINA'; amount: number }
  | { id: string; type: 'DEBUG_REFILL_STAMINA' }
  | { id: string; type: 'DEBUG_ADD_ATTRIBUTE'; attribute: AttributeKey; amount: number }
  /** Adds training XP (= trained minutes at the base rate) to the attribute being trained. */
  | { id: string; type: 'DEBUG_ADD_TRAINING_XP'; xp: number }
  | { id: string; type: 'DEBUG_ADD_GOLD'; amount: number }
  /** Moves an inventory item into its slot; an item already there goes back to the inventory (a swap). */
  | { id: string; type: 'EQUIP_ITEM'; itemId: string }
  /** Moves the item in `slot` to the inventory. Fails with INVENTORY_FULL when there is no free slot. */
  | { id: string; type: 'UNEQUIP_ITEM'; slot: EquipmentSlot }
  /** Uses one unit of a consumable (Health Potion: +heal HP, capped at max; HP_FULL at max HP). */
  | { id: string; type: 'USE_ITEM'; itemId: string }
  /** Spends 1 refresh charge and restocks the merchant. */
  | { id: string; type: 'REFRESH_MERCHANT' }
  /**
   * Buys `quantity` units from merchant stock slot `slot`. Bound to what the player saw: `defId` must still be
   * in the slot (STOCK_CHANGED) and the unit price at most `maxUnitPrice` (PRICE_CHANGED).
   */
  | { id: string; type: 'BUY_ITEM'; slot: number; defId: string; quantity: number; maxUnitPrice: number }
  /** Sells `quantity` of an inventory item (by item id) at its catalog sellPrice. Equipped items are refused. */
  | { id: string; type: 'SELL_ITEM'; itemId: string; quantity: number }
  /** +1 merchant refresh charge (never above max). */
  | { id: string; type: 'DEBUG_ADD_MERCHANT_CHARGE' };

export type CommandType = Command['type'];

export type CommandErrorCode =
  | 'INVALID_TIME'
  | 'INVALID_COMMAND'
  | 'UNKNOWN_ACTIVITY'
  | 'UNKNOWN_DUNGEON'
  | 'UNKNOWN_TREE'
  | 'TREE_LOCKED'
  | 'NOT_WOODCUTTING'
  | 'LOG_CHANGED'
  | 'COST_CHANGED'
  | 'DUNGEON_LOCKED'
  | 'NO_ACTIVE_ACTIVITY'
  | 'NO_DUNGEON_RUN'
  | 'RUN_CHANGED'
  | 'FIGHT_IN_PROGRESS'
  | 'INVALID_AMOUNT'
  | 'UNKNOWN_ATTRIBUTE'
  | 'NOT_ENOUGH_STAMINA'
  | 'TRAINING_LOCKED'
  | 'TRAINING_MAXED'
  | 'NOT_TRAINING'
  | 'TIER_NOT_NEXT'
  | 'MAX_TIER'
  | 'NOT_ENOUGH_GOLD'
  | ItemErrorCode
  | 'DEBUG_DISABLED';

export type CommandError = { code: CommandErrorCode; message: string };

export type CommandResult =
  | { ok: true; state: GameState; events: GameEvent[]; summary: SimulationSummary }
  | { ok: false; error: CommandError };

/** Upper bound for the debug XP grant, keeps numbers far from MAX_SAFE_INTEGER. */
export const MAX_DEBUG_XP_GRANT = 1_000_000_000_000;

/** Debug attribute grants: per command, and the highest value an attribute may reach that way. */
export const MAX_DEBUG_ATTRIBUTE_GRANT = 1000;
export const MAX_DEBUG_ATTRIBUTE_VALUE = 1_000_000;

/** Debug dungeon-win grant per command. */
export const MAX_DEBUG_DUNGEON_WINS = 1000;

/** Debug training XP grant per command (minutes at the base rate). */
export const MAX_DEBUG_TRAINING_XP = 100_000;

/** Debug woodcutting levels per command, and the highest level the debug grant may reach. */
export const MAX_DEBUG_WOODCUTTING_LEVELS = 100;
export const MAX_DEBUG_WOODCUTTING_LEVEL = 1000;

/** Debug gold grant per command, and the most gold a save may reach that way. */
export const MAX_DEBUG_GOLD_GRANT = 1_000_000;
export const MAX_DEBUG_GOLD_VALUE = 1_000_000_000_000;

export function isAttributeKey(key: unknown): key is AttributeKey {
  return typeof key === 'string' && (ATTRIBUTE_KEYS as readonly string[]).includes(key);
}

const fail = (code: CommandErrorCode, message: string): CommandResult => ({ ok: false, error: { code, message } });

export type ApplyOptions = {
  /**
   * Accept DEBUG_* commands. Defaults to DEV_TOOLS_ENABLED for live play. Replay always passes
   * true so a logged debug row stays replayable even in a build where the debug tools are off.
   */
  allowDebug?: boolean;
};

/**
 * Simulates up to `now` (so rewards are never lost or double-counted), then applies `cmd`.
 * Returns a typed error and leaves the input untouched when the command is invalid.
 */
export function applyCommand(state: GameState, cmd: Command, now: number, options: ApplyOptions = {}): CommandResult {
  const allowDebug = options.allowDebug ?? DEV_TOOLS_ENABLED;
  if (!cmd || typeof cmd !== 'object' || typeof cmd.id !== 'string' || cmd.id.length === 0) {
    return fail('INVALID_COMMAND', 'Command must be an object with a non-empty id');
  }
  if (typeof now !== 'number' || !Number.isFinite(now)) return fail('INVALID_TIME', `Non-finite time ${String(now)}`);

  const sim = simulate(state, now);
  // simulate() shares unchanged sub-objects with its input; commands work on a full copy.
  let draft = cloneState(sim.state);
  const events: GameEvent[] = [...sim.events];

  switch (cmd.type) {
    case 'START_ACTIVITY': {
      let next: Activity;
      if (cmd.kind === 'training') {
        const { attribute } = cmd;
        if (!isAttributeKey(attribute)) return fail('UNKNOWN_ATTRIBUTE', `Unknown attribute ${String(attribute)}`);
        const block = trainingBlock(draft, attribute);
        if (block === 'TRAINING_LOCKED') return fail(block, 'Training is locked: unlock Tier 1 first');
        if (block === 'TRAINING_MAXED') {
          return fail(block, `${attribute} is at the Tier ${draft.training.tier} cap (${trainingCap(draft.training.tier)}): unlock the next tier`);
        }
        // Already training this attribute: nothing to do.
        if (draft.activity?.kind === 'training' && draft.activity.attribute === attribute) break;
        next = { kind: 'training', attribute, startedAt: now };
      } else if (cmd.kind === 'dungeon') {
        if (!isDungeonId(cmd.dungeonId)) return fail('UNKNOWN_DUNGEON', `Unknown dungeon ${String(cmd.dungeonId)}`);
        if (!isDungeonUnlocked(draft, cmd.dungeonId)) return fail('DUNGEON_LOCKED', `${DUNGEONS[cmd.dungeonId].name} is locked`);
        // Already running this dungeon: keep the current run.
        if (draft.activity?.kind === 'dungeon' && draft.activity.dungeonId === cmd.dungeonId) break;
        next = { kind: 'dungeon', dungeonId: cmd.dungeonId, startedAt: now, phase: 'search', progressMs: 0, fight: null };
      } else {
        if (!isGatheringKind(cmd.kind)) return fail('UNKNOWN_ACTIVITY', `Unknown activity ${String(cmd.kind)}`);
        const { treeId } = cmd;
        if (!isTreeId(treeId)) return fail('UNKNOWN_TREE', `Unknown tree ${String(treeId)}`);
        const check = treeCheck(draft, treeId);
        if (!check.unlocked) {
          const tree = TREES[treeId];
          const missing = [
            check.levelOk ? null : `woodcutting level ${tree.reqLevel}`,
            check.wsOk ? null : `${tree.reqWs} woodcutting strength (you have ${woodcuttingStrength(draft).value})`,
          ].filter(Boolean);
          return fail('TREE_LOCKED', `${tree.name} needs ${missing.join(' and ')}`);
        }
        // Already cutting this tree: keep the log in progress.
        if (draft.activity?.kind === 'woodcutting' && draft.activity.treeId === treeId) break;
        next = { kind: 'woodcutting', treeId, startedAt: now, progressMs: 0 };
      }
      if (draft.activity) stopActivity(draft, events);
      draft.activity = next;
      events.push({ type: 'ACTIVITY_STARTED', kind: next.kind });
      break;
    }
    case 'UNLOCK_TRAINING_TIER': {
      const { tier } = cmd;
      if (typeof tier !== 'number' || !Number.isSafeInteger(tier)) return fail('INVALID_COMMAND', `Invalid tier ${String(tier)}`);
      const current = draft.training.tier;
      if (current >= TRAINING.maxTier) return fail('MAX_TIER', `Training is already at the max tier (${TRAINING.maxTier})`);
      // Bound to what the player saw: only the next tier, so a repeated tap never buys a second one.
      if (tier !== current + 1) return fail('TIER_NOT_NEXT', `Tier ${tier} is not the next tier (${current + 1})`);
      const price = trainingTierPrice(tier);
      const gold = draft.character.gold;
      if (!Number.isSafeInteger(gold) || gold < price) {
        return fail('NOT_ENOUGH_GOLD', `Tier ${tier} costs ${price} gold, you have ${gold} (${price - gold} missing)`);
      }
      draft.character.gold = gold - price;
      draft.training.tier = tier;
      events.push({ type: 'TRAINING_TIER_UNLOCKED', tier });
      break;
    }
    case 'STOP_ACTIVITY': {
      if (!draft.activity) return fail('NO_ACTIVE_ACTIVITY', 'No activity is running');
      stopActivity(draft, events);
      break;
    }
    case 'SKIP_DUNGEON_RUN': {
      const a = draft.activity;
      if (a?.kind !== 'dungeon') return fail('NO_DUNGEON_RUN', 'No dungeon run in progress');
      const { run, maxCost } = cmd;
      if (typeof maxCost !== 'number' || !Number.isSafeInteger(maxCost) || maxCost <= 0) {
        return fail('INVALID_AMOUNT', `Invalid maxCost ${String(maxCost)}`);
      }
      if (typeof run !== 'number' || !Number.isSafeInteger(run) || run <= 0) return fail('INVALID_COMMAND', `Invalid run ${String(run)}`);
      // The run the player saw finished (simulating to now, or earlier): never resolve the next one instead.
      if (run !== draft.dungeon.totals.runs + 1) return fail('RUN_CHANGED', 'That run already finished');
      if (a.phase === 'fight') return fail('FIGHT_IN_PROGRESS', 'The fight has started: it plays out live and cannot be skipped');
      const remainingMs = Math.max(0, searchMsFor(a.dungeonId, effectiveAttributes(draft)) - a.progressMs);
      const cost = skipCost(remainingMs);
      if (cost > maxCost) return fail('RUN_CHANGED', `Skipping now costs ${cost}, more than the ${maxCost} shown`);
      const spent = spendStamina(draft, cost);
      if (!spent.ok) return fail(spent.error.code, spent.error.message);
      draft = spent.state;
      startFightNow(draft, events);
      break;
    }
    case 'SKIP_WOODCUT': {
      const a = draft.activity;
      if (a?.kind !== 'woodcutting') return fail('NOT_WOODCUTTING', 'No tree is being cut');
      const { log, maxCost } = cmd;
      if (typeof maxCost !== 'number' || !Number.isSafeInteger(maxCost) || maxCost <= 0) {
        return fail('INVALID_AMOUNT', `Invalid maxCost ${String(maxCost)}`);
      }
      if (typeof log !== 'number' || !Number.isSafeInteger(log) || log <= 0) return fail('INVALID_COMMAND', `Invalid log ${String(log)}`);
      // The log the player saw finished (simulating to now, or earlier): never finish the next one instead.
      if (log !== draft.stats.totalActions + 1) return fail('LOG_CHANGED', 'That log already finished');
      const remainingMs = Math.max(0, logMsFor(a.treeId, effectiveAttributes(draft)) - a.progressMs);
      const cost = woodcutSkipCost(remainingMs);
      if (cost > maxCost) return fail('LOG_CHANGED', `Skipping now costs ${cost}, more than the ${maxCost} shown`);
      const spent = spendStamina(draft, cost);
      if (!spent.ok) return fail(spent.error.code, spent.error.message);
      draft = spent.state;
      cutLog(draft, a.treeId, null, events);
      if (draft.activity?.kind === 'woodcutting') draft.activity.progressMs = 0;
      break;
    }
    case 'SPEEDUP_TRAINING': {
      const { minutes, maxCost } = cmd;
      if (typeof minutes !== 'number' || !Number.isSafeInteger(minutes) || minutes <= 0 || minutes > TRAINING.speedup.maxStepsPerCommand) {
        return fail('INVALID_AMOUNT', `Invalid minutes ${String(minutes)}`);
      }
      if (typeof maxCost !== 'number' || !Number.isSafeInteger(maxCost) || maxCost <= 0) {
        return fail('INVALID_AMOUNT', `Invalid maxCost ${String(maxCost)}`);
      }
      const a = draft.activity;
      if (a?.kind !== 'training') return fail('NOT_TRAINING', 'No attribute is being trained');
      const plan = speedupPlan(draft, a.attribute, minutes);
      if (plan.minutes <= 0) return fail('TRAINING_MAXED', `${a.attribute} is at the Tier ${draft.training.tier} cap`);
      if (plan.cost > maxCost) return fail('COST_CHANGED', `Speeding up now costs ${plan.cost}, more than the ${maxCost} shown`);
      const spent = spendStamina(draft, plan.cost);
      if (!spent.ok) return fail(spent.error.code, spent.error.message);
      draft = spent.state;
      grantTrainingMs(draft, a.attribute, plan.minutes * TRAINING.speedup.msPerStep, events);
      break;
    }
    case 'DEBUG_ADD_WOODCUTTING_LEVEL': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const { levels } = cmd;
      if (typeof levels !== 'number' || !Number.isSafeInteger(levels) || levels <= 0 || levels > MAX_DEBUG_WOODCUTTING_LEVELS) {
        return fail('INVALID_AMOUNT', `Invalid level amount ${String(levels)}`);
      }
      const skill = draft.character.skills.woodcutting;
      const level = skill.level + levels;
      if (level > MAX_DEBUG_WOODCUTTING_LEVEL) return fail('INVALID_AMOUNT', `Woodcutting would exceed level ${MAX_DEBUG_WOODCUTTING_LEVEL}`);
      draft = markDebugUsed(draft);
      const next = xpToNext(SKILL_XP_CURVE, level);
      // The curve only grows, so the XP already earned stays below the new level's requirement.
      draft.character.skills.woodcutting = { level, xp: Math.min(skill.xp, next - 1), xpToNext: next };
      events.push({ type: 'SKILL_LEVEL_UP', skill: 'woodcutting', level });
      break;
    }
    case 'DEBUG_SET_HERO_HP': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const { hp } = cmd;
      const maxHp = maxHpOf(draft);
      if (typeof hp !== 'number' || !Number.isSafeInteger(hp) || hp < 0 || hp > maxHp) {
        return fail('INVALID_AMOUNT', `HP must be a whole number from 0 to ${maxHp}`);
      }
      draft = markDebugUsed(draft);
      draft.character.hp = hp;
      draft.character.hpRegenProgress = 0;
      break;
    }
    case 'DEBUG_ADD_DUNGEON_WINS': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const { dungeonId, amount } = cmd;
      if (!isDungeonId(dungeonId)) return fail('UNKNOWN_DUNGEON', `Unknown dungeon ${String(dungeonId)}`);
      if (!isDungeonUnlocked(draft, dungeonId)) return fail('DUNGEON_LOCKED', `${DUNGEONS[dungeonId].name} is locked`);
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_DEBUG_DUNGEON_WINS) {
        return fail('INVALID_AMOUNT', `Invalid win amount ${String(amount)}`);
      }
      draft = markDebugUsed(draft);
      recordDungeonResults(draft, dungeonId, amount, 0, null, events);
      break;
    }
    case 'DEBUG_FINISH_DUNGEON_RUN': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const a = draft.activity;
      if (a?.kind !== 'dungeon') return fail('NO_DUNGEON_RUN', 'No dungeon run in progress');
      if (a.phase === 'fight') return fail('FIGHT_IN_PROGRESS', 'The fight has started: it plays out live');
      draft = markDebugUsed(draft);
      startFightNow(draft, events);
      break;
    }
    case 'DEBUG_GRANT_HERO_XP': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const { amount } = cmd;
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_DEBUG_XP_GRANT) {
        return fail('INVALID_AMOUNT', `Invalid XP amount ${String(amount)}`);
      }
      draft = markDebugUsed(draft);
      grantHeroXp(draft, amount, null, events);
      break;
    }
    case 'DEBUG_SPEND_STAMINA': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const spent = spendStamina(draft, cmd.amount);
      if (!spent.ok) return fail(spent.error.code, spent.error.message);
      draft = markDebugUsed(spent.state);
      break;
    }
    case 'DEBUG_REFILL_STAMINA': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      draft = markDebugUsed(refillStamina(draft));
      break;
    }
    case 'DEBUG_ADD_ATTRIBUTE': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const { attribute, amount } = cmd;
      if (!isAttributeKey(attribute)) return fail('UNKNOWN_ATTRIBUTE', `Unknown attribute ${String(attribute)}`);
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_DEBUG_ATTRIBUTE_GRANT) {
        return fail('INVALID_AMOUNT', `Invalid attribute amount ${String(amount)}`);
      }
      const next = draft.character.attributes[attribute] + amount;
      if (next > MAX_DEBUG_ATTRIBUTE_VALUE) return fail('INVALID_AMOUNT', `${attribute} would exceed ${MAX_DEBUG_ATTRIBUTE_VALUE}`);
      draft = markDebugUsed(draft);
      draft.character.attributes[attribute] = next;
      break;
    }
    case 'DEBUG_ADD_TRAINING_XP': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const { xp } = cmd;
      if (typeof xp !== 'number' || !Number.isSafeInteger(xp) || xp <= 0 || xp > MAX_DEBUG_TRAINING_XP) {
        return fail('INVALID_AMOUNT', `Invalid training XP ${String(xp)}`);
      }
      const a = draft.activity;
      if (a?.kind !== 'training') return fail('NOT_TRAINING', 'No attribute is being trained');
      draft = markDebugUsed(draft);
      grantTrainingXp(draft, a.attribute, xp, events);
      break;
    }
    case 'DEBUG_ADD_GOLD': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const { amount } = cmd;
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_DEBUG_GOLD_GRANT) {
        return fail('INVALID_AMOUNT', `Invalid gold amount ${String(amount)}`);
      }
      const next = draft.character.gold + amount;
      if (next > MAX_DEBUG_GOLD_VALUE) return fail('INVALID_AMOUNT', `Gold would exceed ${MAX_DEBUG_GOLD_VALUE}`);
      draft = markDebugUsed(draft);
      draft.character.gold = next;
      break;
    }
    case 'EQUIP_ITEM': {
      const e = equipItem(draft, cmd.itemId);
      if (e) return fail(e.code, e.message);
      stopWoodcuttingIfTooWeak(draft, events);
      break;
    }
    case 'UNEQUIP_ITEM': {
      const e = unequipItem(draft, cmd.slot);
      if (e) return fail(e.code, e.message);
      stopWoodcuttingIfTooWeak(draft, events);
      break;
    }
    case 'USE_ITEM': {
      const e = useItem(draft, cmd.itemId);
      if (e) return fail(e.code, e.message);
      break;
    }
    case 'REFRESH_MERCHANT': {
      const e = refreshMerchant(draft);
      if (e) return fail(e.code, e.message);
      break;
    }
    case 'BUY_ITEM': {
      const e = buyItem(draft, cmd.slot, cmd.defId, cmd.quantity, cmd.maxUnitPrice);
      if (e) return fail(e.code, e.message);
      break;
    }
    case 'SELL_ITEM': {
      const e = sellItem(draft, cmd.itemId, cmd.quantity);
      if (e) return fail(e.code, e.message);
      break;
    }
    case 'DEBUG_ADD_MERCHANT_CHARGE': {
      if (!allowDebug) return fail('DEBUG_DISABLED', 'Debug commands are disabled');
      const e: ItemError = addMerchantCharge(draft);
      if (e) return fail(e.code, e.message);
      draft = markDebugUsed(draft);
      break;
    }
    default: {
      const unknown = cmd as { type?: unknown };
      return fail('INVALID_COMMAND', `Unknown command type ${String(unknown.type)}`);
    }
  }

  return { ok: true, state: draft, events, summary: sim.summary };
}

/**
 * Stops the running activity on a full draft copy. A dungeon run still searching is lost (no fight, no rewards);
 * a dungeon fight in progress is forfeited (a loss: 0 HP, no rewards, counted).
 */
function stopActivity(draft: GameState, events: GameEvent[]) {
  const a = draft.activity;
  if (!a) return;
  // During the fight, leaving is a forfeit: the fight ends as a loss (FIGHT_RESOLVED). During the search, the run
  // is just cancelled.
  if (a.kind === 'dungeon' && !forfeitFight(draft, events)) events.push({ type: 'DUNGEON_RUN_CANCELLED', dungeonId: a.dungeonId });
  events.push({ type: 'ACTIVITY_STOPPED', kind: a.kind });
  draft.activity = null;
}

/**
 * Product rule (2026-10-27): woodcutting stops when an equipment change drops woodcutting strength below the
 * current tree's requirement. Logs finished before the command are already banked (applyCommand simulated to
 * `now` first); the log in progress is dropped like any stop. Only equipment changes WS in a command (selling
 * an equipped item is refused; STR only goes up), so EQUIP_ITEM and UNEQUIP_ITEM call this.
 */
function stopWoodcuttingIfTooWeak(draft: GameState, events: GameEvent[]) {
  const a = draft.activity;
  if (a?.kind === 'woodcutting' && !treeCheck(draft, a.treeId).wsOk) stopActivity(draft, events);
}

/**
 * Ends the current search now (draft is a full copy): the fight starts at the current HP and plays live from
 * this moment. At 0 HP it is an immediate loss and the next search starts.
 */
function startFightNow(draft: GameState, events: GameEvent[]) {
  if (draft.activity?.kind === 'dungeon') beginFight(draft, draft.activity, null, events);
}
