# Contributing

Thanks for helping. Bug reports, design discussion and pull requests are all
welcome. For anything bigger than a small fix, open an issue first so we can
agree on the approach before you write code.

## Setup

You need herdr 0.9.3+ on macOS or Linux, [Bun](https://bun.sh) 1.2+, and git.

```sh
git clone https://github.com/MMSs/herdr-minimize
cd herdr-minimize
bun install            # dev tools only; the plugin has no runtime dependencies
bun run check          # typecheck + lint + tests, the same as CI
```

Link your checkout so herdr runs it straight from the working tree:

```sh
herdr plugin link "$PWD"          # the path goes before any options
herdr plugin action list --plugin mmss.minimize
herdr plugin log list --plugin mmss.minimize
herdr plugin unlink mmss.minimize # when done
```

`link` skips the manifest's `[[build]]` step. Run `sh scripts/preflight.sh` to
exercise it. If you have the plugin installed from GitHub, uninstall it first;
herdr refuses to link over an installed plugin.

## Commands

| Command | What it does |
|---|---|
| `bun run check` | Everything CI runs |
| `bun test` | All tests; `bun test tests/manifest.test.ts` for one file, `bun test -t "<name>"` for one test |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` / `bun run format` | Biome check / check and fix |
| `bun run test:live` | End-to-end tests against your running herdr, in throwaway workspaces (needs the checkout linked) |

## How the code is organised

Read [docs/design.md](docs/design.md) before changing behaviour, and
[docs/herdr-api-notes.md](docs/herdr-api-notes.md) before relying on any herdr
command or socket method. In short:

- Layout logic (tree operations, rebuild planning) is pure TypeScript with no
  I/O, and is where unit tests go.
- Everything that talks to herdr or the filesystem stays thin and calls herdr
  through `HERDR_BIN_PATH` or the socket at `HERDR_SOCKET_PATH`.
- No runtime dependencies. Users only need `bun`; keep it that way.
- A manifest entrypoint is added in the same change as the script it runs. The
  manifest test fails otherwise.

## Testing against a live herdr

Unit tests cover the pure logic. `bun run test:live` drives a real herdr:
it creates `mm-e2e` workspaces, minimizes and restores across several layouts,
compares pane sizes and shell PIDs, and closes everything again. It needs your
checkout linked as `mmss.minimize` and uses the plugin's real state directory.
For anything else only a real herdr shows (focus, the picker, key bindings),
test by hand and follow these rules:

- Work only in throwaway workspaces you create with
  `herdr workspace create --no-focus` and close afterwards. Never touch tabs
  you didn't create.
- Never call the socket method `layout.apply`. It kills every pane in the tab.
- When you learn something new about herdr, add it to
  `docs/herdr-api-notes.md` with the version you verified it on.

## Pull requests

`main` is protected: every change lands through a pull request, squash-merged,
with CI and the PR-title check green. Nobody pushes to `main` directly.

**The PR title is the release note and decides the version.** Use a
[Conventional Commit](https://www.conventionalcommits.org/) title:

| Title | Release when merged |
|---|---|
| `fix: …`, `perf: …` | patch (0.1.0 → 0.1.1) |
| `feat: …` | minor (0.1.0 → 0.2.0) |
| `feat!: …`, or a `BREAKING CHANGE:` line in the description | major (before 1.0 this bumps the minor) |
| `docs:`, `refactor:`, `test:`, `ci:`, `chore:` | none |

A scope is optional (`fix(picker): keep selection on refresh`). We use titles
rather than labels because the title is checked automatically, ends up in the
git history as the squash commit, and becomes the changelog line, so there is
no separate step to forget.

When the PR is merged, the release workflow bumps the version in
`herdr-plugin.toml` and `package.json`, adds the changelog entry, tags
`vX.Y.Z` and publishes a GitHub release. Don't edit the version or
`CHANGELOG.md` yourself.

Also:

- Keep each PR to one change. Include tests for logic changes and say in the
  description how you verified anything tested by hand.
- `bun run check` must pass.
- Update `docs/design.md` in the same PR when you change behaviour it
  describes.
- Commits inside the PR can be anything; only the PR title is kept.

## Using a coding agent

[AGENTS.md](AGENTS.md) (also loaded as `CLAUDE.md`) briefs coding agents on
this repo, and [.claude/skills/](.claude/skills/) holds task guides for live
herdr testing and releasing. Agent-written PRs are fine; you are responsible
for having read and run what you submit.
