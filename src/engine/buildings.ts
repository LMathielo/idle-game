// Buildings (pure): which village buildings are built, their requirements, BUILD, and the Build-sheet view.
// See docs/ENGINE.md ("Buildings"). Requirements are data (config/buildings.ts).
//
//   BUILD validates every requirement first, then consumes gold and items and builds at once (level 1).
//   A locked building can't be used: the activity it hosts refuses to start (BUILDING_LOCKED).
import { BUILDING_IDS, BUILDINGS } from './config/buildings';
import { getItemDef } from './config/items';
import { itemQuantity } from './selectors';
import type { ActivityKind, BuildingId, BuildingState, GameEvent, GameState } from './types';

/** Every building locked (a new save, and the v9 → v10 migration). */
export function newBuildingsState(): Record<BuildingId, BuildingState> {
  const out = {} as Record<BuildingId, BuildingState>;
  for (const id of BUILDING_IDS) out[id] = { state: 'locked', level: 0 };
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
};

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
  for (const it of r.items ?? []) {
    const have = itemQuantity(state, it.defId);
    out.push({ kind: 'item', defId: it.defId, need: it.quantity, have, met: have >= it.quantity });
  }
  if (r.gold !== undefined) {
    const have = state.character.gold;
    out.push({ kind: 'gold', need: r.gold, have, met: Number.isSafeInteger(have) && have >= r.gold });
  }
  return out;
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
