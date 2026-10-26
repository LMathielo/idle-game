---
name: pr-review-council
description: Run the 5-reviewer code review on an open pull request in this repo, score findings, post one consolidated review comment, and hand confirmed issues back to the coding agent. Use after every PR is opened, and again after fixes are pushed, until no confirmed issues remain.
---

# PR review council (5 reviewers)

Adapted from Anthropic's official `code-review` plugin for this repo. GitHub GraphQL (and so most `gh pr ...` subcommands) is blocked in this environment, so **use the REST API via `gh api`**.

## Useful REST calls

```bash
R=LMathielo/idle-game
gh api repos/$R/pulls/$N                      # PR metadata (state, head, base)
gh api repos/$R/pulls/$N/files --paginate     # changed files + patches
git fetch origin dev pull/$N/head:pr-$N && git diff origin/dev...pr-$N   # full diff locally (PRs target dev)
gh api repos/$R/issues/$N/comments -f body="$(cat review.md)"         # post the consolidated review
```

## Procedure

1. **Eligibility:** skip if the PR is closed or merged. Feature/fix/chore PRs must have base `dev`; if one targets `main`, flag it in the review (only the owner's release PR `dev` → `main` targets `main`, and the council does not review it unless asked).
2. **Context:** read `AGENTS.md`, `docs/PRODUCT.md`, the task brief in the PR description, and the full diff.
3. **Launch 5 reviewers in parallel** (`Agent` tool, `subagent_type: code-reviewer`). Each gets the PR number, the diff command, the brief and ONE lens:
   1. **Architecture & AGENTS.md compliance:** engine purity (no React/IO/`Date.now`/`Math.random` in `src/engine`), commands-in/state-out, `GameClient` boundary, file layout, Expo Go compatibility, mobile-only.
   2. **Correctness bugs:** read the changed code itself; logic errors, null/undefined, off-by-one, state mutation, race conditions, broken hooks rules, wrong effect deps. Big bugs only.
   3. **React Native / Expo quality:** SDK 58 API usage (check the vendored Expo skills, don't trust memory), re-render cost, list virtualization, safe areas, both iOS and Android behavior, accessibility labels and tap targets.
   4. **Game logic & balance:** apply `.claude/skills/idle-rpg-game-design` sections 3–5: determinism, seeded RNG persistence, exploits, overflow/NaN, offline cap, economy sources vs sinks, config vs hardcoded tunables.
   5. **Scalability, tests & maintainability:** types that will survive a server move, naming, duplication, missing engine tests for new rules, save-shape changes without `saveVersion` migration.
4. Each reviewer returns a list: `{file, line, lens, issue, why it matters, suggested fix, confidence 0-100}` using this rubric:
   - 0: false positive / pre-existing.
   - 25: might be real, unverified, or unlisted stylistic preference.
   - 50: real but minor / rare.
   - 75: verified, likely hit in practice, or directly required by AGENTS.md.
   - 100: certain, frequent, evidence confirms.
5. **Filter:** keep issues with confidence ≥ 80. Drop: pre-existing issues, things `tsc` would catch, pedantic nitpicks, generic "add more tests" unless the change adds engine rules without tests.
6. **Post one consolidated comment** on the PR (brief, no emojis, file:line references, grouped by lens). Also list "Enhancements (optional)" separately if any reviewer proposed a valuable improvement with confidence ≥ 80.
7. **Iterate:** send the confirmed issues back to the coding agent (`SendMessage` to the same agent, so it keeps context). After it pushes fixes, re-run steps 2–6 on the new diff. Stop when a round produces no confirmed issues, then **signal the owner that the PR is approved by the agents and ready for his final review**. Never merge: only the owner merges, into `dev` and into `main`.
