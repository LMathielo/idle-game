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

- Two tabs: **Village** (pixel village hub with signs: Storage, Merchant, Dungeon, Training, Woodcutting) and **Hero** (XP, Status panel with 4 attributes, derived damage/defense, current/max HP with regen, mana and stamina, 9 equipment slots, 20-slot inventory, 4 skills).
- **M1 done and on `main`:** deterministic engine (`src/engine`), `LocalGameClient`, on-device SQLite save with an action log. Woodcutting works from the Village sign (tap to start/stop), progresses live and offline (8h cap), and shows a "While you were away" summary. Hero tab reads real state. Debug panel on the Hero tab (clock offset, +10k hero XP, stamina, attributes, hero HP → 1, finish run, reset save).
- **M4 Dungeon in progress:** the Dungeon sign opens a full-screen modal. Rat Cellar Lv1 (one Rat) runs on auto-repeat, live and offline; each run takes 5:00 − 1 s per DEX (4:50 for a new hero) or can be skipped with stamina, and ends in a deterministic fight that gives hero XP, gold and Rat Skin. Current HP persists and regenerates (5 + END per minute). Last-fight panel with a replay of the fight log. Only one activity runs at a time.
- Merchant, Storage and Training show "coming soon". No training, merchant, storage or equipping loot yet.
- Technical details: `docs/ENGINE.md`.
- Delivery: PRs land on `dev` (test preview in Expo Go, EAS branch `dev`); the owner releases `dev` → `main` (EAS branch `main`) after testing.

## Roadmap (proposed, not yet committed by the owner)

- **M1 — Core engine & save (done, on `main`):** seeded RNG, `applyCommand` / `simulate`, `LocalGameClient`, versioned on-device save, Hero tab reading real state. Also pulls in M2's core: woodcutting start/stop, offline progress (capped) and the "while you were away" summary.
- **M2 — First idle loop: Woodcutting.** Start/stop gathering, logs accumulate over time and offline (capped), skill XP and levels, "while you were away" summary.
- **M3 — Training & Merchant.** Raise attributes at Training by paying gold **and waiting** (Gladiatus-style: a training session takes time, cost and duration scale with the current value); sell logs/items, buy basics. First complete economy loop. Attributes stay plain integers in the save, so training only has to add to them.
- **M4 — Dungeon (in progress).** Automated combat resolved by the engine, combat log replayed in the UI, XP/gold/loot rewards, equip from loot. First slice in review: village modal pattern, Rat Cellar, combat, persistent HP, auto-repeat runs, stamina skip. Equipping loot comes later.
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
- Before the first save or rules change after M1: log a `MIGRATE` / `ENGINE_UPGRADE` row, replay by each row's `engineVersion`, and add SQL schema migrations. **MIGRATE log row before sync (now overdue: v3 and v4 bumps without it).**
- Woodcutting modal (same full-screen pattern as Dungeon; today it is still tap-to-toggle).
- Modals for the other village signs (Merchant, Storage, Training).
- More dungeons and enemies (multi-enemy runs, bosses, level gates).
- Hit chance and crit using DEX.
- HP potions.
- Action-log retention once sync exists: delete synced rows older than 30 days.
