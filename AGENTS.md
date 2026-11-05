# AGENTS.md

Guide for AI agents (and humans) working in this repo. Auto-loaded via `CLAUDE.md`; it holds only what every task needs. Read the rest on demand:

- `docs/STATUS.md`: at session start, its top ("Current version") and the two "Roadmap" sections; skip the release notes.
- `docs/PRODUCT.md` (product decisions) and `docs/ENGINE.md` (engine, time, saves): read the **Contents** table, then only the sections the task touches.
- `docs/CODEMAP.md`: file layout, read-only selectors, navigation detail, village map, art pipeline. Read it when locating code.
- `docs/TECH_DEBT.md`: deferred review findings.

## Project

Mobile idle/incremental RPG inspired by Gladiatus. POC scope: two tabs. **Village** (pixel village map with a sign per building: Storage, Merchant, Dungeon, Training, Woodcutting, Mine Shaft, Town Hall, Crafting; locked buildings open a Build sheet, built ones upgrade in their modal, the Town Hall runs the workers) and **Hero** (stats, XP, equipment, inventory, skills). Combat is automated and non-interactive; the UI only visualizes it.

**UI kit** (`src/components/ui/`): **never use the native `Alert` API**: every confirmation and alert goes through **GameDialog** (`useDialog().confirm / alert / notPossible / saveFailed`; `useCommand()` dispatches with dialog errors). **Info → InfoPopover** (anchored on the tapped element via `measureAnchor`, actions inside, tap outside closes); no new bottom sheets for info. Repeated actions (stamina skips, speed-ups, debug) use PixelButton **`repeat`** (useHoldRepeat): repeat ticks stay quiet and return false when refused. Dialogs are hosted per screen root (root layout + ModalScreen; why: CODEMAP); popovers / pickers step aside while a dialog or the away summary is up.

**Style:** medieval pixel art, hard pixel bevels, no rounded corners. Pixelify Sans Bold (`fonts.title`: titles, village signs, tab labels, headings); Inter (`fonts.body` / `fonts.bodyBold`: body, numbers, stats, logs, buttons, descriptions). Body text ≥ 13 (only bar labels and slot badges go smaller). Colors and fonts: `src/theme.ts`.

**No emoji in any text** (owner decision 2026-11-04): symbols are pixel-art images from `src/components/art/` (registry `images.ts`, components in `Sprites.tsx`; list in CODEMAP). The engine stays image-free. `tests/art.test.ts` / `tests/noEmoji.test.ts` enforce it. Plain ✕ ✓ ✗ are text. Never edit PNGs by hand; `tools/art` generates them.

**The owner works mostly from a phone:**
- Push your work to your own branch on GitHub and open a PR; there is no local copy he can open. Keep PR descriptions short and phone-readable.
- Every change on `dev` and `main` must build: a push to either publishes its EAS Update branch (`dev` = his test preview, `main` = the last version he approved), which he tests in Expo Go.
- Mobile only (iOS + Android). No web target.

## Workflow and branching

- **Branches:** `feat/*`, `fix/*`, `chore/*`, `exp/*` (one task each, cut from `origin/dev`, never publish to Expo Go) → PR into `dev` (integration + test preview, the default branch) → release PR `dev` → `main` (stable, only what he tested; protected: PR + `CI` check, merge commit only).
- The orchestrator is the **product owner** (`.claude/skills/product-owner/SKILL.md`): turns requests into task briefs, keeps `docs/PRODUCT.md` current, writes no game code.
- The **`game-engineer`** agent (`.claude/agents/game-engineer.md`) codes each brief on its branch and opens a PR with **base `dev`**.
- Every PR into `dev` gets the **review council** (`.claude/skills/pr-review-council/SKILL.md`): 1–3 reviewers by risk. Reviewers run on Sonnet at medium effort; the engineer on Sonnet at medium, or high for high-risk tasks (never below medium). Confirmed issues go back to the engineer until clean.
- **Only the owner merges, into `dev` and into `main`.** Agents work in their own git worktree, push only to their branch with an explicit ref, and never merge, never push to `dev` or `main`, and never open the release PR unless the owner asks.
- Every feature PR updates `docs/STATUS.md` (version, a release-notes line, the roadmap item it closes).
- Skills (`.claude/skills/`): `idle-rpg-game-design`, `product-owner`, `pr-review-council`, plus vendored Expo skills (MIT, `EXPO-SKILLS-LICENSE`).
- GitHub GraphQL is blocked here: use `gh api` REST calls for PRs and comments.

## Working modes

Both end the same way: branch on GitHub → PR into `dev` → council → owner merges.

- **Desktop mode** (owner at his Windows PC): when the session has `mcp__remote-devices__device_bash` and a call finds the repo at `$HOME/mnt/idle-game`. The worktree lives on his machine at `.worktrees/<branch, / as ->/`; edits, checks and commits run there via `device_bash`; the branch reaches GitHub as a `git bundle` pushed from the cloud clone (the machine has no GitHub credentials). `$HOME/mnt/idle-game` is **his** checkout: never switch branches or edit files there.
- **Cloud mode** (otherwise, e.g. owner on his phone): clone at `/home/claude/idle-game`, worktrees in `/tmp/wt/<branch>`, push and PR from there.
- The owner can override ("work in the cloud"). Step by step: `.claude/agents/game-engineer.md`.

## Architecture rules

They let us move logic to a server later without a rewrite.

1. **Engine is pure TypeScript** (`src/engine`). It never imports React, React Native, Expo, storage or network code.
2. **Deterministic.** No `Math.random()` or `Date.now()` in the engine. Randomness comes from a seeded RNG stored in state; time is passed in.
3. **Commands in, state out.** Player actions are serializable commands (`{ type: 'EQUIP_ITEM', itemId }`) handled by `applyCommand(state, cmd)`; idle time is advanced by `simulate`.
4. **UI talks to a `GameClient`, never to the engine directly** (`LocalGameClient` now, `RemoteGameClient` later). UI reads state only through `useGameState()` / `useGameClient()` and never imports engine rules to compute outcomes; read-only selectors are fine (list in CODEMAP). Attribute values come from engine selectors, never `character.attributes` alone; gear stats, prices and colours from the **instance**, never the catalog `ItemDef` alone (CODEMAP).
5. **Combat produces a log**; the UI replays it. Visuals never affect outcomes.
6. **Saves are versioned** (`saveVersion`); add a migration when the shape changes.
7. **Tunables live in data** (`src/engine/config`), not code.

Engine rules get Vitest tests. UI stays thin.

**Navigation:** Expo Router, routes in `src/app/` (non-route code outside it). Each village sign opens its own `fullScreenModal` route; sub-views stay inside the modal, never push a screen inside the tabs. **Every village modal is built on `ModalScreen`** (no hand-rolled header, no `<SafeAreaView>`) and listed in `VILLAGE_MODAL_PATHS`. Details: CODEMAP.

## Expo has changed: do not trust your training data

Before touching an Expo, EAS or React Native API, read the `expo` major in `package.json` (SDK 58) and fetch `https://docs.expo.dev/versions/v<major>.0.0/` (or https://docs.expo.dev/llms.txt and its links). Don't answer from memory.

## Commands

```bash
npx expo install <package>  # ALWAYS instead of npm add (SDK-compatible versions)
npx expo start              # dev server (--tunnel for a phone on another network)
npm run typecheck           # tsc --noEmit
npm test                    # Vitest (tests/)
npx expo-doctor             # dependency/config issues
```

Done means: `npm run typecheck` and `npm test` pass and `npx expo export --platform all` bundles (iOS + Android only).

## Native rules

- `app.json` `expo.platforms` stays `["ios", "android"]`; otherwise `eas update --platform all` bundles web, which fails (expo-sqlite's web worker needs wasm). CI runs the export on every PR.
- `ios/` and `android/` are generated (CNG): never create or edit them; configure via `app.json` and config plugins.
- Expo Go only has its bundled native modules. Use Expo Go compatible libraries so the EAS Update → Expo Go preview keeps working; a native module outside it means a development build: flag it first.
- Use EAS (`npx eas-cli@latest ...`) for real builds and OTA updates when needed.
