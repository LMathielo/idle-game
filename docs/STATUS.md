# Status

The "where we are" page. Read it first when starting a new session. Owned by the product owner. **Every feature PR updates it**: version, release notes and the roadmap item it closes.

Details live elsewhere: product decisions and tables in [`PRODUCT.md`](PRODUCT.md), engine rules in [`ENGINE.md`](ENGINE.md), deferred review findings in [`TECH_DEBT.md`](TECH_DEBT.md), workflow in [`../AGENTS.md`](../AGENTS.md).

## Current version (2026-11-04)

| | `dev` (test preview) | `main` (approved) |
| --- | --- | --- |
| Engine | **1.17.0** (unchanged by the pixel art, a UI-only change) | 1.1.0 |
| Save | **v17** | v2 |
| Contents | Everything below, up to stat points + HUD (#25), plus the pixel art once merged | M1 only (PRs #1–#2) |

- **Release pending:** `main` is behind `dev` by PRs #3–#25. The owner releases with a PR `dev` → `main` after testing on the `dev` preview.
- **Open PRs:** Expo Go previews by label plus per-branch saves (`feat/expo-test-previews`).
- **Workflow:** product owner (orchestrator) → one `game-engineer` per feature → 1–3 reviewers by complexity (`.claude/skills/pr-review-council`) → owner merges.

## Release notes (`dev`)

Newest first. One entry per merged PR. Engine/save bumps are noted where they happened.

### Tooling only (engine 1.17.0, save v17) · Expo test previews
- **Try a PR in Expo Go before merging** (`feat/expo-test-previews`): add the label `expo-test` to a PR and the workflow `expo-preview.yml` publishes it on an EAS branch named like the git branch, with one comment (link + QR code) edited on every push. Removing the label or closing / merging the PR deletes the preview. PRs from `main` / `dev` are refused.
- **Per-branch saves:** `main` keeps `idle-game.db`; `dev` now uses `idle-game-dev.db`, copied once from `idle-game.db` on its first launch; each preview starts fresh in `idle-game-<branch>.db`. Hero tab → Debug shows the slot. Local `npx expo start` = `main`.

### UI only (engine 1.17.0) · pixel art
- **Pixel art replaces every emoji** (`feat/pixel-art-assets`):
  - **Village:** the approved daytime village, drawn as a background plus one sprite per building. A building that isn't built yet isn't drawn; its sign stays, greyed with a padlock. Signs are text only, at their new spots; the map opens a little further out so every sign fits.
  - **Art everywhere:** hero portrait (HUD, dungeon), enemy sprites (dungeon cards, live fight), all 70 items (inventory, merchant, popovers), trees and rocks, skill icons, and pixel symbols for gold, stamina, XP, locked, upgrade, crafting, workers and more.
  - **No emoji in any text:** titles, activity strip, away summary, timer pills, sheets and buttons show a pixel image next to the words, or just the words. ✕ ✓ ✗ stay as text.
  - **Asset pipeline:** `tools/art` (Python) rebuilds every image into `assets/images/`; the old village script and image are gone. A test fails when an item, enemy, tree, rock or skill has no art, and another when an emoji appears in `src/`.

### Engine 1.17.0 · save v17
- **Stat points, mana, hero HUD** (`feat/stat-points-hud`):
  - **Points to spend:** every level-up gives 5 points (no more automatic +5 on each attribute). Hero tab → Status: + / − per attribute, Reset, Confirm ("Points can't be refunded"). A "+N" badge on the HUD portrait and the Hero tab while points wait.
  - **STR → woodcutting / mining strength**, 1:1 on total STR (was core only); workers follow.
  - **Mana** regenerates: 5 + total INT per minute, everywhere HP does. Nothing uses it yet.
  - **HUD** top-left on Village and Hero: portrait + level, HP / mana / stamina / XP (xx.yy%) bars; tap on Village → Hero. Old Village top bar gone; gold moved to the Inventory header.
  - Save v17: 5 × (level − 1) points to spend, mana full; extra points and training kept.

### Engine 1.16.0 · save v16
- **#24 Core and normal stats** (`feat/core-stats`):
  - **Two kinds of points:** each attribute = **normal** (+5 per hero level above 1 on every attribute, plus extra points: debug now, gear later) + **core** (the Training level; Training is the only source). The Hero tab shows the total ("DEX 120"); tapping it shows "110 DEX + 10 core DEX" and what each part does.
  - **A new hero starts at 0** everywhere; the old starting 10 moved into the hero's base numbers (damage +10, defense +10, HP regen 15/min, WS / MS +10), so a new hero fights and gathers like before.
  - **Totals** give STR +1 damage, END +1 defense and +1 HP/min. **Core points only:** DEX shortens dungeon searches, cuts and ores on the diminishing curve (core 10 → −8.3%, 50 → −25%, never 50%; replaces −1 s per DEX; a new hero's searches and cuts take 2:00), INT shortens crafting, STR adds to WS / MS. Workers unchanged.
  - Save v16: stored attributes keep only what was added on top of 10; training levels become core; level points apply at once.

### Engine 1.15.0 · save v15
- **#23 Crafting: continuous material pipes** (`feat/crafting-continuous`):
  - **Start = pick a recipe, Start.** No quantity, no Max, no x10 mode. A material pipe crafts until **Stop**; each craft takes its materials when it starts and shows "Crafted 37", time left and xx.yy%.
  - **Waiting:** out of materials, the pipe shows "Waiting for Oak Logs (1/2)", no time passes, and it starts again the instant logs arrive (woodcutting, workers, another pipe, a buy). Pipes share materials, in pipe order. Sign: "Waiting for materials" when every busy pipe waits; the away summary lists "Pipe 1 waited for Oak Logs".
  - **×10 is a tap** on the running craft (18 more logs + the same stamina cost → 10× output, that craft only). **Stop** refunds the craft in progress. Gear jobs unchanged.
  - **Recipes** button in the Crafting header: every recipe even when all pipes are busy; Start goes into the first free pipe ("All pipes busy" otherwise).
  - Save v15: running jobs become continuous; materials of crafts not yet started (and their ×10 stamina) come back, nothing lost.

### Engine 1.14.0 · save v14
- **#22 Crafting PR B — gear crafting, item quality and rarity:**
  - **Rarity and quality:** every piece of gear (tools too) has a colour (white / green / blue / purple) and a quality 0–100 (a d101) that scales its stats (50% → 100% of the max). Prices follow the colour: ×1 / ×1.5 / ×2 / ×4. Existing gear is "White · Quality 25%" with unchanged numbers.
  - **Merchant:** gear listings roll quality 0–50 and white 70 / green 25 / blue 5, priced by colour; Buy, Sell and popovers show colour and quality.
  - **Equipment tab:** Stone, Copper, Iron, Silver and Gold sets (sword, helm, chestplate, shield, gloves, boots) from bricks / ingots and planks; one piece per job; 0–50 stamina for +1 minimum quality each (not refunded); green 75 / blue 20 / purple 5. The piece waits in its pipe ("✓ Ready — Done") until **Done** reveals it.

### Engine 1.13.0 · save v13
- **#21 Crafting PR A — Crafting house, pipes, materials:**
  - **Crafting house** on the east plot (Woodcutting + Mine Shaft, 30 Oak, 30 Stone, 150 g), Lv1–5: −10% craft time per level from Lv2 (×0.9 each), +10% / +20% crafted yield at Lv4 / Lv5.
  - **Pipes:** 2 of 8 open, running side by side beside the hero, live and offline. Planks, Stone Bricks and Copper / Iron / Silver / Gold Ingots from logs and ore; x10 mode for stamina, Insta, Cancel with refunds; a full inventory holds a pipe until there is room.
  - **INT** shortens crafting (diminishing, cap 50%); **Smithing** removed. Every building modal shows its current bonuses under the header.

### Docs only (engine 1.12.0)
- **#20 Tech debt list:** new [`TECH_DEBT.md`](TECH_DEBT.md) gathers every below-bar review finding from PRs #2–#19; the review council now appends to it each round.

### Engine 1.12.0 · save v12
- **#19 UI kit, village map, skill XP rebalance:**
  - **GameDialog** replaces every native alert; **InfoPopover** (a box next to what you tapped, actions inside) replaces the item, build and upgrade sheets and the stat / locked-dungeon / tree / rock info; **hold-to-repeat** on stamina skips, training speed-ups and debug buttons.
  - **Village map:** a bigger world (360×560) you can drag and pinch-zoom; signs keep their size; 4 empty plots for future buildings.
  - **Skill XP:** base 500 → 100 with steeper segments from Lv15: woodcutting/mining Lv15 in ~23 h (was ~117 h). Save v12 keeps each skill's total XP and recomputes its level (testers jump levels).

### Engine 1.11.0 · save v11
- **#17 Training Grounds upgrades:** upgradable to Lv5 (Town Hall cap, half the Town Hall's cost). Each level gives +1 training XP/min (Lv5 = 5/min), including the stamina speed-up.

### Engine 1.10.0 · save v11
- **#16 Town Hall, upgrades, workers:**
  - **Upgrades:** all buildings upgrade to Lv5 (never above the Town Hall), with one builder on a timer that doesn't block the hero.
  - **Bonuses:** Town Hall Lv2 gives +20% wood/stone/ore and +20% sell price. Woodcutting and the Mine Shaft give +20% per level, and the Merchant +2 stock slots per level.
  - **Workers:** each has 25% of the hero's power, and hire cost doubles each time (100g, 200g, …). Up to 5/7/9/12/15 workers by Town Hall level. Upkeep is 1/5/15/40/100g per worker per minute by tier, and all workers pause when gold runs out.
  - **Power-based yield:** items per action = power ÷ requirement, with the fraction as a chance of one more. Oak and Stone now need 20.
  - **Merchant:** random stock from a 12-item pool, including the new iron armor set, a Greater Potion and steel tools and sword.

### Engine 1.9.0 · save v10
- **#15 Buildings, Mine Shaft, Town Hall:**
  - **Locked buildings:** Woodcutting, the Mine Shaft, the Town Hall and the Training Grounds start locked and are built with gold, level and materials.
  - **Mining:** mirrors woodcutting with 5 rocks, a pickaxe slot and a Geode drop.
  - **Offline cap:** a fight in progress at the 8h cap now finishes.

### UI only (engine 1.8.0)
- **#14 Readability:** Pixelify Sans Bold for titles, Inter for body text. The away screen shows the total time away, and shows the cap note only past 8h.

### Engine 1.8.0 · save v9
- **#13 Live combat and rebalance:**
  - **Live fights:** a search phase (2/3/5/8/12 min) is followed by a live fight on per-side attack timers, with a 60s limit.
  - **Stamina and fleeing:** stamina skips the search only, and fleeing a fight counts as a loss.
  - **XP:** the hero XP curve is about 15× cheaper and a Rat gives 35 XP, so Lv5 takes about 49 Rat wins.

### Engine 1.7.0 · save v8
- **#12 Merchant and items:** Buy/Sell tabs, refresh charges, item qualities and colors, an item sheet (Equip/Use/Unequip) and potions. Woodcutting stops if an equipment change drops woodcutting strength below the tree's requirement.

### Earlier (engine 1.2.0–1.6.0)
- **#11 Woodcutting:** 5 trees, woodcutting strength and the axe slot, plus a stamina speed-up for Training.
- **#9 Training:** gold-unlocked tiers and timed attribute training.
- **#8 Dungeon tiers 1–5:** win-based unlocks and replay anchors.
- **#6 Dungeon:** Rat Cellar, combat, HP and auto-repeat.
- **#5 Attributes:** derived stats and stamina.
- **#7 UI fixes:** village signs and the modal safe area.
- **Workflow and release setup:** #10 review sizing, #4 the dev branch flow, #3 branch safety.

### `main`: M1 (engine 1.1.0 · save v2)
- **#2 Core engine:** deterministic engine, time rules, local SQLite save and action log, woodcutting idle loop.
- **#1 Agent workflow setup.**

## Roadmap: refined

Decided and scoped; ready to brief to an engineer. Top = next.

1. **Enemy tier check after stat points:** since 1.17.0 a level gives 5 points to spend instead of +5 on every attribute (20 per level), so level growth drops a lot and the 1.16.0 "dungeons are easy" concern may be gone. Sim each tier with typical builds (all STR/END, mixed) and only retune enemy HP / damage / defense where a tier is now off its target effort. (Normal STR counting toward WS / MS was decided: yes, 1.17.0.)
2. **Release `dev` → `main`.** Owner action after testing the `dev` preview.
3. **Gathering refactor (before any third gathering skill).** A shared gathering core (`GatheringDef` keyed by skill: one generic start, advance, skip and view) while keeping per-skill configs separate. Shared parity tests via `describe.each([woodcutting, mining])`. Agreed in the PR #15 review.
4. **Cleanup PR** working through [`TECH_DEBT.md`](TECH_DEBT.md) (review findings below the fix bar, from PRs #2–#19).

## Roadmap: unrefined

Ideas and open questions. Each needs owner decisions before it can be briefed.

**Balance**
- **Skill XP after Lv15** (1.12.0): Lv20 ≈ 50 h, Lv30 ≈ 215 h on the Oak → Birch path; Maple and gear make it faster. Watch whether the late curve feels right.
- **Early-game HP pace:** Lv5 takes about 17 min, limited by HP (each fight costs about 5 HP and skips give no regen). Options: more starting HP, faster regen, or cheaper potions.
- **New long-term targets:** the old "Lv20 in about 2 days" target is obsolete since the 1.8.0 XP curve.
- **Mid-game walls:** Wolf Den needs about Lv6–7, and training is the bottleneck for tiers 4–5 (Crypt/Troll).
- **Worker upkeep:** it is expensive early (1g/min per worker against about 2g/min from dungeons). Watch how it feels.

**Buildings and economy**
- Future buildings go on the empty map plots (west of the barn, two south of the river; the east plot holds the Crafting house since 1.13.0).
- Town Hall Lv3–5 passive bonuses (the data shape is ready).
- Storage itself (capacity, a stash) is still "coming soon". Dungeon and Storage stay non-upgradable for now (owner decision 2026-10-28); revisit only if they get a bonus.
- Cancelling an upgrade, and a second builder.
- Offline cap upgrade (8h → more), and a stamina max upgrade.
- Bulk selling of logs and ore.
- Crafting pipes 3–4: an unlock mechanic (play-based).
- Crafting pipes 5–8: a premium purchase.

**Combat and dungeons**
- Multi-enemy runs and bosses (needs a save-shape change: `ActiveFight` holds one enemy).
- Hit chance and crits from DEX; a combat use for INT and mana (INT already shortens crafting).
- Core STR / END special mechanics (neither has a core-only effect since 1.17.0: STR's gathering power reads the total).
- Attack-speed gear (the `attackIntervalModMs` hook exists, unused).
- Unlock rules beyond wins (e.g. hero level).

**Hero**
- **Stat respec (refunds):** points are permanent since 1.17.0; a paid or limited respec needs owner rules (cost, cooldown).
- **Mana consumers (skills/spells):** mana regenerates since 1.17.0 but nothing spends it.

**Items**
- Tool recipes (axes and pickaxes) in the Crafting house.
- Mob gear drops (quality 0–70; the config constant exists, unused).
- Stat jumps between rarity tiers (today rarity is colour only; quality alone scales stats).
- Minimum-quality mechanics (the `minQuality` hook is 0: upgrades, skills or consumables could raise it).
- Random affixes stored on item instances.
- Sources of normal stats beyond levelling (gear affixes).

**Gathering**
- Fishing or a third gathering skill (after the gathering refactor).

**Platform and server**
- Server with `RemoteGameClient`: server-validated commands, action-log sync and server-owned time (closes the clock-forward offline farm).
- Action-log retention after sync (delete synced rows older than 30 days).
- Ordered SQL schema migrations keyed on `meta.schema_version`.
- Big-number support for XP past about Lv150.
- Arena/PvP and prestige/rebirth (needs the server).
- Per-PR Expo previews (not now).
- 320pt-wide screens: not supported (owner decision 2026-10-28).
