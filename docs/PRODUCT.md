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

## Current state (2026-10-28, engine 1.11.0)

- Two tabs: **Village** (pixel village hub with signs: Storage, Merchant, Dungeon, Training, Woodcutting, Mine Shaft, Town Hall) and **Hero** (XP, Status panel with 4 attributes, derived damage/defense, current/max HP with regen, mana and stamina, 11 equipment slots (incl. the axe and the pickaxe), 20-slot inventory, 4 skills).
- **Buildings (2026-10-28):** Woodcutting, Mine Shaft, Town Hall and Training Grounds start **locked** (greyed sign with 🔒); tapping one opens a Build sheet with each requirement (have / need) and a Build button. Dungeon, Merchant and Storage are always built. Table below.
- **Town Hall, upgrades and workers (2026-10-28, engine 1.10.0):** every building upgrades to Lv5 (never above the Town Hall) with **one builder**, paid up front, timed, live and offline; the sign shows "Upgrading 12:34". Bonuses per level (yield, sell prices, worker slots, merchant stock slots). The Town Hall hires **workers** who gather on any tree or rock the hero can work, at 25% of the hero's power each, for upkeep per minute. **Gathering yield is power-based**: power ÷ requirement items per action (Oak and Stone need 20 now). The Merchant rolls a **random stock** from a 12-item pool on each refresh. Tables below.
- **Training Grounds upgrades (2026-10-28, engine 1.11.0):** the Training Grounds upgrade to Lv5 like every other building (Town Hall cap, half the Town Hall's cost); each level gives **+1 training XP per minute** (Lv1 = 1, Lv5 = 5), live, offline and for the stamina speed-up.
- **Mine Shaft (2026-10-28):** mining mirrors woodcutting with its own config: 5 rocks (Stone, Copper, Iron, Silver, Gold), mining strength (MS = 10 × level + STR + pickaxe), Wooden Pickaxe for everyone, Iron Pickaxe at the Merchant, Geode 1/200. Table below.
- **M1 done and on `main`:** deterministic engine (`src/engine`), `LocalGameClient`, on-device SQLite save with an action log. Woodcutting works from the Village sign (tap to start/stop), progresses live and offline (8h cap), and shows a "While you were away" summary. Hero tab reads real state. Debug panel on the Hero tab (clock offset, +10k hero XP, stamina, attributes, hero HP → 1, finish run, reset save).
- **M4 Dungeon in progress:** the Dungeon sign opens a full-screen modal with **5 dungeon tiers** (Rat Cellar, Bat Cave, Wolf Den, Forgotten Crypt, Troll Bridge), one enemy each. Each tier unlocks after a number of wins in the previous one (10 / 15 / 25 / 40); locked tiers show what opens them and their progress, and a banner announces a new unlock. Runs auto-repeat, live and offline. **Since 2026-10-27 a run is a search for an opponent (2/3/5/8/12 min − 1 s per DEX), then a live fight** that plays out strike by strike in engine time (each side on its own attack timer, 60 s limit) and gives hero XP, gold and the tier's loot; stamina skips the search only. A danger hint (Easy / Tough / Deadly) estimates the HP cost of a fight. Current HP persists and regenerates (5 + END per minute). Last-fight panel with a replay of the fight log. Only one activity runs at a time. Tiers 4–5 need Training.
- **M3 Training in progress:** the Training sign opens a full-screen modal. Gold buys training tiers (Tier 1 = 100 g, tier t = 100·t³, 10 tiers, each +20 max level for all four attributes); time trains one attribute at a time at 1 XP per minute, live and offline (8h cap). Effective attribute = base + training level, used by damage, defense, HP regen and the DEX run time. The Hero tab shows each attribute's base + trained split.
- **Woodcutting (2026-10-27):** the Woodcutting sign opens a full-screen modal with **5 trees** (Oak, Birch, Maple, Yew, Ironwood) in a swipeable carousel. Each tree needs a woodcutting level and a **woodcutting strength** (WS = 10 × level + STR + axe). New **axe** equipment slot; everyone has the Wooden Axe (+1 WS). Logs every 1:50 on Oak at DEX 10, skippable with stamina. Training can be sped up with stamina (1 per minute).
- **Merchant (2026-10-27):** the Merchant sign opens a full-screen modal with **Buy | Sell** tabs. Slot 1 is always Health Potion ×10; since 1.10.0 the other slots are rolled from a pool on each refresh (table below); 5 refresh charges (+1 per 2 h). Tapping an item on the Hero tab opens an info sheet with **Equip / Use / Unequip**. Item names are colored by quality.
- Storage shows "coming soon". No storage, crafting or item affixes yet.
- Technical details: `docs/ENGINE.md`.
- Delivery: PRs land on `dev` (test preview in Expo Go, EAS branch `dev`); the owner releases `dev` → `main` (EAS branch `main`) after testing.

## Buildings (2026-10-28)

| Building | State on a new save | Requirements | Gives |
| --- | --- | --- | --- |
| Dungeon, Storage | always there (not upgradable) | — | — |
| Merchant | built, Lv1 (a stored building since 1.10.0) | — | stock slots by level |
| Woodcutting | locked | 50 gold | woodcutting |
| Mine Shaft | locked | 50 gold | mining |
| Town Hall | locked | hero Lv5, 20 Oak Logs, 20 Stone, 100 gold | workers; caps every other building's level |
| Training Grounds | locked | hero Lv10, Town Hall Lv1, 50 Oak Logs, 50 Stone, 250 gold | training, with Tier 1 included; XP/min by level |

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

Yield multiplier = 1 + Town Hall bonus + the skill's building bonus (hero and workers). Sell price = floor(catalog × 1.2) at Town Hall Lv2+.

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

Slot 1: Health Potion ×10. Other slots: rolled from the pool on each refresh (seeded, no duplicates). A new save starts with Iron Axe, Iron Pickaxe, Iron Sword, Iron Helm. Every item sells for 30% of its price (floored), below its buy price even with the +20% bonus.

| Item | Slot | Stat | Buy | Sell |
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

## Stamina projection (2026-10-27, search-only skip)

| | Value |
| --- | --- |
| Full bar | 100 = 50 skips of a fresh 1:50 Rat Cellar search (2 each) |
| Regen | +1 per 5 min = 12/h = 288/day |
| Empty → full | 8h20 |
| Runs without stamina | free: one Rat Cellar run per ~1:53 (1:50 search + ~3 s fight at DEX 10) ≈ 32/h, live or offline (8h cap ≈ 255 runs) |
| New hero, first session | Lv5 needs 49 Rat wins. A fight costs ~5 HP and a skip gives no regen, so **HP, not stamina, sets the pace**: skipping only at ≥ 10 HP reaches Lv5 after 50 straight wins in ~17 min (sim, 2026-10-27). Skipping at 0 HP burns 2 stamina per instant loss (the UI warns) |

## Backlog (not scheduled)

- Per-PR Expo previews (not now): publish an EAS Update per open PR. Today only `dev` and `main` publish.
- Pixel sprite set to replace emoji item icons.
- Arena / PvP once a server exists.
- Prestige / rebirth layer.
- Offline cap upgrade (raise `offline.capMs` / `efficiency` per player, e.g. bought in the village).
- Big-number support for XP beyond ~level 150 (values clamp to `Number.MAX_SAFE_INTEGER` today).
- Server-owned time: closes the repeated "clock forward 8h, open, repeat" offline-cap farm, which can't be detected on the device (see ENGINE.md exploit table).
- Ordered SQL schema migrations keyed on `meta.schema_version`, before the first table change.
- Selling logs in bulk; crafting with ores and logs.
- Cancel an upgrade; a second builder; passive bonuses for Town Hall Lv3–5.
- Modals for the other village signs (Merchant, Storage).
- More dungeon content: multi-enemy runs, bosses, unlock rules beyond wins (e.g. hero level).
- Hit chance and crit using DEX.
- HP potions.
- Action-log retention once sync exists: delete synced rows older than 30 days.
