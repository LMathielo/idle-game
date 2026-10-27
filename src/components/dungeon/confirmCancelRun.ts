import { Alert } from 'react-native';

/**
 * Asks before anything that ends the dungeon run in progress (Stop, or starting another activity). During the
 * search the engine cancels the run with no rewards; during the fight it is a forfeit, which counts as a loss
 * (HP to 0). The player must know that before confirming.
 */
export function confirmCancelRun(action: string, onConfirm: () => void, inFight = false) {
  const message = inFight
    ? 'You will flee the fight: it counts as a loss, your HP drops to 0 and there are no rewards. Finished runs are kept.'
    : 'The current dungeon search will be lost and gives no rewards. Finished runs are kept.';
  Alert.alert(`${action}?`, message, [
    { text: 'Keep running', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onConfirm },
  ]);
}
