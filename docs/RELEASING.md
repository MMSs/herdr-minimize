# Releasing

Users install from the default branch (`herdr plugin install MMSs/herdr-minimize`)
or a pinned ref (`--ref v0.1.0`), and the marketplace indexes the default
branch. So `main` must always be installable, and a release is a version bump
plus a tag.

1. Make sure `main` is green in CI and `bun run check` passes locally.
2. Smoke-test a real install from your branch on a clean plugin setup:
   `herdr plugin uninstall mmss.minimize` (if linked, `unlink`), then
   `herdr plugin install MMSs/herdr-minimize --ref <branch>` and exercise
   minimize, restore (direct and through the picker) and the `▾` tab.
3. Bump `version` in **both** `herdr-plugin.toml` and `package.json` (the
   manifest test checks they match). Raise `min_herdr_version` if the release
   uses a herdr feature newer than the current minimum.
4. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and
   start a new empty `## [Unreleased]`.
5. Commit (`release vX.Y.Z`), merge to `main`, then tag and publish:

   ```sh
   git tag vX.Y.Z && git push origin vX.Y.Z
   gh release create vX.Y.Z --title vX.Y.Z --notes-file <changelog section>
   ```

## Marketplace listing

The [herdr marketplace](https://herdr.dev/plugins/) lists public repos with the
GitHub topic `herdr-plugin` and a parseable `herdr-plugin.toml` on the default
branch, refreshing every 30 minutes. The topic is deliberately **not** set
until the first release actually works. Add it once, with the first release:

```sh
gh repo edit MMSs/herdr-minimize --add-topic herdr-plugin
```
