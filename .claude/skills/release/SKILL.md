---
name: release
description: Use when the user asks to cut, tag or publish a herdr-minimize release, bump the plugin version, fix a failed release run, or list the plugin on the herdr marketplace.
---

# Release herdr-minimize

Releases happen automatically when a PR is merged; `docs/RELEASING.md` is the
source of truth. What an agent does:

1. **Choosing a version = choosing the PR title.** `fix:`/`perf:` patch,
   `feat:` minor, `feat!:` or a `BREAKING CHANGE:` line major (minor before
   1.0), anything else no release. Suggest the title; never edit versions or
   `CHANGELOG.md` by hand.
2. **Never push to `main`.** It is protected; open a PR (`gh pr create`) and
   let the user merge it.
3. Before a `feat:`/`fix:` PR is merged, check `bun run check` passes and
   whether `min_herdr_version` needs raising (`docs/herdr-api-notes.md`).
4. **Failed release run:** read it with `gh run view <id> --log-failed`,
   explain, and propose the fix as a PR. Creating a missing tag or release by
   hand publishes to every user: show the exact commands and run them only
   after the user confirms.
5. Adding the `herdr-plugin` topic lists the plugin publicly. Ask first.
