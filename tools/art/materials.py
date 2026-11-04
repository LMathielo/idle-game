"""Materials, 32x32 item icons: logs and planks (5 woods), stone, stone brick, ores and ingots (copper, iron, silver, gold).
Shapes are shared per material type; species / metal changes the colours and a signature detail."""
import sys, os
import numpy as np
from pix import Canvas, ramp, hx, mix, BAYER
from elements import OUT, OUT_LIT
from equipment import TIERS

OUTDIR = sys.argv[1] if len(sys.argv) > 1 else 'out/materials'
ROCK = ramp('#2a2832', '#45424e', '#68646f', '#8f8b8f', '#b3aeaa', '#d0cac4')

# bark ramp, end-grain ramp, signature
WOODS = {
    'oak': dict(bark=ramp('#24160f', '#3f2719', '#5e3c22', '#7e5530', '#9a6c3e'), grain=ramp('#7a5530', '#a87a48', '#c89a62', '#e0b880'),
                plank=TIERS['stone']['wood']),
    'birch': dict(bark=ramp('#4a4640', '#9a948a', '#cfc9bc', '#ebe6da', '#faf7f0'), grain=ramp('#a08a68', '#c8b08a', '#e0cca6', '#f2e4c4'),
                  plank=TIERS['copper']['wood'], marks='#2a2624'),
    'maple': dict(bark=ramp('#2a1410', '#4a2418', '#6a3824', '#8a4c30', '#a8623e'), grain=ramp('#9a5a3a', '#c07a52', '#d89a6e', '#ecba8e'),
                  plank=ramp('#5a3020', '#8a5236', '#b4764e', '#d49a6c', '#ecbe8e')),
    'yew': dict(bark=ramp('#1e0e0c', '#3a1a14', '#5a2a1c', '#7a3c26', '#9a5034'), grain=ramp('#8a3018', '#b44a22', '#d4703a', '#ecc08a'),
                plank=ramp('#3a140c', '#6a2614', '#9a3a1c', '#c4582a', '#e0804a'), heart=True),
    'ironwood': dict(bark=ramp('#141218', '#24222a', '#363440', '#4a4854', '#64606c'), grain=ramp('#3a3436', '#584e4e', '#766a66', '#948680'),
                     plank=TIERS['gold']['wood'], sheen='#8a9ab0'),
}
METALS = {
    'copper': dict(metal=TIERS['copper']['metal'], fleck='#4ab89a', rock=ramp('#2e2624', '#4a3e38', '#6a5a50', '#8a786a', '#aa9686', '#c8b4a2')),
    'iron': dict(metal=TIERS['iron']['metal'], fleck='#a8503a', rock=ramp('#281e1e', '#423434', '#5e4c4a', '#7e6864', '#9e8680', '#bca49c')),
    'silver': dict(metal=TIERS['silver']['metal'], fleck='#ffffff', rock=ramp('#22242e', '#383c4a', '#545a6a', '#747a8a', '#969cac', '#b8beca')),
    'gold': dict(metal=TIERS['gold']['metal'], fleck='#fff4c0', rock=ramp('#2c2620', '#463e34', '#665a4a', '#867864', '#a69882', '#c4b6a0')),
}


def axis_frame(c, ox, oy, ang=30):
    a = np.radians(ang)
    ax = np.array([np.cos(a), -np.sin(a)])
    px_, py_ = c.xx + .5 - ox, c.yy + .5 - oy
    u = px_ * ax[0] + py_ * ax[1]
    v = px_ * -ax[1] + py_ * ax[0]
    return u, v


# ------------------------------------------------------------------ logs
def log(c, ox, oy, L, r, w, seed=0, dark=0.0):
    u, v = axis_frame(c, ox, oy)
    bark = [mix(x, hx('#000000'), dark) for x in w['bark']]
    body = (u >= 0) & (u <= L) & (np.abs(v) <= r) | (((u - L) / (r * .55)) ** 2 + (v / r) ** 2 <= 1)
    c.fill(body, bark[2]); c.fill(body & (v < -r * .35), bark[3]); c.fill(body & (v < -r * .75), bark[4]); c.fill(body & (v > r * .45), bark[1])
    rng = np.random.default_rng(seed)
    # bark streaks along the log
    for k in range(int(L * 1.2)):
        uu, vv = rng.uniform(1, L), rng.uniform(-r + .5, r - .5)
        ln = rng.uniform(2, 4)
        st = body & (np.abs(v - vv) < .45) & (u > uu) & (u < uu + ln)
        c.fill(st, bark[1] if vv > -r * .3 else bark[2])
    if 'marks' in w:
        for k in range(6):
            uu, vv = rng.uniform(2, L - 1), rng.uniform(-r + 1, r - 1)
            c.fill(body & (np.abs(v - vv) < .5) & (np.abs(u - uu) < 1.4), hx(w['marks']))
    if 'sheen' in w:
        c.fill(body & (np.abs(v + r * .55) < .5) & (u > 2) & (u < L - 2), hx(w['sheen']))
    c.outline(body, OUT_LIT, OUT)
    cap = ((u / (r * .55)) ** 2 + (v / r) ** 2 <= 1)
    g = w['grain']
    d = np.sqrt((u / (r * .55)) ** 2 + (v / r) ** 2)
    c.fill(cap, g[2])
    c.fill(cap & (np.mod(np.floor(d * 4.5), 2) == 0), g[1])
    if w.get('heart'):
        c.fill(cap & (d < .55), g[0]); c.fill(cap & (d >= .55) & (d < .8), g[3])
    c.fill(cap & (d < .18), g[0])
    c.fill(cap & (d > .82), bark[1])
    c.fill(cap & (u < 0) & (v < 0) & (d > .5) & (d < .82), g[3])
    c.outline(cap, OUT)
    return body | cap


def logs(w):
    c = Canvas(32, 32)
    log(c, 10, 18, 16, 4.6, w, seed=1, dark=.18)
    log(c, 5, 26, 18, 5.2, w, seed=2)
    return c


# ------------------------------------------------------------------ planks
def planks(w):
    c = Canvas(32, 32)
    p = w['plank']
    allm = c.empty()
    for k, (ox, oy) in enumerate(((4, 27), (7, 21), (3, 15))):
        u, v = axis_frame(c, ox, oy, 25)
        top = (u >= 0) & (u <= 22) & (v >= -3.2) & (v <= 1.2)
        edge = (u >= 0) & (u <= 22) & (v > 1.2) & (v <= 3.2)
        end = (u >= -1.4) & (u < 0) & (v >= -3.2) & (v <= 3.2)
        c.fill(top, p[3]); c.fill(top & (v < -2.2), p[4])
        for gv in (-1.5, .2):
            c.fill(top & (np.abs(v - gv - .4 * np.sin(u * .5 + k)) < .35), p[2])
        c.fill(edge, p[1]); c.fill(edge & (np.abs(v - 2.2) < .4), p[2])
        c.fill(end, w['grain'][2]); c.fill(end & (np.abs(v) < 1), w['grain'][1])
        m = top | edge | end
        c.outline(m, OUT_LIT, OUT)
        allm |= m
    return c


# ------------------------------------------------------------------ rocks, ores
def rock_shape(c, rmp, seed=3):
    pts = [(4, 26), (3, 19), (7, 12), (13, 8), (20, 8), (26, 12), (29, 19), (27, 26), (18, 28), (10, 28)]
    m = c.m_poly(pts)
    c.shade(m, rmp[:5], soft=2.5)
    # facets: two ridge lines
    for pts2 in ([(13, 8), (12, 16), (4, 22)], [(12, 16), (21, 18), (27, 13)], [(21, 18), (20, 27)]):
        ln = c.m_line(pts2) & m
        c.fill(ln, rmp[1])
        c.fill(np.roll(ln, -1, 1) & m & ~ln & (c.xx < 16), rmp[4])
    c.fill(m & (c.yy < 12) & (c.xx < 18), rmp[4])
    c.px(10, 11, rmp[5]); c.px(11, 10, rmp[5])
    c.outline(m, OUT_LIT, OUT)
    return m


def stone():
    c = Canvas(32, 32)
    rock_shape(c, ROCK)
    return c


def ore(mt):
    c = Canvas(32, 32)
    m = rock_shape(c, mt['rock'])
    me = mt['metal']
    rng = np.random.default_rng(7)
    for (x, y, s) in ((9, 18, 2.2), (17, 13, 2.6), (21, 21, 2.0), (14, 23, 1.6), (24, 15, 1.4)):
        nug = c.m_poly([(x - s, y), (x, y - s * 1.1), (x + s, y - .3), (x + .4, y + s)]) & m
        c.fill(nug, me[3]); c.fill(nug & (c.xx + c.yy < x + y - .5), me[4]); c.fill(nug & (c.xx + c.yy > x + y + 1), me[1])
        c.px(int(x - s / 2), int(y - s / 2), me[5])
        c.outline(nug, me[0])
    for _ in range(8):
        x, y = rng.integers(6, 27), rng.integers(11, 27)
        if m[y, x]:
            c.px(x, y, mt['fleck'])
    return c


# ------------------------------------------------------------------ bricks, ingots (3/4 boxes)
def prism(c, x0, y0, L, h, d, rmp, inset=0):
    front = c.m_poly([(x0, y0), (x0 + L, y0), (x0 + L - inset, y0 - h), (x0 + inset, y0 - h)])
    top = c.m_poly([(x0 + inset, y0 - h), (x0 + L - inset, y0 - h), (x0 + L - inset + d, y0 - h - d), (x0 + inset + d, y0 - h - d)])
    side = c.m_poly([(x0 + L, y0), (x0 + L + d, y0 - d), (x0 + L - inset + d, y0 - h - d), (x0 + L - inset, y0 - h)])
    c.fill(side, rmp[1]); c.fill(front, rmp[2]); c.fill(top, rmp[4])
    c.fill(front & (c.yy == y0 - h), rmp[3])
    c.fill(top & ~np.roll(top, 1, 0), rmp[5] if len(rmp) > 5 else rmp[4])
    m = front | top | side
    c.outline(m, OUT_LIT, OUT)
    return m, front, top, side


def stone_brick():
    c = Canvas(32, 32)
    rng = np.random.default_rng(2)
    for (x0, y0) in ((2, 28), (15, 28), (8, 20)):
        m, f, t, s = prism(c, x0, y0, 12, 7, 4, ROCK)
        for _ in range(7):
            x, y = rng.integers(x0, x0 + 12), rng.integers(y0 - 11, y0)
            if f[y, x]:
                c.px(x, y, ROCK[1])
            elif t[y, x]:
                c.px(x, y, ROCK[3])
        c.px(x0 + 2, y0 - 2, ROCK[4]); c.px(x0 + 9, y0 - 4, ROCK[1])
    return c


def ingot(mt):
    c = Canvas(32, 32)
    me = mt['metal']
    prism(c, 3, 28, 20, 5, 6, me, inset=2)
    m, f, t, s = prism(c, 7, 21, 18, 5, 6, me, inset=2)
    # stamp on the top face
    for p in ((15, 14), (16, 13), (17, 14), (16, 15)):
        c.px(p[0] + 1, p[1], me[3])
    # shine on the front edge
    c.px(10, 17, me[5]); c.px(11, 17, me[5])
    return c


SET = []
for wn, w in WOODS.items():
    SET.append((f'{wn}_logs', (lambda w=w: logs(w)), f'{wn.capitalize()} Logs', '🪵'))
for wn, w in WOODS.items():
    SET.append((f'{wn}_plank', (lambda w=w: planks(w)), f'{wn.capitalize()} Plank', '🪚'))
SET += [('stone', stone, 'Stone', '🪨'), ('stone_brick', stone_brick, 'Stone Brick', '🧱')]
for mn, mt in METALS.items():
    SET.append((f'{mn}_ore', (lambda mt=mt: ore(mt)), f'{mn.capitalize()} Ore', ''))
for mn, mt in METALS.items():
    SET.append((f'{mn}_ingot', (lambda mt=mt: ingot(mt)), f'{mn.capitalize()} Ingot', ''))

if __name__ == '__main__':
    os.makedirs(OUTDIR, exist_ok=True)
    from PIL import Image
    S = 5
    cols = 5
    rows = (len(SET) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (32 * S + 12) + 12, rows * (32 * S + 12) + 12), (58, 42, 28))
    for i, (n, fn, _, _) in enumerate(SET):
        c = fn()
        c.save(f'{OUTDIR}/{n}_1x.png', 1); c.save(f'{OUTDIR}/{n}.png', 4)
        im = c.image(S)
        sheet.paste(im, (12 + (i % cols) * (32 * S + 12), 12 + (i // cols) * (32 * S + 12)), im)
    sheet.save(f'{OUTDIR}/_sheet.png')
    print('ok', len(SET))
