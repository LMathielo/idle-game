import { type Activity, BOSSES } from '../../engine';
import type { DialogApi } from '../ui/GameDialog';

/**
 * Asks before anything that ends the dungeon run or the boss fight in progress (Stop, or starting another activity). During the
 * search the engine cancels the run with no rewards; during the fight it is a forfeit, which counts as a loss
 * (HP to 0); leaving a boss fight is the same and its entry stamina is not refunded. The player must know that before
 * confirming. Resolves true when confirmed.
 */
export function confirmCancelRun(dialog: DialogApi, action: string, inFight = false, bossId?: keyof typeof BOSSES): Promise<boolean> {
  const message = bossId
    ? `You will flee the ${BOSSES[bossId].name}: it counts as a loss, your HP drops to 0 and there are no rewards. The ${BOSSES[bossId].entryStamina} stamina you paid is not refunded.`
    : inFight
      ? 'You will flee the fight: it counts as a loss, your HP drops to 0 and there are no rewards. Finished runs are kept.'
      : 'The current dungeon search will be lost and gives no rewards. Finished runs are kept.';
  return dialog.confirm({ title: `${action}?`, message, confirmLabel: action, cancelLabel: bossId || inFight ? 'Keep fighting' : 'Keep running', destructive: true });
}

/**
 * For a screen that starts another activity: asks first when that would end a dungeon run or a boss fight (see confirmCancelRun),
 * and resolves true at once when nothing would end.
 */
export function confirmLeaveRun(dialog: DialogApi, action: string, activity: Activity | null): Promise<boolean> {
  if (activity?.kind === 'boss') return confirmCancelRun(dialog, action, true, activity.bossId);
  if (activity?.kind === 'dungeon') return confirmCancelRun(dialog, action, activity.phase === 'fight');
  return Promise.resolve(true);
}
