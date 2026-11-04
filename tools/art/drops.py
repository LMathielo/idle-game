"""Dungeon drops, junk and potions, 32x32 item icons. Drops reuse their creature's palette."""
import sys, os
import numpy as np
from pix import Canvas, ramp, hx, mix
from elements import OUT, OUT_LIT

OUTDIR = sys.argv[1] if len(sys.argv) > 1 else 'out/drops'
RAT = ramp('#1e1618', '#3a2c2a', '#5a4640', '#7a6458', '#9a8270')
BATW = ramp('#1e1420', '#33223a', '#4a3252', '#6a4a70', '#8a6a90')
WOLF = ramp('#1c1a22', '#34303a', '#524c56', '#746c74', '#9a9096', '#c4bab8')
CREAM = ramp('#6a6058', '#a89a88', '#d4c8b4', '#eee6d6')
BONE = ramp('#4a4038', '#8a7e64', '#b9ad8c', '#ddd2b2', '#f2ead2')
TROLL = ramp('#1a2218', '#2a3824', '#3e5232', '#566e42', '#728a54', '#92a868')
LEATHER = ramp('#1e120e', '#3a2418', '#5e3a24', '#82552f', '#a6744a')
RED = ramp('#3a0610', '#7a1420', '#b82a2e', '#e0503e', '#ff8a70', '#ffd0c0')
GLASS = ramp('#3a4450', '#6a7a8a', '#a8b8c4', '#e6f0f4')
GOLD = ramp('#5a3a12', '#8f6420', '#c9962f', '#efc65a', '#fff0a8')
VIOLET = ramp('#1e0e3a', '#3a1e6a', '#5a34a8', '#7a4ad8', '#a884f0', '#e0d0ff')


def strokes(c, m, cols, n, seed, length=2, dx=1, dy=0):
    rng = np.random.default_rng(seed)
    ys, xs = np.nonzero(m)
    for i in rng.choice(len(xs), min(n, len(xs)), replace=False):
        col = cols[int(rng.integers(len(cols)))]
        for k in range(length):
            x, y = xs[i] + k * dx, ys[i] + k * dy
            if 0 <= x < 32 and 0 <= y < 32 and m[y, x]:
                c.px(x, y, col)


def rat_skin():
    c = Canvas(32, 32)
    t = np.linspace(0, 1, 20)
    tail = c.empty()
    for i in range(20):
        tail |= c.m_ellipse(16 + 5 * np.sin(t[i] * 3.5), 24 + t[i] * 6.5, .45, .45)
    c.fill(tail, '#c98a8a'); c.outline(tail, OUT)
    hide = c.m_ellipse(16, 15, 8, 10)
    for (x, y, dx, dy) in ((9, 8, -4, -3), (23, 8, 4, -3), (9, 21, -4, 3), (23, 21, 4, 3)):
        hide |= c.m_poly([(x, y - 2), (x + dx, y + dy), (x, y + 2)])
    hide |= c.m_poly([(13, 5), (16, 1), (19, 5)])
    c.shade(hide, RAT, soft=2.5)
    strokes(c, hide, [RAT[1], RAT[4]], 40, 3, 2, 0, 1)
    # skin side showing at the torn edge
    c.fill(hide & (c.xx > 20) & (c.yy > 18) & (c.xx + c.yy > 41), '#c9a090')
    c.outline(hide, OUT_LIT, OUT)
    return c


def bat_wing():
    c = Canvas(32, 32)
    pts = [(4, 9), (10, 5), (18, 3), (28, 4), (30, 9), (27, 14), (24, 12), (22, 19), (18, 15), (15, 23), (11, 17), (7, 21), (5, 15)]
    m = c.m_poly(pts)
    c.shade(m, BATW, soft=2)
    for end in ((28, 4), (27, 14), (22, 19), (15, 23), (7, 21)):
        c.fill(c.m_line([(7, 8), end]) & m, '#a88a9a')
    c.fill(c.m_line([(4, 9), (7, 8)]), '#a88a9a')
    c.outline(m, OUT_LIT, OUT)
    claw = c.m_poly([(3, 9), (1, 5), (5, 8)])
    c.fill(claw, '#e6d8c4'); c.outline(claw, OUT)
    # torn hole
    c.fill(c.m_ellipse(19, 10, 1.2, 1), '#120c14')
    return c


def wolf_pelt():
    c = Canvas(32, 32)
    roll = c.m_rect(9, 9, 26, 24) | c.m_ellipse(26, 16.5, 3.5, 7.5)
    for x in range(10, 27, 2):
        roll |= c.m_poly([(x - 1, 9), (x + 1, 9), (x + 2, 6 + (x % 3))])
        roll |= c.m_poly([(x - 1, 24), (x + 1, 24), (x - 1, 26 + (x % 2))])
    c.shade(roll, WOLF, soft=2.5)
    strokes(c, roll, [WOLF[1], WOLF[4], WOLF[5]], 70, 4, 3, 1, -1)
    c.outline(roll, OUT_LIT, OUT)
    end = c.m_ellipse(9, 16.5, 4, 7.5)
    c.fill(end, WOLF[3])
    for r, col in ((5.6, CREAM[2]), (4.4, WOLF[2]), (3.0, CREAM[1]), (1.6, WOLF[1])):
        c.fill(c.m_ellipse(9, 16.5, r * .55, r) & end, col)
    c.outline(end, OUT)
    cord = c.m_rect(17, 8, 18, 25)
    c.fill(cord & (roll | end | c.m_rect(17, 8, 18, 25)), LEATHER[2]); c.fill(c.m_rect(17, 8, 17, 25), LEATHER[3])
    c.fill(c.m_line([(18, 25), (21, 28)]), LEATHER[2]); c.fill(c.m_line([(17, 25), (15, 29)]), LEATHER[2])
    c.outline(c.m_line([(18, 25), (21, 28)]) | c.m_line([(17, 25), (15, 29)]), OUT)
    # a tuft of tail fur
    tf = c.m_poly([(28, 20), (31, 25), (27, 24)])
    c.fill(tf, WOLF[2]); c.px(30, 24, CREAM[3]); c.outline(tf, OUT)
    return c


def old_bone():
    c = Canvas(32, 32)
    shaft = c.m_line([(8, 23), (23, 8)], 4)
    knobs = c.m_ellipse(5, 23, 3.2, 3.2) | c.m_ellipse(8, 26.5, 3.2, 3.2) | c.m_ellipse(23, 5, 3.2, 3.2) | c.m_ellipse(26.5, 8, 3.2, 3.2)
    m = shaft | knobs
    c.shade(m, BONE, soft=1.8)
    for p in ((14, 16), (15, 16), (16, 15), (11, 20), (20, 11), (21, 11)):
        c.px(*p, BONE[1])
    c.px(17, 14, '#3a2e26'); c.px(18, 13, '#3a2e26'); c.px(19, 13, '#3a2e26')
    # dirt
    for p in ((6, 27), (9, 28), (25, 9)):
        c.px(*p, '#6a5038')
    c.outline(m, OUT_LIT, OUT)
    return c


def troll_hide():
    c = Canvas(32, 32)
    pts = [(4, 8), (9, 4), (16, 6), (22, 3), (28, 7), (27, 14), (29, 21), (25, 28), (17, 26), (10, 29), (4, 24), (6, 16)]
    m = c.m_poly(pts)
    c.shade(m, TROLL, soft=3)
    # folded corner showing the pale underside
    fold = c.m_poly([(19, 26), (25, 28), (29, 21), (23, 22)])
    c.fill(fold, '#a8a07a'); c.fill(fold & (c.xx > 25), '#8a8460'); c.outline(fold, TROLL[0])
    for p in ((10, 10), (19, 9), (13, 18), (22, 15), (8, 21)):
        c.px(*p, TROLL[5]); c.px(p[0] + 1, p[1] + 1, TROLL[1])
    rng = np.random.default_rng(5)
    for _ in range(14):
        x, y = rng.integers(6, 22), rng.integers(6, 16)
        if m[y, x]:
            c.px(x, y, ['#3a6a30', '#548a3a', '#6aa048'][int(rng.integers(3))])
    # stitched tear
    st = c.m_line([(8, 13), (14, 15)])
    c.fill(st, TROLL[0])
    for x in (9, 11, 13):
        c.px(x, 12 + (x - 8) // 3, '#c9a858'); c.px(x, 15 + (x - 8) // 3, '#c9a858')
    c.outline(m, OUT_LIT, OUT)
    return c


def bread():
    c = Canvas(32, 32)
    crust = ramp('#4a2a12', '#7a4a1e', '#a8702e', '#cc9448', '#e8b868')
    loaf = c.m_ellipse(15, 18, 12.5, 8)
    bite = c.m_ellipse(28, 14, 4, 4)
    m = loaf & ~bite
    c.shade(m, crust, soft=3)
    for k in range(3):
        sc = c.m_line([(8 + k * 6, 16), (11 + k * 6, 12)], 1) & m
        c.fill(sc, '#e8cc90'); c.fill(np.roll(sc, 1, 0) & m & ~sc, crust[1])
    crumb = m & c.m_ellipse(28, 14, 5.2, 5.2) & ~bite
    c.fill(crumb, '#e6d2a6')
    for p in ((24, 15), (25, 17), (23, 13)):
        if m[p[1], p[0]]:
            c.px(*p, '#c8b080')
    # stale: two mould spots
    for p in ((10, 21), (11, 22), (18, 23)):
        c.px(*p, '#8a9a6a')
    c.fill(m & (c.yy >= 24), crust[1])
    c.outline(m, OUT_LIT, OUT)
    return c


def bird_nest():
    c = Canvas(32, 32)
    tw = ramp('#2e1c12', '#4a2e1a', '#6b4528', '#8a5e36', '#ab7a45', '#c9a060')
    bowl = c.m_ellipse(16, 20, 13, 7.5)
    c.shade(bowl, tw[:5], soft=2)
    rng = np.random.default_rng(6)
    for _ in range(40):
        x, y = rng.integers(4, 29), rng.integers(14, 27)
        L = int(rng.integers(2, 5)); d = int(rng.choice([-1, 1]))
        for k in range(L):
            xx, yy = x + k, y + (k * d) // 2
            if 0 <= xx < 32 and bowl[min(yy, 31), xx]:
                c.px(xx, yy, tw[int(rng.integers(1, 6))])
    for (a, b) in (((3, 17), (0, 14)), ((28, 18), (31, 15)), ((20, 26), (24, 29))):
        c.fill(c.m_line([a, b]), tw[3])
    c.outline(bowl, OUT_LIT, OUT)
    hollow = c.m_ellipse(16, 17, 9.5, 3.5)
    c.fill(hollow, tw[0]); c.fill(hollow & (c.yy <= 15), tw[1])
    egg_c = ramp('#4a6a8a', '#7aa0c0', '#a8cce0', '#e0f0f8')
    for (x, y) in ((12, 15), (17, 14), (21, 16)):
        e = c.m_ellipse(x, y, 2.6, 3.2)
        c.shade(e, egg_c, soft=1)
        c.px(x - 1, y - 1, '#ffffff'); c.px(x + 1, y + 1, '#3a5a7a'); c.px(x, y + 2, '#3a5a7a')
        c.outline(e, OUT)
    return c


def geode():
    c = Canvas(32, 32)
    rock = ramp('#2a2832', '#45424e', '#68646f', '#8f8b8f', '#b3aeaa')
    shell = c.m_ellipse(16, 17, 13, 12)
    c.shade(shell, rock, soft=3)
    c.outline(shell, OUT_LIT, OUT)
    rim = c.m_ellipse(16.5, 16.5, 10, 9)
    c.fill(rim, '#e6e2ea'); c.fill(rim & (c.xx + c.yy > 36), '#b8b2c4')
    cav = c.m_ellipse(16.5, 16.5, 8.5, 7.5)
    ang = np.arctan2(c.yy - 16.5, c.xx - 16.5)
    d = np.sqrt(((c.xx - 16.5) / 8.5) ** 2 + ((c.yy - 16.5) / 7.5) ** 2)
    facet = np.mod(np.floor(ang * 7 / np.pi + d * 2), 3)
    c.fill(cav, VIOLET[3])
    c.fill(cav & (facet == 0), VIOLET[4]); c.fill(cav & (facet == 1), VIOLET[2])
    c.fill(cav & (d < .45), VIOLET[1]); c.fill(cav & (d < .2), VIOLET[0])
    for p in ((12, 13), (19, 12), (14, 20), (21, 19), (11, 17)):
        c.px(*p, VIOLET[5])
    c.glow(16.5, 16.5, 9, '#9a7ad8', .25, steps=2, mask=cav)
    return c


def flask(c, cx, bulb_r, neck_w, neck_top, liquid_top, cork, extra=None, glow=False):
    bulb = c.m_ellipse(cx, 31 - bulb_r - 1, bulb_r, bulb_r)
    neck = c.m_rect(int(cx - neck_w / 2), neck_top, int(cx + neck_w / 2) - 1, int(31 - bulb_r * 1.6))
    lip = c.m_rect(int(cx - neck_w / 2) - 1, neck_top, int(cx + neck_w / 2), neck_top + 1)
    glass = bulb | neck | lip
    c.fill(glass, GLASS[2]); c.fill(glass & (c.xx > cx + 1), GLASS[1])
    liq = bulb & (c.yy >= liquid_top)
    c.shade(liq, RED[1:5], soft=2)
    c.fill(liq & (c.yy == liquid_top), RED[4])
    if glow:
        c.glow(cx, 31 - bulb_r, bulb_r + 3, '#ff6a5a', .3, steps=3, mask=liq)
        for p in ((cx - 2, liquid_top + 3), (cx + 1, liquid_top + 5), (cx - 3, liquid_top + 7)):
            c.px(int(p[0]), int(p[1]), RED[5])
    # glass highlight
    hl = c.m_ellipse(cx - bulb_r * .45, 31 - bulb_r * 1.35, bulb_r * .22, bulb_r * .4)
    c.fill(hl & bulb, GLASS[3])
    c.fill(c.m_rect(int(cx - neck_w / 2), neck_top + 2, int(cx - neck_w / 2), int(31 - bulb_r * 1.6)) & neck, GLASS[3])
    c.outline(glass, OUT_LIT, OUT)
    ck = c.m_rect(int(cx - neck_w / 2), neck_top - cork, int(cx + neck_w / 2) - 1, neck_top - 1)
    c.fill(ck, LEATHER[3]); c.fill(ck & (c.xx == int(cx - neck_w / 2)), LEATHER[4]); c.fill(ck & (c.yy == neck_top - cork), LEATHER[4])
    c.outline(ck, OUT)
    if extra:
        extra(c)
    return c


def potion():
    c = Canvas(32, 32)
    return flask(c, 16, 8, 6, 9, 19, 3)


def greater_potion():
    c = Canvas(32, 32)

    def deco(c):
        band = c.m_rect(12, 11, 19, 12)
        c.fill(band, GOLD[3]); c.fill(band & (c.yy == 12), GOLD[1]); c.outline(band, OUT)
        seal = c.m_rect(12, 2, 19, 4)
        c.fill(seal, RED[2]); c.fill(seal & (c.yy == 2), RED[3]); c.px(13, 5, RED[2]); c.px(18, 6, RED[2]); c.px(18, 5, RED[2])
        c.outline(seal | c.m_rect(13, 5, 13, 5) | c.m_rect(18, 5, 18, 6), OUT)
        c.px(27, 6, '#fff4d0'); c.px(26, 7, '#ffd0c0'); c.px(28, 7, '#ffd0c0'); c.px(27, 8, '#fff4d0')
    return flask(c, 16, 10.5, 8, 7, 14, 3, extra=deco, glow=True)


SET = [('rat_skin', rat_skin, 'Rat Skin', '🐾'), ('bat_wing', bat_wing, 'Bat Wing', '🪽'), ('wolf_pelt', wolf_pelt, 'Wolf Pelt', '🧥'),
       ('old_bone', old_bone, 'Old Bone', '🦴'), ('troll_hide', troll_hide, 'Troll Hide', '🟫'), ('bread', bread, 'Bread', '🍞'),
       ('bird_nest', bird_nest, 'Bird Nest', '🪺'), ('geode', geode, 'Geode', '🔮'),
       ('health_potion_t1', potion, 'Health Potion (T1)', '🧪'), ('greater_health_potion', greater_potion, 'Greater Health Potion', '⚗️')]

if __name__ == '__main__':
    os.makedirs(OUTDIR, exist_ok=True)
    from PIL import Image, ImageDraw
    S = 5
    sheet = Image.new('RGB', (5 * (32 * S + 12) + 12, 2 * (32 * S + 12) + 12), (58, 42, 28))
    slots = Image.new('RGB', (10 * 80 + 12, 92), (27, 20, 16)); d = ImageDraw.Draw(slots)
    for i, (n, fn, _, _) in enumerate(SET):
        c = fn()
        c.save(f'{OUTDIR}/{n}_1x.png', 1); c.save(f'{OUTDIR}/{n}.png', 4)
        im = c.image(S)
        sheet.paste(im, (12 + (i % 5) * (32 * S + 12), 12 + (i // 5) * (32 * S + 12)), im)
        x = 8 + i * 80
        d.rectangle([x, 8, x + 74, 82], fill=(58, 42, 28), outline=(32, 21, 12), width=3)
        s2 = c.image(2); slots.paste(s2, (x + 5, 13), s2)
    sheet.save(f'{OUTDIR}/_sheet.png'); slots.save(f'{OUTDIR}/_slots.png')
    print('ok')
