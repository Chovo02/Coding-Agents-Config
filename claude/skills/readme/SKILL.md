---
name: readme
description: Create, improve or audit a project README.md. Use only when the user explicitly asks for a README, README quality, README accuracy or README examples. Not for full docs sites, API-reference-only work or broad repository reviews.
---

# README

A README answers "what is this, why care, how do I use it?" within 30 seconds. Every section must serve a real
reader need; no boilerplate.

## Create (no README yet)

Before writing:
- Read the source and manifests (`pyproject.toml`, `Dockerfile`, entrypoints, CLI parsers) and build a facts
  list: package name, entrypoints, commands and flags, config keys, required runtime versions.
- Verify every command, import and API you plan to document against the current source. Do not document from
  memory.
- Ask once: "Who is this README for, and what is the one thing they must understand?"

Write: title + one-line hook → a "what and why" of 2–4 sentences → a quick start that works in ≤ 5 steps with
real, tested commands → install instructions for the project's actual ecosystem → only the extra sections this
project needs. Show the draft to the user before finalizing.

## Improve (README exists)

1. Read the whole README and the source it describes.
2. **Drift check:** list every symbol, command, flag and config key the README mentions; find its definition
   (package exports, `bin`/entrypoints, CLI parsers, schemas, type stubs) and confirm existence and signature.
   Classify each mismatch: renamed, removed, moved, changed signature, undocumented, ambiguous. Cite the source
   file as evidence.
3. Fix factual errors first, then structure, then clarity. Remove boilerplate that adds nothing.
4. Rewrite stale examples only from the current source; if the replacement is not visible, say so and ask,
   never invent an alias or compatibility claim.
5. Run the documented commands when feasible; otherwise state exactly which checks you did not run.
6. Present findings and changes for approval.

## For ML and service projects, also cover

- How to run: train, evaluate, serve (the exact commands), and required hardware (CPU/GPU, memory).
- Data: where it comes from, expected layout, and what is **not** in the repo.
- Reproducibility: seed, config file, tracker (MLflow/ClearML) and how to find a run.
- Results: the metric, the dataset split, and the command that produced the number.
- For a containerized service: build/run commands, exposed port, required env vars (names only, never values).

## Principles

Lead with value; show real code, not pseudocode; state what the project does **and does not** do; follow the
ecosystem's conventions; link to `docs/` instead of duplicating; a README that lies is worse than none; source
beats memory.

## Checklist

```
[ ] Clear, non-clever title        [ ] One-liner says what + why
[ ] Quick start works in ≤5 steps  [ ] Examples are real and copy-pasteable
[ ] Install matches the real ecosystem   [ ] No orphan sections
[ ] Badges are useful, not decorative    [ ] License stated
```
