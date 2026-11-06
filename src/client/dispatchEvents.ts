// Pure readers of a DispatchResult's events, so the UI reacts to what the engine actually did (never to a guess made
// before the command ran). No React, no Expo.
import type { DispatchResult } from './types';

/**
 * The inventory id of the piece COLLECT_CRAFT just put in the inventory, from the CRAFT_COLLECTED event, or null when
 * the result is a refusal, a duplicate or holds no such event. Predicting it beforehand is wrong whenever the time the
 * dispatch simulates first bumps nextItemSerial (a Merchant restock, a boss gear drop).
 */
export function collectedItemIdOf(res: DispatchResult, jobId?: number): string | null {
  if (!res.ok) return null;
  for (const e of res.events) if (e.type === 'CRAFT_COLLECTED' && (jobId === undefined || e.jobId === jobId)) return e.itemId;
  return null;
}
