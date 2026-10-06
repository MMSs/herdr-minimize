<!--
PR title = release note. Use a Conventional Commit title; it decides the
version bump when the PR is merged:

  fix: …   / perf: …        → patch release (0.1.0 → 0.1.1)
  feat: …                    → minor release (0.1.0 → 0.2.0)
  feat!: … or a "BREAKING CHANGE:" line in this description
                             → major release (before 1.0: minor)
  docs: / refactor: / test: / ci: / chore: …  → no release

A scope is optional: `fix(picker): keep selection on refresh`.
Don't edit the version or CHANGELOG.md; the release workflow does it.
-->

## What and why

<!-- What does this change, and what problem does it solve? Link the issue. -->

## How it was verified

<!-- Tests added/run. For behaviour only a live herdr shows (moves, focus, the
picker), say what you did by hand and on which herdr version and OS. -->

## Checklist

- [ ] PR title follows the release rules above
- [ ] `bun run check` passes
- [ ] `docs/design.md` / `docs/herdr-api-notes.md` updated (if behaviour or herdr facts changed)
