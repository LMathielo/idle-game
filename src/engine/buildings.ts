// Buildings (pure): which village buildings are built, their requirements, BUILD, upgrades with the one builder,
// and the Build / Upgrade sheet views. See docs/ENGINE.md ("Buildings"). Requirements and costs are data
// (config/buildings.ts).
//
//   BUILD validates every requirement first, then consumes gold and items and builds at once (level 1).
//   UPGRADE_BUILDING validates the level cap (5, and never above the Town Hall) and the cost, pays up front and
//   starts the builder; the upgrade completes inside simulate() on the granted (capped) time.
//   A locked building can't be used: the activity it hosts refuses to start (BUILDING_LOCKED).
import { BUILDING_IDS, BUILDING_MAX_LEVEL, BUILDINGS, type UpgradeCost } from './config/buildings';
import { getItemDef } from './config/items';
import { itemQuantity } from './selectors';
import type { ActivityKind, BuildingId, BuildingState, Construction, GameEvent, GameState, SimulationSummary } from './types';

/** A new save: every building locked but the ones that start built (the Merchant, level 1). */
export function newBuildingsState(): Record<BuildingId, BuildingState> {
  const out = {} as Record<BuildingId, BuildingState>;
  for (const id of BUILDING_IDS) out[id] = BUILDINGS[id].startsBuilt ? { state: 'built', level: 1 } : { state: 'locked', level: 0 };
  return out;
}

export function isBuilt(state: Pick<GameState, 'buildings'>, buildingId: BuildingId): boolean {
  return state.buildings[buildingId]?.state === 'built';
}

export function buildingLevel(state: Pick<GameState, 'buildings'>, buildingId: BuildingId): number {
  const b = state.buildings[buildingId];
  return b?.state === 'built' ? b.level : 0;
}

/** The building an activity needs, or null (dungeons are always built). */
export function buildingForActivity(kind: ActivityKind): BuildingId | null {
  if (kind === 'woodcutting') return 'woodcutting';
  if (kind === 'mining') return 'mine_shaft';
  if (kind === 'training') return 'training_grounds';
  return null;
}

/** One requirement line for the Build sheet: what is needed, what the hero has, and whether it is met. */
export type RequirementView =
  | { kind: 'heroLevel'; need: number; have: number; met: boolean }
  | { kind: 'building'; buildingId: BuildingId; need: number; have: number; met: boolean }
  | { kind: 'item'; defId: string; need: number; have: number; met: boolean }
  | { kind: 'gold'; need: number; have: number; met: boolean };

/** Why the next upgrade can't start right now (the sheet shows it), or null. */
export type UpgradeBlock =
  /** Not built yet: BUILD first. */
  | 'locked'
  /** Already at BUILDING_MAX_LEVEL. */
  | 'max_level'
  /** The Town Hall's level caps this building: upgrade the Town Hall first. */
  | 'town_hall'
  /** The builder is busy with an upgrade (this building's or another's). */
  | 'builder_busy'
  /** Gold or items missing (see `cost`). */
  | 'cost';

export type UpgradeView = {
  buildingId: BuildingId;
  level: number;
  maxLevel: number;
  /** The level the next upgrade reaches, or null at the max level (or while locked). */
  nextLevel: number | null;
  /** Gold and items of the next upgrade (have / need / met), in the order items, gold. Empty without a next level. */
  cost: RequirementView[];
  /** Builder time of the next upgrade, ms (0 without a next level). */
  durationMs: number;
  /** The first reason the upgrade can't start, or null when it can. */
  block: UpgradeBlock | null;
  /** The Town Hall level needed for the next upgrade when the Town Hall is the cap, else null. */
  townHallNeeded: number | null;
  /** This building is being upgraded right now. */
  upgrading: boolean;
};

export type BuildingView = {
  buildingId: BuildingId;
  name: string;
  icon: string;
  description: string;
  built: boolean;
  level: number;
  /** In display order: hero level, buildings, items, gold. */
  requirements: RequirementView[];
  /** Every requirement is met (and it is not built yet): the Build button is enabled. */
  canBuild: boolean;
  /** Training tier the building grants when built, if any. */
  grantsTrainingTier: number | null;
  upgrade: UpgradeView;
};

function itemAndGoldViews(state: GameState, items: readonly { defId: string; quantity: number }[], gold: number | undefined): RequirementView[] {
  const out: RequirementView[] = [];
  for (const it of items) {
    const have = itemQuantity(state, it.defId);
    out.push({ kind: 'item', defId: it.defId, need: it.quantity, have, met: have >= it.quantity });
  }
  if (gold !== undefined) {
    const have = state.character.gold;
    out.push({ kind: 'gold', need: gold, have, met: Number.isSafeInteger(have) && have >= gold });
  }
  return out;
}

/** Requirement lines with have / need / met, in display order. */
export function requirementViews(state: GameState, buildingId: BuildingId): RequirementView[] {
  const r = BUILDINGS[buildingId].requirements;
  const out: RequirementView[] = [];
  if (r.heroLevel !== undefined) {
    const have = state.character.level;
    out.push({ kind: 'heroLevel', need: r.heroLevel, have, met: have >= r.heroLevel });
  }
  for (const b of r.buildings ?? []) {
    const have = buildingLevel(state, b.buildingId);
    out.push({ kind: 'building', buildingId: b.buildingId, need: b.level, have, met: have >= b.level });
  }
  out.push(...itemAndGoldViews(state, r.items ?? [], r.gold));
  return out;
}

/** The cost of upgrading `buildingId` to `level` (2..BUILDING_MAX_LEVEL), or null outside that range. */
export function upgradeCost(buildingId: BuildingId, level: number): UpgradeCost | null {
  if (!Number.isSafeInteger(level) || level < 2 || level > BUILDING_MAX_LEVEL) return null;
  return BUILDINGS[buildingId].upgrades[level - 2] ?? null;
}

/** Highest level this building may reach right now: 5 for the Town Hall, else the Town Hall's level (at most 5). */
export function levelCap(state: Pick<GameState, 'buildings'>, buildingId: BuildingId): number {
  return BUILDINGS[buildingId].cappedByTownHall ? Math.min(BUILDING_MAX_LEVEL, buildingLevel(state, 'town_hall')) : BUILDING_MAX_LEVEL;
}

export function upgradeView(state: GameState, buildingId: BuildingId): UpgradeView {
  const level = buildingLevel(state, buildingId);
  const built = isBuilt(state, buildingId);
  const nextLevel = built && level < BUILDING_MAX_LEVEL ? level + 1 : null;
  const cost = nextLevel ? upgradeCost(buildingId, nextLevel) : null;
  const costViews = cost ? itemAndGoldViews(state, cost.items, cost.gold) : [];
  const capped = nextLevel !== null && nextLevel > levelCap(state, buildingId);
  let block: UpgradeBlock | null = null;
  if (!built) block = 'locked';
  else if (nextLevel === null) block = 'max_level';
  else if (capped) block = 'town_hall';
  else if (state.construction) block = 'builder_busy';
  else if (!costViews.every((c) => c.met)) block = 'cost';
  return {
    buildingId,
    level,
    maxLevel: BUILDING_MAX_LEVEL,
    nextLevel,
    cost: costViews,
    durationMs: cost?.durationMs ?? 0,
    block,
    townHallNeeded: capped ? nextLevel : null,
    upgrading: state.construction?.buildingId === buildingId,
  };
}

export function buildingView(state: GameState, buildingId: BuildingId): BuildingView {
  const def = BUILDINGS[buildingId];
  const built = isBuilt(state, buildingId);
  const requirements = requirementViews(state, buildingId);
  return {
    buildingId,
    name: def.name,
    icon: def.icon,
    description: def.description,
    built,
    level: buildingLevel(state, buildingId),
    requirements,
    canBuild: !built && requirements.every((r) => r.met),
    grantsTrainingTier: def.grantsTrainingTier ?? null,
    upgrade: upgradeView(state, buildingId),
  };
}

/** Every building, in BUILDING_IDS order. */
export function buildingsView(state: GameState): BuildingView[] {
  return BUILDING_IDS.map((id) => buildingView(state, id));
}

/** Removes `quantity` of a stackable item from the inventory (the caller checked there is enough). Mutates. */
function consumeItem(draft: GameState, defId: string, quantity: number): void {
  let left = quantity;
  const items = draft.inventory.items;
  for (let i = 0; i < items.length && left > 0; ) {
    const it = items[i];
    if (it.defId !== defId) {
      i += 1;
      continue;
    }
    const have = it.stackable ? (it.quantity ?? 1) : 1;
    const take = Math.min(have, left);
    left -= take;
    if (have - take > 0) {
      it.quantity = have - take;
      i += 1;
    } else {
      items.splice(i, 1);
    }
  }
}

/**
 * Builds now (level 1) and applies the building's effects. Consumes nothing: BUILD pays first, the debug build
 * pays nothing. Mutates `draft` (a full copy owned by the caller).
 */
export function completeBuilding(draft: GameState, buildingId: BuildingId, events: GameEvent[]): void {
  draft.buildings = { ...draft.buildings, [buildingId]: { state: 'built', level: 1 } };
  events.push({ type: 'BUILDING_BUILT', buildingId });
  const tier = BUILDINGS[buildingId].grantsTrainingTier;
  if (tier !== undefined && draft.training.tier < tier) {
    draft.training.tier = tier;
    events.push({ type: 'TRAINING_TIER_UNLOCKED', tier });
  }
}

/**
 * BUILD on `draft` (a full copy): every requirement is checked before anything is consumed, so a refusal changes
 * nothing. Then gold and items are consumed and the building is built at once. Returns an error or null.
 */
export function build(draft: GameState, buildingId: BuildingId, events: GameEvent[]): { code: 'ALREADY_BUILT' | 'REQUIREMENTS_NOT_MET'; message: string } | null {
  const def = BUILDINGS[buildingId];
  if (isBuilt(draft, buildingId)) return { code: 'ALREADY_BUILT', message: `${def.name} is already built` };
  const missing = requirementViews(draft, buildingId).filter((r) => !r.met);
  if (missing.length > 0) return { code: 'REQUIREMENTS_NOT_MET', message: `${def.name} needs ${missing.map(describeMissing).join(', ')}` };
  const r = def.requirements;
  for (const it of r.items ?? []) consumeItem(draft, it.defId, it.quantity);
  if (r.gold) draft.character.gold -= r.gold;
  completeBuilding(draft, buildingId, events);
  return null;
}

export type UpgradeErrorCode = 'BUILDING_LOCKED' | 'MAX_LEVEL' | 'LEVEL_CHANGED' | 'TOWN_HALL_TOO_LOW' | 'BUILDER_BUSY' | 'REQUIREMENTS_NOT_MET';

/**
 * UPGRADE_BUILDING on `draft` (a full copy). `level` is the target level the player saw (current + 1), so a double
 * tap never starts two upgrades or pays twice. Every check runs before anything is paid; then gold and items are
 * consumed atomically and the builder starts. Returns an error (nothing changed) or null.
 */
export function startUpgrade(draft: GameState, buildingId: BuildingId, level: unknown, now: number, events: GameEvent[]): { code: UpgradeErrorCode; message: string } | null {
  const def = BUILDINGS[buildingId];
  if (!isBuilt(draft, buildingId)) return { code: 'BUILDING_LOCKED', message: `Build the ${def.name} first` };
  const current = buildingLevel(draft, buildingId);
  if (current >= BUILDING_MAX_LEVEL) return { code: 'MAX_LEVEL', message: `${def.name} is already at level ${BUILDING_MAX_LEVEL}` };
  if (level !== current + 1) return { code: 'LEVEL_CHANGED', message: `${def.name} is level ${current}: the next upgrade is level ${current + 1}` };
  if (level > levelCap(draft, buildingId)) {
    return { code: 'TOWN_HALL_TOO_LOW', message: `${def.name} can't go above the Town Hall's level: upgrade the Town Hall to level ${level} first` };
  }
  const busy = draft.construction;
  if (busy) return { code: 'BUILDER_BUSY', message: `The builder is busy upgrading the ${BUILDINGS[busy.buildingId].name}` };
  const cost = upgradeCost(buildingId, level);
  if (!cost) return { code: 'MAX_LEVEL', message: `${def.name} has no level ${level}` };
  const missing = itemAndGoldViews(draft, cost.items, cost.gold).filter((r) => !r.met);
  if (missing.length > 0) {
    return { code: 'REQUIREMENTS_NOT_MET', message: `Level ${level} needs ${missing.map(describeMissing).join(', ')}` };
  }
  for (const it of cost.items) consumeItem(draft, it.defId, it.quantity);
  draft.character.gold -= cost.gold;
  draft.construction = { buildingId, level, durationMs: cost.durationMs, progressMs: 0, startedAt: now };
  events.push({ type: 'CONSTRUCTION_STARTED', buildingId, level });
  return null;
}

/** What else changes when an upgrade completes (e.g. new merchant stock slots). Mutates the draft. */
export type UpgradeEffect = (draft: GameState, buildingId: BuildingId, level: number) => void;

/**
 * The builder finishes now: the building reaches the construction's level and `onUpgraded` applies its effects.
 * Mutates `draft`; draft.buildings and draft.construction are replaced, never mutated in place.
 */
export function completeConstruction(draft: GameState, events: GameEvent[], summary: SimulationSummary | null, onUpgraded?: UpgradeEffect): void {
  const c = draft.construction;
  if (!c) return;
  draft.construction = null;
  draft.buildings = { ...draft.buildings, [c.buildingId]: { state: 'built', level: c.level } };
  events.push({ type: 'BUILDING_UPGRADED', buildingId: c.buildingId, level: c.level });
  summary?.buildingsUpgraded.push({ buildingId: c.buildingId, level: c.level });
  onUpgraded?.(draft, c.buildingId, c.level);
}

/**
 * The builder inside simulate(): adds `ms` of granted time (× efficiency) and completes the upgrade when it is due.
 * The world walk (world.ts) never passes more than the time to completion, so nothing is carried over.
 */
export function advanceConstruction(draft: GameState, ms: number, events: GameEvent[], summary: SimulationSummary | null, onUpgraded?: UpgradeEffect): void {
  const c = draft.construction;
  if (!c) return;
  const progressMs = c.progressMs + ms * draft.offline.efficiency;
  draft.construction = { ...c, progressMs };
  if (progressMs >= c.durationMs) completeConstruction(draft, events, summary, onUpgraded);
}

/** Wall time left on the builder's job (ceil over efficiency), or null when the builder is idle. */
export function constructionRemainingMs(state: Pick<GameState, 'construction' | 'offline'>): number | null {
  const c = state.construction;
  if (!c) return null;
  const left = Math.max(0, c.durationMs - c.progressMs);
  const eff = state.offline.efficiency;
  return eff > 0 ? Math.ceil(left / eff) : Number.POSITIVE_INFINITY;
}

export type ConstructionView = Construction & { remainingMs: number; fraction: number; name: string; icon: string };

/** The builder's job for the Village sign and the activity strip, or null when the builder is idle. */
export function constructionView(state: GameState): ConstructionView | null {
  const c = state.construction;
  if (!c) return null;
  const remainingMs = Math.max(0, c.durationMs - c.progressMs);
  const def = BUILDINGS[c.buildingId];
  return { ...c, remainingMs, fraction: c.durationMs > 0 ? Math.min(1, c.progressMs / c.durationMs) : 1, name: def.name, icon: def.icon };
}

function describeMissing(r: RequirementView): string {
  switch (r.kind) {
    case 'heroLevel':
      return `hero level ${r.need} (you are ${r.have})`;
    case 'building':
      return `${BUILDINGS[r.buildingId].name} level ${r.need}`;
    case 'item':
      return `${r.need} ${getItemDef(r.defId)?.name ?? r.defId} (you have ${r.have})`;
    case 'gold':
      return `${r.need} gold (you have ${r.have})`;
  }
}
