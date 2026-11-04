"""Village A v2 — daytime. Full world map 360x560 base px (the app shows it at 4x)."""
import sys, os, json
import numpy as np
from scipy import ndimage
from pix import hx, mix, BAYER, ramp
from elements import M, OUT, OUT_LIT
from kit import Town, ROOF, WALL, SKIN, BEAM

W, H = 360, 560
OUTDIR = sys.argv[1] if len(sys.argv) > 1 else 'out'

GRASS = ramp('#2f5530', '#3f6e38', '#507f40', '#5f9048', '#7aa858', '#98c06a')
LEAF = ramp('#1e3a26', '#2b5230', '#3d6e38', '#548a42', '#72a650', '#98c264')
PINE = ramp('#14281f', '#1d3a2a', '#2a5034', '#3a6840', '#50824c')
ROCK = ramp('#3b3f52', '#565a6e', '#767888', '#9a98a2', '#bdb8b4', '#ddd6cc')
PATH = ramp('#6a5038', '#8c6c4a', '#ad8c62', '#c8a97a', '#dcc296')
WATER = ramp('#1f4f7a', '#2a6492', '#3a7eaa', '#5a9cc2', '#8cc4dc', '#d4ecf2')
GLOW = '#9a7ad8'
CLIFF_BOT = 238


# =============================================================== sky, mountains, cliffs, ground
def cumulus(sc, cx, cy, w, seed):
    rng = np.random.default_rng(seed)
    m = sc.empty()
    n = max(3, w // 6)
    for i in range(n):
        t = i / (n - 1)
        x = cx - w / 2 + t * w
        r = (w / 5) * (0.7 + 0.6 * np.sin(t * np.pi)) * (0.85 + rng.random() * .3)
        m |= sc.m_ellipse(x, cy - r * .5, r, r * .8)
    m &= sc.yy <= cy + 1
    sc.fill(m, '#f4f7fa')
    sc.fill(m & (sc.yy >= cy - 2), '#d8e3ee')
    sc.fill(m & (sc.yy >= cy), '#bccbdd')
    sc.fill(m & (sc.xx < cx - w / 5) & ~np.roll(m, 1, 0), '#ffffff')


def sky_and_mountains(sc):
    sky = sc.m_rect(0, 0, W - 1, 240)
    sc.vgrad(sky, ['#5d9bd0', '#6fa9d8', '#84b8df', '#9cc8e5', '#b7d7ea', '#d1e5ec', '#e6efe8'], 0, 160)
    sc.glow(34, 26, 60, '#fff2c8', .3, steps=4)
    sc.fill(sc.m_ellipse(34, 26, 7, 7), '#fff8e0'); sc.fill(sc.m_ellipse(33, 25, 5, 5), '#ffffff')
    for cx, cy, w, s in ((96, 44, 46, 1), (254, 30, 60, 2), (334, 66, 34, 3), (170, 76, 28, 4), (16, 92, 26, 5)):
        cumulus(sc, cx, cy, w, s)
    for x, y in ((124, 36), (130, 33), (300, 50), (142, 58)):
        sc.px(x, y, '#3b4a62'); sc.px(x + 1, y - 1, '#3b4a62'); sc.px(x - 1, y - 1, '#3b4a62')
    for cx, py, hw, s in ((40, 100, 70, 11), (180, 92, 80, 12), (320, 104, 70, 13)):
        sc.mountain(cx, py, hw, 180, rmp=[hx('#6a7fa2'), hx('#7d92b2'), hx('#94a8c4'), hx('#acbdd4')], seed=s,
                    snow_col=['#f2f6fa', '#d4e0ee', '#bccce0'])
    sc.tint(sc.m_rect(0, 80, W - 1, 185) & sc.alpha, '#c8dcea', .25)
    for cx, py, hw, s in ((56, 110, 90, 21), (312, 102, 94, 22), (188, 86, 100, 23)):
        sc.mountain(cx, py, hw, 222, rmp=ROCK, seed=s, snow_col=['#f6f8fa', '#d2dcea', '#aebcd2'])
    rng = np.random.default_rng(31)
    for _ in range(40):
        x = int(rng.integers(0, W)); y = int(rng.integers(176, 206))
        sc.pine(x, y, int(rng.integers(6, 10)), [hx('#24402f'), hx('#2e5038'), hx('#3a6040'), hx('#4a7048'), hx('#5a8050')])
    sc.fog(186, 214, '#c4d6dc', .22, seed=3)


def cliff_band(sc):
    """A rock wall at the foot of the mountains; the dungeon gate is cut into its tall spur."""
    xs = np.arange(W).astype(float)
    rng = np.random.default_rng(4)
    top = 206 + 3 * np.sin(xs * .07) + 2 * np.sin(xs * .19 + 1)
    top -= 46 * np.exp(-((xs - 206) / 34) ** 2)
    top -= 12 * np.exp(-((xs - 138) / 18) ** 2)
    top = top + np.repeat(rng.integers(-2, 3, W // 4 + 1), 4)[:W]
    bot = CLIFF_BOT + 2 * np.sin(xs * .05 + 2) + 1 * np.sin(xs * .3)
    m = (sc.yy >= top[None, :].astype(int)) & (sc.yy <= bot[None, :].astype(int))
    # rock slabs: a stretched Voronoi of random seeds, each slab lit on its upper-left, crevices between
    ys_, xs_ = np.nonzero(m)
    n = 150
    sx = rng.uniform(-4, W + 4, n); sy = rng.uniform(150, CLIFF_BOT + 6, n)
    d = ((xs_[:, None] - sx[None, :]) ** 2) * 1.0 + ((ys_[:, None] - sy[None, :]) * .45) ** 2
    cell = np.full(m.shape, -1); cell[ys_, xs_] = np.argmin(d, axis=1)
    val = rng.uniform(.25, .75, n)
    base = np.zeros(m.shape); base[ys_, xs_] = val[cell[ys_, xs_]]
    # within-cell gradient: left of the seed lighter
    gx = np.zeros(m.shape); gx[ys_, xs_] = (sx[cell[ys_, xs_]] - xs_) * .03
    v = np.clip(base + gx, 0, 1)
    b = BAYER[sc.yy % 4, sc.xx % 4]
    lvl = np.floor(v * 4 + (b - .5) * .6).astype(int).clip(0, 3)
    for k, c in enumerate([ROCK[1], ROCK[2], ROCK[3], ROCK[4]]):
        sc.fill(m & (lvl == k), c)
    right = np.roll(cell, -1, 1); down = np.roll(cell, -1, 0); left = np.roll(cell, 1, 1); up = np.roll(cell, 1, 0)
    crev = m & (((right != cell) & (right >= 0)) | ((down != cell) & (down >= 0)))
    hil = m & ~crev & (((left != cell) & (left >= 0)) | ((up != cell) & (up >= 0)))
    sc.fill(hil, ROCK[4]); sc.fill(crev, ROCK[0])
    sc.fill(m & (sc.yy >= (bot[None, :] - 3).astype(int)), ROCK[1])
    lip = m & ~np.roll(m, 1, 0)
    sc.fill(lip, GRASS[4]); sc.fill(np.roll(lip, 1, 0) & m & (np.mod(sc.xx, 3) != 0), GRASS[3])
    sc.outline(m, OUT_LIT, OUT)
    for _ in range(70):
        x = int(rng.integers(0, W)); y = int(bot[x]) + int(rng.integers(1, 4))
        sc.px(x, y, ROCK[3] if rng.random() < .5 else ROCK[2])
    for _ in range(26):
        bx = int(rng.integers(0, W)); r_ = float(rng.uniform(2, 4.5))
        bm = sc.m_ellipse(bx, int(bot[bx]) + 1, r_ + 1, r_ * .8) & (sc.yy <= int(bot[bx]) + 2)
        sc.shade(bm, ROCK[:5], soft=1.2, outline=OUT)
        m |= bm
    for _ in range(14):
        x = int(rng.integers(0, W)); y = int(top[x]) + 1
        for k in range(int(rng.integers(4, 12))):
            if m[min(y + k, H - 1), x]:
                sc.px(x + (k // 4) % 2, y + k, GRASS[2] if k % 3 else GRASS[3])
    return m


def ground(sc):
    g = sc.m_rect(0, 214, W - 1, H - 1)
    sc.fill(g, GRASS[3])
    rng = np.random.default_rng(3)
    nz = ndimage.gaussian_filter(rng.random((H, W)), 7)
    nz = (nz - nz[g].mean()) / nz[g].std()
    b = BAYER[sc.yy % 4, sc.xx % 4]
    sc.fill(g & (nz > .8), GRASS[2])
    sc.fill(g & (nz > .5) & (nz <= .8) & (b < .5), GRASS[2])
    sc.fill(g & (nz < -.8), GRASS[4])
    sc.fill(g & (nz < -.5) & (nz >= -.8) & (b < .5), GRASS[4])
    for _ in range(1400):
        x, y = int(rng.integers(0, W)), int(rng.integers(216, H))
        k = 4 if rng.random() < .6 else 1
        sc.px(x, y, GRASS[k]); sc.px(x - 1, y + 1, GRASS[k]); sc.px(x + 1, y + 1, GRASS[k])
    for _ in range(260):
        x, y = int(rng.integers(0, W)), int(rng.integers(240, H))
        sc.px(x, y, ['#f5efe2', '#f2d35b', '#e0566a', '#b07ae0', '#f5efe2'][int(rng.integers(5))])
    sc.groundm = g.copy()


def smoke(sc):
    for x, y in sc.smoke:
        for k in range(4):
            xx = x + k + int(np.sin(k * 1.3) * 1.5)
            yy = y - k * 3
            r = 1 + k * .45
            m = sc.m_ellipse(xx, yy, r, r * .8)
            part = m & (sc.yy > yy) & (sc.xx > xx)
            if sc.sprite_mode:
                sc.tint(m & sc.alpha, '#f4f6fa', .55 - k * .1); sc.over(m & ~sc.alpha, '#f4f6fa', .55 - k * .1)
                sc.tint(part & sc.alpha, '#a8b0c0', .25); sc.over(part & ~sc.alpha, '#a8b0c0', .25)
            else:
                sc.tint(m, '#f4f6fa', .55 - k * .1)
                sc.tint(part, '#a8b0c0', .25)


# =============================================================== places
def dungeon_gate(sc):
    """Ancient gate carved into the cliff spur: pillars, rune lintel, violet glow, guardian statues, steps."""
    cx, by = 206, 238
    rec = sc.m_rect(cx - 20, by - 50, cx + 20, by)
    sc.fill(rec, ROCK[1]); sc.fill(rec & (sc.xx >= cx + 17), ROCK[0]); sc.fill(rec & (sc.yy <= by - 48), ROCK[0])
    face = sc.m_rect(cx - 17, by - 44, cx + 17, by)
    sc.fill(face, '#8a8590')
    for yy in range(by - 44, by + 1, 4):
        sc.fill(face & (sc.yy == yy), '#6a6672')
        off = 0 if (yy // 4) % 2 else 3
        for xx in range(cx - 17 + off, cx + 18, 6):
            sc.fill(sc.m_rect(xx, yy, xx, yy + 3) & face, '#6a6672')
    sc.fill(face & (sc.xx <= cx - 15), '#b3aeaa'); sc.fill(face & (sc.xx >= cx + 15), '#5d5a64')
    lin = sc.m_rect(cx - 19, by - 49, cx + 19, by - 44)
    sc.fill(lin, '#a39ea2'); sc.fill(lin & (sc.yy == by - 44), '#5d5a64'); sc.fill(lin & (sc.yy == by - 49), '#d0cac4')
    for k in range(-16, 17, 4):
        sc.px(cx + k, by - 47, GLOW); sc.px(cx + k + 1, by - 46, GLOW); sc.px(cx + k + 1, by - 48, '#c8a4ff')
    sc.outline(lin, OUT)
    sk = sc.m_ellipse(cx, by - 53, 3, 2.6) | sc.m_rect(cx - 2, by - 51, cx + 2, by - 50)
    sc.fill(sk, '#d9d0bc'); sc.fill(sk & (sc.xx > cx + 1), '#b3aa96')
    sc.px(cx - 1, by - 53, '#2a1c26'); sc.px(cx + 1, by - 53, '#2a1c26'); sc.px(cx, by - 51, '#8a8070')
    sc.outline(sk, OUT)
    for px_ in (cx - 15, cx + 11):
        p = sc.m_rect(px_, by - 43, px_ + 4, by - 1)
        sc.fill(p, '#c4bfb6'); sc.fill(p & (sc.xx == px_ + 4), '#8a8590'); sc.fill(p & (sc.xx == px_), '#e0dad2')
        sc.fill(p & (np.mod(sc.xx - px_, 2) == 1) & (sc.xx < px_ + 4), '#b3aeaa')
        cap = sc.m_rect(px_ - 1, by - 43, px_ + 5, by - 41); base = sc.m_rect(px_ - 1, by - 3, px_ + 5, by - 1)
        sc.fill(cap | base, '#d0cac4'); sc.fill((cap | base) & (sc.xx == px_ + 5), '#8a8590')
        sc.outline(p | cap | base, OUT)
    op = sc.m_ellipse(cx, by - 24, 8, 11) | sc.m_rect(cx - 8, by - 24, cx + 8, by - 1)
    ring = sc.m_ellipse(cx, by - 24, 10, 13) & ~op & (sc.yy <= by - 22)
    sc.fill(ring, '#b3aeaa')
    keys = ring & (np.mod(np.floor(np.arctan2(sc.yy - (by - 24), sc.xx - cx) * 4), 2) == 0)
    sc.fill(keys, '#8f8b8f')
    sc.vgrad(op, ['#160e20', '#0c0812', '#07050a'], by - 36, by)
    sc.outline(op, '#2a1c26')
    sc.glow(cx, by - 6, 11, '#7a4ad8', .35, steps=3, mask=op)
    for k in range(4):
        sc.fill(sc.m_rect(cx - 6 + k, by - 4 - k * 2, cx + 6 - k, by - 4 - k * 2) & op, '#2a2238')
    sc.px(cx - 2, by - 16, '#c8a4ff'); sc.px(cx + 2, by - 16, '#c8a4ff')
    for k in range(4):
        st = sc.m_rect(cx - 11 - k * 2, by + k * 2, cx + 11 + k * 2, by + k * 2 + 1)
        sc.fill(st, '#b3aeaa'); sc.fill(st & (sc.yy == by + k * 2 + 1), '#7b7884'); sc.fill(st & (sc.xx <= cx - 9 - k * 2), '#d0cac4')
        sc.outline(st, OUT)
    for sx, flip in ((cx - 29, 1), (cx + 24, -1)):
        ped = sc.m_rect(sx, by - 3, sx + 5, by + 3)
        sc.fill(ped, '#8f8b8f'); sc.fill(ped & (sc.xx == sx), '#b3aeaa'); sc.fill(ped & (sc.yy == by - 3), '#c4bfb6')
        body = sc.m_poly([(sx, by - 3), (sx + 5, by - 3), (sx + 4, by - 15), (sx + 1, by - 15)]) | sc.m_ellipse(sx + 2.5, by - 17, 2.5, 2.5)
        sc.shade(body, ['#4f4c5a', '#6a6672', '#8f8b8f', '#b3aeaa', '#c4bfb6'], soft=1)
        sc.fill(sc.m_rect(sx + 1, by - 17, sx + 3, by - 16), '#3c3a47')
        sc.px(sx + 2, by - 16, GLOW)
        stx = sx + (5 if flip > 0 else 0)
        sc.fill(sc.m_line([(stx, by - 20), (stx, by + 1)]), '#5d5a64'); sc.px(stx, by - 21, '#c8a4ff')
        sc.glow(stx, by - 21, 4, GLOW, .3, steps=2)
        sc.px(sx + 1, by - 3, GRASS[3]); sc.px(sx + 4, by - 2, GRASS[3]); sc.px(sx + 1, by - 12, GRASS[2])
        sc.outline(ped | body, OUT)
    for bx in (cx - 10, cx + 8):
        bm = sc.m_poly([(bx, by - 41), (bx + 3, by - 41), (bx + 3, by - 30), (bx + 1.5, by - 32), (bx, by - 29)])
        sc.fill(bm, '#4a2a6a'); sc.fill(bm & (sc.xx == bx), '#6a4a8a'); sc.px(bx + 1, by - 37, '#c9a858'); sc.px(bx + 2, by - 36, '#c9a858')
        sc.outline(bm, OUT)
    for x_ in (cx - 12, cx + 14):
        sc.px(x_, by - 50, '#1a1620'); sc.px(x_ + 1, by - 50, '#1a1620'); sc.px(x_ + 1, by - 51, '#1a1620'); sc.px(x_ + 2, by - 51, '#e0b84a')
    sc.anchors['dungeon'] = (cx, by - 66)


def mine(sc):
    """Timber-framed shaft into the cliff, ore cart on rails, ore heap, miner, tool shed, lantern."""
    x, y = 136, 238
    hole = sc.m_rect(x - 6, y - 15, x + 7, y - 1)
    sc.vgrad(hole, ['#0c0810', '#1a1218'], y - 15, y)
    wd = M['wood']
    for p in (x - 8, x + 8):
        pm = sc.m_rect(p, y - 16, p + 1, y - 1)
        sc.fill(pm, wd[3]); sc.fill(pm & (sc.xx == p + 1), wd[2]); sc.outline(pm, OUT)
    beam = sc.m_rect(x - 10, y - 20, x + 11, y - 17)
    sc.fill(beam, wd[3]); sc.fill(beam & (sc.yy == y - 17), wd[1]); sc.fill(beam & (sc.yy == y - 20), wd[4])
    for k in range(x - 9, x + 11, 5):
        sc.px(k, y - 19, wd[1])
    sc.outline(beam, OUT)
    sc.fill(sc.m_line([(x - 6, y - 16), (x - 3, y - 13)]), wd[2]); sc.fill(sc.m_line([(x + 7, y - 16), (x + 4, y - 13)]), wd[2])
    nb = sc.m_rect(x - 4, y - 26, x + 5, y - 21)
    sc.fill(nb, wd[2]); sc.fill(nb & (sc.yy == y - 26), wd[4]); sc.outline(nb, OUT)
    for k in range(4):
        sc.px(x - 1 + k, y - 25 + k, '#2a1c26'); sc.px(x + 2 - k, y - 25 + k, '#2a1c26')
    sc.px(x + 1, y - 16, '#2b2430'); sc.fill(sc.m_rect(x, y - 15, x + 2, y - 13), '#ffd36b'); sc.px(x + 1, y - 14, '#fff2c0')
    sc.glow(x + 1, y - 14, 7, '#ffb04a', .3, steps=2, mask=hole)
    for k in range(14):
        yy = y + k
        l, r = x - 4 - k // 2, x + 5 + k // 2
        if k % 2 == 0:
            sc.fill(sc.m_rect(l, yy, r, yy), wd[1])
        sc.px(l, yy, '#7b7884'); sc.px(r, yy, '#7b7884')
    cxp, cyp = x + 2, y + 10
    cart = sc.m_poly([(cxp - 5, cyp - 6), (cxp + 6, cyp - 6), (cxp + 5, cyp - 1), (cxp - 4, cyp - 1)])
    sc.fill(cart, '#5d5a64'); sc.fill(cart & (sc.yy == cyp - 6), '#8f8b8f'); sc.fill(cart & (sc.xx >= cxp + 4), '#45424e')
    sc.fill(cart & (sc.yy == cyp - 3), '#45424e')
    for i, c in enumerate(['#8a8f9e', '#e0b84a', '#6a6f7e', '#efc65a', '#a19d9f', '#7fc8e8', '#8a8f9e', '#e0b84a', '#6a6f7e']):
        sc.px(cxp - 4 + i, cyp - 7, c)
        if i % 2:
            sc.px(cxp - 4 + i, cyp - 8, '#6a6f7e')
    sc.outline(cart, OUT)
    sc.px(cxp - 3, cyp, '#1a1a22'); sc.px(cxp + 4, cyp, '#1a1a22')
    heap = sc.m_ellipse(x - 18, y + 6, 6, 4) & (sc.yy <= y + 6)
    sc.shade(heap, ['#3c3a47', '#585663', '#7b7884', '#a19d9f'], soft=1)
    for ox, oy in ((-21, 4), (-17, 3), (-14, 5), (-19, 6)):
        sc.px(x + ox, y + oy, '#e0b84a')
    sc.outline(heap, OUT)
    tsx, tsy = x + 18, y + 8
    ts = sc.box(tsx, tsy, 9, 7, 5, 'planks')
    tr = sc.roof_side(tsx, tsy, 9, 7, 5, 4, 'shingle', oh=1, mat_gable='planks')
    sc.fill(sc.m_rect(tsx + 3, tsy - 5, tsx + 5, tsy - 1), '#2e1c12')
    sc.outline(ts | tr, OUT_LIT, OUT)
    sc.cast(ts | tr, tsy)
    for k, c in ((0, '#a19d9f'), (3, '#c4bfb6')):
        sc.fill(sc.m_line([(tsx - 2 - k, tsy - 1), (tsx - 1 - k, tsy - 7)]), '#865630'); sc.px(tsx - 1 - k, tsy - 8, c); sc.px(tsx - k, tsy - 8, c)

    def pick(ax, yy, mm):
        sc.fill(sc.m_line([(ax, yy - 6), (ax + 2, yy - 11)]), '#865630')
        sc.fill(sc.m_line([(ax, yy - 12), (ax + 3, yy - 11), (ax + 5, yy - 9)]), '#a19d9f')
    sc.person(x - 14, y + 14, '#6a6f7e', hair='#2a1c16', legs='#3f2719', tool=pick, raise_arm=True, hat='#c9a858')
    sc.anchors['mine'] = (x - 12, y - 40)


def woodcutter(sc):
    """Log cabin with porch and antlers, woodshed, chopping block, sawhorse, woodcutter mid-swing."""
    x, y = 82, 304
    w, h, sd = 28, 13, 10
    m = sc.box(x, y, w, h, sd, 'logs', base_stone=2)
    sc.window(x + 4, y - 10, 4, 4, shutters='#3a6a40', box=['#f2d35b', '#e0566a'])
    sc.door(x + 16, y, 5, 8, col='#5a3820')
    for yy in range(y - 12, y - 1, 3):
        for cx_ in (x - 1, x + w):
            sc.px(cx_, yy + 1, '#e0b47a'); sc.px(cx_, yy + 2, '#a8723c')
    r = sc.roof_side(x, y, w, h, sd, 9, 'shingle', oh=2, mat_gable='logs')
    sc.chimney(x + 5, y - 20, 7, mat='stone')
    for k in range(0, w, 4):
        sc.px(x + k, y - h - 1, GRASS[4]); sc.px(x + k + 1, y - h - 1, GRASS[2])
    pr = sc.m_poly([(x + 12, y - 9), (x + 26, y - 9), (x + 27, y - 12), (x + 13, y - 12)])
    sc.fill(pr, ROOF['shingle'][3]); sc.fill(pr & (sc.yy == y - 9), ROOF['shingle'][1])
    for p in (x + 13, x + 25):
        sc.fill(sc.m_rect(p, y - 8, p, y - 1), M['wood'][1])
    sc.outline(pr, OUT)
    for p in ((x + 17, y - 14), (x + 21, y - 14), (x + 16, y - 15), (x + 22, y - 15), (x + 18, y - 13), (x + 19, y - 13), (x + 20, y - 13)):
        sc.px(*p, '#f2e6c8')
    sc.fill(sc.m_rect(x + 12, y, x + 26, y + 1), M['wood'][2]); sc.fill(sc.m_rect(x + 12, y + 1, x + 26, y + 1), M['wood'][1])
    sc.hanging_sign(x + w + 1, y - 11, ['o#..', 'oo#.', '..#.'])
    sc.outline(m | r, OUT_LIT, OUT)
    sc.cast(m | r, y)
    sx, sy = x - 18, y + 28
    for p in (sx, sx + 16):
        sc.fill(sc.m_rect(p, sy - 11, p, sy - 1), M['wood'][1])
    lean = sc.m_poly([(sx - 1, sy - 11), (sx + 17, sy - 11), (sx + 19, sy - 14), (sx + 1, sy - 14)])
    sc.fill(lean, ROOF['shingle'][3]); sc.fill(lean & (sc.yy == sy - 11), ROOF['shingle'][1]); sc.outline(lean, OUT)
    for row in range(4):
        for k in range(7 - row):
            cxl, cyl = sx + 2 + k * 2 + row, sy - 2 - row * 2
            sc.fill(sc.m_rect(cxl, cyl - 1, cxl + 1, cyl), '#c9975e')
            sc.px(cxl + 1, cyl, '#865630'); sc.px(cxl, cyl - 1, '#e0b47a')
    bx, by = x + 32, y + 12
    blk = sc.m_rect(bx, by - 3, bx + 3, by - 1); tp = sc.m_rect(bx, by - 4, bx + 3, by - 4)
    sc.fill(blk, '#865630'); sc.fill(tp, '#e0b47a'); sc.outline(blk | tp, OUT)
    for p in ((bx + 5, by - 1), (bx + 6, by - 1), (bx - 3, by), (bx - 2, by + 1)):
        sc.px(*p, '#e0b47a')

    def axe(ax, yy, mm):
        sc.fill(sc.m_line([(ax, yy - 7), (ax, yy - 12)]), '#865630')
        sc.fill(sc.m_rect(ax + 1, yy - 12, ax + 2, yy - 11), '#c4bfb6'); sc.px(ax + 2, yy - 10, '#a19d9f')
    sc.person(bx - 6, by + 1, '#7a3a2e', hair='#a0602a', legs='#3f3226', tool=axe, raise_arm=True)
    shx, shy = sx + 4, sy + 10
    for p in (shx, shx + 7):
        sc.fill(sc.m_line([(p - 1, shy), (p + 1, shy - 4)]), M['wood'][1]); sc.fill(sc.m_line([(p + 1, shy), (p - 1, shy - 4)]), M['wood'][1])
    lg = sc.m_rect(shx - 2, shy - 5, shx + 9, shy - 4)
    sc.fill(lg, '#8a6a4e'); sc.fill(lg & (sc.yy == shy - 5), '#ab8a68'); sc.px(shx + 9, shy - 5, '#e0b47a'); sc.px(shx + 9, shy - 4, '#c9975e')
    sc.outline(lg, OUT)
    trunk = sc.m_rect(x - 16, y + 9, x - 2, y + 11)
    sc.fill(trunk, '#6b4d3a'); sc.fill(trunk & (sc.yy == y + 9), '#8a6a4e'); sc.fill(sc.m_rect(x - 2, y + 9, x - 2, y + 11), '#e0b47a')
    sc.outline(trunk, OUT)
    for sx_, sy_ in ((x - 20, y - 2), (x + 34, y - 4), (x - 8, y + 20), (x + 44, y + 16)):
        st = sc.m_rect(sx_, sy_ - 2, sx_ + 2, sy_); tp = sc.m_rect(sx_, sy_ - 3, sx_ + 2, sy_ - 3)
        sc.fill(st, '#603b23'); sc.fill(tp, '#e0b47a'); sc.outline(st | tp, OUT)
    sc.anchors['woodcutting'] = (x + 18, y - 38)


def merchant(sc):
    """Trading house: stone shop floor, jettied plaster upper floor, display window, striped awning, goods, rug rack."""
    x, y = 226, 292
    w = 32
    low = sc.box(x, y, w, 12, 10, 'stone')
    up = sc.box(x - 1, y - 12, w + 2, 11, 10, 'plaster', frame=BEAM)
    sc.fill(sc.m_rect(x - 1, y - 12, x + w, y - 12), '#2e1c12')
    for k in range(x, x + w, 4):
        sc.px(k, y - 12, '#865630')

    def gwin(g):
        cx_ = x + w // 2
        c = sc.m_ellipse(cx_, y - 31, 2.5, 2.5)
        sc.fill(c, '#3f2719'); sc.fill(sc.m_ellipse(cx_, y - 31, 1.5, 1.5), '#2c3d52'); sc.px(cx_ - 1, y - 32, '#8fb8d8')
    r = sc.roof_front(x - 1, y - 12, w + 2, 11, 10, 15, 'red', oh=2, gable_detail=gwin)
    for wx in (x + 3, x + 14, x + w - 7):
        sc.window(wx, y - 21, 3, 4, shutters='#2c4886', box=['#e0566a', '#f2d35b', '#f5efe2'])
    sc.fill(sc.m_rect(x + 1, y - 11, x + 17, y - 2), '#3f2719')
    dw = sc.m_rect(x + 2, y - 10, x + 16, y - 3)
    sc.fill(dw, '#2c3d52')
    sc.fill(sc.m_rect(x + 2, y - 7, x + 16, y - 7), '#865630'); sc.fill(sc.m_rect(x + 2, y - 3, x + 16, y - 3), '#865630')
    goods = ['#e0566a', '#efc65a', '#4568ad', '#77a24f', '#c4bfb6', '#b07ae0', '#e08a3a']
    for i in range(15):
        sc.px(x + 2 + i, y - 4, goods[i % 7]); sc.px(x + 2 + i, y - 8, goods[(i + 3) % 7])
        if i % 3 == 0:
            sc.px(x + 2 + i, y - 5, goods[(i + 1) % 7]); sc.px(x + 2 + i, y - 9, goods[(i + 5) % 7])
    sc.px(x + 3, y - 10, '#8fb8d8'); sc.px(x + 4, y - 10, '#8fb8d8'); sc.px(x + 3, y - 9, '#5f86a8')
    sc.fill(sc.m_rect(x + 9, y - 10, x + 9, y - 3), '#3f2719')
    sc.door(x + 22, y, 5, 9, col='#2c4886', arch=True)
    aw = sc.m_poly([(x, y - 12), (x + 19, y - 12), (x + 21, y - 8), (x - 2, y - 8)])
    sel = np.mod((sc.xx - x) // 2, 2) == 0
    sc.fill(aw & sel, '#c44a3a'); sc.fill(aw & ~sel, '#f2e6c8')
    scal = sc.m_rect(x - 2, y - 7, x + 21, y - 7) & (np.mod(sc.xx - x, 2) == 0)
    sc.fill(scal & sel, '#c44a3a'); sc.fill(scal & ~sel, '#f2e6c8')
    sc.tint(aw & (sc.yy == y - 12), '#1a1218', .3)
    sc.outline(aw | scal, OUT)
    sc.hanging_sign(x + w + 1, y - 22, ['.**.', '*##*', '*##*', '.**.'])
    sc.outline(low | up | r, OUT_LIT, OUT)
    sc.cast(low | up | r, y)
    for bx_, by_, c in ((x - 5, y + 3, '#d9443a'), (x - 9, y + 3, '#efc65a'), (x - 7, y + 7, '#77a24f')):
        sc.barrel(bx_, by_, top=c)
    sc.crate(x + 34, y + 4); sc.crate(x + 38, y + 5); sc.crate(x + 35, y); sc.sack(x + 42, y + 6); sc.sack(x + 45, y + 7, '#b8a684')
    rk = sc.m_rect(x + 23, y + 3, x + 31, y + 3)
    sc.fill(rk, M['wood'][1])
    for i, c in enumerate(['#a8323a', '#2c4886', '#c9962f', '#3a6a40']):
        sc.fill(sc.m_rect(x + 23 + i * 2, y + 4, x + 24 + i * 2, y + 8), c); sc.px(x + 23 + i * 2, y + 4, mix(hx(c), hx('#ffffff'), .3))
    sc.outline(sc.m_rect(x + 23, y + 3, x + 30, y + 8), OUT)
    sc.person(x + 7, y + 3, '#2c6a5a', hair='#c4bfb6', apron='#e6d8b4', facing=1, hat='#7a2a2e')
    tab = sc.m_rect(x + 3, y + 3, x + 15, y + 5)
    sc.fill(tab, '#865630'); sc.fill(sc.m_rect(x + 3, y + 2, x + 15, y + 2), '#c9975e')
    for i, c in enumerate(['#e0566a', '#77a24f', '#efc65a', '#f5efe2', '#e08a3a', '#b07ae0']):
        sc.px(x + 4 + i * 2, y + 1, c)
    sc.outline(tab | sc.m_rect(x + 3, y + 2, x + 15, y + 2), OUT)
    sc.person(x + 17, y + 13, '#b07ae0', hair='#3a1e12', facing=-1)
    sc.anchors['merchant'] = (x + 18, y - 52)


def manor(sc):
    """Mayor's manor: ochre walls, blue-painted beams, copper onion turret, clock gable, balcony with the mayor."""
    x, y = 134, 342
    BLUE = '#2c4a7a'
    w, h, sd = 44, 24, 14
    main = sc.box(x, y, w, h, sd, 'ochre', frame=BLUE, base_stone=5)
    for wx in (x + 3, x + 9, x + 32, x + 38):
        sc.window(wx, y - 20, 3, 4, shutters='#2c6a8a', box=['#e0566a', '#f2d35b'])
        sc.window(wx, y - 11, 3, 4, shutters='#2c6a8a', box=['#f5efe2', '#b07ae0'])
    r = sc.roof_side(x, y, w, h, sd, 12, 'red', oh=2, mat_gable='ochre')
    gx, gy = x + w + sd // 2, y - h - sd // 2 - 3
    sc.fill(sc.m_ellipse(gx, gy, 2, 2), '#3f2719'); sc.px(gx, gy, '#2c3d52')
    for dx in (x + 4, x + 33):
        dm = sc.box(dx, y - 27, 7, 5, 3, 'ochre')
        dr = sc.roof_front(dx, y - 27, 7, 5, 3, 5, 'red', oh=1, mat_gable='ochre')
        sc.window(dx + 2, y - 31, 3, 3)
        sc.outline(dm | dr, OUT_LIT, OUT)
    sc.chimney(x + 41, y - 36, 8)
    cm = sc.m_poly([(x + 22, y - 37), (x + 26, y - 37), (x + 27, y - 44), (x + 25, y - 49), (x + 21, y - 45)])
    sc.fill(cm, '#8f8b8f'); sc.fill(cm & (sc.xx >= x + 25), '#68646f')
    for yy in range(y - 48, y - 37, 3):
        sc.fill(cm & (sc.yy == yy), '#68646f')
    cp = sc.m_rect(x + 20, y - 51, x + 27, y - 49)
    sc.fill(cp, '#45424e'); sc.fill(cp & (sc.yy == y - 51), '#8f8b8f')
    sc.outline(cm | cp, OUT); sc.smoke.append((x + 23, y - 53))
    sc.fill(sc.m_rect(x + 34, y - 58, x + 34, y - 40), '#3f2719'); sc.px(x + 34, y - 59, '#efc65a')
    fl = sc.m_poly([(x + 35, y - 57), (x + 44, y - 56), (x + 42, y - 53), (x + 44, y - 50), (x + 35, y - 51)])
    sc.fill(fl, '#2c4a7a'); sc.fill(fl & (sc.yy <= y - 56), '#4568ad'); sc.px(x + 38, y - 54, '#efc65a'); sc.px(x + 39, y - 53, '#efc65a')
    sc.outline(fl, OUT)
    sc.outline(main | r, OUT_LIT, OUT)
    bx, by = x + 14, y + 4
    bw = 16
    bay = sc.box(bx, by, bw, 30, 3, 'ochre', frame=BLUE, base_stone=5)

    def clock(g):
        cx_, cy_ = bx + 7.5, by - 36
        c = sc.m_ellipse(cx_, cy_, 3.5, 3.5)
        sc.fill(c, '#f5efe2'); sc.outline(c, '#c9962f')
        for p in ((0, 0), (0, -1), (0, -2), (1, 0), (2, 1)):
            sc.px(int(cx_) + p[0], int(cy_) + p[1], '#2a1c26')
    br = sc.roof_front(bx, by, bw, 30, 3, 13, 'red', oh=2, mat_gable='ochre', gable_detail=clock)
    sc.door(bx + 4, by, 8, 11, col='#7a2a2e', knob='#efc65a', step='#b3aeaa')
    sc.fill(sc.m_rect(bx + 7, by - 11, bx + 8, by - 1), '#5a1e22')
    sc.fill(sc.m_rect(bx + 3, by + 1, bx + 12, by + 4), '#a8323a')
    sc.fill(sc.m_rect(bx + 3, by + 1, bx + 12, by + 1), '#c44a3a')
    sc.fill(sc.m_rect(bx + 1, by + 4, bx + 14, by + 4), '#b3aeaa')
    bal = sc.m_rect(bx - 3, by - 17, bx + bw + 2, by - 16)
    sc.fill(bal, '#68646f'); sc.fill(bal & (sc.yy == by - 17), '#b3aeaa')
    sc.door(bx + 6, by - 17, 4, 8, col='#2c3d52', arch=True, step='#68646f')
    for k in range(bx - 3, bx + bw + 3, 2):
        sc.fill(sc.m_rect(k, by - 21, k, by - 18), '#2b2430')
    sc.fill(sc.m_rect(bx - 3, by - 21, bx + bw + 2, by - 21), '#2b2430')
    for k in range(bx - 3, bx + bw + 3, 3):
        sc.px(k, by - 22, ['#e0566a', '#f2d35b', '#b07ae0'][(k // 3) % 3]); sc.px(k + 1, by - 22, GRASS[3])
    sc.outline(bay | br, OUT_LIT, OUT)
    sc.person(bx + 10, by - 17, '#6a3a8a', hair='#d9d0bc', legs='#2a1c26', hat='#2a1c26', wide=True, facing=-1, raise_arm=True)
    sc.px(bx + 11, by - 22, '#efc65a'); sc.px(bx + 12, by - 21, '#efc65a'); sc.px(bx + 11, by - 20, '#efc65a')
    for bxx in (bx - 2, bx + bw - 1):
        ban = sc.m_poly([(bxx, by - 15), (bxx + 3, by - 15), (bxx + 3, by - 6), (bxx + 1.5, by - 8), (bxx, by - 6)])
        sc.fill(ban, '#2c4a7a'); sc.fill(ban & (sc.xx == bxx), '#4568ad'); sc.px(bxx + 1, by - 12, '#efc65a'); sc.px(bxx + 2, by - 13, '#efc65a')
        sc.outline(ban, OUT)
    tx, ty = x - 11, y + 3
    tw = 13
    tb = sc.tower_body(tx, ty, tw, 42, 'ochre')
    for yy in (ty - 14, ty - 28):
        sc.fill(sc.m_rect(tx, yy, tx + tw - 1, yy), BLUE)
    sc.window(tx + 5, ty - 25, 3, 6, arch=True)
    sc.window(tx + 5, ty - 11, 3, 5, arch=True, box=['#e0566a', '#f2d35b'])
    sc.window(tx + 5, ty - 38, 3, 4, arch=True)
    ring = sc.m_rect(tx - 1, ty - 43, tx + tw, ty - 42)
    sc.fill(ring, '#c9962f'); sc.fill(ring & (sc.yy == ty - 43), '#efc65a')
    ocx = tx + (tw - 1) / 2
    onion = sc.m_ellipse(ocx, ty - 49, 8, 7) | sc.m_poly([(ocx - 5, ty - 53), (ocx, ty - 66), (ocx + 5, ty - 53)])
    on_r = ROOF['copper']
    rel = (sc.xx - ocx) / 8
    sc.fill(onion, on_r[2]); sc.fill(onion & (rel < -.25), on_r[3]); sc.fill(onion & (rel < -.6), on_r[4])
    sc.fill(onion & (rel > .35), on_r[1]); sc.fill(onion & (rel > .7), on_r[0])
    sc.fill(onion & (np.mod(sc.xx - tx, 3) == 0) & (rel > -.6), on_r[1])
    sc.outline(tb | onion | ring, OUT_LIT, OUT)
    ox = int(ocx)
    sc.fill(sc.m_rect(ox, ty - 72, ox, ty - 67), '#c9962f'); sc.px(ox, ty - 69, '#efc65a'); sc.fill(sc.m_ellipse(ox, ty - 67, 1, 1), '#efc65a')
    for p in ((ox - 2, ty - 73), (ox - 1, ty - 73), (ox, ty - 73), (ox + 1, ty - 74), (ox + 2, ty - 75), (ox - 1, ty - 74), (ox - 3, ty - 74), (ox + 1, ty - 73)):
        sc.px(*p, '#2b2430')
    sc.fill(sc.m_poly([(ox + 1, ty - 71), (ox + 8, ty - 70), (ox + 1, ty - 69)]), '#e0566a')
    for tpx in (bx - 6, bx + bw + 3):
        pot = sc.m_rect(tpx, by, tpx + 3, by + 2)
        sc.fill(pot, '#a8574a'); sc.fill(pot & (sc.yy == by), '#c47a62'); sc.outline(pot, OUT)
        for k, rr_ in ((0, 2.5), (1, 2)):
            ball = sc.m_ellipse(tpx + 1.5, by - 3 - k * 4, rr_, rr_)
            sc.shade(ball, LEAF[1:], soft=1, outline=OUT)
    sc.cast(main | r | bay | br | tb | onion, y + 4, dx=4)
    sc.anchors['town_hall'] = (x + 26, y - 106)


def storehouse(sc):
    """Plank warehouse with gambrel roof, hay loft and hoist, open doors full of crates, goods outside, a porter."""
    x, y = 74, 398
    w, h, sd = 34, 18, 12
    m = sc.box(x, y, w, h, sd, 'planks', base_stone=3)
    sc.fill(sc.m_rect(x, y - h, x + w - 1, y - h), '#2e1c12')
    for p in (x, x + w - 1):
        sc.fill(sc.m_rect(p, y - h, p, y - 4), '#c9b894')
    prof = [(-2, 0), (2, 12), (w / 2 - .5, 19), (w - 3, 12), (w + 1, 0)]

    def loft(g):
        lx = x + w // 2 - 4
        sc.fill(sc.m_rect(lx, y - 32, lx + 7, y - 23), '#2e1c12'); sc.fill(sc.m_rect(lx + 1, y - 31, lx + 6, y - 23), '#120c14')
        sc.fill(sc.m_rect(lx + 1, y - 25, lx + 6, y - 23), '#c9a858'); sc.px(lx + 2, y - 26, '#e0c47a'); sc.px(lx + 5, y - 26, '#e0c47a')
        sc.fill(sc.m_rect(lx - 1, y - 33, lx + 8, y - 33), '#c9b894')
    r = sc.roof_front(x, y, w, h, sd, 19, 'slate', oh=0, mat_gable='planks', profile=prof, gable_detail=loft)
    hbx = x + w // 2 - 1
    beam = sc.m_rect(hbx - 1, y - 37, hbx + 1, y - 35)
    sc.fill(beam, '#603b23'); sc.fill(beam & (sc.yy == y - 37), '#865630'); sc.outline(beam, OUT)
    sc.px(hbx, y - 34, '#a19d9f')
    sc.fill(sc.m_rect(hbx, y - 33, hbx, y - 22), '#cdb990')
    hc = sc.m_rect(hbx - 2, y - 22, hbx + 2, y - 19)
    sc.fill(hc, '#a7843d'); sc.fill(hc & (sc.yy == y - 22), '#c9a858'); sc.outline(hc, OUT)
    dx = x + 9
    sc.fill(sc.m_rect(dx, y - 13, dx + 15, y - 1), '#2e1c12')
    sc.fill(sc.m_rect(dx + 1, y - 12, dx + 14, y - 1), '#1a120e')
    for i, c in enumerate(['#a7843d', '#865630', '#a7843d', '#7f5f2c']):
        sc.fill(sc.m_rect(dx + 2 + i * 3, y - 4, dx + 4 + i * 3, y - 1), c); sc.px(dx + 2 + i * 3, y - 4, '#c9a858')
    sc.fill(sc.m_rect(dx + 4, y - 8, dx + 6, y - 5), '#7f5f2c'); sc.fill(sc.m_rect(dx + 9, y - 7, dx + 11, y - 5), '#5e3e26')
    for sx in (dx - 4, dx + 16):
        lf = sc.m_rect(sx, y - 13, sx + 3, y - 1)
        sc.fill(lf, '#865630'); sc.fill(sc.m_line([(sx, y - 13), (sx + 3, y - 1)]), '#c9b894'); sc.fill(sc.m_line([(sx + 3, y - 13), (sx, y - 1)]), '#c9b894')
        sc.outline(lf, OUT)
    sc.hanging_sign(x - 9, y - 15, ['###', '#o#', '###'])
    sc.outline(m | r, OUT_LIT, OUT)
    sc.cast(m | r, y)
    for cx_, cy_ in ((x + 36, y + 1), (x + 40, y + 2), (x + 37, y - 3), (x + 44, y + 3)):
        sc.crate(cx_, cy_)
    sc.barrel(x + 48, y + 4); sc.barrel(x - 7, y + 1); sc.barrel(x - 4, y + 3, top='#d9443a')
    sc.sack(x - 1, y + 4); sc.sack(x + 2, y + 5, '#b8a684'); sc.sack(x + 4, y + 4)
    wb = sc.m_poly([(x + 26, y + 7), (x + 34, y + 7), (x + 33, y + 10), (x + 27, y + 10)])
    sc.fill(wb, '#865630'); sc.fill(wb & (sc.yy == y + 7), '#c9a858'); sc.outline(wb, OUT)
    sc.px(x + 26, y + 11, '#2b2430'); sc.fill(sc.m_line([(x + 34, y + 8), (x + 37, y + 10)]), '#603b23')

    def carry(ax, yy, mm):
        s = sc.m_ellipse(ax - 1, yy - 9, 2, 1.5)
        sc.fill(s, '#cdb990'); sc.outline(s, OUT)
    sc.person(x + 18, y + 12, '#4a6a8a', hair='#2a1c16', tool=carry, facing=-1)
    sc.anchors['storage'] = (x + 17, y - 50)


def training(sc):
    """Sand yard: fence, armory shed with weapon rack, banner, dummies, targets, sparring pair, archer, spectators."""
    x0, y0, x1, y1 = 208, 314, 268, 366
    yard = sc.m_poly([(x0, y1), (x1, y1), (x1 + 4, y0), (x0 + 6, y0)])
    sc.fill(yard, '#d8c08a'); sc.speckle(yard, ['#c4a874', '#e8d4a4'], .22, seed=4)
    sc.groundm |= yard
    sx, sy = 244, 328
    shed = sc.box(sx, sy, 20, 11, 8, 'stone')
    sc.door(sx + 13, sy, 5, 7, col='#5a3820', arch=True)
    rr = sc.roof_side(sx, sy, 20, 11, 8, 7, 'teal', oh=1, mat_gable='stone')
    sc.fill(sc.m_rect(sx + 1, sy - 4, sx + 10, sy - 4), '#603b23')
    for k, c in enumerate(['#e6e2da', '#c4bfb6', '#e6e2da', '#a19d9f']):
        sc.fill(sc.m_rect(sx + 2 + k * 2, sy - 10, sx + 2 + k * 2, sy - 3), c); sc.px(sx + 2 + k * 2, sy - 10, '#ffffff')
        sc.px(sx + 2 + k * 2, sy - 5, '#c9962f')
    sc.outline(shed | rr, OUT_LIT, OUT)
    sc.cast(shed | rr, sy)
    px_ = x0 + 3
    sc.fill(sc.m_rect(px_, sy - 30, px_, sy - 14), '#3f2719'); sc.px(px_, sy - 31, '#efc65a')
    flag = sc.m_poly([(px_ + 1, sy - 29), (px_ + 12, sy - 29), (px_ + 12, sy - 19), (px_ + 1, sy - 19)])
    sc.fill(flag, '#a8323a'); sc.fill(flag & (sc.yy == sy - 29), '#c44a3a'); sc.fill(flag & (sc.yy == sy - 19), '#7a1e22')
    for k in range(6):
        sc.px(px_ + 4 + k, sy - 27 + k, '#f2efe6'); sc.px(px_ + 9 - k, sy - 27 + k, '#f2efe6')
    sc.px(px_ + 4, sy - 22, '#c9962f'); sc.px(px_ + 9, sy - 22, '#c9962f')
    sc.outline(flag, OUT)
    for dx_, dy_ in ((x0 + 12, y0 + 14), (x0 + 22, y0 + 10), (x0 + 32, y0 + 13)):
        sc.fill(sc.m_rect(dx_, dy_ - 10, dx_, dy_), '#603b23')
        body = sc.m_ellipse(dx_, dy_ - 6, 2.5, 3.5)
        sc.shade(body, ROOF['thatch'], soft=1)
        sc.fill(sc.m_rect(dx_ - 4, dy_ - 7, dx_ + 4, dy_ - 7), '#865630')
        head = sc.m_ellipse(dx_, dy_ - 11, 1.8, 1.8)
        sc.fill(head, '#e6d8b4'); sc.px(dx_, dy_ - 11, '#a8323a')
        sc.fill(sc.m_rect(dx_ - 2, dy_ - 5, dx_ + 2, dy_ - 5), '#7a3a2e')
        sc.outline(body | head, OUT)
    for tx, ty in ((x1 - 4, y0 + 30), (x1 - 2, y0 + 44)):
        sc.fill(sc.m_line([(tx - 2, ty + 6), (tx, ty)]), '#603b23'); sc.fill(sc.m_line([(tx + 2, ty + 6), (tx, ty)]), '#603b23')
        t = sc.m_ellipse(tx, ty - 1, 4, 4)
        sc.fill(t, '#f2e6c8'); sc.fill(sc.m_ellipse(tx, ty - 1, 3, 3), '#c44a3a'); sc.fill(sc.m_ellipse(tx, ty - 1, 1.6, 1.6), '#f2e6c8'); sc.px(tx, ty - 1, '#efc65a')
        sc.outline(t, OUT)
        for ax_, ay_ in ((tx - 3, ty - 3), (tx + 1, ty + 1)):
            sc.px(ax_ - 1, ay_, '#865630'); sc.px(ax_ - 2, ay_, '#865630'); sc.px(ax_ - 3, ay_, '#f2efe6')

    def bow(ax, yy, mm):
        sc.fill(sc.m_line([(ax + 1, yy - 9), (ax + 2, yy - 6), (ax + 1, yy - 3)]), '#865630')

    sc.person(x0 + 34, y0 + 41, '#3a6a40', hair='#e0b84a', legs='#3f2719', tool=bow, facing=1)
    for hx_, hy_ in ((x0 + 4, y1 - 4), (x0 + 9, y1 - 3)):
        hb = sc.m_rect(hx_, hy_ - 3, hx_ + 4, hy_)
        sc.fill(hb, '#c9a858'); sc.fill(hb & (sc.yy == hy_ - 3), '#e0c47a'); sc.fill(hb & (sc.xx == hx_ + 2), '#a7843d'); sc.outline(hb, OUT)

    def sword(ax, yy, mm):
        sc.fill(sc.m_rect(ax, yy - 13, ax, yy - 8), '#e6e2da'); sc.px(ax, yy - 13, '#ffffff')
        sc.px(ax - 1, yy - 8, '#c9962f'); sc.px(ax + 1, yy - 8, '#c9962f')
    sc.person(x0 + 14, y0 + 32, '#a8323a', hair='#2a1c16', legs='#45424e', tool=sword, raise_arm=True, facing=1, wide=True)
    sc.person(x0 + 24, y0 + 32, '#5a7a9a', hair='#a0602a', legs='#3f2719', tool=sword, raise_arm=True, facing=-1)
    sh = sc.m_ellipse(x0 + 22, y0 + 28, 1.5, 2)
    sc.fill(sh, '#865630'); sc.px(x0 + 22, y0 + 28, '#efc65a'); sc.outline(sh, OUT)
    sc.bench(x0 - 16, y0 + 30, 9)
    sc.person(x0 - 15, y0 + 28, '#c9a858', hair='#3a1e12', facing=1)
    sc.person(x0 - 10, y0 + 28, '#4568ad', hair='#d9d0bc', facing=1)
    wd = M['wood']
    for (ax, ay), (bx_, by_) in (((x0, y1), (x0 + 16, y1)), ((x0 + 26, y1), (x1, y1)), ((x0, y1), (x0 + 6, y0)), ((x1, y1), (x1 + 4, y0)), ((x0 + 6, y0), (sx - 8, y0))):
        n = int(max(abs(bx_ - ax), abs(by_ - ay)) // 4) + 1
        for i in range(n + 1):
            t_ = i / max(1, n)
            px2, py2 = int(round(ax + (bx_ - ax) * t_)), int(round(ay + (by_ - ay) * t_))
            sc.fill(sc.m_rect(px2, py2 - 4, px2, py2), wd[2]); sc.px(px2, py2 - 4, wd[4])
        sc.fill(sc.m_line([(ax, ay - 3), (bx_, by_ - 3)]), wd[3])
        sc.fill(sc.m_line([(ax, ay - 1), (bx_, by_ - 1)]), wd[1])
    sc.anchors['training'] = (x0 + 30, y0 - 22)


def smithy(sc):
    """Stone smithy on the east plot: huge chimney, open forge bay with hood, bellows and fire, anvil, smith, sword stand."""
    x, y = 290, 362
    w, h, sd = 30, 15, 12
    m = sc.box(x, y, w, h, sd, 'stone')
    sc.fill(sc.m_rect(x + 12, y - 13, x + w - 1, y - 1), '#3f2719')
    bay = sc.m_rect(x + 13, y - 12, x + w - 2, y - 1)
    sc.fill(bay, '#1a1016')
    forge = sc.m_rect(x + 15, y - 6, x + 23, y - 1)
    sc.fill(forge, '#5d5a64'); sc.fill(forge & (sc.yy == y - 6), '#8f8b8f')
    sc.fill(sc.m_rect(x + 16, y - 6, x + 22, y - 5), '#ff8a3a'); sc.fill(sc.m_rect(x + 18, y - 6, x + 20, y - 6), '#ffd36b')
    sc.glow(x + 19, y - 6, 12, '#ff7a2a', .5, steps=3, mask=bay)
    flue = sc.m_rect(x + 17, y - 12, x + 21, y - 7)
    sc.fill(flue, '#7a3a2e'); sc.fill(flue & (np.mod(sc.yy, 2) == 0), '#5a2a22'); sc.fill(flue & (sc.xx == x + 17), '#9a5a42')
    sc.fill(sc.m_rect(x + 14, y - 7, x + 24, y - 7), '#5a2a22')
    sc.glow(x + 19, y - 4, 16, '#ff9a4a', .45, steps=3, mask=bay)
    sc.glow(x + 19, y + 4, 14, '#ffb060', .22, steps=3, mask=sc.groundm & (sc.yy >= y), ry=6)
    bel = sc.m_poly([(x + 24, y - 5), (x + 27, y - 7), (x + 27, y - 3)])
    sc.fill(bel, '#865630'); sc.outline(bel, OUT)
    sc.window(x + 4, y - 11, 3, 4, shutters='#5a3820')
    r = sc.roof_side(x, y, w, h, sd, 9, 'slate', oh=2, mat_gable='stone')
    ch = sc.box(x - 6, y, 7, 36, 4, 'stone')
    cap = sc.m_rect(x - 7, y - 38, x + 2, y - 36)
    sc.fill(cap, '#45424e'); sc.fill(cap & (sc.yy == y - 38), '#8f8b8f')
    sc.glow(x - 2, y - 39, 5, '#ff8a3a', .3, steps=2)
    sc.smoke.append((x - 3, y - 40)); sc.smoke.append((x - 1, y - 45))
    sc.hanging_sign(x + w + 1, y - 13, ['.###.', '..#..', '.###.'])
    sc.outline(m | r | ch | cap, OUT_LIT, OUT)
    sc.cast(m | r | ch, y, dx=4)
    ax_, ay_ = x + 15, y + 10
    an = sc.m_poly([(ax_, ay_ - 5), (ax_ + 7, ay_ - 5), (ax_ + 6, ay_ - 3), (ax_ + 5, ay_ - 3), (ax_ + 5, ay_ - 1), (ax_ + 2, ay_ - 1), (ax_ + 2, ay_ - 3), (ax_ + 1, ay_ - 3)])
    sc.fill(an, '#45424e'); sc.fill(an & (sc.yy == ay_ - 5), '#8f8b8f'); sc.outline(an, OUT)
    sc.px(ax_ + 3, ay_ - 6, '#ffb04a'); sc.px(ax_ + 4, ay_ - 6, '#ff8a3a'); sc.px(ax_ + 5, ay_ - 6, '#ffd36b')
    for sx_, sy_ in ((ax_ + 6, ay_ - 9), (ax_ + 1, ay_ - 10), (ax_ + 8, ay_ - 7), (ax_ + 3, ay_ - 12), (ax_ + 9, ay_ - 10), (ax_ + 7, ay_ - 12)):
        sc.px(sx_, sy_, '#ffd36b')

    def hammer(ax, yy, mm):
        sc.fill(sc.m_line([(ax, yy - 8), (ax + 1, yy - 11)]), '#865630')
        sc.fill(sc.m_rect(ax, yy - 13, ax + 2, yy - 12), '#5d5a64')
    sc.person(ax_ - 5, ay_ + 1, '#6a4a3a', hair='#2a1c16', legs='#2e2a36', apron='#3f2719', tool=hammer, raise_arm=True, wide=True)
    sc.barrel(ax_ + 10, ay_, top='#3a7eaa')
    stx, sty = x + 1, y + 10
    sc.fill(sc.m_rect(stx, sty - 1, stx + 8, sty - 1), '#603b23'); sc.fill(sc.m_rect(stx, sty - 5, stx + 8, sty - 5), '#865630')
    for k in range(4):
        sc.fill(sc.m_rect(stx + 1 + k * 2, sty - 11, stx + 1 + k * 2, sty - 2), '#e6e2da' if k % 2 == 0 else '#c4bfb6')
        sc.px(stx + 1 + k * 2, sty - 11, '#ffffff'); sc.px(stx + 1 + k * 2, sty - 3, '#c9962f')
    sc.outline(sc.m_rect(stx, sty - 5, stx + 8, sty - 5) | sc.m_rect(stx, sty - 1, stx + 8, sty - 1), OUT)
    gx, gy = x - 7, y + 9
    gw = sc.m_ellipse(gx + 2, gy - 3, 2.5, 2.5)
    sc.fill(gw, '#b3aeaa'); sc.fill(gw & (sc.xx > gx + 2), '#8f8b8f'); sc.px(gx + 2, gy - 3, '#45424e')
    sc.fill(sc.m_rect(gx, gy - 1, gx + 4, gy), '#603b23'); sc.outline(gw | sc.m_rect(gx, gy - 1, gx + 4, gy), OUT)
    coal = sc.m_ellipse(x + w + 8, y + 2, 4, 2.5) & (sc.yy <= y + 2)
    sc.fill(coal, '#25232e'); sc.speckle(coal, ['#45424e'], .3, seed=2); sc.outline(coal, OUT)
    for k in range(3):
        sc.fill(sc.m_rect(x + w + 3 + k * 3, y + 7, x + w + 4 + k * 3, y + 7), '#c4bfb6'); sc.px(x + w + 3 + k * 3, y + 7, '#f2efe6')
    sc.anchors['crafting'] = (x + 20, y - 46)


def cottage(sc, x, y, w, h, sd, roof, mat='plaster', frame=BEAM, flip_door=False, chimney=True, shutters='#3a6a40', laundry=False):
    m = sc.box(x, y, w, h, sd, mat, frame=frame)
    r = sc.roof_side(x, y, w, h, sd, max(6, w // 3), roof, oh=2, mat_gable=mat)
    sc.door(x + (w - 7 if flip_door else 3), y, 4, 7)
    sc.window(x + (3 if flip_door else w - 7), y - 8, 3, 4, shutters=shutters, box=['#e0566a', '#f2d35b', '#f5efe2'])
    if chimney:
        sc.chimney(x + w - 6, y - h - 6, 6)
    sc.outline(m | r, OUT_LIT, OUT)
    sc.cast(m | r, y)
    if laundry:
        lx = x + w + sd + 3
        sc.fill(sc.m_rect(lx, y - 9, lx, y), M['wood'][1]); sc.fill(sc.m_rect(lx + 14, y - 9, lx + 14, y), M['wood'][1])
        sc.fill(sc.m_line([(lx, y - 9), (lx + 7, y - 8), (lx + 14, y - 9)]), '#e6d8b4')
        for k, c in ((2, '#e0566a'), (6, '#f5efe2'), (10, '#4568ad')):
            sc.fill(sc.m_rect(lx + k, y - 7, lx + k + 2, y - 5), c)


def fountain(sc, cx, cy):
    basin = sc.m_ellipse(cx, cy, 12, 5)
    inner = sc.m_ellipse(cx, cy - .5, 10, 3.5)
    sc.fill(basin, '#b3aeaa'); sc.fill(basin & (sc.yy > cy + 1), '#8f8b8f'); sc.fill(basin & (sc.yy >= cy + 4), '#68646f')
    sc.fill(inner, WATER[3]); sc.fill(inner & (sc.yy <= cy - 2), WATER[4])
    for p in ((cx - 5, cy), (cx + 4, cy + 1), (cx - 1, cy - 2), (cx + 7, cy - 1)):
        sc.px(*p, WATER[5])
    col = sc.m_rect(cx - 1, cy - 9, cx + 1, cy)
    sc.fill(col, '#c4bfb6'); sc.fill(col & (sc.xx == cx + 1), '#8f8b8f')
    bowl = sc.m_ellipse(cx, cy - 9, 4, 1.5)
    sc.fill(bowl, '#b3aeaa')
    st = sc.m_rect(cx - 1, cy - 14, cx + 1, cy - 11) | sc.m_ellipse(cx, cy - 15, 1, 1)
    sc.fill(st, '#c9962f'); sc.px(cx - 1, cy - 14, '#efc65a'); sc.px(cx, cy - 16, '#efc65a')
    for p in ((cx - 3, cy - 11), (cx + 3, cy - 11), (cx - 5, cy - 9), (cx + 5, cy - 9), (cx - 6, cy - 7), (cx + 6, cy - 7), (cx - 6, cy - 5), (cx + 6, cy - 5)):
        sc.px(*p, WATER[5])
    sc.outline(basin | col | bowl | st, OUT)
    sc.solid |= basin | col


# Placeable pieces, in draw order (back to front). Usable buildings use their BuildingId; decor cottages are optional.
BUILDINGS = [('dungeon', dungeon_gate), ('mine', mine), ('merchant', merchant), ('woodcutting', woodcutter),
             ('training', training), ('town_hall', manor), ('crafting', smithy), ('storage', storehouse)]
DECOR = [('cottage_thatch', lambda sc: cottage(sc, 202, 420, 20, 10, 8, 'thatch', laundry=True)),
         ('cottage_slate', lambda sc: cottage(sc, 120, 446, 20, 10, 8, 'slate', flip_door=True, shutters='#7a2a2e')),
         ('cottage_whitewash', lambda sc: cottage(sc, 244, 446, 18, 9, 7, 'red', mat='whitewash', flip_door=True))]


def build(buildings=True):
    sc = Town(W, H)
    sky_and_mountains(sc)
    ground(sc)
    cliff = cliff_band(sc)
    sc.groundm &= ~cliff
    xs = np.arange(W)
    rc = 472 + 3 * np.sin(xs * .03 + 1) + 1.5 * np.sin(xs * .11)
    river = (sc.yy >= (rc - 5)[None, :]) & (sc.yy <= (rc + 5)[None, :])
    sc.water(river, rmp=WATER, seed=6)
    sc.groundm &= ~river
    road = lambda pts, w_: sc.path(pts, w_, rmp=PATH)
    road([(186, 560), (186, 486), (184, 462), (180, 420), (174, 380)], 7)
    road([(178, 362), (198, 344), (204, 316), (204, 284), (206, 256), (206, 246)], 5)
    road([(156, 370), (128, 384), (104, 398)], 5)
    road([(146, 366), (130, 340), (122, 316), (112, 308)], 4)
    road([(108, 306), (118, 278), (128, 262), (136, 252)], 3)
    road([(194, 370), (236, 376), (282, 374), (306, 374), (360, 372)], 5)
    road([(186, 520), (150, 520)], 3); road([(186, 520), (214, 520)], 3)
    road([(180, 420), (212, 422), (246, 432)], 3)
    plaza = sc.m_ellipse(172, 372, 26, 12)
    sc.fill(plaza, '#a8a29e')
    sc.fill(plaza & ((np.mod(sc.xx + (sc.yy // 2) * 2, 4) == 0) | (np.mod(sc.yy, 2) == 0)), '#8f8a8a')
    sc.fill(plaza & (np.mod(sc.xx * 3 + sc.yy * 5, 7) == 0), '#c4bfb6')
    sc.outline(plaza, '#7b7884')
    wd = M['wood']
    br = sc.m_rect(178, 462, 194, 483)
    sc.fill(br, wd[3]); sc.fill(br & (np.mod(sc.yy, 2) == 0), wd[2])
    for xx in (178, 194):
        sc.fill(sc.m_rect(xx, 460, xx, 484), wd[1]); sc.px(xx, 460, wd[4]); sc.px(xx, 472, wd[4]); sc.px(xx, 484, wd[4])
    sc.outline(br, OUT)
    sc.solid[:] = False
    if buildings:
        dungeon_gate(sc)
        mine(sc)
    rng = np.random.default_rng(14)
    trees = []
    for _ in range(30):
        trees.append((int(rng.integers(236, 284)), int(rng.integers(-6, 70)), 'p'))
    for _ in range(12):
        trees.append((int(rng.integers(284, 300)), int(rng.integers(-6, 60)), 'o'))
    for x_, y_ in ((330, 252), (348, 266), (300, 258), (352, 300), (282, 280), (344, 330), (8, 352), (26, 372), (6, 408),
                   (340, 404), (316, 424), (352, 440), (124, 330), (276, 300), (40, 340)):
        trees.append((y_, x_, 'o'))
    for ty, tx, kind in sorted(trees):
        if kind == 'p':
            sc.pine(tx, ty, int(rng.integers(14, 21)), PINE)
        else:
            sc.tree(tx, ty, int(rng.integers(6, 9)), rmp=LEAF, seed=tx * 3 + ty)
    if buildings:
        merchant(sc)
        woodcutter(sc)
        training(sc)
        manor(sc)
    fountain(sc, 172, 376)
    for lx, ly in ((148, 372), (198, 372), (202, 320), (182, 436)):
        sc.lamp(lx, ly)
    sc.bench(152, 386); sc.bench(184, 388)
    sc.person(160, 390, '#e08a3a', hair='#3a1e12', facing=1)
    if buildings:
        smithy(sc)
        storehouse(sc)
    if buildings:
        for _, fn in DECOR:
            fn(sc)
    sc.field(30, 422, 96, 452, crop='#8aa03a', crop_hi='#d8c060')
    sc.field(272, 440, 322, 456, crop='#5a8a3a', crop_hi='#e0566a')
    for x_, y_ in ((150, 432), (236, 412), (268, 430)):
        sc.bush(x_, y_, 3, rmp=LEAF[:5], berries='#e0566a', seed=x_)
    for cx_, cy_ in ((214, 436), (219, 438), (226, 434), (110, 430)):
        sc.chicken(cx_, cy_)
    sc.plot(18, 318, 44, 26); sc.plot(106, 528, 42, 32); sc.plot(214, 528, 42, 32)
    for x_, y_ in ((40, 500), (70, 512), (290, 504), (330, 526), (20, 548), (350, 552), (276, 552), (90, 552), (140, 498), (240, 496)):
        sc.tree(x_, y_, 7, rmp=LEAF, seed=x_)
    for dx_ in (120, 126, 252):
        sc.px(dx_, 471, '#f2efe6'); sc.px(dx_ + 1, 471, '#f2efe6'); sc.px(dx_ + 2, 470, '#3a6a40'); sc.px(dx_ + 3, 470, '#efc65a')
    for (bx_, by_), c in zip(((150, 306), (246, 400), (60, 410), (300, 310), (196, 452)), ('#f2d35b', '#b07ae0', '#f5efe2', '#e0566a', '#f2d35b')):
        sc.px(bx_, by_, c); sc.px(bx_ + 2, by_, c); sc.px(bx_ + 1, by_ + 1, '#2a1c26')
    sc.apply_lights()
    smoke(sc)
    return sc


if __name__ == '__main__':
    os.makedirs(OUTDIR, exist_ok=True)
    sc = build()
    sc.save(f'{OUTDIR}/village_day_1x.png', 1)
    sc.save(f'{OUTDIR}/village_day.png', 4)
    json.dump(sc.anchors, open(f'{OUTDIR}/anchors.json', 'w'), indent=1)
    from pix import count_colors
    print('colors', count_colors(sc), sc.anchors)
