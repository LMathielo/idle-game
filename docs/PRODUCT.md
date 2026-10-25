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

## Current state (2026-10-25)

- Two tabs: **Village** (pixel village hub with signs: Storage, Merchant, Dungeon, Training, Woodcutting — not wired) and **Hero** (HP/XP, 6 attributes, 9 equipment slots, 20-slot inventory, 4 skills). All mocked data.
- Engine: types only (`src/engine/types.ts`). No rules, no saving.

## Roadmap (proposed, not yet committed by the owner)

- **M1 — Core engine & save:** seeded RNG, `applyCommand` / `simulate`, `LocalGameClient`, versioned on-device save, Hero tab reading real state.
- **M2 — First idle loop: Woodcutting.** Start/stop gathering, logs accumulate over time and offline (capped), skill XP and levels, "while you were away" summary.
- **M3 — Training & Merchant.** Spend gold to raise attributes (scaling cost); sell logs/items, buy basics. First complete economy loop.
- **M4 — Dungeon.** Automated combat resolved by the engine, combat log replayed in the UI, XP/gold/loot rewards, equip from loot.
- **M5 — Storage & polish.** Storage capacity, item comparison deltas, onboarding.

## Decision log

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-21 | Expo + React Native + TypeScript, engine as pure TS | One codebase, engine reusable on a Node server |
| 2026-10-25 | Mobile only, preview via EAS Update → Expo Go | Owner works from his phone; no web target |
| 2026-10-25 | Two tabs: Village (hub) and Hero (character sheet) | Owner's direction; inventory lives inside Hero for now |
| 2026-10-25 | Gladiatus attribute set (STR, DEX, AGI, CON, CHA, INT) | Familiar to the target player; maps cleanly to combat formulas |
| 2026-10-25 | Workflow: product owner briefs → game-engineer codes on a branch → PR → 5 review agents → fix loop | Owner's request; keeps quality high without the owner reviewing every line on a phone |

## Backlog (not scheduled)

- Branch previews in Expo Go (publish EAS Updates for PR branches, not only `main`).
- Pixel sprite set to replace emoji item icons.
- Arena / PvP once a server exists.
- Prestige / rebirth layer.
