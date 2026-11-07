"""Common UI symbols, 16x16. Same rules as every asset: top-left light, hue-shifted ramps, dark outline
(full outline at this size so they read on both parchment and dark panels)."""
import sys, os
import numpy as np
from pix import Canvas, ramp, hx, mix
from elements import OUT, OUT_LIT

OUTDIR = sys.argv[1] if len(sys.argv) > 1 else 'out/icons'
GOLD = ramp('#5a3a12', '#8f6420', '#c9962f', '#efc65a', '#fff0a8')
STEEL = ramp('#26222c', '#45424e', '#6a6672', '#a19d9f', '#d0cac4', '#f2efe6')
WOOD = ramp('#2e1c12', '#4a2e1a', '#6b4528', '#8a5e36', '#ab7a45')
SKIN = ramp('#6b3a2e', '#a8603e', '#d48c62', '#eab088')


def C():
    return Canvas(16, 16)


def done(c, m):
    c.outline(m, OUT)
    return c


def coin():
    c = C()
    edge = c.m_ellipse(8, 8.8, 6.6, 6.6)
    c.fill(edge, GOLD[1]); c.outline(edge, OUT)
    m = c.m_ellipse(7.4, 7.8, 6.3, 6.3)
    c.shade(m, GOLD[1:], soft=1.6)
    ring = c.m_ellipse(7.4, 7.8, 4.4, 4.4) & ~c.m_ellipse(7.4, 7.8, 3.4, 3.4)
    c.fill(ring & (c.xx + c.yy < 15), GOLD[2]); c.fill(ring & (c.xx + c.yy >= 15), GOLD[4])
    # embossed crown
    for p in ((5, 7), (7, 6), (9, 7), (5, 8), (6, 8), (7, 8), (8, 8), (9, 8), (5, 9), (6, 9), (7, 9), (8, 9), (9, 9)):
        c.px(*p, GOLD[2])
    c.px(7, 7, GOLD[2]); c.px(5, 10, GOLD[1]); c.px(9, 10, GOLD[1])
    c.px(3, 4, '#ffffff'); c.px(4, 3, GOLD[4]); c.px(3, 5, GOLD[4])
    return c


def bolt():
    c = C()
    r = ramp('#5a2a0a', '#a34a12', '#d9822b', '#f2a94a', '#ffe08a')
    m = c.m_poly([(10, 0), (3, 9), (7, 9), (4, 15), (12, 6), (8, 6), (11, 0)])
    c.fill(m, r[2])
    c.fill(m & (c.xx + c.yy * .2 < 7.5), r[3])
    c.fill(m & ~np.roll(m, 1, 1), r[4])
    c.fill(m & ~np.roll(m, -1, 1) & (c.yy > 6), r[1])
    return done(c, m)


def sparkle():
    c = C()
    r = ramp('#1e3a6a', '#3f8fd1', '#8cc4f2', '#e6f4ff')

    def star(cx, cy, a, b):
        return c.m_poly([(cx, cy - a), (cx + b, cy - b), (cx + a, cy), (cx + b, cy + b), (cx, cy + a), (cx - b, cy + b), (cx - a, cy), (cx - b, cy - b)])
    big = star(6, 9, 6, 1.2)
    small = star(12.5, 3.5, 3, .6)
    for m in (big, small):
        c.fill(m, r[1]); c.fill(m & (c.xx <= c.xx * 0 + 99) & (np.abs(c.xx - 6) + np.abs(c.yy - 9) < 4), r[2])
    c.fill(c.m_ellipse(6, 9, 1.5, 1.5), r[3]); c.px(12, 3, r[3]); c.px(13, 4, r[2])
    c.px(13, 13, r[2]); c.px(14, 12, r[1])
    return done(c, big | small | c.m_rect(13, 13, 13, 13))


def padlock(open_=False):
    c = C()
    cy = 3.6 if open_ else 6.0
    arch = c.m_ellipse(7.5, cy, 4.2, 3.6) & ~c.m_ellipse(7.5, cy, 2.2, 1.8) & (c.yy <= cy)
    legs = c.m_rect(10, int(cy), 11, 8)
    legs |= c.m_rect(4, int(cy), 5, (int(cy) + 1) if open_ else 8)
    sh = arch | legs
    c.fill(sh, STEEL[3]); c.fill(sh & (c.xx < 7), STEEL[4]); c.fill(sh & (c.xx > 9), STEEL[2])
    c.outline(sh, OUT)
    body = c.m_rect(2, 8, 13, 14)
    c.fill(body, GOLD[2]); c.fill(body & (c.xx <= 3), GOLD[3])
    c.fill(body & (c.yy == 8), GOLD[4]); c.fill(body & (c.yy == 14), GOLD[1]); c.fill(body & (c.xx == 13), GOLD[1])
    c.fill(c.m_rect(7, 10, 8, 11), '#2a1c26'); c.px(7, 12, '#2a1c26')
    return done(c, body)


BONE = ramp('#5b5664', '#8c8794', '#bcb7bd', '#e4e0dc', '#fbf9f2')
BLOOD = ramp('#2e0810', '#6a1020', '#a01828', '#c8242c', '#ec4c48')
OBSIDIAN = ramp('#07060b', '#15121c', '#262233', '#3c3750', '#58526c')
FLAME = ramp('#8a2a0a', '#d9561a', '#f2a94a', '#ffe08a', '#fffbe0')


def skull(kind):
    """Difficulty skulls (16x16, owner brief 2026-11-06): normal = white, hard = red, extreme = black with flaming eyes.
    Same silhouette for all three, so the three buttons read as one family. PENDING OWNER APPROVAL (docs/STATUS.md)."""
    c = C()
    r = {'normal': BONE, 'hard': BLOOD, 'extreme': OBSIDIAN}[kind]
    cranium = c.m_ellipse(7.5, 6.2, 5.6, 5.2)
    jaw = c.m_rect(4, 9, 11, 13) & ~c.m_rect(4, 13, 4, 13) & ~c.m_rect(11, 13, 11, 13)
    sh = cranium | jaw
    c.shade(sh, r, soft=1.4)
    # rim light on the top-left edge so the dark skull still reads
    rim = sh & ~np.roll(sh, 1, 0) | sh & ~np.roll(sh, 1, 1)
    c.fill(rim & (c.yy < 9), r[4] if kind != 'extreme' else r[3])
    # eye sockets, nose, teeth
    eyes = c.m_ellipse(5.2, 7.2, 1.7, 2.0) | c.m_ellipse(9.8, 7.2, 1.7, 2.0)
    c.fill(eyes, '#120c14')
    c.fill(c.m_poly([(7, 9), (8, 9), (8, 10), (7, 10)]), '#120c14')
    c.fill(c.m_rect(5, 12, 10, 12) & ((c.xx % 2) == 1), '#120c14')
    c.fill(c.m_rect(5, 11, 10, 11), r[1])
    if kind == 'extreme':
        # flaming eyes: a hot core in each socket and tongues of flame rising off them
        for ex in (5, 10):
            c.px(ex, 7, FLAME[3]); c.px(ex, 8, FLAME[2]); c.px(ex - 1, 8, FLAME[1]); c.px(ex + 1, 8, FLAME[1])
            c.px(ex, 6, FLAME[4]); c.px(ex - 1, 7, FLAME[2]); c.px(ex + 1, 7, FLAME[2])
        for (fx, fy, k) in ((4, 4, 2), (5, 3, 3), (10, 4, 2), (11, 3, 3), (5, 2, 1), (10, 2, 1)):
            c.px(fx, fy, FLAME[k])
    c.outline(sh | (c.m_rect(3, 2, 12, 5) if kind == 'extreme' else c.empty()) & c.alpha, OUT)
    return c


def hammer_icon(c, ox=0, oy=0):
    handle = c.m_line([(3 + ox, 14 + oy), (10 + ox, 7 + oy)], 2)
    c.fill(handle, WOOD[3]); c.fill(handle & (c.xx + c.yy < 17 + ox + oy), WOOD[4])
    head = c.m_poly([(7 + ox, 4 + oy), (10 + ox, 1 + oy), (15 + ox, 6 + oy), (12 + ox, 9 + oy)])
    c.fill(head, STEEL[3]); c.fill(head & (c.xx - c.yy < 6 + ox - oy), STEEL[4]); c.fill(head & (c.xx + c.yy > 18 + ox + oy), STEEL[2])
    c.px(10 + ox, 2 + oy, STEEL[5])
    return handle | head


def upgrade():
    c = C()
    m = hammer_icon(c, -1, 0)
    c.outline(m, OUT)
    # green up-arrow badge
    a = c.m_poly([(12, 8), (16, 12), (14, 12), (14, 15), (10, 15), (10, 12), (8, 12)])
    c.fill(a, '#4f9a4a'); c.fill(a & (c.xx <= 11), '#7ac46a'); c.px(12, 9, '#a8e08a')
    return done(c, a)


def anvil_craft():
    c = C()
    an = c.m_poly([(1, 9), (13, 9), (11, 11), (10, 11), (10, 13), (13, 14), (13, 15), (3, 15), (3, 14), (6, 13), (6, 11), (4, 11)])
    c.fill(an, STEEL[2]); c.fill(an & (c.yy == 9), STEEL[4]); c.fill(an & (c.yy >= 14), STEEL[1]); c.fill(an & (c.xx <= 2), STEEL[3])
    c.outline(an, OUT)
    handle = c.m_line([(6, 8), (11, 3)], 1)
    c.fill(handle, WOOD[4])
    head = c.m_poly([(10, 0), (12, 0), (15, 3), (13, 5)])
    c.fill(head, STEEL[3]); c.fill(head & (c.xx < 13), STEEL[4])
    c.outline(handle | head, OUT)
    for p, col in (((3, 7), '#ffd36b'), ((2, 5), '#ff8a3a'), ((5, 6), '#ffd36b')):
        c.px(*p, col)
    return c


def worker():
    c = C()
    sh = c.m_poly([(1, 15), (2, 11), (5, 10), (11, 10), (14, 11), (15, 15)])
    c.shade(sh, ramp('#2e3a4a', '#3c5a7a', '#5a7a9a', '#7a9aba'), soft=1.2)
    c.fill(c.m_rect(6, 10, 10, 15) & sh, '#a7843d'); c.fill(c.m_rect(7, 10, 7, 15) & sh, '#c9a858')
    c.outline(sh, OUT)
    head = c.m_ellipse(8, 7, 3.5, 3.5)
    c.shade(head, SKIN, soft=1)
    cap = c.m_ellipse(8, 4.5, 4.5, 2.5) | c.m_rect(3, 5, 13, 5)
    cap &= c.yy <= 5
    c.fill(cap, '#c9a858'); c.fill(cap & (c.xx < 7), '#e0c47a'); c.fill(cap & (c.yy == 5), '#a7843d')
    c.px(6, 7, '#2a1c26'); c.px(9, 7, '#2a1c26'); c.px(7, 9, SKIN[0]); c.px(8, 9, SKIN[0])
    return done(c, head | cap)


def check():
    c = C()
    b = c.m_rect(1, 1, 14, 14) & ~(c.m_rect(1, 1, 1, 1) | c.m_rect(14, 1, 14, 1) | c.m_rect(1, 14, 1, 14) | c.m_rect(14, 14, 14, 14))
    c.fill(b, '#3f7a3a'); c.fill(b & (c.yy <= 2), '#6fb05a'); c.fill(b & (c.xx <= 2), '#5a9a4a'); c.fill(b & (c.yy >= 13), '#2a5a2a')
    ck = c.m_line([(4, 8), (7, 11), (12, 4)], 2)
    c.fill(ck, '#f5efe2'); c.fill(ck & (c.yy > 9), '#d9d0bc')
    return done(c, b)


def star():
    c = C()
    pts = []
    for i in range(10):
        a = -np.pi / 2 + i * np.pi / 5
        r = 7.5 if i % 2 == 0 else 3.4
        pts.append((7.5 + r * np.cos(a), 8.5 + r * np.sin(a)))
    m = c.m_poly(pts)
    c.shade(m, GOLD, soft=1.4)
    c.px(6, 5, GOLD[4]); c.px(7, 4, GOLD[4])
    return done(c, m)


def flex():
    c = C()
    up = c.m_ellipse(6, 11, 5, 3.2)        # upper arm with bicep
    fore = c.m_poly([(9, 12), (12, 12), (13, 4), (10, 4)])
    fist = c.m_ellipse(11.5, 3.5, 2.5, 2.5)
    sleeve = c.m_rect(0, 9, 2, 14)
    m = up | fore | fist
    c.shade(m, SKIN, soft=1.3)
    bump = c.m_ellipse(6, 8.5, 2.8, 2)
    c.shade(bump, SKIN, soft=1); m |= bump
    c.fill(c.m_line([(10, 3), (13, 3)]), SKIN[1]); c.px(5, 7, SKIN[3]); c.px(6, 7, SKIN[3]); c.px(4, 8, SKIN[3])
    c.fill(c.m_line([(8, 11), (9, 12)]), SKIN[1])
    c.fill(sleeve, '#7a3a2e'); c.fill(sleeve & (c.xx == 0), '#9a5a42')
    return done(c, m | sleeve)


def dummy():
    c = C()
    post = c.m_rect(7, 4, 8, 15)
    c.fill(post, WOOD[2]); c.fill(post & (c.xx == 7), WOOD[3])
    arm = c.m_rect(1, 6, 14, 7)
    c.fill(arm, WOOD[3]); c.fill(arm & (c.yy == 6), WOOD[4])
    body = c.m_ellipse(7.5, 9.5, 3.5, 4)
    c.shade(body, ramp('#57401f', '#7f5f2c', '#a7843d', '#c9a858', '#e0c47a'), soft=1)
    c.fill(c.m_rect(4, 8, 11, 8) & body, '#7a3a2e')
    head = c.m_ellipse(7.5, 2.5, 2.2, 2.2)
    c.fill(head, '#e6d8b4'); c.fill(head & (c.xx > 8), '#c9b894'); c.px(7, 2, '#a8323a'); c.px(8, 2, '#a8323a')
    return done(c, post | arm | body | head)


def swords():
    c = C()
    m = c.empty()
    for flip in (False, True):
        tip = (14, 1) if not flip else (1, 1)
        base = (4, 11) if not flip else (11, 11)
        bl = c.m_line([base, tip], 2)
        c.fill(bl, STEEL[3]); c.fill(bl & (c.yy + (c.xx if not flip else -c.xx) < (15 if not flip else 0)), STEEL[4])
        m |= bl
    c.outline(m, OUT)
    for flip in (False, True):
        sgn = 1 if not flip else -1
        gx = 4 if not flip else 11
        guard = c.m_line([(gx - 2 * sgn, 9), (gx + 1 * sgn, 12)], 1) if False else c.m_line([(gx - 1, 10 - sgn), (gx + 1, 10 + sgn)], 1)
        guard = c.m_line([(gx - 2, 9) if not flip else (gx + 2, 9), (gx + 1, 12) if not flip else (gx - 1, 12)], 1)
        grip = c.m_line([(gx, 12) if not flip else (gx, 12), (gx - 2, 14) if not flip else (gx + 2, 14)], 1)
        c.fill(guard, GOLD[3]); c.fill(grip, WOOD[3])
        pm = c.m_rect(gx - 3 if not flip else gx + 3, 15, gx - 3 if not flip else gx + 3, 15)
        c.fill(pm, GOLD[2])
        c.outline(guard | grip | pm, OUT)
    return c


def unknown():
    c = C()
    b = c.m_ellipse(7.5, 8, 6.5, 6.5)
    c.shade(b, ramp('#3c3a47', '#585663', '#7b7884', '#a19d9f'), soft=1.5)
    q = c.empty()
    for p in ((5, 5), (6, 4), (7, 4), (8, 4), (9, 4), (10, 5), (10, 6), (9, 7), (8, 8), (7, 8), (7, 9)):
        q |= c.m_rect(p[0], p[1], p[0], p[1])
    q |= c.m_rect(7, 11, 7, 12)
    c.fill(q, '#f5efe2')
    c.fill(q & (c.xx == 7) & (c.yy >= 8), '#d9d0bc')
    return done(c, b)


RED = ramp('#3a0610', '#7a1420', '#b82a2e', '#e0503e', '#ff8a70', '#ffd0c0')
GLASS = ramp('#3a4450', '#6a7a8a', '#a8b8c4', '#e6f0f4')
LEATHER = ramp('#1e120e', '#3a2418', '#5e3a24', '#82552f', '#a6744a')
GHOST = ramp('#24180f', '#52402c', '#665240', '#806a54')  # empty-slot silhouettes: a little lighter than the slot's brown fill


def potion_icon():
    """The Potion Belt button's symbol: a small red health flask with a cork (16x16)."""
    c = C()
    bulb = c.m_ellipse(7.5, 10, 4.6, 4.4)
    neck = c.m_rect(6, 4, 9, 7)
    lip = c.m_rect(5, 3, 10, 4)
    glass = bulb | neck | lip
    c.fill(glass, GLASS[2]); c.fill(glass & (c.xx > 8), GLASS[1])
    liq = bulb & (c.yy >= 9)
    c.shade(liq, RED[1:5], soft=1.6)
    c.fill(liq & (c.yy == 9), RED[4])
    c.px(5, 11, RED[5]); c.px(5, 12, RED[4])
    c.px(5, 8, GLASS[3]); c.px(6, 5, GLASS[3]); c.px(6, 6, GLASS[3])
    c.outline(glass, OUT_LIT, OUT)
    ck = c.m_rect(6, 1, 9, 2)
    c.fill(ck, LEATHER[3]); c.fill(ck & (c.yy == 1), LEATHER[4])
    c.outline(ck, OUT)
    return c


def slot_accessory():
    """Empty accessory slot: the ghost of a belt with a buckle (16x16)."""
    c = C()
    belt = c.m_rect(1, 6, 14, 10)
    c.fill(belt, GHOST[1]); c.fill(belt & (c.yy == 6), GHOST[2]); c.fill(belt & (c.yy == 10), GHOST[0])
    for x in range(3, 13, 3):
        c.px(x, 8, GHOST[0])
    buckle = c.m_rect(6, 4, 9, 12)
    c.fill(buckle, GHOST[2]); c.fill(c.m_rect(7, 6, 8, 10), GHOST[0]); c.fill(buckle & (c.xx == 6), GHOST[3])
    c.outline(belt | buckle, GHOST[0])
    return c


def slot_potion():
    """Empty belt slot: the ghost of a flask (16x16)."""
    c = C()
    bulb = c.m_ellipse(7.5, 10, 4.6, 4.4)
    glass = bulb | c.m_rect(6, 4, 9, 7) | c.m_rect(5, 3, 10, 4)
    c.fill(glass, GHOST[1]); c.fill(glass & (c.xx < 7) & (c.yy > 8), GHOST[2])
    c.fill(c.m_rect(6, 1, 9, 2), GHOST[2])
    c.outline(glass | c.m_rect(6, 1, 9, 2), GHOST[0])
    return c


SET = [('gold', coin, 'Gold', '🪙'), ('stamina', bolt, 'Stamina', '⚡'), ('hero_xp', sparkle, 'Hero XP', '✨'),
       ('hero_level', star, 'Hero level', '⭐'), ('locked', lambda: padlock(False), 'Locked', '🔒'),
       ('unlocked', lambda: padlock(True), 'Unlocked', '🔓'), ('upgrade', upgrade, 'Upgrade', '🔨'),
       ('crafting', anvil_craft, 'Crafting', '⚒️'), ('workers', worker, 'Workers', '👷'), ('ready', check, 'Ready', '✅'),
       ('power', flex, 'Power (WS/MS)', '💪'), ('training', dummy, 'Training', '🏋️'), ('fight', swords, 'Fight', '⚔️'),
       ('unknown', unknown, 'Unknown item', '❔'),
       ('skull_normal', lambda: skull('normal'), 'Normal difficulty', '💀'),
       ('skull_hard', lambda: skull('hard'), 'Hard difficulty', '💀'),
       ('skull_extreme', lambda: skull('extreme'), 'Extreme difficulty', '💀'),
       ('potion', potion_icon, 'Potion Belt button', '🧪'), ('slot_accessory', slot_accessory, 'Empty accessory slot', '🎒'),
       ('slot_potion', slot_potion, 'Empty belt slot', '🧪')]

if __name__ == '__main__':
    os.makedirs(OUTDIR, exist_ok=True)
    from PIL import Image
    tiles = []
    for name, fn, _, _ in SET:
        c = fn()
        c.save(f'{OUTDIR}/{name}_1x.png', 1)
        c.save(f'{OUTDIR}/{name}.png', 4)
        tiles.append(c.image(8))
    sheet = Image.new('RGB', (7 * 150, 4 * 150), (241, 228, 195))
    for i, t in enumerate(tiles):
        x, y = (i % 7) * 150 + 11, (i // 7) * 150 + 11
        sheet.paste(t, (x, y), t)
        t2 = t
        dark = Image.new('RGB', (150, 150), (58, 42, 28)); dark.paste(t2, (11, 11), t2)
        sheet.paste(dark, ((i % 7) * 150, (i // 7 + 2) * 150))
    sheet.save(f'{OUTDIR}/_sheet.png')
    print('ok')
