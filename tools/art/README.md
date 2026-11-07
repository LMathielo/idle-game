# Art generator

Every pixel-art image in the game is drawn by these Python scripts, so the art rules (pixel grid, palette ramps, light,
outline, dithering) are enforced in code. The output is deterministic: the same scripts give the same pixels.

Rebuild everything into `assets/images/` (from the repo root):

```bash
cd tools/art && python3 build_assets.py ../..
```

Needs Python 3 with `numpy`, `scipy` and `Pillow` (`pip install numpy scipy pillow`).

It writes the PNGs pre-scaled with nearest-neighbour (village x4, everything else x8; the app only ever shrinks them),
plus `assets/images/manifest.json` (every file and its 1x size; `_rocks` maps rocks to the item art they reuse) and
`assets/images/village/village_layout.json` (the village background, then each building piece's world-px box, sign
anchor and draw order). Commit the generated files with the change. Never edit the PNGs by hand.

| Script | Draws |
| --- | --- |
| `pix.py` | canvas, ramps, shading, outline, glow (shared toolkit) |
| `elements.py` | terrain, trees, materials |
| `kit.py` | 3/4 building kit, props, townsfolk |
| `village_day.py` | the approved daytime village |
| `village_split.py` | the village split into a background + one sprite per building, and `village_layout.json` |
| `sprites.py` | hero portraits, rats (Rat, Giant Rat, Blight Rat) |
| `monsters.py` | bestiary: bat, wolf, skeleton, troll, the Troll Chieftain (boss), and each enemy's Hard / Extreme variant creature (Vampire Bat / Plague Bat, Dire Wolf / Shadow Wolf, Skeleton Knight / Bone Champion, Stone Troll / Magma Troll) |
| `icons.py` | common UI symbols (16x16), incl. the three difficulty skulls and the Potion Belt's button flask and two empty-slot ghosts |
| `equipment.py` | tiered equipment (sword, helm, chestplate, shield, greaves, gloves, boots) |
| `gear_named.py` | starter gear and gathering tools, plus the crafted Stone / Copper / Silver / Gold axes and pickaxes |
| `materials.py` | logs, planks, stone, ores, ingots |
| `drops.py` | monster drops (incl. the Wild Sage herb and the Troll Head), junk, potions, the Potion Belt |
| `gather.py` | trees and hero skill icons |
| `build_assets.py` | exports everything into `assets/images/` |

Enemies: `enemies/<id>.png` for each EnemyId (the boss `troll_chieftain` included) and `enemies/variants/<creature id>.png` for the
creature a Hard ("veteran") or Extreme ("extreme") pack mob is; the ids and names are data in `src/engine/config/difficulty.ts`
(`ENEMY_VARIANTS`). Every variant is the size of its base. The plain Hard mob uses the base sprite.

The client reads the files through `src/components/art/images.ts` (static `require()` maps keyed by game ids);
`tests/art.test.ts` fails when a game id has no art. Art rules and owner approvals live in the Project's
`art/ART_BASELINE.md`.
