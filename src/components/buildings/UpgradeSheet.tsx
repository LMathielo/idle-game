// A building's upgrade info box (InfoPopover, anchored on its Upgrade button): current level, this level's and the
// next level's bonuses, the cost (have / need, met / unmet), the builder time, why it can't start (Town Hall cap,
// builder busy, max level), and the Upgrade button inside. Reads upgradeView() / constructionView() and dispatches
// UPGRADE_BUILDING (bound to the level shown); the engine re-checks everything. While this building is being upgraded
// it shows the countdown, plus a debug "finish now" button. Errors show inline.
import { useCallback, useRef, useState } from 'react';
import { useGameClient, useGameSnapshot } from '../../client/GameProvider';
import { BUILDINGS, type BuildingId, constructionView, DEV_TOOLS_ENABLED, type RequirementView, upgradeView } from '../../engine';
import { formatCountdown, formatHoursMinutes, formatNumber, itemIcon, itemName } from '../format';
import { PixelButton } from '../PixelButton';
import { type AnchorRect, InfoPopover, POPOVER_BAD, POPOVER_GOOD, PopoverActions, PopoverRow, PopoverSection, PopoverText } from '../ui/InfoPopover';
import { bonusLines, trainingRateStep } from './bonusText';

type Props = {
  buildingId: BuildingId | null;
  /** The tapped Upgrade button (measureAnchor). */
  anchor: AnchorRect | null;
  onClose: () => void;
};

function costText(r: RequirementView): { label: string; have: string; need: string } {
  if (r.kind === 'item') return { label: `${itemIcon(r.defId)} ${itemName(r.defId)}`, have: formatNumber(r.have), need: formatNumber(r.need) };
  return { label: '🪙 Gold', have: formatNumber(r.have), need: formatNumber(r.need) };
}

export function UpgradeSheet({ buildingId, anchor, onClose }: Props) {
  const client = useGameClient();
  const { state } = useGameSnapshot();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** One command at a time: a ref, so two taps in the same frame never send two. */
  const inFlight = useRef(false);
  const view = buildingId ? upgradeView(state, buildingId) : null;
  const job = constructionView(state);

  const close = useCallback(() => {
    setError(null);
    onClose();
  }, [onClose]);

  const run = useCallback((p: Promise<{ ok: true } | { ok: false; error: { message: string } }>) => {
    inFlight.current = true;
    setBusy(true);
    p.then((res) => setError(res.ok ? null : res.error.message))
      .catch(() => setError('Could not save. Try again.'))
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  }, []);

  const upgrade = useCallback(() => {
    if (!buildingId || !view?.nextLevel || inFlight.current) return;
    run(client.dispatch({ type: 'UPGRADE_BUILDING', buildingId, level: view.nextLevel }));
  }, [buildingId, client, run, view?.nextLevel]);

  const finishNow = useCallback(() => {
    if (inFlight.current) return;
    run(client.debug.finishConstruction());
  }, [client, run]);

  if (!view || !buildingId) return null;
  const def = BUILDINGS[buildingId];
  const now = bonusLines(view.bonuses);
  const next = view.nextBonuses ? bonusLines(view.nextBonuses) : [];
  const rateStep = trainingRateStep(view.bonuses, view.nextBonuses);
  const mine = job && job.buildingId === buildingId ? job : null;

  let blockText: string | null = null;
  if (view.block === 'max_level') blockText = `Max level (${view.maxLevel}).`;
  else if (view.block === 'town_hall') blockText = `Upgrade the Town Hall to Lv ${view.townHallNeeded} first: no building goes above it.`;
  else if (view.block === 'builder_busy' && job && !mine) blockText = `The builder is busy: ${job.name} → Lv ${job.level} (${formatCountdown(job.remainingMs)} left). One upgrade at a time.`;
  else if (view.block === 'locked') blockText = 'Build it first.';
  else if (view.block === 'not_upgradable') blockText = "Can't be upgraded yet: its next level gives nothing.";

  return (
    <InfoPopover anchor={anchor} onClose={close} title={def.name} icon={def.icon} subtitle={`Level ${view.level} / ${view.maxLevel}`}>
      {mine ? (
        <PopoverText tone="gold">
          🔨 Upgrading to Lv {mine.level} · {formatCountdown(mine.remainingMs)} left
        </PopoverText>
      ) : null}

      <PopoverSection>Now (Lv {view.level})</PopoverSection>
      {now.length > 0 ? now.map((l) => <PopoverText key={l}>• {l}</PopoverText>) : <PopoverText tone="note">No passive bonus.</PopoverText>}

      {view.nextLevel && !mine ? (
        <>
          <PopoverSection>Next (Lv {view.nextLevel})</PopoverSection>
          {next.length > 0 ? next.map((l) => <PopoverText key={l} tone="good">• {l}</PopoverText>) : <PopoverText tone="note">No new passive bonus yet.</PopoverText>}
          {rateStep ? <PopoverText tone="note">{rateStep}</PopoverText> : null}
          <PopoverSection>Cost</PopoverSection>
          {view.cost.map((r, i) => {
            const t = costText(r);
            return (
              <PopoverRow
                key={i}
                label={
                  <>
                    <PopoverText tone={r.met ? 'good' : 'bad'}>{r.met ? '✓ ' : '✗ '}</PopoverText>
                    {t.label}
                  </>
                }
                value={`${t.have} / ${t.need}`}
                valueColor={r.met ? POPOVER_GOOD : POPOVER_BAD}
              />
            );
          })}
          <PopoverRow label="⏳ Builder time" value={formatHoursMinutes(view.durationMs)} />
          <PopoverText tone="note">Paid up front. Upgrades go on while you play and while the app is closed; one at a time.</PopoverText>
        </>
      ) : null}

      {blockText ? <PopoverText tone="gold">{blockText}</PopoverText> : null}
      {error ? <PopoverText tone="bad">{error}</PopoverText> : null}
      {view.nextLevel && !mine ? (
        <PopoverActions>
          <PixelButton
            label={`Upgrade to Lv ${view.nextLevel}`}
            onPress={upgrade}
            disabled={view.block !== null || busy}
            stretch
            accessibilityHint={view.block === null ? `Pays the cost and starts the builder` : 'Not possible right now'}
          />
        </PopoverActions>
      ) : null}
      {mine && DEV_TOOLS_ENABLED ? (
        <PopoverActions>
          <PixelButton label="Finish now (debug)" onPress={finishNow} disabled={busy} stretch accessibilityHint="Debug: finishes this upgrade at once for free" />
        </PopoverActions>
      ) : null}
    </InfoPopover>
  );
}
