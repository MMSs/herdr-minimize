# Changelog

All notable changes to this plugin are documented here. The plugin uses
[Semantic Versioning](https://semver.org/). New entries are written by the
release workflow from merged PR titles (see CONTRIBUTING.md); don't edit this
file by hand.

## [Unreleased]

### Added

- Minimize the focused pane (`mmss.minimize.minimize`): it moves to a `▾` tab
  at the end of the tab bar and keeps running.
- Restore (`mmss.minimize.restore`): one minimized pane comes straight back;
  several open a picker with fuzzy search by name and a live preview.
  Panes return to their exact position and size, in any order.
- Closing a tab closes the panes minimized from it; exited panes are
  forgotten.
- Install-time check for Bun, CI on macOS and Linux.
