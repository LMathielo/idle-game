// The Storage building's grid and its commands (1.29.0, save v26; owner decisions 2026-11-07). Pure, on a draft copy.
//
// The storage is a second container with the bag's cell model (inventory.ts: items with `cell`, gaps allowed, ONE STACK PER STACKABLE defId
// per container, unlimited quantity, gear one cell per piece). Its capacity follows the Storage level (bonuses.ts `storageCapacity`: 50 / 70
// / 90 / 110 / 130). Rules:
//   DEPOSIT_ALL      every bag item into storage: stackables first merge into their stack there (no room needed), then the rest take the lowest
//                    free storage cells in bag-cell order. When storage fills, the rest stays in the bag (the event says how many entries).
//                    Equipped items never move; a Potion Belt keeps its contents (they live on the instance).
//   DEPOSIT_STACKED  only the bag stackables whose type already has a stack in storage, merged into it. Gear never moves.
//   STORAGE_MOVE     one whole stack / piece (named by its container and id), bag <-> storage or within the storage (never split): onto an empty cell it moves there; onto a
//                    different item it swaps; onto the same stackable type it merges; any move that would make a second stack of a type in a
//                    container merges into that container's stack instead; "to the other container, no cell" = its stack, else its first
//                    free cell (CONTAINER_FULL when neither). Bag -> bag stays MOVE_ITEM.
// `planMove` decides, read-only; `moveStored` executes the plan; `dropCommand` (dragDrop.ts) asks the same planner, so the UI's highlighted
// targets and the engine can never disagree. Payments from storage (builds, upgrades, crafts) live in stock.ts.
import { buildingLevel, isBuilt } from './buildings';
import { BUILDINGS } from './config/buildings';
import { bagCells, cellsOf, firstEmptyCell, itemInCell, placeInCell, placeInStorage, placeInStorageCell, settleCells, storageBox } from './inventory';
import type { GameEvent, GameState, Inventory, Item } from './types';

export type StorageErrorCode = 'BUILDING_LOCKED' | 'INVALID_COMMAND' | 'NOT_IN_INVENTORY' | 'INVALID_CELL' | 'SAME_CELL' | 'CONTAINER_FULL' | 'NOTHING_TO_MOVE';
export type StorageError = { code: StorageErrorCode; message: string } | null;

const err = (code: StorageErrorCode, message: string): NonNullable<StorageError> => ({ code, message });

/** The two containers. */
export type Side = 'bag' | 'storage';

/** What the planner needs: both containers and the Storage building (its level is the storage's capacity). */
export type StorageStateSlice = Pick<GameState, 'inventory' | 'storage' | 'buildings'>;

const unitsOf = (i: Item) => (i.stackable ? (i.quantity ?? 1) : 1);
const isCell = (cell: unknown, capacity: number): cell is number => typeof cell === 'number' && Number.isSafeInteger(cell) && cell >= 0 && cell < capacity;
const stackOf = (box: Inventory, defId: string): Item | undefined => box.items.find((i) => i.stackable && i.defId === defId);

function boxesOf(state: StorageStateSlice): Record<Side, Inventory> {
  return { bag: state.inventory, storage: storageBox(state) };
}

const lockedError = () => err('BUILDING_LOCKED', `Build the ${BUILDINGS.storage.name} first`);

// ---------- the planner ----------

/** What a legal STORAGE_MOVE does (decided read-only by planMove). */
export type MovePlan =
  /** The item moves to an empty cell of `to` (`from` = `to` for a move inside the storage). */
  | { kind: 'place'; item: Item; from: Side; to: Side; cell: number }
  /** The item's units join the stack `into` (the container's one stack of that type) and the item is gone. */
  | { kind: 'merge'; item: Item; from: Side; to: Side; into: Item }
  /**
   * The item takes `other`'s cell in `to`; `other` takes the item's cell in `from`, or, when `from` already has a stack of its type
   * (`otherInto`), joins that stack (one stack per type) and leaves the item's old cell empty. `from` = `to`: the two just trade cells.
   */
  | { kind: 'swap'; item: Item; from: Side; to: Side; other: Item; otherInto: Item | null };

export type MoveResult = { ok: true; plan: MovePlan } | { ok: false; error: NonNullable<StorageError> };

/**
 * Plans STORAGE_MOVE of item `itemId` in container `from` to container `to`, aimed at cell `toCell` (any cell of `to`, or none: the stack of
 * its type there, else the first free cell). `from` is part of the command because a stackable's id is its definition id, so the bag's and
 * the storage's stacks of one type share an id. Read-only: the same answer the command gets, so the drag can ask first.
 * Refusals: BUILDING_LOCKED, NOT_IN_INVENTORY, INVALID_CELL, INVALID_COMMAND (bag to bag: MOVE_ITEM; inside the storage a cell is needed;
 * an unknown container), SAME_CELL, CONTAINER_FULL.
 */
export function planMove(state: StorageStateSlice, from: unknown, itemId: unknown, to: unknown, toCell?: unknown): MoveResult {
  const fail = (error: NonNullable<StorageError>): MoveResult => ({ ok: false, error });
  if (!isBuilt(state, 'storage')) return fail(lockedError());
  if ((from !== 'bag' && from !== 'storage') || (to !== 'bag' && to !== 'storage')) return fail(err('INVALID_COMMAND', `Unknown container ${String(from !== 'bag' && from !== 'storage' ? from : to)}`));
  const boxes = boxesOf(state);
  const item = typeof itemId === 'string' ? boxes[from].items.find((i) => i.id === itemId) : undefined;
  if (!item) return fail(err('NOT_IN_INVENTORY', `That item is not in the ${from}`));
  const dst = boxes[to];
  if (toCell !== undefined && !isCell(toCell, dst.capacity)) return fail(err('INVALID_CELL', `Unknown cell ${String(toCell)}`));
  if (from === to) {
    if (from === 'bag') return fail(err('INVALID_COMMAND', 'Moving inside the bag is MOVE_ITEM'));
    if (toCell === undefined) return fail(err('INVALID_COMMAND', 'Name the cell to move to'));
    const here = cellsOf(dst)[dst.items.indexOf(item)];
    if (here === toCell) return fail(err('SAME_CELL', 'The item is already in that cell'));
    const other = itemInCell(dst, toCell);
    return { ok: true, plan: other ? { kind: 'swap', item, from, to, other, otherInto: null } : { kind: 'place', item, from, to, cell: toCell } };
  }
  // Into the other container: its one stack of this type takes the whole item, wherever it was aimed.
  const stack = item.stackable ? stackOf(dst, item.defId) : undefined;
  if (stack) return { ok: true, plan: { kind: 'merge', item, from, to, into: stack } };
  if (toCell === undefined) {
    const cell = firstEmptyCell(dst);
    if (cell < 0) return fail(err('CONTAINER_FULL', `The ${to === 'bag' ? 'bag' : 'storage'} is full`));
    return { ok: true, plan: { kind: 'place', item, from, to, cell } };
  }
  const other = itemInCell(dst, toCell);
  if (!other) return { ok: true, plan: { kind: 'place', item, from, to, cell: toCell } };
  // A swap: the other item goes back to the cell the moved one leaves (always free), unless its type already has a stack there.
  const src = boxes[from];
  const otherInto = other.stackable ? (stackOf(src, other.defId) ?? null) : null;
  return { ok: true, plan: { kind: 'swap', item, from, to, other, otherInto } };
}

/** `planMove` for the UI's drop test: true when the command would be accepted. */
export function canMove(state: StorageStateSlice, from: Side, itemId: string, to: Side, toCell?: number): boolean {
  return planMove(state, from, itemId, to, toCell).ok;
}

// ---------- the executor ----------

function remove(box: Inventory, item: Item): void {
  const at = box.items.indexOf(item);
  if (at >= 0) box.items.splice(at, 1);
}

/** Puts an item into a cell of a container through that container's own entry function. False when the cell is not an empty one. */
function putInCell(draft: StorageStateSlice, side: Side, item: Item, cell: number): boolean {
  return side === 'bag' ? placeInCell(draft.inventory, item, cell) : placeInStorageCell(draft, item, cell);
}

/**
 * STORAGE_MOVE on a draft copy: plans, then executes. Nothing changes on a refusal. `toCell` is optional (see planMove).
 */
export function moveStored(draft: GameState, from: unknown, itemId: unknown, to: unknown, toCell?: unknown): StorageError {
  if (isBuilt(draft, 'storage')) {
    settleCells(draft.inventory);
    settleCells(storageBox(draft));
  }
  const planned = planMove(draft, from, itemId, to, toCell);
  if (!planned.ok) return planned.error;
  const p = planned.plan;
  const boxes = boxesOf(draft);
  if (p.kind === 'merge') {
    p.into.quantity = (p.into.quantity ?? 0) + unitsOf(p.item);
    remove(boxes[p.from], p.item);
    return null;
  }
  if (p.kind === 'place') {
    remove(boxes[p.from], p.item);
    if (!putInCell(draft, p.to, p.item, p.cell)) return err('INVALID_CELL', `Cell ${p.cell} is not free`);
    return null;
  }
  // swap
  const itemCell = p.item.cell as number;
  const otherCell = p.other.cell as number;
  if (p.from === p.to) {
    p.item.cell = otherCell;
    p.other.cell = itemCell;
    return null;
  }
  remove(boxes[p.from], p.item);
  remove(boxes[p.to], p.other);
  if (!putInCell(draft, p.to, p.item, otherCell)) return err('INVALID_CELL', `Cell ${otherCell} is not free`);
  if (p.otherInto) p.otherInto.quantity = (p.otherInto.quantity ?? 0) + unitsOf(p.other);
  else if (!putInCell(draft, p.from, p.other, itemCell)) return err('INVALID_CELL', `Cell ${itemCell} is not free`);
  return null;
}

// ---------- deposits ----------

/** The bag's entries in cell order (what "in bag-cell order" means). */
function bagInCellOrder(draft: GameState): Item[] {
  settleCells(draft.inventory);
  return [...draft.inventory.items].sort((a, b) => (a.cell as number) - (b.cell as number));
}

/** Merges a bag stack into the storage's stack of its type. False when storage has none (or the item is not stackable). */
function mergeIntoStorage(draft: GameState, item: Item): boolean {
  const stack = item.stackable ? stackOf(storageBox(draft), item.defId) : undefined;
  if (!stack) return false;
  stack.quantity = (stack.quantity ?? 0) + unitsOf(item);
  remove(draft.inventory, item);
  return true;
}

/**
 * DEPOSIT_ALL on a draft copy: merges first, then the rest into the lowest free storage cells in bag-cell order; what does not fit stays in
 * the bag. Pushes ITEMS_DEPOSITED { moved, stayed } (bag entries). Refused (nothing changes): BUILDING_LOCKED, NOTHING_TO_MOVE (empty
 * bag), CONTAINER_FULL (storage full and nothing merges: not one entry could move).
 */
export function depositAll(draft: GameState, events: GameEvent[]): StorageError {
  if (!isBuilt(draft, 'storage')) return lockedError();
  settleCells(storageBox(draft));
  const items = bagInCellOrder(draft);
  if (items.length === 0) return err('NOTHING_TO_MOVE', 'Bag is empty');
  let moved = 0;
  const rest: Item[] = [];
  for (const item of items) {
    if (mergeIntoStorage(draft, item)) moved += 1;
    else rest.push(item);
  }
  let stayed = 0;
  for (const item of rest) {
    // A second stack of one type in the bag (a damaged document) joins the stack the first one just opened.
    if (mergeIntoStorage(draft, item)) moved += 1;
    else if (firstEmptyCell(storageBox(draft)) < 0) stayed += 1;
    else {
      remove(draft.inventory, item);
      placeInStorage(draft, item);
      moved += 1;
    }
  }
  if (moved === 0) return err('CONTAINER_FULL', 'Storage is full');
  events.push({ type: 'ITEMS_DEPOSITED', mode: 'all', moved, stayed });
  return null;
}

/** DEPOSIT_STACKED on a draft copy: the bag stackables whose type has a stack in storage merge into it. Refused: BUILDING_LOCKED, NOTHING_TO_MOVE. */
export function depositStacked(draft: GameState, events: GameEvent[]): StorageError {
  if (!isBuilt(draft, 'storage')) return lockedError();
  settleCells(storageBox(draft));
  let moved = 0;
  for (const item of bagInCellOrder(draft)) if (mergeIntoStorage(draft, item)) moved += 1;
  if (moved === 0) return err('NOTHING_TO_MOVE', 'No stack in the bag matches one in the storage');
  events.push({ type: 'ITEMS_DEPOSITED', mode: 'stacked', moved, stayed: 0 });
  return null;
}

// ---------- views (read-only, for the Storage modal) ----------

export type DepositPreview = {
  /** DEPOSIT_ALL: bag entries that would move now, entries that would stay (storage full), and why it is greyed (null = it can run). */
  all: { moves: number; stays: number; reason: string | null };
  /** DEPOSIT_STACKED: bag stacks that would merge, and why it is greyed (null = it can run). */
  stacked: { moves: number; reason: string | null };
};

export type StorageView = {
  built: boolean;
  level: number;
  /** Storage cells (0 while locked) and entries in them. */
  capacity: number;
  used: number;
  /** The storage as the grid the player sees (`capacity` entries; null = empty cell). */
  cells: (Item | null)[];
  /** The bag's cells and entries, for the "Bag 12 / 20" header. */
  bagCapacity: number;
  bagUsed: number;
  deposit: DepositPreview;
};

/** What the two deposit buttons would do right now. Cheap (no copies): an approximation only for a damaged bag with two stacks of one type. */
export function depositPreview(state: StorageStateSlice): DepositPreview {
  const box = storageBox(state);
  const bag = state.inventory.items;
  if (!isBuilt(state, 'storage')) return { all: { moves: 0, stays: 0, reason: 'Build the Storage first' }, stacked: { moves: 0, reason: 'Build the Storage first' } };
  const merges = bag.filter((i) => i.stackable && stackOf(box, i.defId)).length;
  const others = bag.length - merges;
  const room = Math.max(0, box.capacity - box.items.length);
  const fit = Math.min(others, room);
  const moves = merges + fit;
  const reasonAll = bag.length === 0 ? 'Bag is empty' : moves === 0 ? 'Storage is full' : null;
  return {
    all: { moves, stays: others - fit, reason: reasonAll },
    stacked: { moves: merges, reason: merges === 0 ? 'No matching stack' : null },
  };
}

export function storageView(state: StorageStateSlice): StorageView {
  const box = storageBox(state);
  return {
    built: isBuilt(state, 'storage'),
    level: buildingLevel(state, 'storage'),
    capacity: box.capacity,
    used: box.items.length,
    cells: bagCells(box),
    bagCapacity: state.inventory.capacity,
    bagUsed: state.inventory.items.length,
    deposit: depositPreview(state),
  };
}
