// Monster drop rolls shared by stage kills (dungeon.ts) and boss wins (boss.ts). Pure; mutates the draft it is given.
//
// THE INDEPENDENT-ROLL RULE (owner decision 2026-11-06): every entry of a monster's drop table (gold, the gear drop, each item drop)
// rolls on its own, whatever else dropped. A Skeleton kill can give an Old Bone, a Copper piece and a Wild Sage at once. Every entry
// makes its draws whether or not an earlier one hit, so the number of draws of a kill depends only on its own hits, never on another
// entry's outcome (and an item the hero already owns, when it is unique, still draws; see rollItemDrop).
import { GEAR } from './config/gear';
import type { RarityWeight } from './config/gear';
import type { GearDropDef } from './config/dungeons';
import { getItemDef } from './config/items';
import { affixStream, rollAffixes, rollQuality, rollRarity } from './gear';
import { addStackable, heroOwnsItem, makeItem } from './inventory';
import { chance, weightedPick } from './rng';
import type { DroppedGear, FightRewards, GameState } from './types';

function bump(map: Record<string, number>, key: string, by: number) {
  if (by !== 0) map[key] = (map[key] ?? 0) + by;
}

/**
 * One gear drop. Draws on the main RNG: the chance (always); on a hit three more, in this order: the piece (equal weights unless the table
 * says otherwise), its colour (`rarityWeights`), its quality (uniform min..max). Affixes (rare and epic only) come from a salted sub-stream
 * of the main RNG after these draws, so the main stream is not advanced by them. A piece that does not fit in the inventory is lost and
 * reported in `rewards.itemsLost`; a piece that fits is added (instance id `<defId>#<nextItemSerial>`) and counted in `rewards.items`.
 * Returns the dropped piece when it went into the inventory, else null (no hit, or lost).
 */
export function rollGearDrop(draft: GameState, drop: GearDropDef, rarityWeights: readonly RarityWeight[], rewards: FightRewards): DroppedGear | null {
  const hit = chance(draft.rng, drop.chance);
  draft.rng = hit.rng;
  if (!hit.value) return null;
  const piece = weightedPick(draft.rng, drop.pieces.map((p) => ({ value: p.itemId, weight: p.weight })));
  const rarity = rollRarity(piece.rng, rarityWeights);
  const quality = rollQuality(rarity.rng, drop.quality.min, drop.quality.max);
  draft.rng = quality.rng;
  const defId = piece.value;
  const affixes = rollAffixes(affixStream(quality.rng, GEAR.drops.affixSalt), getItemDef(defId)?.slot, rarity.value).value;
  if (getItemDef(defId) && draft.inventory.items.length < draft.inventory.capacity) {
    const itemId = `${defId}#${draft.nextItemSerial}`;
    draft.nextItemSerial += 1;
    draft.inventory.items.push(makeItem(defId, 1, itemId, { quality: quality.value, rarity: rarity.value, affixes }));
    bump(rewards.items, defId, 1);
    return { itemId, defId, rarity: rarity.value, quality: quality.value };
  }
  bump(rewards.itemsLost, defId, 1);
  return null;
}

/**
 * One item drop (one unit): always exactly ONE chance draw. A `unique` item (ItemDef.unique, at most one owned, see heroOwnsItem) the hero
 * already owns is skipped AFTER the draw, so the stream does not depend on what the bag holds. A drop that does not fit is lost and
 * reported in `rewards.itemsLost`.
 */
export function rollItemDrop(draft: GameState, drop: { itemId: string; chance: number }, rewards: FightRewards): void {
  const roll = chance(draft.rng, drop.chance);
  draft.rng = roll.rng;
  if (!roll.value) return;
  const def = getItemDef(drop.itemId);
  if (def?.unique && heroOwnsItem(draft, drop.itemId)) return;
  if (def && !def.stackable) {
    // Non-stackable, non-gear (only unique items today): one slot, instance id = definition id.
    if (draft.inventory.items.length < draft.inventory.capacity) {
      draft.inventory.items.push(makeItem(drop.itemId, 1));
      bump(rewards.items, drop.itemId, 1);
    } else {
      bump(rewards.itemsLost, drop.itemId, 1);
    }
    return;
  }
  const { added, lost } = addStackable(draft.inventory, drop.itemId, 1);
  bump(rewards.items, drop.itemId, added);
  bump(rewards.itemsLost, drop.itemId, lost);
}
