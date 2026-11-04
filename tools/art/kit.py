"""3/4 oblique building kit. Depth recedes up-right at 45 deg, so every building shows its front, its right side
and its roof. Light from the top-left: fronts and left roof slopes lit, right sides and right slopes in shade.

Convention: (x, y) = front-left corner ON the ground; the front face spans rows y-h .. y-1. sd = depth in screen px.
"""
import numpy as np
from pix import hx, mix, BAYER
from elements import Scene, M, OUT, OUT_LIT

SKIN = ['#6b3a2e', '#c4825e', '#e2a97e']

WALL = {
    'plaster': dict(f=['#a8987a', '#cdbd98', '#e6d8b4'], s=['#8a7a62', '#a6957a'], line='#6a5a48'),
    'ochre': dict(f=['#b8893e', '#ddb05c', '#f0cd7c'], s=['#93682e', '#ad7e3c'], line='#6a4a22'),
    'stone': dict(f=['#5d5a64', '#8f8b8f', '#b3aeaa'], s=['#45424e', '#68646f'], line='#3c3a47'),
    'logs': dict(f=['#5a3820', '#8a5a34', '#b07a48'], s=['#45291a', '#6a4328'], line='#2e1c12'),
    'planks': dict(f=['#5a3a22', '#7a5232', '#9c6c40'], s=['#432b1a', '#5e3e26'], line='#2e1c12'),
    'whitewash': dict(f=['#b4b0a4', '#dcd8cc', '#f2efe6'], s=['#9a968c', '#b6b2a6'], line='#7a766c'),
}
ROOF = {
    'red': ['#4c2029', '#723136', '#984a43', '#b8684f', '#d08a64'],
    'slate': ['#252c40', '#384259', '#4f5c75', '#6c7b91', '#8d9cb0'],
    'thatch': ['#57401f', '#7f5f2c', '#a7843d', '#c9a858', '#e0c47a'],
    'shingle': ['#3f2719', '#603b23', '#865630', '#ab7a45', '#c9975e'],
    'copper': ['#1e3d3a', '#2f5e56', '#46806f', '#68a58a', '#97c9a6'],
    'teal': ['#183433', '#234b47', '#336660', '#4a8478', '#6aa392'],
}
BEAM = '#3f2719'


class Town(Scene):
    def __init__(self, w, h):
        super().__init__(w, h)
        self.solid = self.empty()
        self.groundm = self.empty()
        self.anchors = {}
        # sprite mode: the building is drawn alone on a transparent canvas; shadows and smoke go to a
        # translucent overlay instead of tinting a background that isn't there
        self.sprite_mode = False
        self.ov_a = np.zeros((h, w))
        self.ov_c = np.zeros((h, w, 3))

    def over(self, mask, col, a):
        """Alpha-composite a flat colour onto the overlay layer (same maths as tint() on an opaque pixel)."""
        if not mask.any():
            return
        c = hx(col).astype(float)
        oa = self.ov_a[mask]
        na = a + oa * (1 - a)
        self.ov_c[mask] = (c[None, :] * a + self.ov_c[mask] * (oa * (1 - a))[:, None]) / na[:, None]
        self.ov_a[mask] = na

    def rgba(self):
        """Flatten the sprite + overlay into an RGBA uint8 array."""
        rgb = self.rgb.astype(float)
        a = self.alpha.astype(float)
        oa = self.ov_a[..., None]
        on_px = self.alpha[..., None]
        out_rgb = np.where(on_px, self.ov_c * oa + rgb * (1 - oa), self.ov_c)
        out_a = np.where(self.alpha, 1.0, self.ov_a)
        return np.dstack([np.clip(np.round(out_rgb), 0, 255), np.round(out_a * 255)]).astype(np.uint8)

    # ------------------------------------------------------------ texture helpers
    def rows(self, mask, base, line, rowh=3, joint=5, slant=0, x0=0, hi=None, seed=0, joints=True):
        v = self.yy + slant * (self.xx - x0)
        u = self.xx
        row = np.floor_divide(v, rowh)
        rl = (np.mod(v, rowh) == 0)
        self.fill(mask, base)
        self.fill(mask & rl, line)
        if joints:
            jt = (np.mod(u + row * (joint // 2 + 1), joint) == 0) & ~rl
            self.fill(mask & jt, line)
        if hi is not None:
            rng = np.random.default_rng(seed)
            r = rng.random(mask.shape)
            self.fill(mask & ~rl & (np.mod(v, rowh) == 1) & (r < .35), hi)

    def wall_face(self, mask, mat, side=False, x0=0, kind=None):
        W = WALL[mat]
        if mat == 'stone':
            if side:
                self.rows(mask, W['s'][1], W['s'][0], 3, 5, slant=1, x0=x0)
            else:
                self.rows(mask, W['f'][1], W['line'], 3, 5, hi=W['f'][2], seed=int(mask.sum()))
        elif mat == 'logs':
            c = W['s'] if side else W['f']
            v = self.yy + (self.xx - x0 if side else 0)
            self.fill(mask, c[1])
            self.fill(mask & (np.mod(v, 3) == 0), W['line'])
            if not side:
                self.fill(mask & (np.mod(v, 3) == 1), W['f'][2])
        elif mat == 'planks':
            c = W['s'] if side else W['f']
            self.fill(mask, c[1])
            self.fill(mask & (np.mod(self.xx, 3) == 0), W['line'] if not side else c[0])
            if not side:
                self.fill(mask & (np.mod(self.xx, 3) == 1), W['f'][2])
        else:
            c = W['s'] if side else W['f']
            self.fill(mask, c[1])
            if not side:
                rng = np.random.default_rng(int(mask.sum()))
                r = rng.random(mask.shape)
                self.fill(mask & (r < .06), c[0])
                self.fill(mask & (r > .95), c[2])

    # ------------------------------------------------------------ massing
    def box(self, x, y, w, h, sd, mat, frame=None, base_stone=0):
        f = self.m_rect(x, y - h, x + w - 1, y - 1)
        s = self.m_poly([(x + w, y - 1), (x + w + sd - 1, y - sd), (x + w + sd - 1, y - sd - h + 1), (x + w, y - h)]) if sd > 0 else self.empty()
        self.wall_face(f, mat)
        self.wall_face(s, mat, side=True, x0=x + w)
        if base_stone:
            fb = f & (self.yy >= y - base_stone)
            sb = s & (self.yy >= (y - base_stone) - (self.xx - (x + w)))
            self.wall_face(fb, 'stone'); self.wall_face(sb, 'stone', side=True, x0=x + w)
        if frame:
            self.timber(x, y, w, h, frame, base_stone)
        # lit left edge, dark corner
        self.fill(f & (self.xx == x), WALL[mat]['f'][2] if mat not in ('stone', 'logs') else WALL[mat]['f'][2])
        self.fill(self.m_line([(x + w, y - 1), (x + w, y - h)]), WALL[mat]['s'][0])
        return f | s

    def timber(self, x, y, w, h, col, base=0, style='cross'):
        top = y - h
        bot = y - 1 - base
        self.fill(self.m_rect(x, top, x + w - 1, top), col)
        self.fill(self.m_rect(x, bot, x + w - 1, bot), col)
        posts = [x, x + w - 1] + list(range(x + 5, x + w - 4, 6))
        for p in posts:
            self.fill(self.m_rect(p, top, p, bot), col)
        mid = (top + bot) // 2
        if h - base > 12:
            self.fill(self.m_rect(x, mid, x + w - 1, mid), col)
        if style == 'cross':
            for a, b in zip(posts[:-1], sorted(posts)[1:]):
                pass
            ps = sorted(set(posts))
            for i in range(len(ps) - 1):
                a, b = ps[i], ps[i + 1]
                if b - a >= 4:
                    y1 = mid if h - base > 12 else bot
                    self.fill(self.m_line([(a + 1, y1 - 1), (b - 1, top + 1)]) if i % 2 == 0 else self.m_line([(a + 1, top + 1), (b - 1, y1 - 1)]), col)

    def roof_side(self, x, y, w, h, sd, rh, roof, oh=1, mat_gable='plaster'):
        """Ridge runs left-right. Returns mask."""
        R = ROOF[roof]
        e = y - h
        r = e - sd // 2 - rh
        fr = self.m_poly([(x - oh, e), (x + w - 1 + oh, e), (x + w - 1 + oh + sd // 2, r), (x - oh + sd // 2, r)])
        gb = self.m_poly([(x + w, e), (x + w + sd - 1, e - sd + 1), (x + w + sd // 2, r)])
        self.wall_face(gb, mat_gable, side=True, x0=x + w)
        if roof == 'thatch':
            self.fill(fr, R[2])
            self.fill(fr & (np.mod(self.xx + (self.yy * 2) // 3, 3) == 0), R[1])
            self.fill(fr & (np.mod(self.xx * 7 + self.yy * 3, 11) == 0), R[3])
            self.fill(fr & (self.yy >= e - 1), R[1])
        else:
            self.rows(fr, R[2], R[1], 2 if roof != 'shingle' else 3, 4, hi=R[3], seed=x)
        self.fill(fr & (self.yy <= r + 1), R[4])
        self.fill(fr & (self.yy == e), R[0])
        # barge board on the gable side
        self.fill(self.m_line([(x + w - 1 + oh, e), (x + w - 1 + oh + sd // 2, r)]), R[1])
        self.fill(self.m_line([(x + w + sd // 2 + oh, r), (x + w + sd - 1 + oh, e - sd + 1)]), R[0])
        m = fr | gb | self.m_line([(x + w + sd // 2 + oh, r), (x + w + sd - 1 + oh, e - sd + 1)])
        # eave shadow on the wall below
        self.tint(self.m_rect(x, e + 1, x + w - 1, e + 1), '#1a1218', .35)
        return m

    def roof_front(self, x, y, w, h, sd, rh, roof, oh=1, mat_gable='plaster', profile=None, gable_detail=None):
        """Ridge runs into depth; gable faces the viewer. profile: list of (dx, dh) from left eave to right eave."""
        R = ROOF[roof]
        e = y - h
        if profile is None:
            profile = [(-oh, 0), ((w - 1) / 2, rh), (w - 1 + oh, 0)]
        P = [(x + dx, e - dh) for dx, dh in profile]
        d = (sd - 1, -(sd - 1))
        apex_i = int(np.argmax([dh for _, dh in profile]))
        m = self.empty()
        # left slopes (lit), then right slopes (shade)
        for i in range(len(P) - 1):
            a, b = P[i], P[i + 1]
            q = self.m_poly([a, b, (b[0] + d[0], b[1] + d[1]), (a[0] + d[0], a[1] + d[1])])
            m |= q
            if i < apex_i:
                self.rows(q, R[3], R[2], 2, 4, slant=1, x0=x, joints=False)
                self.fill(q & np.roll(~q, 1, 0), R[4])
            else:
                if roof == 'thatch':
                    self.fill(q, R[1]); self.fill(q & (np.mod(self.xx + self.yy, 3) == 0), R[0])
                else:
                    self.rows(q, R[1], R[0], 2, 4, slant=1, x0=x, joints=False)
        g = self.m_poly([(x, e)] + [(max(x, min(x + w - 1, px_)), py_ + 1) for px_, py_ in P[1:-1]] + [(x + w - 1, e)])
        self.wall_face(g, mat_gable)
        if gable_detail:
            gable_detail(g)
        # rake boards
        for i in range(len(P) - 1):
            self.fill(self.m_line([P[i], P[i + 1]], 1), R[3] if i < apex_i else R[1])
        self.tint(self.m_rect(x, e + 1, x + w - 1, e + 1), '#1a1218', .3)
        return m | g

    def cone(self, cx, top, r, rh, roof, flare=1):
        R = ROOF[roof]
        m = self.m_poly([(cx - r - flare, top), (cx, top - rh), (cx + r + flare, top)]) | (self.m_ellipse(cx, top, r + flare, 1.5) & (self.yy >= top))
        rel = (self.xx - cx) / (r + 1)
        self.fill(m, R[2])
        self.fill(m & (rel < -.3), R[3])
        self.fill(m & (rel < -.65), R[4])
        self.fill(m & (rel > .35), R[1])
        self.fill(m & (rel > .7), R[0])
        self.fill(m & (np.mod(self.yy - top, 3) == 0) & (rel > -.65), R[1])
        return m

    def tower_body(self, x, y, w, h, mat='stone'):
        m = self.m_rect(x, y - h, x + w - 1, y - 1) | (self.m_ellipse(x + (w - 1) / 2, y - 1, w / 2, 1.5) & (self.yy >= y - 1))
        self.wall_face(m, mat)
        rel = (self.xx - (x + (w - 1) / 2)) / (w / 2)
        self.tint(m & (rel < -.55), '#fff4dc', .25)
        self.tint(m & (rel > .3), '#1a1630', .25)
        self.tint(m & (rel > .7), '#1a1630', .3)
        return m

    # ------------------------------------------------------------ openings
    def window(self, x, y, w=3, h=4, shutters=None, box=None, arch=False, frame='#3f2719', glass='#2c3d52'):
        fm = self.m_rect(x - 1, y - 1, x + w, y + h)
        if arch:
            fm = fm & ~(self.m_rect(x - 1, y - 1, x - 1, y - 1) | self.m_rect(x + w, y - 1, x + w, y - 1))
        self.fill(fm, frame)
        g = self.m_rect(x, y, x + w - 1, y + h - 1)
        if arch:
            g &= ~(self.m_rect(x, y, x, y) | self.m_rect(x + w - 1, y, x + w - 1, y))
        self.fill(g, glass)
        self.px(x, y + (1 if arch else 0), '#8fb8d8'); self.px(x + 1, y + (1 if arch else 0), '#5f86a8')
        if w >= 3 and h >= 4:
            self.fill(self.m_rect(x, y + h // 2, x + w - 1, y + h // 2), frame)
        if shutters:
            for sx in (x - 2, x + w + 1):
                sm = self.m_rect(sx, y - 1, sx, y + h)
                self.fill(sm, shutters)
                self.px(sx, y + h // 2, mix(hx(shutters), hx('#000000'), .35))
        if box:
            bm = self.m_rect(x - 1, y + h + 1, x + w, y + h + 2)
            self.fill(bm, '#603b23'); self.fill(self.m_rect(x - 1, y + h + 2, x + w, y + h + 2), '#3f2719')
            for k in range(w + 2):
                self.px(x - 1 + k, y + h, box[k % len(box)])
                if k % 2 == 0:
                    self.px(x - 1 + k, y + h - 1, '#4f8a3c')

    def door(self, x, y, w=4, h=7, col='#603b23', arch=True, step='#8f8b8f', knob='#efc65a', frame='#3f2719'):
        m = self.m_rect(x, y - h, x + w - 1, y - 1)
        if arch:
            m &= ~(self.m_rect(x, y - h, x, y - h) | self.m_rect(x + w - 1, y - h, x + w - 1, y - h))
        fm = self.m_rect(x - 1, y - h - 1, x + w, y - 1) & ~m
        if arch:
            fm &= ~(self.m_rect(x - 1, y - h - 1, x - 1, y - h - 1) | self.m_rect(x + w, y - h - 1, x + w, y - h - 1))
        self.fill(fm, frame)
        self.fill(m, col)
        self.fill(m & (np.mod(self.xx - x, 2) == 1), mix(hx(col), hx('#000000'), .25))
        self.fill(m & (self.xx == x), mix(hx(col), hx('#ffffff'), .2))
        self.px(x + w - 2, y - h // 2, knob)
        self.fill(self.m_rect(x - 1, y, x + w, y), step)

    # ------------------------------------------------------------ small props
    def chimney(self, x, y, h=6, smoke=True, mat='stone'):
        m = self.box(x, y, 3, h, 2, mat)
        self.fill(self.m_rect(x - 1, y - h - 1, x + 3, y - h), '#45424e')
        self.fill(self.m_rect(x - 1, y - h - 1, x + 3, y - h - 1), '#68646f')
        if smoke:
            self.smoke.append((x + 1, y - h - 2))
        return m

    def barrel(self, x, y, top='#3f2719'):
        m = self.m_rect(x, y - 4, x + 2, y - 1)
        self.fill(m, '#865630'); self.fill(m & (self.xx == x), '#ab7a45'); self.fill(m & (self.xx == x + 2), '#603b23')
        self.fill(self.m_rect(x, y - 3, x + 2, y - 3), '#45424e'); self.fill(self.m_rect(x, y - 1, x + 2, y - 1), '#45424e')
        self.fill(self.m_rect(x, y - 5, x + 2, y - 5), top)
        self.outline(m | self.m_rect(x, y - 5, x + 2, y - 5), OUT)

    def crate(self, x, y, s=3):
        f = self.m_rect(x, y - s, x + s - 1, y - 1)
        t = self.m_poly([(x, y - s - 1), (x + s - 1, y - s - 1), (x + s, y - s - 2), (x + 1, y - s - 2)])
        sd = self.m_poly([(x + s, y - 1), (x + s, y - s - 1), (x + s + 1, y - s - 2), (x + s + 1, y - 2)])
        self.fill(f, '#a7843d'); self.fill(t, '#c9a858'); self.fill(sd, '#7f5f2c')
        self.fill(self.m_line([(x, y - 1), (x + s - 1, y - s)]), '#7f5f2c')
        self.outline(f | t | sd, OUT)

    def sack(self, x, y, c='#cdb990'):
        m = self.m_ellipse(x + 1, y - 2, 1.6, 2)
        self.fill(m, c); self.fill(m & (self.xx > x + 1), mix(hx(c), hx('#000000'), .25)); self.px(x + 1, y - 4, '#8a7a62')
        self.outline(m, OUT)

    def hanging_sign(self, x, y, icon, board='#865630'):
        """Bracket from a wall at (x, y) sticking right; icon is a list of strings ('#'=dark, '*'=accent)."""
        self.fill(self.m_rect(x, y, x + 6, y), '#2b2430')
        self.px(x + 1, y + 1, '#2b2430')
        bw = max(len(r) for r in icon) + 2
        bh = len(icon) + 2
        bx = x + 6 - bw // 2
        b = self.m_rect(bx, y + 2, bx + bw - 1, y + 1 + bh)
        self.fill(b, board); self.fill(b & (self.yy == y + 2), mix(hx(board), hx('#ffffff'), .25))
        self.px(bx + 1, y + 1, '#2b2430'); self.px(bx + bw - 2, y + 1, '#2b2430')
        for j, row in enumerate(icon):
            for i, ch in enumerate(row):
                if ch == '#':
                    self.px(bx + 1 + i, y + 3 + j, '#2a1c26')
                elif ch == '*':
                    self.px(bx + 1 + i, y + 3 + j, '#efc65a')
                elif ch == 'o':
                    self.px(bx + 1 + i, y + 3 + j, '#c4bfb6')
                elif ch == 'r':
                    self.px(bx + 1 + i, y + 3 + j, '#bd4434')
        self.outline(b, OUT)

    def flowers(self, x0, x1, y, cols=('#e0566a', '#f2d35b', '#f5efe2', '#b07ae0')):
        rng = np.random.default_rng(x0 * 7 + y)
        for x in range(x0, x1 + 1):
            self.px(x, y, '#3d6b35')
            if rng.random() < .55:
                self.px(x, y - 1, cols[rng.integers(len(cols))])

    def lamp(self, x, y):
        self.fill(self.m_rect(x, y - 8, x, y - 1), '#2b2430')
        self.fill(self.m_rect(x - 1, y - 11, x + 1, y - 9), '#f2d38a')
        self.px(x, y - 12, '#2b2430'); self.fill(self.m_rect(x - 1, y - 9, x + 1, y - 9), '#2b2430')
        self.px(x - 1, y - 1, '#2b2430'); self.px(x + 1, y - 1, '#2b2430')

    def bench(self, x, y, w=6):
        self.fill(self.m_rect(x, y - 3, x + w - 1, y - 3), '#ab7a45'); self.fill(self.m_rect(x, y - 2, x + w - 1, y - 2), '#603b23')
        self.px(x, y - 1, '#3f2719'); self.px(x + w - 1, y - 1, '#3f2719')

    def person(self, x, y, tunic, hair='#5e321c', legs='#3f2719', skin=None, facing=1, tool=None, hat=None, wide=False, apron=None, raise_arm=False):
        """Feet at row y-1, about 9 px tall. facing: 1 right, -1 left."""
        sk = skin or SKIN
        m = self.empty()
        # legs
        L = self.m_rect(x, y - 2, x, y - 1) | self.m_rect(x + 2, y - 2, x + 2, y - 1)
        self.fill(L, legs); m |= L
        bw = 4 if wide else 3
        body = self.m_rect(x, y - 6, x + bw - 1, y - 3)
        self.fill(body, tunic)
        self.fill(body & (self.xx == x), mix(hx(tunic), hx('#ffffff'), .2))
        self.fill(body & (self.xx == x + bw - 1), mix(hx(tunic), hx('#000000'), .25))
        if apron:
            self.fill(self.m_rect(x + (1 if facing > 0 else 0), y - 5, x + bw - 2 + (1 if facing > 0 else 0), y - 2), apron)
        m |= body
        self.fill(self.m_rect(x, y - 3, x + bw - 1, y - 3), mix(hx(tunic), hx('#000000'), .35))
        # head
        hx_ = x + (1 if facing > 0 else 0)
        head = self.m_rect(hx_, y - 8, hx_ + 1, y - 7)
        self.fill(head, sk[1]); self.px(hx_ + (1 if facing > 0 else 0), y - 7, sk[2])
        self.px(hx_ + (1 if facing > 0 else 0), y - 8, sk[2])
        hairm = self.m_rect(hx_, y - 9, hx_ + 1, y - 9) | self.m_rect(hx_ + (0 if facing > 0 else 1), y - 8, hx_ + (0 if facing > 0 else 1), y - 8)
        self.fill(hairm, hair)
        m |= head | hairm
        if hat:
            hm = self.m_rect(hx_ - 1, y - 9, hx_ + 2, y - 9) | self.m_rect(hx_, y - 11, hx_ + 1, y - 10)
            self.fill(hm, hat); m |= hm
        # arm
        ax = x + bw if facing > 0 else x - 1
        if raise_arm:
            am = self.m_rect(ax, y - 8, ax, y - 6)
        else:
            am = self.m_rect(ax, y - 5, ax, y - 4)
        self.fill(am, mix(hx(tunic), hx('#000000'), .15)); self.px(ax, (y - 8) if raise_arm else (y - 4), sk[1])
        m |= am
        if tool:
            tool(ax, y, m)
        self.outline(m, OUT)
        return m

    def chicken(self, x, y):
        self.fill(self.m_rect(x, y - 2, x + 1, y - 1), '#f2efe6'); self.px(x + 2, y - 3, '#f2efe6'); self.px(x + 2, y - 4, '#d9443a')
        self.px(x + 3, y - 3, '#efc65a'); self.px(x, y - 2, '#c9c4b8')

    def cast(self, mask, base, dx=3, dy=1, depth=10, s=.3):
        sh = np.roll(np.roll(mask, dx, 1), dy, 0)
        sh &= ~mask & self.groundm & ~self.solid & (self.yy <= base + dy + 1) & (self.yy >= base - depth)
        if self.sprite_mode:
            self.over(sh & ~self.alpha, '#20302a', s)
            self.tint(sh & self.alpha, '#20302a', s)
        else:
            self.tint(sh, '#20302a', s)
        self.solid |= mask
