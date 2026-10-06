# herdr-minimize

> **Status: in development — not usable yet.** The repository is scaffolded and
> the design is settled ([docs/design.md](docs/design.md)); the minimize and
> restore actions are not implemented. Watch the repo or check
> [CHANGELOG.md](CHANGELOG.md) for the first release.

A [herdr](https://herdr.dev) plugin that minimizes a pane to a small tray on the
side of its tab, and restores it to exactly the position and size it had.

The minimized pane's process is never stopped: agents keep working, report
status and send notifications while minimized. That is the difference from the
"park" plugins, which stop a process to free memory and resume it later.

## How it will work

- Press `prefix+i` (or pick **Minimize pane** in the command palette). The pane
  disappears and its neighbours take over its space.
- A narrow tray column appears on the right of that tab, listing its minimized
  panes with their agent status. Blocked agents stand out.
- Click an entry (or focus the tray and press `enter`) to put the pane back
  where it was. `R` restores all. `prefix+shift+i` restores the last one.
- When the last pane is restored the tray disappears and the tab is back to its
  original layout.

## Requirements

- herdr 0.9.3 or newer, on macOS or Linux
- [Bun](https://bun.sh) 1.2 or newer on `PATH` (install fails with a hint if it
  is missing)

## Install

```sh
herdr plugin install MMSs/herdr-minimize
```

Then bind keys in your herdr config:

```toml
[[keys.command]]
key = "prefix+i"
type = "plugin_action"
command = "mmss.minimize.minimize"
description = "minimize pane"

[[keys.command]]
key = "prefix+shift+i"
type = "plugin_action"
command = "mmss.minimize.restore-last"
description = "restore last minimized pane"
```

Update by running the install command again. Remove with
`herdr plugin uninstall mmss.minimize`.

Minimized panes are kept in a workspace named `minimized`, which shows up in
the sidebar because herdr can't hide workspaces. Use the tray, not that
workspace.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
