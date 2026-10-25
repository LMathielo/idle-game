// Thin React binding for the GameClient: load on mount, resume on foreground,
// persist on background, tick every second while the app is open.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { PixelButton } from '../components/PixelButton';
import { colors, fonts } from '../theme';
import { createAppClient } from './createAppClient';
import type { GameClient, GameSnapshot } from './types';

const TICK_MS = 1000;

const GameClientContext = createContext<GameClient | null>(null);

function reportError(where: string) {
  return (err: unknown) => console.warn(`[game] ${where} failed`, err);
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [client] = useState<GameClient>(createAppClient);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setStatus('loading');
    client.load().then(
      () => setStatus('ready'),
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      },
    );
  }, [client]);

  useEffect(load, [load]);

  useEffect(() => {
    if (status !== 'ready') return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const startTicking = () => {
      if (!interval) interval = setInterval(() => client.tick().catch(reportError('tick')), TICK_MS);
    };
    const stopTicking = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    if (AppState.currentState === 'active') startTicking();
    let wasBackground = false;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        wasBackground = true;
        stopTicking();
        client.persist().catch(reportError('persist'));
      } else if (next === 'active') {
        // iOS 'inactive' (Control Center, app switcher peek) is transient: keep ticking through it.
        if (wasBackground) client.resume().catch(reportError('resume'));
        wasBackground = false;
        startTicking();
      }
    });
    return () => {
      sub.remove();
      stopTicking();
    };
  }, [client, status]);

  if (status !== 'ready') {
    return (
      <View style={styles.center}>
        {status === 'loading' ? (
          <Text style={styles.text}>Loading your save…</Text>
        ) : (
          <>
            <Text style={styles.text}>Could not open the save.</Text>
            <Text style={styles.detail}>{error}</Text>
            <PixelButton label="Retry" onPress={load} />
          </>
        )}
      </View>
    );
  }

  return <GameClientContext.Provider value={client}>{children}</GameClientContext.Provider>;
}

export function useGameClient(): GameClient {
  const client = useContext(GameClientContext);
  if (!client) throw new Error('useGameClient must be used inside <GameProvider>');
  return client;
}

/** Full snapshot: state plus client-side flags (clock paused, away summary, debug offset). */
export function useGameSnapshot(): GameSnapshot {
  const client = useGameClient();
  // Wrapped so any GameClient works, even one whose methods are not pre-bound.
  const subscribe = useCallback((listener: () => void) => client.subscribe(listener), [client]);
  const getSnapshot = useCallback(() => client.getSnapshot(), [client]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useGameState() {
  return useGameSnapshot().state;
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  text: { fontFamily: fonts.title, fontSize: 28, color: colors.parchment, textAlign: 'center' },
  detail: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark, textAlign: 'center' },
});
