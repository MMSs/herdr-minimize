# AGENTS.md

Guidance for coding agents working in this repository. `CLAUDE.md` imports
this file; edit this one.

## What this is

A herdr plugin (herdr 0.9.3+, macOS + Linux) that minimizes a pane to a
per-tab tray column and restores it to its exact original position and size.
The pane's process keeps running untouched; this is *not* a "park"/suspend
plugin. Plugin id `mmss.minimize`, manifest `herdr-plugin.toml` at the repo
root, installed by users with `herdr plugin install MMSs/herdr-minimize`.

Status: scaffolding only. No `src/` yet; `docs/design.md` is the plan.

## Commands

- `bun install` — dev tools only (TypeScript, Biome, Bun types).
- `bun run check` — typecheck + lint + tests; CI runs exactly this.
- `bun test` / `bun test tests/manifest.test.ts` / `bun test -t "<name>"`.
- `bun run format` — Biome autofix.
- `herdr plugin link "$PWD"` (path before options) / `herdr plugin unlink mmss.minimize`.

## Rules

- **Runs on other people's machines.** The only runtime requirement is Bun
  ≥ 1.2. No runtime dependencies in `package.json`, no reliance on tools,
  config or plugins from the author's machine. Anything a user must have goes
  in `scripts/preflight.sh` (POSIX sh, runs at install) and the README.
- Manifest commands are argv arrays of repo-relative paths, run from the
  plugin root without a shell. Add an entrypoint only together with its
  script; `tests/manifest.test.ts` checks the files exist and that the
  manifest and `package.json` versions match.
- Keep layout logic (`tree`, `rebuild`) pure and unit-tested; I/O modules thin.
  Call herdr via `HERDR_BIN_PATH`, never a bare `herdr` from `PATH`.
- Durable state goes in `HERDR_PLUGIN_STATE_DIR`, never `HERDR_PLUGIN_ROOT`
  (installed roots are managed checkouts that reinstall replaces).
- Behaviour changes update `docs/design.md` in the same change; user-visible
  changes get a `CHANGELOG.md` line under `[Unreleased]`.

## herdr pitfalls (verified; details in docs/herdr-api-notes.md)

- **Never call socket `layout.apply`** — it kills the tab's panes and spawns
  fresh ones. Rebuild layouts only with `pane move`.
- `layout.export` needs `{"pane_id": …}`; `{"tab_id": …}` → `layout_not_found`.
- `pane move --ratio R`: R is the existing target pane's share. Only
  `right`/`down` splits exist. In exported trees, `ratio` is the first child's share.
- `--current` is the *focused* pane, not the caller — use ids from
  `HERDR_PLUGIN_CONTEXT_JSON` / `HERDR_PANE_ID` / `HERDR_TAB_ID`.
- Tabs auto-close when their last pane leaves: the rebuild anchor must never
  leave its tab.
- Min pane size is ~10% of the tab per axis.

## Live herdr testing

Use the `herdr-live-testing` skill (`.claude/skills/`). Short version: only
throwaway workspaces from `herdr workspace create --no-focus`, closed
afterwards; never touch the user's own tabs. Spike design risk R1 (does the
first click on an unfocused tray reach the pane app?) before building the tray.

## Releasing

Use the `release` skill; the steps are in `docs/RELEASING.md`. The
`herdr-plugin` topic (marketplace listing) is added only with the first
working release.
