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

- Two tabs: **Village** (pixel village hub with signs: Storage, Merchant, Dungeon, Training, Woodcutting) and **Hero** (XP, Status panel with 4 attributes, derived damage/defense/HP/mana and stamina, 9 equipment slots, 20-slot inventory, 4 skills).
- **M1 done and on `main`:** deterministic engine (`src/engine`), `LocalGameClient`, on-device SQLite save with an action log. Woodcutting works from the Village sign (tap to start/stop), progresses live and offline (8h cap), and shows a "While you were away" summary. Hero tab reads real state. Debug panel on the Hero tab (clock offset, +10k hero XP, reset save).
- Other village signs show "coming soon". No combat, training, merchant or storage yet.
- Technical details: `docs/ENGINE.md`.
- Delivery: PRs land on `dev` (test preview in Expo Go, EAS branch `dev`); the owner releases `dev` → `main` (EAS branch `main`) after testing.

## Roadmap (proposed, not yet committed by the owner)

- **M1 — Core engine & save (done, on `main`):** seeded RNG, `applyCommand` / `simulate`, `LocalGameClient`, versioned on-device save, Hero tab reading real state. Also pulls in M2's core: woodcutting start/stop, offline progress (capped) and the "while you were away" summary.
- **M2 — First idle loop: Woodcutting.** Start/stop gathering, logs accumulate over time and offline (capped), skill XP and levels, "while you were away" summary.
- **M3 — Training & Merchant.** Raise attributes at Training by paying gold **and waiting** (Gladiatus-style: a training session takes time, cost and duration scale with the current value); sell logs/items, buy basics. First complete economy loop. Attributes stay plain integers in the save, so training only has to add to them.
- **M4 — Dungeon.** Automated combat resolved by the engine, combat log replayed in the UI, XP/gold/loot rewards, equip from loot.
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
| 2026-10-26 | 4 attributes: Strength, Dexterity, Endurance, Intelligence; new hero starts at 10 each. Agility and Charisma removed, Constitution renamed Endurance (old saves keep their values) | Fewer, clearer stats for a phone screen. STR = +1 damage, END = +1 defense; DEX and INT show "no effect yet" until combat needs them |
| 2026-10-26 | Derived stats (damage, defense, max HP, max mana) are computed, never stored. `final = round(base × (1 + Σ%)) + flat from attributes` | Attribute points are flat final bonuses that percent upgrades never scale, so training stays readable ("+1 STR = +1 damage") |
| 2026-10-26 | Max HP = 50 + 10 × (level − 1), max mana = 20 + 5 × (level − 1). No current HP until combat (M4) | Nothing damages the hero yet |
| 2026-10-26 | Item stats come from a config catalog by item `defId`, not from the stored item | Balance changes need no save migration |
| 2026-10-26 | Stamina: 100 max (per player, upgradable later), +1 every 5 min, not limited by the 8h offline cap (the max bounds it). Planned costs: dungeon run 10, boss 25 | Gates dungeons/bosses (M4) without a hard daily limit. See projection below |
| 2026-10-26 | M3 Training = gold + time | Gladiatus-style training sessions; a time cost keeps progression paced and gives a reason to come back |

## Stamina projection (2026-10-26)

| | Value |
| --- | --- |
| Full bar | 100 = 10 dungeon runs (10 each) or 4 bosses (25 each) |
| Regen | +1 per 5 min = 12/h = 288/day |
| Empty → full | 8h20 |
| Player who checks in 3× a day | ~30 runs/day: the full bar (10 runs) at each check-in, each refilled by the next one 8h later; a few points are lost overnight while full |
| Player who plays constantly | at most 288 points/day ≈ 28 runs |

## Backlog (not scheduled)

- Per-PR Expo previews (not now): publish an EAS Update per open PR. Today only `dev` and `main` publish.
- Pixel sprite set to replace emoji item icons.
- Arena / PvP once a server exists.
- Prestige / rebirth layer.
- Offline cap upgrade (raise `offline.capMs` / `efficiency` per player, e.g. bought in the village).
- Big-number support for XP beyond ~level 150 (values clamp to `Number.MAX_SAFE_INTEGER` today).
- Server-owned time: closes the repeated "clock forward 8h, open, repeat" offline-cap farm, which can't be detected on the device (see ENGINE.md exploit table).
- Before the first save or rules change after M1: log a `MIGRATE` / `ENGINE_UPGRADE` row, replay by each row's `engineVersion`, and add SQL schema migrations.
- Action-log retention once sync exists: delete synced rows older than 30 days.
