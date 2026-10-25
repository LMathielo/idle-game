# AGENTS.md

Guide for AI agents (and humans) working in this repo. Read it fully before changing code.

## Project

Mobile idle/incremental RPG inspired by Gladiatus. POC scope: three tabs (Character, Inventory, Dungeon). Combat is automated and non-interactive; the UI only visualizes it.

The owner works mostly from a phone. Keep that in mind:
- Commit directly to the GitHub repo; there is no "local copy" the owner can open.
- Every change on `main` must build, because `main` deploys to https://lmathielo.github.io/idle-game/ and that is how the owner tests.
- Experiments go on a branch (`exp/<name>` or `feat/<name>`) and are merged by PR.
- Keep PR descriptions short and readable on a phone screen.

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
npm run build:web           # static web export (what CI deploys)
npx expo-doctor             # diagnose dependency/config issues
```

Before declaring a task done: `npm run typecheck` and `npm run build:web` must pass.

## Navigation

When we add the tabs, use **Expo Router**. Routes live in `src/app/`; every file there is a screen and `_layout.tsx` files define navigators. Keep non-route code outside `src/app/`. Note `app.json` sets `experiments.baseUrl` to `/idle-game` for GitHub Pages; keep it.

## Native rules

- `ios/` and `android/` are generated (Continuous Native Generation). Never create or edit them by hand; configure via `app.json` and config plugins.
- Expo Go only includes its bundled native modules. Prefer libraries that work in Expo Go and on web, so the phone-browser preview keeps working.
- Use EAS (`npx eas-cli@latest ...`) for real builds and OTA updates when needed.
