// "While you were away" summary, shown after a resume with at least one action or any clock anomaly.
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGameClient, useGameSnapshot } from '../client/GameProvider';
import { formatDuration, formatNumber, itemIcon, itemName } from './format';
import { Panel } from './Panel';
import { PixelButton } from './PixelButton';
import { colors, fonts } from '../theme';
import { DUNGEONS, type SimulationSummary, type SkillKey } from '../engine';

const SKILL_NAMES: Record<SkillKey, string> = {
  woodcutting: 'Woodcutting',
  mining: 'Mining',
  fishing: 'Fishing',
  smithing: 'Smithing',
};

export function AwayModal() {
  const client = useGameClient();
  const { awaySummary, state } = useGameSnapshot();
  if (!awaySummary) return null;
  return (
    <Modal transparent animationType="fade" onRequestClose={() => client.dismissAwaySummary()}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Panel title="While you were away">
            <ScrollView style={styles.scroll}>
              <SummaryBody summary={awaySummary} capHours={state.offline.capMs / 3_600_000} />
            </ScrollView>
            <View style={styles.actions}>
              <PixelButton label="Collect" onPress={() => client.dismissAwaySummary()} />
            </View>
          </Panel>
        </View>
      </View>
    </Modal>
  );
}

function SummaryBody({ summary, capHours }: { summary: SimulationSummary; capHours: number }) {
  const backward = summary.anomalies.some((a) => a.kind === 'backward');
  const capped = summary.anomalies.some((a) => a.kind === 'forward_capped');
  const gained = Object.entries(summary.itemsGained);
  const lost = Object.entries(summary.itemsLost);
  const skills = Object.entries(summary.skillXpGained) as [SkillKey, number][];

  return (
    <View style={styles.body}>
      {summary.grantedMs > 0 ? <Line label="Time away" value={formatDuration(summary.grantedMs)} /> : null}
      {capped ? <Text style={styles.warn}>Rewards capped at {formatNumber(capHours)}h.</Text> : null}
      {backward ? <Text style={styles.warn}>Your device clock moved back — progress is paused until it catches up.</Text> : null}

      {summary.dungeon.runs > 0 ? (
        <Line
          label="💀 Dungeon runs"
          value={`${formatNumber(summary.dungeon.runs)} (${formatNumber(summary.dungeon.wins)} won, ${formatNumber(summary.dungeon.losses)} lost)`}
        />
      ) : null}
      {summary.dungeonsUnlocked.length > 0 ? (
        <Line label="🔓 Unlocked" value={summary.dungeonsUnlocked.map((id) => DUNGEONS[id].name).join(', ')} />
      ) : null}
      {summary.heroXpGained > 0 ? <Line label="✨ Hero XP" value={`+${formatNumber(summary.heroXpGained)}`} /> : null}
      {summary.goldGained > 0 ? <Line label="🪙 Gold" value={`+${formatNumber(summary.goldGained)}`} /> : null}
      {gained.map(([id, n]) => (
        <Line key={id} label={`${itemIcon(id)} ${itemName(id)}`} value={`+${formatNumber(n)}`} />
      ))}
      {skills.map(([skill, xp]) => {
        const levels = summary.skillLevelsGained[skill] ?? 0;
        return (
          <Line
            key={skill}
            label={`${SKILL_NAMES[skill]} XP`}
            value={`+${formatNumber(xp)}${levels > 0 ? ` (+${levels} Lv)` : ''}`}
          />
        );
      })}
      {summary.heroLevelsGained > 0 ? <Line label="Hero levels" value={`+${summary.heroLevelsGained}`} /> : null}
      {lost.map(([id, n]) => (
        <Text key={id} style={styles.lost}>
          Inventory full: {formatNumber(n)} {itemName(id)} lost
        </Text>
      ))}
      {summary.actions === 0 && summary.dungeon.runs === 0 && !backward ? <Text style={styles.muted}>Nothing was gathered.</Text> : null}
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 },
  card: { maxHeight: '80%' },
  scroll: { flexGrow: 0 },
  body: { gap: 6 },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.parchmentDark,
    paddingVertical: 4,
  },
  label: { fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  value: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.skill },
  warn: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.goldDark },
  lost: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.hp },
  muted: { fontFamily: fonts.body, fontSize: 14, color: colors.inkSoft },
  actions: { alignItems: 'center', marginTop: 12 },
});
