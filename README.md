# Idle Game

A mobile idle/incremental RPG inspired by Gladiatus. Your gladiator levels up combat and non-combat skills, gears up, and fights in dungeons that run automatically. You click, it fights, you watch.

**Status:** M1. Deterministic engine with an on-device SQLite save and action log. Woodcutting runs live and offline (8h cap) with a "While you were away" summary; the Hero tab shows real state. See `docs/ENGINE.md`.

**Preview:** every push to `dev` publishes the `dev` EAS Update (test preview); every push to `main` publishes the `main` EAS Update (last approved version). Open either in Expo Go. No machine needed.

## Stack

- [Expo](https://expo.dev) (SDK 58) + React Native 0.88 + TypeScript
- One codebase for iOS and Android (mobile only, no web target)
- EAS Update published by GitHub Actions (EAS branches `dev` and `main`), opened in Expo Go

## Planned architecture

The game must be server-authoritative later, but runs fully on-device for the POC.

- **Engine** (`src/engine`): pure TypeScript, no React, no I/O, deterministic (seeded RNG, time passed in). Exposes `applyCommand(state, cmd, now)` and `simulate(state, now)`.
- **GameClient** interface between UI and engine. `LocalGameClient` now (engine + on-device save), `RemoteGameClient` later (same commands over the network to a Node server that imports the same engine).
- **UI**: two tabs, Village (main hub) and Hero (character sheet). Combat is a log produced by the engine and replayed as a simple animation.

## Running it

### From a phone, no computer (main workflow)

Two previews exist, one per EAS Update branch:

| EAS branch | What it is | Published when |
| --- | --- | --- |
| `dev` | Changes waiting for your test | A PR is merged into `dev` |
| `main` | Last version you approved | The release PR `dev` → `main` is merged |

After merging a PR into `dev`:

1. Wait for the **Publish to Expo Go** action on `dev` to go green (Actions tab, ~2–3 min).
2. Open the `dev` update in Expo Go (logged into the same Expo account):
   - In Expo Go, open the project and pick the **`dev`** branch, then its latest update; or
   - go to expo.dev → project → **Updates**, pick branch **`dev`**, open the newest update, tap **Preview** and scan the QR code.
3. Test. If something is wrong, ask for a `fix/` PR into `dev`; `main` is untouched.

To open the stable version, do the same with branch **`main`**.

Feature branches never publish. A manual run of the workflow works only on `dev` or `main`; on any other branch it fails before publishing.

### Release (dev → main)

When the `dev` preview is good:

1. GitHub → **Pull requests → New**, base **`main`**, compare **`dev`**. Title e.g. `Release: <what's in it>`.
2. Wait for the **CI** check to pass, then merge it (use a merge commit, not squash, so `dev` and `main` keep the same history).
3. The **Publish to Expo Go** action publishes the `main` update.

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
- The first workflow run links the project to that Expo account and commits `app.json` back (already done).

### One-time GitHub setup (doable from the phone, in the browser's desktop view)

1. **Settings → General → Default branch:** switch to **`dev`**. New PRs then target `dev` by default.
2. **Settings → Branches → Add branch protection rule** (or Rules → Rulesets → New branch ruleset), branch name pattern **`main`**:
   - **Require a pull request before merging.**
   - **Require status checks to pass before merging**, and add the check **`CI`** (it appears in the search box after CI has run once on a PR).
   - Save. `dev` stays unprotected.

## Branching

- `main`: stable, only what you tested on `dev`. Publishes EAS branch `main`. Changed only by a release PR from `dev`.
- `dev`: default branch and test preview. Publishes EAS branch `dev`. Every feature/fix PR targets it.
- `feat/...`, `fix/...`, `chore/...`, `exp/...`: one task each, cut from `dev`, merged into `dev` via PR. Never published.
- Only the owner merges, into `dev` and into `main`.
