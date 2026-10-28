// "Upgrade" entry for a building's modal: a button showing the level and what the builder is doing, opening the
// UpgradeSheet. Read-only selectors only; the sheet dispatches.
import { memo, useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useGameState } from '../../client/GameProvider';
import { type BuildingId, constructionView, upgradeView } from '../../engine';
import { formatCountdown } from '../format';
import { PixelButton } from '../PixelButton';
import { UpgradeSheet } from './UpgradeSheet';

export const UpgradeEntry = memo(function UpgradeEntry({ buildingId }: { buildingId: BuildingId }) {
  const state = useGameState();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const view = upgradeView(state, buildingId);
  const job = constructionView(state);
  const mine = job?.buildingId === buildingId ? job : null;
  const sub = mine
    ? `Upgrading → Lv ${mine.level} · ${formatCountdown(mine.remainingMs)}`
    : view.nextLevel === null
      ? 'Max level'
      : view.block === 'town_hall'
        ? `Needs Town Hall Lv ${view.townHallNeeded}`
        : `Lv ${view.level} → ${view.nextLevel}`;
  return (
    <View style={styles.row}>
      <PixelButton
        label={`🔨 Upgrade · Lv ${view.level}`}
        sublabel={sub}
        onPress={show}
        active={!!mine}
        stretch
        accessibilityLabel={`Upgrade, level ${view.level}, ${sub}`}
        accessibilityHint="Shows the next level's bonuses and cost"
      />
      {open ? <UpgradeSheet buildingId={buildingId} onClose={hide} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12 },
});
