// "While you were away" summary, shown after a resume with at least one action or any clock anomaly.
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGameClient, useGameSnapshot } from '../client/GameProvider';
import type { ReactNode } from 'react';
import { GameIcon, IconText, ItemIcon, SkillIcon } from './art/Sprites';
import type { IconName } from './art/images';
import { ATTRIBUTE_NAMES, formatAwayDuration, formatNumber, itemName } from './format';
import { Panel } from './Panel';
import { PixelButton } from './PixelButton';
import { colors, fonts } from '../theme';
import { type AttributeKey, BOSSES, BUILDINGS, dungeonOrBossName, type SimulationSummary, type SkillKey, TRAINING, trainingXpTotal } from '../engine';

const SKILL_NAMES: Record<SkillKey, string> = {
  woodcutting: 'Woodcutting',
  mining: 'Mining',
  fishing: 'Fishing',
};

export function AwayModal() {
  const client = useGameClient();
  const { awaySummary, state } = useGameSnapshot();
  if (!awaySummary) return null;
  return (
    <Modal transparent animationType="fade" onRequestClose={() => client.dismissAwaySummary()}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Panel title={awayTitle(awaySummary.requestedMs)}>
            <ScrollView style={styles.scroll}>
              <SummaryBody summary={awaySummary} capHours={state.offline.capMs / 3_600_000} tier={state.training.tier} />
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

/** Total real time away (requestedMs), not the credited time: the cap line explains the difference. */
function awayTitle(requestedMs: number): string {
  return requestedMs > 0 ? `While you were away for ${formatAwayDuration(requestedMs)}` : 'While you were away';
}

/** "Won" / "Lost" for one fight, "2 fights (1 won, 1 lost)" for more (older summaries have no boss field). */
function bossResultText(b: { fights: number; wins: number; losses: number }): string {
  if (b.fights === 1) return b.wins === 1 ? 'Won' : 'Lost';
  return `${formatNumber(b.fights)} fights (${formatNumber(b.wins)} won, ${formatNumber(b.losses)} lost)`;
}

function SummaryBody({ summary, capHours, tier }: { summary: SimulationSummary; capHours: number; tier: number }) {
  const backward = summary.anomalies.some((a) => a.kind === 'backward');
  // Merged summaries add both fields, so this holds when any resume in the batch went over the cap.
  const capped = summary.grantedMs < summary.requestedMs;
  const gained = Object.entries(summary.itemsGained);
  const lost = Object.entries(summary.itemsLost);
  const workerGained = Object.entries(summary.workerItemsGained);
  const workerLost = Object.entries(summary.workerItemsLost);
  const crafted = Object.entries(summary.itemsCrafted);
  // Older summaries (before 1.14.0) have no craftsReady.
  const ready = Object.entries(summary.craftsReady ?? {});
  // Material pipes that spent time waiting for materials (1.15.0; older summaries have none): one line per pipe and item.
  const waits = summary.craftWaits ?? [];
  const skills = Object.entries(summary.skillXpGained) as [SkillKey, number][];
  const trained = Object.entries(summary.trainingXpGained) as [AttributeKey, number][];
  const maxed = summary.trainingMaxed;
  const nextTierText = tier < TRAINING.maxTier ? `unlock Tier ${tier + 1}` : 'max tier';

  return (
    <View style={styles.body}>
      {capped ? (
        <Text style={styles.warn}>Progress is capped at {formatNumber(capHours)}h; time beyond that was not counted.</Text>
      ) : null}
      {backward ? <Text style={styles.warn}>Your device clock moved back — progress is paused until it catches up.</Text> : null}

      {summary.dungeon.runs > 0 ? (
        <Line
          label="Dungeon runs"
          value={`${formatNumber(summary.dungeon.runs)} (${formatNumber(summary.dungeon.wins)} won, ${formatNumber(summary.dungeon.losses)} lost)`}
        />
      ) : null}
      {summary.boss && summary.boss.fights > 0 ? (
        <Line
          icon={<GameIcon name="fight" />}
          label={BOSSES.troll_chieftain.name}
          value={bossResultText(summary.boss)}
        />
      ) : null}
      {summary.dungeonsUnlocked.length > 0 ? (
        <Line icon={<GameIcon name="unlocked" />} label="Unlocked" value={summary.dungeonsUnlocked.map(dungeonOrBossName).join(', ')} />
      ) : null}
      {summary.heroXpGained > 0 ? <Line icon={<GameIcon name="hero_xp" />} label="Hero XP" value={`+${formatNumber(summary.heroXpGained)}`} /> : null}
      {summary.goldGained > 0 ? <Line icon={<GameIcon name="gold" />} label="Gold" value={`+${formatNumber(summary.goldGained)}`} /> : null}
      {summary.actions > 0 ? <Line icon={<SkillIcon skill="woodcutting" />} label="Logs cut" value={formatNumber(summary.actions)} /> : null}
      {summary.oresMined > 0 ? <Line icon={<SkillIcon skill="mining" />} label="Ores mined" value={formatNumber(summary.oresMined)} /> : null}
      {gained.map(([id, n]) => (
        <Line key={id} icon={<ItemIcon defId={id} size={16} />} label={itemName(id)} value={`+${formatNumber(n)}`} />
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
      {summary.workerActions > 0 ? <Section icon="workers">Workers</Section> : null}
      {workerGained.map(([id, n]) => (
        <Line key={`w-${id}`} icon={<ItemIcon defId={id} size={16} />} label={itemName(id)} value={`+${formatNumber(n)}`} />
      ))}
      {summary.craftsCompleted > 0 ? <Section icon="crafting">Crafted</Section> : null}
      {crafted.map(([id, n]) => (
        <Line key={`c-${id}`} icon={<ItemIcon defId={id} size={16} />} label={itemName(id)} value={`+${formatNumber(n)}`} />
      ))}
      {waits.map((w) => (
        <Text key={`wait-${w.pipe}-${w.defId}`} style={styles.muted}>
          Pipe {w.pipe + 1} waited for {itemName(w.defId)}
        </Text>
      ))}
      {ready.length > 0 ? <Section icon="ready">Ready to collect (Crafting)</Section> : null}
      {ready.map(([id, n]) => (
        <Line key={`r-${id}`} icon={<ItemIcon defId={id} size={16} />} label={itemName(id)} value={`×${formatNumber(n)}`} />
      ))}
      {summary.upkeepPaid > 0 ? <Line icon={<GameIcon name="gold" />} label="Upkeep paid" value={`−${formatNumber(summary.upkeepPaid)}`} cost /> : null}
      {summary.buildingsUpgraded.map((u) => (
        <Line key={`${u.buildingId}-${u.level}`} icon={<GameIcon name="upgrade" />} label={`${BUILDINGS[u.buildingId].name} upgraded`} value={`Lv ${u.level}`} />
      ))}
      {trained.map(([attribute, xp]) => {
        const levels = summary.trainingLevelsGained[attribute] ?? 0;
        return (
          <Line
            key={attribute}
            icon={<GameIcon name="training" />}
            label={`${ATTRIBUTE_NAMES[attribute].short} training`}
            value={`+${formatNumber(xp)} XP${levels > 0 ? ` (+${levels} Lv)` : ''}`}
          />
        );
      })}
      {maxed.map((attribute) => (
        <Text key={attribute} style={styles.warn}>
          {ATTRIBUTE_NAMES[attribute].label} maxed — {nextTierText} to keep training
        </Text>
      ))}
      {lost.map(([id, n]) => (
        <Text key={id} style={styles.lost}>
          Inventory full: {formatNumber(n)} {itemName(id)} lost
        </Text>
      ))}
      {workerLost.map(([id, n]) => (
        <Text key={`w-${id}`} style={styles.lost}>
          Inventory full: {formatNumber(n)} {itemName(id)} from workers lost
        </Text>
      ))}
      {summary.actions === 0 &&
      summary.oresMined === 0 &&
      summary.dungeon.runs === 0 &&
      trainingXpTotal(summary) === 0 &&
      summary.workerActions === 0 &&
      summary.craftsCompleted === 0 &&
      ready.length === 0 &&
      waits.length === 0 &&
      summary.buildingsUpgraded.length === 0 &&
      !backward ? (
        <Text style={styles.muted}>Nothing was gathered.</Text>
      ) : null}
    </View>
  );
}

function Line({ label, value, cost, icon }: { label: string; value: string; cost?: boolean; icon?: ReactNode }) {
  return (
    <View style={styles.line}>
      {icon ? (
        <IconText image={icon} style={styles.label} rowStyle={styles.labelRow}>
          {label}
        </IconText>
      ) : (
        <Text style={styles.label}>{label}</Text>
      )}
      <Text style={[styles.value, cost && styles.cost]}>{value}</Text>
    </View>
  );
}

function Section({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <IconText icon={icon} style={styles.section} rowStyle={styles.sectionRow}>
      {children}
    </IconText>
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
  cost: { color: colors.dangerDeadly },
  labelRow: { flexShrink: 1, gap: 6 },
  section: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  sectionRow: { marginTop: 6, gap: 6 },
  warn: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19, color: colors.goldDark },
  lost: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.hp },
  muted: { fontFamily: fonts.body, fontSize: 14, color: colors.inkSoft },
  actions: { alignItems: 'center', marginTop: 12 },
});
