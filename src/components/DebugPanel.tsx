// Collapsible debug tools (Hero tab). Every button is logged as a DEBUG_* row; none changes engine rules.
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useGameClient, useGameSnapshot } from '../client/GameProvider';
import { ATTRIBUTE_KEYS } from '../engine';
import { ATTRIBUTE_NAMES, formatDuration } from './format';
import { Panel } from './Panel';
import { PixelButton } from './PixelButton';
import { colors, fonts } from '../theme';

const HOUR = 3_600_000;

const ATTRIBUTE_BUTTONS = ATTRIBUTE_KEYS.map((key) => ({ key, label: `+1 ${ATTRIBUTE_NAMES[key].short}` }));

/** Debug commands that the engine refuses (e.g. not enough stamina) come back as `{ ok: false }`. */
function isRejected(result: unknown): result is { ok: false; error: { message: string } } {
  return !!result && typeof result === 'object' && (result as { ok?: unknown }).ok === false;
}

export function DebugPanel() {
  const client = useGameClient();
  const { clockOffsetMs } = useGameSnapshot();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logInfo, setLogInfo] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await fn();
      if (isRejected(result)) Alert.alert('Not possible', result.error.message);
      const { total, unsynced } = await client.countLog();
      setLogInfo(`${total} log rows (${unsynced} unsynced)`);
    } catch (err) {
      Alert.alert('Debug action failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmReset = () =>
    Alert.alert('Reset save?', 'Starts a new level-1 hero. The action log is kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: run(() => client.debug.resetSave()) },
    ]);

  const sign = clockOffsetMs < 0 ? '−' : '+';

  return (
    <Panel>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.header}>{open ? '▾' : '▸'} Debug</Text>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <Text style={styles.info}>
            Clock offset: {clockOffsetMs === 0 ? 'none' : `${sign}${formatDuration(Math.abs(clockOffsetMs))}`}
          </Text>
          {logInfo ? <Text style={styles.info}>{logInfo}</Text> : null}
          <View style={styles.grid}>
            <PixelButton label="+1h" onPress={run(() => client.debug.shiftClock(HOUR))} />
            <PixelButton label="+8h" onPress={run(() => client.debug.shiftClock(8 * HOUR))} />
            <PixelButton label="+24h" onPress={run(() => client.debug.shiftClock(24 * HOUR))} />
            <PixelButton label="Clock −2h" onPress={run(() => client.debug.shiftClock(-2 * HOUR))} />
            <PixelButton label="+10k hero XP" onPress={run(() => client.debug.grantHeroXp(10_000))} />
            <PixelButton label="Spend 10 stamina" onPress={run(() => client.debug.spendStamina(10))} />
            <PixelButton label="Refill stamina" onPress={run(() => client.debug.refillStamina())} />
            <PixelButton label="Hero HP → 1" onPress={run(() => client.debug.setHeroHp(1))} />
            <PixelButton label="Finish run now (free)" onPress={run(() => client.debug.finishDungeonRun())} />
            {ATTRIBUTE_BUTTONS.map((a) => (
              <PixelButton key={a.key} label={a.label} onPress={run(() => client.debug.addAttribute(a.key))} />
            ))}
            <PixelButton label="Reset save" onPress={confirmReset} />
          </View>
        </View>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  header: { fontFamily: fonts.title, fontSize: 26, color: colors.ink },
  body: { marginTop: 8, gap: 8 },
  info: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
