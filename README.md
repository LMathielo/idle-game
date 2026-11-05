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
2. Wait for the **CI** check to pass, then merge with **Create a merge commit** (check the merge button's dropdown; never squash or rebase here, or `dev` and `main` drift apart and the next release PR shows old commits again).
3. The **Publish to Expo Go** action publishes the `main` update, named after the release PR title.

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

- Secret `EXPO_TOKEN` holding an expo.dev access token: repo-level today (Settings → Secrets and variables → Actions); step 3 below moves it into the `expo-publish` environment.
- The first workflow run links the project to that Expo account and commits `app.json` back (already done).

### One-time GitHub setup (doable from the phone, in the browser's desktop view)

1. **Settings → General → Default branch:** switch to **`dev`**. New PRs then target `dev` by default.
2. **Settings → Rules → Rulesets → New ruleset → New branch ruleset** (a ruleset, not a classic branch protection rule: only rulesets can limit the merge method per branch):
   - Name `main`, **Enforcement status: Active**. Leave the bypass list empty.
   - **Target branches → Add target → Include by pattern** → `main` (not "Include default branch": that is now `dev`).
   - Keep **Restrict deletions** and **Block force pushes** ticked.
   - Tick **Require a pull request before merging**:
     - **Required approvals: 0** (GitHub doesn't let you approve your own PR, so 1 would block you).
     - **Allowed merge methods: Merge** only.
   - Tick **Require status checks to pass**, then **Add checks** → **`CI`** (it shows up after CI has run once on a PR). Leave **Require branches to be up to date before merging** unticked.
   - **Create.** `dev` stays unprotected.

   GitHub may still show squash/rebase in the merge dropdown for `main` PRs when they're enabled repo-wide, so always check it says **Create a merge commit** (step 2 of Release).
3. **Harden the Expo token** (recommended; the workflow works before and after this step):
   - **Settings → Environments → `expo-publish`** (created by the first publish run; or **New environment** with that name).
   - **Deployment branches and tags → Selected branches and tags → Add rule** `main`, and again for `dev`.
   - **Environment secrets → Add secret** `EXPO_TOKEN` with the same token.
   - Then delete the repo-level secret (**Settings → Secrets and variables → Actions → `EXPO_TOKEN` → Remove**). From then on only runs on `main`/`dev` can read the token, even if someone edits the workflow on another branch.
   - **Not compatible with PR previews** (owner decision 2026-11-04: previews use the repo-level secret). Keep the repo-level secret while you want the `expo-test` label to work; the trade-off is that a branch pushed to this repo can read the token.

## Previewing a PR before merging

Add the label **`expo-test`** to a pull request (into `dev` or `main`) to try it in Expo Go before merging it. The workflow `expo-preview.yml` then:

- runs install, typecheck and tests, and publishes an EAS Update on an **EAS branch named exactly like the PR's git branch** (`feat/xyz` shows up as `feat/xyz` on expo.dev → project → Updates);
- posts **one comment** on the PR (edited on every republish, never a second one) with the EAS branch, commit, save slot, an **Open in Expo Go** link and a QR code;
- republishes on every push while the label is on;
- **removes the preview** (deletes the EAS branch and edits the comment) when you take the label off or the PR is closed or merged.

A PR whose branch is `main` or `dev` (the release PR) is refused: those two publish through `eas-update.yml` only.

**Each build has its own save**, so previews never touch your progress: `main` keeps `idle-game.db` (your existing progress), `dev` uses `idle-game-dev.db` (copied once from `idle-game.db` on its first launch), and a PR preview starts fresh in `idle-game-<branch>.db`. Hero tab → Debug shows which slot you are on. A local `npx expo start` behaves like `main`.

- The copy is one-way and one-time: **progress on `dev` never flows back to `main`**, and `main` stays as it was.
- A preview's save **persists across pushes and across a reused branch name** (the same branch name is the same file, even after the preview was removed and re-added). There is no reset button yet; to start over, rename the branch or clear Expo Go's data.
- Different branch names can map to the same file (`feat/a-b`, `feat/a_b`, `feat/a/b` all become `feat-a-b`).

**Token check.** Previews read `EXPO_TOKEN` as a **repo-level** secret, so it must stay there: Settings → Secrets and variables → Actions → **Repository secrets** → `EXPO_TOKEN`. (If you later move it only into the `expo-publish` environment, previews stop working with "EXPO_TOKEN secret is missing".) During the publish step the token is **visible to the PR's own build code** (Metro, Babel, app config run while `eas update` bundles). Only you can start a preview (the workflow ignores the label when anyone else adds it), but the code it runs is whatever is on that branch: only label PRs you trust.

## Branching

- `main`: stable, only what you tested on `dev`. Publishes EAS branch `main`. Changed only by a release PR from `dev`.
- `dev`: default branch and test preview. Publishes EAS branch `dev`. Every feature/fix PR targets it.
- `feat/...`, `fix/...`, `chore/...`, `exp/...`: one task each, cut from `dev`, merged into `dev` via PR. Published to Expo Go only while the PR has the `expo-test` label (see above).
- Only the owner merges, into `dev` and into `main`.
