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

# --- mine shaft entrance (mining), in the foot of the left mountain above the forest
mine_x, mine_y = 38, 129                                 # bottom centre of the opening
timber, timber_dark = (110, 74, 44), (84, 56, 32)
for y in range(mine_y - 13, mine_y + 1):                 # dark opening, arched top
    w = 3 if y < mine_y - 11 else 5 if y < mine_y - 9 else 6
    rect(mine_x - w, y, mine_x + w, y, (22, 18, 20))
for x in (mine_x - 8, mine_x + 7):                       # timber posts
    rect(x, mine_y - 13, x + 1, mine_y, timber)
    px(x, mine_y - 13, timber_dark)
rect(mine_x - 10, mine_y - 16, mine_x + 10, mine_y - 14, timber)   # lintel
rect(mine_x - 10, mine_y - 16, mine_x + 10, mine_y - 16, timber_dark)
rect(mine_x - 2, mine_y - 9, mine_x + 2, mine_y - 9, (60, 50, 44))  # inner beam
px(mine_x + 9, mine_y - 12, (255, 170, 40)); px(mine_x + 9, mine_y - 13, (255, 230, 120))  # lantern
for i in range(0, 13):                                   # rails onto the grass, with sleepers
    y = mine_y + 1 + i
    off = i // 4
    if i % 3 == 0: rect(mine_x - 5 + off, y, mine_x + 4 + off, y, timber_dark)
    px(mine_x - 3 + off, y, (160, 160, 170)); px(mine_x + 2 + off, y, (160, 160, 170))
cart_x, cart_y = 52, 133                                 # ore cart beside the rails
rect(cart_x - 4, cart_y - 4, cart_x + 4, cart_y, (96, 100, 112))
rect(cart_x - 4, cart_y - 4, cart_x + 4, cart_y - 4, (130, 134, 146))
for x, c in ((cart_x - 2, (200, 110, 60)), (cart_x, (150, 150, 156)), (cart_x + 2, (220, 190, 80))):
    px(x, cart_y - 5, c)
px(cart_x - 3, cart_y + 1, (40, 40, 44)); px(cart_x + 3, cart_y + 1, (40, 40, 44))
for (rx, ry) in [(24, 131), (27, 130), (25, 129), (29, 132)]:   # rock pile
    rect(rx - 1, ry - 1, rx + 1, ry, (128, 128, 136)); px(rx, ry - 1, (168, 168, 176))

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

# --- town hall, in the middle of the town (between the stall and the training yard, right of the path)
hx, hy = 126, 282                                        # bottom centre of the front wall
stone, stone_dark, slate, slate_dark = (196, 188, 172), (160, 150, 136), (70, 78, 118), (52, 58, 92)
rect(hx - 16, hy - 20, hx + 16, hy, stone)               # main hall walls
for y in range(hy - 18, hy, 4):                          # brick courses
    for x in range(hx - 16 + (y // 4) % 2 * 3, hx + 16, 6):
        px(x, y, stone_dark)
for i in range(19):                                      # slate gable roof
    x0, x1 = hx - 18 + i, hx + 18 - i
    if x0 > x1: break
    rect(x0, hy - 21 - i // 2, x1, hy - 21 - i // 2, slate if i % 3 else slate_dark)
rect(hx - 5, hy - 40, hx + 5, hy - 20, stone)            # bell tower
rect(hx - 5, hy - 40, hx + 5, hy - 40, stone_dark)
rect(hx - 2, hy - 36, hx + 2, hy - 32, (30, 26, 30))     # belfry opening
px(hx, hy - 33, (230, 190, 70))                          # bell
for i in range(6):                                       # tower spire
    rect(hx - 6 + i, hy - 41 - i, hx + 6 - i, hy - 41 - i, slate_dark if i == 0 else slate)
rect(hx, hy - 51, hx, hy - 47, (90, 60, 34))             # flag pole + banner
rect(hx + 1, hy - 51, hx + 4, hy - 49, (196, 54, 54))
rect(hx - 3, hy - 10, hx + 3, hy, (80, 52, 32))          # double door, arched
rect(hx - 2, hy - 11, hx + 2, hy - 11, (80, 52, 32))
rect(hx, hy - 10, hx, hy, (56, 36, 22))
for x in (hx - 12, hx + 9):                              # windows
    rect(x, hy - 15, x + 3, hy - 12, (250, 220, 120))
    rect(x, hy - 16, x + 3, hy - 16, stone_dark)
for x in (hx - 7, hx + 6):                               # red banners beside the door
    rect(x, hy - 18, x + 1, hy - 12, (176, 40, 40)); px(x, hy - 11, (176, 40, 40))
rect(hx - 6, hy + 1, hx + 6, hy + 1, (150, 146, 140))    # steps
rect(hx - 16, hy + 2, hx + 16, hy + 2, (60, 90, 44))     # shadow
for x in range(101, hx - 5):                             # short path from the main path to the steps
    rect(x, hy + 1, x, hy + 2, path); px(x, hy + 3, path_dark)

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
anchors = {"dungeon": (cave_x, cave_y), "woodcutting": (34, 168), "merchant": (mx, my), "storage": (bx + 17, by), "training": (tx, ty),
           "mine": (mine_x, mine_y - 8), "town_hall": (hx, hy - 20)}
for k, (x, y) in anchors.items():
    print(f"{k}: x={x/W:.3f} y={y/H:.3f}")
