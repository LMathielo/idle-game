# Tech debt

Review findings that scored **below the fix bar (confidence < 80)** and were not fixed in their PR. Owned by the product owner; the review council appends here after every round (`.claude/skills/pr-review-council/SKILL.md`, step 7). A periodic `chore/cleanup` PR works through this list.

Format: `[PR #, confidence] file — issue. Fix.` Delete an item when the PR that fixes it merges (mention it in that PR's release note). Bigger design follow-ups live in the roadmap in [`STATUS.md`](STATUS.md), not here.

Last gathered: 2026-10-31, from the review comments on PRs #2–#19 and checked against `dev` (engine 1.12.0).

## UI / React Native

- [#11, 65] `woodcutting/WoodcuttingModal.tsx` `TreeCard` (and `mining/MineModal.tsx` rock card) — `memo` without a comparator, so every card re-renders each tick. Add a custom comparator.
- [#2/STATUS] `merchant/MerchantModal.tsx` — the double-tap guard (`busy`) is React state, so a fast second tap can read a stale value. Use a `useRef` in-flight guard, like the other modals, or `useCommand`.
- [#19, 40] `VillageScene.tsx` `measureRoot` / `press` — the tap-time `measureInWindow` is async, so the anchor uses the previous measurement and the comment overstates it. Build the anchor inside the measure callback.
- [#19, 40] `ui/InfoPopover.tsx` + `ui/GameDialog.tsx` — a popover's Modal is hidden and a dialog's shown in the same commit; iOS may drop the second one (promise never resolves). Check on device; if it fails, show the dialog after the popover's `onDismiss`.
- [#19, 35] `ui/useHoldRepeat.ts` — the second tap of a fast double-tap is dropped silently by the `useCommand` in-flight guard. Decide: accept as designed or queue it.
- [#19, 30] `ui/GameDialog.tsx` `close` — resolves the promise inside the `setQueue` updater (impure; StrictMode double-invokes). Resolve outside, then set state.
- [#19, <80] `PixelButton.tsx` `repeat` — an action returning `void` counts as success, so it would repeat forever. Require a `boolean` return.
- [#19, <80] `buildings/UpgradeSheet.tsx`, `BuildSheet.tsx` — hand-rolled in-flight guards duplicate `useCommand`. Switch to it.
- [#6, 45] `dungeon/FightReplay.tsx:58,73` — on Android the result may be read twice (announcement + live region). Keep one mechanism.
- [#2, 40] `ActivityStrip.tsx` — no `maxFontSizeMultiplier`; very large accessibility text overflows the fixed 44pt strip. Cap at ~1.3.
- [#2, 25] Hero equipment cells may read the item name twice to screen readers (unverified since the #19 popover rework).
- [#2, <80] `AwayModal` — an open "While you were away" doesn't add a later short resume to its totals (display only; rewards are saved).
- [#19, note] Village map pixel art is bilinear-upscaled when zoomed (up to ~1.4× native), so it looks soft. Visual call: nearest-neighbour or a higher-res PNG.
- [#22, 40] "✓ Ready" green text on `woodDark` isn't in `tests/theme.test.ts`. Add the pair to the contrast test.
- [#23, 62] `crafting/CraftingModal.tsx` ~316 — the ×10 disabled reason ("Needs 12 Iron Ore") is a one-line sublabel on a ~105 pt button at 375 pt and may truncate. Put ×10 on its own row or show the reason as a line under the buttons.
- [#25, 55] `hud/HeroHud.tsx` — the fixed-size HUD's texts scale with the OS font size and get clipped by `overflow: hidden`. Set `allowFontScaling={false}` or `maxFontSizeMultiplier={1}` on the HUD texts.
- [#25, 35] `StatusPanel.tsx` `useSpending.confirm` — a fast double tap on Confirm can queue two dialogs; confirming both spends twice (no refunds). Add an in-flight ref or disable Confirm while confirming.
- [#25, 30] `app/(tabs)/index.tsx` — the Village tab stays mounted while the Hero tab is shown, so its HUD keeps recomputing each tick (the Hero tab has no HUD since 2026-11-05). Gate with `useIsFocused` or use `freezeOnBlur`.
- [#25, 15] `StatusPanel.tsx` `confirm` — pending edits made while the send is in flight are wiped by `update(NO_PENDING)`. Clear only if pending still equals the sent payload.
- [#30, 30] `woodcutting/WoodcuttingModal.tsx`, `mining/MineModal.tsx` — `wk` is a new object each tick so `renderItem` is recreated every tick (cards stay memoized; same as `crewOf`). Key the deps on primitive signatures.
- [#30, 25] `workers/NodeWorkers.tsx` — a fast second tap on [+] is dropped by the `useCommand` in-flight guard (same as the #19 item); no test covers `nodeWorkersInfo`'s disabled combinations. Add one.
- [#32, 25] `app/merchant.tsx` — the `/merchant` route has no unbuilt guard; a deep link or dev navigation opens the modal on an unbuilt Merchant (the engine refuses every command with `BUILDING_LOCKED`). Redirect, or show a "Build the Merchant first" state.

- [first boss, note] Boss art is a PLACEHOLDER: `enemies/variants/stone_troll.png` for the Troll Chieftain and `items/troll_hide.png` for the Chieftain's Tusk (`components/art/images.ts`, marked PLACEHOLDER; `tests/art.test.ts` lists them). **Real art pending owner approval** (art pipeline in `tools/art` untouched).
- [PR #34, 55] `src/components/dungeon/DungeonModal.tsx:587`, `src/components/dungeon/LiveFight.tsx:29` — UI recomputes boss regen with hard-coded 10_000. Use `danger.regenPerSec` / `BASIS_POINTS` or an engine helper.
- [PR #34, 45] `DungeonModal.tsx` BossDetail, `src/engine/danger.ts` bossDangerHint — hard-code `COMBAT_SKILLS.heavy_bash` instead of reading `ENEMIES[...].skills`. Resolve from the enemy's skills.
- [PR #34, 40] `config/skills.ts` description, BossDetail reward text, `src/components/AwayModal.tsx` boss name — tunables repeated as prose. Build from config or test they match; derive the boss name from BOSS_IDS.
- [PR #34, 30] Woodcutting / Mine / Training modals — inline "starting stops…" note missing for `boss` (confirm dialog still covers it). Add a boss line.
- [PR #34, 25] BossDetail reveal effect — skipped when the replay panel is open (`lastBoxRef` null); View recovers. Clear replay on a new fight or fall back to the Fight panel anchor.
- [first boss, 30] `AwayModal.tsx` — the boss line names the only boss (`BOSSES.troll_chieftain`) because `summary.boss` is one aggregate `{fights, wins, losses}`. With a second boss the summary needs counters per boss.
- [PR #35, 40] `src/app/(tabs)/hero.tsx` EquipmentPanel — switching Combat/Tools leaves an open slot popover anchored to a slot no longer drawn; panel height jumps. Fix: clear the selection on tab change, give the grid a minHeight.
- [PR #36, 30] `src/components/StatusPanel.tsx` `regenNote` — computes (100 + perk) / 100 in the UI. Fix: take the multiplier from a selector, or word it "+P% from gear perks".
- [PR #36, 15] `src/components/items/ItemSheet.tsx:52` — row key `${label}-${value}`. Fix: include the index.
- [PR #37, 60] `src/components/crafting/RecipePicker.tsx` RecipeTile — memo never hits (craftingView builds new recipe objects each tick), so open tiles re-render every second. Add a comparator like samePipeRow.
- [PR #37, 40] `src/components/crafting/RecipePicker.tsx` RecipeInfo — on 375x667 the gear Craft button can sit below the fold of the scrolling popover. Pin Craft in a footer or move Details after it.
- [PR #37, 35] `src/components/crafting/RecipePicker.tsx` onTile — a null measureAnchor drops the tap. Use the centred fallback anchor.
- [PR #37, 20] `src/components/crafting/CraftingModal.tsx` onCraft label — "X started" can omit the pipe when no CRAFT_STARTED matches. Cosmetic.
- [PR #37, 15] `src/components/crafting/CraftingModal.tsx` onDone — measure runs before the in-flight guard; a double tap is harmless. Check the guard first if touched.
- [PR #39, 40] `src/components/ui/popoverLayout.ts` placePopover — the unmeasured fallback (150 ms timeout, h null) placed above uses boxH 0, so the box can cover the anchor or run off the bottom. Fix: when h is null use boxH = maxHeight (or force below) and add a test.
- [PR #40, 30] `src/components/ui/useSlotHitTest.ts` — a layout shift without a registration change (text wrap, a row appearing on level-up, a tile growing) leaves stale cached rects; a backdrop tap could switch to a neighbouring item. Fix: re-measure on content layout changes, or cap the cache age.
- [PR #40, 20] `src/app/(tabs)/hero.tsx` / `src/components/merchant/MerchantModal.tsx` — the hit-test cache is nulled only when `openToken` becomes null, not when it changes, so it can be stale for a few ms after the next open. Fix: null the cache on token change.

## Engine and data

- [PR #34, 40] `src/engine/config/skills.ts:21` — no-stun-lock invariant compares caster strikes vs target strikes; only holds at equal attack intervals. Make stun time-based or check in time; add a slow-hero (3000 ms) 100% stun test.

- [pixel art, note] `engine/config/*` (`ITEMS`, `GEAR_PIECES`, `ENEMIES`, `DUNGEONS`, `TREES`, `ROCKS`, `BUILDINGS`), the views that copy them (`treeView`, `rockView`, `buildingView`, `constructionView`, worker / crew / node views) and stored `Item.icon` — the emoji `icon` fields are unused by the UI since the pixel art (art comes from `src/components/art/images.ts` by id). Remove them; `Item.icon` is in saves, so drop it in the next save migration (leave `engine/migrations.ts`' legacy literals alone). `tests/noEmoji.test.ts` allows exactly these fields until then.
- [PR #40, 45] `src/components/ui/InfoPopover.tsx` backdrop + the screens' `outsidePress` handlers — nothing guards the awaited measure: a double tap, or a close meanwhile (sell, dialog, back), can re-open or flicker. Fix: a selection ref + an in-flight ref; drop a late result if the popover closed or was re-presented.
- [PR #40, 30] `src/app/(tabs)/hero.tsx:51` — `hit.id in SLOT_LABELS` relies on item ids containing '#' (false for stackables and `start-<defId>` ids) and `in` matches prototype keys. Fix: `eq:` / `inv:` prefixed keys or `Object.hasOwn`.
- [PR #40, 30] `src/components/ui/InfoPopover.tsx` / `useSlotHitTest.ts` — `pageX` / `pageY` and `measureInWindow` are assumed to share an origin on Android (translucent bars). Needs a device check; a mismatch offsets hits by the status-bar height.

- [#8, <80] `client/LocalGameClient.ts:316` — MIGRATE's `fromEngine` comes from the meta; read it from the last log row to cover a pre-1.4.0 install killed between update and first commit.
- [#19, 30] `engine/config/dev.ts` — `DEV_TOOLS_ENABLED = true` is hardcoded, so the Debug panel ships in every build, and held Debug buttons (grants) write a `DEBUG_*` row per tick. Gate on `__DEV__` (or an EAS env var) before any public build.
- [#9, note] Training's rate multiplier is integer-only. Revisit in the PR that gives INT an effect.
- [#21, 50] `engine/crafting.ts` — 8 pipes at the 1 s floor over 8 h offline emit ~230k `CRAFT_COMPLETED` events in one simulate (under the step guard). Aggregate events per pipe per simulate.
- [#21, 40] `engine/crafting.ts` `advancePipes` — `progressMs += ms × efficiency` is float; could be off by 1 ms at a split boundary with fractional efficiency. Use integer math like the workers.
- [#25, 20] `engine/replay.ts` — replay applies every command with `allowDebug: true`, so `DEBUG_ADD_UNSPENT_POINTS` replays as valid (pre-existing for all debug commands; `markDebugUsed` flags the save). Server-side replay should reject debug commands.
- [PR #35, 45] `src/engine/config/items.ts` iron_axe / iron_pickaxe — keep sell 180 (existing-item precedent) while the crafted-piece rule would give ~80; craft-and-sell is close to break-even with the Town Hall bonus. Fix: revisit in an economy pass.
- [PR #36, 35] `src/engine/equipment.ts` `clampPools` — runs only on equip / unequip. Fix: any future path that removes equipped gear (destroy, sell) must clamp too.
- [PR #36, 30] `src/engine/migrations.ts` `v21Slot` — infers the tool slot from the defId suffix when `slot` is missing (corrupt saves only). Fix: read the catalog slot.
- [PR #36, 25] `src/engine/gear.ts` `perkOf` — no check of the perk kind against the slot (save tampering only). Fix: validate on load once a server exists.

## Tests

- [#11, 60] No test asserts a Bird Nest drops from a single cut (only fixture totals). Add a seeded drop test.
- [#2, 55] `tests/golden.test.ts`, `tests/determinism.test.ts` — don't pass `{ allowDebug: true }`, so they break if `DEV_TOOLS_ENABLED` is turned off. Pass it.
- [#19, 45] `tests/migrationV12.test.ts` — the v12 totals use the live `SKILL_XP_CURVE`; a future rebalance breaks them though the migration is frozen. Freeze a `V12_CURVE` literal in the test; keep the live-config pins in a separate block.
- [#19, 45] `ui/useHoldRepeat.ts`, `ui/useCommand.ts` — no tests for the 400/100 ms schedule, stop on refusal/disable/unmount, or the one-at-a-time guard. Extract a pure scheduler and test it with fake timers.
- [#19, 25] Only woodcutting's "Lv15 ≈ 23.5 h" is tested. Tie `ROCKS` to `TREES` (same XP and base time) or run `hoursTo` over both.
- [#22, 30] No test for a nonzero `minQuality` (hook, 0 today). Add one when the first mechanic sets it.
- [#25, 40] `tests/dungeon.test.ts` (8 h cap test) — no longer asserts HP and mana are full after the 12 h beyond the cap. Assert both equal their max.
- [#25, 25] `tests/statPoints.test.ts` — no tick-vs-resume case for a spend mid-woodcutting with a hired crew. Add one.
- [#31, 30] `VillageScene.tsx` — the sign timer badge text is ~10 pt at the start zoom (below the 13 pt text rule; signs are 14 pt). Bigger badge font if it is hard to read on device.
- [#31, 20] `village/SignButton.tsx` — duplicates PixelButton's sign styles at a scale. Give PixelButton a `scale` prop and drop this file.
- [#26, 60] `tests/villageMap.test.ts` — the sign overlap test (now in world px, 2026-11-05) still uses hand-measured `LABEL_W` widths, so it won't notice a label or font change. Derive the widths from the real label metrics (or snapshot a measured layout) instead of constants.
- [#33, 40] `tests/statsRework.test.ts` — property tests stop at DEX ~600; nothing pins the crit-multiplier integer bound (exact up to ~6e9 DEX). Add one case with DEX 1e6 asserting a safe integer and the exact `dealt`.

- [PR #34, 50] `tests/golden119.test.ts:176` — 1.19 hash re-pinned (fff9656e → 2e1282a3) without proof. Hash `asV19(s)` against the old pin like the 1.13–1.17 pins (move the helper to tests/helpers.ts).
- [PR #35, 30] `tests/crafting.test.ts`, `tests/gear.test.ts` — hard-coded catalog counts and iron skip list. Fix: derive from GEAR_SETS × GEAR_PIECE_IDS.
- [PR #38, 55] `tests/craftingDebug.test.ts` — no split-invariance test for a forced material job (a→b→c vs a→c, including held then released). Add one.
- [PR #37, 40] `src/components/crafting/CraftingModal.tsx` presentReveal — the 400 ms gap before a new reveal is untested. Extract a pure `revealDelayMs` and unit-test it.
- [PR #39, 30] `tests/popoverLayout.test.ts` — the "new anchor never reuses the old height" test duplicates the measuredFor test; hook ordering is verified on device only. Fix: drop or annotate.
- [PR #40, 40] `tests/slotHitTest.test.ts` — only the pure helpers are tested. Extract the tap decision (hit vs same item vs miss) into a pure function and test it; add a partly clipped slot case.
- [PR #40, 40] tests — the `useSlotHitTest` cache (invalidation, generation drop, null fallback, open gating, close) and `InfoPopover`'s close / open branches are untested. Fix: extract the cache behind an injectable measure and test it with fake timers.

## Docs and workflow

- [#29, 40] `src/client/saveSlot.ts` `sanitizeSaveSlot` — lossy: `feat/a-b`, `feat/a_b` and `feat/a/b` share one save file, and a preview slot has no reset (a reused branch name keeps its old save). Fix: add a short hash of the raw branch name to the file name, or a Debug "reset this slot".
- [#29, 30] `.github/workflows/expo-preview.yml` (names step) / `saveSlot.ts` — the slot rule is written twice (shell and TS) and only the TS one is tested. Fix: pass the raw ref and let the app sanitize it, or add a parity test.
- [#19, 30] Stray double blank lines in `src/app/_layout.tsx` and `src/components/ui/GameDialog.tsx`.
- [#4, 70] `.claude/agents/game-engineer.md:53`, `pr-review-council/SKILL.md:18` — `$(cat pr.md)` / `$(cat review.md)` use relative paths; use `-F body=@/abs/path` so a missing file fails loudly.
- [#4, 45] `pr-review-council/SKILL.md:13-18` — `R=`/`$N` shell variables don't survive between agent tool calls; inline the repo and PR number.
- [#32, 25] `config/dungeons.ts`, `docs/PRODUCT.md`, `docs/ENGINE.md` — the locked-start decision is dated 2026-11-05 in some places and 2026-11-04 in others (same owner message, 2026-11-04 local). Use one date.
- [PR #37, 55] `src/client/types.ts` (DispatchResult.events doc) — says events include the time simulated before the command; only applyCommand's events are returned (pre-command advance() events go to rows / the away summary). Reword the comment.
- [PR #38, 50] `docs/ENGINE.md` debug tools paragraph — does not list Force craft / Finish now. Append them.
- [PR #38, 25] `docs/ENGINE.md` 1.23.0 note — a downgrade with a free job in flight would refund it (the old engine ignores `free`); accepted for debug. Add one line.
- [PR #40, 25] `src/app/(tabs)/hero.tsx` / `src/components/merchant/MerchantModal.tsx` - a single `busyScope` is overwritten by the latest send; going back to an item still in flight re-enables its buttons (the engine rejects the duplicate). Fix: a Set of in-flight scopes.
