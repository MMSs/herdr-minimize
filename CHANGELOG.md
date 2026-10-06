# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the plugin uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
