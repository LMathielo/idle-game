import { type EdgeInsets, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Root safe-area insets, floored by the launch-time window insets. While a fullScreenModal is up, UIKit can take the
 * presenting view (where the root SafeAreaProvider lives) out of the window, and the provider may then report 0. The
 * app is portrait-locked, so the launch insets stay valid for the whole session. Used by ModalScreen and by the
 * overlays (GameDialog, InfoPopover), which can show over a full-screen modal.
 */
export function useScreenInsets(): EdgeInsets {
  const ctx = useSafeAreaInsets();
  const init = initialWindowMetrics?.insets;
  return {
    top: Math.max(ctx.top, init?.top ?? 0),
    bottom: Math.max(ctx.bottom, init?.bottom ?? 0),
    left: Math.max(ctx.left, init?.left ?? 0),
    right: Math.max(ctx.right, init?.right ?? 0),
  };
}
