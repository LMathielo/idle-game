"""Export every approved asset into the game's asset folders.

    cd tools/art && python3 build_assets.py ../..        # repo root

Writes PNGs pre-scaled with nearest-neighbour (React Native smooths images it enlarges, so we ship them big and let
the device shrink them), plus assets/images/manifest.json listing every file and its 1x size.
Deterministic: same scripts -> same pixels. Requires numpy, scipy, Pillow.
"""
import sys, os, json
from PIL import Image

import village_day, village_split, sprites, monsters, icons, equipment, gear_named, materials, drops, gather

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
IMG = os.path.join(ROOT, 'assets', 'images')
manifest = {}


def put(rel, canvas, scale):
    path = os.path.join(IMG, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    canvas.save(path, scale)
    manifest[rel] = {'w': canvas.w, 'h': canvas.h, 'scale': scale}


# village: background (no buildings) + one sprite per building, placed by village_layout.json (all ×4)
os.makedirs(os.path.join(IMG, 'village'), exist_ok=True)
_, _, layout = village_split.split(os.path.join(IMG, 'village'), 4)
manifest['village/village_background.png'] = {'w': village_day.W, 'h': village_day.H, 'scale': 4}
for pid in layout['order']:
    p = layout['pieces'][pid]
    manifest['village/' + p['file']] = {'w': p['w'], 'h': p['h'], 'scale': 4}
manifest['village/village_layout.json'] = {'kind': 'layout'}

# hero portrait (option B, Village Squire)
put('portrait/hero.png', sprites.portrait_squire(), 8)

# enemies: the base creature of each EnemyId, the Troll Chieftain (the boss), and the creatures the Hard / Extreme variants are
# (enemies/variants/<creature id>.png; the ids are in src/engine/config/difficulty.ts ENEMY_VARIANTS)
for eid, fn in (('rat', sprites.rat_sewer), ('bat', monsters.bat_cave), ('wolf', monsters.wolf_grey),
                ('skeleton', monsters.skeleton_crypt), ('troll', monsters.troll_moss), ('troll_chieftain', monsters.troll_chieftain)):
    put(f'enemies/{eid}.png', fn(), 8)
for vid, fn in (('giant_rat', sprites.rat_giant), ('blight_rat', sprites.rat_blight),
                ('vampire_bat', monsters.bat_vampire), ('plague_bat', monsters.bat_plague),
                ('dire_wolf', monsters.wolf_dire), ('shadow_wolf', monsters.wolf_shadow),
                ('skeleton_knight', monsters.skeleton_knight), ('bone_champion', monsters.skeleton_champion),
                ('stone_troll', monsters.troll_stone), ('magma_troll', monsters.troll_magma)):
    put(f'enemies/variants/{vid}.png', fn(), 8)

# common UI symbols + hero skills (16x16)
for name, fn, _, _ in icons.SET:
    put(f'icons/{name}.png', fn(), 8)
for name, fn, _, _ in gather.SKILL_SET:
    put(f'icons/{name}.png', fn(), 8)

# items, keyed by item id (32x32)
for tier, t in equipment.TIERS.items():
    for piece, fn, _, _ in equipment.PIECES:
        put(f'items/{tier}_{piece}.png', fn(t), 8)
for group in (gear_named.SET, materials.SET, drops.SET):
    for item_id, fn, _, _ in group:
        put(f'items/{item_id}.png', fn(), 8)

# gathering targets: trees (rocks reuse the stone / ore item icons, see manifest "rocks")
for name, fn, _ in gather.TREE_SET:
    put(f'trees/{name.replace("_tree", "")}.png', fn(), 8)

manifest['_rocks'] = {'stone': 'items/stone.png', 'copper': 'items/copper_ore.png', 'iron': 'items/iron_ore.png',
                      'silver': 'items/silver_ore.png', 'gold': 'items/gold_ore.png'}
with open(os.path.join(IMG, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=1)
print(f'{len(manifest) - 2} images written to {IMG}')
