# Status

The "where we are" page. Read its top ("Current version") and the two "Roadmap" sections when starting a new session; the release notes only when needed. Owned by the product owner. **Every feature PR updates it**: version, release notes and the roadmap item it closes.

Details live elsewhere: product decisions and tables in [`PRODUCT.md`](PRODUCT.md), engine rules in [`ENGINE.md`](ENGINE.md), deferred review findings in [`TECH_DEBT.md`](TECH_DEBT.md), workflow in [`../AGENTS.md`](../AGENTS.md).

## Current version (2026-11-06)

| | `dev` (test preview) | `main` (approved) |
| --- | --- | --- |
| Engine | **1.23.0** | 1.1.0 |
| Save | **v21** | v2 |
| Contents | Everything below, up to the Crafting debug buttons (Force craft, Finish now), the compact Crafting recipe list and the Done reveal fix (UI only), gear rarity tiers and affixes (#36), on top of the first boss, the stats rework (#33) and the locked start (#32), plus the pixel art once merged | M1 only (PRs #1–#2) |

- **Release pending:** `main` is behind `dev` by PRs #3–#25. The owner releases with a PR `dev` → `main` after testing on the `dev` preview.
- **Open PRs:** Expo Go previews by label plus per-branch saves (`feat/expo-test-previews`).
- **Workflow:** product owner (orchestrator) → one `game-engineer` per feature → 1–3 reviewers by complexity (`.claude/skills/pr-review-council`) → owner merges.
- **Working modes:** desktop mode (owner at his PC: agents work in `.worktrees/` on his machine, the branch reaches GitHub via a bundle) or cloud mode (owner on his phone: the cloud clone). Same PR flow either way; see AGENTS.md.

## Release notes (`dev`)

Newest first. One entry per merged PR. Engine/save bumps are noted where they happened.

### Engine 1.23.0 · save v21 (unchanged)
- **Item grids switch popovers in one tap** (`feat/popover-switch`; owner-approved 2026-11-06; UI only, engine and save unchanged): while an item popover is open, tapping another item slot moves the popover onto it at once (no close, no fade wait); tapping the same item, empty space, the close button or Android back closes it. Covers Hero inventory + equipment, Crafting recipe tiles, Merchant Buy and Sell grids. `InfoPopover` / `ItemSheet` take `onOutsidePress`; `useSlotHitTest` + pure `hitSlot` (`slotHitTest.ts`, `tests/slotHitTest.test.ts`).
- **InfoPopover never invisible** (`fix/popover-invisible`; owner bug 2026-11-06; UI only, engine and save unchanged): the box was hidden (opacity 0) until onLayout, and a passive effect reset the height after commit, so a layout event delivered first (or an unchanged layout that never re-fires) left it hidden under a live full-screen backdrop. The measured height is now tagged with the presentation (anchor + visible) it belongs to (no reset effect), the box remounts per presentation, and a 150 ms safety timeout shows it anyway. Pure helpers in `ui/popoverLayout.ts`, tests `tests/popoverLayout.test.ts`.
- **Crafting debug buttons** (`feat/crafting-debug`; owner-approved 2026-11-06; dev tools only):
  - **Force craft (debug)** in the recipe popover (under Craft): starts the craft with no materials needed or taken. Material pipe: only the first craft is free (then it takes materials or waits as normal); gear: one free piece, rolled like a normal craft, invested stamina still paid. Enabled when materials are short; still greyed for "All pipes busy" and "Not enough stamina". Confirmation line "X started in Pipe N (debug)".
  - **Finish now (debug)** on running material and gear pipes: finishes the current craft free (one craft per tap on a material pipe; gear turns Ready), hold to repeat.
  - **Engine:** `DEBUG_FORCE_CRAFT`, `DEBUG_FINISH_CRAFT` (refused with `DEBUG_DISABLED` when debug is off; set `debugUsed`; logged and replayed). A forced craft carries an optional `free` flag on the job, so Stop / Cancel refund nothing for it (no material minting). No save change; goldens unchanged (version labels re-pinned).
  - **Tests:** `tests/craftingDebug.test.ts`.

### Engine 1.22.0 · save v21 (unchanged)
- **Compact Crafting recipe list and Done reveal fix** (`feat/crafting-compact`; owner-approved 2026-11-06; UI only, engine and save unchanged):
  - **Recipe list** (header Recipes and an idle pipe's "Craft…"): Materials | Equipment tabs, collapsed tier headers (all closed on open, any number open, remembered per tab), icon-only tiles the size of the Hero inventory slots (dimmed when materials are short, gold frame while a pipe crafts it). A tile opens an InfoPopover with the full craft info, the stamina stepper, quality floor, odds, Details and one **Craft** button (was Start).
  - **Flow:** an idle pipe's first Craft goes into that pipe, then the list behaves like Recipes (first free open pipe). After Craft the player stays on the list: "Iron Sword started in Pipe 2" and "Free pipes N/M". Back returns to the pipes.
  - **Fix:** Done sometimes showed no reveal popover. Cause: the UI guessed the new item id (`collectedItemId` on the screen's state) before COLLECT_CRAFT, but the dispatch first simulates up to now, which can move `nextItemSerial` (a boss gear drop in that span), so the guess named an item that did not exist. Also, a failed anchor measure skipped the reveal. Now the id comes from the CRAFT_COLLECTED event in the dispatch result (`DispatchResult.events`, client type only), the anchor falls back to the screen centre, and a reveal waits out the previous popover's dismiss animation.
  - **Tests:** `tests/collectReveal.test.ts`.

### Engine 1.22.0 · save v21
- **Gear rarity tiers and affixes** (`feat/gear-affixes`, stacked on #35; owner-approved 2026-11-05):
  - **Gear level** (`gearLevel` on every gear ItemDef): set pieces 5 x tier (Stone 5, Copper 10, Iron 15, Silver 20, Gold 25, tools included), starter / wooden gear 1, Steel 20. The existing Iron items are 15.
  - **Rarity multiplies the main stat** (damage min / max, armor, WS, MS): green x1.1, blue x1.25, purple x1.5, white x1. Effective = max(1, round_half_up(catalog max x (100 + quality) x ratio% / 20000)), one rounding, integers. Percents in `config/gear.ts`. Attack-interval mods are not scaled. Existing saves get it too (their rare / epic pieces get stronger).
  - **Attribute affixes** (blue 1, purple 2 different of STR / DEX / END / INT; max = gear level, purple floor(1.5 x level) each; value = max(1, floor(max x quality / 100))), stored on the item instance as the picks only. They are plain points from equipment (count in the total, never core), computed in the attribute selectors and not written to `character.attributes`.
  - **Perks** (purple only, one per piece): combat gear rolls max damage, max armor, HP regen or mana regen (equal odds); an axe rolls woodcutting strength, a pickaxe mining strength. Value = max(1, floor(gear level x quality / 100)) percent. Same-kind perks add across equipped pieces, then each kind is applied once, half up, as the last multiplier after everything including core. No stacking cap for now.
  - **Rolling** from salted sub-streams (crafting at job start, hidden until Done; Merchant gear listings; the boss gear drop). The main RNG stream is untouched, so every stage fight and drop sequence is what it was.
  - **Save v21:** every existing rare / epic gear instance (inventory, equipment, Merchant stock, crafting jobs with a rolled result) gets affixes rolled deterministically from a salted stream of the state's seed, without advancing the main RNG. Frozen v20 fixture test.
  - **Fix:** `ALL_SLOTS_ORDER` (stats breakdown order) now includes `pickaxe` (derived from `EQUIPMENT_SLOTS`) with a coverage test.
  - **UI:** item popovers (Hero tab, Merchant, Done reveal, boss reveal) list "Bonus +4 END" and "Perk +5% max damage" under the main stat; the Status panel counts gear attribute points as plain points (the breakdown names "Gear") and shows "Gear perks: +10% max damage"; the Woodcutting / Mine headers add the gear perk to the WS / MS sum. The Crafting house gear recipes (Equipment list and the per-pipe Craft list) have a **Details** button: a Green | Blue | Purple toggle with the chance, the main stat range at quality 0 to 100, the attribute bonus range and the perk range, all from the engine selector.
  - **Prices unchanged.**
  - **Golden hashes:** `hashState` includes `saveVersion` and the new fields, so whole-state hashes of fresh games moved; goldens keep their outcome pins (RNG seeds, gold, HP) and gained a v20-shape check; two pins that carry a rare weapon moved by its +INT affix (mana only). See the test comments.
  - **Tests:** `tests/gearAffixes.test.ts` (formulas, odds, perks, streams, crews, ALL_SLOTS_ORDER, recipe details), `tests/migrationV20.test.ts` (frozen `tests/fixtures/save-v20.json`), gated `tests/balanceSimRarity.test.ts` (report only).

### Engine 1.21.0 · save v20 (unchanged)
- **Equipment tabs, Legs slot, tool recipes** (`feat/equipment-tabs`):
  - **Hero tab:** the Equipment panel has **Combat** and **Tools** tabs. Combat paper doll (3 x 4): (empty), helmet, amulet / weapon, torso, shield / ring, legs, ring / gloves, boots, (empty); the `armor` slot is labelled "Torso". Tools: axe, pickaxe.
  - **Legs slot** (`legs`): greaves equip there and count toward armor. `EquipmentSlot` / `EQUIPMENT_SLOTS` / stats `SLOT_ORDER` gain it. Equipment is a partial record, so **no save change**.
  - **15 new recipes** in the Crafting house (Equipment tab, grouped by tier: Sword, Helm, Chestplate, Shield, Greaves, Gloves, Boots, Axe, Pickaxe): Greaves (armor 2 / 5 / 8 / 13 / 20; 4 bars + 2 planks; 5 min), Axe (WS 8 / 24 / 64 / 128 / 256) and Pickaxe (MS, same numbers) (3 bars + 2 planks; 3 min); times double per tier. The Iron axe / pickaxe recipes make the existing `iron_axe` / `iron_pickaxe`. New pieces are not sold by the Merchant; sell price 25% of the inputs.
  - **Art (pending owner approval):** 5 greaves, 4 axes and 4 pickaxes (Stone / Copper / Silver / Gold) generated by `tools/art`.
  - **Tests:** `tests/legsAndTools.test.ts`; recipe / catalog counts updated.

### Engine 1.20.0 · save v20
- **First boss: the Troll Chieftain** (`feat/first-boss`):
  - **Tier 1 and the boss row:** the five dungeons are Tier 1, stages 1-5 (ids unchanged); the list shows a "Tier 1" header, "Stage n · name" rows, then "Boss · Troll Chieftain". It opens permanently at **50 Troll Bridge wins** (locked row "Troll Bridge wins 12/50"; the engine refuses it with `BOSS_LOCKED`). Lifetime boss fights, wins and losses are counted.
  - **Entry:** `ENTER_BOSS` costs **10 stamina up front, never refunded** (bound to the cost shown, `COST_CHANGED`), for one live fight: no search, no repeat, the hero is idle after it. Typed errors for not enough stamina, 0 HP, a locked boss and a fight already on; a confirmation says "10 stamina, not refunded if you lose or flee" and warns below half HP. Entering stops gathering / training or cancels a search; fleeing is a forfeit loss. Supersedes the 2026-10-26 "stamina buys time, never access" principle.
  - **The fight** (same live and offline path as a stage fight): the Chieftain (HP 1,000, damage 26-36, armor 40, magic resist 40) **regenerates 0.5% of max HP a second**, casts **Heavy Bash** (1.4x damage, 35% to stun you for 3 strikes; on his strikes 3, 10, 17...) and the fight lasts up to **120 s**. A stun makes you lose your next 3 strikes (logged as stunned, no RNG); cooldown 7 > stun 3 so it can never lock you. The skill and regen are generic data (`config/skills.ts`, `EnemyDef.regenBpPerSec / maxFightMs / skills`).
  - **Rewards (win):** 2,000 hero XP, 300-450 gold, 35% one Iron-set piece (green 75 / blue 25, quality 0-70), 50% **Chieftain's Tusk** (blue, stackable, not sellable, for later crafting). A full inventory loses the drop ("Lost: ... (inventory full)"). A gear drop opens a reveal popover with Equip.
  - **UI:** boss detail (stats, abilities, regen, 120 s limit, danger hint that counts Bash, regen and the limit, rewards and odds, kill counter, "Enter · 10" greyed with the reason); live fight and replay show the boss HP with its regen, "Heavy Bash!" lines, a stunned notice with the strikes left and the stunned strikes in the log; the activity strip and the away summary have a boss line; the unlock banner names the boss. **Art is a placeholder** (stone troll variant, troll hide icon): real art pending owner approval.
  - **Save v20:** `dungeon.bosses`; the fight in progress gets the regen / skill / stun fields. A v19 fight plays on unchanged (frozen v19 fixture test).
  - **Tests:** `tests/firstBoss.test.ts` (entry rules, Bash timing, 1.4x, stun and no stun-lock, regen, limits, rewards, full inventory, golden Bash + stun fight, offline = live, split invariance, properties, migration, replay). Stage fights draw the RNG exactly as before: every older golden keeps its outcome pins (only whole-state hashes moved, shown in the v19 shape by `asV19`).
  - **Balance (owner decision 2026-11-05: keep as is):** unlock stays 50 Troll Bridge wins only, no level requirement, stats unchanged. The boss is a wall the player grows into: roughly 0% around level 17; the STR+END hero at level 20 in an Iron set wins 42% at quality 25 and 73% at quality 50; heroes with all points in one attribute can not win at levels 17-23. The danger hint is expected to show Deadly until roughly level 20. Table: ENGINE.md "Bosses and combat skills".

### Engine 1.19.0 · save v19
- **Stats rework** (`feat/stats-rework`, stacked on the locked start):
  - **Attribute roles:** STR physical damage, DEX crits, END toughness, INT magic. Plain (total) points give flat stats; core (training) points a capped percent multiplier on the final value (`diminishingBp`, k 50). Table in PRODUCT.md "Attributes".
  - **STR:** +1 damage per point; core up to +50% physical damage. **DEX:** plain = crit damage (1.5x + 0.01x per point); core = crit chance up to 40% (and the activity-time cut, unchanged). **END:** per point +5 max HP, +0.2 HP/min, +1 armor; core = armor and magic resist up to +50%. **INT:** per point +1 magic damage, +1 magic resist, +5 max mana, +0.2 mana/min; core = magic damage up to +50% (and the craft-time cut, unchanged).
  - **Combat:** every hero strike draws one crit check (even at 0%); a crit multiplies the physical roll, armor reduces it; the magic part is reduced by the enemy's magic resist and never crits; a strike deals at least 1. Enemies have magic resist equal to their armor and still hit physically only. "Defense" is now **Armor** (engine names too).
  - **Regen:** exact fractional rates (0.2 per point); the stored remainders change units.
  - **UI:** the Status panel lists plain and core effects with numbers and shows magic damage, armor, magic resist, crit chance and crit damage; the replay shows "Crit!" with a gold number; the dungeon danger hint counts the expected crit and the magic part.
  - Save v19: regen remainders x100, the fight in progress and the last fight get the new fields (no crit, no magic). Nobody loses anything.
  - Tests: unit tests for every formula, combat goldens re-pinned (the extra crit draw shifts the RNG stream of every fight), property tests, split invariance at 0.2 rates, a v18 fixture migration test, and a whole-game golden from a plain `newGame` (`tests/golden119.test.ts`). The old goldens no longer mutate `DUNGEONS` (TECH_DEBT item closed).
  - Balance check (report only, no tuning): in the PR. Main findings: core in all four attributes is a big power jump; STR and INT are equivalent per point; DEX is dead in a fight until core is trained; END gives the most survivability.

### Engine 1.18.0 · save v18
- **Locked start** (`feat/locked-start`):
  - **Build the village first:** a new game has **500 gold** (was 25) and **every building unbuilt**, the Merchant and Storage included. Only the Dungeon is open. Each locked sign is greyed with a padlock and opens its Build sheet.
  - **Merchant and Storage need Town Hall Lv1 + 100 gold + 10 Oak Logs + 10 Stone.** Until the Merchant is built there is no buying, selling or refreshing (`BUILDING_LOCKED`) and its refresh charges don't tick; the starter stock waits and is what you find when you build it.
  - **Storage is a building now** (sprite drawn once built, "Storage: coming soon" on tap) with no function and no upgrades.
  - **Every dungeon search is 2:00** at core DEX 0 (was 2 / 3 / 5 / 8 / 12 min); core DEX still shortens it, floor 1:00.
  - Save v18: existing saves keep their Merchant built (level, stock, timers) and their gold; Storage starts unbuilt.

### UI only (engine 1.17.0) · Hero tab without the HUD, signs scale with the map
- **Hero tab no longer has the HUD** (`fix/village-hud-signs`): nothing covers the top of the Hero tab any more; the Header panel shows "Level N" and XP, Status the bars and the points to spend. The HUD stays on the Village tab.
- **Village signs scale with the map:** zooming out shrinks them with the buildings (drawn in screen space and re-laid out when a pinch ends, so the pixel font stays crisp) (label 14 pt at the start zoom on a 375 pt phone, tap area 48 pt). The timer badge under it scales too.
- **Every sign sits under its building:** centred, its top edge on the building's bottom edge (one rule, `signAnchor`; Woodcutting and Town Hall nudged 8 px each way, Mine 2 px so they do not overlap). The start view is re-centred on buildings plus signs. `village_layout.json` `sign` fields are no longer read (left in the generator output).

### UI only (engine 1.17.0, save v17) · workers on the gathering cards
- **Assign workers where they work** (`feat/workers-on-nodes`): each tree (Woodcutting) and rock (Mine Shaft) card has [−] / [+] next to its crew line: [+] puts one free worker on it, [−] takes one off (back to unassigned). A "Workers: X free / Y hired" line sits above the cards; with no free worker [+] is off and says "No free workers · hire at Town Hall"; a node you can't work yet shows no controls (its own "Needs …" line explains; with workers still on it, [−] stays). Hidden until the Town Hall is built and a worker hired. Hiring, dismissing and the Town Hall's own assign UI are unchanged; no engine or save change.

### Tooling only (engine 1.17.0, save v17) · Expo test previews
- **Try a PR in Expo Go before merging** (`feat/expo-test-previews`): add the label `expo-test` to a PR and the workflow `expo-preview.yml` publishes it on an EAS branch named like the git branch, with one comment (link + QR code) edited on every push. Removing the label or closing / merging the PR deletes the preview. PRs from `main` / `dev` are refused.
- **Per-branch saves:** `main` keeps `idle-game.db`; `dev` now uses `idle-game-dev.db`, copied once from `idle-game.db` on its first launch; each preview starts fresh in `idle-game-<branch>.db`. Hero tab → Debug shows the slot and the build label. Local `npx expo start` = `main`.
- **Per-build app name:** Expo Go's "Recently opened" shows "Idle Game" (main), "Idle Game · dev" and "Idle Game · <branch>" (previews), from a new `app.config.ts` that only overrides `name`. The preview comment now gives the steps for phones (copy the `exp://` link, paste into Safari, Open in Expo Go) because GitHub does not open it on tap.

### Docs only (engine 1.17.0) · agent context diet
- **Agent context diet + desktop mode** (`chore/agent-context-diet`): `AGENTS.md` cut from ~20k to ~8k bytes and auto-loaded via the new `CLAUDE.md`; layout, selectors, navigation and village-map detail moved to the new [`CODEMAP.md`](CODEMAP.md). `ENGINE.md` and `PRODUCT.md` get Contents tables, and the agents read only the sections a task needs. New desktop working mode (agents work on the owner's PC); `.gitattributes` added.

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

0. **Boss tuning: decided 2026-11-05, keep as is** (see PRODUCT.md decision log). Still open: real art for the Chieftain and the Tusk.
1. **Enemy tier check after the stats rework:** the 1.19.0 balance sim (PR for `feat/stats-rework`) shows the Skeleton falls at core 10 from Lv1 and the Troll at core 20 even at Lv1/Lv5, where 1.18 needed Lv10-15. Decide the targets, then retune enemy HP / damage / armor (and the core curves) where a tier is off. Earlier note: since 1.17.0 a level gives 5 points to spend instead of +5 on every attribute (20 per level), so level growth drops a lot and the 1.16.0 "dungeons are easy" concern may be gone. Sim each tier with typical builds (all STR/END, mixed) and only retune enemy HP / damage / armor where a tier is now off its target effort. (Normal STR counting toward WS / MS was decided: yes, 1.17.0.)
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
- **Gear perk stacking:** no cap for now (purple Gold pieces up to +25% each); revisit with balance.

**Buildings and economy**
- Future buildings go on the empty map plots (west of the barn, two south of the river; the east plot holds the Crafting house since 1.13.0).
- Town Hall Lv3–5 passive bonuses (the data shape is ready).
- Storage is a buildable building since 1.18.0 but its function (capacity, a stash) is still "coming soon". Dungeon and Storage stay non-upgradable for now (owner decision 2026-10-28); revisit only if they get a bonus.
- Cancelling an upgrade, and a second builder.
- Offline cap upgrade (8h → more), and a stamina max upgrade.
- Bulk selling of logs and ore.
- Crafting pipes 3–4: an unlock mechanic (play-based).
- Crafting pipes 5–8: a premium purchase.

**Combat and dungeons**
- Multi-enemy runs (needs a save-shape change: `ActiveFight` holds one enemy). The first boss shipped in 1.20.0; Tier 2 and its boss, boss recipes for the Chieftain's Tusk, bad-luck protection and auto-repeat for bosses are not built.
- **Enemies with magic damage (gives magic resist a use).** Enemies have magic resist since 1.19.0 but only hit physically.
- Hit chance (crits shipped in 1.19.0); a combat use for mana.
- Attack-speed gear (the `attackIntervalModMs` hook exists, unused).
- Unlock rules beyond wins (e.g. hero level).

**Hero**
- **Stat respec (refunds):** points are permanent since 1.17.0; a paid or limited respec needs owner rules (cost, cooldown).
- **Mana consumers (skills/spells):** mana regenerates since 1.17.0 but nothing spends it.

**Items**
- Gear drops from normal mobs (quality 0–70; the first boss uses the constant since 1.20.0).
- Minimum-quality mechanics (the `minQuality` hook is 0: upgrades, skills or consumables could raise it).

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
