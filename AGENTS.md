# AGENTS.md

Guide for AI agents (and humans) working in this repo. Read it fully before changing code.

## Project

Mobile idle/incremental RPG inspired by Gladiatus. POC scope: two tabs. **Village** (main screen: pixel village background with buttons for Storage, Merchant, Dungeon, Training, Woodcutting, Mine Shaft, Town Hall, Crafting; buildings that must be built first show a locked sign that opens a Build sheet; built buildings upgrade through an Upgrade sheet in their modal, and the Town Hall runs the workers) and **Hero** (stats, XP, equipment slots, inventory, skills). Combat is automated and non-interactive; the UI only visualizes it.

UI kit (`src/components/ui/`): **never use the native `Alert` API**: every confirmation and alert goes through **GameDialog** (`useDialog().confirm / alert / notPossible / saveFailed`; `useCommand()` dispatches with dialog errors). **Info → InfoPopover** (anchored on the tapped element via `measureAnchor`, actions inside, tap outside closes); no new bottom sheets for info. Repeated actions (stamina skips, speed-ups, debug) use PixelButton **`repeat`** (useHoldRepeat): repeat ticks must stay quiet and return false when refused. An RN `<Modal>` can't present over another one or over a full-screen modal from the root on iOS: dialogs are hosted per screen root (root layout + ModalScreen), and popovers / pickers step aside while a dialog or the away summary is up.

Visual style: medieval pixel art. Hard pixel bevels, no rounded corners. Fonts: Pixelify Sans Bold (`fonts.title`: titles, village signs, tab labels, headings) and Inter (`fonts.body` / `fonts.bodyBold`: body text, numbers, stats, logs, buttons, descriptions); body text stays ≥ 13 (only bar labels and slot badges go smaller). Colors and fonts live in `src/theme.ts`.

The owner works mostly from a phone. Keep that in mind:
- Push your work to your own branch on GitHub and open a PR; there is no "local copy" the owner can open.
- Every change on `dev` and `main` must build. A push to `dev` publishes the EAS Update branch `dev` (the owner's test preview); a push to `main` publishes EAS branch `main` (the last version he approved). He opens both in Expo Go. That is how he tests.
- Mobile only (iOS + Android). Do not add a web target.
- All work goes on a branch (`feat/`, `fix/`, `chore/`, `exp/`) and reaches `dev` by PR. Feature branches never publish to Expo Go.
- Keep PR descriptions short and readable on a phone screen.

## Workflow (how work gets done here)

- The orchestrating assistant is the **product owner**: it turns requests into task briefs, keeps `docs/PRODUCT.md` current and does not write game code. See `.claude/skills/product-owner/SKILL.md`.
- Coding is done by the **`game-engineer`** agent (`.claude/agents/game-engineer.md`) on a `feat/`, `fix/` or `chore/` branch cut from `origin/dev`, ending in a PR with **base `dev`**.
- Every PR into `dev` gets the **review council**, sized by complexity: 1 reviewer for small PRs (docs, small UI fixes), 2 for normal ones, 3 for high-risk ones (save/migrations, simulate/time, combat/economy formulas, replay/anti-cheat, CI), reviewers on Sonnet (`.claude/skills/pr-review-council/SKILL.md`, reviewers in `.claude/agents/code-reviewer.md`). Confirmed issues go back to the engineer; repeat until clean.
- **Only the owner merges, into `dev` and into `main`.** After he merges into `dev`, the `dev` preview publishes and he tests it in Expo Go. When he is happy, he opens and merges a release PR `dev` → `main`.
- Agents work in their own git worktree, push only to their branch with an explicit ref, and never merge, never push to `dev` or `main`, and never open the release PR unless the owner asks.
- `docs/STATUS.md` is the "where we are" page: current version, release notes, refined and unrefined roadmap. Every feature PR updates it (version, a release-notes line, the roadmap item it closes). Read it first in a new session.
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

Navigation uses **Expo Router**. Routes live in `src/app/`; every file there is a screen and `_layout.tsx` files define navigators. The root is a Stack (`expo-router/stack`) holding the `(tabs)` group plus one route per village modal. Tabs come from `expo-router/js-tabs` (the root `Tabs` export is deprecated in SDK 58). Keep non-route code outside `src/app/`.

**Village sign = full-screen modal.** A sign opens its own route with `presentation: 'fullScreenModal'` (iOS full screen, no swipe-down; Android falls back to `modal`) and an in-screen ✕. Sub-views (e.g. a dungeon's detail) stay inside the modal; never push a screen inside the tabs. Android back steps out of a sub-view before it closes the modal (`BackHandler` in the modal). Under Reduce Motion the modal fades instead of sliding. Each modal route must be listed in `VILLAGE_MODAL_PATHS` (`src/components/village/modalPaths.ts`) and hosts its own `<AwayModal />` (iOS cannot present the root's RN Modal over a full-screen modal).

**Every village modal is built on `ModalScreen`** (`src/components/ModalScreen.tsx`): it draws the header row (✕ + title + a compact right slot, plus optional rows under it; a building's modal passes `buildingId` and gets its current level's bonus line, "Lv3 · −19% craft time"), pads for the safe area and mounts the screen's `<AwayModal />` and `<UnlockBanner />`. Do not hand-roll a modal header or wrap a modal in `<SafeAreaView>`: on iOS a `fullScreenModal` lives outside the root `SafeAreaProvider`'s native view, so the native `SafeAreaView` reads its own insets while the modal is still off-screen (top = 0) and never updates, and the header ends up under the status bar. `ModalScreen` uses `useSafeAreaInsets()` (root window insets via context) instead.

## Layout

```
src/app/              routes: _layout.tsx (fonts, GameProvider, root Stack: tabs group + village modals, away modal),
                      (tabs)/_layout.tsx (tabs + activity strip), (tabs)/index.tsx (Village), (tabs)/hero.tsx (Hero),
                      dungeon.tsx (Dungeon full-screen modal), training.tsx (Training full-screen modal),
                      woodcutting.tsx (Woodcutting full-screen modal), mine.tsx (Mine Shaft full-screen modal),
                      merchant.tsx (Merchant full-screen modal), town-hall.tsx (Town Hall full-screen modal),
                      crafting.tsx (Crafting full-screen modal)
src/components/       UI building blocks (PixelButton, Panel/Bar, LiveBar, VillageScene (pan + pinch map), ActivityStrip, AwayModal, UnlockBanner, ModalScreen, DebugPanel, StatusPanel)
src/components/ui/    UI kit: GameDialog (provider + hosts + useDialog), InfoPopover (+ rows, actions, measureAnchor), useHoldRepeat, useCommand, insets
src/components/village/ villageMap.ts: world size, core offset, sign anchors, empty plots, camera limits / clamp (pure, tested)
src/components/dungeon/  Dungeon modal (list + in-modal detail), LiveFight (the fight in progress), FightReplay, run-cancel confirmation
src/components/training/ Training modal (tier panel + one row per attribute, stamina speed-up on the active row)
src/components/woodcutting/ Woodcutting modal (header with level/XP/WS/stamina, paged tree carousel)
src/components/mining/ Mine Shaft modal (mirrors Woodcutting: level/XP/MS/stamina, paged rock carousel)
src/components/buildings/ BuildSheet (a locked building's requirements + Build, as an InfoPopover), UpgradeSheet + UpgradeEntry (level, bonuses, cost, builder; InfoPopover),
                      TownHallModal (level, workers: hire / assign picker / unassign / dismiss, crews, upkeep), bonusText (bonus lines, currentBonusLine)
src/components/items/  ItemSlot (rarity-framed slot: the instance's colour, reports its anchor), ItemSheet (item InfoPopover + actions: rarity-coloured name,
                      "Green · Quality 73%", quality-scaled stats and equip deltas, rarity-scaled prices), QuantityStepper, itemInfo (labels, subtitle, stat lines)
src/components/merchant/ Merchant modal (Buy | Sell tabs, stock grid, refresh charges, buy/sell sheets)
src/components/crafting/ Crafting modal (8 pipe rows: a continuous material pipe shows "Crafted N", the craft's progress with a live "xx.yy%",
                      Insta, ×10 and Stop, or why it waits; a gear pipe Insta / Cancel, "✓ Ready — Done" and the reveal popover; the header's
                      Recipes button and an idle pipe's "Craft…" open the recipe list sub-view: Materials tab, Equipment tab with gear cards
                      and the stamina stepper; Recipes starts go into the first free pipe)
src/engine/           pure TS game rules: types, rng, progression, simulate, commands, stats (derived stats), stamina, hp (current HP + regen),
                      dungeon (runs = search + live fight, skip, per-dungeon counters, unlocks), combat (strike timing, damage, log), danger (danger hint), hash, migrations,
                      replay (spans + MIGRATE anchors), training (tiers, timed training, views),
                      attributes (normal = level points + extra, core = training level, total; core DEX / INT time reductions, activityTimeMs, attributeViews), woodcutting (WS, trees, logs, skip, views),
                      mining (MS, rocks, ores, skip, views), gathering (power-based yield math), buildings (locked/built, BUILD,
                      UPGRADE_BUILDING, the builder, requirement / upgrade / construction views), bonuses (per-level building bonuses),
                      workers (hire, assign, crews, upkeep, views), world (the world walk: hero activity + builder + crews in time order),
                      upgradeEffects (what an upgrade changes besides the level),
                      merchant (stock roll, refresh charges, buy/sell), equipment (equip/unequip/use),
                      crafting (continuous material pipes: inputs per craft, waiting, START_CRAFT (a pipe or the first free one) /
                      INSTA_CRAFT / X10_CRAFT / STOP_CRAFT, craft time, yield ledger; gear jobs: roll at start, CANCEL_CRAFT, ready,
                      COLLECT_CRAFT; views), gear (gear quality and rarity: scaled stats and prices, rolls),
                      diminishing (diminishingBp: the shared diminishing-returns curve)
src/engine/config/    tunables as data: xpCurve, woodcutting (WS, trees, skip), mining (MS, rocks, skip; own numbers), buildings (requirements, upgrade costs, per-level bonuses), workers (hire, crew share, upkeep), dungeons (search time, skip, combat incl. fight time limit, enemies with attack intervals, dungeons), items (catalog: rarity, description, prices, damage/armor/WS/MS maxima at 100% quality, heal, crafted gear sets), merchant (charges, fixed slot, random pool, starter stock),
                      crafting (pipes, material and gear recipes, ×10 tap and insta stamina), gear (quality/rarity formulas, Merchant and crafting rolls, gear sets and pieces), stats (incl. HP regen, STAT_EFFECTS), stamina, time, newGame, training (curve, tiers, prices), dev (DEV_TOOLS_ENABLED)
src/client/           GameClient boundary: LocalGameClient, repositories (SQLite / in-memory), clock, React provider + hooks
src/theme.ts          palette and fonts
tests/                Vitest tests (engine rules, time rules, client, real SQL via node:sqlite, engine import guard, golden hash + frozen save fixtures)
docs/PRODUCT.md       product decisions (owned by the product owner)
docs/ENGINE.md        engine, time rules, XP curve, storage and action-log design
assets/images/        village.png (generated by tools/generate-village.py: 360x560 world with the 180x390 village as its core, upscaled 4x)
```

UI reads state only through `useGameState()` / `useGameClient()` (`src/client/GameProvider.tsx`). Never import engine rules into a screen to compute game outcomes; read-only selectors (`activityView`, `dungeonRunView` (search countdown or the live fight), `dungeonUnlockView`, `dungeonTotals`, `dangerHint`, `hpView`, `itemQuantity`, `getDerivedStats`, `staminaView`, `trainingView`, `woodcuttingView`, `woodcutActivityView`, `woodcuttingStrength`, `miningView`, `mineActivityView`, `miningStrength`, `buildingView`, `isBuilt`, `buildingLevel`, `upgradeView`, `constructionView`, `workersView`, `crewViews`, `nodeChoices`, `sellPriceOf`, `yieldMultiplierBp`, `effectiveAttributes`, `normalAttributes`, `coreAttributes`, `levelPoints`, `attributeViews`, `dexActivityReductionBp`, `searchMsFor`, `logMsFor`, `oreMsFor`, `merchantView`, `maxBuyable`, `slotsNeeded`, `freeSlots`, `getItemDef`, `craftingView`, `craftJobView`, `craftingSign`, `recipeView`, `firstFreePipe`, `x10TapCost`, `stopRefund`, `intCraftReductionBp`, `levelBonuses`, `collectedItemId`, `gearQualityFloor`, `gearStats`, `gearStatsAt`, `rarityOf`, `qualityOf`, `baseSellPrice`, `sellPriceOfItem`, `isGearDef`) are fine. Anything that shows or uses an attribute's value reads the engine selectors: the **total** (`effectiveAttributes`: level points + stored extra + core) for linear effects, the **core** part (training levels) for DEX / INT time and STR gathering power, and `attributeViews` for the Status popover; never `character.attributes` alone (since 1.16.0 it holds only the stored extra normal points). Anything that shows a gear stat, price or colour reads the **instance** (`gearStats(item)`, `sellPriceOfItem`, `rarityOf(item)`), never the catalog `ItemDef` alone (catalog gear stats are 100% maxima).

Village sign positions are world pixels of the artwork (`SIGNS` in `src/components/village/villageMap.ts`, printed by `tools/generate-village.py`). If the background changes, re-run the script and update them (and `PLOTS`). The map pans and zooms (Gesture Handler v3 hooks + Reanimated, UI thread only, no setState in gestures); it opens centred on the core between the HUD and the activity strip (`topReserve` / `bottomReserve`); `tests/villageMap.test.ts` checks every sign is visible at start on 375×667, 390×844 and 430×932.

## Native rules

- **Mobile only:** `app.json` `expo.platforms` must stay `["ios", "android"]`. Without it, `eas update --platform all` also bundles web, which fails (e.g. expo-sqlite's web worker needs wasm). CI runs `npx expo export --platform all` on every PR to catch this.
- `ios/` and `android/` are generated (Continuous Native Generation). Never create or edit them by hand; configure via `app.json` and config plugins.
- Expo Go only includes its bundled native modules. Prefer libraries that work in Expo Go, so the EAS Update → Expo Go preview keeps working. Adding a native module outside Expo Go means switching to a development build; flag it before doing so.
- Use EAS (`npx eas-cli@latest ...`) for real builds and OTA updates when needed.
