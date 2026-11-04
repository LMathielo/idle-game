"""Bestiary: bat, wolf, skeleton (32x32) and troll (48x48), each with one variant.
Same rules as the rat: side view facing left (toward the hero), light from the top-left, selective outline,
feet on the bottom 3-4 rows (fliers hover centred)."""
import sys, os
import numpy as np
from pix import Canvas, ramp, hx, mix, BAYER
from elements import OUT, OUT_LIT

OUTDIR = sys.argv[1] if len(sys.argv) > 1 else 'out/monsters'


def eye(c, x, y, col, glow=False, r=4):
    c.px(x, y, col)
    if glow:
        c.glow(x, y, r, col, .5, steps=2)


# ------------------------------------------------------------------ bat
def bat(fur, wing, bone, eye_col='#ff3b2f', glow=False, fangs='#f2ead2', size=1.0, ears_tall=0):
    c = Canvas(32, 32)
    # wings (far wing first, darker)
    far = c.m_poly([(19, 12), (23, 8), (28, 5), (31, 7), (31, 11), (29, 15), (27, 13), (26, 17), (23, 14), (22, 19), (19, 16)])
    near = c.m_poly([(13, 12), (9, 7), (4, 3), (0, 6), (0, 11), (2, 15), (4, 13), (5, 18), (8, 15), (10, 20), (13, 17)])
    for wm, dark in ((far, True), (near, False)):
        w = wing if not dark else [mix(x, hx('#000000'), .2) for x in wing]
        c.shade(wm, w, soft=1.6)
        c.outline(wm, OUT)
    # finger bones
    for pts in ([(13, 12), (4, 3)], [(12, 12), (1, 9)], [(12, 13), (4, 13)], [(12, 14), (8, 15)]):
        c.fill(c.m_line(pts) & near, hx(bone))
    for pts in ([(19, 12), (28, 5)], [(20, 12), (30, 10)], [(20, 13), (26, 13)]):
        c.fill(c.m_line(pts) & far, mix(hx(bone), hx('#000000'), .25))
    c.px(4, 3, bone); c.px(28, 5, bone)
    # body + head
    body = c.m_ellipse(16, 16, 4 * size, 5.5 * size)
    head = c.m_ellipse(14.5, 10, 3.6, 3.2)
    ears = c.m_poly([(11, 9), (11, 3 - ears_tall), (14, 7)]) | c.m_poly([(16, 7), (18, 3 - ears_tall), (18, 9)])
    allm = body | head | ears
    c.shade(allm, fur, soft=1.5)
    c.fill(ears & (c.xx > 11) & (c.xx < 13) & (c.yy > 4), hx('#c46a7a')); c.fill(ears & (c.xx == 17) & (c.yy > 4), hx('#9a4a5a'))
    # fur ruff
    for x in range(13, 20, 2):
        c.px(x, 13, fur[-1] if x < 16 else fur[2])
    c.outline(allm, OUT)
    # feet claws
    for x in (14, 17):
        c.px(x, 22, '#2a1c26'); c.px(x, 23, bone)
    # face
    c.px(11, 11, '#2a1c26'); c.px(12, 11, '#4a2a30')  # snout
    eye(c, 13, 9, eye_col, glow); eye(c, 15, 9, mix(hx(eye_col), hx('#000000'), .3), False)
    if not glow:
        c.px(13, 8, '#ffffff')
    c.px(12, 12, fangs); c.px(14, 12, fangs)
    return c


def bat_cave():
    return bat(ramp('#1c1218', '#2e1e26', '#45303a', '#5e4450', '#7a5c68'),
               ramp('#1e1420', '#33223a', '#4a3252', '#6a4a70'), '#9a7a8a')


def bat_vampire():
    return bat(ramp('#0c080c', '#1a1218', '#2a1e26', '#3c2c36', '#544050'),
               ramp('#2a0c14', '#4a1420', '#6e1e2c', '#962e3c'), '#c47a7a', eye_col='#ff3b2f', glow=True, ears_tall=1)


# ------------------------------------------------------------------ wolf
def wolf(fur, chest, eye_col='#ffcf3a', glow=False, scars=False, ruff=0):
    c = Canvas(32, 32)
    dk = [mix(x, hx('#000000'), .3) for x in fur]
    leg = lambda pts, w: c.m_line(pts, w)
    # tail (behind), held low and bushy
    t = np.linspace(0, 1, 24)
    tx = 26 + t * 5
    ty = 14 + t * 8 + np.sin(t * 3)
    tm = c.empty()
    for i in range(len(t)):
        r = 1.1 + 1.4 * np.sin(t[i] * np.pi * .9)
        tm |= c.m_ellipse(tx[i], ty[i], r, r)
    c.shade(tm, fur, soft=1.2); c.px(30, 22, chest[-1]); c.px(31, 22, chest[-1])
    c.outline(tm, OUT)
    # far legs
    far = leg([(13, 19), (14, 24), (13, 28)], 2) | leg([(23, 18), (26, 22), (27, 25), (26, 28)], 2)
    c.fill(far, dk[2]); c.outline(far, OUT)
    # body: deep chest, tucked belly, haunch
    chest_m = c.m_ellipse(11, 16.5, 5.5, 5.5 + ruff * .5)
    body = c.m_ellipse(18, 15, 8, 4) | c.m_ellipse(24, 16, 4.5, 4.5) | chest_m
    hack = c.empty()
    for k, x in enumerate(range(8, 24, 2)):
        hh = 1 + (k % 2) + (ruff if x < 14 else 0) + (1 if 9 < x < 15 else 0)
        hack |= c.m_poly([(x - 1, 12), (x + 1, 12), (x + (k % 2), 12 - hh)])
    # head low and forward, snarling
    head = c.m_ellipse(6.5, 15, 3.8, 3.3) | c.m_poly([(5, 13), (0, 16), (0, 18), (6, 19)])
    ears = c.m_poly([(6, 12), (8, 7), (9, 12)]) | c.m_poly([(4, 12), (4, 8), (6, 12)])
    near = leg([(10, 20), (9, 24), (8, 28)], 3) | leg([(22, 18), (24, 21), (25, 24), (23, 28)], 3) | c.m_ellipse(23, 18, 3.5, 3.5)
    allm = body | hack | head | ears | near
    c.shade(allm, fur, soft=1.8)
    throat = allm & (((c.xx < 14) & (c.xx > 5) & (c.yy > 17) & (c.yy < 22)) | ((c.xx < 6) & (c.yy >= 17) & (c.yy < 19)))
    c.shade(throat, chest, soft=1)
    c.fill(ears & (c.xx == 7) & (c.yy > 8), hx('#c46a7a'))
    for x in range(12, 24, 3):
        c.px(x, 12, fur[-1]); c.px(x + 1, 13, fur[2])
    c.fill(near & (c.yy > 24) & (c.xx < 12), fur[2])
    if scars:
        for p in ((16, 13), (17, 14), (18, 15), (19, 13), (20, 14)):
            c.px(*p, hx('#8a4a4a'))
        c.px(5, 13, hx('#8a4a4a')); c.px(6, 14, hx('#8a4a4a'))
    c.outline(allm, OUT)
    for x in (7, 12, 22, 25):
        c.fill(c.m_rect(x, 28, x + 2, 28), fur[0])
    c.px(0, 16, '#120c14')
    c.fill(c.m_line([(1, 18), (5, 18)]), hx('#3a1218'))
    for x in (1, 3):
        c.px(x, 17, '#f2ead2'); c.px(x + 1, 19, '#f2ead2')
    eye(c, 5, 14, eye_col, glow)
    c.px(4, 13, fur[0]); c.px(5, 13, fur[0]); c.px(6, 13, fur[0])
    return c


def wolf_grey():
    return wolf(ramp('#1c1a22', '#34303a', '#524c56', '#746c74', '#9a9096', '#c4bab8'),
                ramp('#6a6058', '#a89a88', '#d4c8b4', '#eee6d6'))


def wolf_dire():
    return wolf(ramp('#0c0a10', '#18141c', '#262030', '#383044', '#4c4258', '#665a72'),
                ramp('#262030', '#3c3448', '#544a60', '#6a5e74'), eye_col='#ff3b2f', glow=True, scars=True, ruff=1)


# ------------------------------------------------------------------ skeleton
BONE = ramp('#4a4038', '#8a7e64', '#b9ad8c', '#ddd2b2', '#f2ead2')


def skeleton(eye_col='#7fd8ff', helmet=None, armour=None, rag='#4a3a5a', blade=('#45424e', '#7b7884', '#a19d9f', '#d0cac4'), rust=True):
    c = Canvas(32, 32)
    b = BONE
    # shield on the back arm (behind)
    sh = c.m_ellipse(22, 16, 4.5, 5.5) & ~c.m_poly([(24, 9), (27, 12), (27, 9)])
    c.shade(sh, ramp('#2e1c12', '#4a2e1a', '#6b4528', '#8a5e36'), soft=1.5)
    c.fill(c.m_ellipse(22, 16, 1.5, 1.5) & sh, hx('#68646f')); c.px(21, 15, '#a19d9f')
    c.fill(c.m_line([(19, 12), (25, 20)]) & sh, hx('#2e1c12'))
    c.outline(sh, OUT)
    # far leg + far arm (darker bone)
    dk = [mix(x, hx('#000000'), .25) for x in b]
    farleg = c.m_line([(16, 21), (18, 24), (17, 28)], 1)
    c.fill(farleg, dk[2]); c.outline(farleg, OUT)
    # spine, pelvis, ribs
    spine = c.m_rect(15, 11, 15, 20)
    ribs = c.m_ellipse(15, 14.5, 4, 3.6)
    pelvis = c.m_poly([(12, 19), (18, 19), (17, 22), (13, 22)])
    nearleg = c.m_line([(13, 21), (11, 24), (12, 28)], 1)
    knees = c.m_ellipse(11.5, 24, 1.2, 1.2)
    skull = c.m_ellipse(14, 6.5, 3.6, 3.4)
    jaw = c.m_rect(11, 8, 15, 10)
    allb = spine | ribs | pelvis | nearleg | knees | skull | jaw
    c.shade(allb, b, soft=1.2)
    # rib gaps
    for y in (13, 15, 17):
        c.fill(ribs & (c.yy == y) & (c.xx != 15), hx('#1a1218'))
    c.fill(ribs & (c.xx == 15), b[1])
    c.fill(pelvis & (c.yy == 21) & (c.xx > 13) & (c.xx < 17), hx('#1a1218'))
    # feet
    c.fill(c.m_rect(10, 28, 13, 28), b[2]); c.fill(c.m_rect(16, 28, 18, 28), dk[2])
    # skull face: sockets, nose, teeth
    c.fill(c.m_rect(12, 6, 13, 7), hx('#120c14')); c.px(15, 6, '#120c14')
    c.px(11, 8, '#120c14')
    for x in (11, 13, 15):
        c.px(x, 9, '#120c14')
    c.fill(c.m_rect(11, 10, 15, 10), b[2])
    if helmet:
        hm = c.m_ellipse(14, 5, 4.2, 3.2) & (c.yy <= 6)
        hm |= c.m_rect(16, 5, 18, 8)
        c.shade(hm, helmet, soft=1)
        c.fill(c.m_rect(10, 6, 18, 6) & hm, helmet[1])
        c.px(14, 1, helmet[3]); c.px(14, 2, helmet[2])
        c.outline(hm, OUT)
    if armour:
        am = c.m_ellipse(15, 15, 4.5, 4) | c.m_rect(11, 18, 19, 20)
        c.shade(am, armour, soft=1.2)
        for p in ((12, 13), (17, 16), (14, 18)):
            c.px(*p, hx('#8a4a2a'))
        c.fill(am & (c.yy == 18), armour[0])
        c.outline(am, OUT)
    # loin rag
    rg = c.m_poly([(12, 19), (18, 19), (17, 22), (15, 21), (13, 23)])
    c.fill(rg, hx(rag)); c.fill(rg & (c.xx < 14), mix(hx(rag), hx('#ffffff'), .2)); c.outline(rg, OUT)
    c.outline(allb, OUT)
    # near arm raising the sword forward
    arm = c.m_line([(13, 12), (10, 14), (7, 12)], 1)
    c.fill(arm, b[3]); c.outline(arm, OUT)
    # rusty sword pointing up-left
    bl = c.m_line([(6, 11), (1, 2)], 2)
    c.fill(bl, hx(blade[1])); c.fill(bl & (c.xx + c.yy < 13 + (c.xx * 0)), hx(blade[2]))
    edge = c.m_line([(5, 10), (1, 3)], 1)
    c.fill(edge & bl, hx(blade[3]))
    if rust:
        for p in ((3, 6), (4, 8), (2, 5), (5, 9)):
            c.px(*p, hx('#8a4a2a'))
    c.fill(c.m_line([(4, 12), (8, 10)]), hx('#5d5a64'))
    c.px(7, 12, b[3]); c.px(8, 13, hx('#3f2719'))
    c.outline(bl, OUT)
    # glowing eyes
    eye(c, 12, 6, eye_col, True, 4)
    eye(c, 15, 6, mix(hx(eye_col), hx('#000000'), .2), False)
    return c


def skeleton_crypt():
    return skeleton()


def skeleton_knight():
    return skeleton(eye_col='#c88cff', helmet=ramp('#26222c', '#3c3846', '#5d5a64', '#7b7884', '#a19d9f'),
                    armour=ramp('#2a1e18', '#4a3226', '#6a4a38', '#8a6a52'), rag='#2a1e3a',
                    blade=('#2e2a36', '#5d5a64', '#8f8b8f', '#c4bfb6'), rust=False)


# ------------------------------------------------------------------ troll (48x48)
def troll(skin, moss, eye_col='#ffcf3a', crystals=None, club='wood', glow=False):
    c = Canvas(48, 48)
    rng = np.random.default_rng(4)
    dk = [mix(x, hx('#000000'), .28) for x in skin]
    cap = lambda a, b, w: c.m_line([a, b], w) | c.m_ellipse(a[0], a[1], w / 2, w / 2) | c.m_ellipse(b[0], b[1], w / 2, w / 2)
    # far arm and far leg
    farm = cap((34, 20), (37, 30), 6) | cap((37, 30), (35, 38), 5)
    farleg = cap((32, 35), (35, 44), 7)
    c.shade(farm | farleg, dk, soft=1.5); c.outline(farm | farleg, OUT)
    # body: huge hump of shoulders, gut, short bowed legs
    hump = c.m_ellipse(28, 19, 12, 9)
    gut = c.m_ellipse(25, 29, 10, 8)
    nearleg = cap((22, 35), (20, 44), 8)
    head = c.m_ellipse(13, 19, 5, 4.5)
    nose = c.m_poly([(10, 17), (5, 23), (6, 25), (10, 22)])
    jaw = c.m_poly([(8, 22), (16, 21), (16, 26), (10, 27)])
    ear = c.m_poly([(16, 17), (21, 13), (18, 20)])
    allm = hump | gut | nearleg | head | nose | jaw | ear
    c.shade(allm, skin, soft=3)
    bel = c.m_ellipse(22, 31, 6, 4.5) & gut
    c.tint(bel, skin[-1], .18); c.px(22, 31, skin[1])
    # loincloth
    lc = c.m_poly([(15, 34), (33, 34), (32, 39), (28, 37), (25, 40), (22, 37), (18, 39)])
    c.shade(lc, ramp('#3a2418', '#5e3a24', '#82552f', '#a6744a'), soft=1)
    c.fill(c.m_rect(15, 34, 33, 34), hx('#2e1c12'))
    for x in range(17, 32, 3):
        c.px(x, 36, '#c9a858')
    c.outline(lc, OUT)
    if moss is not None:
        ys, xs = np.nonzero(hump & (c.yy < 20))
        for i in rng.choice(len(xs), len(xs) // 5, replace=False):
            if xs[i] > 20:
                c.px(xs[i], ys[i], moss[int(rng.integers(len(moss)))])
    if crystals:
        for cx, cy, h in ((30, 11, 6), (35, 13, 4), (25, 12, 4)):
            cm = c.m_poly([(cx - 1, cy + 1), (cx, cy - h), (cx + 1, cy + 1)])
            c.fill(cm, hx(crystals[1])); c.fill(cm & (c.xx < cx), hx(crystals[2])); c.px(cx, cy - h + 1, '#ffffff')
            c.outline(cm, OUT)
            if glow:
                c.glow(cx, cy - 1, 5, crystals[2], .35, steps=2)
    for p in ((26, 23), (31, 27), (13, 17), (20, 28), (33, 17)):
        c.px(*p, skin[-1]); c.px(p[0] + 1, p[1] + 1, skin[1])
    for k in range(4):
        c.px(11 + k * 2, 14 - (k % 2), '#2a1c16'); c.px(12 + k * 2, 15, '#3f2719')
    c.outline(allm, OUT)
    # face: heavy brow, small eye, nostril, mouth, upward tusks
    c.fill(c.m_line([(9, 17), (15, 17)]), dk[1])
    eye(c, 11, 18, eye_col, glow); c.px(12, 18, '#120c14')
    c.px(6, 23, '#120c14')
    c.fill(c.m_line([(10, 24), (15, 23)]), hx('#2a1218'))
    for x in (10, 14):
        c.px(x, 23, '#f2ead2'); c.px(x, 22, '#f2ead2'); c.px(x + 1, 23, '#c9b878')
    # near arm: thick upper arm, forearm reaching low, big fist gripping the club
    arm = cap((21, 21), (17, 30), 7) | cap((17, 30), (12, 37), 6)
    fist = c.m_ellipse(11, 38, 3.5, 3.2)
    c.shade(arm | fist, skin, soft=2)
    c.fill(c.m_line([(19, 29), (16, 31)]), skin[1])
    c.outline(arm | fist, OUT)
    if club == 'wood':
        cl = cap((9, 37), (3, 45), 3) | c.m_ellipse(3, 45, 3.5, 2.5)
        c.shade(cl, ramp('#2e1c12', '#4a2e1a', '#6b4528', '#8a5e36', '#ab7a45'), soft=1.2)
        for p in ((2, 43), (5, 42), (1, 46), (5, 46)):
            c.px(*p, '#a19d9f')
    else:
        cl = cap((9, 37), (5, 42), 2) | c.m_ellipse(4, 44, 4, 3.5)
        c.shade(cl, ramp('#26222c', '#3c3846', '#5d5a64', '#7b7884', '#a19d9f'), soft=1.2)
    c.outline(cl, OUT)
    c.fill(c.m_rect(9, 36, 13, 36) & fist, skin[1])
    for x in (17, 20, 23):
        c.px(x, 46, skin[-1])
    return c


def troll_moss():
    return troll(ramp('#1a2218', '#2a3824', '#3e5232', '#566e42', '#728a54', '#92a868'),
                 [hx('#3a6a30'), hx('#548a3a'), hx('#6aa048')])


def troll_stone():
    return troll(ramp('#1c1a22', '#33303c', '#4c4854', '#686470', '#8a8590', '#aaa4aa'),
                 [hx('#4a6a3a'), hx('#7a8a5a')], eye_col='#7fe0ff', crystals=('#1c1440', '#4dd6c2', '#a8fff0'), club='stone', glow=True)


SET = [('bat', bat_cave, 'Cave Bat'), ('bat_vampire', bat_vampire, 'Vampire Bat'),
       ('wolf', wolf_grey, 'Grey Wolf'), ('wolf_dire', wolf_dire, 'Dire Wolf'),
       ('skeleton', skeleton_crypt, 'Crypt Skeleton'), ('skeleton_knight', skeleton_knight, 'Skeleton Knight'),
       ('troll', troll_moss, 'Bridge Troll'), ('troll_stone', troll_stone, 'Stone Troll')]

if __name__ == '__main__':
    os.makedirs(OUTDIR, exist_ok=True)
    from PIL import Image
    tiles = []
    for name, fn, _ in SET:
        c = fn()
        c.save(f'{OUTDIR}/{name}_1x.png', 1)
        s = 8 if c.w == 32 else 6
        c.save(f'{OUTDIR}/{name}.png', s)
        tiles.append(c.image(8 if c.w == 32 else 6))
    sheet = Image.new('RGB', (4 * 300, 2 * 300), (42, 31, 24))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % 4) * 300 + (300 - t.width) // 2, (i // 4) * 300 + (300 - t.height) // 2), t)
    sheet.save(f'{OUTDIR}/_sheet.png')
    print('ok')
