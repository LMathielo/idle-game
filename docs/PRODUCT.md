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

## Current state (2026-10-26)

- Two tabs: **Village** (pixel village hub with signs: Storage, Merchant, Dungeon, Training, Woodcutting) and **Hero** (XP, Status panel with 4 attributes, derived damage/defense, current/max HP with regen, mana and stamina, 10 equipment slots (incl. the axe), 20-slot inventory, 4 skills).
- **M1 done and on `main`:** deterministic engine (`src/engine`), `LocalGameClient`, on-device SQLite save with an action log. Woodcutting works from the Village sign (tap to start/stop), progresses live and offline (8h cap), and shows a "While you were away" summary. Hero tab reads real state. Debug panel on the Hero tab (clock offset, +10k hero XP, stamina, attributes, hero HP → 1, finish run, reset save).
- **M4 Dungeon in progress:** the Dungeon sign opens a full-screen modal with **5 dungeon tiers** (Rat Cellar, Bat Cave, Wolf Den, Forgotten Crypt, Troll Bridge), one enemy each. Each tier unlocks after a number of wins in the previous one (10 / 15 / 25 / 40); locked tiers show what opens them and their progress, and a banner announces a new unlock. Runs auto-repeat, live and offline; each run takes the tier's base time (5/7/9/11/13 min) − 1 s per DEX, or can be skipped with stamina, and ends in a deterministic fight that gives hero XP, gold and the tier's loot. A danger hint (Easy / Tough / Deadly) estimates the HP cost of a fight. Current HP persists and regenerates (5 + END per minute). Last-fight panel with a replay of the fight log. Only one activity runs at a time. Tiers 4–5 need Training.
- **M3 Training in progress:** the Training sign opens a full-screen modal. Gold buys training tiers (Tier 1 = 100 g, tier t = 100·t³, 10 tiers, each +20 max level for all four attributes); time trains one attribute at a time at 1 XP per minute, live and offline (8h cap). Effective attribute = base + training level, used by damage, defense, HP regen and the DEX run time. The Hero tab shows each attribute's base + trained split.
- **Woodcutting (2026-10-27):** the Woodcutting sign opens a full-screen modal with **5 trees** (Oak, Birch, Maple, Yew, Ironwood) in a swipeable carousel. Each tree needs a woodcutting level and a **woodcutting strength** (WS = 10 × level + STR + axe). New **axe** equipment slot; everyone has the Wooden Axe (+1 WS). Logs every 1:50 on Oak at DEX 10, skippable with stamina. Training can be sped up with stamina (1 per minute).
- **Merchant (2026-10-27):** the Merchant sign opens a full-screen modal with **Buy | Sell** tabs. It stocks Health Potions ×10 and the Iron Axe, Sword and Helm; 5 refresh charges (+1 per 2 h). Tapping an item on the Hero tab opens an info sheet with **Equip / Use / Unequip**. Item names are colored by quality.
- Storage shows "coming soon". No storage, crafting or item affixes yet.
- Technical details: `docs/ENGINE.md`.
- Delivery: PRs land on `dev` (test preview in Expo Go, EAS branch `dev`); the owner releases `dev` → `main` (EAS branch `main`) after testing.

## Roadmap (proposed, not yet committed by the owner)

**In progress: M3 Training (gold + time).** **Next: Merchant** (sell loot/logs, buy basics), which closes the first economy loop.

- **M1 — Core engine & save (done, on `main`):** seeded RNG, `applyCommand` / `simulate`, `LocalGameClient`, versioned on-device save, Hero tab reading real state. Also pulls in M2's core: woodcutting start/stop, offline progress (capped) and the "while you were away" summary.
- **M2 — First idle loop: Woodcutting.** Start/stop gathering, logs accumulate over time and offline (capped), skill XP and levels, "while you were away" summary.
- **M3 — Training & Merchant.** Training in progress: gold unlocks tiers, time raises attributes one at a time (see the 2026-10-26 decisions). Merchant comes next: sell logs/items, buy basics. First complete economy loop.
- **M4 — Dungeon (in progress).** Automated combat resolved by the engine, combat log replayed in the UI, XP/gold/loot rewards, equip from loot. Done: village modal pattern, combat, persistent HP, auto-repeat runs, stamina skip, 5 tiers with win-based unlocks. Equipping loot comes later.
- **M5 — Storage & polish.** Storage capacity, item comparison deltas, onboarding.

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
| 2026-10-25 | XP curve: `round(base × L^1.5 × multiplier)`, hero base 1500, skills base 500, growth 1.00 (1–19), 1.05 (20–39), 1.07 (40–99), 1.18 (100+), no level cap | Targets ~2 days to hero Lv20 and >1 year to Lv100; table in `docs/ENGINE.md` |
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
| 2026-10-27 | **Merchant stock**: as many slots as the inventory; each refresh fills only the first 4 with Health Potion ×10 (bought per unit), Iron Axe, Iron Sword, Iron Helm. A bought-out slot stays empty until the next refresh. Stock generation is data-driven (pool + roll) so a seeded, rarity-tiered roll can replace it later | Fixed shop for now, random stock later without a rewrite |
| 2026-10-27 | **Refresh charges**: +1 every 2 h, max 5 (extra lost), like stamina: uncapped by the 8 h offline cap, paused when the clock goes back, remainder kept. Refresh spends 1 | Gives a reason to come back; bounded |
| 2026-10-27 | **Buy / sell rules**: quantity 1..available, gold never negative, stacks merge, a new stack or unique item needs a free slot, equipped items can't be sold. A buy is bound to the item and price shown (`STOCK_CHANGED`, `PRICE_CHANGED`). The merchant is **not an activity**: trading works while woodcutting, training or in a dungeon | No surprises, nothing interrupts idle progress |
| 2026-10-27 | **Woodcutting stops when WS drops below the current tree's requirement** through an equipment change (unequipping the axe, equipping a weaker one). Logs already finished are kept; the log in progress is lost like any stop (`ACTIVITY_STOPPED`). Staying at or above the requirement keeps it running | Gear gates trees while you cut, not only when you start |
| 2026-10-27 | Save v8, engine 1.7.0: merchant at 5/5 with a fresh stock; quality and prices live only in the catalog (the old per-item `rarity` field is dropped) | Old saves keep everything else |
| 2026-10-26 | Review council sized by risk: 2 reviewers normally, 5 for high-risk PRs; reviewers on Sonnet (medium reasoning); only findings ≥ 80 are fixed in the PR, one verification reviewer after fixes, lower findings batched into cleanup PRs | Token cost: the 5-reviewer council on every PR cost about as much as the coding itself |

## Stamina projection (2026-10-26, updated for the skip rule)

| | Value |
| --- | --- |
| Full bar | 100 = about 20 full skips of a 4:50 run (5 each), or 100 minutes of runs skipped |
| Regen | +1 per 5 min = 12/h = 288/day |
| Empty → full | 8h20 |
| Runs without stamina | free: one run per 4:50 (DEX 10) ≈ 12/h, live or offline (8h cap = 99 runs) |
| Player who skips everything | 288 points/day ≈ 58 extra runs/day on top of the free ones |

## Backlog (not scheduled)

- Per-PR Expo previews (not now): publish an EAS Update per open PR. Today only `dev` and `main` publish.
- Pixel sprite set to replace emoji item icons.
- Arena / PvP once a server exists.
- Prestige / rebirth layer.
- Offline cap upgrade (raise `offline.capMs` / `efficiency` per player, e.g. bought in the village).
- Big-number support for XP beyond ~level 150 (values clamp to `Number.MAX_SAFE_INTEGER` today).
- Server-owned time: closes the repeated "clock forward 8h, open, repeat" offline-cap farm, which can't be detected on the device (see ENGINE.md exploit table).
- Ordered SQL schema migrations keyed on `meta.schema_version`, before the first table change.
- Better axes (Merchant or drops), selling logs.
- Modals for the other village signs (Merchant, Storage).
- More dungeon content: multi-enemy runs, bosses, unlock rules beyond wins (e.g. hero level).
- Hit chance and crit using DEX.
- HP potions.
- Action-log retention once sync exists: delete synced rows older than 30 days.
