"""Procedural pixel-art village, 180x390 base, upscaled x4 nearest-neighbour.

Landmark anchor points (base px) are printed so UI buttons can be placed on them.
"""
import random, sys
from PIL import Image, ImageDraw

W, H, S = 180, 390, 4
random.seed(7)
img = Image.new("RGB", (W, H))
d = ImageDraw.Draw(img)

def rect(x0, y0, x1, y1, c): d.rectangle([x0, y0, x1, y1], fill=c)
def px(x, y, c):
    if 0 <= x < W and 0 <= y < H: img.putpixel((x, y), c)

# --- sky: banded dusk-ish gradient
bands = [(92, 140, 196), (108, 156, 206), (126, 172, 214), (148, 188, 220), (172, 204, 222), (198, 214, 214)]
bh = 18
for i, c in enumerate(bands):
    rect(0, i * bh, W, (i + 1) * bh, c)
rect(0, len(bands) * bh, W, 130, bands[-1])
# sun
for y in range(-7, 8):
    for x in range(-7, 8):
        if x * x + y * y <= 49: px(36 + x, 30 + y, (250, 226, 140))
# clouds
def cloud(cx, cy, w):
    for dx in range(-w, w + 1):
        hgt = 3 if abs(dx) < w // 2 else 2
        rect(cx + dx, cy - hgt, cx + dx, cy, (244, 244, 236))
    rect(cx - w, cy + 1, cx + w, cy + 1, (214, 220, 226))
cloud(110, 24, 12); cloud(150, 50, 9); cloud(60, 66, 8)

# --- mountains (far)
def mountain(cx, base, h, half, c, snow=None):
    for y in range(h):
        w = int(half * y / h)
        rect(cx - w, base - h + y, cx + w, base - h + y, c)
        if snow and y < h // 4:
            rect(cx - w, base - h + y, cx + w, base - h + y, snow)
mountain(20, 130, 50, 45, (104, 112, 136), (226, 232, 240))
mountain(150, 132, 70, 60, (92, 98, 120), (226, 232, 240))
mountain(95, 132, 40, 40, (114, 122, 146))
# dungeon cave in the right mountain
cave_x, cave_y = 150, 118
for y in range(0, 14):
    w = 8 if y > 4 else 3 + y
    rect(cave_x - w, cave_y - 14 + y, cave_x + w, cave_y - 14 + y, (24, 18, 22))
rect(cave_x - 10, cave_y, cave_x + 10, cave_y + 1, (70, 70, 84))
for x in (cave_x - 9, cave_x + 9):  # torches
    rect(x, cave_y - 6, x, cave_y - 1, (90, 60, 30)); px(x, cave_y - 7, (255, 170, 40)); px(x, cave_y - 8, (255, 230, 120))

# --- hills / grass
rect(0, 130, W, H, (88, 140, 64))
for y in range(130, 146):
    for x in range(W):
        if (x + y) % 5 == 0: px(x, y, (104, 156, 76))
# grass texture
for _ in range(1400):
    x, y = random.randrange(W), random.randrange(140, H)
    px(x, y, random.choice([(78, 128, 56), (100, 152, 72), (70, 118, 52)]))

# --- dirt path winding from bottom to the cave
path = (166, 132, 92)
path_dark = (140, 108, 74)
pts = [(90, H), (92, 340), (100, 300), (88, 260), (84, 220), (100, 180), (130, 150), (150, 122)]
for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
    steps = max(abs(y1 - y0), abs(x1 - x0))
    for i in range(steps + 1):
        x = round(x0 + (x1 - x0) * i / steps); y = round(y0 + (y1 - y0) * i / steps)
        w = 7 if y > 200 else 5 if y > 150 else 3
        rect(x - w, y, x + w, y, path)
        px(x - w, y, path_dark); px(x + w, y, path_dark)
for _ in range(220):
    y = random.randrange(130, H);
    # pebble near path center
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if min(y0, y1) <= y <= max(y0, y1) and y0 != y1:
            x = round(x0 + (x1 - x0) * (y - y0) / (y1 - y0)) + random.randint(-4, 4)
            px(x, y, path_dark); break

# --- forest (woodcutting), left
def tree(x, y, s=1):
    trunk = (96, 64, 40)
    rect(x - 1, y - 2, x + 1, y + 4, trunk)
    greens = [(40, 92, 48), (52, 110, 56), (66, 128, 64)]
    for i, r in enumerate([7, 6, 4, 2]):
        r = r * s
        ty = y - 3 - i * 4 * s
        rect(x - r, ty - 3, x + r, ty, greens[min(i, 2)])
        px(x - r, ty - 3, greens[0]); px(x + r, ty - 3, greens[0])
for (tx, ty) in [(10, 168), (24, 160), (40, 170), (16, 186), (32, 190), (52, 158), (6, 205), (46, 196), (62, 178)]:
    tree(tx, ty)
# stumps + axe log pile
for (sx, sy) in [(58, 206), (68, 200)]:
    rect(sx - 2, sy, sx + 2, sy + 2, (120, 84, 52)); rect(sx - 1, sy, sx + 1, sy, (190, 150, 96))
rect(70, 208, 80, 211, (120, 84, 52)); rect(72, 205, 78, 207, (132, 92, 56))

# --- house helper
def house(x, y, w, h, wall, roof, door=(80, 52, 32)):
    rect(x, y, x + w, y + h, wall)
    for i in range(w // 2 + 3):  # gabled roof
        rect(x - 2 + i, y - i - 1, x + w + 2 - i, y - i - 1, roof)
        if x - 2 + i > x + w + 2 - i: break
    rect(x + w // 2 - 2, y + h - 6, x + w // 2 + 2, y + h, door)
    rect(x + 3, y + 4, x + 5, y + 6, (250, 220, 120))  # window
    rect(x + w - 5, y + 4, x + w - 3, y + 6, (250, 220, 120))
    rect(x, y + h + 1, x + w, y + h + 1, (60, 90, 44))  # shadow

# --- merchant stall, right-middle
mx, my = 132, 214
rect(mx - 16, my, mx + 16, my + 12, (150, 100, 60))     # counter
rect(mx - 16, my, mx + 16, my + 1, (190, 140, 90))
for i, x in enumerate(range(mx - 18, mx + 18, 4)):      # striped awning
    rect(x, my - 10, x + 3, my - 4, (196, 54, 54) if i % 2 == 0 else (238, 226, 200))
rect(mx - 18, my - 4, mx + 18, my - 3, (120, 36, 36))
for x in (mx - 16, mx + 15):
    rect(x, my - 4, x + 1, my + 12, (100, 66, 40))
for i, c in enumerate([(230, 180, 60), (200, 70, 60), (120, 170, 220), (240, 220, 130)]):  # wares
    rect(mx - 12 + i * 7, my - 2, mx - 9 + i * 7, my, c)
house(150, 236, 20, 14, (204, 186, 150), (128, 62, 52))

# --- storage barn, left-lower
bx, by = 22, 254
house(bx, by, 34, 22, (150, 74, 54), (92, 52, 40), door=(60, 36, 24))
rect(bx + 11, by + 8, bx + 23, by + 22, (70, 42, 28))   # big barn doors
d.line([bx + 11, by + 8, bx + 23, by + 22], fill=(170, 120, 70))
d.line([bx + 23, by + 8, bx + 11, by + 22], fill=(170, 120, 70))
for (cx, cy) in [(62, 270), (66, 274), (60, 276)]:       # crates / barrels
    rect(cx - 2, cy - 2, cx + 2, cy + 2, (160, 112, 64)); px(cx, cy, (110, 74, 40))

# --- training yard, right-lower
tx, ty = 132, 300
for x in range(tx - 24, tx + 25, 4):                    # fence
    rect(x, ty - 14, x, ty + 14, (130, 92, 56))
rect(tx - 24, ty - 12, tx + 24, ty - 12, (150, 108, 66))
rect(tx - 24, ty + 12, tx + 24, ty + 12, (150, 108, 66))
rect(tx - 23, ty - 11, tx + 23, ty + 11, (170, 146, 100))  # sand
for dx in (-12, 0, 12):                                  # training dummies
    x = tx + dx
    rect(x, ty - 4, x, ty + 8, (100, 66, 40))
    rect(x - 4, ty - 1, x + 4, ty, (100, 66, 40))
    rect(x - 2, ty - 8, x + 2, ty - 3, (214, 190, 120)); px(x, ty - 6, (120, 40, 40))
# weapon rack
rect(tx + 18, ty - 9, tx + 21, ty - 9, (100, 66, 40));
for x in (tx + 18, tx + 21): rect(x, ty - 10, x, ty - 3, (190, 196, 206))

# extra cottages for village feel
house(20, 322, 22, 16, (214, 196, 160), (110, 60, 46))
house(150, 346, 22, 16, (196, 178, 140), (90, 70, 60))
house(52, 352, 18, 14, (206, 188, 150), (128, 62, 52))
# well
rect(108, 360, 118, 368, (130, 130, 140)); rect(109, 361, 117, 362, (60, 90, 140))
rect(108, 352, 108, 360, (100, 66, 40)); rect(118, 352, 118, 360, (100, 66, 40)); rect(106, 350, 120, 352, (128, 62, 52))

# flowers
for _ in range(60):
    x, y = random.randrange(W), random.randrange(150, H)
    if img.getpixel((x, y))[1] > 110: px(x, y, random.choice([(240, 220, 90), (230, 120, 140), (240, 240, 240)]))

out = sys.argv[1]
img.resize((W * S, H * S), Image.NEAREST).save(out, optimize=True)
anchors = {"dungeon": (cave_x, cave_y), "woodcutting": (34, 168), "merchant": (mx, my), "storage": (bx + 17, by), "training": (tx, ty)}
for k, (x, y) in anchors.items():
    print(f"{k}: x={x/W:.3f} y={y/H:.3f}")
