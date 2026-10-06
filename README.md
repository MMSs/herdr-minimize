# herdr-minimize

A [herdr](https://herdr.dev) plugin that minimizes a pane out of the way and
restores it to exactly the position and size it had.

The minimized pane's process is never stopped: agents keep working, report
status and send notifications while minimized. That is the difference from the
"park" plugins, which stop a process to free memory and resume it later.

## How it works

- Press `prefix+m` to minimize the focused pane. It disappears and its
  neighbours take over its space, as if it had been closed.
- The tab gets a ` ▾` after its name while it has minimized panes, like
  herdr's `Z` for zoom. If you rename the tab, the ` ▾` comes back.
- The pane moves to a tab named `▾`, kept at the end of the tab bar. Click `▾` to see
  every minimized pane of the workspace; the tab closes by itself when empty.
- Press `prefix+shift+m` to restore. With one minimized pane in the tab it
  comes straight back; with several, a picker opens with a live preview of
  each. Type to search by pane name; arrows or `ctrl+j`/`ctrl+k` move, `enter`
  restores, `esc` cancels. Panes come back to their exact place, in any order.
- Everything acts on the tab you're looking at. Minimizing the only pane in a
  tab just shows a notification.
- Closing a tab also closes the panes minimized from it.

## Requirements

- herdr 0.9.3 or newer, on macOS or Linux
- [Bun](https://bun.sh) 1.2 or newer on `PATH` (install fails with a hint if it
  is missing)

## Install

```sh
herdr plugin install MMSs/herdr-minimize
```

herdr runs plugin actions from key bindings (it has no command palette), so add
these to your herdr config (`~/.config/herdr/config.toml`) and run
`herdr server reload-config`. `prefix+m` / `prefix+shift+m` are free in
herdr's defaults; pick other keys if you already use them:

```toml
[[keys.command]]
key = "prefix+m"
type = "plugin_action"
command = "mmss.minimize.minimize"
description = "minimize pane"

[[keys.command]]
key = "prefix+shift+m"
type = "plugin_action"
command = "mmss.minimize.restore"
description = "restore minimized pane"
```

Update by running the install command again. Remove with
`herdr plugin uninstall mmss.minimize`.

## Limitations

- herdr keeps every pane at least 10% of its parent split and plugins can't
  add sidebar sections, so minimized panes live in a real `▾` tab rather than
  a slim tray.
- A minimized pane's process can't be detached and reattached later; it keeps
  running in the `▾` tab until restored or its tab is closed.
- Resizes made while panes are minimized are undone when they are restored.
- Windows is not supported yet.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
