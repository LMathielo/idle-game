// "Upgrade" entry for a building's modal: a button showing the level and what the builder is doing, opening the
// upgrade info box (UpgradeSheet, an InfoPopover anchored on this button). Read-only selectors only; the box dispatches.
import { memo, useCallback, useRef, useState } from 'react';
import { type HostInstance, StyleSheet, View } from 'react-native';
import { useGameState } from '../../client/GameProvider';
import { type BuildingId, constructionView, upgradeView } from '../../engine';
import { formatCountdown } from '../format';
import { PixelButton } from '../PixelButton';
import { type AnchorRect, measureAnchor } from '../ui/InfoPopover';
import { UpgradeSheet } from './UpgradeSheet';

export const UpgradeEntry = memo(function UpgradeEntry({ buildingId }: { buildingId: BuildingId }) {
  const state = useGameState();
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const ref = useRef<HostInstance>(null);
  const show = useCallback(() => {
    void measureAnchor(ref.current).then(setAnchor);
  }, []);
  const hide = useCallback(() => setAnchor(null), []);
  const view = upgradeView(state, buildingId);
  const job = constructionView(state);
  const mine = job?.buildingId === buildingId ? job : null;
  // Nothing to upgrade to (no bonus data for the next level): no entry at all.
  if (view.block === 'not_upgradable' && !mine) return null;
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
        ref={ref}
        label={`🔨 Upgrade · Lv ${view.level}`}
        sublabel={sub}
        onPress={show}
        active={!!mine}
        stretch
        accessibilityLabel={`Upgrade, level ${view.level}, ${sub}`}
        accessibilityHint="Shows the next level's bonuses and cost"
      />
      {anchor ? <UpgradeSheet buildingId={buildingId} anchor={anchor} onClose={hide} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12 },
});
