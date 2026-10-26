import { type AttributeKey, getItemDef } from '../engine';

/** Display names. A Record, so adding an attribute to ATTRIBUTE_KEYS fails typecheck until it is named here. */
export const ATTRIBUTE_NAMES: Record<AttributeKey, { short: string; label: string }> = {
  strength: { short: 'STR', label: 'Strength' },
  dexterity: { short: 'DEX', label: 'Dexterity' },
  endurance: { short: 'END', label: 'Endurance' },
  intelligence: { short: 'INT', label: 'Intelligence' },
};

/** 2h 05m · 4m 12s · 37s */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Countdown as m:ss, rounded up to the next whole second (5:00, 0:07). Hours fold into minutes. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 8h 20m · 4m (rounded up to the next whole minute, so it never reads 0m while time is left). */
export function formatHoursMinutes(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function itemName(id: string): string {
  return getItemDef(id)?.name ?? id;
}

export function itemIcon(id: string): string {
  return getItemDef(id)?.icon ?? '❔';
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}
