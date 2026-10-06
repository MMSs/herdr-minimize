---
name: release
description: Use when the user asks to cut, tag or publish a herdr-minimize release, bump the plugin version, or list the plugin on the herdr marketplace.
---

# Release herdr-minimize

Follow `docs/RELEASING.md`; it is the source of truth. This skill adds the
checks an agent tends to skip.

1. Read `docs/RELEASING.md` and `CHANGELOG.md`. If `[Unreleased]` is empty,
   stop and ask what the release contains.
2. Pick the version with the user. Before 1.0: breaking config or keybinding
   changes bump minor, everything else patch.
3. Run `bun run check`. Do not continue on a failure.
4. Check `min_herdr_version`: if any change since the last tag uses a herdr
   command, event or manifest field not verified on the current minimum
   (`docs/herdr-api-notes.md`), raise it and say why in the changelog.
5. Bump `version` in both `herdr-plugin.toml` and `package.json`, move the
   changelog section, commit as `release vX.Y.Z`.
6. Tagging, pushing and `gh release create` publish to every user. Show the
   user the exact commands and the release notes, and run them only after they
   confirm.
7. First release only: offer to add the `herdr-plugin` topic (marketplace
   listing). Ask before running it.
