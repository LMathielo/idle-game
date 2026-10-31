// GameDialog: the game's only alert / confirmation dialog (never the native Alert API). Pixel styled (theme.ts, hard
// bevels, Pixelify title, Inter body). Imperative API through the provider:
//   const dialog = useDialog();
//   if (await dialog.confirm({ title, message, confirmLabel, destructive })) …;   // true = confirmed
//   dialog.alert({ title, message });                                              // resolves when closed
//   dialog.notPossible(message) / dialog.saveFailed()                               // the common error alerts
// One dialog shows at a time; later calls queue behind it. Android back and a tap outside = cancel (false).
//
// Where it draws: iOS presents an RN <Modal> from the view controller that owns it, and the root controller cannot
// present one while a full-screen village modal is up. So, like the away summary, every screen root mounts a
// <DialogHost />: the root layout (tabs) and ModalScreen (each village modal). The host that is on top shows it
// (the root host steps aside while a village modal route is open), and the dialog waits while the "While you were
// away" summary is up.
import { usePathname } from 'expo-router';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useGameSnapshot } from '../../client/GameProvider';
import { colors, fonts } from '../../theme';
import { PixelButton } from '../PixelButton';
import { VILLAGE_MODAL_PATHS } from '../village/modalPaths';
import { useScreenInsets } from './insets';

export type ConfirmOptions = {
  title: string;
  message?: string;
  /** Default "OK". */
  confirmLabel?: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  /** Red confirm button: the action loses something (a run, a worker, the save). */
  destructive?: boolean;
};
export type AlertOptions = { title: string; message?: string; /** Default "OK". */ okLabel?: string };

type Request = { id: number; kind: 'confirm' | 'alert'; options: ConfirmOptions; resolve: (ok: boolean) => void };

export type DialogApi = {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  alert: (o: AlertOptions) => Promise<void>;
  /** "Not possible" with the engine's reason. */
  notPossible: (message: string) => Promise<void>;
  /** "Could not save" (a dispatch threw). */
  saveFailed: (detail?: string) => Promise<void>;
};

type Ctx = { api: DialogApi; current: Request | null; close: (id: number, ok: boolean) => void };
const DialogContext = createContext<Ctx | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: Request['kind'], options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      const id = nextId.current++;
      setQueue((q) => [...q, { id, kind, options, resolve }]);
    });
  }, []);

  const close = useCallback((id: number, ok: boolean) => {
    setQueue((q) => {
      const r = q.find((x) => x.id === id);
      if (r) r.resolve(ok);
      return q.filter((x) => x.id !== id);
    });
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (o) => push('confirm', o),
      alert: (o) => push('alert', { title: o.title, message: o.message, confirmLabel: o.okLabel ?? 'OK' }).then(() => undefined),
      notPossible: (message) => push('alert', { title: 'Not possible', message, confirmLabel: 'OK' }).then(() => undefined),
      saveFailed: (detail) => push('alert', { title: 'Could not save', message: detail ?? 'Try again.', confirmLabel: 'OK' }).then(() => undefined),
    }),
    [push],
  );

  const value = useMemo(() => ({ api, current: queue[0] ?? null, close }), [api, queue, close]);
  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx.api;
}

/** True while a dialog is queued: an InfoPopover steps aside so two RN modals never present at once. */
export function useDialogShowing(): boolean {
  return !!useContext(DialogContext)?.current;
}


/** The root layout's host: steps aside while a village modal (which has its own host) is open. */
export function RootDialogHost() {
  const pathname = usePathname();
  return VILLAGE_MODAL_PATHS.includes(pathname) ? null : <DialogHost />;
}

/** Draws the current dialog. Mounted once per screen root (RootDialogHost, ModalScreen). */
export function DialogHost() {
  const ctx = useContext(DialogContext);
  const { awaySummary } = useGameSnapshot();
  const insets = useScreenInsets();
  const current = ctx?.current ?? null;
  // Wait for the away summary: two RN modals must never present at once.
  const visible = !!current && !awaySummary;

  useEffect(() => {
    if (visible && current) AccessibilityInfo.announceForAccessibility(`${current.options.title}. ${current.options.message ?? ''}`);
  }, [visible, current]);

  if (!ctx || !current) return null;
  const { options, kind, id } = current;
  const cancel = () => ctx.close(id, false);
  const ok = () => ctx.close(id, true);

  return (
    // statusBarTranslucent: Android draws the modal edge to edge, so window coordinates and the insets line up.
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.backdrop, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={cancel} accessibilityRole="button" accessibilityLabel={kind === 'confirm' ? 'Cancel' : 'Close'} />
        <View style={styles.frame} accessibilityViewIsModal>
          <View style={styles.box}>
            <Text style={styles.title} accessibilityRole="header">
              {options.title}
            </Text>
            {options.message ? <Text style={styles.message}>{options.message}</Text> : null}
            <View style={styles.actions}>
              {kind === 'confirm' ? <PixelButton label={options.cancelLabel ?? 'Cancel'} onPress={cancel} stretch /> : null}
              <DialogConfirm label={options.confirmLabel ?? 'OK'} destructive={!!options.destructive} onPress={ok} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** The confirm button: a red bevel when destructive. */
function DialogConfirm({ label, destructive, onPress }: { label: string; destructive: boolean; onPress: () => void }) {
  if (!destructive) return <PixelButton label={label} onPress={onPress} stretch />;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={styles.stretch}>
      {({ pressed }) => (
        <View style={[styles.dangerOuter, pressed && styles.dangerOuterPressed]}>
          <View style={[styles.dangerInner, pressed && styles.dangerInnerPressed]}>
            <Text style={styles.dangerLabel} numberOfLines={1}>
              {label}
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** Shared frame for the dialog and the info popover: dark sheet panel, gold outer bevel, hard drop shadow. */
export const overlayFrame = StyleSheet.create({
  frame: {
    backgroundColor: colors.woodDark,
    padding: 3,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.7,
    shadowRadius: 0,
    elevation: 12,
  },
  box: {
    backgroundColor: colors.sheet,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderTopColor: colors.gold,
    borderLeftColor: colors.gold,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomColor: colors.goldDark,
    borderRightColor: colors.goldDark,
  },
});

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 24 },
  frame: { ...overlayFrame.frame, alignSelf: 'center', width: '100%', maxWidth: 380 },
  box: { ...overlayFrame.box, padding: 16, gap: 10 },
  title: { fontFamily: fonts.title, fontSize: 22, color: colors.gold },
  message: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.parchment },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  stretch: { flex: 1 },
  dangerOuter: {
    backgroundColor: '#4a1410',
    padding: 3,
    shadowColor: '#000',
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 0.6,
    shadowRadius: 0,
    elevation: 4,
  },
  dangerOuterPressed: { transform: [{ translateY: 2 }], shadowOffset: { width: 1, height: 1 } },
  dangerInner: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: colors.dangerDeadly,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderTopColor: '#d0574a',
    borderLeftColor: '#d0574a',
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomColor: '#4a1410',
    borderRightColor: '#4a1410',
  },
  dangerInnerPressed: { backgroundColor: '#7a1e14' },
  dangerLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.parchment,
    textShadowColor: '#4a1410',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
});
