# Idle Game

A mobile idle/incremental RPG inspired by Gladiatus. Your gladiator levels up combat and non-combat skills, gears up, and fights in dungeons that run automatically. You click, it fights, you watch.

**Status:** M1. Deterministic engine with an on-device SQLite save and action log. Woodcutting runs live and offline (8h cap) with a "While you were away" summary; the Hero tab shows real state. See `docs/ENGINE.md`.

**Preview:** every push to `main` publishes an EAS Update you open in Expo Go. No machine needed.

## Stack

- [Expo](https://expo.dev) (SDK 58) + React Native 0.88 + TypeScript
- One codebase for iOS and Android (mobile only, no web target)
- EAS Update published by GitHub Actions, opened in Expo Go

## Planned architecture

The game must be server-authoritative later, but runs fully on-device for the POC.

- **Engine** (`src/engine`): pure TypeScript, no React, no I/O, deterministic (seeded RNG, time passed in). Exposes `applyCommand(state, cmd, now)` and `simulate(state, now)`.
- **GameClient** interface between UI and engine. `LocalGameClient` now (engine + on-device save), `RemoteGameClient` later (same commands over the network to a Node server that imports the same engine).
- **UI**: two tabs, Village (main hub) and Hero (character sheet). Combat is a log produced by the engine and replayed as a simple animation.

## Running it

### From a phone, no computer (main workflow)

1. Push to `main` (or merge a PR).
2. Wait for the **Publish to Expo Go** action to go green (~2–3 min).
3. Open Expo Go (logged into the same Expo account). The project shows up under your projects; open the latest `main` update. Alternatively, go to expo.dev → project → Updates and scan the QR code.

Branches don't publish automatically. Merge to `main`, or run the workflow manually from the Actions tab.

Expo Go in the stores supports only the latest Expo SDK. When Expo ships a new SDK, upgrade with `npx expo install expo@latest && npx expo install --fix`.

### With a machine

```bash
npm install
npx expo start --tunnel   # scan the QR code with Expo Go
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Expo dev server |
| `npm run android` / `npm run ios` | Dev server, open on device/emulator |
| `npm run typecheck` | `tsc --noEmit` |

## One-time setup

- Repo secret `EXPO_TOKEN` (Settings → Secrets and variables → Actions) holding an expo.dev access token.
- The first workflow run links the project to that Expo account and commits `app.json` back to `main`.

## Branching

- `main`: always builds and deploys.
- Feature or experiment work on branches (`feat/...`, `exp/...`), merged via PR.
