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

/** Time away, coarse: 9h 12m · 9h · 35m · 40s. Seconds only show under a minute. */
export function formatAwayDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
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

/** Time to the next training level: "12 min", "3h 05m" (rounded up to the minute), "—" when it can't progress. */
export function formatTrainingLeft(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  if (totalMin < 60) return `${totalMin} min`;
  return `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, '0')}m`;
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

/** Countdown as h:mm:ss (2:00:00, 0:04:07), rounded up to the next whole second. */
export function formatHms(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Compact stack count for a 52px slot: 999, 1.2k, 45k, 1.2M. */
export function formatQty(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(Math.floor(n / 100) / 10).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}k`;
  return `${(Math.floor(n / 100_000) / 10).toFixed(1)}M`;
}

/** Countdown that stays short for long jobs: m:ss under an hour, h:mm:ss above (0:42, 12:34, 23:59:59). */
export function formatCountdown(ms: number): string {
  return ms >= 3_600_000 ? formatHms(ms) : formatClock(ms);
}

/** Basis points as a multiplier with 2 decimals: 10 500 → "1.05". Display only. */
export function formatBp(bp: number): string {
  return (Math.floor(bp / 100) / 100).toFixed(2);
}

/** Basis points as a percent, up to 2 decimals, no trailing zeros: 1900 → "19%", 2710 → "27.1%", 833 → "8.33%". */
export function formatPercentBp(bp: number): string {
  return `${Number((bp / 100).toFixed(2))}%`;
}

/** Basis points as a percent bonus: 2000 → "+20%". */
export function formatBonusBp(bp: number): string {
  return `${bp >= 0 ? '+' : ''}${Math.round(bp / 100)}%`;
}

/** Items per minute with one decimal (two under 1): 0.13, 1.6, 12.4. Display only. */
export function formatPerMin(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  return n < 1 ? n.toFixed(2) : n.toFixed(1);
}
