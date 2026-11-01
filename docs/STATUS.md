# Status

The "where we are" page. Read it first when starting a new session. Owned by the product owner. **Every feature PR updates it**: version, release notes and the roadmap item it closes.

Details live elsewhere: product decisions and tables in [`PRODUCT.md`](PRODUCT.md), engine rules in [`ENGINE.md`](ENGINE.md), deferred review findings in [`TECH_DEBT.md`](TECH_DEBT.md), workflow in [`../AGENTS.md`](../AGENTS.md).

## Current version (2026-11-01)

| | `dev` (test preview) | `main` (approved) |
| --- | --- | --- |
| Engine | **1.14.0** (PR B, stacked on #21) | 1.1.0 |
| Save | **v14** (PR B) | v2 |
| Contents | Everything below, up to PR #20, plus Crafting PR A (#21) and PR B once merged | M1 only (PRs #1–#2) |

- **Release pending:** `main` is 17 PRs behind `dev` (#3–#19). The owner releases with a PR `dev` → `main` after testing on the `dev` preview.
- **Open PRs:** #21 Crafting PR A (`feat/crafting`); Crafting PR B (`feat/crafting-gear`, stacked on #21: merge #21 first).
- **Workflow:** product owner (orchestrator) → one `game-engineer` per feature → 1–3 reviewers by complexity (`.claude/skills/pr-review-council`) → owner merges.

## Release notes (`dev`)

Newest first. One entry per merged PR. Engine/save bumps are noted where they happened.

### Engine 1.14.0 · save v14
- **Crafting PR B — gear crafting, item quality and rarity:**
  - **Rarity and quality:** every piece of gear (tools too) has a colour (white / green / blue / purple) and a quality 0–100% that scales its stats (50% → 100% of the max) and prices (0.8× → 1.6×). Existing gear is "White · Quality 25%" with unchanged numbers.
  - **Merchant:** gear listings roll 0–50% quality and white 70 / green 25 / blue 5; Buy, Sell and popovers show colour and quality.
  - **Equipment tab:** Stone, Copper, Iron, Silver and Gold sets (sword, helm, chestplate, shield, gloves, boots) from bricks / ingots and planks; one piece per job; 0–50 stamina for +1% minimum quality each (not refunded); green 75 / blue 20 / purple 5. The piece waits in its pipe ("✓ Ready — Done") until **Done** reveals it.

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

1. **Release `dev` → `main`.** Owner action after testing the `dev` preview.
2. **Gathering refactor (before any third gathering skill).** A shared gathering core (`GatheringDef` keyed by skill: one generic start, advance, skip and view) while keeping per-skill configs separate. Shared parity tests via `describe.each([woodcutting, mining])`. Agreed in the PR #15 review.
3. **Cleanup PR** working through [`TECH_DEBT.md`](TECH_DEBT.md) (review findings below the fix bar, from PRs #2–#19).

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
- Small rebalance PR: move DEX's −1 s per point (dungeon search, gathering) onto the shared diminishing helper (`diminishingBp`, `STAT_EFFECTS`).

**Combat and dungeons**
- Multi-enemy runs and bosses (needs a save-shape change: `ActiveFight` holds one enemy).
- Hit chance and crits from DEX; a combat use for INT and mana (INT already shortens crafting).
- Attack-speed gear (the `attackIntervalModMs` hook exists, unused).
- Unlock rules beyond wins (e.g. hero level).

**Items**
- Tool recipes (axes and pickaxes) in the Crafting house.
- Mob gear drops (quality 0–70%; the config constant exists, unused).
- Stat jumps between rarity tiers (today rarity is colour only; quality alone scales stats).
- Minimum-quality mechanics (the `minQualityBp` hook is 0: upgrades, skills or consumables could raise it).
- Random affixes stored on item instances.
- Pixel sprites replacing emoji icons.

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
