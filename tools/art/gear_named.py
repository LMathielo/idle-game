"""Starter / named gear and gathering tools, 32x32 item icons. Same rules as equipment.py.
Weapons and tools lie on the same 45 deg diagonal (grip bottom-left, business end top-right)."""
import sys, os
import numpy as np
from pix import Canvas, ramp, hx, mix
from elements import OUT, OUT_LIT
from equipment import LEATHER, TIERS, frame

OUTDIR = sys.argv[1] if len(sys.argv) > 1 else 'out/gear'
STEEL = ramp('#1e2430', '#36404e', '#5a6676', '#8a96a6', '#bcc6d2', '#eef4fa')
IRON = TIERS['iron']['metal']
RUST = ['#5a2a14', '#8a4422', '#b0602e']
OAK = TIERS['stone']['wood']
DARKWOOD = ramp('#1e120e', '#3a2418', '#5a3a26', '#7a5236', '#9a6a44')
HARDWOOD = ramp('#3a2414', '#5e3a1e', '#8a5a2e', '#b07e44', '#d0a464')


def blade_sword(c, metal, L, w0, *, leaf=False, rust=False, guard=None, guard_w=4.5, grip=OAK, wrap=LEATHER, pommel=None, fuller=True, seed=1):
    u, v = frame(c)
    taper = np.clip((L - u) / 6, 0, 1)
    bulge = 1 + (0.18 * np.sin(np.clip((u - 8) / (L - 8), 0, 1) * np.pi) if leaf else 0)
    hw = w0 * bulge * np.where(u < L - 6, 1, taper ** .8)
    bm = (u > 7) & (u < L) & (np.abs(v) < hw)
    c.fill(bm, metal[2]); c.fill(bm & (v < -.3), metal[3]); c.fill(bm & (v < -hw + 1), metal[4]); c.fill(bm & (v > hw - 1.2), metal[1])
    if fuller:
        c.fill(bm & (np.abs(v) < .6) & (u > 9) & (u < L - 5), metal[1])
    if len(metal) > 5:
        c.fill(bm & (v < -hw + 1) & (u > 10) & (u < L - 3), metal[5])
    if rust:
        rng = np.random.default_rng(seed)
        ys, xs = np.nonzero(bm)
        for i in rng.choice(len(xs), len(xs) // 9, replace=False):
            c.px(xs[i], ys[i], RUST[int(rng.integers(3))])
        c.fill(bm & (v > hw - 1.2), RUST[0])
    g = guard or metal
    gm = (np.abs(u - 6.5) < 1.2) & (np.abs(v) < guard_w)
    c.fill(gm, g[2]); c.fill(gm & (v < -1), g[3]); c.fill(gm & (v > 1.5), g[1])
    grm = (u > 1) & (u <= 6) & (np.abs(v) < 1.3)
    c.fill(grm, grip[2]); c.fill(grm & (v < 0), grip[3]); c.fill(grm & (v > .6), grip[1])
    if wrap is not None:
        wr = grm & ((np.floor(u * 1.3) % 2) == 0)
        c.fill(wr, wrap[1]); c.fill(wr & (v < 0), wrap[2])
    p = pommel or g
    pm = (u + .3) ** 2 + v ** 2 < 4.0
    c.fill(pm, p[2]); c.fill(pm & (v < 0) & (u < 0), p[3]); c.fill(pm & (v > .5), p[1])
    m = bm | gm | grm | pm
    c.outline(m, OUT_LIT, OUT)
    return c


def rusty_gladius():
    c = Canvas(32, 32)
    rust_blade = ramp('#2e2a2e', '#4e4a50', '#76727a', '#a09ca2', '#c8c4c4')
    return blade_sword(c, rust_blade, 27, 2.7, leaf=True, rust=True, guard=ramp('#3a2418', '#5e3a24', '#82552f', '#a6744a'),
                       guard_w=3.5, grip=OAK, wrap=None, pommel=ramp('#3a2418', '#5e3a24', '#82552f', '#a6744a'), fuller=False)


def steel_sword():
    c = Canvas(32, 32)
    return blade_sword(c, STEEL, 33, 2.6, guard=STEEL, guard_w=5.5, grip=DARKWOOD, wrap=ramp('#101418', '#22303e', '#36506a'),
                       pommel=STEEL)


def tool(c, metal, kind, wood, collar=None, lashing=False, seed=1):
    u, v = frame(c, 5.0, 28.0)
    L = 27
    h = (u > 0) & (u < L + 1) & (np.abs(v) < 1.2)
    c.fill(h, wood[2]); c.fill(h & (v < 0), wood[3]); c.fill(h & (v > .5), wood[1])
    c.fill(h & (u < 5) & (np.floor(u * 1.3) % 2 == 0), LEATHER[2])
    c.outline(h, OUT_LIT, OUT)
    uc = L - 3
    if kind == 'axe':
        t_ = np.clip(-(v + 1.0) / 9.0, 0, 1)
        hw = 1.7 + 4.2 * t_ ** 2.2
        edge = -10.0 - 1.6 * (1 - np.clip(np.abs(u - uc) / 5.9, 0, 1) ** 2)
        hm = (v < 2.2) & (v > edge) & (np.abs(u - uc) < hw)
        bit = hm & (v < edge + 1.6)
    else:
        bend = uc - 0.055 * v ** 2
        hm = (np.abs(v) < 11.5) & (np.abs(u - bend) < 1.7 - np.abs(v) * .07)
        bit = hm & (np.abs(v) > 9.5)
    c.fill(hm, metal[2]); c.fill(hm & (u > uc + .3 - (0.055 * v ** 2 if kind == 'pick' else 0)), metal[3])
    c.fill(hm & (u < uc - 1.2 - (0.055 * v ** 2 if kind == 'pick' else 0)), metal[1])
    c.fill(bit, metal[4])
    if len(metal) > 5:
        c.fill(bit & (u > uc), metal[5])
    if collar is not None:
        cm = (np.abs(u - (uc - 3)) < .8) & (np.abs(v) < 1.8)
        c.fill(cm, collar[3]); hm = hm | cm
    if lashing:
        lm = (np.abs(u - (uc - 2.5)) < 1.6) & (np.abs(v) < 1.9) & ~hm
        c.fill(lm, LEATHER[2]); c.fill(lm & (np.floor(u) % 2 == 0), LEATHER[3]); hm = hm | lm
    c.outline(hm, OUT_LIT, OUT)
    return c


def wooden_axe():
    return tool(Canvas(32, 32), HARDWOOD, 'axe', OAK, lashing=True)


def iron_axe():
    return tool(Canvas(32, 32), IRON, 'axe', TIERS['iron']['wood'])


def steel_axe():
    return tool(Canvas(32, 32), STEEL, 'axe', DARKWOOD, collar=TIERS['iron']['trim'])


def wooden_pick():
    return tool(Canvas(32, 32), HARDWOOD, 'pick', OAK, lashing=True)


def iron_pick():
    return tool(Canvas(32, 32), IRON, 'pick', TIERS['iron']['wood'])


def steel_pick():
    return tool(Canvas(32, 32), STEEL, 'pick', DARKWOOD, collar=TIERS['iron']['trim'])


def linen_tunic():
    c = Canvas(32, 32)
    lin = ramp('#6a5a48', '#9a8a70', '#c4b494', '#e0d4b4', '#f2ead2')
    body = c.m_poly([(10, 6), (13, 5), (19, 5), (22, 6), (23, 27), (9, 27)])
    sleeves = c.m_poly([(10, 6), (4, 10), (3, 15), (8, 16), (10, 12)]) | c.m_poly([(22, 6), (28, 10), (29, 15), (24, 16), (22, 12)])
    neck = c.m_poly([(13, 5), (19, 5), (16, 11)])
    m = (body | sleeves) & ~neck
    c.shade(m, lin, soft=3, dither=False)
    # folds
    for pts in ([(12, 13), (11, 26)], [(20, 14), (21, 26)], [(16, 18), (16, 26)]):
        c.fill(c.m_line(pts) & m, lin[1])
    # hem + cuffs
    c.fill(m & (c.yy >= 26), lin[1]); c.fill(sleeves & ((c.xx <= 4) | (c.xx >= 28)), lin[1])
    # lacing at the neck
    for y in (7, 9):
        c.px(15, y, '#5e3a24'); c.px(17, y, '#5e3a24')
    c.px(16, 8, '#5e3a24'); c.px(16, 10, '#5e3a24')
    # rope belt
    belt = c.m_rect(9, 18, 23, 19) & m
    c.fill(belt, '#a7843d'); c.fill(belt & (np.mod(c.xx, 2) == 0), '#c9a858')
    c.fill(c.m_line([(19, 20), (20, 24)]), hx('#a7843d')); c.px(20, 25, '#c9a858')
    # a patch
    pt = c.m_rect(11, 21, 14, 23)
    c.fill(pt, '#a89070'); c.px(11, 21, '#6a5a48'); c.px(14, 23, '#6a5a48')
    c.outline(m, OUT_LIT, OUT)
    return c


def worn_sandals():
    c = Canvas(32, 32)
    sole = ramp('#5e3a24', '#82552f', '#a6744a', '#c9a26a', '#e0c08a')
    strap = ramp('#1e120e', '#3a2418', '#5e3a24')

    def sandal(ox, oy, dark):
        s = c.m_ellipse(14 + ox, 9 + oy, 5.6, 5.8) | c.m_ellipse(14 + ox, 19 + oy, 4.4, 6.8) | c.m_rect(9 + ox, 9 + oy, 19 + ox, 19 + oy) & c.m_ellipse(14 + ox, 14 + oy, 5.4, 10.5)
        r = [mix(x, hx('#000000'), .3) for x in sole] if dark else sole
        c.fill(s, r[3]); c.fill(s & (c.xx >= 15 + ox), r[2]); c.fill(s & (c.xx <= 11 + ox), r[4])
        c.fill(s & (c.yy >= 23 + oy) & (c.xx < 14 + ox), r[2])   # worn heel
        c.outline(s, OUT)
        sc = strap if not dark else [mix(x, hx('#000000'), .3) for x in strap]
        toe = c.m_line([(9 + ox, 8 + oy), (14 + ox, 10 + oy), (19 + ox, 8 + oy)], 2) & s
        cross = (c.m_line([(9 + ox, 13 + oy), (19 + ox, 18 + oy)], 2) | c.m_line([(19 + ox, 13 + oy), (9 + ox, 18 + oy)], 2)) & s
        heel = c.m_line([(11 + ox, 22 + oy), (17 + ox, 22 + oy)], 2) & s
        c.fill(toe | cross | heel, sc[1]); c.fill((toe | cross | heel) & (c.xx < 14 + ox), sc[2])
        # loose ankle ties
        tie = c.m_line([(17 + ox, 22 + oy), (20 + ox, 25 + oy), (22 + ox, 25 + oy)], 1)
        c.fill(tie, sc[1])
        return s
    sandal(8, -2, True)
    sandal(-1, 3, False)
    return c


SET = [('rusty_gladius', rusty_gladius, 'Rusty Gladius', '🗡️'), ('steel_sword', steel_sword, 'Steel Sword', '🗡️'),
       ('linen_tunic', linen_tunic, 'Linen Tunic', '🥋'), ('worn_sandals', worn_sandals, 'Worn Sandals', '👢'),
       ('wooden_axe', wooden_axe, 'Wooden Axe', '🪓'), ('iron_axe', iron_axe, 'Iron Axe', '🪓'), ('steel_axe', steel_axe, 'Steel Axe', '🪓'),
       ('wooden_pickaxe', wooden_pick, 'Wooden Pickaxe', '⛏️'), ('iron_pickaxe', iron_pick, 'Iron Pickaxe', '⛏️'),
       ('steel_pickaxe', steel_pick, 'Steel Pickaxe', '⛏️')]

if __name__ == '__main__':
    os.makedirs(OUTDIR, exist_ok=True)
    from PIL import Image
    S = 5
    sheet = Image.new('RGB', (5 * (32 * S + 12) + 12, 2 * (32 * S + 12) + 12), (58, 42, 28))
    for i, (n, fn, _, _) in enumerate(SET):
        c = fn()
        c.save(f'{OUTDIR}/{n}_1x.png', 1); c.save(f'{OUTDIR}/{n}.png', 4)
        im = c.image(S)
        sheet.paste(im, (12 + (i % 5) * (32 * S + 12), 12 + (i // 5) * (32 * S + 12)), im)
    sheet.save(f'{OUTDIR}/_sheet.png')
    print('ok')
