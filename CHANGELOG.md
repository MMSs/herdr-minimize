# Changelog

All notable changes to this plugin are documented here. The plugin uses
[Semantic Versioning](https://semver.org/). New entries are written by the
release workflow from merged PR titles (see CONTRIBUTING.md); don't edit this
file by hand.

## [0.1.1] - 2026-10-08

- keep minimized panes across herdr restarts (#3)

## [0.1.0] - 2026-10-06

### Added

- Minimize the focused pane (`mmss.minimize.minimize`): it moves to a `▾` tab
  at the end of the tab bar and keeps running.
- Restore (`mmss.minimize.restore`): one minimized pane comes straight back;
  several open a picker with fuzzy search by name and a live preview.
  Panes return to their exact position and size, in any order.
- A ` ▾` after a tab's name shows it has minimized panes; it comes back if
  the tab is renamed and goes away with the last restore.
- Closing a tab closes the panes minimized from it; exited panes are
  forgotten.
- Install-time check for Bun, CI on macOS and Linux.
