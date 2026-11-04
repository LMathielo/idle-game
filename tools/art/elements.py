"""Village building blocks. Coordinates in base px; (x, y) is the left/bottom of the thing on the ground."""
import numpy as np
from pix import Canvas, ramp, hx, mix, BAYER
from scipy import ndimage

OUT = '#120c14'      # shadow-side outline / deepest black (never pure #000)
OUT_LIT = '#2a1c26'  # lit-side outline

M = dict(
    stone=ramp('#24222c', '#3c3a47', '#58566300'[:7], '#7b7884', '#a19d9f', '#c4bfb6'),
    darkstone=ramp('#16151d', '#25232e', '#383644', '#4f4c5a', '#6a6672'),
    wood=ramp('#24160f', '#3f2719', '#603b23', '#865630', '#ab7a45'),
    plaster=ramp('#4b3f3d', '#7a6a5e', '#a6957d', '#cbbb9a', '#e4d6b3'),
    roof_red=ramp('#2c1420', '#4c2029', '#723136', '#984a43', '#b8684f'),
    roof_slate=ramp('#171b29', '#252c40', '#384259', '#4f5c75', '#6c7b91'),
    roof_teal=ramp('#10201f', '#183433', '#234b47', '#336660', '#4a8478'),
    roof_purple=ramp('#1c1428', '#2e1f3e', '#463058', '#634575', '#83618f'),
    thatch=ramp('#33241a', '#57401f', '#7f5f2c', '#a7843d', '#c9a858'),
    pine=ramp('#0b1716', '#122622', '#1b382d', '#284c38', '#3a6446'),
    leaf=ramp('#101d19', '#193326', '#264b30', '#386638', '#548544', '#77a24f'),
    grass=ramp('#1a2b1f', '#243b25', '#30502c', '#406634', '#557d3d'),
    path=ramp('#3a2a22', '#5a4232', '#7c5f44', '#9c7d58', '#b99c70'),
    water=ramp('#0f1a2c', '#16294a', '#1f3d66', '#2e5a86', '#4f82a8', '#8fbcd0'),
    gold=ramp('#5a3a12', '#8f6420', '#c9962f', '#efc65a', '#fff0a8'),
    cloth_red=ramp('#3a0f18', '#661a22', '#93292c', '#bd4434'),
    cloth_blue=ramp('#101a38', '#1c2e5e', '#2c4886', '#4568ad'),
    cloth_cream=ramp('#6a5a48', '#a48f70', '#d4c198', '#efe3c0'),
    fur=ramp('#1e1418', '#33232a', '#4d3638', '#6b4d48', '#8d6b5e', '#ad8d78'),
)
M['stone'] = ramp('#24222c', '#3c3a47', '#585663', '#7b7884', '#a19d9f', '#c4bfb6')

WINDOW = ['#ffe9a8', '#ffc65c', '#e88a2e']


class Scene(Canvas):
    def __init__(self, w, h):
        super().__init__(w, h)
        self.lights = []          # (x, y, r, colour, strength)
        self.smoke = []
        self.rng = np.random.default_rng(11)

    def light(self, x, y, r, c='#ffb04a', s=0.55):
        self.lights.append((x, y, r, c, s))

    # ---------------- terrain ----------------
    def ground(self, y0, y1, rmp=None, tufts=True, flowers=None, seed=1):
        rmp = rmp or M['grass']
        m = self.m_rect(0, y0, self.w - 1, y1)
        self.vgrad(m, [rmp[1], rmp[2], rmp[3], rmp[3]], y0, y1)
        rng = np.random.default_rng(seed)
        nz = ndimage.gaussian_filter(rng.random((self.h, self.w)), 5)
        nz = (nz - nz[m].mean()) / nz[m].std()
        b = BAYER[self.yy % 4, self.xx % 4]
        self.fill(m & (nz > .9), rmp[2])
        self.fill(m & (nz > .6) & (nz <= .9) & (b < .5), rmp[2])
        self.fill(m & (nz < -.9), rmp[4])
        self.fill(m & (nz < -.6) & (nz >= -.9) & (b < .5), rmp[4])
        self.fill(m & (self.yy < y0 + 30) & (nz > 1.2), rmp[1])
        if tufts:
            for _ in range(int(self.w * (y1 - y0) / 28)):
                x, y = rng.integers(0, self.w), rng.integers(y0 + 2, y1)
                k = 4 if rng.random() < .5 else 0
                self.px(x, y, rmp[k]); self.px(x - 1, y + 1, rmp[k]); self.px(x + 1, y + 1, rmp[k])
        if flowers:
            for _ in range(int(self.w * (y1 - y0) / 220)):
                x, y = rng.integers(0, self.w), rng.integers(y0 + 4, y1)
                self.px(x, y, flowers[rng.integers(len(flowers))])

    def path(self, pts, width, rmp=None, cobble=False, seed=3):
        rmp = rmp or M['path']
        m = self.m_line(pts, width)
        m = ndimage.binary_closing(m, iterations=2) | m
        edge = m & ~ndimage.binary_erosion(m)
        self.fill(m, rmp[2])
        rng = np.random.default_rng(seed)
        r = rng.random(m.shape)
        self.fill(m & (r < .10), rmp[1])
        self.fill(m & (r > .92), rmp[3])
        if cobble:
            ys, xs = np.nonzero(m & ~edge)
            for x, y in zip(xs, ys):
                if (x + (y // 2) * 2) % 4 == 0 or y % 3 == 0:
                    self.px(x, y, rmp[1])
                elif (x + y) % 5 == 1:
                    self.px(x, y, rmp[4])
        self.fill(edge, rmp[1])
        lip = ndimage.binary_dilation(m) & ~m & self.alpha
        self.tint(lip & (BAYER[self.yy % 4, self.xx % 4] < .5), '#1a1410', .35)
        return m

    def water(self, mask, rmp=None, seed=4, sparkle=True):
        rmp = rmp or M['water']
        ys = np.nonzero(mask)[0]
        self.vgrad(mask, [rmp[3], rmp[2], rmp[2], rmp[1]], ys.min(), ys.max())
        rng = np.random.default_rng(seed)
        if sparkle:
            for _ in range(int(mask.sum() / 30)):
                ys_, xs_ = np.nonzero(mask)
                i = rng.integers(len(xs_))
                x, y = xs_[i], ys_[i]
                L = rng.integers(2, 5)
                for k in range(L):
                    if 0 <= x + k < self.w and mask[y, x + k]:
                        self.px(x + k, y, rmp[4] if k else rmp[5])
        shore = ndimage.binary_dilation(mask) & ~mask
        self.fill(shore & self.alpha, '#2b2a22')
        top = mask & ~np.roll(mask, 1, 0)
        self.fill(top, rmp[4])

    def mountain(self, cx, peak_y, half_w, base_y, rmp=None, snow=True, seed=5, snow_col=None):
        rmp = rmp or M['stone']
        rng = np.random.default_rng(seed)
        pts = [(cx - half_w, base_y)]
        n = 10
        for i in range(1, n):
            t = i / n
            x = cx - half_w + t * half_w
            y = base_y - (base_y - peak_y) * t + rng.integers(-2, 3)
            pts.append((x, y))
        pts.append((cx, peak_y))
        for i in range(1, n):
            t = i / n
            x = cx + t * half_w
            y = peak_y + (base_y - peak_y) * t + rng.integers(-2, 3)
            pts.append((x, y))
        pts.append((cx + half_w, base_y))
        m = self.m_poly(pts)
        # lit left face / shadow right face split along a wobbly ridge
        ridge = cx + (self.yy - peak_y) * 0.25 + np.sin(self.yy * .5) * 1.5
        left = m & (self.xx < ridge)
        self.vgrad(left, [rmp[3], rmp[2], rmp[2]], peak_y, base_y)
        self.vgrad(m & ~left, [rmp[2], rmp[1], rmp[1]], peak_y, base_y)
        # crags
        for _ in range(int(half_w * .8)):
            y = rng.integers(peak_y + 4, base_y)
            x = rng.integers(cx - half_w, cx + half_w)
            if m[min(y, self.h - 1), min(max(x, 0), self.w - 1)]:
                L = rng.integers(2, 5)
                for k in range(L):
                    self.px(x + k, y + k // 2, rmp[1] if x > cx else rmp[2])
        if snow:
            sc = snow_col or ['#e8eef2', '#b9c6d6', '#8796ae']
            line = peak_y + (base_y - peak_y) * .32 + np.sin(self.xx * .9) * 2 + np.cos(self.xx * .37) * 2
            sm = m & (self.yy < line)
            self.fill(sm & left, sc[0])
            self.fill(sm & ~left, sc[1])
            self.fill(sm & ~left & (BAYER[self.yy % 4, self.xx % 4] < .3), sc[2])
        return m

    def hills(self, y, amp, col_top, col, seed=6, freq=.05):
        rng = np.random.default_rng(seed)
        ph = rng.random() * 6
        top = y - amp * (np.sin(np.arange(self.w) * freq + ph) * .6 + np.sin(np.arange(self.w) * freq * 2.3 + ph) * .4)
        m = self.yy >= top[None, :].astype(int)
        m &= self.yy < y + amp + 40
        self.fill(m, col)
        edge = m & ~np.roll(m, 1, 0)
        self.fill(edge, col_top)
        return m

    # ---------------- vegetation ----------------
    def pine(self, x, y, h, rmp=None, snow=False):
        rmp = rmp or M['pine']
        w = max(3, int(h * .42))
        pts = []
        tiers = max(3, h // 5)
        left, right = [], []
        for i in range(tiers + 1):
            t = i / tiers
            ty = y - h + int(t * (h - 2))
            tw = 1 + t * w
            left.append((x - tw, ty + 1)); left.append((x - tw * .55, ty + 1))
            right.append((x + tw, ty + 1)); right.append((x + tw * .55, ty + 1))
        pts = [(x, y - h)] + right[1:] + [(x + w * .9, y - 2), (x - w * .9, y - 2)] + left[::-1][:-1]
        m = self.m_poly(pts)
        self.fill(self.m_rect(x, y - 3, x, y), rmp[0])
        self.shade(m, rmp, soft=1.2, light=(-1, -.6))
        if snow:
            sn = m & ~np.roll(m, 1, 0)
            self.fill(sn & (self.xx <= x + 1), '#d8e2ea')
        self.outline(m, rmp[0], OUT)

    def tree(self, x, y, r, rmp=None, seed=0, trunk=True):
        rmp = rmp or M['leaf']
        rng = np.random.default_rng(seed)
        m = self.empty()
        for _ in range(5):
            ox, oy = rng.integers(-r // 2, r // 2 + 1), rng.integers(-r // 2, r // 3 + 1)
            rr = r * (0.55 + rng.random() * .3)
            m |= self.m_ellipse(x + ox, y - r - 2 + oy, rr, rr * .85)
        if trunk:
            self.shade(self.m_rect(x - 1, y - r // 2 - 2, x + 1, y), M['wood'][:4], mode='flat', outline=OUT)
        self.shade(m, rmp, soft=r * .45)
        # leaf clusters texture
        ys, xs = np.nonzero(m)
        for i in rng.choice(len(xs), size=len(xs) // 9, replace=False):
            self.px(xs[i], ys[i], rmp[max(0, min(len(rmp) - 1, int(rng.integers(0, 2)) + (2 if xs[i] < x else 0)))])
        self.outline(m, rmp[0], OUT)
        return m

    def bush(self, x, y, r, rmp=None, berries=None, seed=0):
        rmp = rmp or M['leaf']
        m = self.m_ellipse(x, y - r * .6, r, r * .7)
        self.shade(m, rmp, soft=r * .5, outline=rmp[0], line_dark=OUT)
        if berries:
            rng = np.random.default_rng(seed)
            ys, xs = np.nonzero(m)
            for i in rng.choice(len(xs), size=max(1, len(xs) // 12), replace=False):
                self.px(xs[i], ys[i], berries)

    def dead_tree(self, x, y, h, col='#2a1f22'):
        pts = [(x, y), (x, y - h)]
        self.fill(self.m_line(pts, 2), col)
        rng = np.random.default_rng(x)
        for k in range(4):
            yy = y - h * (.4 + k * .15)
            d = -1 if k % 2 else 1
            self.fill(self.m_line([(x, yy), (x + d * (4 + k), yy - 3 - k), (x + d * (6 + k), yy - 6 - k)], 1), col)
        self.outline(self.m_line(pts, 2), OUT)

    def mushroom(self, x, y, cap='#7a3fb0', glow='#b98cff', size=2):
        self.fill(self.m_rect(x, y - size, x, y), '#d9cfb8')
        self.fill(self.m_rect(x - size + 1, y - size - 1, x + size - 1, y - size), cap)
        self.px(x - size + 2, y - size - 1, glow)
        self.light(x, y - size, 4 + size * 2, glow, .28)

    # ---------------- structures ----------------
    def house(self, x, y, w, wall_h, roof='roof_red', wall='plaster', timber=True, door=True, windows=2,
              chimney=False, lit=True, roof_h=None, sign=None):
        rr = M[roof]
        wm = self.m_rect(x, y - wall_h, x + w - 1, y - 1)
        self.shade(wm, M[wall][1:], mode='flat', dither=False)
        if wall == 'stone':
            for yy in range(y - wall_h, y):
                if (yy - y) % 3 == 0:
                    self.fill(wm & (self.yy == yy), M['stone'][1])
                else:
                    off = 0 if ((yy - y) // 3) % 2 else 2
                    for xx in range(x + off, x + w, 4):
                        self.px(xx, yy, M['stone'][1])
        if timber:
            tc = M['wood'][1]
            self.fill(self.m_rect(x, y - wall_h, x, y - 1), tc)
            self.fill(self.m_rect(x + w - 1, y - wall_h, x + w - 1, y - 1), tc)
            self.fill(self.m_rect(x, y - wall_h, x + w - 1, y - wall_h), tc)
            mid = y - wall_h // 2 - 1
            self.fill(self.m_rect(x, mid, x + w - 1, mid), tc)
            if w >= 14:
                self.fill(self.m_line([(x + 1, mid - 1), (x + 4, y - wall_h + 1)]), tc)
                self.fill(self.m_line([(x + w - 2, mid - 1), (x + w - 5, y - wall_h + 1)]), tc)
        # roof
        rh = roof_h or (w // 2 + 3)
        top = y - wall_h
        rpts = [(x - 2, top + 1), (x + w / 2 - .5, top - rh), (x + w + 1, top + 1)]
        rm = self.m_poly(rpts)
        cx = x + w / 2 - .5
        leftside = rm & (self.xx <= cx)
        self.fill(rm, rr[1])
        self.fill(leftside, rr[2])
        rows = (top - self.yy) % 3 == 0
        self.fill(rm & rows & leftside, rr[1])
        self.fill(rm & rows & ~leftside, rr[0])
        stag = rm & ~rows & (((self.xx + ((top - self.yy) // 3) * 2) % 4) == 0) & ((top - self.yy) % 3 == 1)
        self.fill(stag & leftside, rr[1])
        ridge = rm & (np.abs(self.xx - cx) < 1) | (rm & ~np.roll(rm, 1, 0) & leftside)
        self.fill(ridge, rr[3])
        self.fill(rm & ~np.roll(rm, 1, 1) & leftside, rr[4])
        # eave shadow
        self.fill(self.m_rect(x, top + 1, x + w - 1, top + 1), M['wood'][0])
        if chimney:
            cxp = int(x + w * .72)
            cm = self.m_rect(cxp, top - rh + 4, cxp + 2, top - rh // 2 + 1) & ~(rm & (self.yy > top - rh // 2 + 1))
            self.shade(cm, M['stone'][1:5], mode='flat', dither=False)
            self.fill(self.m_rect(cxp - 1, top - rh + 3, cxp + 3, top - rh + 3), M['stone'][1])
            self.smoke.append((cxp + 1, top - rh + 2))
        # door
        if door:
            dx = x + w // 2 - 2 if windows != 1 else x + w - 6
            dm = self.m_rect(dx, y - 7, dx + 3, y - 1) & ~(self.m_rect(dx, y - 7, dx, y - 7) | self.m_rect(dx + 3, y - 7, dx + 3, y - 7))
            self.fill(dm, M['wood'][1])
            self.fill(self.m_rect(dx + 1, y - 6, dx + 1, y - 1), M['wood'][2])
            self.px(dx + 2, y - 4, M['gold'][3])
            self.fill(self.m_rect(dx - 1, y - 1, dx + 4, y - 1) & ~dm, M['stone'][2])
        # windows
        wins = []
        if windows >= 1:
            wy = y - wall_h + 3 if wall_h < 14 else y - wall_h // 2 - 5
            if windows == 1:
                wins = [x + 3]
            elif windows == 2:
                wins = [x + 3, x + w - 6] if w >= 16 else [x + 2, x + w - 5]
            else:
                wins = [x + 3, x + w // 2 - 1, x + w - 6]
            for wx in wins:
                self.window(wx, wy, lit)
            if wall_h >= 18 and w >= 18:
                self.window(int(cx - 1), y - wall_h - 4, lit, small=True)
        allm = wm | rm
        self.outline(allm, OUT_LIT, OUT)
        return allm

    def window(self, x, y, lit=True, small=False):
        h = 2 if small else 3
        fm = self.m_rect(x - 1, y - 1, x + 3, y + h)
        self.fill(fm, M['wood'][1])
        gm = self.m_rect(x, y, x + 2, y + h - 1)
        if lit:
            self.fill(gm, WINDOW[1])
            self.px(x, y, WINDOW[0])
            self.fill(self.m_rect(x, y + h - 1, x + 2, y + h - 1), WINDOW[2])
            self.fill(self.m_rect(x + 1, y, x + 1, y + h - 1), M['wood'][2])
            self.light(x + 1, y + 2, 7, '#ffae4a', .26)
        else:
            self.fill(gm, '#1d2433')
            self.px(x, y, '#3d4a63')

    def tower(self, x, y, w, h, roof='roof_slate', cone=True, wall='stone', windows=3, lit=True, crystal=None, flag=None):
        wm = self.m_rect(x, y - h, x + w - 1, y - 1)
        self.shade(wm, M['stone'][1:], mode='flat', dither=False)
        # rounded shading: left third lit, right third dark
        self.tint(wm & (self.xx < x + w * .3), '#c4bfb6', .18)
        self.tint(wm & (self.xx >= x + w * .7), '#120c14', .35)
        for yy in range(y - h, y):
            if (yy - y) % 3 == 0:
                self.fill(wm & (self.yy == yy), M['stone'][1])
            else:
                off = 0 if ((yy - y) // 3) % 2 else 2
                for xx in range(x + off, x + w, 4):
                    self.px(xx, yy, M['stone'][1])
        top = y - h
        allm = wm
        if cone:
            rh = int(w * 1.3)
            rm = self.m_poly([(x - 2, top + 1), (x + w / 2 - .5, top - rh), (x + w + 1, top + 1)])
            rr = M[roof]
            cx = x + w / 2 - .5
            self.fill(rm, rr[1])
            self.fill(rm & (self.xx < cx - w * .15), rr[2])
            self.fill(rm & (self.xx < cx - w * .35), rr[3])
            self.fill(rm & ((top - self.yy) % 3 == 0), rr[0])
            allm = allm | rm
            if flag:
                fx = int(cx)
                self.fill(self.m_rect(fx, top - rh - 6, fx, top - rh), M['wood'][1])
                self.fill(self.m_poly([(fx + 1, top - rh - 6), (fx + 6, top - rh - 5), (fx + 1, top - rh - 3)]), flag)
        else:
            # crenellations
            cm = self.empty()
            for xx in range(x - 1, x + w + 1, 3):
                cm |= self.m_rect(xx, top - 3, xx + 1, top)
            cm |= self.m_rect(x - 1, top - 1, x + w, top)
            self.shade(cm, M['stone'][1:], mode='flat', dither=False)
            allm = allm | cm
        for i in range(windows):
            wy = top + 4 + i * max(7, (h - 8) // max(1, windows))
            if wy < y - 6:
                # arrow-slit
                sx = x + w // 2 - 1
                self.fill(self.m_rect(sx - 1, wy - 1, sx + 2, wy + 4), M['stone'][1])
                self.fill(self.m_rect(sx, wy, sx + 1, wy + 3), WINDOW[1] if lit else '#1d2433')
                if lit:
                    self.px(sx, wy, WINDOW[0])
                    self.light(sx + .5, wy + 2, 6, '#ffae4a', .26)
        self.outline(allm, OUT_LIT, OUT)
        if crystal:
            self.crystal(x + w // 2, top - (int(w * 1.3) if cone else 4), crystal)
        return allm

    def crystal(self, x, y, col, size=4):
        c = ramp(*col) if isinstance(col[0], str) else col
        m = self.m_poly([(x, y - size * 2), (x + size, y - size), (x, y), (x - size, y - size)])
        self.fill(m, c[1])
        self.fill(m & (self.xx < x), c[2])
        self.fill(m & (self.xx < x) & (self.yy < y - size), c[3])
        self.px(x - 1, y - size - 2, '#ffffff')
        self.outline(m, c[0])
        self.light(x, y - size, 22, c[2], .4)

    def cave(self, x, y, w, h, rmp=None, eyes=True, torches=True):
        rmp = rmp or M['darkstone']
        mound = self.m_ellipse(x + w / 2, y, w / 2 + 6, h + 4) & (self.yy < y)
        self.shade(mound, rmp, soft=3, outline=OUT)
        rng = np.random.default_rng(9)
        ys, xs = np.nonzero(mound)
        for i in rng.choice(len(xs), len(xs) // 10, replace=False):
            self.px(xs[i], ys[i], rmp[1])
        mouth = self.m_ellipse(x + w / 2, y, w / 2 - 2, h - 2) & (self.yy < y)
        self.vgrad(mouth, ['#120c14', '#0a0710', '#050308'], y - h, y)
        # teeth-like rocks on the arch
        arch = ndimage.binary_dilation(mouth) & ~mouth & mound
        self.fill(arch, rmp[3])
        for k in range(0, w - 4, 3):
            xx = x + 3 + k
            col_top = np.nonzero(mouth[:, int(min(xx, self.w - 1))])[0]
            if len(col_top):
                yy = col_top.min()
                self.px(xx, yy, rmp[2]); self.px(xx, yy + 1, rmp[1])
        if eyes:
            ex, ey = int(x + w / 2), y - h // 3 - 1
            for dx in (-2, 2):
                self.px(ex + dx, ey, '#ff3b2f')
            self.light(ex, ey, 6, '#ff2a1a', .35)
        if torches:
            for tx in (x + 1, x + w - 2):
                self.torch(int(tx), y)

    def crypt(self, cx, y, w=22, rmp=None, accent='#ff3b2f', skull=True, torches=True, torch_col='#ff9a3c'):
        rmp = rmp or M['darkstone']
        rng = np.random.default_rng(cx)
        pts = [(cx - w - 14, y + 2)]
        for i in range(9):
            t = i / 8
            pts.append((cx - w - 12 + t * (2 * w + 24), y - 26 - 10 * np.sin(t * np.pi) + rng.integers(-4, 4)))
        pts.append((cx + w + 14, y + 2))
        crag = self.m_poly(pts)
        self.shade(crag, rmp, soft=4, outline=OUT)
        for _ in range(26):
            px_, py_ = cx + rng.integers(-w - 8, w + 8), y - rng.integers(4, 30)
            if crag[py_, px_]:
                L = rng.integers(2, 5)
                for k in range(L):
                    self.px(px_ + k, py_ + k // 2, rmp[1])
                self.px(px_ - 1, py_, rmp[3])
        # carved arch of blocks
        hw, hh = w // 2, 15
        ring = self.m_ellipse(cx, y - 2, hw + 3, hh + 3) & (self.yy < y)
        inner = self.m_ellipse(cx, y - 2, hw, hh) & (self.yy < y)
        self.fill(ring, M['stone'][3])
        blocks = ring & ~inner & (((np.arctan2(self.yy - (y - 2), self.xx - cx) * 7).astype(int)) % 2 == 0)
        self.fill(blocks, M['stone'][2])
        self.fill(ring & ~inner & (self.xx > cx + 2), M['stone'][1])
        self.vgrad(inner, ['#050308', '#0a0710', '#140c14'], y - hh - 2, y)
        self.outline(ring, OUT)
        # steps
        for k in range(3):
            self.fill(self.m_rect(cx - hw - k, y + k, cx + hw + k, y + k), M['stone'][3 - (k % 2)])
        ex, ey = cx, y - hh // 2
        for dx in (-2, 2):
            self.px(ex + dx, ey, accent)
        self.light(ex, ey, 7, accent, .35)
        if skull:
            sy = y - hh - 6
            sk = self.m_ellipse(cx, sy, 2.5, 2.2) | self.m_rect(cx - 1, sy + 2, cx + 1, sy + 3)
            self.fill(sk, '#d9d0bc'); self.px(cx - 1, sy, '#120c14'); self.px(cx + 1, sy, '#120c14'); self.px(cx, sy + 3, '#8a8070')
            self.outline(sk, OUT)
        if torches:
            self.torch(cx - hw - 5, y, torch_col); self.torch(cx + hw + 5, y, torch_col)
        return crag

    def rock(self, x, y, r=2, rmp=None):
        rmp = rmp or M['stone']
        m = self.m_ellipse(x, y - r * .6, r + 1, r * .7)
        self.shade(m, rmp[:5], soft=1, outline=OUT)

    def field(self, x0, y0, x1, y1, crop='#7a8a3a', crop_hi='#b5a84a'):
        m = self.m_rect(x0, y0, x1, y1)
        self.fill(m, M['path'][1])
        for yy in range(y0, y1 + 1, 3):
            self.fill(m & (self.yy == yy), M['path'][2])
            for xx in range(x0 + (yy % 2), x1 + 1, 2):
                self.px(xx, yy - 1, crop)
                if (xx + yy) % 5 == 0:
                    self.px(xx, yy - 2, crop_hi)
        self.outline(m, M['wood'][1])

    def torch(self, x, y, col='#ff9a3c'):
        self.fill(self.m_rect(x, y - 6, x, y), M['wood'][1])
        self.px(x, y - 7, '#ffd36b'); self.px(x, y - 8, '#ff9a3c'); self.px(x - 1, y - 7, '#e0552a'); self.px(x + 1, y - 7, '#e0552a')
        self.light(x, y - 7, 12, col, .34)

    def lamppost(self, x, y, col='#ffb04a'):
        self.fill(self.m_rect(x, y - 9, x, y), '#2b2430')
        self.fill(self.m_rect(x - 1, y - 12, x + 1, y - 10), col)
        self.px(x, y - 13, '#2b2430'); self.px(x - 1, y - 12, '#2b2430')
        self.light(x, y - 11, 12, col, .3)

    def mine(self, x, y, rmp=None):
        """Timber-framed shaft in a rock face with rails and a cart. (x, y) = left foot of the frame (9 wide)."""
        rmp = rmp or M['stone']
        face = self.m_poly([(x - 13, y), (x - 11, y - 8), (x - 7, y - 13), (x - 2, y - 15), (x + 3, y - 20), (x + 8, y - 17),
                            (x + 13, y - 18), (x + 17, y - 11), (x + 20, y - 6), (x + 22, y)])
        self.shade(face, rmp[:5], soft=2.5, outline=OUT)
        rng = np.random.default_rng(x)
        for _ in range(10):
            cx_, cy_ = x + rng.integers(-9, 19), y - rng.integers(3, 15)
            if face[cy_, cx_]:
                self.px(cx_, cy_, rmp[1]); self.px(cx_ + 1, cy_ + 1, rmp[1])
        for ox, oy, c in ((-6, -9, '#efc65a'), (14, -12, '#8fbcd0'), (-3, -4, '#efc65a')):
            self.px(x + ox, y + oy, c)
        hole = self.m_rect(x + 1, y - 9, x + 7, y - 1)
        self.vgrad(hole, ['#0a0710', '#120c14'], y - 9, y)
        wd = M['wood']
        self.fill(self.m_rect(x, y - 10, x, y - 1), wd[3]); self.fill(self.m_rect(x + 8, y - 10, x + 8, y - 1), wd[2])
        self.fill(self.m_rect(x - 1, y - 11, x + 9, y - 10), wd[3]); self.fill(self.m_rect(x - 1, y - 10, x + 9, y - 10), wd[1])
        # rails
        for k in range(7):
            self.px(x + 2 - k // 2, y + k, '#5a5560'); self.px(x + 6 + k // 3, y + k, '#5a5560')
            if k % 2 == 0:
                self.fill(self.m_rect(x + 2 - k // 2, y + k, x + 6 + k // 3, y + k), wd[1])
                self.px(x + 2 - k // 2, y + k, '#7b7884'); self.px(x + 6 + k // 3, y + k, '#7b7884')
        # cart
        cm = self.m_poly([(x + 11, y - 1), (x + 18, y - 1), (x + 17, y + 3), (x + 12, y + 3)])
        self.shade(cm, M['wood'][1:], mode='flat', dither=False, outline=OUT)
        self.px(x + 12, y + 4, '#1a1a22'); self.px(x + 17, y + 4, '#1a1a22')
        for i, c in enumerate(['#8a8f9e', '#c9962f', '#6a6f7e', '#efc65a']):
            self.px(x + 12 + i * 1 + (i // 2), y - 2, c)
        self.px(x + 14, y - 3, '#a19d9f')
        self.lamppost(x - 4, y + 1, '#ffb04a')

    def stall(self, x, y, w=16, stripe=('#93292c', '#e4d6b3')):
        wd = M['wood']
        self.fill(self.m_rect(x, y - 12, x, y - 1), wd[1]); self.fill(self.m_rect(x + w - 1, y - 12, x + w - 1, y - 1), wd[1])
        cm = self.m_rect(x, y - 5, x + w - 1, y - 1)
        self.shade(cm, wd[1:], mode='flat', dither=False)
        self.fill(self.m_rect(x, y - 5, x + w - 1, y - 5), wd[4])
        # goods
        goods = ['#4568ad', '#efc65a', '#77a24f', '#bd4434', '#a19d9f', '#c79bf2']
        for i in range(1, w - 1, 2):
            self.px(x + i, y - 6, goods[i % len(goods)])
            if i % 4 == 1:
                self.px(x + i, y - 7, goods[(i + 2) % len(goods)])
        # awning: scalloped stripes
        am = self.m_poly([(x - 2, y - 11), (x + 1, y - 15), (x + w - 2, y - 15), (x + w + 1, y - 11)])
        for xx in range(x - 2, x + w + 2):
            am |= self.m_rect(xx, y - 10, xx, y - 10) if (xx - x) % 3 != 2 else self.empty()
        sel = ((self.xx - x) // 3) % 2 == 0
        self.fill(am & sel, stripe[0]); self.fill(am & ~sel, stripe[1])
        self.tint(am & (self.yy == y - 15), '#ffffff', .2)
        self.tint(am & (self.yy >= y - 10), '#120c14', .35)
        allm = am | cm | self.m_rect(x, y - 12, x, y - 1) | self.m_rect(x + w - 1, y - 12, x + w - 1, y - 1)
        self.outline(allm, OUT_LIT, OUT)
        # lantern
        self.px(x + w - 3, y - 9, '#ffc65c'); self.light(x + w - 3, y - 9, 9, '#ffb04a', .3)
        # crates
        for cx_, cy_ in ((x + w + 2, y), (x + w + 5, y), (x + w + 3, y - 3)):
            m = self.m_rect(cx_, cy_ - 3, cx_ + 2, cy_ - 1)
            self.shade(m, wd[1:], mode='flat', dither=False)
            self.outline(m, OUT)

    def barn(self, x, y, w=26, h=14, roof='roof_red'):
        allm = self.house(x, y, w, h, roof=roof, wall='plaster', timber=True, door=False, windows=0, roof_h=w // 2 + 2)
        dx = x + w // 2 - 5
        dm = self.m_rect(dx, y - 10, dx + 9, y - 1)
        self.fill(dm, M['wood'][2])
        self.fill(self.m_line([(dx, y - 10), (dx + 9, y - 1)]), M['wood'][1])
        self.fill(self.m_line([(dx + 9, y - 10), (dx, y - 1)]), M['wood'][1])
        self.outline(dm, M['wood'][0])
        self.fill(self.m_rect(dx + 4, y - 10, dx + 5, y - 1), M['wood'][1])
        self.window(x + w // 2 - 1, y - h - 6, True, small=True)
        # hay bales & barrels
        for i, bx in enumerate((x - 5, x + w + 1, x + w + 4)):
            m = self.m_ellipse(bx + 1.5, y - 2, 2, 2)
            self.shade(m, M['thatch'], soft=1, outline=OUT)
        return allm

    def yard(self, x, y, w=28, h=14):
        wd = M['wood']
        dirt = self.m_rect(x, y - h, x + w, y)
        self.fill(dirt, M['path'][2])
        self.speckle(dirt, [M['path'][1], M['path'][3]], .15, seed=x)
        for xx in range(x, x + w + 1, 4):
            for yy in (y - h, y):
                self.fill(self.m_rect(xx, yy - 3, xx, yy), wd[2]); self.px(xx, yy - 3, wd[4])
        for yy in (y - h, y):
            self.fill(self.m_rect(x, yy - 2, x + w, yy - 2), wd[3])
            self.fill(self.m_rect(x, yy - 1, x + w, yy - 1), wd[1])
        for yy in range(y - h, y + 1, 4):
            self.px(x, yy, wd[2]); self.px(x + w, yy, wd[2])
        # dummies
        for dx in (x + 6, x + 14):
            self.fill(self.m_rect(dx, y - 9, dx, y - 3), wd[1])
            body = self.m_ellipse(dx, y - 8, 2, 3)
            self.shade(body, M['thatch'], soft=1)
            self.fill(self.m_rect(dx - 4, y - 9, dx + 4, y - 9), wd[2])
            self.shade(self.m_ellipse(dx, y - 12, 1.5, 1.5), M['cloth_cream'], soft=1)
            self.outline(body | self.m_ellipse(dx, y - 12, 1.5, 1.5), OUT)
        # target
        tx = x + w - 6
        t = self.m_ellipse(tx, y - 8, 3, 3)
        self.fill(t, '#e4d6b3'); self.fill(self.m_ellipse(tx, y - 8, 2, 2), '#93292c'); self.px(tx, y - 8, '#e4d6b3')
        self.outline(t, OUT)
        self.fill(self.m_rect(tx - 1, y - 5, tx - 1, y - 3), wd[1]); self.fill(self.m_rect(tx + 1, y - 5, tx + 1, y - 3), wd[1])
        # weapon rack
        rx = x + w - 12
        self.fill(self.m_rect(rx, y - 6, rx + 4, y - 6), wd[2])
        for k in range(3):
            self.fill(self.m_rect(rx + k * 2, y - 11, rx + k * 2, y - 4), '#a19d9f')
            self.px(rx + k * 2, y - 11, '#e4e1da')

    def forge(self, x, y, w=20):
        h = 10
        allm = self.house(x, y, w, h, roof='roof_slate', wall='stone', timber=False, door=False, windows=0, chimney=True)
        # open front with furnace glow
        om = self.m_rect(x + 2, y - 8, x + 9, y - 1)
        self.fill(om, '#1a1018')
        self.fill(self.m_rect(x + 3, y - 4, x + 6, y - 1), '#ff7a2a')
        self.fill(self.m_rect(x + 4, y - 3, x + 5, y - 1), '#ffd36b')
        self.light(x + 5, y - 3, 15, '#ff7a2a', .4)
        # anvil
        ax = x + w + 2
        am = self.m_poly([(ax, y - 5), (ax + 6, y - 5), (ax + 5, y - 3), (ax + 4, y - 3), (ax + 4, y - 1), (ax + 2, y - 1), (ax + 2, y - 3), (ax + 1, y - 3)])
        self.shade(am, ['#25232e', '#3c3a47', '#585663', '#7b7884'], mode='flat', dither=False, outline=OUT)
        self.window(x + w - 6, y - 8, True)

    def hall(self, x, y, w=30, h=18, roof='roof_slate', banner='#93292c', bell=True):
        # stone ground floor, timber upper
        base = self.house(x, y, w, h, roof=roof, wall='plaster', timber=True, door=False, windows=3, roof_h=w // 2 - 2)
        sm = self.m_rect(x, y - 7, x + w - 1, y - 1)
        self.shade(sm, M['stone'][1:], mode='flat', dither=False)
        for yy in range(y - 7, y):
            off = 0 if (yy % 2) else 2
            for xx in range(x + off, x + w, 4):
                self.px(xx, yy, M['stone'][1])
        # big door
        dx = x + w // 2 - 3
        dm = self.m_rect(dx, y - 8, dx + 5, y - 1) & ~self.m_rect(dx, y - 8, dx, y - 8) & ~self.m_rect(dx + 5, y - 8, dx + 5, y - 8)
        self.fill(dm, M['wood'][1]); self.fill(self.m_rect(dx + 1, y - 7, dx + 2, y - 1), M['wood'][2])
        self.px(dx + 3, y - 4, M['gold'][3])
        self.outline(base, OUT_LIT, OUT)
        # banners
        for bx in (x + 2, x + w - 5):
            bm = self.m_poly([(bx, y - 15), (bx + 2, y - 15), (bx + 2, y - 9), (bx + 1, y - 10), (bx, y - 9)])
            self.fill(bm, banner); self.fill(bm & (self.xx == bx), mix(hx(banner), hx('#ffffff'), .25))
            self.px(bx + 1, y - 13, M['gold'][3])
        if bell:
            # bell tower on the ridge
            tx = x + w // 2 - 3
            top = y - h - (w // 2 - 2)
            tm = self.m_rect(tx, top - 8, tx + 5, top + 2)
            self.shade(tm, M['wood'][1:], mode='flat', dither=False)
            self.fill(self.m_rect(tx + 1, top - 6, tx + 4, top - 2), '#120c14')
            self.fill(self.m_rect(tx + 2, top - 5, tx + 3, top - 3), M['gold'][3]); self.px(tx + 2, top - 5, M['gold'][4])
            rm = self.m_poly([(tx - 2, top - 7), (tx + 2.5, top - 13), (tx + 7, top - 7)])
            rr = M[roof]
            self.fill(rm, rr[1]); self.fill(rm & (self.xx < tx + 2.5), rr[2])
            self.outline(tm | rm, OUT_LIT, OUT)
            self.fill(self.m_rect(tx + 2, top - 17, tx + 2, top - 13), M['wood'][1])
            self.fill(self.m_poly([(tx + 3, top - 17), (tx + 8, top - 16), (tx + 3, top - 14)]), banner)

    def well(self, x, y):
        m = self.m_rect(x, y - 3, x + 6, y - 1)
        self.shade(m, M['stone'][1:], mode='flat', dither=False)
        self.fill(self.m_rect(x + 1, y - 3, x + 5, y - 3), '#16294a')
        self.fill(self.m_rect(x, y - 9, x, y - 3), M['wood'][2]); self.fill(self.m_rect(x + 6, y - 9, x + 6, y - 3), M['wood'][2])
        rm = self.m_poly([(x - 1, y - 9), (x + 3, y - 12), (x + 7, y - 9)])
        self.fill(rm, M['roof_red'][2])
        self.outline(m | rm, OUT)

    def fence(self, x0, x1, y):
        wd = M['wood']
        for xx in range(x0, x1 + 1, 3):
            self.fill(self.m_rect(xx, y - 3, xx, y), wd[2])
        self.fill(self.m_rect(x0, y - 2, x1, y - 2), wd[3])

    def standing_stone(self, x, y, h=8, rune='#7fe0ff'):
        m = self.m_poly([(x, y), (x - 1, y - h + 2), (x + 1, y - h), (x + 3, y - h + 1), (x + 4, y)])
        self.shade(m, M['stone'][:5], mode='round', soft=1, outline=OUT)
        self.px(x + 2, y - h // 2, rune); self.px(x + 2, y - h // 2 - 2, rune); self.px(x + 1, y - h // 2 - 1, rune)
        self.light(x + 2, y - h // 2, 8, rune, .32)

    def bridge(self, x0, x1, y):
        wd = M['wood']
        m = self.m_rect(x0, y - 2, x1, y + 2)
        self.fill(m, wd[2])
        for xx in range(x0, x1 + 1, 2):
            self.fill(self.m_rect(xx, y - 2, xx, y + 2), wd[1])
        self.fill(self.m_rect(x0, y - 4, x1, y - 4), wd[3])
        for xx in (x0, x1, (x0 + x1) // 2):
            self.fill(self.m_rect(xx, y - 4, xx, y - 2), wd[1])
        self.outline(m, OUT)

    def plot(self, x, y, w, h):
        m = self.m_rect(x, y - h, x + w, y)
        self.fill(m, M['path'][1])
        self.speckle(m, [M['path'][0], M['path'][2]], .25, seed=x)
        for cx_, cy_ in ((x, y - h), (x + w, y - h), (x, y), (x + w, y)):
            self.fill(self.m_rect(cx_, cy_ - 3, cx_, cy_), M['wood'][3])
        for xx in range(x, x + w + 1, 2):
            self.px(xx, y - h - 2, '#c9b894'); self.px(xx, y - 2, '#c9b894')

    # ---------------- sky & atmosphere ----------------
    def stars(self, y1, n=60, seed=2, cols=('#f5efe2', '#c9d4ff', '#ffe9b0')):
        rng = np.random.default_rng(seed)
        for _ in range(n):
            x, y = rng.integers(0, self.w), rng.integers(0, y1)
            c = cols[rng.integers(len(cols))]
            if rng.random() < .1:
                self.px(x, y, c)
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    self.px(x + dx, y + dy, mix(self.rgb[min(y + dy, self.h - 1), min(x + dx, self.w - 1)], hx(c), .5))
            else:
                self.px(x, y, mix(self.rgb[y, x], hx(c), .4 + rng.random() * .6))

    def moon(self, x, y, r, col=('#f6f0d8', '#d9d2b6', '#b5ad92'), crescent=True, halo='#9fb8ff'):
        m = self.m_ellipse(x, y, r, r)
        self.glow(x, y, r * 4, halo, .25, steps=3)
        self._sky_backup = self.rgb.copy()
        self.fill(m, col[0])
        self.fill(m & (self.xx > x + r * .3), col[1])
        rng = np.random.default_rng(3)
        for _ in range(r):
            cx_, cy_ = x + rng.integers(-r // 2, r // 2 + 1), y + rng.integers(-r // 2, r // 2 + 1)
            if m[cy_, cx_]:
                self.px(cx_, cy_, col[2])
        if crescent:
            cut = self.m_ellipse(x + r * .55, y - r * .3, r * .95, r * .95)
            self.rgb[m & cut] = self._sky_backup[m & cut]

    def clouds(self, y, n, cols, seed=8, w=(10, 26)):
        rng = np.random.default_rng(seed)
        for _ in range(n):
            cx, cy = rng.integers(-10, self.w + 10), y + rng.integers(-8, 9)
            L = rng.integers(*w)
            m = self.empty()
            for k in range(3):
                m |= self.m_ellipse(cx + (k - 1) * L / 3, cy - (k == 1) * 2, L / 3, 2.5)
            m |= self.m_rect(int(cx - L / 2), cy, int(cx + L / 2), cy + 1)
            self.fill(m, cols[1])
            self.fill(m & ~np.roll(m, 1, 0), cols[0])
            self.fill(m & ~np.roll(m, -1, 0), cols[2])

    def aurora(self, y, amp, cols, seed=1):
        rng = np.random.default_rng(seed)
        ph = rng.random() * 6
        for i, c in enumerate(cols):
            base = y + i * 3 + amp * np.sin(np.arange(self.w) * .045 + ph + i * .3)
            for x in range(self.w):
                b = int(base[x])
                L = int(6 + 5 * np.sin(x * .13 + ph))
                for yy in range(b - L, b):
                    if 0 <= yy < self.h and BAYER[yy % 4, x % 4] < (.65 - (b - yy) / (L + 1) * .55):
                        self.rgb[yy, x] = mix(self.rgb[yy, x], hx(c), .45)

    def fog(self, y0, y1, col, strength=.5, seed=4):
        rng = np.random.default_rng(seed)
        edge_top = y0 + 3 * np.sin(np.arange(self.w) * .09 + rng.random() * 6) + 2 * np.sin(np.arange(self.w) * .23)
        t = np.clip((self.yy - edge_top[None, :]) / max(1, (y1 - y0)), 0, 1)
        t = np.where(self.yy > y1, np.clip(1 - (self.yy - y1) / 10, 0, 1), np.minimum(1, t * 3))
        t = t * strength
        b = BAYER[self.yy % 4, self.xx % 4]
        full = t > .5
        self.tint(full, col, .5)
        self.tint(~full & (t * 2 > b), col, .5)

    def fireflies(self, region, n, col='#d8ff7a', seed=5):
        x0, y0, x1, y1 = region
        rng = np.random.default_rng(seed)
        for _ in range(n):
            x, y = rng.integers(x0, x1), rng.integers(y0, y1)
            self.light(x, y, 3, col, .35)
            self.px(x, y, col)

    def draw_smoke(self, col=('#8a8494', '#5e5a68')):
        for x, y in self.smoke:
            for k in range(5):
                xx = x + int(np.sin(k * .9) * 2) + k // 2
                yy = y - k * 3
                r = 1 + k * .35
                m = self.m_ellipse(xx, yy, r, r * .8)
                self.dither_fill(m, col[0], col[1], .3 + k * .1)
                self.alpha |= m

    def grade(self, mult, lift, amount=1.0, mask=None):
        """Global time-of-day grade: multiply then lift shadows toward a colour."""
        m = self.alpha if mask is None else mask
        mult = np.asarray(mult, float)
        lift = hx(lift) if isinstance(lift, str) else np.asarray(lift)
        g = self.rgb * mult[None, None, :] / 255.0
        lum = (self.rgb.mean(axis=2, keepdims=True) / 255.0)
        g = g + lift[None, None, :] * (1 - lum) * .35
        out = self.rgb * (1 - amount) + g * amount
        self.rgb = np.where(m[..., None], np.clip(out, 0, 255), self.rgb).astype(np.int16)

    def apply_lights(self):
        for x, y, r, c, s in self.lights:
            self.glow(x, y, r, c, s)

    def save_quantized(self, path, scale, colors=64):
        from PIL import Image
        im = self.image(1).convert('RGB')
        q = im.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB')
        q.resize((self.w * scale, self.h * scale), Image.NEAREST).save(path)
        return q
