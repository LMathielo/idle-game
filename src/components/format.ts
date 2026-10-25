import { getItemDef } from '../engine';

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

export function itemName(id: string): string {
  return getItemDef(id)?.name ?? id;
}

export function itemIcon(id: string): string {
  return getItemDef(id)?.icon ?? '❔';
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}
