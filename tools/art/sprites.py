"""Portraits (48x48), stone swords / basic armour / rats (32x32). Same toolkit and rules as the villages."""
import sys, os
import numpy as np
from pix import Canvas, ramp, hx, mix, BAYER
from elements import M, OUT, OUT_LIT

OUTDIR = sys.argv[1] if len(sys.argv) > 1 else 'out'

SKIN = ramp('#3a1e1e', '#6b3a2e', '#9a5c42', '#c4825e', '#e2a97e', '#f2caa0')
SKIN_PALE = ramp('#2e2230', '#584250', '#8a6a70', '#b8948e', '#dcbfae', '#f0dccb')
SKIN_DARK = ramp('#1c1014', '#3a2220', '#5e3a2c', '#86553a', '#a8724c', '#c49264')


def bg_vignette(c, inner, outer, cx=24, cy=22):
    d = np.sqrt((c.xx - cx) ** 2 + (c.yy - cy) ** 2)
    mid = mix(hx(inner), hx(outer), .5)
    allm = c.m_rect(0, 0, c.w - 1, c.h - 1)
    b = BAYER[c.yy % 4, c.xx % 4]
    t = np.clip((d - 14) / 6, 0, 2)
    lvl = np.floor(t) + ((t % 1) > (b * .6 + .4))
    c.fill(allm & (lvl <= 0), inner); c.fill(allm & (lvl == 1), mid); c.fill(allm & (lvl >= 2), outer)


def eye(c, x, y, iris, look=0, glow=False):
    c.px(x, y, '#e8dccb'); c.px(x + 1, y, '#e8dccb')
    c.px(x + (1 if look >= 0 else 0), y, iris)
    c.px(x, y - 1, OUT); c.px(x + 1, y - 1, OUT)
    if glow:
        c.glow(x + .5, y, 4, iris, .5, steps=2)


# ------------------------------------------------------------------ portraits
def portrait_wanderer():
    c = Canvas(48, 48)
    bg_vignette(c, '#24304a', '#0e1220')
    hood = ramp('#0e0f1a', '#1a1d2e', '#2a2f48', '#3d4566', '#566088')
    cloak = c.m_poly([(4, 48), (8, 38), (16, 33), (32, 33), (40, 38), (44, 48)])
    c.shade(cloak, hood, soft=3, outline=OUT)
    # scarf
    scarf = c.m_poly([(15, 34), (33, 34), (31, 40), (24, 42), (17, 40)])
    c.shade(scarf, M['cloth_red'], soft=1.5, outline=OUT)
    # face (lower half lit, upper in hood shadow)
    face = c.m_ellipse(24, 24, 7, 9)
    c.shade(face, SKIN[:5], soft=2.5)
    c.tint(face & (c.yy < 23), '#1a1d2e', .55)
    for ex in (20, 27):
        c.px(ex, 23, '#bfe8ff'); c.px(ex + 1, 23, '#5fa8d8')
        c.glow(ex + .5, 23, 3, '#7fc8ff', .35, steps=2)
    c.px(24, 27, SKIN[1]); c.px(25, 27, SKIN[2])
    c.fill(c.m_rect(22, 30, 26, 30), SKIN[1]); c.px(22, 30, SKIN[2])
    # stubble
    for x, y in ((21, 31), (23, 32), (25, 31), (27, 30), (20, 29), (28, 29)):
        c.px(x, y, SKIN[2])
    # hood
    hd = c.m_ellipse(24, 20, 13, 14) & ~(c.m_ellipse(24, 26, 8, 10) & (c.yy > 16))
    hd &= c.yy < 36
    c.shade(hd, hood, soft=3, light=(-1, -1))
    c.fill(c.m_ellipse(24, 26, 8, 10) & ~c.m_ellipse(24, 26, 7, 10) & (c.yy > 16) & (c.yy < 34), hood[0])
    # hood rim highlight
    rim = c.m_ellipse(24, 26, 9, 11) & ~c.m_ellipse(24, 26, 8, 10) & (c.yy > 15) & (c.yy < 30) & (c.xx < 22)
    c.fill(rim, hood[4])
    c.outline(hd | cloak, OUT)
    # clasp
    c.fill(c.m_rect(23, 37, 25, 39), M['gold'][2]); c.px(23, 37, M['gold'][4]); c.px(25, 39, M['gold'][1])
    c.outline(c.m_rect(23, 37, 25, 39), OUT)
    return c


def portrait_squire():
    c = Canvas(48, 48)
    bg_vignette(c, '#5a3a24', '#22140e')
    c.glow(10, 10, 30, '#ffb04a', .18, steps=3)
    tunic = ramp('#1e1410', '#3a2618', '#5e3f24', '#83603a', '#a8825a')
    gam = ramp('#4a3e30', '#7a6a50', '#a8946e', '#cdb990', '#e8d8b0')
    body = c.m_poly([(3, 48), (7, 38), (16, 33), (32, 33), (41, 38), (45, 48)])
    c.shade(body, gam, soft=3)
    for x in range(6, 44, 4):
        c.fill(body & (c.xx == x) & (c.yy > 36), gam[1])
    c.fill(body & ((c.yy - 34) % 4 == 0), gam[1])
    # leather pauldron
    pl = c.empty()
    for k in range(3):
        plate = c.m_ellipse(10 - k, 36 + k * 3, 7 - k * .5, 2.6) & (c.yy >= 34 + k * 3)
        c.shade(plate, tunic, soft=1.2)
        c.fill(plate & ~np.roll(plate, -1, 0), tunic[0])
        pl |= plate
    for x, y in ((7, 36), (12, 35), (9, 39)):
        c.px(x, y, '#c9c4b8')
    c.outline(body | pl, OUT)
    neck = c.m_rect(21, 30, 27, 34)
    c.shade(neck, SKIN[:4], mode='flat', dither=False)
    face = c.m_ellipse(24, 22, 8, 10)
    c.shade(face, SKIN, soft=2.5)
    # ears
    for ex in (15, 33):
        e = c.m_ellipse(ex, 23, 1.5, 2.5)
        c.shade(e, SKIN[1:5], soft=1)
    eye(c, 19, 23, '#3d6a3a'); eye(c, 26, 23, '#3d6a3a')
    for x in (18, 19, 20): c.px(x, 20, '#3a2010')
    for x in (26, 27, 28): c.px(x, 20, '#3a2010')
    c.px(18, 21, '#3a2010')
    c.px(23, 26, SKIN[2]); c.px(24, 27, SKIN[1]); c.px(23, 27, SKIN[2])
    c.fill(c.m_rect(21, 29, 26, 29), SKIN[1]); c.px(26, 28, SKIN[2])
    # scar
    for x, y in ((28, 25), (29, 26), (29, 27), (30, 28)):
        c.px(x, y, '#c46a5a')
    # hair: messy chestnut
    hair = ramp('#1e0f0a', '#3a1e12', '#5e321c', '#86502a', '#ab723c')
    hm = c.m_ellipse(24, 15, 10, 6.5) | c.m_poly([(14, 15), (15, 25), (17, 17)]) | c.m_poly([(34, 15), (33, 25), (31, 17)])
    for k, x in enumerate(range(15, 34, 3)):
        hm |= c.m_poly([(x, 17), (x + 3, 17), (x + 1 + (k % 2) * 2, 21 - (k % 3 == 1))])
    for x, y in ((17, 10), (21, 8), (26, 8), (30, 10)):
        hm |= c.m_poly([(x - 2, y + 3), (x + 2, y - 1), (x + 2, y + 3)])
    hm &= ~(c.m_ellipse(24, 25, 7, 6))
    c.shade(hm, hair, soft=2)
    for x in range(16, 32, 2):
        c.px(x, 12 + (x % 3), hair[4])
    c.outline(hm | face | neck, OUT)
    return c


def portrait_runic():
    c = Canvas(48, 48)
    bg_vignette(c, '#2e1f48', '#120a1e')
    robe = ramp('#120a1e', '#221438', '#36205a', '#4e3278', '#6a4a96')
    body = c.m_poly([(3, 48), (8, 37), (17, 33), (31, 33), (40, 37), (45, 48)])
    c.shade(body, robe, soft=3)
    trim = c.m_line([(17, 33), (24, 44), (31, 33)], 2)
    c.fill(trim & body, M['gold'][2]); c.fill(trim & body & (c.xx < 24), M['gold'][3])
    c.outline(body, OUT)
    neck = c.m_rect(21, 30, 27, 34)
    c.shade(neck, SKIN_DARK[:4], mode='flat', dither=False)
    face = c.m_ellipse(24, 22, 7, 10)
    c.shade(face, SKIN_DARK, soft=2.5)
    eye(c, 20, 23, '#ffcf5a'); eye(c, 26, 23, '#ffcf5a')
    for x in (19, 20, 21): c.px(x, 20, '#e8e0f0')
    for x in (26, 27, 28): c.px(x, 20, '#e8e0f0')
    c.px(24, 26, SKIN_DARK[2]); c.px(24, 27, SKIN_DARK[1])
    c.fill(c.m_rect(22, 29, 26, 29), SKIN_DARK[1])
    # glowing rune under the left eye and on the brow
    for x, y in ((19, 25), (19, 26), (20, 27), (18, 27), (24, 16), (23, 17), (25, 17), (24, 18)):
        c.px(x, y, '#7fe0ff')
    c.glow(19, 26, 5, '#7fe0ff', .4, steps=2)
    # long silver hair falling past the shoulders
    hair = ramp('#3a3448', '#625c74', '#8f8aa0', '#bdb9c9', '#e8e6ee')
    hm = c.m_ellipse(24, 16, 10, 8) | c.m_poly([(14, 15), (12, 40), (17, 38), (17, 20)]) | c.m_poly([(34, 15), (36, 40), (31, 38), (31, 20)])
    hm &= ~(c.m_ellipse(24, 24, 7, 8) & (c.yy > 17))
    c.shade(hm, hair, soft=2)
    for y in range(20, 40, 3):
        c.px(14, y, hair[1]); c.px(34, y, hair[1])
    # circlet with gem
    ci = c.m_rect(15, 16, 33, 16) & hm
    c.fill(ci, M['gold'][2]); c.fill(ci & (c.xx < 22), M['gold'][3])
    c.fill(c.m_rect(23, 15, 25, 17), '#4a3aa8'); c.px(23, 15, '#d8ccff'); c.glow(24, 16, 5, '#8f7aff', .35, steps=2)
    c.outline(hm | face | neck, OUT)
    return c


# ------------------------------------------------------------------ swords (diagonal, hilt bottom-left)
def frame(c, ox=5.0, oy=27.0):
    """u along the blade (toward top-right), v across (positive = lower-right side = shadow)."""
    ax = np.array([1, -1]) / np.sqrt(2)
    px_, py_ = c.xx + .5 - ox, c.yy + .5 - oy
    u = px_ * ax[0] + py_ * ax[1]
    v = px_ * -ax[1] + py_ * ax[0]
    return u, v


def sword(c, blade, *, L=24, w0=2.6, guard=None, grip=M['wood'], wrap=None, pommel=None, knap=0.0, fuller=None,
          crack=None, seed=1):
    u, v = frame(c)
    rng = np.random.default_rng(seed)
    # blade
    taper = np.clip((L - u) / 7, 0, 1)
    jit = np.zeros_like(u)
    if knap:
        k = (np.floor(u / 2.0)).astype(int)
        tbl = rng.random(64) * knap
        jit = tbl[np.clip(k, 0, 63)] - knap / 2
    hw = (w0 + jit) * np.where(u < L - 7, 1, taper ** .8)
    bm = (u > 7) & (u < L) & (np.abs(v) < hw)
    b = [hx(x) for x in blade]
    c.fill(bm, b[2])
    c.fill(bm & (v < -.3), b[3])
    c.fill(bm & (v < -hw + 1.0), b[4])
    c.fill(bm & (v > hw - 1.2), b[1])
    c.fill(bm & (np.abs(v) < .55) & (u > 9), b[3])
    if knap:
        # conchoidal chips: alternating light/dark facets along both edges
        facet = ((np.floor(u / 2.0) + (v > 0)) % 2 == 0) & (np.abs(v) > .6) & bm
        c.fill(facet & (v < 0), b[4]); c.fill(facet & (v > 0), b[1])
        c.fill(bm & (np.abs(v) < .5), b[2])
    if fuller:
        fm = bm & (np.abs(v) < .7) & (u > 9) & (u < L - 6)
        c.fill(fm, b[1])
        for uu in (12, 16):
            c.fill(bm & (np.abs(u - uu) < .6) & (np.abs(v) < .7), fuller)
        c.glow(13, 18, 6, fuller, .35, steps=2, mask=bm)
    if crack:
        cm = bm & (np.abs(v - .8 * np.sin(u * .9)) < .55) & (u > 9) & (u < L - 3)
        c.fill(cm, crack)
        c.glow(15, 16, 10, crack, .35, steps=3, mask=bm)
    # guard
    gm = c.empty()
    if guard:
        gm = (np.abs(u - 6.5) < 1.2) & (np.abs(v) < 5)
        g = [hx(x) for x in guard]
        c.fill(gm, g[2]); c.fill(gm & (v < -2), g[3]); c.fill(gm & (v > 2), g[1])
    # grip
    grm = (u > 1) & (u <= 6) & (np.abs(v) < 1.3)
    c.fill(grm, grip[2]); c.fill(grm & (v < 0), grip[3]); c.fill(grm & (v > .6), grip[1])
    if wrap:
        wr = grm & ((np.floor(u * 1.3) % 2) == 0)
        c.fill(wr, wrap[1]); c.fill(wr & (v < 0), wrap[2])
    pm = c.empty()
    if pommel:
        pm = (u - (-0.3)) ** 2 + v ** 2 < 4.2
        p = [hx(x) for x in pommel]
        c.fill(pm, p[2]); c.fill(pm & (v < 0) & (u < 0), p[3]); c.fill(pm & (v > .5), p[1])
    allm = bm | gm | grm | pm
    c.outline(allm, OUT_LIT, OUT)
    return allm


FLINT = ['#1e1a1a', '#3d3532', '#625750', '#8c7f72', '#b9ad9c']
SLATE = ['#151a22', '#29323f', '#43505e', '#647686', '#93a5b0']
BASALT = ['#0e0c12', '#1c1922', '#2e2a36', '#45404f', '#6a6474']
BONE = ['#5a5040', '#8a7e64', '#b9ad8c', '#ddd2b2']
LEATHER = ramp('#1e120e', '#3a2418', '#5e3a24', '#82552f')


def sword_flint():
    c = Canvas(32, 32)
    sword(c, FLINT, L=28, w0=2.9, grip=M['wood'], wrap=LEATHER, knap=1.1, seed=3)
    # lashing over the blade tang
    u, v = frame(c)
    lash = (np.abs(u - 8) < 1.2) & (np.abs(v) < 3.3)
    c.fill(lash, LEATHER[2]); c.fill(lash & (v < 0), LEATHER[3]); c.outline(lash, OUT)
    return c


def sword_slate():
    c = Canvas(32, 32)
    sword(c, SLATE, L=29, w0=2.4, guard=BONE, grip=LEATHER, wrap=[hx('#2a1a14'), hx('#6a4a30'), hx('#8a6a46')],
          pommel=BONE, fuller='#7fe0ff')
    return c


def sword_basalt():
    c = Canvas(32, 32)
    sword(c, BASALT, L=29, w0=3.0, guard=['#1c1922', '#2e2a36', '#585663', '#7b7884'], grip=M['wood'],
          wrap=LEATHER, pommel=['#1c1922', '#2e2a36', '#585663', '#7b7884'], crack='#ff8a3a', knap=.6, seed=7)
    return c


# ------------------------------------------------------------------ armour (front view)
def torso_mask(c, sleeve=True):
    m = c.m_poly([(9, 7), (13, 5), (19, 5), (23, 7), (24, 27), (8, 27)])
    if sleeve:
        m |= c.m_poly([(9, 7), (4, 10), (3, 17), (7, 18), (9, 13)])
        m |= c.m_poly([(23, 7), (28, 10), (29, 17), (25, 18), (23, 13)])
    neck = c.m_ellipse(16, 5, 4, 3)
    return m & ~neck


def armour_gambeson():
    c = Canvas(32, 32)
    cloth = M['cloth_cream']
    m = torso_mask(c)
    c.shade(m, [hx('#4a3e30')] + cloth, soft=3, dither=False)
    # diamond quilting
    q = m & (((c.xx + c.yy) % 6 == 0) | ((c.xx - c.yy) % 6 == 0)) & (c.yy > 7)
    c.fill(q, cloth[1]); c.fill(q & (c.xx >= 19), hx('#4a3e30'))

    # collar, rope belt, toggles
    col = c.m_ellipse(16, 6, 5, 2.5) & ~c.m_ellipse(16, 5, 3.5, 2.5)
    c.shade(col, cloth, soft=1)
    belt = c.m_rect(8, 20, 24, 21) & m
    c.fill(belt, M['thatch'][2]); c.fill(belt & ((c.xx % 2) == 0), M['thatch'][3]); c.fill(belt & (c.yy == 21), M['thatch'][1])
    for y in (9, 13, 17):
        c.px(16, y, M['wood'][1])
    c.fill(c.m_rect(16, 7, 16, 19) & m, cloth[1])
    c.outline(m, OUT_LIT, OUT)
    return c


def armour_leather():
    c = Canvas(32, 32)
    lea = ramp('#1e120e', '#3a2418', '#5e3a24', '#82552f', '#a6744a')
    m = torso_mask(c, sleeve=False)
    m |= c.m_ellipse(8, 9, 4, 3) | c.m_ellipse(24, 9, 4, 3)   # shoulder caps
    m &= ~c.m_ellipse(16, 5, 4, 3)
    c.shade(m, lea, soft=3, dither=False)
    # stitched panels
    for x in (12, 20):
        c.fill(m & (c.xx == x) & (c.yy > 10) & (c.yy % 2 == 0), lea[1])
    c.fill(m & (c.yy == 15) & (c.xx > 9) & (c.xx < 23), lea[1])
    # straps across
    strap = c.m_line([(9, 8), (22, 22)], 2) & m
    c.fill(strap, lea[1]); c.fill(strap & ~np.roll(strap, 1, 0), lea[2])
    # rivets
    for x, y in ((6, 9), (9, 8), (23, 8), (26, 9), (11, 11), (14, 14), (17, 17), (20, 20)):
        c.px(x, y, '#c9c4b8'); c.px(x + 1, y + 1, '#585663')
    belt = c.m_rect(8, 22, 24, 24) & m
    c.fill(belt, lea[1]); c.fill(belt & (c.yy == 22), lea[2])
    bk = c.m_rect(15, 22, 17, 24)
    c.fill(bk, M['gold'][2]); c.px(16, 23, lea[0]); c.px(15, 22, M['gold'][3])
    c.outline(m, OUT_LIT, OUT)
    return c


def armour_hide():
    c = Canvas(32, 32)
    hide = ramp('#2a1c16', '#4a3226', '#6e4c36', '#93704e', '#b39270')
    m = torso_mask(c, sleeve=False) & (c.yy > 6)
    c.shade(m, hide, soft=3, dither=False)
    # patch seams in a stitched cross-hatch
    for pts in ([(9, 14), (23, 13)], [(15, 6), (14, 26)], [(10, 21), (23, 22)]):
        s = c.m_line(pts, 1) & m
        c.fill(s, hide[1])
        ys, xs = np.nonzero(s)
        for x, y in list(zip(xs, ys))[::2]:
            c.px(x, y - 1, hide[3])
    # one darker spotted patch
    p = c.m_rect(16, 15, 22, 20) & m
    c.fill(p & ((c.xx * 3 + c.yy * 5) % 7 == 0), hide[1])
    # fur collar
    fur = M['fur']
    fm = c.m_ellipse(16, 7, 9.5, 3.6)
    rng = np.random.default_rng(5)
    for x in range(6, 27, 2):
        L = 10 + int(rng.integers(0, 3)) - abs(x - 16) // 5
        fm |= c.m_poly([(x - 1, 8), (x + 2, 8), (x + int(rng.integers(-1, 2)), L)])
    for x in range(8, 25, 3):
        fm |= c.m_poly([(x - 1, 5), (x + 2, 5), (x + 1, 2 + int(rng.integers(0, 2)))])
    fm &= ~c.m_ellipse(16, 4, 3.5, 2.5)
    c.shade(fm, fur[1:], soft=1.6, dither=False)
    for x in range(7, 26, 2):
        c.px(x, 6 + (x % 3), fur[5]); c.px(x + 1, 9 + (x % 2), fur[2])
    # bone toggles
    for y in (15, 19):
        c.fill(c.m_rect(14, y, 17, y), BONE[3]); c.px(17, y, BONE[1])
    c.outline(m | fm, OUT_LIT, OUT)
    return c


# ------------------------------------------------------------------ rats (side view, facing left)
def rat(c, fur, *, eye_col='#ff3b2f', tail='#c98a8a', hunch=0, mange=False, pustules=None, teeth=False, scale=1.0, glow_eye=False):
    cx = 18
    body = c.m_ellipse(cx, 21 - hunch, 8.5 * scale, (5.5 + hunch * .6) * scale) | c.m_ellipse(cx + 4, 22, 5.5 * scale, 5 * scale)
    head = c.m_ellipse(9, 20 - hunch * .4, 5 * scale, 4 * scale) | c.m_poly([(9, 17 - hunch * .4), (2, 21), (3, 22), (9, 24)])
    ear = c.m_ellipse(11, 15 - hunch * .6, 2.2, 2.5)
    # tail: curving line
    t = np.linspace(0, 1, 30)
    tx = 25 + t * 6
    ty = 24 + 4 * np.sin(t * np.pi * .8) - t ** 3 * 9
    tm = c.empty()
    for i in range(len(t)):
        w = .9 * (1 - t[i]) + .35
        tm |= c.m_ellipse(tx[i], ty[i], w, w)
    tr = ramp('#3a1e24', tail, mix(hx(tail), hx('#ffffff'), .25))
    c.fill(tm, tr[1]); c.fill(tm & ~np.roll(tm, 1, 0), tr[2])
    for i in range(0, 30, 4):
        c.px(int(tx[i]), int(ty[i]), tr[0])
    c.outline(tm, OUT)
    # back legs, front legs
    legs = c.m_rect(22, 25, 24, 28) | c.m_rect(8, 24, 9, 28) | c.m_rect(12, 25, 13, 28)
    c.fill(legs, fur[1])
    for x in (8, 12, 22):
        c.fill(c.m_rect(x - 1, 28, x + 2, 28), tr[1])
    c.outline(legs, OUT)
    allm = body | head
    c.shade(allm, fur, soft=2.2)
    # belly lighter
    belly = allm & (c.yy > 22 + 0) & (c.xx > 9) & (c.xx < 25)
    c.tint(belly, fur[-1], .25)
    # fur strokes
    for x in range(12, 27, 2):
        y = int(16 - hunch + abs(x - cx) * .35)
        if allm[y + 1, x]:
            c.px(x, y + 1, fur[-1] if x < cx else fur[2])
    if mange:
        rng = np.random.default_rng(2)
        ys, xs = np.nonzero(body)
        for i in rng.choice(len(xs), 14, replace=False):
            c.px(xs[i], ys[i], '#8a5a5a')
        for x, y in ((20, 17), (21, 18), (22, 17)):
            c.px(x, y - hunch, '#c46a5a')
    c.shade(ear, [fur[1], tr[1], tr[2]], soft=1)
    c.px(11, 15 - hunch, tr[0])
    c.outline(allm | ear, OUT)
    # nose, whiskers, eye
    c.px(2, 21, '#e88a9a'); c.px(2, 22, '#c46a7a')
    for x, y in ((4, 19), (5, 19), (3, 23), (4, 24)):
        if not allm[y, x]:
            c.px(x, y, '#d9d0bc')
    ey = int(19 - hunch * .4)
    c.px(7, ey, eye_col); c.px(8, ey, eye_col); c.px(7, ey - 1, '#ffffff' if not glow_eye else eye_col)
    if glow_eye:
        c.glow(7.5, ey, 5, eye_col, .5, steps=2)
    if teeth:
        c.px(4, 23, '#efe0a8'); c.px(5, 23, '#efe0a8'); c.px(4, 24, '#c9b878')
    if pustules:
        for x, y in ((15, 17), (20, 19), (24, 18), (17, 22), (11, 18)):
            c.px(x, y - hunch, pustules); c.px(x, y - hunch - 1, mix(hx(pustules), hx('#ffffff'), .5))
            c.glow(x, y - hunch, 3, pustules, .3, steps=2)
    return c


def rat_sewer():
    c = Canvas(32, 32)
    fur = ramp('#1e1618', '#3a2c2a', '#5a4640', '#7a6458', '#9a8270')
    rat(c, fur)
    return c


def rat_giant():
    c = Canvas(32, 32)
    fur = ramp('#141114', '#262024', '#3a3236', '#524649', '#6c5e5e')
    rat(c, fur, eye_col='#ffcf3a', tail='#a87878', hunch=2, mange=True, teeth=True, scale=1.08, glow_eye=True)
    return c


def rat_blight():
    c = Canvas(32, 32)
    fur = ramp('#141a14', '#26301f', '#3b4a2c', '#56663a', '#768a4c')
    rat(c, fur, eye_col='#c8ff5a', tail='#8aa070', hunch=1, pustules='#b6ff4a', glow_eye=True)
    return c


SPRITES = [
    ('p1_wanderer', portrait_wanderer, 6), ('p2_squire', portrait_squire, 6), ('p3_runic', portrait_runic, 6),
    ('w1_flint', sword_flint, 8), ('w2_slate', sword_slate, 8), ('w3_basalt', sword_basalt, 8),
    ('a1_gambeson', armour_gambeson, 8), ('a2_leather', armour_leather, 8), ('a3_hide', armour_hide, 8),
    ('e1_sewer_rat', rat_sewer, 8), ('e2_giant_rat', rat_giant, 8), ('e3_blight_rat', rat_blight, 8),
]

if __name__ == '__main__':
    os.makedirs(OUTDIR, exist_ok=True)
    for name, fn, s in SPRITES:
        c = fn()
        c.save(f'{OUTDIR}/{name}.png', s)
        c.save(f'{OUTDIR}/{name}_1x.png', 1)
    print('ok')
