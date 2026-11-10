---
name: changelog-release-notes
description: Write CHANGELOG.md entries (Keep a Changelog) and user-facing release notes from the git history, merged PRs and closed issues between two tags. Use when preparing a release, updating the changelog, writing release notes, or summarizing what changed between versions.
---

# Changelog and release notes

Derive the entry from what changed, not from commit subjects alone. Never publish anything (GitHub release,
tag, push) without the user's explicit go-ahead.

## 1. Find the range

```bash
CURRENT_TAG=$(git describe --tags --abbrev=0)                 # or the version the user names
PREVIOUS_TAG=$(git describe --tags --abbrev=0 "$CURRENT_TAG^")
SINCE_DATE=$(git log -1 --format=%aI "$PREVIOUS_TAG")
```

No tag yet, or unreleased work: use `PREVIOUS_TAG..HEAD` and title the entry `[Unreleased]`.

## 2. Gather signals (richest first)

1. Merged PRs and closed issues since `SINCE_DATE`, if `gh` is installed and authenticated:
   `gh pr list --state merged --search "merged:>=$SINCE_DATE" --json number,title,body,labels --limit 100`
   (same with `gh issue list --state closed --search "closed:>=$SINCE_DATE"`).
2. `git diff --name-only $PREVIOUS_TAG..$CURRENT_TAG` and the diff of dependency/config files
   (`pyproject.toml`, `uv.lock`, `Dockerfile`, `*.yaml`, `.env.example`).
3. New or changed test names (they reveal intent).
4. `git log --oneline $PREVIOUS_TAG..$CURRENT_TAG`; if the repo uses conventional commits, the `feat:` /
   `fix:` / `feat!:` prefixes map directly to Added / Fixed / breaking changes.

## 3. Categorize and filter

Keep a Changelog categories: **Added**, **Changed**, **Deprecated**, **Removed**, **Fixed**, **Security**.

- Skip refactors, test-only, CI and style changes unless they affect users. Group minor internal work in one
  "Internal improvements" bullet, or omit it.
- Always call out breaking changes (API fields, config keys, model/schema versions, CLI flags) explicitly.
- If you cannot tell the user impact of a change, omit it rather than guess.

## 4. Writing rules

- Lead with the user benefit: "Add CSV export for reports", not "Implement exportToCsv".
- No file names, function names or internals. Active voice. One line per entry.
- Be specific: "Fix crash on files larger than 2 GB", not "Fix file handling bug".

## 5. Output

**CHANGELOG.md** (prepend under the header; create the file if missing):

```markdown
## [2.4.0] - 2026-11-11

### Added
- Add bulk CSV export for all report types

### Fixed
- Fix incorrect totals on the billing summary
```

**Release notes** (for GitHub releases, internal distribution): a one-line **Headline** with the most
important change, then `New Features`, `Improvements`, `Bug Fixes`, written for users. Include developer-facing
changes (API, SDK) only if the product has a developer audience.

Show the draft to the user and ask what to adjust before writing the file. Offer, but do not run on your own,
`gh release create "$CURRENT_TAG" --title "v2.4.0" --notes-file release-notes.md`.
