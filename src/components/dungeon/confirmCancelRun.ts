import { Alert } from 'react-native';

/**
 * Asks before anything that ends the dungeon run in progress (Stop, or starting another activity).
 * The engine cancels the run with no rewards; the player must know that before confirming.
 */
export function confirmCancelRun(action: string, onConfirm: () => void) {
  Alert.alert(`${action}?`, 'The current dungeon run will be lost and gives no rewards. Finished runs are kept.', [
    { text: 'Keep running', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onConfirm },
  ]);
}
