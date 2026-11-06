"""Craftable equipment: 7 pieces x 5 tiers (sword, helm, chestplate, shield, greaves, gloves, boots), 32x32 item icons.
One silhouette per piece; each tier changes material, wood, trim and ornament:
  stone  - stone blocks lashed with leather to oak, chipped edges
  copper - warm hammered copper, iron rivets, birch wood
  iron   - dark iron, brass trim and rivets, maple wood
  silver - bright cool silver, gold trim, engraved lines, blue gem, yew wood
  gold   - gold, silver trim, engraving, red gem, plume/crest, ironwood
"""
import sys, os
import numpy as np
from pix import Canvas, ramp, hx, mix
from elements import OUT, OUT_LIT

OUTDIR = sys.argv[1] if len(sys.argv) > 1 else 'out/equipment'
LEATHER = ramp('#1e120e', '#3a2418', '#5e3a24', '#82552f', '#a6744a')

TIERS = {
    'stone': dict(metal=ramp('#24222c', '#3c3a47', '#585663', '#7b7884', '#a19d9f', '#c4bfb6'),
                  trim=LEATHER, wood=ramp('#2e1c12', '#4a2e1a', '#6b4528', '#8a5e36', '#ab7a45'),
                  gem=None, orn=0, field='#6b4528'),
    'copper': dict(metal=ramp('#3a1a10', '#6a3218', '#a3552a', '#d0803e', '#f0aa66', '#ffd6a0'),
                   trim=ramp('#1a1a22', '#2e2e38', '#4a4a56', '#6e6e7a', '#9a9aa4'),
                   wood=ramp('#4a4238', '#7a6e5c', '#a89a82', '#cfc3a8', '#ece4d0'), gem=None, orn=1, field='#8a2a2a'),
    'iron': dict(metal=ramp('#1a1a22', '#2e2e38', '#4a4a56', '#6e6e7a', '#9a9aa4', '#c4c4cc'),
                 trim=ramp('#5a3a12', '#8f6420', '#b8862a', '#d8a848', '#f0cc78'),
                 wood=ramp('#3a1a14', '#5e2a1e', '#8a4430', '#b0603e', '#cc8456'), gem=None, orn=2, field='#2a4a7a'),
    'silver': dict(metal=ramp('#2a3040', '#4a5468', '#7a869a', '#aab6c6', '#d4dde8', '#f4f8fc'),
                   trim=ramp('#5a3a12', '#8f6420', '#c9962f', '#efc65a', '#fff0a8'),
                   wood=ramp('#2a1410', '#4a2418', '#6e3824', '#924e30', '#b06a40'), gem=('#1a2a6a', '#3a6ad8', '#9ac8ff'), orn=3,
                   field='#1e2e5e'),
    'gold': dict(metal=ramp('#4a2e0e', '#7a5418', '#b8862a', '#e0b040', '#f6d870', '#fff4c0'),
                 trim=ramp('#2a3040', '#4a5468', '#7a869a', '#aab6c6', '#e4ecf4'),
                 wood=ramp('#1c1a1e', '#302c30', '#4a4246', '#665c5c', '#867a74'), gem=('#5a0a18', '#c02838', '#ff8a8a'), orn=4,
                 field='#7a1a2a'),
}


def gem(c, x, y, g, r=1.5):
    if not g:
        return c.empty()
    m = c.m_ellipse(x, y, r, r)
    c.fill(m, hx(g[1])); c.fill(m & (c.xx + c.yy < x + y), hx(g[2])); c.fill(m & (c.xx + c.yy > x + y + 1), hx(g[0]))
    c.px(int(x - r / 2), int(y - r / 2), '#ffffff')
    return m


def chips(c, mask, t, seed):
    """Stone tier: cracks and chips."""
    rng = np.random.default_rng(seed)
    ys, xs = np.nonzero(mask)
    for i in rng.choice(len(xs), max(1, len(xs) // 14), replace=False):
        c.px(xs[i], ys[i], t['metal'][1])
        if rng.random() < .5:
            c.px(xs[i] - 1, ys[i] - 1, t['metal'][4])


def rivets(c, pts, t):
    col = t['trim'][3] if t['orn'] >= 1 else None
    if col is None:
        return
    for x, y in pts:
        c.px(x, y, col); c.px(x + 1, y + 1, t['trim'][1])


# ------------------------------------------------------------------ sword (diagonal, hilt bottom-left)
def frame(c, ox=4.0, oy=28.0):
    ax = np.array([1, -1]) / np.sqrt(2)
    px_, py_ = c.xx + .5 - ox, c.yy + .5 - oy
    return px_ * ax[0] + py_ * ax[1], px_ * -ax[1] + py_ * ax[0]


def sword(t, seed=1):
    c = Canvas(32, 32)
    u, v = frame(c)
    m = t['metal']
    L = 32
    w0 = 3.3 if t['orn'] == 0 else 2.9
    taper = np.clip((L - u) / 7, 0, 1)
    jit = 0
    if t['orn'] == 0:
        rng = np.random.default_rng(seed)
        tbl = rng.random(64) * 1.0
        jit = tbl[np.clip(np.floor(u / 2).astype(int), 0, 63)] - .5
    hw = (w0 + jit) * np.where(u < L - 7, 1, taper ** .8)
    bm = (u > 7) & (u < L) & (np.abs(v) < hw)
    c.fill(bm, m[2]); c.fill(bm & (v < -.3), m[3]); c.fill(bm & (v < -hw + 1), m[4]); c.fill(bm & (v > hw - 1.2), m[1])
    if t['orn'] == 0:
        facet = ((np.floor(u / 2) + (v > 0)) % 2 == 0) & (np.abs(v) > .6) & bm
        c.fill(facet & (v < 0), m[4]); c.fill(facet & (v > 0), m[1])
    else:
        c.fill(bm & (np.abs(v) < .6) & (u > 9) & (u < L - 6), m[1])       # fuller
        c.fill(bm & (v < -hw + 1) & (u > 10) & (u < L - 3), m[5])          # edge shine
        if t['orn'] >= 3:
            for uu in (12, 16, 20):
                c.fill(bm & (np.abs(u - uu) < .6) & (np.abs(v) < .7), hx(t['trim'][3]))
    gw = 4 + t['orn'] * .6
    gm = (np.abs(u - 6.5) < 1.2) & (np.abs(v) < gw)
    tr = t['trim'] if t['orn'] > 0 else t['wood']
    c.fill(gm, tr[2]); c.fill(gm & (v < -1), tr[3]); c.fill(gm & (v > 1.5), tr[1])
    if t['orn'] >= 2:
        c.fill(gm & (np.abs(v) > gw - 1.2), tr[4])
    grm = (u > 1) & (u <= 6) & (np.abs(v) < 1.3)
    w = t['wood']
    c.fill(grm, w[2]); c.fill(grm & (v < 0), w[3]); c.fill(grm & (v > .6), w[1])
    wr = grm & ((np.floor(u * 1.3) % 2) == 0)
    c.fill(wr, LEATHER[1]); c.fill(wr & (v < 0), LEATHER[2])
    pm = (u + .3) ** 2 + v ** 2 < (4.2 if t['orn'] else 3.2)
    c.fill(pm, tr[2]); c.fill(pm & (v < 0) & (u < 0), tr[3]); c.fill(pm & (v > .5), tr[1])
    allm = bm | gm | grm | pm
    if t['orn'] == 0:
        lash = (np.abs(u - 8) < 1.2) & (np.abs(v) < 3.2)
        c.fill(lash, LEATHER[2]); c.fill(lash & (v < 0), LEATHER[3]); allm |= lash
    c.outline(allm, OUT_LIT, OUT)
    if t['gem']:
        gem(c, 2.8, 29.0, t['gem'], 1.2)
    return c


# ------------------------------------------------------------------ helm (front)
def helm(t):
    c = Canvas(32, 32)
    m = t['metal']
    dy = 2
    dome = c.m_ellipse(16, 15 + dy, 10.5, 11) & (c.yy <= 16 + dy)
    cheeks = c.m_poly([(5, 15 + dy), (27, 15 + dy), (26, 25 + dy), (21, 28 + dy), (11, 28 + dy), (6, 25 + dy)])
    face = c.m_poly([(9, 17), (14, 17), (14, 21), (13, 26), (19, 26), (18, 21), (18, 17), (23, 17), (23, 19), (9, 19)])
    face = (c.m_rect(9, 17 + dy, 23, 19 + dy) | c.m_rect(12, 19 + dy, 20, 26 + dy)) & ~c.m_rect(15, 15 + dy, 16, 22 + dy)
    shell = (dome | cheeks) & ~face
    c.shade(shell, m, soft=3)
    c.fill(face, '#120c14')
    # brow band
    band = c.m_rect(5, 14 + dy, 27, 16 + dy) & shell
    tr = t['trim'] if t['orn'] else LEATHER
    c.fill(band, tr[2]); c.fill(band & (c.yy == 14 + dy), tr[3]); c.fill(band & (c.yy == 16 + dy), tr[1])
    # ridge
    c.fill(c.m_rect(15, 4 + dy, 16, 13 + dy) & shell, m[4]); c.fill(c.m_rect(16, 4 + dy, 16, 13 + dy) & shell, m[3])
    if t['orn'] == 0:
        chips(c, shell & ~band, t, 3)
        for x in (8, 23):
            c.fill(c.m_rect(x, 8, x + 1, 26) & shell, LEATHER[2]); c.fill(c.m_rect(x, 8, x, 26) & shell, LEATHER[3])
    rivets(c, [(7, 17), (11, 17), (20, 17), (24, 17), (7, 23), (24, 23)], t)
    if t['orn'] >= 3:
        for x in range(8, 25, 3):
            c.px(x, 11 + abs(x - 16) // 3, hx(t['trim'][3]))
    allm = shell | face
    extra = c.empty()
    if t['orn'] >= 3:
        plume_c = ramp('#1a2a6a', '#2c4886', '#4568ad', '#7a9ad8') if t['orn'] == 3 else ramp('#5a0a18', '#8a1a2a', '#c02838', '#e0566a')
        pl = c.empty()
        for k in range(14):
            tt = k / 13
            px2 = 15.5 + 12 * tt
            py2 = 4.5 - 3.2 * np.sin(tt * np.pi * .8) + tt * 6
            pl |= c.m_ellipse(px2, py2, 2.3 - tt * 1.1, 2.0 - tt * .8)
        pl &= ~shell
        c.shade(pl, plume_c, soft=1)
        extra |= pl
    c.outline(allm | extra, OUT_LIT, OUT)
    gem(c, 15.5, 14, t['gem'], 1.4)
    return c


# ------------------------------------------------------------------ chestplate (front)
def chest(t):
    c = Canvas(32, 32)
    m = t['metal']
    body = c.m_poly([(6, 7), (12, 5), (20, 5), (26, 7), (25, 17), (23, 27), (9, 27), (7, 17)]) & ~c.m_ellipse(16, 4, 5, 4)
    c.shade(body, m, soft=3.5)
    c.fill(body & (c.xx == 16), m[4]); c.fill(body & (c.xx == 17), m[2])
    # fauld bands
    for y in (21, 24):
        c.fill(body & (c.yy == y), m[1])
    belt = c.m_rect(8, 19, 24, 20) & body
    tr = t['trim'] if t['orn'] else LEATHER
    c.fill(belt, LEATHER[2]); c.fill(belt & (c.yy == 19), LEATHER[3])
    bk = c.m_rect(15, 19, 18, 20); c.fill(bk, tr[3]); c.px(16, 20, tr[1])
    # pauldrons
    pd = c.empty()
    for cx, d in ((6, -1), (26, 1)):
        p = c.m_ellipse(cx, 9, 5, 4) & (c.yy <= 12)
        c.shade(p, m, soft=1.5)
        c.fill(p & (c.yy == 12), m[1]); c.fill(p & (c.yy == 10), tr[2] if t['orn'] else m[1])
        pd |= p
    # neck trim
    nt = c.m_ellipse(16, 4, 6, 5) & ~c.m_ellipse(16, 4, 5, 4) & (c.yy >= 5) & (c.yy <= 8)
    c.fill(nt, tr[3])
    if t['orn'] == 0:
        chips(c, body & ~belt, t, 5)
        for y in (9, 14):
            c.fill(c.m_rect(8, y, 24, y) & body, LEATHER[2])
    rivets(c, [(9, 8), (22, 8), (10, 15), (21, 15), (12, 25), (19, 25)], t)
    if t['orn'] >= 3:
        for k in range(5):
            c.px(12 + k, 10 + k, hx(t['trim'][3])); c.px(20 - k, 10 + k, hx(t['trim'][3]))
    c.outline(body | pd | nt, OUT_LIT, OUT)
    gem(c, 16, 13, t['gem'], 1.6)
    return c


# ------------------------------------------------------------------ shield (heater)
def shield(t):
    c = Canvas(32, 32)
    m = t['metal']
    pts = [(5, 4), (27, 4), (27, 14)]
    for k in range(1, 8):
        a = k / 8
        pts.append((27 - 11 * a, 14 + 15 * np.sin(a * np.pi / 2)))
    pts += [(16, 29)]
    for k in range(7, 0, -1):
        a = k / 8
        pts.append((5 + 11 * a, 14 + 15 * np.sin(a * np.pi / 2)))
    pts += [(5, 14)]
    sh = c.m_poly(pts)
    inner = sh & ~(np.roll(sh, 2, 0) ^ sh) & np.roll(np.roll(sh, 2, 1), 2, 0) & np.roll(np.roll(sh, -2, 1), 2, 0) & np.roll(sh, -2, 0)
    rim = sh & ~inner
    w = t['wood']
    if t['orn'] <= 1:
        c.fill(inner, w[2])
        c.fill(inner & (np.mod(c.xx, 4) == 0), w[1]); c.fill(inner & (np.mod(c.xx, 4) == 1), w[3])
        if t['orn'] == 1:
            ch = inner & (np.abs(c.yy - 6 - np.abs(c.xx - 16) * .9) < 1.6)
            c.fill(ch, hx(t['field']))
    else:
        c.fill(inner, hx(t['field']))
        c.fill(inner & (c.xx < 16), mix(hx(t['field']), hx('#ffffff'), .15))
        # chevron in metal
        ch = inner & (np.abs(c.yy - 9 - np.abs(c.xx - 16) * -.9 - 8) < 1.6)
        ch = inner & (np.abs((c.yy - 20) + np.abs(c.xx - 16) * .9) < 1.6)
        c.fill(ch, m[3]); c.fill(ch & (c.xx < 16), m[4])
    c.shade(rim, m if t['orn'] else t['metal'], soft=1.5)
    if t['orn'] == 0:
        chips(c, rim, t, 7)
    # boss
    boss = c.m_ellipse(16, 13, 3.5, 3.5)
    c.shade(boss, m, soft=1)
    rivets(c, [(7, 6), (24, 6), (7, 13), (24, 13), (15, 26)], t)
    if t['orn'] >= 3:
        for x in range(8, 25, 2):
            c.px(x, 5, hx(t['trim'][3]))
    c.outline(sh, OUT_LIT, OUT)
    c.outline(boss, m[0])
    gem(c, 16, 13, t['gem'], 1.6)
    return c


# ------------------------------------------------------------------ gauntlet
def gloves(t):
    c = Canvas(32, 32)
    m = t['metal']
    base = LEATHER if t['orn'] == 0 else m
    cuff = c.m_poly([(8, 30), (24, 30), (23, 21), (10, 21)])
    hand = c.m_poly([(9, 21), (23, 21), (23, 12), (9, 12)])
    fingers = c.empty()
    for i, (x, top) in enumerate(((9, 4), (13, 3), (17, 4), (21, 6))):
        fingers |= c.m_rect(x, top, x + 2, 12) | c.m_ellipse(x + 1, top, 1.5, 1.5)
    thumb = c.m_poly([(9, 14), (4, 10), (3, 12), (8, 19)])
    allm = cuff | hand | fingers | thumb
    c.shade(allm, base, soft=2)
    # finger segments
    for y in (6, 9):
        c.fill(fingers & (c.yy == y), base[1])
    for x in (12, 16, 20):
        c.fill(fingers & (c.xx == x), base[1])
    # knuckle plate
    kn = c.m_rect(9, 11, 23, 13)
    if t['orn'] == 0:
        for x in (10, 14, 18):
            st = c.m_rect(x, 11, x + 2, 13)
            c.fill(st, t['metal'][3]); c.fill(st & (c.yy == 11), t['metal'][4]); c.fill(st & (c.yy == 13), t['metal'][1])
    else:
        c.fill(kn, m[3]); c.fill(kn & (c.yy == 11), m[4]); c.fill(kn & (c.yy == 13), m[1])
    # cuff trim
    tr = t['trim'] if t['orn'] else LEATHER
    ct = c.m_rect(10, 21, 23, 22)
    c.fill(ct & allm, tr[3]); c.fill(c.m_rect(8, 29, 24, 30) & allm, tr[2])
    if t['orn'] == 0:
        c.fill(c.m_rect(9, 25, 24, 25) & cuff, LEATHER[1])
    rivets(c, [(11, 16), (20, 16), (12, 26), (20, 26)], t)
    if t['orn'] >= 3:
        for k in range(4):
            c.px(13 + k * 2, 17, hx(t['trim'][3]))
    c.outline(allm, OUT_LIT, OUT)
    gem(c, 16, 25.5, t['gem'], 1.4)
    return c


# ------------------------------------------------------------------ boots (pair, side view, toes left)
def boots(t):
    c = Canvas(32, 32)
    m = t['metal']
    base = LEATHER if t['orn'] == 0 else m

    def boot(ox, oy, dark):
        shaft = c.m_poly([(12 + ox, 3 + oy), (22 + ox, 3 + oy), (22 + ox, 21 + oy), (12 + ox, 19 + oy)])
        foot = c.m_poly([(3 + ox, 22 + oy), (6 + ox, 18 + oy), (13 + ox, 17 + oy), (22 + ox, 19 + oy), (23 + ox, 25 + oy), (3 + ox, 25 + oy)])
        b = shaft | foot
        r = [mix(x, hx('#000000'), .3) for x in base] if dark else base
        c.shade(b, r, soft=2)
        sole = c.m_rect(3 + ox, 25 + oy, 23 + ox, 26 + oy)
        c.fill(sole, LEATHER[0]); c.fill(sole & (c.yy == 25 + oy), LEATHER[1])
        tr = t['trim'] if t['orn'] else LEATHER
        cuff = c.m_rect(11 + ox, 3 + oy, 23 + ox, 5 + oy)
        c.fill(cuff, tr[3] if not dark else tr[2]); c.fill(cuff & (c.yy == 5 + oy), tr[1])
        # plates / straps
        if t['orn'] == 0:
            for y in (9, 14):
                c.fill(c.m_rect(12 + ox, y + oy, 22 + ox, y + oy), LEATHER[1])
            st = c.m_rect(4 + ox, 20 + oy, 10 + ox, 23 + oy) & foot
            c.fill(st, t['metal'][3 if not dark else 2]); c.fill(st & (c.yy == 20 + oy), t['metal'][4 if not dark else 3])
        else:
            for y in (10, 15):
                c.fill(c.m_rect(12 + ox, y + oy, 22 + ox, y + oy), r[1])
            c.fill(c.m_line([(5 + ox, 21 + oy), (12 + ox, 18 + oy)]), r[4])
        if not dark:
            rivets(c, [(14 + ox, 7 + oy), (20 + ox, 7 + oy), (8 + ox, 21 + oy)], t)
            if t['orn'] >= 3:
                for k in range(4):
                    c.px(13 + ox + k * 2, 12 + oy, hx(t['trim'][3]))
        return b | sole | cuff
    back = boot(7, -2, True)
    c.outline(back, OUT)
    front = boot(0, 4, False)
    c.outline(front, OUT_LIT, OUT)
    gem(c, 17, 9.5, t['gem'], 1.3)
    return c


# ------------------------------------------------------------------ greaves (leg guards, front view, pair)
def greaves(t):
    c = Canvas(32, 32)
    m = t['metal']
    tr = t['trim'] if t['orn'] else LEATHER
    # waist belt joining the two legs
    belt = c.m_rect(6, 3, 25, 6)
    legs = c.empty()
    guards = c.empty()
    for x0, x1, dark in ((6, 14, False), (17, 25, True)):
        thigh = c.m_poly([(x0, 6), (x1, 6), (x1 - 1, 15), (x0 + 1, 15)])
        shin = c.m_poly([(x0 + 1, 15), (x1 - 1, 15), (x1 - 1, 25), (x0 + 1, 25)])
        foot = c.m_poly([(x0 - 1, 25), (x1 + 1, 25), (x1 + 1, 29), (x0 - 2, 29)])
        g = thigh | shin | foot
        r = [mix(v, hx('#000000'), .22) for v in m] if dark else m
        c.shade(g, r, soft=2.2)
        knee = c.m_ellipse((x0 + x1) / 2, 15, 4.4, 2.6)
        c.shade(knee, r, soft=1)
        c.fill(c.m_rect(x0 - 1, 25, x1 + 1, 25) & g, r[1])             # ankle line
        c.fill(c.m_rect(x0 - 2, 28, x1 + 1, 29) & g, LEATHER[1])        # sole
        if t['orn'] == 0:
            chips(c, g, t, 11 if dark else 9)
            for y in (10, 20):
                c.fill(c.m_rect(x0 + 1, y, x1 - 1, y) & g, LEATHER[2])    # lashing straps
        else:
            c.fill(c.m_rect((x0 + x1) // 2, 17, (x0 + x1) // 2, 24) & g, r[4])   # shin ridge
        if not dark:
            rivets(c, [(x0 + 2, 8), (x1 - 3, 8), (x0 + 2, 22), (x1 - 3, 22)], t)
        legs |= g | knee
    c.shade(belt, tr, soft=1)
    c.fill(belt & (c.yy == 3), tr[3]); c.fill(belt & (c.yy == 6), tr[1])
    bk = c.m_rect(14, 3, 17, 6); c.fill(bk, tr[4] if t['orn'] else LEATHER[3]); c.px(15, 5, tr[1])
    if t['orn'] >= 3:
        for k in range(4):
            c.px(8 + k * 5, 4, hx(t['trim'][3]))
    allm = legs | belt
    c.outline(allm, OUT_LIT, OUT)
    gem(c, 10, 15, t['gem'], 1.3); gem(c, 21, 15, t['gem'], 1.3)
    return c


PIECES = [('sword', sword, 'Sword', '⚔️'), ('helm', helm, 'Helm', '🪖'), ('chestplate', chest, 'Chestplate', '🦺'),
          ('shield', shield, 'Shield', '🛡️'), ('greaves', greaves, 'Greaves', '🦿'), ('gloves', gloves, 'Gloves', '🧤'),
          ('boots', boots, 'Boots', '🥾')]

if __name__ == '__main__':
    os.makedirs(OUTDIR, exist_ok=True)
    from PIL import Image
    S = 5
    sheet = Image.new('RGB', (len(PIECES) * 32 * S + (len(PIECES) + 1) * 12, 5 * 32 * S + 6 * 12), (58, 42, 28))
    for r, (tn, t) in enumerate(TIERS.items()):
        for col, (pn, fn, _, _) in enumerate(PIECES):
            c = fn(t)
            c.save(f'{OUTDIR}/{tn}_{pn}_1x.png', 1)
            c.save(f'{OUTDIR}/{tn}_{pn}.png', 4)
            im = c.image(S)
            sheet.paste(im, (12 + col * (32 * S + 12), 12 + r * (32 * S + 12)), im)
    sheet.save(f'{OUTDIR}/_sheet.png')
    print('ok')
