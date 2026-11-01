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
- [#19, 25] `ui/InfoPopover.tsx` — when the anchor changes, the box shows one frame with the old height. Key the state by anchor or reset during render.
- [#19, <80] `PixelButton.tsx` `repeat` — an action returning `void` counts as success, so it would repeat forever. Require a `boolean` return.
- [#19, <80] `buildings/UpgradeSheet.tsx`, `BuildSheet.tsx` — hand-rolled in-flight guards duplicate `useCommand`. Switch to it.
- [#6, 45] `dungeon/FightReplay.tsx:58,73` — on Android the result may be read twice (announcement + live region). Keep one mechanism.
- [#2, 40] `ActivityStrip.tsx` — no `maxFontSizeMultiplier`; very large accessibility text overflows the fixed 44pt strip. Cap at ~1.3.
- [#2, 25] Hero equipment cells may read the item name twice to screen readers (unverified since the #19 popover rework).
- [#2, <80] `AwayModal` — an open "While you were away" doesn't add a later short resume to its totals (display only; rewards are saved).
- [#19, note] Village map pixel art is bilinear-upscaled when zoomed (up to ~1.4× native), so it looks soft. Visual call: nearest-neighbour or a higher-res PNG.
- [#22, 40] "✓ Ready" green text on `woodDark` isn't in `tests/theme.test.ts`. Add the pair to the contrast test.

## Engine and data

- [#8, <80] `client/LocalGameClient.ts:316` — MIGRATE's `fromEngine` comes from the meta; read it from the last log row to cover a pre-1.4.0 install killed between update and first commit.
- [#19, 30] `engine/config/dev.ts` — `DEV_TOOLS_ENABLED = true` is hardcoded, so the Debug panel ships in every build, and held Debug buttons (grants) write a `DEBUG_*` row per tick. Gate on `__DEV__` (or an EAS env var) before any public build.
- [#9, note] Training's rate multiplier is integer-only. Revisit in the PR that gives INT an effect.
- [#21, 50] `engine/crafting.ts` — 8 pipes at the 1 s floor over 8 h offline emit ~230k `CRAFT_COMPLETED` events in one simulate (under the step guard). Aggregate events per pipe per simulate.
- [#21, 40] `engine/crafting.ts` `advancePipes` — `progressMs += ms × efficiency` is float; could be off by 1 ms at a split boundary with fractional efficiency. Use integer math like the workers.

## Tests

- [#11, 60] No test asserts a Bird Nest drops from a single cut (only fixture totals). Add a seeded drop test.
- [#2, 55] `tests/golden.test.ts`, `tests/determinism.test.ts` — don't pass `{ allowDebug: true }`, so they break if `DEV_TOOLS_ENABLED` is turned off. Pass it.
- [#19, 45] `tests/migrationV12.test.ts` — the v12 totals use the live `SKILL_XP_CURVE`; a future rebalance breaks them though the migration is frozen. Freeze a `V12_CURVE` literal in the test; keep the live-config pins in a separate block.
- [#19, 45] `ui/useHoldRepeat.ts`, `ui/useCommand.ts` — no tests for the 400/100 ms schedule, stop on refusal/disable/unmount, or the one-at-a-time guard. Extract a pure scheduler and test it with fake timers.
- [#19, 25] Only woodcutting's "Lv15 ≈ 23.5 h" is tested. Tie `ROCKS` to `TREES` (same XP and base time) or run `hoursTo` over both.
- [#22, 30] No test for a nonzero `minQuality` (hook, 0 today). Add one when the first mechanic sets it.

## Docs and workflow

- [#19, 30] Stray double blank lines in `src/app/_layout.tsx` and `src/components/ui/GameDialog.tsx`.
- [#4, 70] `.claude/agents/game-engineer.md:53`, `pr-review-council/SKILL.md:18` — `$(cat pr.md)` / `$(cat review.md)` use relative paths; use `-F body=@/abs/path` so a missing file fails loudly.
- [#4, 45] `pr-review-council/SKILL.md:13-18` — `R=`/`$N` shell variables don't survive between agent tool calls; inline the repo and PR number.
