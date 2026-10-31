# Status

The "where we are" page. Read it first when starting a new session. Owned by the product owner. **Every feature PR updates it**: version, release notes and the roadmap item it closes.

Details live elsewhere: product decisions and tables in [`PRODUCT.md`](PRODUCT.md), engine rules in [`ENGINE.md`](ENGINE.md), workflow in [`../AGENTS.md`](../AGENTS.md).

## Current version (2026-10-31)

| | `dev` (test preview) | `main` (approved) |
| --- | --- | --- |
| Engine | **1.11.0** | 1.1.0 |
| Save | **v11** | v2 |
| Contents | Everything below, up to PR #17 | M1 only (PRs #1–#2) |

- **Release pending:** `main` is 15 PRs behind `dev` (#3–#17). The owner releases with a PR `dev` → `main` after testing on the `dev` preview.
- **Open PRs:** none.
- **Workflow:** product owner (orchestrator) → one `game-engineer` per feature → 1–3 reviewers by complexity (`.claude/skills/pr-review-council`) → owner merges.

## Release notes (`dev`)

Newest first. One entry per merged PR. Engine/save bumps are noted where they happened.

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
3. **Cleanup PR** from deferred review notes (each below the fix bar):
   - carousel memo comparator
   - a bird-nest drop test
   - Android double-read on the replay announcement
   - read `fromEngine` from the last log row
   - the stale-closure guards still on React state in older modals (Merchant)

## Roadmap: unrefined

Ideas and open questions. Each needs owner decisions before it can be briefed.

**Balance**
- **Early-game HP pace:** Lv5 takes about 17 min, limited by HP (each fight costs about 5 HP and skips give no regen). Options: more starting HP, faster regen, or cheaper potions.
- **New long-term targets:** the old "Lv20 in about 2 days" target is obsolete since the 1.8.0 XP curve.
- **Mid-game walls:** Wolf Den needs about Lv6–7, and training is the bottleneck for tiers 4–5 (Crypt/Troll).
- **Worker upkeep:** it is expensive early (1g/min per worker against about 2g/min from dungeons). Watch how it feels.

**Buildings and economy**
- Town Hall Lv3–5 passive bonuses (the data shape is ready).
- Storage itself (capacity, a stash) is still "coming soon". Dungeon and Storage stay non-upgradable for now (owner decision 2026-10-28); revisit only if they get a bonus.
- Cancelling an upgrade, and a second builder.
- Offline cap upgrade (8h → more), and a stamina max upgrade.
- Bulk selling of logs and ore.
- Crafting and smithing with logs, ore and geodes (the `smithing` skill key already exists).

**Combat and dungeons**
- Multi-enemy runs and bosses (needs a save-shape change: `ActiveFight` holds one enemy).
- Hit chance and crits from DEX; a use for INT and mana.
- Attack-speed gear (the `attackIntervalModMs` hook exists, unused).
- Unlock rules beyond wins (e.g. hero level).

**Items**
- Rarity tiers above green (blue/purple/gold) and random affixes stored on item instances.
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
