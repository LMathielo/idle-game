---
name: pr-review-council
description: Run the 1–3 reviewer code review (sized by complexity) on an open pull request in this repo, score findings, post one consolidated review comment, and hand confirmed issues back to the coding agent. Use after every PR is opened, and again after fixes are pushed, until no confirmed issues remain.
---

# PR review council (1–3 reviewers, by complexity)

Adapted from Anthropic's official `code-review` plugin for this repo. GitHub GraphQL (and so most `gh pr ...` subcommands) is blocked in this environment, so **use the REST API via `gh api`**.

## Useful REST calls

```bash
R=LMathielo/idle-game
gh api repos/$R/pulls/$N                      # PR metadata (state, head, base)
gh api repos/$R/pulls/$N/files --paginate     # changed files + patches
git -C /home/claude/idle-game fetch -q -f origin dev pull/$N/head:pr-$N   # -f: a rebased PR replaces the old ref
git -C /home/claude/idle-game diff origin/dev...pr-$N                       # full diff (PRs target dev)
gh api repos/$R/issues/$N/comments -f body="$(cat review.md)"         # post the consolidated review
```

## Procedure

1. **Eligibility:** skip if the PR is closed or merged. Feature/fix/chore PRs must have base `dev`; if one targets `main`, flag it in the review (only the owner's release PR `dev` → `main` targets `main`, and the council does not review it unless asked).
2. **Fetch once, before launching reviewers:** `git -C /home/claude/idle-game fetch -q -f origin dev pull/$N/head:pr-$N` (the `-f` makes re-reviews after a rebase or force-push see the new head). Each reviewer then reads the PR only from its own detached worktree of `pr-$N` (`/tmp/wt/review-$N-<lens>`, see `.claude/agents/code-reviewer.md`), never from the shared checkout.
3. **Context:** in your own worktree (`git -C /home/claude/idle-game worktree add --detach /tmp/wt/review-$N-council pr-$N`), read `/tmp/wt/review-$N-council/AGENTS.md`, `/tmp/wt/review-$N-council/docs/PRODUCT.md`, the task brief in the PR description, and the full diff (`git -C /tmp/wt/review-$N-council diff origin/dev...HEAD`). The working directory and shell variables reset between tool calls, so a `cd` in one Bash call does not carry over to the next: give every command an absolute path (`git -C <dir> ...`, `npm --prefix <dir> ...`) or put `cd <dir> && <cmd>` in the same call.
4. **Pick the review size by complexity, then launch reviewers in parallel** (`Agent` tool, `subagent_type: code-reviewer`, `model: sonnet`, `effort: medium`). Each gets the PR number, the brief and its lens(es); the reviewer agent creates its own worktree. (Owner decision 2026-10-31: 1–3 reviewers.)
   - **High risk → 3 reviewers.** Any change to save shape or migrations, `simulate`/time rules, combat or economy formulas, replay/action log/anti-cheat, or the publish/CI workflows. Reviewer A: lenses 1 + 3 (architecture, React Native/Expo). Reviewer B: lens 2 (correctness, incl. time and split invariance). Reviewer C: lenses 4 + 5 (game logic/exploits, tests and frozen fixtures).
   - **Normal → 2 reviewers.** New screens, new content with engine logic, engine-only bumps without save changes. Reviewer A: lenses 1 + 4. Reviewer B: lenses 2 + 3 + 5.
   - **Small → 1 reviewer, all lenses.** Docs, small UI fixes, copy, config-only tweaks with no new rules.
   - When unsure, state the choice and the reason in the review comment; the owner can ask for a bigger review.

   Lenses:
   1. **Architecture & AGENTS.md compliance:** engine purity (no React/IO/`Date.now`/`Math.random` in `src/engine`), commands-in/state-out, `GameClient` boundary, file layout, Expo Go compatibility, mobile-only.
   2. **Correctness bugs:** read the changed code itself; logic errors, null/undefined, off-by-one, state mutation, race conditions, broken hooks rules, wrong effect deps. Big bugs only.
   3. **React Native / Expo quality:** SDK 58 API usage (check the vendored Expo skills, don't trust memory), re-render cost, list virtualization, safe areas, both iOS and Android behavior, accessibility labels and tap targets.
   4. **Game logic & balance:** apply `.claude/skills/idle-rpg-game-design` sections 3–5: determinism, seeded RNG persistence, exploits, overflow/NaN, offline cap, economy sources vs sinks, config vs hardcoded tunables. No balance simulations unless the owner asks.
   5. **Scalability, tests & maintainability:** types that will survive a server move, naming, duplication, missing engine tests for new rules, save-shape changes without `saveVersion` migration.
5. Each reviewer returns a list: `{file, line, lens, issue, why it matters, suggested fix, confidence 0-100}` using this rubric:
   - 0: false positive / pre-existing.
   - 25: might be real, unverified, or unlisted stylistic preference.
   - 50: real but minor / rare.
   - 75: verified, likely hit in practice, or directly required by AGENTS.md.
   - 100: certain, frequent, evidence confirms.
6. **Filter:** keep issues with confidence ≥ 80. Drop: pre-existing issues, things `tsc` would catch, pedantic nitpicks, generic "add more tests" unless the change adds engine rules without tests.
7. **Post one consolidated comment** on the PR (brief, no emojis, file:line references, grouped by lens). List findings below 80 under "Optional" only; they are not sent to the engineer in this PR. **Append each one to `docs/TECH_DEBT.md`** under its section, as `[PR #, confidence] file — issue. Fix.` (skip ones already listed or fixed later in the same PR), so a periodic cleanup PR can work through them. Add them in the PR itself when possible (ask the engineer for a docs commit); otherwise in a small `chore/` PR right after.
8. **Iterate:** send the confirmed issues back to the coding agent (`SendMessage` to the same agent, so it keeps context). After it pushes fixes, run **one** verification reviewer (Sonnet, medium) on the fix diff only (fetch again with `-f`), instead of the full set. Stop when a round produces no confirmed issues, then **signal the owner that the PR is approved by the agents and ready for his final review**. Never merge: only the owner merges, into `dev` and into `main`.
