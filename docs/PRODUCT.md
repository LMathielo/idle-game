# Product

Living product doc. Owned by the product-owner orchestrator; updated whenever a decision changes. Overrides generic advice in the skills.

## Vision

A mobile idle RPG in the spirit of Gladiatus. One hero, a medieval village hub, gear and attributes that matter, dungeons that fight themselves, and gathering skills that tick while you're away. Short sessions: open, collect, decide, close.

## Pillars

1. **Meaningful decisions, automated execution.** The player chooses what to train, what to equip, where to go. Combat and gathering run on their own.
2. **Always progressing.** Something is always filling up, including offline (capped).
3. **Readable on a phone in one glance.** Pixel-medieval, big tap targets, numbers with deltas.
4. **Server-ready from day one.** Deterministic engine, commands in / state out. Local storage for the POC.

## Platform & constraints

- iOS + Android via Expo (SDK 58), tested through Expo Go. No web.
- Single player for now; multiplayer later via a server that reuses the engine.

## Current state (2026-11-01, engine 1.15.0)

- Two tabs: **Village** (pixel village hub with signs: Storage, Merchant, Dungeon, Training, Woodcutting, Mine Shaft, Town Hall, and Crafting on the east plot) and **Hero** (XP, Status panel with 4 attributes, derived damage/defense, current/max HP with regen, mana and stamina, 11 equipment slots (incl. the axe and the pickaxe), 20-slot inventory, 3 skills: Woodcutting, Mining, Fishing).
- **Buildings (2026-10-28):** Woodcutting, Mine Shaft, Town Hall and Training Grounds start **locked** (greyed sign with 🔒); tapping one opens a Build sheet with each requirement (have / need) and a Build button. Dungeon, Merchant and Storage are always built. Table below.
- **Town Hall, upgrades and workers (2026-10-28, engine 1.10.0):** every building upgrades to Lv5 (never above the Town Hall) with **one builder**, paid up front, timed, live and offline; the sign shows "Upgrading 12:34". Bonuses per level (yield, sell prices, worker slots, merchant stock slots). The Town Hall hires **workers** who gather on any tree or rock the hero can work, at 25% of the hero's power each, for upkeep per minute. **Gathering yield is power-based**: power ÷ requirement items per action (Oak and Stone need 20 now). The Merchant rolls a **random stock** from a 12-item pool on each refresh. Tables below.
- **Training Grounds upgrades (2026-10-28, engine 1.11.0):** the Training Grounds upgrade to Lv5 like every other building (Town Hall cap, half the Town Hall's cost); each level gives **+1 training XP per minute** (Lv1 = 1, Lv5 = 5), live, offline and for the stamina speed-up.
- **Mine Shaft (2026-10-28):** mining mirrors woodcutting with its own config: 5 rocks (Stone, Copper, Iron, Silver, Gold), mining strength (MS = 10 × level + STR + pickaxe), Wooden Pickaxe for everyone, Iron Pickaxe at the Merchant, Geode 1/200. Table below.
- **M1 done and on `main`:** deterministic engine (`src/engine`), `LocalGameClient`, on-device SQLite save with an action log. Woodcutting works from the Village sign (tap to start/stop), progresses live and offline (8h cap), and shows a "While you were away" summary. Hero tab reads real state. Debug panel on the Hero tab (clock offset, +10k hero XP, stamina, attributes, hero HP → 1, finish run, reset save).
- **M4 Dungeon in progress:** the Dungeon sign opens a full-screen modal with **5 dungeon tiers** (Rat Cellar, Bat Cave, Wolf Den, Forgotten Crypt, Troll Bridge), one enemy each. Each tier unlocks after a number of wins in the previous one (10 / 15 / 25 / 40); locked tiers show what opens them and their progress, and a banner announces a new unlock. Runs auto-repeat, live and offline. **Since 2026-10-27 a run is a search for an opponent (2/3/5/8/12 min − 1 s per DEX), then a live fight** that plays out strike by strike in engine time (each side on its own attack timer, 60 s limit) and gives hero XP, gold and the tier's loot; stamina skips the search only. A danger hint (Easy / Tough / Deadly) estimates the HP cost of a fight. Current HP persists and regenerates (5 + END per minute). Last-fight panel with a replay of the fight log. Only one activity runs at a time. Tiers 4–5 need Training.
- **M3 Training in progress:** the Training sign opens a full-screen modal. Gold buys training tiers (Tier 1 = 100 g, tier t = 100·t³, 10 tiers, each +20 max level for all four attributes); time trains one attribute at a time at 1 XP per minute, live and offline (8h cap). Effective attribute = base + training level, used by damage, defense, HP regen and the DEX run time. The Hero tab shows each attribute's base + trained split.
- **Woodcutting (2026-10-27):** the Woodcutting sign opens a full-screen modal with **5 trees** (Oak, Birch, Maple, Yew, Ironwood) in a swipeable carousel. Each tree needs a woodcutting level and a **woodcutting strength** (WS = 10 × level + STR + axe). New **axe** equipment slot; everyone has the Wooden Axe (+1 WS). Logs every 1:50 on Oak at DEX 10, skippable with stamina. Training can be sped up with stamina (1 per minute).
- **Merchant (2026-10-27):** the Merchant sign opens a full-screen modal with **Buy | Sell** tabs. Slot 1 is always Health Potion ×10; since 1.10.0 the other slots are rolled from a pool on each refresh (table below); 5 refresh charges (+1 per 2 h). Tapping an item on the Hero tab opens an info sheet with **Equip / Use / Unequip**. Item names are colored by rarity.
- **UI kit, village map, skill XP (2026-10-31, engine 1.12.0):** see "UI rules" below. Woodcutting / Mining Lv1 → 15 takes about a day of gathering (skill XP base 100, steeper from Lv15); existing saves keep their total skill XP and jump levels.
- **Crafting (2026-11-01, engine 1.13.0):** the Crafting house (east plot, locked on a new save) turns logs and ore into planks, Stone Bricks and ingots in **timed pipes** that run side by side, beside anything the hero does, live and offline (8h cap). 2 of 8 pipes open (3–4 "Unlocks later", 5–8 "Premium — coming soon"; no unlock yet, debug only). Since 1.15.0 a material pipe is **continuous**: it crafts its recipe until **Stop**, each craft taking its materials when it starts, and **waits** while they are short (so gathering feeds it); **×10** is a tap on the running craft (10× for stamina); **Insta** finishes the current craft for stamina; the header's **Recipes** button lists everything and starts into the first free pipe. INT shortens craft time (its first effect). The unused Smithing skill is gone. Tables below.
- **Gear crafting, quality and rarity (2026-11-01, engine 1.14.0):** every piece of gear (weapons, armor, axes, pickaxes) has a **rarity colour** (white, green, blue, purple) and a **quality 0–100%** that scales its stats; prices follow the colour (×1 / ×1.5 / ×2 / ×4). Old gear became "White · Quality 25%" with unchanged numbers. The Merchant's gear is rolled (quality 0–50, white / green / blue). The Crafting house's **Equipment** tab makes 5 sets × 6 pieces (Stone, Copper, Iron, Silver, Gold) from bricks / ingots and planks, one piece per job; stamina invested at start raises the lowest quality; the piece waits in its pipe until **Done**, which reveals it. Tables below.
- Storage shows "coming soon". No storage, tool crafting, gear drops or item affixes yet.
- Technical details: `docs/ENGINE.md`.
- Delivery: PRs land on `dev` (test preview in Expo Go, EAS branch `dev`); the owner releases `dev` → `main` (EAS branch `main`) after testing.

## UI rules (2026-10-31)

- **Dialogs:** every confirmation and every alert ("Not possible", "Could not save", errors) is a **GameDialog**: pixel styled, Pixelify title, Inter body, red confirm when the action loses something. Android back or a tap outside = cancel. Never the native alert.
- **Info:** tapping an item or anything with info opens an **InfoPopover**: a squared box next to the tapped element (above or below, kept on screen), with that element's actions as buttons inside. A tap outside closes it. Used for items (Equip / Use / Unequip / Buy / Sell), locked buildings (Build), upgrades (Upgrade), hero stats and attributes, locked dungeons, trees and rocks (ⓘ).
- **Hold-to-repeat:** stamina skips (woodcutting, mining, dungeon search), training speed-ups and the debug buttons (not Reset save) repeat while held: one action on touch, then every 100 ms after 400 ms. A repeat stops on release, when stamina or gold runs out (silently, no dialog), or when the button turns off.
- **Village map:** drag and pinch-zoom (up to 2.5×), never past the map's edge; it opens centred on the village. Signs keep their size; the HUD and the activity strip stay fixed on top. Empty roped plots are where future buildings go (the Crafting house is on the east plot).
- **Building bonuses (2026-11-01):** every building modal (Woodcutting, Mine Shaft, Merchant, Town Hall, Training Grounds, Crafting) shows its **current level's bonuses** as a line under the header, e.g. "Lv3 · −19% craft time", "Lv2 · +20% log yield", "Lv1 · no bonus yet". The Upgrade box keeps its now / next comparison.

## Buildings (2026-10-28)

| Building | State on a new save | Requirements | Gives |
| --- | --- | --- | --- |
| Dungeon, Storage | always there (not upgradable) | — | — |
| Merchant | built, Lv1 (a stored building since 1.10.0) | — | stock slots by level |
| Woodcutting | locked | 50 gold | woodcutting |
| Mine Shaft | locked | 50 gold | mining |
| Town Hall | locked | hero Lv5, 20 Oak Logs, 20 Stone, 100 gold | workers; caps every other building's level |
| Training Grounds | locked | hero Lv10, Town Hall Lv1, 50 Oak Logs, 50 Stone, 250 gold | training, with Tier 1 included; XP/min by level |
| Crafting (2026-11-01) | locked | Woodcutting and Mine Shaft built, 30 Oak Logs, 30 Stone, 150 gold | crafting pipes; craft time and yield by level |

## Building upgrades (2026-10-28, engine 1.10.0)

One builder: one upgrade at a time, paid up front (gold + items), timed on engine time (live and offline, 8 h cap), never blocks the hero. No cancel. No building above the Town Hall's level; max Lv5. A level with no bonus data can't be built (`NOT_UPGRADABLE`; no building is in that case since 1.11.0). Dungeon and Storage are not upgradable.

| To level | Town Hall | Every other building (half, rounded up) |
| ---: | --- | --- |
| 2 | 500 g, 50 Oak Logs, 50 Stone, 30 min | 250 g, 25 Oak Logs, 25 Stone, 15 min |
| 3 | 2,000 g, 100 Birch Logs, 100 Copper Ore, 2 h | 1,000 g, 50 Birch Logs, 50 Copper Ore, 1 h |
| 4 | 8,000 g, 200 Maple Logs, 200 Iron Ore, 8 h | 4,000 g, 100 Maple Logs, 100 Iron Ore, 4 h |
| 5 | 32,000 g, 400 Yew Logs, 400 Silver Ore, 24 h | 16,000 g, 200 Yew Logs, 200 Silver Ore, 12 h |

## Building bonuses (per level; bonuses add together)

| Building | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 |
| --- | --- | --- | --- | --- | --- |
| Town Hall | 5 workers | +20% wood/stone/ore yield, +20% sell prices, 7 workers | same, 9 workers | same, 12 workers | same, 15 workers |
| Woodcutting | — | +20% log yield | +40% | +60% | +80% |
| Mine Shaft | — | +20% stone/ore yield | +40% | +60% | +80% |
| Merchant | 5 stock slots | 7 | 9 | 11 | 13 |
| Training Grounds | 1 training XP/min | 2 XP/min | 3 | 4 | 5 |
| Crafting | — (100% craft time) | −10% craft time (90%) | −19% (81%) | −27.1% (72.9%), +10% crafted yield | −34.39% (65.61%), +20% crafted yield |

Yield multiplier = 1 + Town Hall bonus + the skill's building bonus (hero and workers). Sell price = floor(catalog × 1.2) at Town Hall Lv2+.

## Crafting (2026-11-01, engine 1.13.0; continuous pipes 1.15.0)

| Rule | Value |
| --- | --- |
| Pipes | 8 slots shown; 2 open on a new save (`pipesUnlocked`, max 8). Pipes 3–4 "Unlocks later", 5–8 "Premium — coming soon" (no unlock or purchase yet; debug "Unlock next pipe") |
| Not an activity | never uses the hero; never stops or is stopped by woodcutting, mining, dungeons or training; pipes run in parallel; live and offline, 8h cap, same clock rules |
| Material job (1.15.0) | pick a recipe, Start: no quantity, no mode. Crafts back to back until **Stop**; each craft takes its materials **when it starts** and its time is set then (an upgrade or trained INT counts from the next craft). The row shows "Crafted 37" (since the job started), time left, the bar with xx.yy%, Insta, ×10 and Stop |
| Waiting (1.15.0) | too few materials for the next craft → the pipe **waits** ("Waiting for Oak Logs (1/2)"): no time passes, nothing is taken; it starts **the instant** they are there (the hero's gathering, worker crews, another pipe's output, a buy / refund / collect). Pipes share one inventory and take turns **in pipe order** at the same instant (after the hero, the builder and the crews). The sign says "Waiting for materials" when every busy pipe waits |
| Recipes (1.15.0) | a **Recipes** button in the Crafting header opens every recipe (Materials / Equipment, have / need, time, output), even when every pipe is busy. Start goes into the first free pipe; none free → greyed "All pipes busy". An idle pipe's "Craft…" still opens the list for that pipe |
| Output | into the inventory as each craft finishes; no stack and no free slot → the pipe waits ("Inventory full"), timer held, nothing lost, resumes when room appears |
| Craft time | max(1 s, ceil(base × house time × (1 − INT reduction))); INT reduction = 50% × INT ÷ (INT + 50) (effective INT: 10 → 8.33%, 50 → 25%, 100 → 33.3%) |
| Yield (normal items) | output × (1 + house yield); the fraction is kept hidden per item and pays one more item when it reaches 1 (no randomness) |
| ×10 (1.15.0) | a **tap on the running craft**: 9× more materials now + max(1, ceil(9 × craft minutes)) stamina → that craft makes 10× in the same time, progress kept. Only that craft (the next is ×1). Greyed with the reason when materials or stamina are short; not for gear, waiting or held pipes |
| Insta | finishes the current craft now (a ×10 one too) for ceil(remaining minutes) stamina, at least 1 (hold to repeat); refused when the inventory has no room |
| Stop (1.15.0) | (confirmation) ends a material job: refunds the materials of the craft in progress (a ×10 one's extra too); stamina already spent is not refunded; a waiting pipe just becomes free; refused when the refund has no room. Gear jobs keep **Cancel** |

| Tier | Recipe | Input | Output | Base time | Sell |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | Oak Plank / Stone Brick | 2 Oak Logs / 2 Stone | 1 | 5 s | 2 |
| 2 | Birch Plank / Copper Ingot | 4 Birch Logs / 4 Copper Ore | 1 | 10 s | 12 |
| 3 | Maple Plank / Iron Ingot | 8 Maple Logs / 8 Iron Ore | 1 | 20 s | 64 |
| 4 | Yew Plank / Silver Ingot | 16 Yew Logs / 16 Silver Ore | 1 | 40 s | 320 |
| 5 | Ironwood Plank / Gold Ingot | 32 Ironwood Logs / 32 Gold Ore | 1 | 80 s | 1,600 |

Crafted materials are common (white), stackable, and sell for the sell value of their inputs. No crafting skill, no XP, no level gates.

## Gear quality and rarity (2026-11-01, engine 1.14.0)

| Rule | Value |
| --- | --- |
| Gear | every equippable item (all slots, tools included). Each piece has its own rarity and quality |
| Rarity (colour) | common white, uncommon green, rare blue, epic purple (legendary gold later); names and slot frames use it |
| Quality | an integer 0–100 (a d101: every roll is a uniform integer, both ends included). Popover subtitle "Green · Quality 73%" |
| Stats | catalog = 100% max; effective = max(1, round(max × (100 + quality) / 200)), half up; both ends of a damage range; attack speed not scaled |
| Prices | buy and sell = floor(catalog price × rarity multiplier): common ×1, uncommon ×1.5, rare ×2, epic ×4 (legendary unused). Quality does not change prices. Town Hall sell bonus after it |
| Old gear | every existing piece, a new hero's gear and a new save's stock: quality 25, common (same stats and prices as before) |
| Merchant gear | one piece per listing, quality 0–50, common 70 / uncommon 25 / rare 5 (never epic+); price = buy × rarity multiplier, fixed at the roll |
| Mob gear drops | not yet; will roll 0–70 (config only) |

## Gear crafting (2026-11-01, engine 1.14.0)

| Rule | Value |
| --- | --- |
| Job | one piece per job (no quantity, no x10, no yield bonus); same craft-time rule as materials |
| Stamina | invest 0–50 at start (stepper +1 / +10, hold to repeat): +1 minimum quality each; paid at start, **never refunded**; never changes the colour odds. A `minQuality` hook (0) adds to the floor; capped at 100 |
| Roll | at start: quality = a uniform integer in [floor, 100]; colour uncommon 75 / rare 20 / epic 5 (per-recipe override possible). Hidden until Done |
| Ready | the finished piece waits in its pipe (100.00%, "✓ Ready — Done"; sign "Iron Sword ready"; away summary lists it), live and offline; the pipe starts nothing else |
| Done | moves the piece into the inventory and opens its popover (the reveal, with Equip); needs a free slot ("Inventory full", greyed; the piece stays safe) |
| Insta | same cost rule; takes the job to ready |
| Cancel | while crafting: materials back, invested stamina lost (the dialog says so); a ready piece cannot be cancelled |

| Tier | Set | Made from | Sword | Helm | Chestplate | Shield | Gloves / Boots |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: |
| 1 | Stone | Stone Brick + Oak Plank | 4–6 | 2 | 3 | 3 | 1 |
| 2 | Copper | Copper Ingot + Birch Plank | 7–10 | 4 | 6 | 5 | 2 |
| 3 | Iron | Iron Ingot + Maple Plank | 10–14 | 6 | 10 | 8 | 3 |
| 4 | Silver | Silver Ingot + Yew Plank | 16–22 | 10 | 16 | 13 | 5 |
| 5 | Gold | Gold Ingot + Ironwood Plank | 24–34 | 15 | 24 | 20 | 8 |

Stats at 100% quality (damage for swords, armor for the rest). Inputs per piece at every tier (bricks or ingots + planks) and T1 time: Sword 4 + 2, 5 min · Helm 3 + 1, 4 min · Chestplate 6 + 2, 8 min · Shield 3 + 3, 5 min · Gloves 2 + 1, 2 min · Boots 2 + 1, 2 min; times double each tier. The Iron set makes the existing iron items (same prices). New pieces are not sold by the Merchant and sell for 25% of their inputs' sell value (as common, at least 1), × their rarity multiplier. On average a crafted piece sells for less than its inputs; a single epic (×4) can sell for more (accepted).

## Workers (2026-10-28, engine 1.10.0)

| Rule | Value |
| --- | --- |
| Hire | Town Hall built; 100 × 2^(workers owned) gold (100, 200, 400…); cap by Town Hall level above. Dismiss: no refund |
| Assign | any tree or rock the hero can work now (level and power), building built; one crew per node |
| Crew power | 25% × the hero's current power for that skill × workers on the node (gear upgrades count at once) |
| Yield / action | crew power ÷ node requirement × bonus multiplier; whole part + fraction as a chance; base time per node (no DEX) |
| Not | no XP, no rare drops; separate from the hero on the same node (additive) |
| Idle | hero below a node's requirement (equip change): crew stays assigned, works and costs nothing until he qualifies again |
| Upkeep / worker / minute | Tier 1 (Oak, Stone) 1 · T2 5 · T3 15 · T4 40 · T5 100 gold, per started minute; can't pay → all crews pause until gold covers it |
| Time | live and offline, 8 h cap, same clock rules; output lost when the inventory is full |

## Merchant stock (2026-10-28, engine 1.10.0)

Slot 1: Health Potion ×10. Other slots: rolled from the pool on each refresh (seeded, no duplicates). A new save starts with Iron Axe, Iron Pickaxe, Iron Sword, Iron Helm (quality 25, common). Every item sells for 30% of its price (floored), below its buy price even with the +20% bonus. Since 1.14.0 each gear listing rolls a quality (0–50) and a colour, and its price is × the colour's multiplier; the table shows a common piece at quality 25.

| Item | Slot | Stat (quality 25) | Buy | Sell |
| --- | --- | --- | ---: | ---: |
| Iron Axe / Iron Pickaxe | axe / pickaxe | +40 WS / MS | 600 | 180 |
| Iron Sword | weapon | 6–9 dmg | 500 | 150 |
| Iron Helm | helmet | +4 armor | 400 | 120 |
| Iron Chestplate | armor | +6 armor | 700 | 210 |
| Iron Shield | shield | +5 armor | 550 | 165 |
| Iron Gloves / Iron Boots | gloves / boots | +2 armor | 250 | 75 |
| Greater Health Potion (×5) | — | heal 60 | 30 | 9 |
| Steel Axe / Steel Pickaxe | axe / pickaxe | +120 WS / MS | 2,500 | 750 |
| Steel Sword | weapon | 10–14 dmg | 2,000 | 600 |

## Mine Shaft rocks (2026-10-28; Stone needs 20 MS since 1.10.0)

| Rock | Mining level | MS | Min / action (DEX 10) | XP / action | Item (sell) |
| --- | ---: | ---: | ---: | ---: | --- |
| Stone | 1 | 20 | 2 (1:50) | 25 | Stone (1) |
| Copper | 5 | 100 | 5 (4:50) | 119 | Copper Ore (3) |
| Iron | 15 | 450 | 10 (9:50) | 369 | Iron Ore (8) |
| Silver | 28 | 905 | 18 (17:50) | 853 | Silver Ore (20) |
| Gold | 42 | 1395 | 30 (29:50) | 1672 | Gold Ore (50) |

Items per action = MS ÷ the rock's MS × bonus (whole part + the fraction as a chance). Geode: 1/200 per action on every rock (uncommon, sell 30). Pickaxes: Wooden +1 MS (sell 1), Iron +40 MS (buy 600, sell 180), Steel +120 MS (buy 2,500, sell 750).

## Roadmap

Moved to [`STATUS.md`](STATUS.md) (refined and unrefined roadmap, current version, release notes).

## Decision log

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-21 | Expo + React Native + TypeScript, engine as pure TS | One codebase, engine reusable on a Node server |
| 2026-10-25 | Mobile only, preview via EAS Update → Expo Go | Owner works from his phone; no web target |
| 2026-10-25 | Two tabs: Village (hub) and Hero (character sheet) | Owner's direction; inventory lives inside Hero for now |
| 2026-10-25 | Gladiatus attribute set (STR, DEX, AGI, CON, CHA, INT) | Familiar to the target player; maps cleanly to combat formulas. **Superseded 2026-10-26** |
| 2026-10-25 | Workflow: product owner briefs → game-engineer codes on a branch → PR → 5 review agents → fix loop | Owner's request; keeps quality high without the owner reviewing every line on a phone |
| 2026-10-25 | On-device storage: SQLite (expo-sqlite) used as a document store, not MongoDB/Realm | Owner wanted a Mongo-like model because player attributes will grow. No Mongo/Realm option runs in Expo Go (Realm/Atlas Device Sync are end-of-life). The state is one JSON document (no schema change for new fields) with SQLite transactions and an append-only action log; the document maps 1:1 to a future server `players` document |
| 2026-10-25 | Offline progress capped at 8h at 100% efficiency, stored per player | Keeps a reason to come back; per-player values let a future "offline cap upgrade" raise them |
| 2026-10-25 | Device clock moved back = progress paused until real time catches up, no other penalty | Defeats "clock forward, collect, clock back, collect again" without punishing honest timezone/clock fixes |
| 2026-10-25 | XP curve (skills **superseded 2026-10-31**, hero base since 1.8.0): `round(base × L^1.5 × multiplier)`, hero base 1500, skills base 500, growth 1.00 (1–19), 1.05 (20–39), 1.07 (40–99), 1.18 (100+), no level cap | Targets ~2 days to hero Lv20 and >1 year to Lv100; table in `docs/ENGINE.md` |
| 2026-10-25 | Hero XP comes from combat only; skills give skill XP + items | Keeps gathering and combat as separate progression tracks |
| 2026-10-25 | "While you were away" opens only after ≥60 s of real time away (with at least one action) or on any clock anomaly | A quick app switch should not interrupt the player |
| 2026-10-25 | Debug panel stays enabled for the POC; any DEBUG_* action permanently sets `flags.debugUsed` on the save | Owner tests on the phone; a future server can tell debugged saves apart. Debug log rows stay replayable in any build |
| 2026-10-26 | Branch flow: `feat/*` / `fix/*` / `chore/*` → PR into `dev` (CI + 5-reviewer council) → owner tests the `dev` preview → owner opens and merges a release PR `dev` → `main` | `main` only receives code the owner tested himself; a manual publish from a feature branch had overwritten his `main` preview |
| 2026-10-26 | Only the owner merges, into `dev` and into `main`; agents never merge or push to either | Owner keeps control of what reaches each preview |
| 2026-10-26 | EAS Update branch = git branch: push to `dev` publishes EAS branch `dev`, push to `main` publishes EAS branch `main`; any other ref fails before publishing. No per-PR previews for now | Two stable previews in Expo Go (test vs approved) without builds or channels |
| 2026-10-26 | Only `main` is protected, with a ruleset: PR required (0 approvals), `CI` check, merge commit only; `dev` is the default branch and stays unprotected | New PRs target `dev` by default; `main` cannot be pushed to directly; merge commits keep `dev` and `main` from drifting. Rulesets, not classic protection, because only rulesets can limit the merge method per branch |
| 2026-10-26 | Publish job runs in GitHub environment `expo-publish`; moving `EXPO_TOKEN` there (deploy branches `main` + `dev`) is a one-time owner step | A workflow edited on a feature branch can never read the Expo token; the workflow keeps working before the move |
| 2026-10-26 | 4 attributes: Strength, Dexterity, Endurance, Intelligence; new hero starts at 10 each. Agility and Charisma removed, Constitution renamed Endurance. Old saves get max(old value, 10) for each attribute, so nobody is below a new hero | Fewer, clearer stats for a phone screen. STR = +1 damage, END = +1 defense; DEX and INT show "no effect yet" until combat needs them |
| 2026-10-26 | Derived stats (damage, defense, max HP, max mana) are computed, never stored. `final = round(base × (1 + Σ%)) + flat from attributes` | Attribute points are flat final bonuses that percent upgrades never scale, so training stays readable ("+1 STR = +1 damage") |
| 2026-10-26 | Max HP = 50 + 10 × (level − 1), max mana = 20 + 5 × (level − 1). No current HP until combat (M4). **Current HP added later the same day (dungeon)** | Nothing damages the hero yet |
| 2026-10-26 | Item stats come from a config catalog by item `defId`, not from the stored item | Balance changes need no save migration |
| 2026-10-26 | Stamina: 100 max (per player, upgradable later), +1 every 5 min, not limited by the 8h offline cap (the max bounds it). Planned costs: dungeon run 10, boss 25. **Costs superseded 2026-10-26 by the skip rule** | Gates dungeons/bosses (M4) without a hard daily limit. See projection below |
| 2026-10-26 | M3 Training = gold + time | Gladiatus-style training sessions; a time cost keeps progression paced and gives a reason to come back |
| 2026-10-26 | Village signs open a **full-screen modal** over the village (✕ to close), not a screen pushed inside the tabs. Expo Router root Stack: tabs group + modal routes (`fullScreenModal`, slide up; Android falls back to `modal`). Only Dungeon is built; Merchant/Storage/Training stay "coming soon"; Woodcutting keeps tap-to-toggle | One pattern for every building; the tab bar, strip and away summary stay intact underneath |
| 2026-10-26 | New activity kind `dungeon` (with `dungeonId`). **One activity at a time:** starting a dungeon stops woodcutting; starting woodcutting or stopping the dungeon cancels the current run, which is lost with no rewards. The UI says so before the player confirms | Keeps idle time single-tracked and simple to read |
| 2026-10-26 | **Auto-repeat:** while the dungeon is active, runs follow back-to-back, live and offline; the next run starts at once whatever the HP. Same `simulate()` path and clock rules as woodcutting (8h cap, backward = pause, invalid = no-op) | Dungeons are idle content like gathering |
| 2026-10-26 | Run time = max(60 s, 300 s − 1 s × DEX) (DEX 10 → 4:50), in config | Gives DEX its first effect; floor keeps runs meaningful |
| 2026-10-26 | **Skip** costs ceil(remaining min) stamina (1 per started minute) and resolves the current run's fight now; a real logged command (`SKIP_DUNGEON_RUN`); typed error and greyed button without enough stamina; auto-repeat continues. Waiting is always free. Replaces the planned run 10 / boss 25 costs | Stamina buys time, never access |
| 2026-10-26 | **Current HP** stored in the save (`character.hp`), max HP stays derived; flat regen 5 + 1 × END HP/min (END 10 → 15/min), always on (runs, woodcutting, idle, offline), remainder kept, not limited by the 8h cap (max bounds it), paused when the clock goes back | Fights need a persistent cost; regen keeps idle loops self-healing |
| 2026-10-26 | Offline catch-up interleaves HP regen and runs in time order: regen over each run's duration, then the fight at its end with the HP at that moment. After a fight the hero keeps the HP left; a loss leaves 0 HP; a fight that starts at 0 HP is an immediate loss | Offline result equals live play, deterministic |
| 2026-10-26 | Combat: turns alternate, hero first, whole-number rolls in [min, max] from the seeded RNG; dealt = max(1, round(roll × 50 / (defense + 50))), integer math; no hit chance/crit yet; 50-round cap counts as a loss | Simple, readable, server-replayable |
| 2026-10-26 | Rat Cellar Lv1: one Rat (HP 30, damage 3–5, defense 2). Win: +25 hero XP, +2–5 gold, Rat Skin 50% (new stackable common item; lost when the inventory is full). Loss: nothing | First combat loop; hero XP finally obtainable (combat only) |
| 2026-10-26 | Skip is bound to what the player saw: the command carries the run number and the cost shown (`maxCost`). If that run already finished, or the real cost is higher, it fails (`RUN_CHANGED`) and the screen just refreshes. At 0 HP, Skip stays enabled and warns "Certain loss — 0 HP" | Never charge more than shown, never resolve two runs with one tap; the player decides |
| 2026-10-26 | Run timing is per dungeon (config); the fight record stores why it ended (`endReason`) | Future dungeons can be shorter or longer; the UI never re-derives the outcome |
| 2026-10-26 | Only the **last fight's log** is stored (`{round, actor, roll, dealt, targetHpAfter}`), plus lifetime runs/wins/losses; no per-run log | Keeps the save small; the replay is visual only |
| 2026-10-26 | Save v4: HP full at the hero's level, no dungeon activity, empty fight state; engine 1.3.0 | Existing heroes start the dungeon at full health |
| 2026-10-26 | **5 dungeon tiers**, one enemy each, all in config: Rat Cellar (Rat), Bat Cave (Bat), Wolf Den (Wolf), Forgotten Crypt (Skeleton), Troll Bridge (Troll); new stackable loot Bat Wing, Wolf Pelt, Old Bone, Troll Hide. Table in `docs/ENGINE.md` | Long-term goals for the combat loop without new code per dungeon |
| 2026-10-26 | Unlock = **wins** in the previous tier: 10 / 15 / 25 / 40 (losses never count); permanent; lifetime runs/wins/losses kept per dungeon. Starting a locked tier is refused by the engine (`DUNGEON_LOCKED`) | Easier early, harder later; wins only go up, so an unlock can't be lost |
| 2026-10-26 | Run times 5 / 7 / 9 / 11 / 13 min (−1 s per DEX, min 1:00), same skip, combat, regen and auto-repeat rules for every tier | Harder tiers take longer and pay more |
| 2026-10-26 | Tiers 4–5 need Training to be beatable: sim says Crypt needs ~STR/END 20 (Lv 10: 98% wins), Troll ~STR/END 30 + Lv 20; at STR/END 10 both are 0%. Wolf Den is beatable from ~Lv 6–7 with base attributes | Gives Training (next milestone) a clear purpose |
| 2026-10-26 | Danger hint before a run: expected HP lost per fight with average rolls vs max HP: < 40% Easy, < 100% **Tough**, otherwise Deadly. A hint only, never a simulation. "Tough", not "Risky": it measures HP cost, not the chance to lose | Readable risk at a glance on a phone |
| 2026-10-26 | **Training tier 1 is paid: 100 gold.** A new hero is at tier 0 and can train nothing until he buys it | Training is the first gold sink; even the first step costs something |
| 2026-10-26 | Training level time: **5 + 10 × (n − 1) minutes** to reach level n (Lv1 5 min, Lv20 195 min, Lv200 1,995 min); +10 levels from 0 = 500 min, +20 = 2,000 min | Early levels come fast; each level costs a little more |
| 2026-10-26 | Tier price **100 × t³** gold: 100, 800, 2,700, 6,400, 12,500, 21,600, 34,300, 51,200, 72,900, 100,000. Bought in order, at any time (even before the current tier is maxed); not enough gold = typed error, gold never negative | Steep gold sink that scales with dungeon income |
| 2026-10-26 | **10 tiers / 200 levels**: tier t allows training levels up to 20 × t | Long-term goal with clear steps |
| 2026-10-26 | Tiers are **global**: one tier applies to all four attributes | One purchase, simple to read |
| 2026-10-26 | Training is an activity: **one activity at a time** (starting it stops woodcutting or cancels the dungeon run; starting either stops training) | Same single-track idle model as gathering and dungeons |
| 2026-10-26 | **Pause keeps XP**: stopping, switching attribute or starting another activity never loses training XP | Switching is a decision, never a punishment |
| 2026-10-26 | **Auto-stop at the cap**: at 20 × tier, training stops by itself; no XP beyond the cap (the remainder is dropped); "Maxed — unlock Tier N+1" | No wasted time, no hidden bank of XP |
| 2026-10-26 | **1 XP per trained minute**, with a rate-multiplier hook in config (does nothing yet; e.g. INT later). Same simulate() path and clock rules as woodcutting (8h cap, backward clock = pause). Save v6, engine 1.5.0 | Time is the cost; offline rules stay uniform |
| 2026-10-26 | **Replay anchors:** a save migration or engine change writes a `MIGRATE` log row with the full migrated state, in the same transaction. Replay is valid within one engine-version span; anchors stitch spans together, and older-engine spans are skipped (`skippedOldEngine`) instead of being re-run on new rules. An anchor must chain to the row before it (`fromHash`, `fromEngine`) and be a real version change, and every row's engine label must be a released engine that never goes back along the log, so a forged anchor or a fake label is rejected. Residual gap, for any log: labels are client-written, so a forger can relabel everything as an older released engine back to `NEW_GAME`; this closes only with server re-simulation using archived engine builds. Every save-version bump also bumps the engine version. Save v5, engine 1.4.0 | A future server can validate every log across app updates; was overdue since save v3 |
| 2026-10-27 | **Woodcutting modal** (Village → Woodcutting, full-screen like Dungeon and Training) replaces tap-to-toggle. **5 trees** in config: Oak / Birch / Maple / Yew / Ironwood, required WC level 1 / 5 / 15 / 28 / 42, base time per log 2 / 5 / 10 / 18 / 30 min, each with its own log item (Oak Logs kept) | Long-term gathering goals without new code per tree |
| 2026-10-27 | **Woodcutting strength** WS = 10 × WC level + effective STR + axe bonus (catalog). Required WS = max(0, 35 × reqLevel − 75): 0 / 100 / 450 / 905 / 1395. A new hero has WS 21. **Note:** Birch at WC level 5 needs 100 but a base hero has about 61 there, so Birch and later trees depend on trained STR or better axes (to come with the Merchant or drops) | Ties gathering to Training and future gear |
| 2026-10-27 | New **`axe`** equipment slot (tool). Wooden Axe (common, +1 WS) for every hero: new heroes start with it, the save migration equips it | First tool slot; better axes later |
| 2026-10-27 | XP per log = round(12.5 × base minutes × reqLevel^0.4): 25 / 119 / 369 / 853 / 1672. Cut time = max(10 s, base − 1 s × DEX) (Oak at DEX 10 = 1:50). Bird Nest stays 1/200 per log on every tree | Slower trees pay more per minute; DEX matters for gathering too |
| 2026-10-27 | Woodcutting follows the dungeon rules: back-to-back logs live and offline (8 h cap, clock rules), one activity at a time, **skip** = ceil(remaining min) stamina (min 1) for exactly the current log, bound to the log number and the cost shown. A locked tree is refused (`TREE_LOCKED`). The old 3 s / 10 XP rule is gone; WC level, XP and logs are kept | One idle model for every activity |
| 2026-10-27 | **Training speed-up with stamina:** 1 stamina per minute of training, buttons +1 min, +10 min and "To next level" on the active attribute; never charged beyond the tier cap; bound to the cost shown | Stamina buys time, never access (same as skips) |
| 2026-10-27 | Save v7, engine 1.6.0: a running woodcutting activity becomes Oak from 0; the Wooden Axe is equipped | Old saves keep their progress |
| 2026-10-27 | **Item quality** in the catalog: junk (gray, sell-only), common (white, has a game use), uncommon (green), rare (blue), epic (purple), legendary (dark yellow). Junk: Rat Skin, Bat Wing, Wolf Pelt, Old Bone, Troll Hide, Bread. Common: logs, gear, Health Potion. Uncommon: Bird Nest. Name colors pass 4.5:1 on the dark item panels | Readable value at a glance; rarity tiers ready for loot |
| 2026-10-27 | **Sell prices** (gold): Rat Skin 2, Bat Wing 5, Wolf Pelt 12, Old Bone 25, Troll Hide 60; logs 1 / 3 / 8 / 20 / 50; Bird Nest 30; Health Potion 5; Iron Axe 180, Sword 150, Helm 120; Rusty Gladius 3, Linen Tunic 2, Worn Sandals 1, Wooden Axe 1, Bread 1. Every buyable item sells for less than it costs | Gives gathering and dungeon loot a gold value; no buy→sell profit |
| 2026-10-27 | **New items:** Health Potion (T1) +50 HP capped at max, 12 g; Iron Axe +40 WS, 600 g; Iron Sword 6–9 damage, 500 g; Iron Helm +4 armor, 400 g | First gold sinks besides Training; Iron Axe opens later trees |
| 2026-10-27 | **Equip / unequip / use** are engine commands. Equipping swaps the old item into the new one's inventory place (works with a full inventory, never loses an item); unequip needs a free slot; potions refuse at full HP. Item info sheet on the Hero tab (Equip, Use, Unequip); no selling there | Gear choices finally matter; one place to read an item |
| 2026-10-27 | **Merchant stock**: as many slots as the inventory; each refresh fills only the first 4 with Health Potion ×10 (bought per unit), Iron Axe, Iron Sword, Iron Helm. A bought-out slot stays empty until the next refresh. Stock generation is data-driven (pool + roll) so a seeded, rarity-tiered roll can replace it later. **Superseded 2026-10-28 by the random stock pool** | Fixed shop for now, random stock later without a rewrite |
| 2026-10-27 | **Refresh charges**: +1 every 2 h, max 5 (extra lost), like stamina: uncapped by the 8 h offline cap, paused when the clock goes back, remainder kept. Refresh spends 1 | Gives a reason to come back; bounded |
| 2026-10-27 | **Buy / sell rules**: quantity 1..available, gold never negative, stacks merge, a new stack or unique item needs a free slot, equipped items can't be sold. A buy is bound to the item and price shown (`STOCK_CHANGED`, `PRICE_CHANGED`). The merchant is **not an activity**: trading works while woodcutting, training or in a dungeon | No surprises, nothing interrupts idle progress |
| 2026-10-27 | **Woodcutting stops when WS drops below the current tree's requirement** through an equipment change (unequipping the axe, equipping a weaker one). Logs already finished are kept; the log in progress is lost like any stop (`ACTIVITY_STOPPED`). Staying at or above the requirement keeps it running | Gear gates trees while you cut, not only when you start |
| 2026-10-27 | Save v8, engine 1.7.0: merchant at 5/5 with a fresh stock; quality and prices live only in the catalog (the old per-item `rarity` field is dropped) | Old saves keep everything else |
| 2026-10-27 | **Rebalance, early game:** a new player should reach hero Lv5 in the first minutes with the 100 starting stamina. Search times **2 / 3 / 5 / 8 / 12 min** for tiers 1–5 (−1 s per DEX, min 1:00); hero XP curve **base 1500 → 100** (power 1.5 and growth segments kept; skills unchanged); **Rat XP 25 → 35**. Lv5 = 1,703 XP ≈ 49 Rat wins | The early game was too punitive |
| 2026-10-27 | **Live combat:** a run = search + fight. The fight plays out in engine time: each side strikes on its own `attackIntervalMs` timer from the fight start (first strikes at t = interval; hero first on a tie); same damage formula and seeded rolls. Hero interval is a derived stat (base 1000 ms; gear can change it later via an optional item field, none set); each enemy has its own (all 1000). **60 s limit** replaces 50 rounds; reaching it is a loss with the usual loss rules. Regen runs during the search and the fight. Fully deterministic: offline catch-up plays the same events as live, and a simulate boundary or an app kill mid-fight changes nothing | Fights become something to watch, without UI timers ever deciding outcomes |
| 2026-10-27 | **Skip = search only**, same cost (1 stamina per started minute left), no HP regen for the skipped time; the fight then starts at once and always plays live. No skip during the fight (button hidden; `FIGHT_IN_PROGRESS`) | Stamina buys time, never outcomes |
| 2026-10-27 | Engineering choices in the live fight (engineer, flagged for the owner): hero stats (damage, defense, interval) are **frozen at the fight start**, so swapping gear mid-fight counts from the next fight; the hero's **HP stays live**, so a potion drunk mid-fight counts; **stopping or switching activity mid-fight is a forfeit** (see next row) | One source of truth for HP; no mid-fight gear exploits |
| 2026-10-27 | **Fleeing = forfeit:** Stop (or starting another activity) during the fight ends it as a loss (`forfeit`) with the normal loss rules: HP → 0, no rewards, the loss counts, it shows as the last fight. The button says "Flee (counts as loss)". During the search, Stop is still a plain cancel | Leaving a losing fight must not dodge the loss (HP → 0) |
| 2026-10-27 | Save v9, engine 1.8.0: existing heroes **keep their level**; XP is clamped to just under the next level on the new curve (`min(xp, xpToNext − 1)`); a run in progress becomes its search with its progress kept; the last fight keeps its log, timed 1 s per old round | Nobody loses a level; nothing in progress is lost |
| 2026-10-28 | **Fight at the offline cap:** when the 8 h cap is reached during a fight, that fight is finished (strikes keep landing past the cap until it ends, at most 60 s, never past the real time away); nothing else progresses. A search still pauses at the cap. Deterministic: same strikes and RNG as live play | Coming back to a paused fight at full HP was a quirk |
| 2026-10-28 | **Mining skill and Mine Shaft**, mirroring woodcutting with **its own config** (no shared constants) so the skills can get different bonuses later: MS = 10 × mining level + effective STR + pickaxe; 5 rocks with the trees' levels / strength / minutes (table above); −1 s per DEX (min 10 s); stamina skip of the current item; Geode 1/200; one activity at a time; stops when MS drops below the rock's requirement after an equip change | A second gathering loop that feeds buildings |
| 2026-10-28 | New **`pickaxe`** equipment slot; new saves start with the Wooden Pickaxe (+1 MS). Merchant stocks the **Iron Pickaxe** (+40 MS, 600 g) right after the Iron Axe; the stock has 5 listings | Mirrors the axe |
| 2026-10-28 | **Buildings and construction:** buildings are `locked` or `built` (Town Hall also has a level, 1 once built); requirements are data. `BUILD` checks every requirement, consumes gold and items atomically, builds at once, is logged and replayable (`ALREADY_BUILT`, `REQUIREMENTS_NOT_MET`). Locked buildings can't be used (`BUILDING_LOCKED` on woodcutting, mining and training). Building table above | A first construction goal that uses gathered materials |
| 2026-10-28 | **Training Grounds come with Tier 1** (no extra 100 g); Tier 2+ is paid as before. Engineer choice: buying a tier is also refused while the Training Grounds are locked | Building is the price of Tier 1 |
| 2026-10-28 | **Village:** mine entrance under the left mountain, Town Hall in the town centre; locked signs greyed with 🔒 open a Build sheet (have / need, met / unmet, Build enabled only when all are met); the built Town Hall shows "Coming soon: automated workers and building upgrades" (**replaced 2026-10-28** by the Town Hall modal with upgrades and workers) | Every building visible from day one, with its next goal |
| 2026-10-28 | Save v10, engine 1.9.0: existing saves get buildings **like a new save** (all four locked; owner said wiping was fine); a running woodcutting or training activity stops; Wooden Pickaxe and mining Lv1 added; the Iron Pickaxe listing fills merchant slot 4; everything else (gold, items, training tier, levels) kept | Same start for everyone without losing progress |
| 2026-10-28 | **Power-based yield** (woodcutting and mining): items per action = power ÷ the node's requirement × bonus multiplier; the whole part is guaranteed, the fraction is the chance of one more (one seeded draw per action, integer basis points). Oak and Stone need 20 power (was 0; the requirement is the divisor). Skill XP and the rare drop stay one per action; action time unchanged | Power keeps paying after a node unlocks; gives workers and bonuses something to multiply |
| 2026-10-28 | **Building upgrades and one builder:** every building to Lv5, never above the Town Hall (which caps at 5); `UPGRADE_BUILDING` checks cap and cost, pays gold + items up front atomically, bound to the level shown; one construction at a time; completes in simulate on the granted (capped) time; never blocks the hero; no cancel; debug "finish now". Costs: Town Hall table above, other buildings half rounded up | A long-term gold and material sink |
| 2026-10-28 | **Bonuses as data per level**, adding together: Town Hall Lv2+ +20% wood/stone/ore yield (hero and workers) and +20% sell prices (floor); Woodcutting / Mine Shaft +20% of their yield per level above 1; Merchant 5 + 2 × (level − 1) stock slots; worker cap 5/7/9/12/15 | Every upgrade does something visible |
| 2026-10-28 | **Merchant random stock pool:** slot 1 Health Potion ×10, the rest rolled per refresh from a 12-item pool without duplicates (seeded). New items: Iron Chestplate, Shield, Gloves, Boots, Greater Health Potion ×5, Steel Axe, Pickaxe, Sword (sell 30% of buy, floor). Existing saves keep their stock until the next refresh | Something new to look for on each refresh |
| 2026-10-28 | **Workers** (Town Hall): hire 100 × 2^owned, dismiss without refund; assign to any node the hero can work; crew power = 25% × hero's current power × workers; yield as the hero's on the node's base time; no XP / rare drops; idle (free, still assigned) when the hero no longer qualifies; upkeep 1/5/15/40/100 gold per worker per started minute by tier; can't pay → every crew pauses until gold covers it; live and offline under the same time rules | Idle income that scales with the hero and costs gold to run |
| 2026-10-28 | Engineering choices for workers (engineer, flagged for the owner): (1) a crew's yield follows the **average** crew size over the action (worker·ms), so moving workers just before an action ends gains nothing; a crew keeps its progress when workers join or leave, and loses it when its last worker leaves. (2) Upkeep per **started minute** is paid at the start of each minute for every working worker; a worker joining mid-minute pays its minute at once (no refund when one leaves). (3) Order within one instant: the hero's events (incl. dungeon gold) → an upgrade completing → crew actions → next minute's upkeep, so dungeon gold earned at a minute boundary counts before that minute is charged. (4) A new save's merchant stock is fixed (not rolled), so a new hero always finds the iron tools. (5) A Merchant upgrade fills its new stock slots at once. (6) Dungeon and Storage are not upgradable (no building in the engine; **owner confirmed**). (7) With no activity, the activity strip shows the builder's job | Determinism, no exploits, readable UI |
| 2026-10-28 | Owner answers on PR #16: **Dungeon and Storage stay non-upgradable**; **the Training Grounds can't be upgraded until they have a bonus** (data-driven: a level with no bonus data is unreachable, `NOT_UPGRADABLE`; the Upgrade entry is hidden); crew status in the Town Hall and on the node cards is enough (no toast). **Training Grounds part superseded 2026-10-28 (1.11.0): they now give XP/min per level** | Upgrades always give something |
| 2026-10-28 | Save v11, engine 1.10.0: buildings keep their levels, the Merchant becomes a stored building (built, Lv1), the builder is idle, no workers, the merchant stock is kept | Old saves keep everything |
| 2026-10-28 | **Training Grounds upgrades** (owner-approved): Lv1–5, capped by the Town Hall, standard cost (half the Town Hall's); **+1 training XP per minute per level** (Lv1 = 1 … Lv5 = 5), read when the XP is credited, so an upgrade finishing mid-training counts from that instant; the stamina speed-up still buys 1 minute per stamina, worth the current XP/min. The Training modal shows the rate and the time to level at it; the Upgrade sheet shows "+1 XP/min per level". Engine 1.11.0, save v11 unchanged (engine-only bump). `NOT_UPGRADABLE` stays for any level without bonus data | Supersedes "the Training Grounds can't be upgraded until they have a bonus"; gives Training a long-term upgrade path |
| 2026-10-28 | Engineering choice (engineer, flagged): above 1 XP/min a level-up can land a fraction of a wall millisecond past the level; that sub-ms of trained time (less than the XP/min in ms) is carried into the next level instead of dropped. Speed-up "Next Lv" = ceil(XP left ÷ XP/min) stamina | Nothing lost; still split-invariant |
| 2026-10-26 | Review council sized by risk: 2 reviewers normally, 5 for high-risk PRs; reviewers on Sonnet (medium reasoning); only findings ≥ 80 are fixed in the PR, one verification reviewer after fixes, lower findings batched into cleanup PRs | Token cost: the 5-reviewer council on every PR cost about as much as the coding itself |
| 2026-10-28 | 320pt-wide screens not supported; a shared gathering core (with parity tests over every gathering skill) comes before any third gathering skill | Owner answer on PR #15; review of PR #15 found mining is a copy of woodcutting |
| 2026-10-31 | **UI kit:** GameDialog for every dialog, InfoPopover for every info view (actions inside), hold-to-repeat (400 ms, then every 100 ms) on stamina skips, training speed-ups and debug buttons | One consistent pixel UI; no native alerts; fewer taps for repeated actions |
| 2026-10-31 | **Village map:** pan + pinch-zoom, world 360×560 with the old village as its core and 4 empty plots for future buildings | Room to grow, testable now |
| 2026-10-31 | **Skill XP rebalance (engine 1.12.0, save v12):** skill base 500 → 100, growth 1.07 from Lv15, 1.08 from Lv40, 1.18 from Lv100 (hero curve unchanged). Lv15 = 31,998 XP ≈ 23.5 h (Oak to Lv5, then Birch). Migration keeps each skill's total XP and recomputes the level | Lv15 took ~117 h; target was one day. Late game still long (Lv30 ≈ 215 h) |
| 2026-10-31 | Review council sized by complexity: 1 reviewer (small: docs, small UI fixes), 2 (normal), 3 (high risk: save, time, formulas, replay, CI); Sonnet, medium. `docs/STATUS.md` added as the "where we are" page (version, release notes, refined/unrefined roadmap), updated by every feature PR | Token cost again; and one page lets a fresh session pick up without the chat history |
| 2026-11-01 | **Crafting house (PR A, engine 1.13.0, save v13):** new building (Woodcutting + Mine Shaft, 30 Oak, 30 Stone, 150 g; east plot), Lv1–5 with the standard upgrade rules; craft time ×0.9 per level from Lv2, +10% / +20% normal-item yield at Lv4 / Lv5. 8 pipe slots, 2 open; pipes 3–4 later, 5–8 premium (no mechanic yet). 10 material recipes (planks, Stone Brick, Copper / Iron / Silver / Gold **Ingot**), inputs and time doubling per tier, sell = inputs' sell value. Insta (materials up front, quantity, x10 at start and cancel refunds: replaced by continuous pipes in engine 1.15.0, rows below) | First sink for gathered materials beyond buildings; feeds gear crafting (PR B) |
| 2026-11-01 | **INT's first effect:** −craft time on a diminishing curve, cap 50%, k 50 (`diminishing(value, cap, k) = cap × value ÷ (value + k)`, shared helper, data in `STAT_EFFECTS`). Several reductions multiply. **Smithing skill removed** (crafting has no skill); the v13 migration drops it | A use for INT; one curve for future attribute effects |
| 2026-11-01 | **UI rule:** every building modal shows its current level's bonuses under the header ("Lv1 · no bonus yet") | The player always sees what the building gives now |
| 2026-11-01 | Engineering choices for crafting (engineer, flagged): (1) Insta is **refused** (`INVENTORY_FULL`, no stamina spent) when the output would not fit, and while the pipe waits for room. (2) A cancel's stamina refund is **capped at max** (replaced in 1.15.0: Stop refunds no stamina; the v15 migration's refund is capped at max). (3) A cancel whose refund would not fit is refused (`INVENTORY_FULL`), so nothing is lost. (4) Same-instant order: hero → builder → crews → pipes (pipe order); held pipes retry at the start of each step and after every command. (5) The Crafting sign shows "2/2 crafting · 0:42" (busy / open pipes, shortest job left) or "Inventory full", and the upgrade timer when it upgrades. (6) START_CRAFT carries the stamina shown (`maxCost`, `COST_CHANGED`) | Nothing lost, no stamina exploit, deterministic |
| 2026-11-01 | **Gear quality and rarity (PR B, engine 1.14.0, save v14):** catalog `quality` renamed `rarity` (colour tier); new **quality**, an integer 0–100 (d101 rolls), on every gear instance (tools included), which also carries its own rarity. Catalog gear stats ×1.6 become the 100% max; effective = max(1, round(max × (100 + q) / 200)). Existing gear, starting gear and the starter stock: 25 / common (unchanged numbers). Merchant gear: quality 0–50, common 70 / uncommon 25 / rare 5. Mob drops later: 0–70 | Gives gathered materials their main use; gear upgrades become a long-term goal beyond the Merchant |
| 2026-11-01 | **Gear crafting:** 5 sets (Stone, Copper, Iron, Silver, Gold) × 6 pieces from tier-n bricks / ingots + planks; one piece per job; 0–50 stamina invested for +1% min quality each (not refunded, no effect on colour); quality and colour rolled at start, hidden until Done; uncommon 75 / rare 20 / epic 5; the piece waits in its pipe (`ready`) until Done; cancel refunds materials only while crafting, never on a ready piece; new pieces sell for 25% of their inputs | A crafting goal per tier; stamina has a use with a visible payoff; the reveal makes Done a moment |
| 2026-11-01 | **Gear prices follow rarity, not quality** (owner fix round on PR #22): buy and sell = floor(catalog price × rarity multiplier), common ×1, uncommon ×1.5, rare ×2, epic ×4 (legendary unused); Town Hall sell bonus after it; Merchant listing price = buy × the listing's multiplier, fixed at the roll. Replaces the quality-scaled prices (0.8× → 1.6×) and the "a gear piece sells for at least 1" rule. Invariants: every gear item at every rarity sells (+20%) below its buy price; for every gear recipe the **expected** sell value of its piece (rarity odds × multipliers × 1.2) is below its inputs. A single 5% epic can sell above its inputs: accepted (crafting to sell has a negative expected value) | Quality is about power, rarity about value; simple prices; no buy→sell loop |
| 2026-11-01 | Quality is an integer percent 0–100, rolled as a d101 (uniform integer, both ends included): crafting [floor, 100] with floor = min(100, stamina + minQuality), Merchant [0, 50], mob drops [0, 70]. Shown as "Quality 73%", no rounding (owner fix round on PR #22) | Readable numbers; no hidden fractions |
| 2026-11-01 | Engineering choices for gear (engineer, flagged): (1) the Merchant's gear rolls draw from their **own seeded stream** (main RNG XOR a salt) so drops, yields and combat don't shift; crafting rolls use the main stream (owner OK). (2) The selected Equipment card expands in place with the stepper, odds and Start. (3) The reveal popover has an Equip button | Determinism and replay unchanged |
| 2026-11-01 | **Continuous material pipes (engine 1.15.0, save v15):** a material job has no quantity and no mode; it crafts until Stop. Each craft takes its materials when it starts (its time is set then). Too few → the pipe **waits** ("Waiting for Oak Logs (1/2)"): no time passes, nothing is charged; it starts at the exact instant the materials arrive (gathering, crews, another pipe, a command). Pipes share the inventory, in pipe order at one instant, after hero → builder → crews. Replaces "all materials up front", the quantity picker and Max | Gathering feeds crafting by itself |
| 2026-11-01 | **×10 is a tap on the running craft** (not a start mode): 9× its materials now + max(1, ceil(9 × craft minutes)) stamina (cost unchanged) → 10× output in the same time, progress kept, yield and ledger as before; only that craft. Insta works on it. Not for gear, waiting or held pipes; greyed with the reason when short. Replaces "x10 mode at start" | One decision per craft, no big up-front bet |
| 2026-11-01 | **Stop replaces Cancel for material jobs:** refunds the craft in progress (a ×10 one's extra materials too), never the stamina spent; a waiting pipe just frees; a refund with no room is refused; confirmed in a dialog. Gear jobs keep Cancel. Replaces "cancel refunds every undelivered craft and unstarted x10 stamina" | Nothing lost, nothing to exploit |
| 2026-11-01 | **Recipes button** in the Crafting header: every recipe, even when all pipes are busy; Start goes into the first free open pipe, else greyed "All pipes busy". Away summary: one line per pipe and missing item ("Pipe 1 waited for Oak Logs"). Sign: "Waiting for materials" when every busy pipe waits | The player can plan while everything runs |
| 2026-11-01 | Engineering choices for continuous pipes (engineer, flagged): (1) **Migration v14 → v15:** the craft in progress keeps its inputs and progress (×10 if the job was x10); the materials of every unstarted craft go back into the stack (or a free slot, frozen item literals), else stay on the job as **prepaid** crafts (used before new materials, refunded by Stop) so nothing is lost; their up-front ×10 stamina comes back capped at max. (2) "Waited for" lines alone do not open the away summary (a waiting pipe would otherwise pop it after every short break). (3) STOP_CRAFT is materials-only and CANCEL_CRAFT gear-only (`INVALID_COMMAND` otherwise). (4) START_CRAFT without `pipe` = first free open pipe (`ALL_PIPES_BUSY`). (5) While a pipe waits, the world walk also stops at the hero's next event, so a log cut feeds it at that instant | Lossless, deterministic, split-invariant |

## Stamina projection (2026-10-27, search-only skip)

| | Value |
| --- | --- |
| Full bar | 100 = 50 skips of a fresh 1:50 Rat Cellar search (2 each) |
| Regen | +1 per 5 min = 12/h = 288/day |
| Empty → full | 8h20 |
| Runs without stamina | free: one Rat Cellar run per ~1:53 (1:50 search + ~3 s fight at DEX 10) ≈ 32/h, live or offline (8h cap ≈ 255 runs) |
| New hero, first session | Lv5 needs 49 Rat wins. A fight costs ~5 HP and a skip gives no regen, so **HP, not stamina, sets the pace**: skipping only at ≥ 10 HP reaches Lv5 after 50 straight wins in ~17 min (sim, 2026-10-27). Skipping at 0 HP burns 2 stamina per instant loss (the UI warns) |

## Backlog

Merged into the unrefined roadmap in [`STATUS.md`](STATUS.md).
