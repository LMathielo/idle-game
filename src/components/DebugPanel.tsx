// Collapsible debug tools (Hero tab). Every button is logged as a DEBUG_* row; none changes engine rules.
// Every button but Reset save and the clock shifts repeats while held (PixelButton `repeat`); a refused repeat stops
// silently.
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useGameClient, useGameSnapshot } from '../client/GameProvider';
import { ATTRIBUTE_KEYS } from '../engine';
import { ATTRIBUTE_NAMES, formatDuration } from './format';
import { Panel } from './Panel';
import { PixelButton } from './PixelButton';
import { useDialog } from './ui/GameDialog';
import { colors, fonts } from '../theme';

const HOUR = 3_600_000;

const ATTRIBUTE_BUTTONS = ATTRIBUTE_KEYS.map((key) => ({ key, label: `+1 ${ATTRIBUTE_NAMES[key].short} (normal)` }));

/** Debug commands that the engine refuses (e.g. not enough stamina) come back as `{ ok: false }`. */
function isRejected(result: unknown): result is { ok: false; error: { message: string } } {
  return !!result && typeof result === 'object' && (result as { ok?: unknown }).ok === false;
}

export function DebugPanel() {
  const client = useGameClient();
  const dialog = useDialog();
  const { clockOffsetMs } = useGameSnapshot();
  const [open, setOpen] = useState(false);
  const [logInfo, setLogInfo] = useState<string | null>(null);
  /** One debug call at a time (a ref: two taps in one frame never send two). */
  const busy = useRef(false);

  /**
   * A debug action for a PixelButton `repeat`: resolves false when refused or failed, which stops a hold. Only the
   * first press of a hold shows a dialog for it; repeat ticks stay quiet.
   */
  const run =
    (fn: () => Promise<unknown>) =>
    async ({ repeat }: { repeat: boolean }): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      try {
        const result = await fn();
        const { total, unsynced } = await client.countLog();
        setLogInfo(`${total} log rows (${unsynced} unsynced)`);
        if (isRejected(result)) {
          if (!repeat) void dialog.notPossible(result.error.message);
          return false;
        }
        return true;
      } catch (err) {
        if (!repeat) void dialog.alert({ title: 'Debug action failed', message: err instanceof Error ? err.message : String(err) });
        return false;
      } finally {
        busy.current = false;
      }
    };

  /** A single debug action (no repeat): the clock shifts. */
  const once = (fn: () => Promise<unknown>) => () => void run(fn)({ repeat: false });

  const confirmReset = async () => {
    const ok = await dialog.confirm({ title: 'Reset save?', message: 'Starts a new level-1 hero. The action log is kept.', confirmLabel: 'Reset', destructive: true });
    if (ok) await run(() => client.debug.resetSave())({ repeat: false });
  };

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
            <PixelButton label="+1h" onPress={once(() => client.debug.shiftClock(HOUR))} />
            <PixelButton label="+8h" onPress={once(() => client.debug.shiftClock(8 * HOUR))} />
            <PixelButton label="+24h" onPress={once(() => client.debug.shiftClock(24 * HOUR))} />
            <PixelButton label="Clock −2h" onPress={once(() => client.debug.shiftClock(-2 * HOUR))} />
            <PixelButton label="+10k hero XP" repeat={run(() => client.debug.grantHeroXp(10_000))} />
            <PixelButton label="Spend 10 stamina" repeat={run(() => client.debug.spendStamina(10))} />
            <PixelButton label="Refill stamina" repeat={run(() => client.debug.refillStamina())} />
            <PixelButton label="Hero HP → 1" repeat={run(() => client.debug.setHeroHp(1))} />
            <PixelButton label="End search now (free)" repeat={run(() => client.debug.finishDungeonRun())} />
            <PixelButton
              label="+60 min training XP"
              repeat={run(() => client.debug.addTrainingXp(60))}
              accessibilityHint="Debug: adds 60 training XP to the attribute being trained"
            />
            <PixelButton
              label="+1 WC level"
              repeat={run(() => client.debug.addWoodcuttingLevel(1))}
              accessibilityHint="Debug: adds one woodcutting level, to test tree unlocks"
            />
            <PixelButton
              label="+1 Mining level"
              repeat={run(() => client.debug.addMiningLevel(1))}
              accessibilityHint="Debug: adds one mining level, to test rock unlocks"
            />
            <PixelButton label="+1,000 gold" repeat={run(() => client.debug.addGold(1000))} accessibilityHint="Debug: adds 1,000 gold" />
            <PixelButton label="Unlock next pipe" repeat={run(() => client.debug.unlockPipe())} accessibilityHint="Debug: opens the next crafting pipe" />
            {ATTRIBUTE_BUTTONS.map((a) => (
              <PixelButton key={a.key} label={a.label} repeat={run(() => client.debug.addAttribute(a.key))} accessibilityHint="Debug: adds one extra normal point (not core)" />
            ))}
            <PixelButton label="Reset save" onPress={confirmReset} />
          </View>
        </View>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  header: { fontFamily: fonts.title, fontSize: 20, color: colors.ink },
  body: { marginTop: 8, gap: 8 },
  info: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
