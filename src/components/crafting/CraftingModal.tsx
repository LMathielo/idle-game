// Village → Crafting: full-screen modal. Eight pipe slots (2 open on a new save; 3–4 "Unlocks later", 5–8 "Premium —
// coming soon"); an idle pipe opens the recipe picker (an in-modal sub-view: Materials and Equipment tabs). Rules stay in
// the engine: this file reads craftingView() / craftJobView() and dispatches START_CRAFT / INSTA_CRAFT / CANCEL_CRAFT /
// COLLECT_CRAFT. A finished gear piece waits in its pipe ("✓ Ready — Done"); Done collects it and opens its popover
// (the reveal: rarity and quality are never shown before). Pipes are not an activity: nothing here stops or starts the hero.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, type HostInstance, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGameSnapshot } from '../../client/GameProvider';
import {
  collectedItemId,
  type CraftingView,
  craftingView,
  craftJobView,
  type CraftJobView,
  type CraftMode,
  CRAFTING,
  freeSlots,
  type GearStats,
  type PipeView,
  type RecipeView,
} from '../../engine';
import { colors, fonts, rarityColors } from '../../theme';
import { UpgradeEntry } from '../buildings/UpgradeEntry';
import { formatClock, formatNumber, formatPercentBp, itemIcon, itemName } from '../format';
import { RARITY_COLOR_NAMES } from '../items/itemInfo';
import { ItemSheet } from '../items/ItemSheet';
import { QuantityStepper } from '../items/QuantityStepper';
import { LiveBar } from '../LiveBar';
import { closeVillageModal, ModalScreen } from '../ModalScreen';
import { Panel } from '../Panel';
import { PixelButton } from '../PixelButton';
import { type AnchorRect, measureAnchor } from '../ui/InfoPopover';
import { useCommand } from '../ui/useCommand';

/** Craft time: one decimal under a minute (4.6s), m:ss above. */
const formatCraftTime = (ms: number) => (ms < 60_000 ? `${(Math.ceil(ms / 100) / 10).toFixed(1)}s` : formatClock(ms));

export function CraftingModal() {
  const { state, clockPaused } = useGameSnapshot();
  const view = craftingView(state); // 8 pipes + 10 recipes, read-only
  /** The pipe whose recipe picker is open (a sub-view), or null for the pipe list. */
  const [picker, setPicker] = useState<number | null>(null);
  /** The piece Done just collected: its popover (the reveal), anchored on the pipe it came from. */
  const [reveal, setReveal] = useState<{ itemId: string; anchor: AnchorRect } | null>(null);
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
      if (!live || live.ready) return;
      const items = live.refund.items.map((i) => `${formatNumber(i.quantity)} ${itemName(i.defId)}`).join(', ');
      const stamina = live.refund.stamina > 0 ? ` and ${formatNumber(live.refund.stamina)} stamina (up to your max)` : '';
      const lost = live.staminaInvested > 0 ? ` The ${formatNumber(live.staminaInvested)} stamina you invested is lost.` : '';
      const ok = await dialog.confirm({
        title: `Cancel ${live.recipeName}?`,
        message: live.kind === 'gear' ? `You get back ${items}.${lost}` : `The crafts already done stay yours. You get back ${items}${stamina}.`,
        confirmLabel: 'Cancel job',
        destructive: true,
      });
      if (ok) await send({ type: 'CANCEL_CRAFT', pipe, jobId: live.id });
    },
    [client, dialog, send],
  );
  const onStart = useCallback(
    async (pipe: number, recipeId: string, quantity: number, mode: CraftMode, cost: number, stamina?: number) => {
      const cmd = { type: 'START_CRAFT' as const, pipe, recipeId, quantity, mode, maxCost: cost };
      if (await send(stamina === undefined ? cmd : { ...cmd, stamina })) setPicker(null);
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
            <PipeRow
              key={p.index}
              pipe={p}
              paused={clockPaused}
              stamina={state.stamina.current}
              invFull={invFull}
              onPick={openPicker}
              onInsta={onInsta}
              onCancel={onCancel}
              onDone={onDone}
            />
          ))}
          <Text style={styles.note}>
            Pipes craft side by side, beside anything the hero does, also while the app is closed (up to {formatNumber(state.offline.capMs / 3_600_000)}h).
            Materials are taken when a job starts. When the inventory is full, a finished craft waits until there is room. A finished piece of gear
            waits in its pipe until you tap Done.
          </Text>
          <UpgradeEntry buildingId="crafting" />
        </ScrollView>
      )}
      {revealed && reveal ? (
        <RevealSheet key={revealed.id} itemId={revealed.id} anchor={reveal.anchor} onClose={closeReveal} />
      ) : null}
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
  onCancel: (pipe: number) => void;
  onDone: (pipe: number, node: HostInstance | null) => void;
};

const PipeRow = memo(function PipeRow({ pipe, paused, stamina, invFull, onPick, onInsta, onCancel, onDone }: PipeRowProps) {
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
  return (
    <JobRow
      n={n}
      job={job}
      paused={paused}
      stamina={stamina}
      invFull={invFull}
      onInsta={insta}
      onCancel={() => onCancel(pipe.index)}
      onDone={(node) => onDone(pipe.index, node)}
    />
  );
});

type JobRowProps = {
  n: number;
  job: CraftJobView;
  paused: boolean;
  stamina: number;
  invFull: boolean;
  onInsta: (info: { repeat: boolean }) => Promise<boolean>;
  onCancel: () => void;
  onDone: (node: HostInstance | null) => void;
};

function JobRow({ n, job, paused, stamina, invFull, onInsta, onCancel, onDone }: JobRowProps) {
  const rowRef = useRef<HostInstance>(null);
  const held = job.status === 'held';
  const label = `${itemIcon(job.outputDefId)} ${job.recipeName}${job.mode === 'x10' ? ' ×10' : ''}`;
  return (
    <View ref={rowRef} style={[styles.pipe, styles.pipeActive, job.ready && styles.pipeReady]}>
      <View style={styles.pipeHead}>
        <Text style={styles.pipeTitle} numberOfLines={1}>
          Pipe {n} · {label}
        </Text>
        {job.kind === 'material' ? (
          <Text style={styles.count} accessibilityLabel={`Craft ${job.craftNumber} of ${job.quantity}`}>
            {job.craftNumber}/{job.quantity}
          </Text>
        ) : null}
      </View>
      {held ? (
        <Text style={styles.held}>📦 Inventory full — waiting for room (nothing is lost)</Text>
      ) : job.ready ? (
        <>
          <LiveBar fraction={1} remainingMs={0} paused color={colors.skill} style={styles.bar} />
          <View style={styles.pipeHead}>
            <Text style={styles.ready}>✓ Ready — Done</Text>
            <Text style={styles.percent}>100.00%</Text>
          </View>
        </>
      ) : (
        <>
          <LiveBar fraction={job.fraction} remainingMs={job.remainingMs} paused={paused} color={colors.skill} style={styles.bar} />
          <View style={styles.pipeHead}>
            <Text style={styles.time}>{formatClock(job.remainingMs)} left</Text>
            <LivePercent key={`${job.id}-${job.craftNumber}-${job.progressMs}`} progressMs={job.progressMs} craftMs={job.craftMs} running={!paused} />
          </View>
        </>
      )}
      {job.ready ? (
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
      ) : (
        <View style={styles.buttons}>
          <PixelButton
            label={`⚡ Insta · ${job.instaCost}`}
            repeat={onInsta}
            disabled={held || stamina < job.instaCost}
            stretch
            accessibilityLabel={`Finish this craft now for ${job.instaCost} stamina`}
          />
          <PixelButton
            label="Cancel"
            onPress={onCancel}
            stretch
            accessibilityHint={job.kind === 'gear' ? 'Asks to confirm; materials are refunded, invested stamina is not' : 'Asks to confirm; unfinished crafts are refunded'}
          />
        </View>
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
  onStart: (pipe: number, recipeId: string, quantity: number, mode: CraftMode, cost: number, stamina?: number) => void;
  onBack: () => void;
};

type PickerTab = 'material' | 'gear';

function RecipePicker({ pipe, view, stamina, onStart, onBack }: PickerProps) {
  const [tab, setTab] = useState<PickerTab>('material');
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<CraftMode>('x1');
  const [quantity, setQuantity] = useState(1);
  const tiers = useMemo(() => {
    const out = new Map<number, RecipeView[]>();
    for (const r of view.recipes) if (r.kind === tab) out.set(r.tier, [...(out.get(r.tier) ?? []), r]);
    return [...out.entries()];
  }, [view.recipes, tab]);
  const switchTab = useCallback((t: PickerTab) => {
    setTab(t);
    setSelected(null);
    setMode('x1');
  }, []);
  const recipe = (tab === 'material' && view.recipes.find((r) => r.recipeId === selected)) || null;
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
        <PixelButton label="Materials" active={tab === 'material'} stretch onPress={() => switchTab('material')} accessibilityLabel="Materials recipes" />
        <PixelButton label="Equipment" active={tab === 'gear'} stretch onPress={() => switchTab('gear')} accessibilityLabel="Equipment recipes" />
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
              <GearCard key={r.recipeId} recipe={r} selected={r.recipeId === selected} onPress={choose} stamina={stamina} pipe={pipe} onStart={onStart} onBack={onBack} />
            ) : (
              <RecipeRow key={r.recipeId} recipe={r} selected={r.recipeId === selected} onPress={choose} />
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
  selected: boolean;
  stamina: number;
  pipe: number;
  onPress: (id: string) => void;
  onStart: PickerProps['onStart'];
  onBack: () => void;
};

/**
 * A gear recipe: inputs have / need, effective time, stats at 100% quality; tapped, it opens the stamina stepper
 * ("Quality 20–100%"), the rarity odds and Start.
 */
const GearCard = memo(function GearCard({ recipe, selected, stamina, pipe, onPress, onStart, onBack }: GearCardProps) {
  const g = recipe.gear!;
  const [invest, setInvest] = useState(0);
  const enough = recipe.max.x1 > 0;
  const floorBp = Math.min(10_000, invest * g.qualityBpPerStamina + g.minQualityBp);
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
            Quality {Math.floor(floorBp / 100)}–100%
          </Text>
          <Text style={styles.detail}>Colour: {odds}</Text>
          {!enough ? <Text style={styles.missing}>Not enough materials</Text> : null}
          <View style={styles.buttons}>
            <PixelButton
              label={`Start${invest > 0 ? ` · ⚡ ${invest}` : ''}`}
              sublabel={enough && invest > stamina ? 'Not enough stamina' : undefined}
              onPress={() => onStart(pipe, recipe.recipeId, 1, 'x1', invest, invest)}
              disabled={!enough || invest > stamina}
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
