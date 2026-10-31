"""Procedural pixel-art village map, upscaled x4 nearest-neighbour.

The world is WORLD_W x WORLD_H base px. The original 180x390 village (the "core") is drawn unchanged at (CORE_X, CORE_Y);
around it: more sky and mountains to the north, a western forest and lake, eastern hills, fields and an orchard, and a
river with a bridge to the south. A few clearly empty plots (cleared dirt with corner stakes and a rope) wait for future
buildings; they have no signs yet.

Prints the sign anchors (world px, from the core's landmarks) and the plot rectangles, which the app keeps as data in
src/components/village/villageMap.ts.

Usage: python3 tools/generate-village.py assets/images/village.png
"""
import random, sys
from PIL import Image, ImageDraw

W, H, S = 180, 390, 4                 # the core village (unchanged since the first map)
WORLD_W, WORLD_H = 360, 560           # the whole map
CORE_X, CORE_Y = 90, 40               # where the core sits in the world
random.seed(7)
img = Image.new("RGB", (WORLD_W, WORLD_H))
d = ImageDraw.Draw(img)

# Drawing helpers take coordinates in the current layer: world px for the surroundings, core px for the core (the
# offset is added here, so the core code below is the original village code). px() and gp() clip to the layer.
OFF = [0, 0]
BOUNDS = [WORLD_W, WORLD_H]
def rect(x0, y0, x1, y1, c): d.rectangle([x0 + OFF[0], y0 + OFF[1], x1 + OFF[0], y1 + OFF[1]], fill=c)
def px(x, y, c):
    if 0 <= x < BOUNDS[0] and 0 <= y < BOUNDS[1]: img.putpixel((x + OFF[0], y + OFF[1]), c)
def gp(x, y): return img.getpixel((x + OFF[0], y + OFF[1]))
def line(x0, y0, x1, y1, c): d.line([x0 + OFF[0], y0 + OFF[1], x1 + OFF[0], y1 + OFF[1]], fill=c)

GRASS = (88, 140, 64)
GRASS_TEX = [(78, 128, 56), (100, 152, 72), (70, 118, 52)]
PATH, PATH_DARK = (166, 132, 92), (140, 108, 74)
LAND_Y = CORE_Y + 130                 # where the grass starts (the core's horizon)

def in_core(x, y): return CORE_X <= x < CORE_X + W and CORE_Y <= y < CORE_Y + H

# ================= world layer (drawn first; the core is painted over its own rectangle) =================
# --- sky across the whole width: two darker bands above the core's sky, then the core's bands
world_bands = [(76, 124, 184), (84, 132, 190)]
core_bands = [(92, 140, 196), (108, 156, 206), (126, 172, 214), (148, 188, 220), (172, 204, 222), (198, 214, 214)]
for i, c in enumerate(world_bands): rect(0, i * 20, WORLD_W, (i + 1) * 20, c)
for i, c in enumerate(core_bands): rect(0, CORE_Y + i * 18, WORLD_W, CORE_Y + (i + 1) * 18, c)
rect(0, CORE_Y + len(core_bands) * 18, WORLD_W, LAND_Y, core_bands[-1])
def wcloud(cx, cy, w):
    for dx in range(-w, w + 1):
        hgt = 3 if abs(dx) < w // 2 else 2
        rect(cx + dx, cy - hgt, cx + dx, cy, (244, 244, 236))
    rect(cx - w, cy + 1, cx + w, cy + 1, (214, 220, 226))
wcloud(36, 52, 10); wcloud(318, 34, 13); wcloud(300, 96, 8); wcloud(170, 14, 9)

# --- far mountains on both sides (behind the core's own range, which overlaps them)
def wmountain(cx, base, h, half, c, snow=None):
    for y in range(h):
        w = int(half * y / h)
        rect(cx - w, base - h + y, cx + w, base - h + y, c)
        if snow and y < h // 4: rect(cx - w, base - h + y, cx + w, base - h + y, snow)
wmountain(26, LAND_Y, 62, 44, (98, 106, 130), (226, 232, 240))
wmountain(336, LAND_Y + 2, 84, 52, (86, 92, 114), (226, 232, 240))
wmountain(298, LAND_Y + 2, 36, 24, (110, 118, 142))

# --- grass over all the land, with the core's diagonal texture near the horizon and random speckles
rect(0, LAND_Y, WORLD_W, WORLD_H, GRASS)
for y in range(LAND_Y, LAND_Y + 16):
    for x in range(WORLD_W):
        if (x + y) % 5 == 0: px(x, y, (104, 156, 76))
for _ in range(4200):
    x, y = random.randrange(WORLD_W), random.randrange(LAND_Y + 10, WORLD_H)
    if not in_core(x, y): px(x, y, random.choice(GRASS_TEX))

# --- the river to the south, flowing east, with a plank bridge where the path crosses
WATER, WATER_LIGHT, BANK = (64, 112, 172), (112, 160, 212), (66, 108, 50)
RIVER_Y = 470
def river_y(x): return RIVER_Y + (3 if (x // 24) % 2 else 0) + (1 if (x // 9) % 3 == 0 else 0)
for x in range(WORLD_W):
    y0 = river_y(x)
    rect(x, y0 - 1, x, y0 - 1, BANK); rect(x, y0, x, y0 + 9, WATER); rect(x, y0 + 10, x, y0 + 10, BANK)
    if x % 7 == 0: px(x, y0 + 3 + (x % 3), WATER_LIGHT)
    if x % 11 == 4: px(x, y0 + 6, WATER_LIGHT)

# --- the main path, from the core's south edge to the bottom of the map, over the bridge
def wpath(pts, wide=7):
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        steps = max(abs(y1 - y0), abs(x1 - x0))
        for i in range(steps + 1):
            x = round(x0 + (x1 - x0) * i / steps); y = round(y0 + (y1 - y0) * i / steps)
            if abs(y1 - y0) >= abs(x1 - x0):
                rect(x - wide, y, x + wide, y, PATH); px(x - wide, y, PATH_DARK); px(x + wide, y, PATH_DARK)
            else:
                rect(x, y - wide, x, y + wide, PATH); px(x, y - wide, PATH_DARK); px(x, y + wide, PATH_DARK)
main = [(CORE_X + 90, CORE_Y + H), (CORE_X + 92, 452), (CORE_X + 94, 500), (CORE_X + 88, WORLD_H)]
wpath(main)
for _ in range(90):                                       # pebbles
    y = random.randrange(CORE_Y + H, WORLD_H)
    if abs(y - RIVER_Y - 5) > 8: px(CORE_X + 91 + random.randint(-4, 4), y, PATH_DARK)
bx0, bx1 = CORE_X + 82, CORE_X + 102                      # bridge
for x in range(bx0, bx1 + 1):
    y0 = river_y(x)
    rect(x, y0 - 2, x, y0 + 11, (150, 104, 62) if x % 3 else (112, 74, 42))
for x in (bx0, bx1):
    rect(x, RIVER_Y - 4, x, RIVER_Y + 15, (96, 64, 38))
rect(bx0, RIVER_Y - 4, bx1, RIVER_Y - 4, (120, 84, 50)); rect(bx0, RIVER_Y + 15, bx1, RIVER_Y + 15, (120, 84, 50))
# side paths south of the river to the two southern plots
wpath([(CORE_X + 86, 512), (150, 512)], wide=3)
wpath([(CORE_X + 96, 512), (210, 512)], wide=3)

# --- empty plots: cleared dirt with corner stakes and a rope, waiting for a building
PLOTS = {}
def plot(name, x0, y0, x1, y1):
    rect(x0, y0, x1, y1, (150, 118, 80))
    for _ in range((x1 - x0) * (y1 - y0) // 14):
        px(random.randint(x0 + 1, x1 - 1), random.randint(y0 + 1, y1 - 1), random.choice([(170, 138, 96), (132, 102, 68)]))
    for y in range(y0 + 3, y1 - 2, 4):                    # faint furrows
        for x in range(x0 + 2, x1 - 1, 2): px(x, y, (138, 108, 72))
    rect(x0, y0, x1, y0, (120, 92, 60)); rect(x0, y1, x1, y1, (120, 92, 60))
    rect(x0, y0, x0, y1, (120, 92, 60)); rect(x1, y0, x1, y1, (120, 92, 60))
    for x in range(x0, x1 + 1, 2):                        # rope, one px outside the dirt
        px(x, y0 - 2, (226, 206, 150)); px(x, y1 + 2, (226, 206, 150))
    for y in range(y0, y1 + 1, 2):
        px(x0 - 2, y, (226, 206, 150)); px(x1 + 2, y, (226, 206, 150))
    for (sx, sy) in ((x0 - 2, y0 - 2), (x1 + 2, y0 - 2), (x0 - 2, y1 + 2), (x1 + 2, y1 + 2)):  # stakes
        rect(sx - 1, sy - 4, sx, sy + 1, (110, 74, 44)); rect(sx - 1, sy - 4, sx, sy - 4, (176, 132, 84))
    PLOTS[name] = (x0, y0, x1, y1)

# --- west: more forest beside the core's, a lake, a clearing
def wtree(x, y, s=1):
    trunk = (96, 64, 40)
    rect(x - 1, y - 2, x + 1, y + 4, trunk)
    greens = [(40, 92, 48), (52, 110, 56), (66, 128, 64)]
    for i, r in enumerate([7, 6, 4, 2]):
        r = r * s
        ty = y - 3 - i * 4 * s
        rect(x - r, ty - 3, x + r, ty, greens[min(i, 2)])
        px(x - r, ty - 3, greens[0]); px(x + r, ty - 3, greens[0])
for (tx, ty) in [(10, 206), (26, 198), (44, 210), (62, 202), (78, 214), (16, 226), (36, 232), (56, 228), (72, 240), (8, 250), (28, 258), (48, 252), (66, 264)]:
    wtree(tx, ty)
plot("west", 18, 292, 62, 318)
lake = (40, 368, 30, 18)                                  # centre x, y, half-width, half-height
for y in range(-lake[3], lake[3] + 1):
    w = int(lake[2] * (1 - (y / lake[3]) ** 2) ** 0.5)
    rect(lake[0] - w - 1, lake[1] + y, lake[0] + w + 1, lake[1] + y, BANK)
    rect(lake[0] - w, lake[1] + y, lake[0] + w, lake[1] + y, WATER)
for (lx, ly) in [(30, 362), (46, 372), (38, 380), (52, 360)]:
    rect(lx, ly, lx + 3, ly, WATER_LIGHT)
for (rx, ry) in [(12, 356), (14, 352), (70, 382), (68, 386), (72, 378)]:   # reeds
    rect(rx, ry, rx, ry + 4, (60, 100, 40)); px(rx, ry - 1, (130, 90, 50))
for (tx, ty) in [(18, 500), (36, 492), (54, 504), (26, 520), (46, 524), (70, 516), (12, 540), (62, 544)]:  # SW grove
    wtree(tx, ty)

# --- east: hills, fields, a clearing, an orchard
for (cx, cy, rw, rh) in [(300, 196, 30, 10), (344, 204, 26, 9), (318, 216, 22, 7)]:
    for y in range(-rh, 1):
        w = int(rw * (1 - (y / rh) ** 2) ** 0.5)
        rect(cx - w, cy + y, cx + w, cy + y, (100, 154, 72))
    rect(cx - rw, cy + 1, cx + rw, cy + 1, (72, 120, 54))
for i, (fx0, fy0, fx1, fy1, crop) in enumerate([(282, 238, 314, 262, (196, 176, 84)), (320, 238, 352, 262, (96, 150, 70)),
                                                 (282, 268, 314, 292, (96, 150, 70)), (320, 268, 352, 292, (196, 176, 84))]):
    rect(fx0, fy0, fx1, fy1, (128, 96, 62))
    for y in range(fy0 + 2, fy1, 3): rect(fx0 + 1, y, fx1 - 1, y, crop)
for x in range(279, 356, 3):                              # field fence
    rect(x, 234, x, 236, (130, 92, 56)); rect(x, 295, x, 297, (130, 92, 56))
rect(279, 235, 355, 235, (150, 108, 66)); rect(279, 296, 355, 296, (150, 108, 66))
plot("east", 292, 314, 336, 340)
def fruit_tree(x, y):
    rect(x - 1, y, x + 1, y + 5, (96, 64, 40))
    for yy in range(-6, 1):
        w = 5 - abs(yy + 3)
        rect(x - w - 1, y + yy, x + w + 1, y + yy, (58, 120, 58))
    for (fx, fy) in ((x - 3, y - 3), (x + 2, y - 5), (x + 1, y - 1)): px(fx, fy, (210, 60, 50))
for (tx, ty) in [(288, 368), (306, 364), (324, 370), (342, 366), (296, 388), (314, 392), (332, 388), (350, 394), (290, 412), (322, 414), (344, 418)]:
    fruit_tree(tx, ty)
for (rx, ry) in [(300, 506), (306, 510), (330, 500), (344, 526), (318, 532)]:  # boulders south-east
    rect(rx - 3, ry - 2, rx + 3, ry + 2, (128, 128, 136)); rect(rx - 2, ry - 2, rx + 1, ry - 2, (168, 168, 176))

# --- south: two plots on either side of the path, a hedge at the edge of the map
plot("south_west", 106, 496, 148, 528)
plot("south_east", 214, 496, 256, 528)
for x in range(0, WORLD_W, 1):
    if (x // 6) % 2 == 0: rect(x, 551, x, 555, (48, 96, 46))
    else: rect(x, 552, x, 555, (56, 108, 52))
# reeds by the river and flowers everywhere outside the core
for x in range(4, WORLD_W, 13):
    if not (bx0 - 4 <= x <= bx1 + 4): rect(x, river_y(x) - 4, x, river_y(x) - 2, (60, 100, 40))
for _ in range(140):
    x, y = random.randrange(WORLD_W), random.randrange(LAND_Y + 8, WORLD_H)
    if not in_core(x, y) and gp(x, y)[1] > 110 and gp(x, y)[2] < 120:
        px(x, y, random.choice([(240, 220, 90), (230, 120, 140), (240, 240, 240)]))

# ================= the core: the original village, unchanged, drawn in its own coordinates =================
OFF[0], OFF[1] = CORE_X, CORE_Y
BOUNDS[0], BOUNDS[1] = W, H

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
line(bx + 11, by + 8, bx + 23, by + 22, (170, 120, 70))
line(bx + 23, by + 8, bx + 11, by + 22, (170, 120, 70))
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
    if gp(x, y)[1] > 110: px(x, y, random.choice([(240, 220, 90), (230, 120, 140), (240, 240, 240)]))

# ================= foreground fixes in world coordinates =================
OFF[0], OFF[1] = 0, 0
BOUNDS[0], BOUNDS[1] = WORLD_W, WORLD_H
# The core's mountains reach past its edges; cover their base rows outside the core with the horizon grass, as the
# core does inside.
for y in range(LAND_Y, LAND_Y + 4):
    for x in range(WORLD_W):
        if not in_core(x, y): px(x, y, (104, 156, 76) if (x + y) % 5 == 0 else GRASS)

out = sys.argv[1]
big = img.resize((WORLD_W * S, WORLD_H * S), Image.NEAREST)
colors = big.getcolors(256)
if colors is not None:  # few flat colours: an indexed PNG is lossless and much smaller
    big = big.convert("P", palette=Image.Palette.ADAPTIVE, colors=len(colors), dither=Image.Dither.NONE)
big.save(out, optimize=True)
anchors = {"dungeon": (cave_x, cave_y), "woodcutting": (34, 168), "merchant": (mx, my), "storage": (bx + 17, by), "training": (tx, ty),
           "mine": (mine_x, mine_y - 8), "town_hall": (hx, hy - 20)}
print(f"world {WORLD_W}x{WORLD_H}, core at ({CORE_X}, {CORE_Y}) size {W}x{H}")
for k, (x, y) in anchors.items():
    print(f"{k}: world x={x + CORE_X} y={y + CORE_Y}  (core fraction x={x/W:.3f} y={y/H:.3f})")
for k, r in PLOTS.items():
    print(f"plot {k}: {r}")
