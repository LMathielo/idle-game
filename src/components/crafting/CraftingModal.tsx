// Village → Crafting: full-screen modal. Eight pipe slots (2 open on a new save; 3–4 "Unlocks later", 5–8 "Premium —
// coming soon"). A material pipe (1.15.0) crafts its recipe until Stop: each craft takes its materials when it starts,
// and the pipe waits ("Waiting for Oak Logs (1/2)") while they are short. A running material craft shows "Crafted N",
// the time left, the bar with a live "xx.yy%", Insta, ×10 (that craft only) and Stop. Gear pipes are unchanged: one
// piece, Insta / Cancel, "✓ Ready — Done" and the reveal popover. The header's Recipes button opens the recipe list
// (an in-modal view, see RecipePicker.tsx) even when every pipe is busy; its Craft goes into the first free pipe. An
// idle pipe's "Craft…" opens the same list; its first Craft goes into that pipe, then the list behaves like Recipes. Rules stay in the engine: this file reads craftingView() /
// craftJobView() and dispatches START_CRAFT / INSTA_CRAFT / X10_CRAFT / STOP_CRAFT / CANCEL_CRAFT / COLLECT_CRAFT.
// Pipes are not an activity: nothing here stops or starts the hero.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, type HostInstance, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { collectedItemIdOf } from '../../client/dispatchEvents';
import { useGameSnapshot } from '../../client/GameProvider';
import { type CraftJobView, craftingView, craftJobView, freeSlots, type PipeView, type RecipeId, recipeView } from '../../engine';
import { colors, fonts, rarityColors } from '../../theme';
import { UpgradeEntry } from '../buildings/UpgradeEntry';
import { IconText, ItemIcon } from '../art/Sprites';
import { formatClock, formatNumber, formatPercentBp, itemName } from '../format';
import { RevealSheet } from '../items/RevealSheet';
import { LiveBar } from '../LiveBar';
import { closeVillageModal, ModalScreen } from '../ModalScreen';
import { PixelButton } from '../PixelButton';
import { type AnchorRect, measureAnchor } from '../ui/InfoPopover';
import { useCommand } from '../ui/useCommand';
import { RecipePicker } from './RecipePicker';

/** "2 Oak Logs, 1 Stone" */
const amounts = (items: { defId: string; quantity: number }[]) => items.map((i) => `${formatNumber(i.quantity)} ${itemName(i.defId)}`).join(', ');

/** The sub-view on screen: the pipe list, or the recipe list (`pipe`: the idle pipe its first Craft goes into; null: the first free pipe). */
type SubView = { kind: 'pipes' } | { kind: 'list'; pipe: number | null };
/** Room left after a popover closes before the next one presents (the iOS Modal dismiss animation). */
const REVEAL_GAP_MS = 400;
const PIPES: SubView = { kind: 'pipes' };

export function CraftingModal() {
  const { state, clockPaused } = useGameSnapshot();
  const view = craftingView(state); // 8 pipes + 40 recipes, read-only
  const [sub, setSub] = useState<SubView>(PIPES);
  /** When the last reveal closed: a new RN Modal presented while the old one is still dismissing (iOS) never shows. */
  const closedAt = useRef(0);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
    },
    [],
  );
  const presentReveal = useCallback((itemId: string, anchor: AnchorRect) => {
    const wait = Math.max(0, closedAt.current + REVEAL_GAP_MS - Date.now());
    if (revealTimer.current) clearTimeout(revealTimer.current);
    if (wait === 0) setReveal({ itemId, anchor });
    else revealTimer.current = setTimeout(() => setReveal({ itemId, anchor }), wait);
  }, []);
  /** The piece Done just collected: its popover (the reveal), anchored on the pipe it came from. */
  const [reveal, setReveal] = useState<{ itemId: string; anchor: AnchorRect } | null>(null);
  // CRAFT_CHANGED: the craft or job on screen finished meanwhile; the screen already shows the new state.
  const { send, sendForResult, dialog, client } = useCommand({ silentCodes: ['CRAFT_CHANGED'] });
  /** "Iron Sword started in Pipe 2": the recipe list's confirmation line. */
  const [started, setStarted] = useState<string | null>(null);
  const win = useWindowDimensions();

  // Android back steps out of a sub-view before it closes the modal.
  useEffect(() => {
    if (sub.kind === 'pipes') return;
    const h = BackHandler.addEventListener('hardwareBackPress', () => {
      setSub(PIPES);
      return true;
    });
    return () => h.remove();
  }, [sub]);
  const onClose = useCallback(() => (sub.kind !== 'pipes' ? setSub(PIPES) : closeVillageModal()), [sub]);
  const openPicker = useCallback((pipe: number) => {
    setStarted(null);
    setSub({ kind: 'list', pipe });
  }, []);
  const openRecipes = useCallback(() => {
    setStarted(null);
    setSub({ kind: 'list', pipe: null });
  }, []);

  /** Hold-to-repeat insta, bound to the job, craft and cost on screen now (read from the live state at each tick). */
  const onInsta = useCallback(
    (pipe: number, repeat: boolean) => {
      const live = craftJobView(client.getState(), pipe);
      if (!live || live.status !== 'running' || client.getState().stamina.current < live.instaCost) return Promise.resolve(false);
      return send({ type: 'INSTA_CRAFT', pipe, jobId: live.id, craft: live.craftNumber, maxCost: live.instaCost }, { quiet: repeat });
    },
    [client, send],
  );
  /** ×10 on the craft on screen (one tap, that craft only), bound to it and to the stamina shown. */
  const onX10 = useCallback(
    (pipe: number) => {
      const live = craftJobView(client.getState(), pipe);
      if (!live?.x10Tap || live.x10Tap.blocked) return;
      void send({ type: 'X10_CRAFT', pipe, jobId: live.id, craft: live.craftNumber, maxCost: live.x10Tap.stamina });
    },
    [client, send],
  );
  /** Stop (materials) or Cancel (gear), confirmed in a dialog that names what comes back. */
  const onEnd = useCallback(
    async (pipe: number) => {
      const live = craftJobView(client.getState(), pipe);
      if (!live || live.ready) return;
      const items = amounts(live.refund);
      if (live.kind === 'gear') {
        const lost = live.staminaInvested > 0 ? ` The ${formatNumber(live.staminaInvested)} stamina you invested is lost.` : '';
        const ok = await dialog.confirm({ title: `Cancel ${live.recipeName}?`, message: `You get back ${items}.${lost}`, confirmLabel: 'Cancel job', destructive: true });
        if (ok) await send({ type: 'CANCEL_CRAFT', pipe, jobId: live.id });
        return;
      }
      const message =
        live.refund.length === 0
          ? `The pipe is waiting for materials; nothing was taken. The ${formatNumber(live.done)} crafted stay yours.`
          : `You get back ${items} from the craft in progress${live.prepaid > 0 ? ' and the prepaid crafts' : ''}. The ${formatNumber(live.done)} crafted stay yours.${live.x10 ? ' The ×10 stamina is not refunded.' : ''}`;
      const ok = await dialog.confirm({ title: `Stop ${live.recipeName}?`, message, confirmLabel: 'Stop', destructive: true });
      if (ok) await send({ type: 'STOP_CRAFT', pipe, jobId: live.id });
    },
    [client, dialog, send],
  );
  /**
   * Craft from the recipe list: into `pipe`, or (null) into the first free open pipe. Stays on the list: the first craft
   * of an idle pipe's list used its pipe, so from then on the list behaves like the header's Recipes view.
   */
  const onCraft = useCallback(
    async (pipe: number | null, recipeId: string, stamina?: number) => {
      const base = pipe === null ? { type: 'START_CRAFT' as const, recipeId } : { type: 'START_CRAFT' as const, pipe, recipeId };
      const res = await sendForResult(stamina === undefined ? base : { ...base, stamina, maxCost: stamina });
      if (!res) return false;
      let startedPipe = pipe;
      for (const e of res.events) if (e.type === 'CRAFT_STARTED' && e.recipeId === recipeId && (pipe === null || e.pipe === pipe)) startedPipe = e.pipe;
      const name = recipeView(res.state, recipeId as RecipeId).name;
      setStarted(startedPipe === null ? `${name} started` : `${name} started in Pipe ${startedPipe + 1}`);
      setSub({ kind: 'list', pipe: null });
      return true;
    },
    [sendForResult],
  );
  /**
   * Done: collects the ready piece and opens its popover (the reveal) where the pipe row was. The id comes from the
   * engine's CRAFT_COLLECTED event (the dispatch first simulates up to now, which can move the item serial: a guess
   * made before it was wrong), and a failed measure falls back to the screen centre so the reveal always shows.
   */
  const onDone = useCallback(
    async (pipe: number, node: HostInstance | null) => {
      const live = craftJobView(client.getState(), pipe);
      if (!live?.ready) return;
      const anchor = (await measureAnchor(node)) ?? { x: win.width / 2 - 40, y: win.height / 3, width: 80, height: 40 };
      const res = await sendForResult({ type: 'COLLECT_CRAFT', pipe, jobId: live.id });
      const itemId = res ? collectedItemIdOf(res, live.id) : null;
      if (itemId) presentReveal(itemId, anchor);
    },
    [client, sendForResult, win.width, win.height, presentReveal],
  );
  const closeReveal = useCallback(() => {
    closedAt.current = Date.now();
    setReveal(null);
  }, []);
  const revealed = reveal ? (state.inventory.items.find((i) => i.id === reveal.itemId) ?? null) : null;
  const invFull = freeSlots(state.inventory) < 1;
  const title = sub.kind === 'list' ? (sub.pipe !== null ? `Crafting · Pipe ${sub.pipe + 1}` : 'Recipes') : 'Crafting';

  return (
    <ModalScreen
      title={title}
      buildingId="crafting"
      closeLabel={sub.kind !== 'pipes' ? 'Back to the pipes' : 'Close crafting'}
      onClose={onClose}
      headerRight={
        <View style={styles.headerRight}>
          <IconText icon="stamina" style={styles.stamina} accessibilityLabel={`Stamina ${state.stamina.current} of ${state.stamina.max}`}>
            {state.stamina.current}/{state.stamina.max}
          </IconText>
          {sub.kind === 'pipes' ? <PixelButton label="Recipes" onPress={openRecipes} accessibilityHint="Every recipe; Craft goes into the first free pipe" /> : null}
        </View>
      }
    >
      {clockPaused ? <Text style={styles.paused}>Paused: your device clock moved back. Crafting waits until it catches up.</Text> : null}
      {sub.kind !== 'pipes' ? (
        <RecipePicker pipe={sub.pipe} view={view} buildings={state.buildings} stamina={state.stamina.current} started={started} onCraft={onCraft} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.intro}>
            Craft time ×{formatPercentBp(view.timeBp)} (house) · −{formatPercentBp(view.intReductionBp)} (INT)
            {view.yieldBp > 0 ? ` · +${formatPercentBp(view.yieldBp)} yield` : ''}
          </Text>
          {view.pipes.map((p) => (
            <PipeRow
              key={p.index}
              pipe={p}
              paused={clockPaused}
              stamina={state.stamina.current}
              invFull={invFull}
              onPick={openPicker}
              onInsta={onInsta}
              onX10={onX10}
              onEnd={onEnd}
              onDone={onDone}
            />
          ))}
          <Text style={styles.note}>
            A material pipe keeps crafting until you stop it. Each craft takes its materials when it starts; when they run out the pipe waits
            (no time passes) and starts again the moment they are there, so gathering feeds it. Pipes share your materials and take turns in pipe
            order. Pipes craft side by side, beside anything the hero does, also while the app is closed (up to{' '}
            {formatNumber(state.offline.capMs / 3_600_000)}h). When the inventory is full, a finished craft waits until there is room. A finished
            piece of gear waits in its pipe until you tap Done.
          </Text>
          <UpgradeEntry buildingId="crafting" />
        </ScrollView>
      )}
      {revealed && reveal ? <RevealSheet key={revealed.id} itemId={revealed.id} anchor={reveal.anchor} onClose={closeReveal} /> : null}
    </ModalScreen>
  );
}

// ---------- one pipe ----------

type PipeRowProps = {
  pipe: PipeView;
  paused: boolean;
  stamina: number;
  invFull: boolean;
  onPick: (pipe: number) => void;
  onInsta: (pipe: number, repeat: boolean) => Promise<boolean>;
  onX10: (pipe: number) => void;
  onEnd: (pipe: number) => void;
  onDone: (pipe: number, node: HostInstance | null) => void;
};

/**
 * craftingView() builds new pipe objects on every tick, so the default memo would never hit: compare what the row
 * shows instead (an idle, locked or waiting pipe then skips the ticks; a running one re-renders with its progress).
 */
const samePipeRow = (a: PipeRowProps, b: PipeRowProps) =>
  a.paused === b.paused &&
  a.stamina === b.stamina &&
  a.invFull === b.invFull &&
  a.onPick === b.onPick &&
  a.onInsta === b.onInsta &&
  a.onX10 === b.onX10 &&
  a.onEnd === b.onEnd &&
  a.onDone === b.onDone &&
  JSON.stringify(a.pipe) === JSON.stringify(b.pipe);

const PipeRow = memo(function PipeRow({ pipe, paused, stamina, invFull, onPick, onInsta, onX10, onEnd, onDone }: PipeRowProps) {
  const n = pipe.index + 1;
  const index = pipe.index;
  const insta = useCallback(({ repeat }: { repeat: boolean }) => onInsta(index, repeat), [onInsta, index]);
  const x10 = useCallback(() => onX10(index), [onX10, index]);
  const end = useCallback(() => onEnd(index), [onEnd, index]);
  const done = useCallback((node: HostInstance | null) => onDone(index, node), [onDone, index]);
  const pick = useCallback(() => onPick(index), [onPick, index]);
  if (pipe.slot !== 'open') {
    return (
      <View style={[styles.pipe, styles.pipeLocked]} accessible accessibilityLabel={`Pipe ${n}, locked, ${pipe.slot === 'later' ? 'unlocks later' : 'premium, coming soon'}`}>
        <IconText icon="locked" style={styles.pipeTitleMuted}>
          Pipe {n}
        </IconText>
        <Text style={styles.pipeMuted}>{pipe.slot === 'later' ? 'Unlocks later' : 'Premium — coming soon'}</Text>
      </View>
    );
  }
  const job = pipe.job;
  if (!job) {
    return (
      <View style={styles.pipe}>
        <View style={styles.pipeHead}>
          <Text style={styles.pipeTitle}>Pipe {n}</Text>
          <Text style={styles.pipeMuted}>Idle</Text>
        </View>
        <View style={styles.buttons}>
          <PixelButton label="Craft…" onPress={pick} stretch accessibilityHint="Choose a recipe for this pipe" />
        </View>
      </View>
    );
  }
  if (job.kind === 'gear') {
    return <GearJobRow n={n} job={job} paused={paused} stamina={stamina} invFull={invFull} onInsta={insta} onCancel={end} onDone={done} />;
  }
  return <MaterialJobRow n={n} job={job} paused={paused} stamina={stamina} onInsta={insta} onX10={x10} onStop={end} />;
}, samePipeRow);

/** The current craft's bar, "0:03 left" and the live "xx.yy%". */
function CraftProgress({ job, paused }: { job: CraftJobView; paused: boolean }) {
  return (
    <>
      <LiveBar fraction={job.fraction} remainingMs={job.remainingMs} paused={paused} color={colors.skill} style={styles.bar} />
      <View style={styles.pipeHead}>
        <Text style={styles.time}>{formatClock(job.remainingMs)} left</Text>
        <LivePercent key={`${job.id}-${job.craftNumber}-${job.progressMs}`} progressMs={job.progressMs} craftMs={job.craftMs} running={!paused} />
      </View>
    </>
  );
}

type MaterialJobRowProps = {
  n: number;
  job: CraftJobView;
  paused: boolean;
  stamina: number;
  onInsta: (info: { repeat: boolean }) => Promise<boolean>;
  onX10: () => void;
  onStop: () => void;
};

/** A continuous material pipe: recipe, "Crafted N", then the craft in progress, or why it waits. */
function MaterialJobRow({ n, job, paused, stamina, onInsta, onX10, onStop }: MaterialJobRowProps) {
  const running = job.status === 'running';
  const tap = job.x10Tap;
  const waitingText = job.waitingFor.map((w) => `${itemName(w.defId)} (${formatNumber(w.have)}/${formatNumber(w.need)})`).join(', ');
  return (
    <View style={[styles.pipe, styles.pipeActive]}>
      <View style={styles.pipeHead}>
        <PipeTitle n={n} defId={job.outputDefId} name={`${job.recipeName}${job.x10 ? ' ×10' : ''}`} />
        <Text style={styles.count} accessibilityLabel={`${job.done} crafted since this job started`}>
          Crafted {formatNumber(job.done)}
        </Text>
      </View>
      {job.status === 'waiting' ? (
        <Text style={styles.held}>Waiting for {waitingText}</Text>
      ) : job.status === 'held' ? (
        <Text style={styles.held}>Inventory full — waiting for room (nothing is lost)</Text>
      ) : (
        <CraftProgress job={job} paused={paused} />
      )}
      {job.prepaid > 0 ? <Text style={styles.pipeMuted}>{formatNumber(job.prepaid)} crafts already paid for</Text> : null}
      <View style={styles.buttons}>
        {running ? (
          <>
            <PixelButton
              label={`Insta · ${job.instaCost}`}
              icon="stamina"
              repeat={onInsta}
              disabled={stamina < job.instaCost}
              stretch
              accessibilityLabel={`Finish this craft now for ${job.instaCost} stamina`}
            />
            <PixelButton
              label={job.x10 ? '×10 on' : `×10 · ${tap?.stamina ?? 0}`}
              icon={job.x10 ? undefined : 'stamina'}
              sublabel={job.x10 ? 'this craft' : (tap?.blocked ?? (tap ? `+${amounts(tap.items)}` : undefined))}
              onPress={onX10}
              disabled={!tap || tap.blocked !== null}
              stretch
              accessibilityLabel={
                job.x10
                  ? 'This craft is already times ten'
                  : tap
                    ? `Times ten on this craft: ${amounts(tap.items)} more and ${tap.stamina} stamina for ten times the output${tap.blocked ? `. ${tap.blocked}` : ''}`
                    : 'Times ten not available'
              }
            />
          </>
        ) : null}
        <PixelButton label="Stop" onPress={onStop} stretch accessibilityHint="Asks to confirm; the craft in progress is refunded" />
      </View>
    </View>
  );
}

type GearJobRowProps = {
  n: number;
  job: CraftJobView;
  paused: boolean;
  stamina: number;
  invFull: boolean;
  onInsta: (info: { repeat: boolean }) => Promise<boolean>;
  onCancel: () => void;
  onDone: (node: HostInstance | null) => void;
};

/** A gear pipe (unchanged in 1.15.0): one piece; Insta / Cancel while crafting, "✓ Ready — Done" when finished. */
function GearJobRow({ n, job, paused, stamina, invFull, onInsta, onCancel, onDone }: GearJobRowProps) {
  const rowRef = useRef<HostInstance>(null);
  return (
    <View ref={rowRef} style={[styles.pipe, styles.pipeActive, job.ready && styles.pipeReady]}>
      <View style={styles.pipeHead}>
        <PipeTitle n={n} defId={job.outputDefId} name={job.recipeName} />
      </View>
      {job.ready ? (
        <>
          <LiveBar fraction={1} remainingMs={0} paused color={colors.skill} style={styles.bar} />
          <View style={styles.pipeHead}>
            <Text style={styles.ready}>✓ Ready — Done</Text>
            <Text style={styles.percent}>100.00%</Text>
          </View>
          <View style={styles.buttons}>
            <PixelButton
              label="Done"
              sublabel={invFull ? 'Inventory full' : undefined}
              onPress={() => onDone(rowRef.current)}
              disabled={invFull}
              stretch
              accessibilityHint={invFull ? 'Free an inventory slot first; the piece stays safe in the pipe' : 'Puts the finished piece in your inventory and shows it'}
            />
          </View>
        </>
      ) : (
        <>
          <CraftProgress job={job} paused={paused} />
          <View style={styles.buttons}>
            <PixelButton
              label={`Insta · ${job.instaCost}`}
              icon="stamina"
              repeat={onInsta}
              disabled={stamina < job.instaCost}
              stretch
              accessibilityLabel={`Finish this craft now for ${job.instaCost} stamina`}
            />
            <PixelButton label="Cancel" onPress={onCancel} stretch accessibilityHint="Asks to confirm; materials are refunded, invested stamina is not" />
          </View>
        </>
      )}
    </View>
  );
}

/**
 * The current craft's progress as "xx.yy%", moving between engine ticks: it counts on from the last state (remounted on
 * each one, via `key`) every 100 ms, never past 100%. Display only: the engine's progress is what counts. The count
 * restarts from the engine's progress whenever it (re)starts running, so a clock pause never makes it jump ahead.
 */
function LivePercent({ progressMs, craftMs, running }: { progressMs: number; craftMs: number; running: boolean }) {
  const since = useRef(Date.now());
  const [now, setNow] = useState(since.current);
  useEffect(() => {
    if (!running) return;
    since.current = Date.now();
    setNow(since.current);
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [running]);
  const p = running ? Math.min(craftMs, progressMs + Math.max(0, now - since.current)) : progressMs;
  return <Text style={styles.percent}>{craftMs > 0 ? ((p / craftMs) * 100).toFixed(2) : '100.00'}%</Text>;
}


/** "Pipe 2 · [icon] Oak Planks" on one line (the name is cut, never wrapped). */
function PipeTitle({ n, defId, name }: { n: number; defId: string; name: string }) {
  return (
    <View style={styles.pipeTitleRow}>
      <Text style={[styles.pipeTitle, styles.pipeTitlePrefix]}>Pipe {n} ·</Text>
      <ItemIcon defId={defId} size={16} />
      <Text style={[styles.pipeTitle, styles.pipeTitleName]} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stamina: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.stamina },
  paused: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold, paddingHorizontal: 16, paddingTop: 8 },
  intro: { fontFamily: fonts.body, fontSize: 14, color: colors.parchment, marginBottom: 10 },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.parchmentDark, marginTop: 4 },
  pipe: { backgroundColor: colors.woodDark, borderWidth: 2, borderColor: colors.wood, padding: 10, marginBottom: 10, gap: 6 },
  pipeActive: { borderColor: colors.gold },
  pipeReady: { borderColor: colors.skill },
  ready: { fontFamily: fonts.bodyBold, fontSize: 14, color: rarityColors.uncommon }, // readable green on woodDark (≥ 4.5:1)
  pipeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  pipeTitlePrefix: { flexShrink: 0 },
  pipeTitleName: { flexShrink: 1 },
  pipeLocked: { opacity: 0.6 },
  pipeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  pipeTitle: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.parchment },
  pipeTitleMuted: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.parchmentDark },
  pipeMuted: { fontFamily: fonts.body, fontSize: 14, color: colors.parchmentDark },
  count: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.gold },
  held: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.stamina },
  bar: { marginTop: 2 },
  time: { fontFamily: fonts.body, fontSize: 14, color: colors.parchment },
  percent: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold, fontVariant: ['tabular-nums'] },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 4 },
});
