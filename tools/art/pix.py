"""Tiny pixel-art toolkit: one rendering language for every concept.

Rules baked in (these are what become the style baseline):
- Light comes from the top-left (or from a named local light source, which wins nearby).
- Every material is a 4-6 colour ramp with hue shift: shadows cooler/purpler, highlights warmer.
- Sprites get a selective outline: darkest ramp colour on the lit side, near-black on the shadow side.
- Light sources glow in posterised rings (3-4 steps), never smooth gradients.
- Dithering only in 4x4 Bayer patterns, only on large surfaces (sky, fog, big shadows).
"""
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0 + 1 / 32


def hx(s):
    if not isinstance(s, str):
        return np.asarray(s, dtype=np.int16)
    s = s.lstrip('#')
    return np.array([int(s[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.int16)


def ramp(*cols):
    return [hx(c) for c in cols]


def mix(a, b, t):
    return np.clip(np.asarray(a) * (1 - t) + np.asarray(b) * t, 0, 255).astype(np.int16)


class Canvas:
    def __init__(self, w, h, bg=None):
        self.w, self.h = w, h
        self.rgb = np.zeros((h, w, 3), np.int16)
        self.alpha = np.zeros((h, w), bool)
        if bg is not None:
            self.rgb[:] = hx(bg) if isinstance(bg, str) else bg
            self.alpha[:] = True
        self.yy, self.xx = np.mgrid[0:h, 0:w]

    # ---------- masks ----------
    def empty(self):
        return np.zeros((self.h, self.w), bool)

    def m_rect(self, x0, y0, x1, y1):
        m = self.empty()
        m[max(0, y0):max(0, y1 + 1), max(0, x0):max(0, x1 + 1)] = True
        return m

    def m_poly(self, pts):
        im = Image.new('1', (self.w, self.h), 0)
        ImageDraw.Draw(im).polygon([tuple(map(float, p)) for p in pts], fill=1, outline=1)
        return np.array(im, bool)

    def m_ellipse(self, cx, cy, rx, ry):
        return ((self.xx - cx + .5) / (rx + .3)) ** 2 + ((self.yy - cy + .5) / (ry + .3)) ** 2 <= 1

    def m_line(self, pts, width=1):
        im = Image.new('1', (self.w, self.h), 0)
        ImageDraw.Draw(im).line([tuple(map(float, p)) for p in pts], fill=1, width=width)
        return np.array(im, bool)

    # ---------- painting ----------
    def fill(self, mask, c):
        c = hx(c) if isinstance(c, str) else np.asarray(c)
        self.rgb[mask] = c
        self.alpha |= mask

    def px(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.rgb[y, x] = hx(c) if isinstance(c, str) else c
            self.alpha[y, x] = True

    def pixels(self, pts, c):
        for x, y in pts:
            self.px(int(x), int(y), c)

    def dither_fill(self, mask, c1, c2, t):
        """t: scalar or array in 0..1 — fraction of c2."""
        t = np.broadcast_to(t, mask.shape)
        b = BAYER[self.yy % 4, self.xx % 4]
        sel = t > b
        self.fill(mask & ~sel, c1)
        self.fill(mask & sel, c2)

    def vgrad(self, mask, cols, y0, y1, dither=True):
        """Vertical banded gradient over a list of colours, dithered at band edges."""
        n = len(cols) - 1
        t = np.clip((self.yy - y0) / max(1, (y1 - y0)), 0, 0.9999) * n
        i = np.floor(t).astype(int)
        f = t - i
        b = BAYER[self.yy % 4, self.xx % 4]
        if dither:
            f = np.where(f > 0.65, (f - 0.65) / 0.35, 0)
            i = np.where(f > b, np.minimum(i + 1, n), i)
        for k in range(n + 1):
            self.fill(mask & (i == k), cols[k])

    def shade(self, mask, rmp, mode='round', outline=None, light=(-1, -1), soft=2.0, bias=0.0, dither=True, line_dark=None):
        """Fill `mask` with a ramp. round: volume from a blurred height field. flat: rim light only."""
        if not mask.any():
            return
        rmp = [hx(c) if isinstance(c, str) else c for c in rmp]
        n = len(rmp)
        lx, ly = light
        if mode == 'round':
            hgt = ndimage.gaussian_filter(mask.astype(float), soft)
            gy, gx = np.gradient(hgt)
            nz = 0.12
            L = np.array([lx, ly, 1.1])
            L = L / np.linalg.norm(L)
            norm = np.sqrt(gx ** 2 + gy ** 2 + nz ** 2)
            v = (-gx * L[0] - gy * L[1] + nz * L[2]) / norm
            v = (v - v[mask].min()) / max(1e-6, (v[mask].max() - v[mask].min()))
            v = np.clip(v + bias, 0, 1)
        else:
            v = np.full(mask.shape, 0.55 + bias)
            lit = mask & ~np.roll(np.roll(mask, 1 if ly < 0 else -1, 0), 0, 1)
            lit |= mask & ~np.roll(mask, 1 if lx < 0 else -1, 1)
            dark = mask & ~np.roll(mask, -1 if ly < 0 else 1, 0)
            dark |= mask & ~np.roll(mask, -1 if lx < 0 else 1, 1)
            v = np.where(lit, 0.95, v)
            v = np.where(dark, 0.12, v)
        t = v * (n - 1)
        i = np.floor(t).astype(int)
        f = t - i
        if dither:
            b = BAYER[self.yy % 4, self.xx % 4]
            f = np.where(f > 0.7, (f - 0.7) / 0.3, 0)
            i = np.where(f > b, np.minimum(i + 1, n - 1), i)
        for k in range(n):
            self.fill(mask & (i == k), rmp[k])
        if outline is not None:
            self.outline(mask, outline, line_dark)

    def outline(self, mask, c_lit, c_dark=None, diag=False):
        st = np.array([[1, 1, 1], [1, 1, 1], [1, 1, 1]]) if diag else ndimage.generate_binary_structure(2, 1)
        ring = ndimage.binary_dilation(mask, st) & ~mask
        if c_dark is None:
            self.fill(ring, c_lit)
            return
        # shadow side = ring pixels below/right of the shape
        below = ring & (np.roll(mask, 1, 0) | np.roll(mask, 1, 1))
        self.fill(ring & ~below, c_lit)
        self.fill(below, c_dark)

    def speckle(self, mask, cols, density, seed=0):
        rng = np.random.default_rng(seed)
        r = rng.random(mask.shape)
        for k, c in enumerate(cols):
            sel = mask & (r < density * (k + 1) / len(cols)) & (r >= density * k / len(cols))
            self.fill(sel, c)

    def glow(self, cx, cy, r, c, strength=0.6, steps=4, mask=None, ry=None):
        """Additive posterised light. Rings at 1/steps intervals."""
        c = hx(c) if isinstance(c, str) else np.asarray(c)
        ry = ry or r
        d = np.sqrt(((self.xx - cx) / r) ** 2 + ((self.yy - cy) / ry) ** 2)
        lv = np.clip(1 - d, 0, 1)
        q = np.ceil(lv * steps) / steps
        q = np.where(lv <= 0, 0, q) ** 1.6
        add = (q[..., None] * c[None, None, :] * strength)
        m = self.alpha if mask is None else (mask & self.alpha)
        self.rgb = np.where(m[..., None], np.clip(self.rgb + add, 0, 255), self.rgb).astype(np.int16)

    def tint(self, mask, c, t):
        c = hx(c) if isinstance(c, str) else np.asarray(c)
        self.rgb[mask] = np.clip(self.rgb[mask] * (1 - t) + c * t, 0, 255)

    def dim(self, mask, toward, t, dither=False):
        """Pull an area toward a colour (night, fog). Dither = checker for half-strength haze."""
        if dither:
            mask = mask & (BAYER[self.yy % 4, self.xx % 4] < t * 2)
            self.tint(mask, toward, 0.5)
        else:
            self.tint(mask, toward, t)

    def image(self, scale=1):
        a = np.dstack([np.clip(self.rgb, 0, 255).astype(np.uint8), (self.alpha * 255).astype(np.uint8)])
        im = Image.fromarray(a, 'RGBA')
        if scale != 1:
            im = im.resize((self.w * scale, self.h * scale), Image.NEAREST)
        return im

    def save(self, path, scale=1):
        self.image(scale).save(path)


def count_colors(c):
    return len(np.unique(c.rgb[c.alpha].reshape(-1, 3), axis=0))
