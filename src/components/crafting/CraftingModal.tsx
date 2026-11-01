// Village → Crafting: full-screen modal. Eight pipe slots (2 open on a new save; 3–4 "Unlocks later", 5–8 "Premium —
// coming soon"). A material pipe (1.15.0) crafts its recipe until Stop: each craft takes its materials when it starts,
// and the pipe waits ("Waiting for Oak Logs (1/2)") while they are short. A running material craft shows "Crafted N",
// the time left, the bar with a live "xx.yy%", Insta, ×10 (that craft only) and Stop. Gear pipes are unchanged: one
// piece, Insta / Cancel, "✓ Ready — Done" and the reveal popover. The header's Recipes button opens the recipe list
// (an in-modal view, Materials | Equipment) even when every pipe is busy; its Start goes into the first free pipe. An
// idle pipe's "Craft…" opens the same list for that pipe. Rules stay in the engine: this file reads craftingView() /
// craftJobView() and dispatches START_CRAFT / INSTA_CRAFT / X10_CRAFT / STOP_CRAFT / CANCEL_CRAFT / COLLECT_CRAFT.
// Pipes are not an activity: nothing here stops or starts the hero.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, type HostInstance, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGameSnapshot } from '../../client/GameProvider';
import {
  collectedItemId,
  type CraftingView,
  craftingView,
  craftJobView,
  type CraftJobView,
  freeSlots,
  type GameState,
  gearQualityFloor,
  type GearStats,
  type PipeView,
  type RecipeView,
} from '../../engine';
import { colors, fonts, rarityColors } from '../../theme';
import { UpgradeEntry } from '../buildings/UpgradeEntry';
import { formatClock, formatNumber, formatPercentBp, itemIcon, itemName } from '../format';
import { RARITY_COLOR_NAMES } from '../items/itemInfo';
import { ItemSheet } from '../items/ItemSheet';
import { LiveBar } from '../LiveBar';
import { closeVillageModal, ModalScreen } from '../ModalScreen';
import { Panel } from '../Panel';
import { PixelButton } from '../PixelButton';
import { type AnchorRect, measureAnchor } from '../ui/InfoPopover';
import { useCommand } from '../ui/useCommand';

/** Craft time: one decimal under a minute (4.6s), m:ss above. */
const formatCraftTime = (ms: number) => (ms < 60_000 ? `${(Math.ceil(ms / 100) / 10).toFixed(1)}s` : formatClock(ms));

/** "2 Oak Logs, 1 Stone" */
const amounts = (items: { defId: string; quantity: number }[]) => items.map((i) => `${formatNumber(i.quantity)} ${itemName(i.defId)}`).join(', ');

/** The sub-view on screen: the pipe list, the recipe list for one idle pipe, or the header's Recipes view. */
type SubView = { kind: 'pipes' } | { kind: 'picker'; pipe: number } | { kind: 'recipes' };
const PIPES: SubView = { kind: 'pipes' };

export function CraftingModal() {
  const { state, clockPaused } = useGameSnapshot();
  const view = craftingView(state); // 8 pipes + 40 recipes, read-only
  const [sub, setSub] = useState<SubView>(PIPES);
  /** The piece Done just collected: its popover (the reveal), anchored on the pipe it came from. */
  const [reveal, setReveal] = useState<{ itemId: string; anchor: AnchorRect } | null>(null);
  // CRAFT_CHANGED: the craft or job on screen finished meanwhile; the screen already shows the new state.
  const { send, dialog, client } = useCommand({ silentCodes: ['CRAFT_CHANGED'] });

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
  const openPicker = useCallback((pipe: number) => setSub({ kind: 'picker', pipe }), []);
  const openRecipes = useCallback(() => setSub({ kind: 'recipes' }), []);
  const back = useCallback(() => setSub(PIPES), []);

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
  /** Start from a recipe list: into `pipe`, or (null: the Recipes view) into the first free open pipe. */
  const onStart = useCallback(
    async (pipe: number | null, recipeId: string, stamina?: number) => {
      const base = pipe === null ? { type: 'START_CRAFT' as const, recipeId } : { type: 'START_CRAFT' as const, pipe, recipeId };
      if (await send(stamina === undefined ? base : { ...base, stamina, maxCost: stamina })) setSub(PIPES);
    },
    [send],
  );
  /** Done: collects the ready piece and opens its popover (the reveal) where the pipe row was. */
  const onDone = useCallback(
    async (pipe: number, node: HostInstance | null) => {
      const live = craftJobView(client.getState(), pipe);
      if (!live?.ready) return;
      const anchor = await measureAnchor(node);
      const itemId = collectedItemId(client.getState(), live.outputDefId);
      if ((await send({ type: 'COLLECT_CRAFT', pipe, jobId: live.id })) && anchor) setReveal({ itemId, anchor });
    },
    [client, send],
  );
  const closeReveal = useCallback(() => setReveal(null), []);
  const revealed = reveal ? (state.inventory.items.find((i) => i.id === reveal.itemId) ?? null) : null;
  const invFull = freeSlots(state.inventory) < 1;
  const title = sub.kind === 'picker' ? `Crafting · Pipe ${sub.pipe + 1}` : sub.kind === 'recipes' ? 'Recipes' : 'Crafting';

  return (
    <ModalScreen
      title={title}
      buildingId="crafting"
      closeLabel={sub.kind !== 'pipes' ? 'Back to the pipes' : 'Close crafting'}
      onClose={onClose}
      headerRight={
        <View style={styles.headerRight}>
          <Text style={styles.stamina} accessibilityLabel={`Stamina ${state.stamina.current} of ${state.stamina.max}`}>
            ⚡ {state.stamina.current}/{state.stamina.max}
          </Text>
          {sub.kind === 'pipes' ? <PixelButton label="Recipes" onPress={openRecipes} accessibilityHint="Every recipe; Start goes into the first free pipe" /> : null}
        </View>
      }
    >
      {clockPaused ? <Text style={styles.paused}>⏸ Paused: your device clock moved back. Crafting waits until it catches up.</Text> : null}
      {sub.kind !== 'pipes' ? (
        <RecipePicker
          pipe={sub.kind === 'picker' ? sub.pipe : null}
          view={view}
          buildings={state.buildings}
          stamina={state.stamina.current}
          onStart={onStart}
          onBack={back}
        />
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
        <Text style={styles.pipeTitleMuted}>🔒 Pipe {n}</Text>
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
        <Text style={styles.pipeTitle} numberOfLines={1}>
          Pipe {n} · {itemIcon(job.outputDefId)} {job.recipeName}
          {job.x10 ? ' ×10' : ''}
        </Text>
        <Text style={styles.count} accessibilityLabel={`${job.done} crafted since this job started`}>
          Crafted {formatNumber(job.done)}
        </Text>
      </View>
      {job.status === 'waiting' ? (
        <Text style={styles.held}>⏳ Waiting for {waitingText}</Text>
      ) : job.status === 'held' ? (
        <Text style={styles.held}>📦 Inventory full — waiting for room (nothing is lost)</Text>
      ) : (
        <CraftProgress job={job} paused={paused} />
      )}
      {job.prepaid > 0 ? <Text style={styles.pipeMuted}>{formatNumber(job.prepaid)} crafts already paid for</Text> : null}
      <View style={styles.buttons}>
        {running ? (
          <>
            <PixelButton
              label={`⚡ Insta · ${job.instaCost}`}
              repeat={onInsta}
              disabled={stamina < job.instaCost}
              stretch
              accessibilityLabel={`Finish this craft now for ${job.instaCost} stamina`}
            />
            <PixelButton
              label={job.x10 ? '×10 on' : `×10 · ⚡ ${tap?.stamina ?? 0}`}
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
        <Text style={styles.pipeTitle} numberOfLines={1}>
          Pipe {n} · {itemIcon(job.outputDefId)} {job.recipeName}
        </Text>
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
              label={`⚡ Insta · ${job.instaCost}`}
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

/** The reveal: the collected piece's popover (rarity colour, quality, scaled stats) with Equip. Follows the live item. */
function RevealSheet({ itemId, anchor, onClose }: { itemId: string; anchor: AnchorRect; onClose: () => void }) {
  const { state } = useGameSnapshot();
  const { send } = useCommand();
  const item = state.inventory.items.find((i) => i.id === itemId) ?? null;
  if (!item?.slot) return null;
  const equipped = state.character.equipment[item.slot] ?? null;
  return (
    <ItemSheet
      item={item}
      anchor={anchor}
      equipped={equipped}
      onClose={onClose}
      actions={[
        {
          label: 'Equip',
          sublabel: equipped ? `swaps ${equipped.name}` : undefined,
          onPress: () => void send({ type: 'EQUIP_ITEM', itemId: item.id }).then((ok) => ok && onClose()),
        },
      ]}
    />
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

// ---------- the recipe list (a pipe's "Craft…" or the header's Recipes) ----------

type PickerProps = {
  /** The idle pipe it was opened for, or null: the Recipes view (Start goes into the first free open pipe). */
  pipe: number | null;
  view: CraftingView;
  buildings: GameState['buildings'];
  stamina: number;
  onStart: (pipe: number | null, recipeId: string, stamina?: number) => void;
  onBack: () => void;
};

type PickerTab = 'material' | 'gear';

/** Where Start goes and whether it can: the named pipe, else the first free one ("All pipes busy" when none). */
type Target = { pipe: number | null; label: string; blocked: string | null };

function RecipePicker({ pipe, view, buildings, stamina, onStart, onBack }: PickerProps) {
  const [tab, setTab] = useState<PickerTab>('material');
  const [selected, setSelected] = useState<string | null>(null);
  const tiers = useMemo(() => {
    const out = new Map<number, RecipeView[]>();
    for (const r of view.recipes) if (r.kind === tab) out.set(r.tier, [...(out.get(r.tier) ?? []), r]);
    return [...out.entries()];
  }, [view.recipes, tab]);
  const switchTab = useCallback((t: PickerTab) => {
    setTab(t);
    setSelected(null);
  }, []);
  const target: Target =
    pipe !== null
      ? { pipe, label: `Pipe ${pipe + 1}`, blocked: null }
      : view.freePipe !== null
        ? { pipe: null, label: `Pipe ${view.freePipe + 1}`, blocked: null }
        : { pipe: null, label: '', blocked: 'All pipes busy' };
  const recipe = (tab === 'material' && view.recipes.find((r) => r.recipeId === selected)) || null;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.tabs}>
        <PixelButton label="Materials" active={tab === 'material'} stretch onPress={() => switchTab('material')} accessibilityLabel="Materials recipes" />
        <PixelButton label="Equipment" active={tab === 'gear'} stretch onPress={() => switchTab('gear')} accessibilityLabel="Equipment recipes" />
      </View>
      {pipe === null ? (
        <Text style={styles.intro}>{target.blocked ? 'All pipes are busy: stop one to start another recipe.' : `Start goes into ${target.label}, the first free pipe.`}</Text>
      ) : null}
      {recipe ? (
        <Panel title={`${itemIcon(recipe.output.defId)} ${recipe.name}`}>
          <Text style={styles.detail}>
            Each craft uses {recipe.inputs.map((i) => `${formatNumber(i.perCraft)} ${itemName(i.defId)} (you have ${formatNumber(i.have)})`).join(', ')}
          </Text>
          <Text style={styles.detail}>
            Makes {formatNumber(recipe.output.perCraft)} {itemName(recipe.output.defId)}
            {view.yieldBp > 0 ? ` +${formatPercentBp(view.yieldBp)}` : ''} · {formatCraftTime(recipe.craftMs)} each
          </Text>
          <Text style={styles.detail}>Crafts until you stop it. Without materials the pipe waits and starts again when they arrive. ×10 is a tap on the craft in progress.</Text>
          <View style={styles.buttons}>
            <PixelButton
              label={target.blocked ? 'Start' : `Start · ${target.label}`}
              sublabel={target.blocked ?? (recipe.enough ? undefined : 'waits for materials')}
              onPress={() => onStart(target.pipe, recipe.recipeId)}
              disabled={target.blocked !== null}
              stretch
            />
            <PixelButton label="Back" onPress={onBack} stretch />
          </View>
        </Panel>
      ) : null}
      {tab === 'gear' ? (
        <Text style={styles.intro}>
          One piece per job. Quality (0–100%) scales its stats; invest stamina to raise the lowest quality it can roll. Quality and colour show when you
          tap Done.
        </Text>
      ) : null}
      {tiers.map(([tier, recipes]) => (
        <View key={tier} style={styles.tier}>
          <Text style={styles.tierTitle}>
            Tier {tier}
            {tab === 'gear' ? ` · ${recipes[0].name.split(' ')[0]}` : ''}
          </Text>
          {recipes.map((r) =>
            r.kind === 'gear' ? (
              <GearCard
                key={r.recipeId}
                recipe={r}
                buildings={buildings}
                selected={r.recipeId === selected}
                onPress={setSelected}
                stamina={stamina}
                target={target}
                onStart={onStart}
                onBack={onBack}
              />
            ) : (
              <RecipeRow key={r.recipeId} recipe={r} selected={r.recipeId === selected} onPress={setSelected} />
            ),
          )}
        </View>
      ))}
    </ScrollView>
  );
}

/** "4–6 damage", "+3 armor": a gear recipe's stats at 100% quality. */
function statText(st: GearStats): string {
  const out: string[] = [];
  if (st.damage) out.push(`${st.damage.min}–${st.damage.max} damage`);
  if (st.armor !== undefined) out.push(`+${st.armor} armor`);
  if (st.woodcuttingStrength !== undefined) out.push(`+${st.woodcuttingStrength} WS`);
  if (st.miningStrength !== undefined) out.push(`+${st.miningStrength} MS`);
  return out.join(', ');
}

type GearCardProps = {
  recipe: RecipeView;
  /** For the engine's quality floor (gearQualityFloor); keeps its identity until a build. */
  buildings: GameState['buildings'];
  selected: boolean;
  stamina: number;
  target: Target;
  onPress: (id: string) => void;
  onStart: PickerProps['onStart'];
  onBack: () => void;
};

/**
 * A gear recipe: inputs have / need, effective time, stats at 100% quality; tapped, it opens the stamina stepper
 * ("Quality 20–100%"), the rarity odds and Start.
 */
const GearCard = memo(function GearCard({ recipe, buildings, selected, stamina, target, onPress, onStart, onBack }: GearCardProps) {
  const g = recipe.gear!;
  const [invest, setInvest] = useState(0);
  const enough = recipe.enough;
  const floor = gearQualityFloor({ buildings }, invest);
  const odds = g.rarityOdds.map((o) => `${RARITY_COLOR_NAMES[o.rarity]} ${o.pct}%`).join(' · ');
  const inputs = recipe.inputs.map((i) => `${itemIcon(i.defId)} ${formatNumber(i.have)} / ${i.perCraft} ${itemName(i.defId)}`);
  return (
    <View style={[styles.recipe, selected && styles.recipeSelected]}>
      <Pressable
        onPress={() => onPress(recipe.recipeId)}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${recipe.name}: ${recipe.inputs.map((i) => `${i.perCraft} ${itemName(i.defId)}, you have ${i.have}`).join('; ')}; ${formatCraftTime(recipe.craftMs)}; at 100% quality ${statText(g.maxStats)}`}
      >
        <Text style={styles.recipeName}>
          {itemIcon(recipe.output.defId)} {recipe.name}
        </Text>
        {inputs.map((line, k) => (
          <Text key={k} style={[styles.recipeLine, recipe.inputs[k].have < recipe.inputs[k].perCraft && styles.recipeShort]}>
            {line}
          </Text>
        ))}
        <Text style={styles.recipeLine}>
          ⏱ {formatCraftTime(recipe.craftMs)} · at 100%: {statText(g.maxStats)}
        </Text>
      </Pressable>
      {selected ? (
        <View style={styles.gearDetail}>
          <Text style={styles.detailLabel}>Stamina to invest (+1% min quality each, not refunded)</Text>
          <StaminaStepper value={invest} max={g.maxStamina} onChange={setInvest} />
          <Text style={styles.detail}>
            Quality {floor}–100%
          </Text>
          <Text style={styles.detail}>Colour: {odds}</Text>
          {!enough ? <Text style={styles.missing}>Not enough materials</Text> : null}
          <View style={styles.buttons}>
            <PixelButton
              label={`Start${invest > 0 ? ` · ⚡ ${invest}` : ''}`}
              sublabel={target.blocked ?? (enough && invest > stamina ? 'Not enough stamina' : enough ? target.label : undefined)}
              onPress={() => onStart(target.pipe, recipe.recipeId, invest)}
              disabled={!enough || invest > stamina || target.blocked !== null}
              stretch
            />
            <PixelButton label="Back" onPress={onBack} stretch />
          </View>
        </View>
      ) : null}
    </View>
  );
});

const STAMINA_STEPS = [-10, -1, 1, 10] as const;

/** 0..max with −10 / −1 / +1 / +10 (hold to repeat; a repeat stops quietly at either end). */
function StaminaStepper({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const current = useRef(value);
  current.current = value;
  const step = useCallback(
    (d: number) => () => {
      const next = Math.max(0, Math.min(max, current.current + d));
      if (next === current.current) return false;
      current.current = next;
      onChange(next);
      return true;
    },
    [max, onChange],
  );
  const actions = useMemo(() => STAMINA_STEPS.map((d) => step(d)), [step]);
  return (
    <View style={styles.stepper} accessible={false}>
      {STAMINA_STEPS.slice(0, 2).map((d, k) => (
        <PixelButton key={d} label={String(d).replace('-', '−')} repeat={actions[k]} disabled={value <= 0} accessibilityLabel={`${d} stamina`} />
      ))}
      <Text style={styles.stepValue} accessibilityLiveRegion="polite" accessibilityLabel={`${value} stamina invested`}>
        ⚡ {value}
      </Text>
      {STAMINA_STEPS.slice(2).map((d, k) => (
        <PixelButton key={d} label={`+${d}`} repeat={actions[k + 2]} disabled={value >= max} accessibilityLabel={`+${d} stamina`} />
      ))}
    </View>
  );
}

const RecipeRow = memo(function RecipeRow({ recipe, selected, onPress }: { recipe: RecipeView; selected: boolean; onPress: (id: string) => void }) {
  const input = recipe.inputs[0];
  const enough = recipe.enough;
  return (
    <Pressable
      onPress={() => onPress(recipe.recipeId)}
      style={[styles.recipe, selected && styles.recipeSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${recipe.name}: ${input.perCraft} ${itemName(input.defId)}, you have ${input.have}, ${formatCraftTime(recipe.craftMs)}`}
    >
      <Text style={styles.recipeName}>
        {itemIcon(recipe.output.defId)} {recipe.name}
      </Text>
      <Text style={[styles.recipeLine, !enough && styles.recipeShort]}>
        {itemIcon(input.defId)} {formatNumber(input.have)} / {input.perCraft} {itemName(input.defId)}
      </Text>
      <Text style={styles.recipeLine}>
        ⏱ {formatCraftTime(recipe.craftMs)} → {recipe.output.perCraft} {itemName(recipe.output.defId)}
      </Text>
    </Pressable>
  );
});

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
  gearDetail: { marginTop: 8, gap: 2 },
  detailLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink, marginBottom: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepValue: { flex: 1, textAlign: 'center', fontFamily: fonts.bodyBold, fontSize: 20, color: colors.ink },
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
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tier: { marginBottom: 8 },
  tierTitle: { fontFamily: fonts.title, fontSize: 18, color: colors.gold, marginBottom: 6 },
  recipe: { backgroundColor: colors.parchment, borderWidth: 3, borderColor: colors.woodDark, padding: 10, marginBottom: 8, gap: 2 },
  recipeSelected: { borderColor: colors.gold },
  recipeName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  recipeLine: { fontFamily: fonts.body, fontSize: 14, color: colors.inkSoft },
  recipeShort: { color: colors.hp },
  detail: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.ink, marginTop: 6 },
  missing: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.hp, marginTop: 6 },
});
