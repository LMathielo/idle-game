---
name: idle-rpg-game-design
description: Game design and game-engine knowledge for this idle/incremental RPG (Gladiatus-inspired). Use before designing or coding any game system (combat, XP, skills, items, loot, economy, dungeons, offline progress, saves) and when reviewing game logic for balance, exploits or determinism bugs.
---

# Idle RPG game design & engine patterns

This project is a mobile idle RPG in the spirit of **Gladiatus**: a single hero who trains attributes, gears up, runs automated dungeons and levels non-combat skills. The player makes decisions; time does the work. Read `docs/PRODUCT.md` for the current product decisions — it overrides anything generic here.

## 1. Reference mechanics (Gladiatus, adapted)

Use these as the default vocabulary. Adapt, don't copy.

- **Attributes:** Strength (damage), Dexterity (hit chance, crit), Agility (dodge, attack speed), Constitution (max HP, HP regen), Charisma (double hit / intimidation; later: merchant prices), Intelligence (healing, later: XP gain).
- **Training:** attributes are raised by spending gold at Training. Cost grows with the current value (see curves). Training is the main gold sink early.
- **Dungeons / expeditions:** a run costs a resource (time or "stamina/points") and fights a sequence of enemies, ending in a boss. Rewards: XP, gold, item drops. Harder dungeons unlock by level.
- **Items:** slot-based (helmet, amulet, armor, weapon, shield, gloves, 2 rings, boots). Each has base stats + affixes. Rarity tiers (common → uncommon → rare → epic → legendary) scale affix count and power.
- **Merchant:** buy items/consumables with gold, sell loot. Sell price ≈ 10–25% of buy price (prevents gold printing).
- **Storage:** extra item space beyond the inventory (a soft limit that creates the need to sell/upgrade).
- **Non-combat skills (our addition):** Woodcutting etc. Gather resources over time; resources feed crafting/selling. Each skill has its own XP curve.

## 2. Core loop & idle principles

- The core loop must be explicit for every feature: **act → wait → collect → spend → get stronger → act on harder content.** If a feature does not feed this loop, question it.
- **Offline progress** is the heart of an idle game. On return, simulate the elapsed time and show a "while you were away" summary. Always **cap** offline time (8–12h default) so the game keeps a reason to open it.
- **Short-term, mid-term and long-term goals** should always be visible: next level, next item upgrade, next dungeon unlock.
- Avoid dead time: if the player has nothing to decide, show progress (bars, timers, combat replay).
- Prestige/rebirth is a late-game lever. Do not build it in the POC, but don't make data shapes that prevent it (keep run-scoped vs permanent state separable).

## 3. Numbers & curves (defaults — tune in config, never hardcode in logic)

- **XP to next level:** `xpToNext(level) = round(base * level ^ exp)`, start with `base = 100`, `exp = 1.6`. Polynomial for the POC; exponential (`base * growth^level`) is for incremental "number go up" layers.
- **Training cost:** `cost(value) = round(c0 * growth ^ (value - startValue))` with `growth` 1.07–1.15. Lower growth = longer, gentler progression.
- **Enemy scaling:** enemy power should grow slightly slower than player power from leveling, and slightly faster than power from gear alone — gear upgrades should feel necessary, not optional.
- **Drop rates:** weighted tables. Rarity weights e.g. common 70 / uncommon 22 / rare 6.5 / epic 1.4 / legendary 0.1. Add pity/bad-luck protection only if the product asks for it.
- **Gold:** integers only. Track every source and sink; each new source needs a matching sink or the economy inflates.
- Use plain `number` for values below 2^53 (~9e15). If a feature can exceed that (incremental layers), flag it and switch to a big-number library.
- All tunables live in `src/engine/config/*` (data, typed, optionally Zod-validated) so balance changes never touch logic.

## 4. Engine architecture (non-negotiable — mirrors AGENTS.md)

- **Pure functions:** `applyCommand(state, cmd) → state` and `simulate(state, elapsedMs) → { state, events }`. No React, no storage, no `Date.now()`, no `Math.random()`.
- **Seeded RNG** stored in state (e.g. mulberry32 / xorshift with a uint32 seed). Every random draw advances the stored seed. Same input → same output, always. This is what lets a server replay and validate later.
- **Fixed-step simulation:** advance in fixed ticks (e.g. 1s or per combat round). For long offline periods, use an analytic/aggregate fast path (expected values or batched runs) instead of millions of ticks; it must produce results consistent with the tick path within tolerance.
- **Commands are validated in the engine,** not the UI: insufficient gold, wrong slot, locked dungeon → return a typed error, never mutate.
- **Combat:** resolve to an ordered event log (`{t, actor, type: 'hit'|'miss'|'crit'|'dodge'|'death', amount}`); the UI only replays it. Visual timing never changes outcomes. Cap combat length (max rounds) to avoid infinite fights (two tanks that can't hurt each other).
- **Time is input.** The client clock is untrusted; when the server exists it will own time. Clamp negative or huge elapsed values.
- **Saves:** `saveVersion` + ordered migrations. Never break an old save; write a migration test with a fixture of the previous version.

## 5. Exploits & bugs to always check

- Negative or huge `elapsedMs` (clock changed backwards/forwards).
- Selling for more than buying; buy→sell loops; duplicate item ids after split/stack.
- Equipping into the wrong slot; two-handed vs shield conflicts; equipping an item still in inventory (duplication).
- Integer overflow / NaN / Infinity in formulas (division by zero on 0 HP/0 armor).
- RNG called outside the engine, or the seed not persisted → non-reproducible results.
- Offline cap bypass; rewards granted twice on resume (app backgrounded mid-collect).
- Level-up loops that skip multiple levels without carrying over excess XP correctly.

## 6. Testing game logic

- The engine is where tests live (Vitest). UI stays thin.
- **Golden tests:** fixed seed + fixed inputs → snapshot of combat log / resulting state.
- **Property tests** for invariants: gold never negative, HP within [0, maxHp], inventory ≤ capacity, xp < xpToNext after level processing.
- **Simulation tests:** run N simulated hours and assert progression lands in the target band (e.g. level 10 after ~2h of active play). Balance regressions are bugs.

## 7. UX conventions for this game

- Medieval pixel style (see `src/theme.ts`): hard bevels, no rounded corners, Jacquard 12 titles, Pixelify Sans body.
- Always show *why* something is locked and what unlocks it.
- Numbers players compare (damage, armor, price) are shown with the delta vs. current gear (+12 / -3, green/red).
- Mobile-first: thumb-reachable actions, large tap targets (≥44pt), no hover-only info.
