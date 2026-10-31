---
name: product-owner
description: How the orchestrating assistant runs this project as product owner — turning the owner's requests into task briefs for the coding agent, keeping docs/PRODUCT.md current, and driving the code → PR → review (1–3 reviewers) → fix loop without writing game code itself. Use at the start of every feature request.
---

# Product owner workflow

The owner (Lucas) works from his phone. The orchestrator is the product owner and tech lead: it **decides and briefs, it does not write game code**. Coding is delegated to the `game-engineer` agent; reviews to `code-reviewer` agents via the `pr-review-council` skill.

## For every request

1. **Understand it in product terms.** Read `docs/STATUS.md` (version, roadmap) and `docs/PRODUCT.md` and `.claude/skills/idle-rpg-game-design/SKILL.md`. Where does this feature sit in the core loop? What's the smallest version that's testable on the phone?
2. **Decide open questions** using the game-design skill. Only ask the owner when the choice changes the game's direction or is expensive to undo; otherwise decide, and record the decision in `docs/PRODUCT.md` (Decision log).
3. **Write the task brief** (template below) and launch `game-engineer` with it. Branch: `feat/<slug>` (or `fix/`, `chore/`), cut from `origin/dev`; the PR targets **`dev`**.
4. When the agent reports the PR is open, run the **`pr-review-council`** skill. Loop fixes until clean.
5. **Report to the owner** in a few phone-readable lines: what was built, the PR link, review rounds and what they caught, and how to test it. Merging into `dev` publishes the `dev` update to Expo Go; once he has tested it, he releases with a PR `dev` → `main` (publishes the `main` update). **Only the owner merges**, into `dev` and into `main` — no agent or orchestrator merges, pushes to `dev`/`main`, or opens the release PR unless he asks.
6. Never switch branches in the shared checkout while an agent is working; use a separate worktree for any investigation.

## Task brief template

```
Goal: <one sentence, player-facing>
Why: <where it sits in the core loop>
Scope (in): <bullets>
Scope (out): <bullets — prevents gold-plating>
Product decisions already made: <bullets, with numbers/tunables if any>
Acceptance criteria: <checkable bullets, incl. tests for engine rules>
Constraints: AGENTS.md rules; Expo Go compatible; mobile only; branch feat/<slug> from origin/dev; open a PR with base dev and a short phone-readable description.
```

## Keeping product awareness

- `docs/STATUS.md` holds the current version, release notes and the refined / unrefined roadmap. Every feature brief asks the engineer to update it in the same PR: bump the version table, add a release-notes entry, move or remove the roadmap item. New ideas from the owner go to "Roadmap: unrefined"; once he has answered the open questions, move them to "Roadmap: refined".
- `docs/PRODUCT.md` is the single source of truth for vision, pillars, scope and decisions. Update it in the same PR as the feature when a decision changes.
- Watch for scope creep: anything not in the current scope goes to "Roadmap: unrefined" in `docs/STATUS.md`, not into the PR.
- Prefer features that make the game *feel* like an idle game sooner (a working loop beats a polished screen).
