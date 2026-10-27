// Display helpers for item sheets (read-only, catalog data only).
import { type EquipmentSlot, getItemDef, type Item, type ItemDef, type ItemQuality } from '../../engine';

export const QUALITY_LABELS: Record<ItemQuality, string> = {
  junk: 'Junk',
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

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
};

/** Fallback for a stored item whose defId the catalog does not know: shown, never usable or sellable. */
export function defOf(defId: string, item?: Item): ItemDef {
  return (
    getItemDef(defId) ?? {
      id: defId,
      name: item?.name ?? defId,
      icon: item?.icon ?? '?',
      quality: 'junk',
      description: 'Unknown item.',
      sellPrice: 0,
      stackable: !!item?.stackable,
    }
  );
}

export type StatLine = { label: string; value: string; delta?: number };

const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

/**
 * Stat lines for the sheet. With `equipped` (the item now in the same slot), gear lines carry the
 * difference to it, so the player sees what equipping changes.
 */
export function statLines(def: ItemDef, equipped?: ItemDef | null): StatLine[] {
  const lines: StatLine[] = [];
  const cmp = equipped !== undefined;
  if (def.slot) lines.push({ label: 'Slot', value: SLOT_LABELS[def.slot] });
  if (def.damage) {
    const d = equipped?.damage;
    const delta = cmp && d ? Math.round((def.damage.min + def.damage.max - (d ? d.min + d.max : 0)) / 2) : undefined;
    lines.push({ label: 'Damage', value: `${def.damage.min}–${def.damage.max}`, delta });
  }
  if (def.armor !== undefined) lines.push({ label: 'Armor', value: signed(def.armor), delta: cmp ? def.armor - (equipped?.armor ?? 0) : undefined });
  if (def.woodcuttingStrength !== undefined) {
    lines.push({ label: 'Woodcutting', value: `${signed(def.woodcuttingStrength)} WS`, delta: cmp ? def.woodcuttingStrength - (equipped?.woodcuttingStrength ?? 0) : undefined });
  }
  if (def.heal) lines.push({ label: 'Heals', value: `${def.heal} HP` });
  return lines;
}
