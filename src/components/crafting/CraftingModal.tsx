// Village → Crafting: full-screen modal. Eight pipe slots (2 open on a new save; 3–4 "Unlocks later", 5–8 "Premium —
// coming soon"); an idle pipe opens the recipe picker (an in-modal sub-view: Materials tab, Equipment coming soon). Rules
// stay in the engine: this file reads craftingView() / craftJobView() and dispatches START_CRAFT / INSTA_CRAFT /
// CANCEL_CRAFT. Pipes are not an activity: nothing here stops or starts the hero.
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGameSnapshot } from '../../client/GameProvider';
import { type CraftingView, craftingView, craftJobView, type CraftJobView, type CraftMode, CRAFTING, type PipeView, type RecipeView } from '../../engine';
import { colors, fonts } from '../../theme';
import { UpgradeEntry } from '../buildings/UpgradeEntry';
import { formatClock, formatNumber, formatPercentBp, itemIcon, itemName } from '../format';
import { QuantityStepper } from '../items/QuantityStepper';
import { LiveBar } from '../LiveBar';
import { closeVillageModal, ModalScreen } from '../ModalScreen';
import { Panel } from '../Panel';
import { PixelButton } from '../PixelButton';
import { useCommand } from '../ui/useCommand';

/** Craft time: one decimal under a minute (4.6s), m:ss above. */
const formatCraftTime = (ms: number) => (ms < 60_000 ? `${(Math.ceil(ms / 100) / 10).toFixed(1)}s` : formatClock(ms));

export function CraftingModal() {
  const { state, clockPaused } = useGameSnapshot();
  const view = craftingView(state); // 8 pipes + 10 recipes, read-only
  /** The pipe whose recipe picker is open (a sub-view), or null for the pipe list. */
  const [picker, setPicker] = useState<number | null>(null);
  // CRAFT_CHANGED: the craft or job on screen finished meanwhile; the screen already shows the new state.
  const { send, dialog, client } = useCommand({ silentCodes: ['CRAFT_CHANGED'] });

  // Android back steps out of the picker before it closes the modal.
  useEffect(() => {
    if (picker === null) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setPicker(null);
      return true;
    });
    return () => sub.remove();
  }, [picker]);
  const onClose = useCallback(() => (picker !== null ? setPicker(null) : closeVillageModal()), [picker]);
  const openPicker = useCallback((pipe: number) => setPicker(pipe), []);
  const closePicker = useCallback(() => setPicker(null), []);

  /** Hold-to-repeat insta, bound to the job, craft and cost on screen now (read from the live state at each tick). */
  const onInsta = useCallback(
    (pipe: number, repeat: boolean) => {
      const live = craftJobView(client.getState(), pipe);
      if (!live || live.status !== 'running' || client.getState().stamina.current < live.instaCost) return Promise.resolve(false);
      return send({ type: 'INSTA_CRAFT', pipe, jobId: live.id, craft: live.craftNumber, maxCost: live.instaCost }, { quiet: repeat });
    },
    [client, send],
  );
  const onCancel = useCallback(
    async (pipe: number) => {
      const live = craftJobView(client.getState(), pipe);
      if (!live) return;
      const items = live.refund.items.map((i) => `${formatNumber(i.quantity)} ${itemName(i.defId)}`).join(', ');
      const stamina = live.refund.stamina > 0 ? ` and ${formatNumber(live.refund.stamina)} stamina (up to your max)` : '';
      const ok = await dialog.confirm({
        title: `Cancel ${live.recipeName}?`,
        message: `The crafts already done stay yours. You get back ${items}${stamina}.`,
        confirmLabel: 'Cancel job',
        destructive: true,
      });
      if (ok) await send({ type: 'CANCEL_CRAFT', pipe, jobId: live.id });
    },
    [client, dialog, send],
  );
  const onStart = useCallback(
    async (pipe: number, recipeId: string, quantity: number, mode: CraftMode, cost: number) => {
      if (await send({ type: 'START_CRAFT', pipe, recipeId, quantity, mode, maxCost: cost })) setPicker(null);
    },
    [send],
  );

  return (
    <ModalScreen
      title={picker !== null ? `Crafting · Pipe ${picker + 1}` : 'Crafting'}
      buildingId="crafting"
      closeLabel={picker !== null ? 'Back to the pipes' : 'Close crafting'}
      onClose={onClose}
      headerRight={
        <Text style={styles.stamina} accessibilityLabel={`Stamina ${state.stamina.current} of ${state.stamina.max}`}>
          ⚡ {state.stamina.current}/{state.stamina.max}
        </Text>
      }
    >
      {clockPaused ? <Text style={styles.paused}>⏸ Paused: your device clock moved back. Crafting waits until it catches up.</Text> : null}
      {picker !== null ? (
        <RecipePicker pipe={picker} view={view} stamina={state.stamina.current} onStart={onStart} onBack={closePicker} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.intro}>
            Craft time ×{formatPercentBp(view.timeBp)} (house) · −{formatPercentBp(view.intReductionBp)} (INT)
            {view.yieldBp > 0 ? ` · +${formatPercentBp(view.yieldBp)} yield` : ''}
          </Text>
          {view.pipes.map((p) => (
            <PipeRow key={p.index} pipe={p} paused={clockPaused} stamina={state.stamina.current} onPick={openPicker} onInsta={onInsta} onCancel={onCancel} />
          ))}
          <Text style={styles.note}>
            Pipes craft side by side, beside anything the hero does, also while the app is closed (up to {formatNumber(state.offline.capMs / 3_600_000)}h).
            Materials are taken when a job starts. When the inventory is full, a finished craft waits until there is room.
          </Text>
          <UpgradeEntry buildingId="crafting" />
        </ScrollView>
      )}
    </ModalScreen>
  );
}

// ---------- one pipe ----------

type PipeRowProps = {
  pipe: PipeView;
  paused: boolean;
  stamina: number;
  onPick: (pipe: number) => void;
  onInsta: (pipe: number, repeat: boolean) => Promise<boolean>;
  onCancel: (pipe: number) => void;
};

const PipeRow = memo(function PipeRow({ pipe, paused, stamina, onPick, onInsta, onCancel }: PipeRowProps) {
  const n = pipe.index + 1;
  const insta = useCallback(({ repeat }: { repeat: boolean }) => onInsta(pipe.index, repeat), [onInsta, pipe.index]);
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
          <PixelButton label="Craft…" onPress={() => onPick(pipe.index)} stretch accessibilityHint="Choose a recipe for this pipe" />
        </View>
      </View>
    );
  }
  return <JobRow n={n} job={job} paused={paused} stamina={stamina} onInsta={insta} onCancel={() => onCancel(pipe.index)} />;
});

type JobRowProps = {
  n: number;
  job: CraftJobView;
  paused: boolean;
  stamina: number;
  onInsta: (info: { repeat: boolean }) => Promise<boolean>;
  onCancel: () => void;
};

function JobRow({ n, job, paused, stamina, onInsta, onCancel }: JobRowProps) {
  const held = job.status !== 'running';
  const label = `${itemIcon(job.outputDefId)} ${job.recipeName}${job.mode === 'x10' ? ' ×10' : ''}`;
  return (
    <View style={[styles.pipe, styles.pipeActive]}>
      <View style={styles.pipeHead}>
        <Text style={styles.pipeTitle} numberOfLines={1}>
          Pipe {n} · {label}
        </Text>
        <Text style={styles.count} accessibilityLabel={`Craft ${job.craftNumber} of ${job.quantity}`}>
          {job.craftNumber}/{job.quantity}
        </Text>
      </View>
      {held ? (
        <Text style={styles.held}>📦 Inventory full — waiting for room (nothing is lost)</Text>
      ) : (
        <>
          <LiveBar fraction={job.fraction} remainingMs={job.remainingMs} paused={paused} color={colors.skill} style={styles.bar} />
          <View style={styles.pipeHead}>
            <Text style={styles.time}>{formatClock(job.remainingMs)} left</Text>
            <LivePercent key={`${job.id}-${job.craftNumber}-${job.progressMs}`} progressMs={job.progressMs} craftMs={job.craftMs} running={!paused} />
          </View>
        </>
      )}
      <View style={styles.buttons}>
        <PixelButton
          label={`⚡ Insta · ${job.instaCost}`}
          repeat={onInsta}
          disabled={held || stamina < job.instaCost}
          stretch
          accessibilityLabel={`Finish this craft now for ${job.instaCost} stamina`}
        />
        <PixelButton label="Cancel" onPress={onCancel} stretch accessibilityHint="Asks to confirm; unfinished crafts are refunded" />
      </View>
    </View>
  );
}

/**
 * The current craft's progress as "xx.yy%", moving between engine ticks: it counts on from the last state (remounted on
 * each one, via `key`) every 100 ms, never past 100%. Display only: the engine's progress is what counts.
 */
function LivePercent({ progressMs, craftMs, running }: { progressMs: number; craftMs: number; running: boolean }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [running]);
  const p = running ? Math.min(craftMs, progressMs + Math.max(0, now - start)) : progressMs;
  return <Text style={styles.percent}>{craftMs > 0 ? ((p / craftMs) * 100).toFixed(2) : '100.00'}%</Text>;
}

// ---------- the recipe picker ----------

type PickerProps = {
  pipe: number;
  view: CraftingView;
  stamina: number;
  onStart: (pipe: number, recipeId: string, quantity: number, mode: CraftMode, cost: number) => void;
  onBack: () => void;
};

function RecipePicker({ pipe, view, stamina, onStart, onBack }: PickerProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<CraftMode>('x1');
  const [quantity, setQuantity] = useState(1);
  const tiers = useMemo(() => {
    const out = new Map<number, RecipeView[]>();
    for (const r of view.recipes) out.set(r.tier, [...(out.get(r.tier) ?? []), r]);
    return [...out.entries()];
  }, [view.recipes]);
  const recipe = view.recipes.find((r) => r.recipeId === selected) ?? null;
  const max = recipe ? recipe.max[mode] : 0;
  const qty = Math.max(1, Math.min(quantity, Math.max(1, max)));
  const mult = CRAFTING.modeMultiplier[mode];
  const cost = recipe && mode === 'x10' ? recipe.x10StaminaPerCraft * qty : 0;
  const choose = useCallback((id: string) => {
    setSelected(id);
    setQuantity(1);
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.tabs}>
        <PixelButton label="Materials" active stretch onPress={() => undefined} accessibilityLabel="Materials recipes, selected" />
        <PixelButton label="Equipment" sublabel="coming soon" disabled stretch accessibilityLabel="Equipment recipes, coming soon" />
      </View>
      {recipe ? (
        <Panel title={`${itemIcon(recipe.output.defId)} ${recipe.name}`}>
          <View style={styles.tabs}>
            <PixelButton label="×1" active={mode === 'x1'} onPress={() => setMode('x1')} stretch accessibilityLabel="Normal mode" />
            <PixelButton
              label="×10"
              sublabel={`⚡ ${recipe.x10StaminaPerCraft} per craft`}
              active={mode === 'x10'}
              onPress={() => setMode('x10')}
              stretch
              accessibilityLabel={`Times ten mode: ten times the materials and output in the same time, ${recipe.x10StaminaPerCraft} stamina per craft`}
            />
          </View>
          {max > 0 ? <QuantityStepper value={qty} max={max} onChange={setQuantity} /> : null}
          <Text style={styles.detail}>
            Uses {recipe.inputs.map((i) => `${formatNumber(i.perCraft * mult * qty)} ${itemName(i.defId)}`).join(', ')}
          </Text>
          <Text style={styles.detail}>
            Makes {formatNumber(recipe.output.perCraft * mult * qty)} {itemName(recipe.output.defId)}
            {view.yieldBp > 0 ? ` +${formatPercentBp(view.yieldBp)}` : ''} · {formatCraftTime(recipe.craftMs)} each
          </Text>
          {mode === 'x10' ? <Text style={styles.detail}>Stamina now: ⚡ {formatNumber(cost)} (paid up front; unstarted crafts refunded on cancel)</Text> : null}
          {max === 0 ? (
            <Text style={styles.missing}>{mode === 'x10' && recipe.max.x1 > 0 ? 'Not enough materials or stamina for ×10' : 'Not enough materials'}</Text>
          ) : null}
          <View style={styles.buttons}>
            <PixelButton
              label={`Start · ${formatNumber(qty)}${mode === 'x10' ? ` · ⚡ ${formatNumber(cost)}` : ''}`}
              onPress={() => onStart(pipe, recipe.recipeId, qty, mode, cost)}
              disabled={max === 0 || cost > stamina}
              stretch
            />
            <PixelButton label="Back" onPress={onBack} stretch />
          </View>
        </Panel>
      ) : null}
      {tiers.map(([tier, recipes]) => (
        <View key={tier} style={styles.tier}>
          <Text style={styles.tierTitle}>Tier {tier}</Text>
          {recipes.map((r) => (
            <RecipeRow key={r.recipeId} recipe={r} selected={r.recipeId === selected} onPress={choose} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const RecipeRow = memo(function RecipeRow({ recipe, selected, onPress }: { recipe: RecipeView; selected: boolean; onPress: (id: string) => void }) {
  const input = recipe.inputs[0];
  const enough = recipe.max.x1 > 0;
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
  stamina: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.stamina },
  paused: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold, paddingHorizontal: 16, paddingTop: 8 },
  intro: { fontFamily: fonts.body, fontSize: 14, color: colors.parchment, marginBottom: 10 },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.parchmentDark, marginTop: 4 },
  pipe: { backgroundColor: colors.woodDark, borderWidth: 2, borderColor: colors.wood, padding: 10, marginBottom: 10, gap: 6 },
  pipeActive: { borderColor: colors.gold },
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
