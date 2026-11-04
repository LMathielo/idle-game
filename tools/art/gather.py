"""Gathering targets and hero skills.
Trees (32x32): oak, birch, maple, yew, ironwood. Rocks reuse the approved stone / ore icons (materials.py).
Skills (16x16, like the common symbols): woodcutting, mining, fishing."""
import sys, os
import numpy as np
from pix import Canvas, ramp, hx, mix
from elements import OUT, OUT_LIT
from materials import WOODS
from icons import STEEL, WOOD

OUTDIR = sys.argv[1] if len(sys.argv) > 1 else 'out/gather'
GROUND = ramp('#2f5530', '#3f6e38', '#507f40', '#6ca24e')

TREES = {
    'oak': dict(leaf=ramp('#1e3a26', '#2b5230', '#3d6e38', '#548a42', '#72a650', '#98c264'), shape='round'),
    'birch': dict(leaf=ramp('#3a5a26', '#557a30', '#78a03e', '#9ac04e', '#bcd86a', '#dcec96'), shape='airy'),
    'maple': dict(leaf=ramp('#4a1410', '#7a2418', '#a83a1e', '#d0602a', '#ea8a3a', '#f6b85a'), shape='round'),
    'yew': dict(leaf=ramp('#0c1a14', '#14281e', '#1e3a28', '#2a4c32', '#3a6040', '#4e7650'), shape='cone', berries='#d0302a'),
    'ironwood': dict(leaf=ramp('#141c26', '#1e2c38', '#2c404e', '#3e5864', '#56747c', '#7a9aa0'), shape='spiky', sheen='#a8c4d0'),
}


def tree(name):
    t = TREES[name]
    w = WOODS[name]
    c = Canvas(32, 32)
    g = c.m_ellipse(16, 29, 12, 2.5)
    c.fill(g, GROUND[2]); c.fill(g & (c.xx < 14), GROUND[3]); c.outline(g, OUT)
    trunk = c.m_poly([(13, 29), (14, 18), (18, 18), (19, 29)]) | c.m_poly([(12, 29), (14, 27), (13, 30)]) | c.m_poly([(20, 29), (18, 27), (19, 30)])
    bark = w['bark']
    c.fill(trunk, bark[2]); c.fill(trunk & (c.xx <= 14), bark[3]); c.fill(trunk & (c.xx >= 18), bark[1])
    if 'marks' in w:
        for p in ((15, 21), (16, 21), (17, 24), (15, 26), (16, 26)):
            c.px(*p, w['marks'])
    c.outline(trunk, OUT)
    L = t['leaf']
    rng = np.random.default_rng(len(name))
    if t['shape'] == 'cone':
        can = c.empty()
        for k in range(4):
            y = 4 + k * 5
            hw = 4 + k * 2.6
            can |= c.m_poly([(16 - hw, y + 6), (16, y - 1), (16 + hw, y + 6)])
    elif t['shape'] == 'spiky':
        can = c.m_ellipse(16, 12, 10, 9)
        for a in np.linspace(0, 2 * np.pi, 13)[:-1]:
            x, y = 16 + 11.5 * np.cos(a), 12 + 10.5 * np.sin(a)
            can |= c.m_poly([(16 + 8 * np.cos(a - .25), 12 + 7.5 * np.sin(a - .25)), (x, y), (16 + 8 * np.cos(a + .25), 12 + 7.5 * np.sin(a + .25))])
        can &= c.yy < 22
    else:
        can = c.empty()
        blobs = ((16, 9, 7), (10, 13, 6), (22, 13, 6), (13, 17, 5.5), (20, 17, 5.5)) if t['shape'] == 'round' else \
                ((16, 7, 5), (11, 12, 5), (21, 11, 5), (14, 17, 4.5), (20, 17, 4.5), (9, 18, 3))
        for x, y, r in blobs:
            can |= c.m_ellipse(x, y, r, r * .9)
    c.shade(can, L, soft=2.6)
    ys, xs = np.nonzero(can)
    for i in rng.choice(len(xs), len(xs) // 7, replace=False):
        c.px(xs[i], ys[i], L[min(5, max(1, (4 if xs[i] < 16 and ys[i] < 13 else 2) + int(rng.integers(-1, 2))))])
    if t.get('berries'):
        for i in rng.choice(len(xs), 7, replace=False):
            c.px(xs[i], ys[i], t['berries'])
    if t.get('sheen'):
        for i in rng.choice(len(xs), 9, replace=False):
            if xs[i] < 18:
                c.px(xs[i], ys[i], t['sheen'])
    if t['shape'] == 'airy':
        for i in rng.choice(len(xs), 10, replace=False):
            c.px(xs[i], ys[i], L[5])
    c.outline(can, OUT_LIT, OUT)
    return c


# ------------------------------------------------------------------ skills, 16x16
def skill_axe():
    c = Canvas(16, 16)
    h = c.m_line([(2, 14), (11, 5)], 2)
    c.fill(h, WOOD[3]); c.fill(h & (c.xx + c.yy < 16), WOOD[4])
    c.outline(h, OUT)
    head = c.m_poly([(8, 4), (11, 1), (15, 5), (14, 9), (12, 7)])
    c.fill(head, STEEL[3]); c.fill(head & (c.xx + c.yy > 16), STEEL[2]); c.fill(head & (c.xx - c.yy > 9), STEEL[5])
    c.outline(head, OUT)
    return c


def skill_pick():
    c = Canvas(16, 16)
    h = c.m_line([(2, 14), (10, 6)], 2)
    c.fill(h, WOOD[3]); c.fill(h & (c.xx + c.yy < 16), WOOD[4])
    c.outline(h, OUT)
    head = c.m_line([(3, 3), (7, 2), (11, 3), (13, 6), (14, 10)], 2)
    c.fill(head, STEEL[3]); c.fill(head & (c.yy <= 2), STEEL[5]); c.fill(head & (c.xx >= 13), STEEL[2])
    c.outline(head, OUT)
    return c


def skill_fish():
    c = Canvas(16, 16)
    rod = c.m_line([(1, 15), (11, 1)], 1)
    c.fill(rod, WOOD[3]); c.fill(c.m_line([(1, 15), (3, 12)], 1), '#2e1c12')
    c.outline(rod, OUT)
    line = c.m_line([(11, 1), (13, 4), (13, 8)])
    c.fill(line, '#e6e2da')
    fish = c.m_ellipse(11.5, 11, 3.2, 2) | c.m_poly([(14, 11), (16, 9), (16, 13)])
    c.fill(fish, '#7aa0c0'); c.fill(fish & (c.yy <= 10), '#a8cce0'); c.fill(fish & (c.yy >= 12), '#4a6a8a')
    c.px(10, 10, '#120c14')
    c.outline(fish, OUT)
    return c


TREE_SET = [(f'{n}_tree', (lambda n=n: tree(n)), f'{n.capitalize()}') for n in TREES]
SKILL_SET = [('skill_woodcutting', skill_axe, 'Woodcutting', '🪓'), ('skill_mining', skill_pick, 'Mining', '⛏️'), ('skill_fishing', skill_fish, 'Fishing', '🎣')]

if __name__ == '__main__':
    os.makedirs(OUTDIR, exist_ok=True)
    from PIL import Image
    S = 5
    sheet = Image.new('RGB', (5 * (32 * S + 12) + 12, 32 * S + 24 + 16 * 8 + 24), (58, 42, 28))
    for i, (n, fn, _) in enumerate(TREE_SET):
        c = fn(); c.save(f'{OUTDIR}/{n}_1x.png', 1); c.save(f'{OUTDIR}/{n}.png', 8)
        im = c.image(S); sheet.paste(im, (12 + i * (32 * S + 12), 12), im)
    par = Image.new('RGB', (3 * 150, 150), (241, 228, 195))
    for i, (n, fn, _, _) in enumerate(SKILL_SET):
        c = fn(); c.save(f'{OUTDIR}/{n}_1x.png', 1); c.save(f'{OUTDIR}/{n}.png', 8)
        im = c.image(8); sheet.paste(im, (12 + i * (32 * S + 12) + 16, 32 * S + 24), im)
        par.paste(im, (11 + i * 150, 11), im)
    sheet.save(f'{OUTDIR}/_sheet.png'); par.save(f'{OUTDIR}/_skills_parchment.png')
    print('ok')
