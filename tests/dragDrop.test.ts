// dropCommand (engine/dragDrop.ts): what a drop in the Hero tab sends. For EVERY pair of (picked-up thing, target) in several states the
// answer is a command exactly when the engine accepts that command, and applying it does what the drag promised.
import { afterAll, describe, expect, it } from 'vitest';
import { applyCommand, type DragSource, type DragTarget, dropCommand, EQUIPMENT_SLOTS, type EquipmentSlot, type GameState, ITEMS } from '../src/engine';
import { cloneState } from '../src/engine/clone';
import { addStackable, makeItem, placeInBag } from '../src/engine/inventory';
import { builtGame, cmd, T0 } from './helpers';

// No ring exists in the catalog yet: two test rings, registered while this file runs (before any describe builds a state).
Object.assign(ITEMS, {
  drag_ring_a: { ...ITEMS.iron_helm, id: 'drag_ring_a', name: 'Drag Ring A', slot: 'ring1', armor: 0 },
  drag_ring_b: { ...ITEMS.iron_helm, id: 'drag_ring_b', name: 'Drag Ring B', slot: 'ring2', armor: 0 },
});
afterAll(() => {
  delete (ITEMS as Record<string, unknown>).drag_ring_a;
  delete (ITEMS as Record<string, unknown>).drag_ring_b;
});

const ok = (s: GameState, c: Parameters<typeof cmd>[0]): GameState => {
  const r = applyCommand(s, cmd(c), T0);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
};

function base(): GameState {
  const s = cloneState(builtGame(1, T0));
  for (const [defId, id] of [['iron_sword', 'sword'], ['iron_helm', 'helm'], ['copper_helm', 'copper'], ['iron_axe', 'axe'], ['drag_ring_a', 'ringA'], ['drag_ring_b', 'ringB'], ['iron_boots', 'boots']] as const) {
    placeInBag(s.inventory, makeItem(defId, 1, id, { quality: 50, rarity: 'common' }));
  }
  addStackable(s.inventory, 'health_potion_t1', 4);
  return s;
}

/** A spread of states: gaps, a worn helm, worn rings (both, one), a full bag, a worn belt. */
function states(): [string, GameState][] {
  const gapped = ok(ok(base(), { type: 'MOVE_ITEM', itemId: 'helm', toCell: 11 }), { type: 'MOVE_ITEM', itemId: 'boots', toCell: 17 });
  const helm = ok(gapped, { type: 'EQUIP_ITEM', itemId: 'helm' });
  const oneRing = ok(gapped, { type: 'EQUIP_ITEM', itemId: 'ringA' });
  const twoRings = ok(oneRing, { type: 'EQUIP_ITEM', itemId: 'ringB' });
  const full = cloneState(twoRings);
  while (placeInBag(full.inventory, makeItem('bread', 1, `junk${full.inventory.items.length}`))) {
    /* fill */
  }
  const belt = cloneState(gapped);
  placeInBag(belt.inventory, makeItem('potion_belt'));
  return [['gapped', gapped], ['helm worn', helm], ['one ring', oneRing], ['two rings', twoRings], ['full bag', full], ['belt in the bag', belt], ['belt worn', ok(belt, { type: 'EQUIP_ITEM', itemId: 'potion_belt' })]];
}

const targetsOf = (s: GameState): DragTarget[] => [
  ...Array.from({ length: s.inventory.capacity }, (_, cell): DragTarget => ({ kind: 'cell', cell })),
  ...EQUIPMENT_SLOTS.map((slot): DragTarget => ({ kind: 'slot', slot })),
];
const sourcesOf = (s: GameState): DragSource[] => [
  ...s.inventory.items.map((i): DragSource => ({ kind: 'bag', itemId: i.id })),
  ...(Object.keys(s.character.equipment) as EquipmentSlot[]).map((slot): DragSource => ({ kind: 'slot', slot })),
];

/** The engine's own verdict on the drop, built without dropCommand: the command the player's gesture means. */
function attempt(s: GameState, src: DragSource, t: DragTarget): Parameters<typeof cmd>[0] | null {
  if (src.kind === 'bag' && t.kind === 'cell') return { type: 'MOVE_ITEM', itemId: src.itemId, toCell: t.cell };
  if (src.kind === 'bag' && t.kind === 'slot') return { type: 'EQUIP_ITEM', itemId: src.itemId, slot: t.slot };
  if (src.kind === 'slot' && t.kind === 'cell') return { type: 'UNEQUIP_ITEM', slot: src.slot, toCell: t.cell };
  if (src.kind === 'slot' && t.kind === 'slot' && src.slot !== t.slot && (src.slot === 'ring1' || src.slot === 'ring2') && (t.slot === 'ring1' || t.slot === 'ring2')) return { type: 'SWAP_RINGS' };
  return null; // a worn piece onto another equipment slot: nothing exists for it
}

describe('dropCommand agrees with the engine for every pair of source and target', () => {
  for (const [name, s] of states()) {
    it(`${name}: a command iff the engine accepts it, and the command is the attempted one`, () => {
      let accepted = 0;
      let refused = 0;
      for (const src of sourcesOf(s)) {
        for (const t of targetsOf(s)) {
          const got = dropCommand(s, src, t);
          const tried = attempt(s, src, t);
          const verdict = tried ? applyCommand(s, cmd(tried), T0).ok : false;
          if (got) {
            expect(verdict, `${JSON.stringify(src)} -> ${JSON.stringify(t)}`).toBe(true);
            expect(got).toEqual(tried);
            accepted += 1;
          } else {
            expect(verdict, `${JSON.stringify(src)} -> ${JSON.stringify(t)} should be refused`).toBe(false);
            refused += 1;
          }
        }
      }
      expect(accepted).toBeGreaterThan(10);
      expect(refused).toBeGreaterThan(10);
    });
  }
});

describe('the drag rules, one by one', () => {
  const [, gapped] = states()[0];
  const cell = (c: number): DragTarget => ({ kind: 'cell', cell: c });
  const slot = (x: EquipmentSlot): DragTarget => ({ kind: 'slot', slot: x });
  const bag = (itemId: string): DragSource => ({ kind: 'bag', itemId });
  const worn = (x: EquipmentSlot): DragSource => ({ kind: 'slot', slot: x });

  it('bag to cell: empty cell moves, filled cell swaps, its own cell does nothing, a cell outside the bag does nothing', () => {
    expect(dropCommand(gapped, bag('sword'), cell(12))).toEqual({ type: 'MOVE_ITEM', itemId: 'sword', toCell: 12 });
    expect(dropCommand(gapped, bag('sword'), cell(0))).toEqual({ type: 'MOVE_ITEM', itemId: 'sword', toCell: 0 });
    expect(dropCommand(gapped, bag('sword'), cell(gapped.inventory.items.find((i) => i.id === 'sword')!.cell!))).toBeNull();
    expect(dropCommand(gapped, bag('sword'), cell(20))).toBeNull();
    expect(dropCommand(gapped, bag('sword'), cell(-1))).toBeNull();
    expect(dropCommand(gapped, bag('nope'), cell(3))).toBeNull();
  });

  it('bag to equipment slot: only its own slot; wrong type and non-gear do nothing', () => {
    expect(dropCommand(gapped, bag('sword'), slot('weapon'))).toEqual({ type: 'EQUIP_ITEM', itemId: 'sword', slot: 'weapon' });
    expect(dropCommand(gapped, bag('sword'), slot('helmet'))).toBeNull();
    expect(dropCommand(gapped, bag('health_potion_t1'), slot('weapon'))).toBeNull();
    expect(dropCommand(gapped, bag('bread'), slot('accessory'))).toBeNull();
    expect(dropCommand(gapped, bag('axe'), slot('axe'))).toEqual({ type: 'EQUIP_ITEM', itemId: 'axe', slot: 'axe' }); // swaps the Wooden Axe into its cell
    expect(dropCommand(gapped, bag('ringA'), slot('ring2'))).toEqual({ type: 'EQUIP_ITEM', itemId: 'ringA', slot: 'ring2' }); // a ring picks either ring slot
    expect(dropCommand(gapped, bag('ringA'), slot('amulet'))).toBeNull();
  });

  it('worn to cell: empty cell receives it; a piece that fits swaps; anything else does nothing', () => {
    const helm = states()[1][1];
    expect(dropCommand(helm, worn('helmet'), cell(14))).toEqual({ type: 'UNEQUIP_ITEM', slot: 'helmet', toCell: 14 }); // empty
    const copperCell = helm.inventory.items.find((i) => i.id === 'copper')!.cell!;
    expect(dropCommand(helm, worn('helmet'), cell(copperCell))).toEqual({ type: 'UNEQUIP_ITEM', slot: 'helmet', toCell: copperCell });
    const swordCell = helm.inventory.items.find((i) => i.id === 'sword')!.cell!;
    expect(dropCommand(helm, worn('helmet'), cell(swordCell))).toBeNull();
    expect(dropCommand(helm, worn('weapon'), cell(copperCell))).toBeNull(); // a helm does not fit the weapon slot
    expect(dropCommand(helm, worn('gloves'), cell(14))).toBeNull(); // nothing worn there
  });

  it('ring to ring swaps (even into an empty ring slot); nothing else moves between slots', () => {
    const one = states()[2][1];
    expect(dropCommand(one, worn('ring1'), slot('ring2'))).toEqual({ type: 'SWAP_RINGS' });
    const two = states()[3][1];
    expect(dropCommand(two, worn('ring2'), slot('ring1'))).toEqual({ type: 'SWAP_RINGS' });
    expect(dropCommand(two, worn('ring1'), slot('ring1'))).toBeNull();
    expect(dropCommand(two, worn('ring1'), slot('amulet'))).toBeNull();
    expect(dropCommand(states()[1][1], worn('helmet'), slot('armor'))).toBeNull();
  });

  it('a full bag: moves and swaps work, dragging a worn piece onto a filled fitting cell swaps; onto a non-fitting one does nothing (no free cell exists)', () => {
    const full = states()[4][1];
    const itemCell = full.inventory.items.find((i) => i.id === 'sword')!.cell!;
    const other = full.inventory.items.find((i) => i.id !== 'sword')!.cell!;
    expect(dropCommand(full, bag('sword'), cell(other))).toEqual({ type: 'MOVE_ITEM', itemId: 'sword', toCell: other });
    expect(dropCommand(full, worn('ring1'), cell(itemCell))).toBeNull();
  });
});
