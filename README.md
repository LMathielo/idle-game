# Idle Game

A mobile idle/incremental RPG inspired by Gladiatus. Your gladiator levels up combat and non-combat skills, gears up, and fights in dungeons that run automatically. You click, it fights, you watch.

**Status:** barebone hello-world. Game code comes next.

**Live web preview:** https://lmathielo.github.io/idle-game/ (redeployed on every push to `main`)

## Stack

- [Expo](https://expo.dev) (SDK 58) + React Native 0.88 + TypeScript
- One codebase for iOS, Android and web
- Web build deployed to GitHub Pages by GitHub Actions

## Planned architecture

The game must be server-authoritative later, but runs fully on-device for the POC.

- **Engine** (to come, `packages/engine` or `src/engine`): pure TypeScript, no React, no I/O, deterministic (seeded RNG, time passed in). Exposes `applyCommand(state, cmd)` and `simulate(state, elapsedMs)`.
- **GameClient** interface between UI and engine. `LocalGameClient` now (engine + on-device save), `RemoteGameClient` later (same commands over the network to a Node server that imports the same engine).
- **UI**: three tabs: Character, Inventory, Dungeon. Combat is a log produced by the engine and replayed as a simple animation.

## Running it

### From a phone, no computer (main workflow while travelling)

1. Push to `main` (or merge a PR).
2. Wait for the **Deploy web preview** action to go green (~2 min).
3. Open https://lmathielo.github.io/idle-game/ on the phone. "Add to Home Screen" makes it feel app-like.

Branches don't deploy automatically. Merge to `main` to see a change, or run the workflow manually from the Actions tab.

### Native, in Expo Go (needs a machine running the dev server)

```bash
npm install
npx expo start --tunnel   # scan the QR code with Expo Go (Android) or the Camera app (iOS)
```

`--tunnel` works when the phone and computer are on different networks.

### Local web

```bash
npm install
npm run web
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Expo dev server |
| `npm run web` | Dev server in the browser |
| `npm run build:web` | Static web export to `dist/` |
| `npm run typecheck` | `tsc --noEmit` |

## One-time GitHub setup

Settings → Pages → **Build and deployment → Source: GitHub Actions**. Without this, the deploy job fails.

## Branching

- `main`: always builds and deploys.
- Feature or experiment work on branches (`feat/...`, `exp/...`), merged via PR.
