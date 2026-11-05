# Code map

Where code lives, and the detail behind the one-line rules in [`AGENTS.md`](../AGENTS.md). Read it on demand, when locating code; it is not loaded at session start. Moved here from AGENTS.md on 2026-11-04 (chore/agent-context-diet) without changing the rules.

Contents: Navigation and modals · Layout · UI state and read-only selectors · Art and emoji · Village map · Project and branching detail.

## Navigation and modals

Navigation uses **Expo Router**. Routes live in `src/app/`; every file there is a screen and `_layout.tsx` files define navigators. The root is a Stack (`expo-router/stack`) holding the `(tabs)` group plus one route per village modal. Tabs come from `expo-router/js-tabs` (the root `Tabs` export is deprecated in SDK 58). Keep non-route code outside `src/app/`.

**Village sign = full-screen modal.** A sign opens its own route with `presentation: 'fullScreenModal'` (iOS full screen, no swipe-down; Android falls back to `modal`) and an in-screen ✕. Sub-views (e.g. a dungeon's detail) stay inside the modal; never push a screen inside the tabs. Android back steps out of a sub-view before it closes the modal (`BackHandler` in the modal). Under Reduce Motion the modal fades instead of sliding. Each modal route must be listed in `VILLAGE_MODAL_PATHS` (`src/components/village/modalPaths.ts`) and hosts its own `<AwayModal />` (iOS cannot present the root's RN Modal over a full-screen modal).

**Every village modal is built on `ModalScreen`** (`src/components/ModalScreen.tsx`): it draws the header row (✕ + title + a compact right slot, plus optional rows under it; a building's modal passes `buildingId` and gets its current level's bonus line, "Lv3 · −19% craft time"), pads for the safe area and mounts the screen's `<AwayModal />` and `<UnlockBanner />`. Do not hand-roll a modal header or wrap a modal in `<SafeAreaView>`: on iOS a `fullScreenModal` lives outside the root `SafeAreaProvider`'s native view, so the native `SafeAreaView` reads its own insets while the modal is still off-screen (top = 0) and never updates, and the header ends up under the status bar. `ModalScreen` uses `useSafeAreaInsets()` (root window insets via context) instead.

**Dialogs per screen root:** An RN `<Modal>` can't present over another one or over a full-screen modal from the root on iOS: dialogs are hosted per screen root (root layout + ModalScreen), and popovers / pickers step aside while a dialog or the away summary is up.

## Layout

```
src/app/              routes: _layout.tsx (fonts, GameProvider, root Stack: tabs group + village modals, away modal),
                      (tabs)/_layout.tsx (tabs + activity strip), (tabs)/index.tsx (Village), (tabs)/hero.tsx (Hero),
                      dungeon.tsx (Dungeon full-screen modal), training.tsx (Training full-screen modal),
                      woodcutting.tsx (Woodcutting full-screen modal), mine.tsx (Mine Shaft full-screen modal),
                      merchant.tsx (Merchant full-screen modal), town-hall.tsx (Town Hall full-screen modal),
                      crafting.tsx (Crafting full-screen modal)
src/components/       UI building blocks (PixelButton, Panel/Bar, LiveBar, VillageScene (pan + pinch map), ActivityStrip, AwayModal, UnlockBanner, ModalScreen, DebugPanel, StatusPanel (incl. spending level-up points))
src/components/art/   the art registry (images.ts: require() maps by game id, unknown item → icons/unknown) and the image components (Sprites.tsx)
src/components/hud/   HeroHud (top-left hero HUD on the Village tab only: portrait, level, HP / mana / stamina / XP bars, "+N" points badge; the Hero tab has no HUD and shows the level in its Header panel), hudLayout.ts (its fixed size; the Village map's top reserve)
src/components/ui/    UI kit: GameDialog (provider + hosts + useDialog), InfoPopover (+ rows, actions, measureAnchor), useHoldRepeat, useCommand, insets
src/components/village/ villageMap.ts: world size, start framing (CORE), building pieces + sign anchors (from village_layout.json), empty plots, camera limits / clamp (pure, tested)
src/components/dungeon/  Dungeon modal (list + in-modal detail), LiveFight (the fight in progress), FightReplay, run-cancel confirmation
src/components/training/ Training modal (tier panel + one row per attribute, stamina speed-up on the active row)
src/components/woodcutting/ Woodcutting modal (header with level/XP/WS/stamina, paged tree carousel)
src/components/mining/ Mine Shaft modal (mirrors Woodcutting: level/XP/MS/stamina, paged rock carousel)
src/components/buildings/ BuildSheet (a locked building's requirements + Build, as an InfoPopover), UpgradeSheet + UpgradeEntry (level, bonuses, cost, builder; InfoPopover),
                      TownHallModal (level, workers: hire / assign picker / unassign / dismiss, crews, upkeep), bonusText (bonus lines, currentBonusLine)
src/components/workers/ NodeWorkers (the "Workers: X free / Y hired" line and the crew row with [−] / [+] on Woodcutting / Mine cards; selectors nodeChoices + workersView), pickWorker (pure: first free worker, last worker on a node)
src/components/items/  ItemSlot (rarity-framed slot: the instance's colour, reports its anchor), ItemSheet (item InfoPopover + actions: rarity-coloured name,
                      "Green · Quality 73%", quality-scaled stats and equip deltas, rarity-scaled prices), QuantityStepper, itemInfo (labels, subtitle, stat lines)
src/components/merchant/ Merchant modal (Buy | Sell tabs, stock grid, refresh charges, buy/sell sheets)
src/components/crafting/ Crafting modal (8 pipe rows: a continuous material pipe shows "Crafted N", the craft's progress with a live "xx.yy%",
                      Insta, ×10 and Stop, or why it waits; a gear pipe Insta / Cancel, "✓ Ready — Done" and the reveal popover; the header's
                      Recipes button and an idle pipe's "Craft…" open the recipe list sub-view: Materials tab, Equipment tab with gear cards
                      and the stamina stepper; Recipes starts go into the first free pipe)
src/engine/           pure TS game rules: types, rng, progression, simulate, commands, stats (derived stats), stamina, hp (current HP + regen; regenHeroPools = HP + mana), mana (current mana + regen), regen (shared integer banking),
                      dungeon (runs = search + live fight, skip, per-dungeon counters, unlocks), combat (strike timing, damage, log), danger (danger hint), hash, migrations,
                      replay (spans + MIGRATE anchors), training (tiers, timed training, views),
                      attributes (normal = spent + extra, core = training level, total; core DEX / INT time reductions, activityTimeMs, attributeViews; SPEND_ATTRIBUTE_POINTS in commands), woodcutting (WS, trees, logs, skip, views),
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
                      saveSlot.ts (which SQLite file this build uses: slot from EXPO_PUBLIC_SAVE_SLOT, name rules), seedSave.ts (one-time dev seed from idle-game.db,
                      openSlotDatabase and its failure rules), createAppClient.ts (wires them to expo-sqlite), buildLabel.ts (build label for the Debug panel)
app.config.ts         dynamic Expo config over app.json: only `name` changes per build ("Idle Game" / "Idle Game · dev" / "Idle Game · <branch>"), from EXPO_PUBLIC_BUILD_LABEL
src/theme.ts          palette and fonts
tests/                Vitest tests (engine rules, time rules, client, real SQL via node:sqlite, engine import guard, golden hash + frozen save fixtures)
.github/workflows/  ci.yml (typecheck, tests, export on every PR), eas-update.yml (main and dev publish to Expo Go), expo-preview.yml (PR label `expo-test`: preview publish + cleanup)
docs/PRODUCT.md       product decisions (owned by the product owner)
docs/ENGINE.md        engine, time rules, XP curve, storage and action-log design
assets/images/        the pixel art, generated by tools/art (see tools/art/README.md; never edit the PNGs by hand): village/ (background
                      + one sprite per building + village_layout.json), portrait/, enemies/ (+ variants/, unused), icons/, items/
                      (one per ItemId), trees/, manifest.json
tools/art/            the art generator (Python + numpy, scipy, Pillow; deterministic): `cd tools/art && python3 build_assets.py ../..`
```

## UI state and read-only selectors

UI reads state only through `useGameState()` / `useGameClient()` (`src/client/GameProvider.tsx`). Never import engine rules into a screen to compute game outcomes; read-only selectors (`activityView`, `dungeonRunView` (search countdown or the live fight), `dungeonUnlockView`, `dungeonTotals`, `dangerHint`, `hpView`, `manaView`, `itemQuantity`, `getDerivedStats`, `staminaView`, `trainingView`, `woodcuttingView`, `woodcutActivityView`, `woodcuttingStrength`, `miningView`, `mineActivityView`, `miningStrength`, `buildingView`, `isBuilt`, `buildingLevel`, `upgradeView`, `constructionView`, `workersView`, `crewViews`, `nodeChoices`, `sellPriceOf`, `yieldMultiplierBp`, `effectiveAttributes`, `normalAttributes`, `coreAttributes`, `attributeViews`, `dexActivityReductionBp`, `searchMsFor`, `logMsFor`, `oreMsFor`, `merchantView`, `maxBuyable`, `slotsNeeded`, `freeSlots`, `getItemDef`, `craftingView`, `craftJobView`, `craftingSign`, `recipeView`, `firstFreePipe`, `x10TapCost`, `stopRefund`, `intCraftReductionBp`, `levelBonuses`, `collectedItemId`, `gearQualityFloor`, `gearStats`, `gearStatsAt`, `rarityOf`, `qualityOf`, `baseSellPrice`, `sellPriceOfItem`, `isGearDef`) are fine. Anything that shows or uses an attribute's value reads the engine selectors: the **total** (`effectiveAttributes`: spent + stored extra + core) for linear effects (incl. STR → WS / MS since 1.17.0), the **core** part (training levels) for DEX / INT time, and `attributeViews` for the Status popover; never `character.attributes` alone (it holds only the stored extra normal points; the player's spent points are `character.spentPoints`, the points still to spend `character.unspentPoints`). Anything that shows a gear stat, price or colour reads the **instance** (`gearStats(item)`, `sellPriceOfItem`, `rarityOf(item)`), never the catalog `ItemDef` alone (catalog gear stats are 100% maxima).

## Art and emoji

**Art and emoji:** no emoji in any text (owner decision 2026-11-04): symbols are pixel-art images next to the text, from the client registry `src/components/art/images.ts` (static `require()` maps keyed by game ids) through `GameIcon`, `ItemIcon`, `EnemySprite`, `HeroPortrait`, `NodeIcon`, `SkillIcon` and `IconText` (`src/components/art/Sprites.tsx`); `PixelButton`'s `icon` / `sublabelIcon` take an icon name. The engine stays image-free (its config `icon` fields are unused, tech debt). `tests/art.test.ts` checks every ItemId / EnemyId / tree / rock / skill has its art; `tests/noEmoji.test.ts` fails on any emoji in `src/` outside `engine/migrations.ts` and engine config `icon` fields. Plain ✕ ✓ ✗ are text.

## Village map

The village is a background without buildings plus one sprite per building, drawn back to front at their world px box (`assets/images/village/village_layout.json`, read by `src/components/village/villageMap.ts` as `PIECES`); a building that is not built yet is not drawn (its sign stays, greyed with the locked icon); decor cottages always are. **Signs scale with the map** (2026-11-05): each sign is drawn in **screen space** (outside the transformed map view; `village/SignButton.tsx` is PixelButton's sign look at a scale) with its real layout size = natural (44 tall, 18 pt label) × `SIGN_SCALE` (0.5) × the settled zoom, like the buildings (label 14 pt at the start zoom on 375 pt); its position follows the map (`tx + x × zoom`, `ty + y × zoom`, top-centred); its tap area is the button plus `SIGN_HIT_SLOP` inside padded wrappers (`SIGN_TOUCH_H`, 48 pt at start on 375 pt; the slop must lie inside the parents' bounds for Android); the timer badge under it scales with it. **Crisp text:** any GPU scale resamples the pixel font, so signs are never scaled at rest: `VillageScene` keeps a `settledZoom` state (set at the camera init and by one `scheduleOnRN` at pinch end); signs are laid out for it (font rounded to whole points, boxes to whole device pixels), and during a pinch only get a transform scale of `zoom / settledZoom` on the UI thread (a pan never changes size). **One anchor rule** (`signAnchor` in `villageMap.ts`): centred on the building piece's box, its top edge on the box's bottom edge (`SIGN_GAP` = 0); the layout's old `sign` fields are no longer read. The only exceptions are listed in `SIGN_NUDGE` (Woodcutting −7, Town Hall +7 world px, so their padlocked signs do not overlap). If the artwork changes, re-run `tools/art` (the layout updates itself) and check `CORE` (the start framing: it is centred on the buildings plus the signs under them) and `PLOTS`. The map pans and zooms (Gesture Handler v3 hooks + Reanimated, UI thread only, no setState in gestures); it opens centred on the core between the hero HUD and the activity strip (`topReserve` = `hudBottom(top inset)` from `src/components/hud/hudLayout.ts`, `bottomReserve`); `tests/villageMap.test.ts` checks, in world px, that every sign follows the rule, stays inside the world and overlaps no other sign, and that every core sign is visible at start, below the HUD, on 375×667, 390×844 and 430×932 (label ≥ 13 pt, tap area ≥ 44 pt there).

## Project and branching detail

Mobile idle/incremental RPG inspired by Gladiatus. POC scope: two tabs. **Village** (main screen: pixel village background with buttons for Storage, Merchant, Dungeon, Training, Woodcutting, Mine Shaft, Town Hall, Crafting; buildings that must be built first show a locked sign that opens a Build sheet; built buildings upgrade through an Upgrade sheet in their modal, and the Town Hall runs the workers) and **Hero** (stats, XP, equipment slots, inventory, skills). Combat is automated and non-interactive; the UI only visualizes it.

| Branch | Role | Publishes to Expo Go | Who merges |
| --- | --- | --- | --- |
| `main` | Stable: only code the owner tested on `dev`. Protected by a ruleset (PR + `CI` check, merge commit only). | EAS branch `main` | Owner only, via release PR `dev` → `main` |
| `dev` | Integration and test preview. Default branch, so new PRs target it. | EAS branch `dev` | Owner only |
| `feat/*`, `fix/*`, `chore/*`, `exp/*` | One task each, cut from `origin/dev`, PR into `dev` | Only while its PR has the label `expo-test` (EAS branch = git branch, own save slot; `.github/workflows/expo-preview.yml`) | — |

Each build has its own save file (`src/client/saveSlot.ts`): `main` keeps `idle-game.db`, `dev` uses `idle-game-dev.db`, a preview `idle-game-<branch>.db`. Only the owner adds the `expo-test` label.

Flow: `feat/*` → PR into `dev` (CI + council) → owner merges → `dev` preview → owner tests in Expo Go → release PR `dev` → `main` → owner merges → `main` preview.
