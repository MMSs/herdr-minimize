# Releasing

Releases are automatic. Every merged PR whose title is `fix:`/`perf:` (patch),
`feat:` (minor) or breaking (`!` or `BREAKING CHANGE:`, major; minor before
1.0) makes a release: `.github/workflows/release.yml` runs
`scripts/release/bump.ts`, which bumps `herdr-plugin.toml` and `package.json`,
prepends a `CHANGELOG.md` section, then the workflow commits `release vX.Y.Z`
to `main`, tags it and publishes a GitHub release. Other titles release
nothing. See [CONTRIBUTING.md](../CONTRIBUTING.md#pull-requests).

Users install from the default branch (`herdr plugin install MMSs/herdr-minimize`)
or a pinned tag (`--ref v0.2.0`), so `main` must always be installable.

## How main is protected

A repository ruleset on the default branch requires a pull request (squash
merge only), the CI checks and the `pr-title` check, and blocks force pushes
and deletion. Only the GitHub Actions app may bypass it, so the release
workflow can push its version commit and tag.

## Before merging a `feat:` or `fix:` PR

Smoke-test a real install from the PR branch:
`herdr plugin uninstall mmss.minimize` (or `unlink`), then
`herdr plugin install MMSs/herdr-minimize --ref <branch>`, and exercise
minimize, restore (direct and through the picker) and the `▾` tab.

Raise `min_herdr_version` in the same PR if it starts using a herdr feature
newer than the current minimum (see `docs/herdr-api-notes.md`).

## If a release run fails

Fix the cause in a new PR. If the version commit was pushed but the tag or
GitHub release is missing, create them by hand from that commit:
`git tag vX.Y.Z <sha> && git push origin vX.Y.Z`, then
`gh release create vX.Y.Z --notes "<changelog line>"`.

## Marketplace listing

The [herdr marketplace](https://herdr.dev/plugins/) lists public repos with
the GitHub topic `herdr-plugin` and a parseable `herdr-plugin.toml` on the
default branch, refreshing every 30 minutes. Add the topic once the first
release works:

```sh
gh repo edit MMSs/herdr-minimize --add-topic herdr-plugin
```
