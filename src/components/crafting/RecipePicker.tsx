// The Crafting house's recipe list (an idle pipe's "Craft…" or the header's Recipes): Materials | Equipment tabs, each
// tier a tappable header (all collapsed when the list opens, any number open, remembered per tab while the list stays
// mounted), an open tier a wrapping grid of icon-only tiles the size of the Hero inventory slots. A tile dims when
// the materials are short and gets a gold frame while a pipe crafts it. Tapping a tile opens an InfoPopover with
// everything about the craft and the one Craft button. Rules stay in the engine; this reads craftingView().
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type HostInstance, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { type CraftingView, DEV_TOOLS_ENABLED, gearQualityFloor, type GameState, type RecipeView } from '../../engine';
import { colors, fonts } from '../../theme';
import { ItemIcon } from '../art/Sprites';
import { formatNumber, formatPercentBp, itemName } from '../format';
import { INVENTORY_SLOT_SIZE } from '../items/ItemSlot';
import { RARITY_COLOR_NAMES } from '../items/itemInfo';
import { PixelButton } from '../PixelButton';
import { type AnchorRect, InfoPopover, measureAnchor, POPOVER_BAD, PopoverActions, PopoverRow, PopoverSection, PopoverText } from '../ui/InfoPopover';
import { type SlotHitTest, useSlotHitTest } from '../ui/useSlotHitTest';
import { formatCraftTime, GearDetails, StaminaStepper, statText } from './recipeParts';

type PickerTab = 'material' | 'gear';

/** Where Craft goes and whether it can: the named pipe, else the first free one ("All pipes busy" when none). */
export type Target = { pipe: number | null; label: string; blocked: string | null };

export type PickerProps = {
  /** The idle pipe the list was opened for (its first Craft goes there), or null: the first free open pipe. */
  pipe: number | null;
  view: CraftingView;
  buildings: GameState['buildings'];
  stamina: number;
  /** "Iron Sword started in Pipe 2", shown at the top until the next one replaces it. */
  started: string | null;
  /** Resolves true when the craft started. `force` (debug only): DEBUG_FORCE_CRAFT, the first craft needs no materials. */
  onCraft: (pipe: number | null, recipeId: string, stamina?: number, force?: boolean) => Promise<boolean>;
};

type Selected = { recipeId: string; anchor: AnchorRect };

export function RecipePicker({ pipe, view, buildings, stamina, started, onCraft }: PickerProps) {
  const [tab, setTab] = useState<PickerTab>('material');
  const [openTiers, setOpenTiers] = useState<Record<PickerTab, readonly number[]>>({ material: [], gear: [] });
  const [selected, setSelected] = useState<Selected | null>(null);

  const tiers = useMemo(() => {
    const out = new Map<number, RecipeView[]>();
    for (const r of view.recipes) if (r.kind === tab) out.set(r.tier, [...(out.get(r.tier) ?? []), r]);
    return [...out.entries()];
  }, [view.recipes, tab]);
  const onTier = useCallback(
    (tier: number) => setOpenTiers((o) => ({ ...o, [tab]: o[tab].includes(tier) ? o[tab].filter((t) => t !== tier) : [...o[tab], tier] })),
    [tab],
  );
  const onTile = useCallback((recipeId: string, node: HostInstance | null) => {
    void measureAnchor(node).then((anchor) => anchor && setSelected({ recipeId, anchor }));
  }, []);
  const closeInfo = useCallback(() => setSelected(null), []);
  // A tap on another tile while the popover is open moves it there (no close / fade); the same tile closes it.
  const hitTest = useSlotHitTest(selected);
  const outsidePress = (p: { x: number; y: number }) =>
    hitTest.press(p, (hit) => {
      if (hit.id === selected?.recipeId) return false;
      setSelected({ recipeId: String(hit.id), anchor: hit.anchor });
      return true;
    });

  const open = view.pipes.filter((p) => p.slot === 'open');
  const free = open.filter((p) => !p.job).length;
  const busyRecipes = useMemo(() => new Set(view.pipes.flatMap((p) => (p.job ? [p.job.recipeId] : []))), [view.pipes]);
  const target: Target =
    pipe !== null
      ? { pipe, label: `Pipe ${pipe + 1}`, blocked: null }
      : view.freePipe !== null
        ? { pipe: null, label: `Pipe ${view.freePipe + 1}`, blocked: null }
        : { pipe: null, label: '', blocked: 'All pipes busy' };
  const recipe = selected ? (view.recipes.find((r) => r.recipeId === selected.recipeId) ?? null) : null;

  const craft = useCallback(
    async (recipeId: string, invest?: number, force?: boolean) => {
      if (await onCraft(target.pipe, recipeId, invest, force)) setSelected(null);
    },
    [onCraft, target.pipe],
  );

  return (
    <>
      <ScrollView ref={hitTest.viewportRef} contentContainerStyle={styles.content}>
        <View style={styles.tabs}>
          <PixelButton label="Materials" active={tab === 'material'} stretch onPress={() => setTab('material')} accessibilityLabel="Materials recipes" />
          <PixelButton label="Equipment" active={tab === 'gear'} stretch onPress={() => setTab('gear')} accessibilityLabel="Equipment recipes" />
        </View>
        {started ? (
          <Text style={styles.started} accessibilityLiveRegion="polite">
            {started}
          </Text>
        ) : null}
        <Text style={styles.free} accessibilityLabel={`${free} of ${open.length} pipes free`}>
          Free pipes {free}/{open.length}
          {pipe !== null ? ` · next Craft goes into Pipe ${pipe + 1}` : free > 0 && target.label ? ` · next Craft goes into ${target.label}` : ''}
        </Text>
        {tab === 'gear' ? (
          <Text style={styles.intro}>One piece per job. Quality (0–100%) scales its stats; invest stamina to raise the lowest quality it can roll. Quality and colour show when you tap Done.</Text>
        ) : null}
        {tiers.map(([tier, recipes]) => {
          const isOpen = openTiers[tab].includes(tier);
          const label = tab === 'gear' ? `Tier ${tier} · ${recipes[0].name.split(' ')[0]}` : `Tier ${tier}`;
          return (
            <View key={tier} style={styles.tier}>
              <Pressable
                onPress={() => onTier(tier)}
                style={styles.tierHead}
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                accessibilityLabel={`${label}, ${recipes.length} recipes`}
              >
                <Text style={styles.chevron}>{isOpen ? '▾' : '▸'}</Text>
                <Text style={styles.tierTitle}>{label}</Text>
                <Text style={styles.tierCount}>{recipes.length}</Text>
              </Pressable>
              {isOpen ? (
                <View style={styles.grid}>
                  {recipes.map((r) => (
                    <RecipeTile key={r.recipeId} recipe={r} busy={busyRecipes.has(r.recipeId)} selected={selected?.recipeId === r.recipeId} onPress={onTile} hitTest={hitTest} />
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      <InfoPopover
        anchor={recipe && selected ? selected.anchor : null}
        onClose={closeInfo}
        onOutsidePress={outsidePress}
        title={recipe?.name ?? ''}
        icon={recipe ? <ItemIcon defId={recipe.output.defId} size={32} /> : undefined}
      >
        {recipe ? <RecipeInfo key={recipe.recipeId} recipe={recipe} view={view} buildings={buildings} stamina={stamina} target={target} onCraft={craft} /> : null}
      </InfoPopover>
    </>
  );
}

// ---------- one tile ----------

const RecipeTile = memo(function RecipeTile({
  recipe,
  busy,
  selected,
  onPress,
  hitTest,
}: {
  hitTest: SlotHitTest;
  recipe: RecipeView;
  busy: boolean;
  selected: boolean;
  onPress: (recipeId: string, node: HostInstance | null) => void;
}) {
  const ref = useRef<HostInstance>(null);
  useEffect(() => hitTest.register(recipe.recipeId, ref), [hitTest, recipe.recipeId]);
  const press = useCallback(() => onPress(recipe.recipeId, ref.current), [onPress, recipe.recipeId]);
  const needs = recipe.inputs.map((i) => `${i.perCraft} ${itemName(i.defId)}, you have ${i.have}`).join('; ');
  const label = `${recipe.name}: ${needs}; ${formatCraftTime(recipe.craftMs)}${recipe.enough ? '' : '; not enough materials'}${busy ? '; a pipe is crafting it' : ''}`;
  return (
    <Pressable
      ref={ref}
      onPress={press}
      style={[styles.tile, !recipe.enough && styles.tileDim, (busy || selected) && styles.tileBusy]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      hitSlop={2}
    >
      <ItemIcon defId={recipe.output.defId} size={36} />
    </Pressable>
  );
});

// ---------- the popover body ----------

type InfoProps = {
  recipe: RecipeView;
  view: CraftingView;
  buildings: GameState['buildings'];
  stamina: number;
  target: Target;
  onCraft: (recipeId: string, invest?: number, force?: boolean) => Promise<void>;
};

function RecipeInfo({ recipe, view, buildings, stamina, target, onCraft }: InfoProps) {
  const gear = recipe.gear;
  const [invest, setInvest] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const enough = recipe.enough;
  const inputs = recipe.inputs.map((i) => (
    <PopoverRow
      key={i.defId}
      icon={<ItemIcon defId={i.defId} size={16} />}
      label={itemName(i.defId)}
      value={`${formatNumber(i.have)} / ${formatNumber(i.perCraft)}`}
      valueColor={i.have < i.perCraft ? POPOVER_BAD : undefined}
    />
  ));
  let reason: string | null = target.blocked;
  if (!reason && gear && !enough) reason = 'Not enough materials';
  if (!reason && gear && invest > stamina) reason = 'Not enough stamina';
  const disabled = reason !== null;
  const sublabel = reason ?? (!gear && !enough ? `${target.label} · waits for materials` : target.label);
  const press = () => void onCraft(recipe.recipeId, gear ? invest : undefined);
  // Debug: Force craft ignores the materials (the first craft is free) but not the pipes or the stamina a gear piece invests.
  const forceReason = target.blocked ?? (gear && invest > stamina ? 'Not enough stamina' : null);
  const forcePress = () => void onCraft(recipe.recipeId, gear ? invest : undefined, true);

  return (
    <>
      <PopoverSection>Each craft uses</PopoverSection>
      {inputs}
      <PopoverRow label="Time" value={formatCraftTime(recipe.craftMs)} />
      {gear ? (
        <>
          <PopoverRow label="At 100% quality" value={statText(gear.maxStats)} />
          <PopoverSection>Stamina to invest</PopoverSection>
          <PopoverText tone="note">+1% minimum quality each, not refunded.</PopoverText>
          <StaminaStepper value={invest} max={gear.maxStamina} onChange={setInvest} />
          <PopoverRow label="Quality" value={`${gearQualityFloor({ buildings }, invest)}–100%`} strong />
          <PopoverText>Colour: {gear.rarityOdds.map((o) => `${RARITY_COLOR_NAMES[o.rarity]} ${o.pct}%`).join(' · ')}</PopoverText>
          <View style={styles.detailsToggle}>
            <PixelButton
              label={showDetails ? 'Hide details' : 'Details'}
              onPress={() => setShowDetails((v) => !v)}
              accessibilityLabel={`${recipe.name} details, ${showDetails ? 'expanded' : 'collapsed'}`}
            />
          </View>
          {showDetails ? <GearDetails details={gear.rarityDetails} /> : null}
        </>
      ) : (
        <>
          <PopoverRow
            label="Makes"
            value={`${formatNumber(recipe.output.perCraft)} ${itemName(recipe.output.defId)}${view.yieldBp > 0 ? ` +${formatPercentBp(view.yieldBp)}` : ''}`}
          />
          <PopoverText tone="note">Crafts until you stop it; waits when materials run out.</PopoverText>
        </>
      )}
      <PopoverActions>
        <PixelButton
          label={`Craft${gear && invest > 0 ? ` · ${invest}` : ''}`}
          icon={gear && invest > 0 ? 'stamina' : undefined}
          sublabel={sublabel}
          onPress={press}
          disabled={disabled}
          stretch
        />
        {DEV_TOOLS_ENABLED ? (
          <PixelButton
            label="Force craft (debug)"
            sublabel={forceReason ?? `${target.label} · first craft free`}
            onPress={forcePress}
            disabled={forceReason !== null}
            stretch
            accessibilityHint="Debug: starts the craft without needing or taking the materials"
          />
        ) : null}
      </PopoverActions>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  started: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold, marginBottom: 6 },
  free: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.parchment, marginBottom: 8 },
  intro: { fontFamily: fonts.body, fontSize: 14, color: colors.parchment, marginBottom: 10 },
  tier: { marginBottom: 8 },
  tierHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 10, backgroundColor: colors.woodDark, borderWidth: 2, borderColor: colors.wood },
  chevron: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.gold, width: 16 },
  tierTitle: { flex: 1, fontFamily: fonts.title, fontSize: 18, color: colors.gold },
  tierCount: { fontFamily: fonts.body, fontSize: 13, color: colors.parchmentDark },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  tile: {
    width: INVENTORY_SLOT_SIZE,
    height: INVENTORY_SLOT_SIZE,
    backgroundColor: colors.slot,
    borderWidth: 3,
    borderColor: colors.slotBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileDim: { opacity: 0.45 },
  tileBusy: { borderColor: colors.gold },
  detailsToggle: { alignItems: 'flex-start' },
});
