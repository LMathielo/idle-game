"""Split the approved village into a background + one sprite per building.

Background = the approved map with every building removed (terrain, cliffs, roads, plaza, fountain, trees, fields, river).
Sprites   = each usable building (keyed by BuildingId) and the 3 decorative cottages, drawn alone on a transparent canvas.
            Cast shadows and chimney smoke are translucent pixels, so they blend with whatever ground is under them.

Placement is in world px (360x560 map). Draw the background, then the sprites in `order` (back to front).
"""
import sys, os, json
import numpy as np
from PIL import Image
import village_day as vd
from kit import Town

W, H = vd.W, vd.H


def render_sprite(fn, groundm):
    sc = Town(W, H)
    sc.sprite_mode = True
    sc.groundm = groundm.copy()
    fn(sc)
    vd.smoke(sc)
    arr = sc.rgba()
    ys, xs = np.nonzero(arr[..., 3])
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    return arr[y0:y1, x0:x1], (int(x0), int(y0)), sc.anchors


def split(out_dir, scale=4):
    os.makedirs(os.path.join(out_dir, 'buildings'), exist_ok=True)
    bg = vd.build(buildings=False)
    bg_img = bg.image(1).convert('RGBA')
    bg.save(os.path.join(out_dir, 'village_background.png'), scale)
    layout = {'world': {'w': W, 'h': H, 'scale': scale}, 'background': 'village_background.png', 'order': [], 'pieces': {}}
    comp = bg_img.copy()
    for kind, group in (('building', vd.BUILDINGS), ('decor', vd.DECOR)):
        for pid, fn in group:
            arr, (x, y), anchors = render_sprite(fn, bg.groundm)
            im = Image.fromarray(arr, 'RGBA')
            rel = f'buildings/{pid}.png'
            im.resize((im.width * scale, im.height * scale), Image.NEAREST).save(os.path.join(out_dir, rel))
            comp.alpha_composite(im, (x, y))
            piece = {'kind': kind, 'file': rel, 'x': x, 'y': y, 'w': im.width, 'h': im.height, 'z': len(layout['order'])}
            if pid in anchors:
                piece['sign'] = {'x': int(anchors[pid][0]), 'y': int(anchors[pid][1])}
            layout['pieces'][pid] = piece
            layout['order'].append(pid)
    with open(os.path.join(out_dir, 'village_layout.json'), 'w') as f:
        json.dump(layout, f, indent=1)
    return bg_img, comp, layout


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'out/split'
    bg_img, comp, layout = split(out)
    full = vd.build().image(1).convert('RGBA')
    a = np.asarray(full).astype(int); b = np.asarray(comp).astype(int)
    diff = np.abs(a - b).max(axis=2)
    print('pieces:', layout['order'])
    print('pixels differing from the approved map:', int((diff > 0).sum()), 'of', W * H, '| >24 levels:', int((diff > 24).sum()))
    comp.save(os.path.join(out, '_recomposed_1x.png')); bg_img.save(os.path.join(out, '_background_1x.png'))
    Image.fromarray(((diff > 24) * 255).astype(np.uint8)).save(os.path.join(out, '_diff.png'))
