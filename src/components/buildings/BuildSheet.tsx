// A locked village building's info box (InfoPopover, anchored on its sign): what it is, each requirement with have /
// need and met / unmet, and a Build button inside, enabled only when everything is met. Reads buildingView() through
// the game state and dispatches BUILD; the engine re-checks every requirement (REQUIREMENTS_NOT_MET / ALREADY_BUILT
// change nothing). Errors show inline.
import { useCallback, useRef, useState } from 'react';
import { useGameClient, useGameSnapshot } from '../../client/GameProvider';
import { BUILDINGS, type BuildingId, buildingView, type RequirementView } from '../../engine';
import { DEV_TOOLS_ENABLED } from '../../engine/config/dev';
import { formatNumber, itemIcon, itemName } from '../format';
import { PixelButton } from '../PixelButton';
import { type AnchorRect, InfoPopover, POPOVER_BAD, POPOVER_GOOD, PopoverActions, PopoverRow, PopoverSection, PopoverText } from '../ui/InfoPopover';

type Props = {
  buildingId: BuildingId | null;
  /** The tapped sign (measureAnchor). */
  anchor: AnchorRect | null;
  onClose: () => void;
  /** Called after a successful build, with the building's name. */
  onBuilt: (name: string) => void;
};

function requirementText(r: RequirementView): { label: string; have: string; need: string } {
  switch (r.kind) {
    case 'heroLevel':
      return { label: '⭐ Hero level', have: formatNumber(r.have), need: formatNumber(r.need) };
    case 'building':
      return { label: `${BUILDINGS[r.buildingId].icon} ${BUILDINGS[r.buildingId].name}`, have: r.have > 0 ? 'built' : 'not built', need: 'built' };
    case 'item':
      return { label: `${itemIcon(r.defId)} ${itemName(r.defId)}`, have: formatNumber(r.have), need: formatNumber(r.need) };
    case 'gold':
      return { label: '🪙 Gold', have: formatNumber(r.have), need: formatNumber(r.need) };
  }
}

export function BuildSheet({ buildingId, anchor, onClose, onBuilt }: Props) {
  const client = useGameClient();
  const { state } = useGameSnapshot();
  const [error, setError] = useState<string | null>(null);
  /** Styling only (greys the buttons while a build is in flight). */
  const [busy, setBusy] = useState(false);
  /** One command at a time: a ref, so two taps in the same frame never send two (state updates land too late). */
  const inFlight = useRef(false);
  const view = buildingId ? buildingView(state, buildingId) : null;

  const close = useCallback(() => {
    setError(null);
    onClose();
  }, [onClose]);

  const send = useCallback(
    (debug: boolean) => {
      if (!buildingId || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      const name = BUILDINGS[buildingId].name;
      const run = debug ? client.debug.build(buildingId) : client.dispatch({ type: 'BUILD', buildingId });
      run
        .then((res) => {
          if (res.ok) {
            setError(null);
            onBuilt(name);
          } else {
            setError(res.error.message);
          }
        })
        .catch(() => setError('Could not save. Try again.'))
        .finally(() => {
          inFlight.current = false;
          setBusy(false);
        });
    },
    [buildingId, client, onBuilt],
  );

  if (!view) return null;
  return (
    <InfoPopover anchor={anchor} onClose={close} title={view.name} icon={view.icon} subtitle="🔒 Not built yet">
      <PopoverText tone="note">{view.description}</PopoverText>
      <PopoverSection>Needs</PopoverSection>
      {view.requirements.map((r, i) => {
        const t = requirementText(r);
        return (
          <PopoverRow
            key={i}
            label={
              <>
                <PopoverText tone={r.met ? 'good' : 'bad'}>{r.met ? '✓ ' : '✗ '}</PopoverText>
                {t.label}
              </>
            }
            value={r.kind === 'building' ? t.have : `${t.have} / ${t.need}`}
            valueColor={r.met ? POPOVER_GOOD : POPOVER_BAD}
          />
        );
      })}
      {view.requirements.some((r) => r.kind === 'item' || r.kind === 'gold') ? <PopoverText tone="note">Gold and materials are used up when you build.</PopoverText> : null}
      {view.grantsTrainingTier ? <PopoverText tone="note">Comes with Training Tier {view.grantsTrainingTier}.</PopoverText> : null}
      {error ? <PopoverText tone="bad">{error}</PopoverText> : null}
      <PopoverActions>
        <PixelButton
          label="Build"
          onPress={() => send(false)}
          disabled={!view.canBuild || busy}
          stretch
          accessibilityHint={view.canBuild ? `Builds the ${view.name} now` : 'Not every requirement is met'}
        />
      </PopoverActions>
      {DEV_TOOLS_ENABLED ? (
        <PopoverActions>
          <PixelButton label="Build free (debug)" onPress={() => send(true)} disabled={busy} stretch accessibilityHint="Debug: builds it without the requirements" />
        </PopoverActions>
      ) : null}
    </InfoPopover>
  );
}
