# AGENTS.md

Guide for AI agents (and humans) working in this repo. Read it fully before changing code.

## Project

Mobile idle/incremental RPG inspired by Gladiatus. POC scope: two tabs. **Village** (main screen: pixel village background with buttons for Storage, Merchant, Dungeon, Training, Woodcutting) and **Hero** (stats, XP, equipment slots, inventory, skills). Combat is automated and non-interactive; the UI only visualizes it.

Visual style: medieval pixel art. Hard pixel bevels, no rounded corners. Fonts: Jacquard 12 (titles/signs) and Pixelify Sans (body). Colors and fonts live in `src/theme.ts`.

The owner works mostly from a phone. Keep that in mind:
- Push your work to your own branch on GitHub and open a PR; there is no "local copy" the owner can open.
- Every change on `dev` and `main` must build. A push to `dev` publishes the EAS Update branch `dev` (the owner's test preview); a push to `main` publishes EAS branch `main` (the last version he approved). He opens both in Expo Go. That is how he tests.
- Mobile only (iOS + Android). Do not add a web target.
- All work goes on a branch (`feat/`, `fix/`, `chore/`, `exp/`) and reaches `dev` by PR. Feature branches never publish to Expo Go.
- Keep PR descriptions short and readable on a phone screen.

## Workflow (how work gets done here)

- The orchestrating assistant is the **product owner**: it turns requests into task briefs, keeps `docs/PRODUCT.md` current and does not write game code. See `.claude/skills/product-owner/SKILL.md`.
- Coding is done by the **`game-engineer`** agent (`.claude/agents/game-engineer.md`) on a `feat/`, `fix/` or `chore/` branch cut from `origin/dev`, ending in a PR with **base `dev`**.
- Every PR into `dev` gets the **5-reviewer council** (`.claude/skills/pr-review-council/SKILL.md`, reviewers in `.claude/agents/code-reviewer.md`). Confirmed issues go back to the engineer; repeat until clean.
- **Only the owner merges, into `dev` and into `main`.** After he merges into `dev`, the `dev` preview publishes and he tests it in Expo Go. When he is happy, he opens and merges a release PR `dev` → `main`.
- Agents work in their own git worktree, push only to their branch with an explicit ref, and never merge, never push to `dev` or `main`, and never open the release PR unless the owner asks.
- Skills live in `.claude/skills/`: `idle-rpg-game-design` (game knowledge), `product-owner`, `pr-review-council`, plus vendored official Expo skills (MIT, see `EXPO-SKILLS-LICENSE`).
- GitHub GraphQL is blocked in the agent environment: use `gh api` REST calls for PRs and comments.

## Branching

| Branch | Role | Publishes to Expo Go | Who merges |
| --- | --- | --- | --- |
| `main` | Stable: only code the owner tested on `dev`. Protected by a ruleset (PR + `CI` check, merge commit only). | EAS branch `main` | Owner only, via release PR `dev` → `main` |
| `dev` | Integration and test preview. Default branch, so new PRs target it. | EAS branch `dev` | Owner only |
| `feat/*`, `fix/*`, `chore/*`, `exp/*` | One task each, cut from `origin/dev`, PR into `dev` | Never | — |

Flow: `feat/*` → PR into `dev` (CI + council) → owner merges → `dev` preview → owner tests in Expo Go → release PR `dev` → `main` → owner merges → `main` preview.

## Architecture rules

These hold from the first line of game code. They are what let us move logic to a server later without a rewrite.

1. **Engine is pure TypeScript.** Game rules live in the engine module. It never imports React, React Native, Expo, storage or network code.
2. **Deterministic.** No `Math.random()` or `Date.now()` inside the engine. Randomness comes from a seeded RNG stored in state; time is passed in as an argument.
3. **Commands in, state out.** Player actions are serializable command objects (`{ type: 'EQUIP_ITEM', itemId }`) handled by `applyCommand(state, cmd)`. Idle time is advanced by `simulate(state, elapsedMs)`.
4. **UI talks to a `GameClient`, never to the engine directly.** `LocalGameClient` for now; `RemoteGameClient` later.
5. **Combat produces a log.** The engine returns combat events; the UI replays them. Visuals never affect outcomes.
6. **Saves are versioned.** Every save has `saveVersion`; add a migration when the shape changes.
7. **Tunables live in data**, not code: XP curves, drop rates, enemy stats in config files.

Engine code gets unit tests (Vitest). UI code stays thin.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. Before writing code that touches an Expo, EAS or React Native API:

1. Read the major version of `expo` in `package.json` (currently SDK 58).
2. Fetch the matching docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt and follow its links. Don't answer from memory.

## Commands

```bash
npx expo install <package>  # ALWAYS use instead of npm add — resolves SDK-compatible versions
npx expo start              # dev server (add --tunnel for a phone on another network)
npm run typecheck           # tsc --noEmit
npm test                    # Vitest (tests/)
npx expo-doctor             # diagnose dependency/config issues
```

Before declaring a task done: `npm run typecheck` and `npm test` must pass and `npx expo export --platform all` must bundle (iOS + Android only).

## Navigation

Navigation uses **Expo Router**. Routes live in `src/app/`; every file there is a screen and `_layout.tsx` files define navigators. Tabs come from `expo-router/js-tabs` (the root `Tabs` export is deprecated in SDK 58). Keep non-route code outside `src/app/`.

## Layout

```
src/app/              routes: _layout.tsx (fonts, GameProvider, tabs + activity strip, away modal), index.tsx (Village), hero.tsx (Hero)
src/components/       UI building blocks (PixelButton, Panel/Bar, VillageScene, ActivityStrip, AwayModal, DebugPanel)
src/engine/           pure TS game rules: types, rng, progression, simulate, commands, hash, migrations, replay
src/engine/config/    tunables as data: xpCurve, activities, items, time, newGame, dev (DEV_TOOLS_ENABLED)
src/client/           GameClient boundary: LocalGameClient, repositories (SQLite / in-memory), clock, React provider + hooks
src/theme.ts          palette and fonts
tests/                Vitest tests (engine rules, time rules, client, real SQL via node:sqlite, engine import guard, golden hash + frozen save fixtures)
docs/PRODUCT.md       product decisions (owned by the product owner)
docs/ENGINE.md        engine, time rules, XP curve, storage and action-log design
assets/images/        village.png (generated by tools/generate-village.py: 180x390 pixel art, upscaled 4x)
```

UI reads state only through `useGameState()` / `useGameClient()` (`src/client/GameProvider.tsx`). Never import engine rules into a screen to compute game outcomes; read-only selectors (`activityView`, `itemQuantity`) are fine.

Village sign positions are fractions of the artwork (`SIGNS` in `VillageScene.tsx`). If the background changes, update them.

## Native rules

- **Mobile only:** `app.json` `expo.platforms` must stay `["ios", "android"]`. Without it, `eas update --platform all` also bundles web, which fails (e.g. expo-sqlite's web worker needs wasm). CI runs `npx expo export --platform all` on every PR to catch this.
- `ios/` and `android/` are generated (Continuous Native Generation). Never create or edit them by hand; configure via `app.json` and config plugins.
- Expo Go only includes its bundled native modules. Prefer libraries that work in Expo Go, so the EAS Update → Expo Go preview keeps working. Adding a native module outside Expo Go means switching to a development build; flag it before doing so.
- Use EAS (`npx eas-cli@latest ...`) for real builds and OTA updates when needed.
