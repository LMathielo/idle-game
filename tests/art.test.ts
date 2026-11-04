// The pixel-art registry (src/components/art/images.ts): every game id that the UI draws resolves to a generated file
// (assets/images, built by tools/art/build_assets.py), sizes match manifest.json, and the village layout holds every
// sign. A new catalog entry without art fails here.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ENEMY_SPRITES,
  HERO_PORTRAIT,
  ICONS,
  ITEM_IMAGES,
  itemImage,
  nodeImage,
  ROCK_IMAGES,
  SKILL_ICONS,
  TREE_IMAGES,
  VILLAGE_BACKGROUND,
  VILLAGE_PIECES,
} from '../src/components/art/images';
import { LAYOUT, PIECES, SIGNS } from '../src/components/village/villageMap';
import { ENEMIES, ITEMS, ROCKS, STARTING_HERO, TREES } from '../src/engine';

const ROOT = join(__dirname, '..');
const IMAGES = join(ROOT, 'assets', 'images');
const manifest = JSON.parse(readFileSync(join(IMAGES, 'manifest.json'), 'utf8')) as Record<string, { w: number; h: number; scale: number }> & {
  _rocks: Record<string, string>;
};

/** In tests a PNG require() is its absolute path (tests/setup/pngRequire.ts). */
const rel = (src: unknown) => {
  expect(typeof src).toBe('string');
  return (src as string).slice(IMAGES.length + 1).split('\\').join('/');
};

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const sorted = (a: Iterable<string>) => [...a].sort();

describe('art registry', () => {
  it('every catalog item has its own image (items/<itemId>.png), no extra entries', () => {
    expect(sorted(Object.keys(ITEM_IMAGES))).toEqual(sorted(Object.keys(ITEMS)));
    for (const [id, src] of Object.entries(ITEM_IMAGES)) {
      expect(rel(src)).toBe(`items/${id}.png`);
      expect(manifest[`items/${id}.png`]).toMatchObject({ w: 32, h: 32, scale: 8 });
    }
  });

  it('an unknown item id falls back to the "unknown" icon', () => {
    expect(itemImage('no_such_item')).toBe(ICONS.unknown);
    expect(itemImage('toString')).toBe(ICONS.unknown);
    expect(itemImage('oak_logs')).toBe(ITEM_IMAGES.oak_logs);
  });

  it('every enemy has a sprite whose size matches the manifest (the troll is 48x48)', () => {
    expect(sorted(Object.keys(ENEMY_SPRITES))).toEqual(sorted(Object.keys(ENEMIES)));
    for (const [id, s] of Object.entries(ENEMY_SPRITES)) {
      const m = manifest[rel(s.source)];
      expect(rel(s.source)).toBe(`enemies/${id}.png`);
      expect({ w: s.w, h: s.h }).toEqual({ w: m.w, h: m.h });
      expect(pngSize(s.source as unknown as string)).toEqual({ w: m.w * m.scale, h: m.h * m.scale });
    }
    expect(ENEMY_SPRITES.troll.w / ENEMY_SPRITES.rat.w).toBe(1.5);
  });

  it('every tree, rock and skill resolves; rocks reuse the item art listed in manifest._rocks', () => {
    expect(sorted(Object.keys(TREE_IMAGES))).toEqual(sorted(Object.keys(TREES)));
    for (const [id, src] of Object.entries(TREE_IMAGES)) expect(rel(src)).toBe(`trees/${id}.png`);
    expect(sorted(Object.keys(ROCK_IMAGES))).toEqual(sorted(Object.keys(ROCKS)));
    for (const [id, src] of Object.entries(ROCK_IMAGES)) expect(rel(src)).toBe(manifest._rocks[id]);
    expect(sorted(Object.keys(SKILL_ICONS))).toEqual(sorted(STARTING_HERO.skills));
    for (const [id, src] of Object.entries(SKILL_ICONS)) expect(rel(src)).toBe(`icons/skill_${id}.png`);
    for (const id of [...Object.keys(TREES), ...Object.keys(ROCKS)] as (keyof typeof TREES | keyof typeof ROCKS)[]) {
      expect(nodeImage(id)).toBeTruthy();
    }
  });

  it('every UI icon and the hero portrait match the manifest', () => {
    const manifestIcons = Object.keys(manifest)
      .filter((k) => k.startsWith('icons/') && !k.startsWith('icons/skill_'))
      .map((k) => k.slice('icons/'.length, -'.png'.length));
    expect(sorted(Object.keys(ICONS))).toEqual(sorted(manifestIcons));
    for (const [id, src] of Object.entries(ICONS)) expect(rel(src)).toBe(`icons/${id}.png`);
    expect(rel(HERO_PORTRAIT.source)).toBe('portrait/hero.png');
    expect(manifest['portrait/hero.png']).toMatchObject({ w: HERO_PORTRAIT.w, h: HERO_PORTRAIT.h });
  });

  it('every image in the manifest exists on disk (the generator output is committed)', () => {
    for (const key of Object.keys(manifest).filter((k) => k.endsWith('.png'))) expect(existsSync(join(IMAGES, key))).toBe(true);
  });

  it('the engine never imports an image (it stays image-free for the server)', () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    for (const f of walk(join(ROOT, 'src', 'engine'))) expect(readFileSync(f, 'utf8')).not.toMatch(/\.(png|jpe?g|gif|webp)['"]/);
  });
});

describe('village layout', () => {
  it('lists all 8 sign keys as buildings with a sign anchor inside the world', () => {
    const keys = ['dungeon', 'mine', 'woodcutting', 'merchant', 'town_hall', 'storage', 'training', 'crafting'];
    for (const k of keys) {
      const p = LAYOUT.pieces[k];
      expect(p, k).toBeDefined();
      expect(p.kind).toBe('building');
      expect(p.sign).toBeDefined();
      expect(p.sign!.x).toBeGreaterThan(0);
      expect(p.sign!.x).toBeLessThan(LAYOUT.world.w);
      expect(p.sign!.y).toBeGreaterThan(0);
      expect(p.sign!.y).toBeLessThan(LAYOUT.world.h);
    }
    expect(sorted(SIGNS.map((s) => s.key))).toEqual(sorted(keys));
    for (const s of SIGNS) expect([s.x, s.y]).toEqual([LAYOUT.pieces[s.key].sign!.x, LAYOUT.pieces[s.key].sign!.y]);
  });

  it('every piece (draw order) has its image, at 4x its world box; the background fills the world at 4x', () => {
    expect(LAYOUT.world).toEqual({ w: 360, h: 560, scale: 4 });
    expect(rel(VILLAGE_BACKGROUND)).toBe(`village/${LAYOUT.background}`);
    expect(pngSize(VILLAGE_BACKGROUND as unknown as string)).toEqual({ w: 360 * 4, h: 560 * 4 });
    expect(sorted(Object.keys(VILLAGE_PIECES))).toEqual(sorted(LAYOUT.order));
    expect(PIECES.map((p) => p.id)).toEqual(LAYOUT.order);
    for (const p of PIECES) {
      const src = VILLAGE_PIECES[p.id as keyof typeof VILLAGE_PIECES];
      expect(rel(src)).toBe(`village/${LAYOUT.pieces[p.id].file}`);
      expect(pngSize(src as unknown as string)).toEqual({ w: p.w * 4, h: p.h * 4 });
      expect(p.x >= 0 && p.y >= 0 && p.x + p.w <= LAYOUT.world.w && p.y + p.h <= LAYOUT.world.h).toBe(true);
      // Usable buildings map to their sign; decor (cottages) has none and is always drawn.
      expect(p.sign).toBe(LAYOUT.pieces[p.id].kind === 'building' ? p.id : null);
    }
  });
});
