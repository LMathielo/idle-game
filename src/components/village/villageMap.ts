// Village map data (pure): world size, where the original village ("core") sits, each sign's anchor and the empty
// building plots, all in base pixels of the artwork (assets/images/village.png, drawn by tools/generate-village.py at
// 4x). If the artwork changes, re-run the script and copy its printed anchors here.

/** The whole map, base px. */
export const WORLD = { w: 360, h: 560 } as const;
/** The original 180x390 village inside the world: the map starts centred on it. */
export const CORE = { x: 90, y: 40, w: 180, h: 390 } as const;

export type VillageAction = 'storage' | 'merchant' | 'dungeon' | 'training' | 'woodcutting' | 'mine' | 'town_hall';

/**
 * The centre of each sign, world px. Landmarks (core px, + CORE offset) from tools/generate-village.py:
 * dungeon under the cave mouth, mine under the mine entrance, woodcutting at the forest's foot by the stumps, merchant
 * over the stall's awning, town_hall on the hall's roof under the bell tower, storage in front of the barn, training on
 * the yard's top fence.
 */
export const SIGNS: readonly { key: VillageAction; label: string; icon: string; x: number; y: number }[] = [
  { key: 'dungeon', label: 'Dungeon', icon: '💀', x: 234, y: 171 },
  { key: 'mine', label: 'Mine Shaft', icon: '⛏️', x: 135, y: 171 },
  { key: 'woodcutting', label: 'Woodcutting', icon: '🪓', x: 135, y: 254 },
  { key: 'merchant', label: 'Merchant', icon: '💰', x: 222, y: 231 },
  { key: 'town_hall', label: 'Town Hall', icon: '🏛️', x: 218, y: 280 },
  { key: 'storage', label: 'Storage', icon: '📦', x: 129, y: 329 },
  { key: 'training', label: 'Training', icon: '⚔️', x: 222, y: 315 },
];

/** Empty plots (x0, y0, x1, y1 world px) for future buildings. No signs yet. */
export const PLOTS = {
  west: [18, 292, 62, 318],
  east: [292, 314, 336, 340],
  south_west: [106, 496, 148, 528],
  south_east: [214, 496, 256, 528],
} as const;

/** Max zoom = this × the starting zoom (the core filling the screen). */
export const MAX_ZOOM_FACTOR = 2.5;
/**
 * Min zoom = the larger of "the map still covers the screen" and this × the starting zoom: signs keep their size while
 * the map shrinks, so zooming far out would pile them up.
 */
export const MIN_ZOOM_FACTOR = 0.7;

export type MapViewport = { w: number; h: number };
export type MapCamera = { zoom: number; tx: number; ty: number };

/** Zoom limits and the start camera for a viewport (points per world px; tx/ty = screen position of world 0,0). */
export function mapLimits(view: MapViewport, top = 0, bottom = 0) {
  const cover = Math.max(view.w / WORLD.w, view.h / WORLD.h);
  const start = Math.max(cover, view.w / CORE.w, view.h / CORE.h);
  const minZoom = Math.max(cover, start * MIN_ZOOM_FACTOR);
  const maxZoom = start * MAX_ZOOM_FACTOR;
  // Centre the core in the band the HUD and the activity strip leave visible.
  const cx = CORE.x + CORE.w / 2;
  const cy = CORE.y + CORE.h / 2;
  const bandMid = top + (view.h - top - bottom) / 2;
  const camera = clampCamera({ zoom: start, tx: view.w / 2 - cx * start, ty: bandMid - cy * start }, view);
  return { minZoom, maxZoom, start, camera };
}

/** Keeps the map covering the screen: no empty bars on any side. */
export function clampCamera(c: MapCamera, view: MapViewport): MapCamera {
  'worklet';
  const minX = view.w - WORLD.w * c.zoom;
  const minY = view.h - WORLD.h * c.zoom;
  return { zoom: c.zoom, tx: Math.min(0, Math.max(minX, c.tx)), ty: Math.min(0, Math.max(minY, c.ty)) };
}
