---
name: verification-loop
description: "Verification of Python work (ML and general) before claiming it is complete: build, types, ruff lint, pytest with coverage, security scan, diff review. Use before a PR, after a feature or refactor, or when asked to check a change."
license: MIT
---

# Verification Loop Skill

Python-first verification for Claude Code sessions. Adapted from ECC (MIT, Affaan Mustafa); see
`THIRD-PARTY-NOTICES.md`.

Use the project's own tooling. Look for `uv.lock`, `[tool.ruff]`, `[tool.pytest.ini_options]`, `[tool.pyright]`
or `[tool.mypy]` in `pyproject.toml` first. Do not add a tool the project does not already use. Run tools with
`uv run <tool>` when the project uses uv (see `python-ml-tooling`).

## When to Use

- After completing a feature or significant code change
- Before creating a PR
- When you want to ensure quality gates pass
- After refactoring

## Verification Phases

Run the phases in order. Stop at a failing phase, fix it, then continue.

### Phase 1: Environment and Build

```bash
uv sync --locked 2>&1 | tail -20     # fails if uv.lock is out of date
uv build 2>&1 | tail -20             # only if the project is a package (has [build-system])
```

If there is no `pyproject.toml`, check that the entry point runs: `uv run python -m <module> --help` or the
script named in the task. If the build or sync fails, STOP and fix before continuing.

### Phase 2: Type Check

```bash
uv run pyright 2>&1 | tail -30       # if [tool.pyright] or pyright is in dev dependencies
uv run mypy <package> 2>&1 | tail -30  # if [tool.mypy] is configured
```

Run only the checker the project uses. If neither is configured, report "Types: not configured" and do not
install one. Report all errors. Fix errors in the files you changed before continuing.

### Phase 3: Lint and Format

```bash
uv run ruff check <changed files> 2>&1 | tail -30   # lint, never --fix in this phase
uv run ruff format --check <changed files>          # report only, never format wholesale
```

- Check the files you touched, or the whole package if the diff is large.
- Do not run `ruff check --fix` or `ruff format` here. Report the findings; apply fixes only when asked.
- If `ruff format --check` flags many untouched files, the project does not use ruff formatting. Report it
  and move on.

### Phase 4: Test Suite

```bash
uv run pytest -q --cov --cov-report=term-missing 2>&1 | tail -50
```

- Use the coverage threshold in the project config (`fail_under`) if set. Otherwise target 80% on the
  changed modules, not the whole repo.
- Do not run `@pytest.mark.slow` or `@pytest.mark.gpu` tests unless asked; say they were deselected.
- For ML code, confirm that a training smoke test (one or two steps on a tiny batch) ran and that the loss
  was finite.

Report:
- Total tests: X
- Passed: X
- Failed: X
- Skipped or deselected: X
- Coverage of changed modules: X%

### Phase 5: Security and Project Rules

```bash
# Secrets and credentials in the diff
git diff -U0 | grep -nE "(api[_-]?key|secret|token|password|sk-[A-Za-z0-9]{10,})" | head -20

# Unsafe deserialization (model and artifact loading)
grep -rnE "pickle\.load|torch\.load\(|yaml\.load\(|eval\(|exec\(" --include="*.py" <changed dirs> | head -20

# Project rules: loguru instead of print/logging
grep -rnE "^\s*print\(|^import logging|^from logging" --include="*.py" <changed dirs> | head -20
```

- `torch.load` without `weights_only=True` and `pickle.load` on untrusted files are findings. See
  `api-security` for the full checklist when the change touches HTTP, auth or uploads.
- `print(` and `logging` are findings when the project uses loguru (see `loguru-logging`). Do not flag them in
  scripts that already use print for CLI output unless the project rule says otherwise.
- Optional: `uv run bandit -r <package> -q` only if bandit is already in the project's dev dependencies.

### Phase 6: Diff Review

```bash
git status --short
git diff --stat            # unstaged + staged changes against HEAD
git diff --name-only main...HEAD   # if work is on a branch (check the default branch name first)
```

Review each changed file for:
- Unintended changes (formatting noise, stray debug code, files that should not be tracked)
- Missing error handling at system boundaries (file I/O, network, model loading)
- Edge cases: empty inputs, NaN/inf, shape or dtype mismatches, off-by-one in splits
- For ML: data leakage (scalers and encoders fit on train only), metrics computed on the right split,
  seeds set. Use `ml-reviewer` when the diff touches training, splits or evaluation.

## Target Acceptance

When the requested outcome requires deployment or target-environment verification,
report target acceptance separately from local checks. Record the environment and
installed version when known, the evidence, and the next permitted check or precise
access dependency. Passing local checks, review, merge, or release does not establish
target acceptance. Report VERIFIED or FAILED for an executed target check, with its evidence.
Do not access production or make external changes without authorization. For
local-only tasks, mark target acceptance as not applicable.

For example: local checks PASS; staging verification NOT PERFORMED (no access);
next step: an authorized maintainer runs the staging smoke test.

## Output Format

After running all phases, produce a verification report:

```
VERIFICATION REPORT
==================

Env:       [PASS/FAIL] (uv sync --locked)
Build:     [PASS/FAIL/NOT APPLICABLE]
Types:     [PASS/FAIL/NOT CONFIGURED] (X errors)
Lint:      [PASS/FAIL] (X findings, ruff check)
Format:    [PASS/FAIL/NOT CONFIGURED] (X files would change)
Tests:     [PASS/FAIL] (X/Y passed, Z% coverage of changed modules)
Security:  [PASS/FAIL] (X findings)
Diff:      [X files changed]

Overall:   [READY/NOT READY] for PR
Target:    [VERIFIED/FAILED/NOT PERFORMED/NOT APPLICABLE] (environment/version, evidence)
Next permitted step: [check or access dependency; none if complete/not applicable]

Issues to Fix:
1. ...
2. ...
```

## Continuous Mode

For long sessions, run verification after major changes or before each commit:

```markdown
Set a mental checkpoint:
- After completing each function
- After finishing a module
- Before moving to next task
```

## Integration with Hooks

This skill complements the PostToolUse hook `claude/hooks/ruff-check.js`, which already runs `ruff check`
on each edited `.py` file. This skill provides the full pass: types, tests, security and diff review.
