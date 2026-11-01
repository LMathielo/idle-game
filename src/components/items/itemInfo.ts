// Display helpers for item sheets (read-only: catalog data and the engine's gear-quality selectors).
import { type EquipmentSlot, gearStatsAt, getItemDef, type Item, type ItemDef, type ItemRarity, isGearDef, qualityOf, rarityOf } from '../../engine';

/** What a popover or slot shows: a stored item, a merchant listing or a crafted piece (gear carries its roll). */
export type ShownItem = Pick<Item, 'defId'> & { quality?: number; rarity?: ItemRarity };

export const RARITY_LABELS: Record<ItemRarity, string> = {
  junk: 'Junk',
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

/** Gear subtitles name the colour (owner wording: "Green · Quality 73%"). */
export const RARITY_COLOR_NAMES: Record<ItemRarity, string> = {
  junk: 'Gray',
  common: 'White',
  uncommon: 'Green',
  rare: 'Blue',
  epic: 'Purple',
  legendary: 'Gold',
};

/** Quality is an integer percent (0–100). */
export const qualityPct = (q: number) => `${q}%`;

/** The popover subtitle: gear "Green · Quality 73%", anything else its rarity label ("Common", "Junk"). */
export function itemSubtitle(item: ShownItem, def: ItemDef): string {
  if (!isGearDef(def)) return RARITY_LABELS[def.rarity];
  return `${RARITY_COLOR_NAMES[rarityOf(item)]} · Quality ${qualityPct(qualityOf(item))}`;
}

export const SLOT_LABELS: Record<EquipmentSlot, string> = {
  helmet: 'Helmet',
  amulet: 'Amulet',
  armor: 'Armor',
  weapon: 'Weapon',
  shield: 'Shield',
  gloves: 'Gloves',
  ring1: 'Ring',
  ring2: 'Ring',
  boots: 'Boots',
  axe: 'Axe',
  pickaxe: 'Pickaxe',
};

/** Fallback for a stored item whose defId the catalog does not know: shown, never usable or sellable. */
export function defOf(defId: string, item?: Item): ItemDef {
  return (
    getItemDef(defId) ?? {
      id: defId,
      name: item?.name ?? defId,
      icon: item?.icon ?? '?',
      rarity: 'junk',
      description: 'Unknown item.',
      sellPrice: 0,
      stackable: !!item?.stackable,
    }
  );
}

export type StatLine = { label: string; value: string; delta?: number };

const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

/**
 * Stat lines for the sheet, scaled by the item's quality (gear). With `equipped` (the item now in the same slot, null
 * when empty), gear lines carry the difference to its scaled stats, so the player sees what equipping changes.
 */
export function statLines(item: ShownItem, equipped?: ShownItem | null): StatLine[] {
  const def = defOf(item.defId);
  const lines: StatLine[] = [];
  const cmp = equipped !== undefined;
  const st = gearStatsAt(def, qualityOf(item));
  const eq = equipped ? gearStatsAt(getItemDef(equipped.defId), qualityOf(equipped)) : {};
  if (def.slot) lines.push({ label: 'Slot', value: SLOT_LABELS[def.slot] });
  if (st.damage) {
    const d = eq.damage;
    const delta = cmp ? Math.round((st.damage.min + st.damage.max - (d ? d.min + d.max : 0)) / 2) : undefined;
    lines.push({ label: 'Damage', value: `${st.damage.min}–${st.damage.max}`, delta });
  }
  if (st.armor !== undefined) lines.push({ label: 'Armor', value: signed(st.armor), delta: cmp ? st.armor - (eq.armor ?? 0) : undefined });
  if (st.woodcuttingStrength !== undefined) {
    lines.push({ label: 'Woodcutting', value: `${signed(st.woodcuttingStrength)} WS`, delta: cmp ? st.woodcuttingStrength - (eq.woodcuttingStrength ?? 0) : undefined });
  }
  if (st.miningStrength !== undefined) {
    lines.push({ label: 'Mining', value: `${signed(st.miningStrength)} MS`, delta: cmp ? st.miningStrength - (eq.miningStrength ?? 0) : undefined });
  }
  if (def.heal) lines.push({ label: 'Heals', value: `${def.heal} HP` });
  return lines;
}
