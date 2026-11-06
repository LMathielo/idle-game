"""Enemy variant outlines (engine 1.24.0, owner brief 2026-11-06): on Hard and Extreme a pack mob that is stronger than its
base shows the same sprite with a coloured outline, so a pack reads at a glance without new creatures.

    veteran  an amber outline (Hard "Veteran", Extreme plain mobs)
    extreme  a violet outline (the "Extreme" variant)

Each sprite is padded by RING px on every side (the ring needs room; the ring itself is a bright pixel hugging the sprite plus a
dark pixel outside it, so it reads on parchment and on dark panels), so a variant is (w + 2 RING) x (h + 2 RING) art pixels at the
same pixel scale as its base. PENDING OWNER APPROVAL (docs/STATUS.md).
"""
import numpy as np
from scipy import ndimage
from pix import Canvas, hx

RING = 2
OUTER = '#120c14'
STYLES = {
    'veteran': '#f2a31f',
    'extreme': '#b44cf0',
}


def outlined(base, style):
    """`base` (a Canvas) with the variant outline drawn around its silhouette, on a canvas padded by RING."""
    c = Canvas(base.w + 2 * RING, base.h + 2 * RING)
    c.rgb[RING:RING + base.h, RING:RING + base.w] = base.rgb
    c.alpha[RING:RING + base.h, RING:RING + base.w] = base.alpha
    body = c.alpha.copy()
    st = ndimage.generate_binary_structure(2, 1)
    inner = ndimage.binary_dilation(body, st) & ~body
    outer = ndimage.binary_dilation(body | inner, st) & ~(body | inner)
    c.fill(inner, STYLES[style])
    c.fill(outer, OUTER)
    return c
