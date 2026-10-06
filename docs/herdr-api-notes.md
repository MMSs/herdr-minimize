# herdr API notes

herdr behaviour this plugin depends on, verified live against **herdr 0.9.3**
in throwaway workspaces. herdr's docs don't cover most of it, so when you
re-verify something on a newer herdr, update the row and the version here
rather than trusting memory.

## Pane and layout primitives

| Fact | Consequence for the plugin |
|---|---|
| `pane move <id> --new-tab --no-focus` / `--workspace` moves a live pane; the shell PID and `terminal_id` survive. `--new-tab` without `--workspace` creates the tab in the pane's own workspace. | Minimizing = moving the pane to a parking location. Nothing is killed. |
| **Moving a pane into another workspace gives it a new pane id** (`w1Z:p3` became `w10:p1`); moves inside one workspace keep it. The old id happened to keep resolving to the moved pane, but that is undocumented. The new pane is in the move response at `.result.move_result.pane`. *(verified 2026-10-06)* | Everything is keyed by `terminal_id`; pane ids are looked up fresh before each call. The rebuild staging tab stays in the tab's own workspace. |
| `pane move <id> --new-workspace --label L --tab-label T --no-focus` creates a workspace for the pane. Empty workspaces auto-close. | Creates the parking workspace on first minimize; it disappears with the last restore. |
| A `pane move` that leaves the tree unchanged returns `changed: false` and ignores `--ratio`. | Sizes are fixed with `layout.set_split_ratio`, not by re-moving. |
| Socket `layout.set_split_ratio {"tab_id", "path", "ratio"}`: `path` is an array of booleans from the root, `true` = second child, `[]` = root. Ratio 0.9 on a 157-col tab gives a 16-col right pane. *(verified 2026-10-06)* | Every rebuild ends by setting each split to its exact recorded ratio. |
| `pane move <id> --tab T --target-pane P --split right\|down --ratio R --no-focus` re-inserts a pane; `--ratio` is the **existing (target) pane's** share. Only `right`/`down` exist. | The re-insertion primitive. |
| Socket `layout.export {"pane_id": X}` returns `.result.layout = {workspace_id, tab_id, zoomed, focused_pane_id, root}`; nodes are `{"type":"split", direction: right\|down, ratio (= first child's share), first, second}` / `{"type":"pane", pane_id, cwd, label?, command?}` (`command` only on plugin panes). `{"tab_id": …}` returns `layout_not_found`. | Always pass a `pane_id`. Record tree position and ratios at minimize time. |
| **Socket `layout.apply` is destructive**: it treats the tree as a template, closes the target tab (killing its panes) and spawns a new tab with fresh panes. `pane_id` in nodes is ignored. | **Never use `layout.apply`.** Rebuild layouts only with `pane move`. |
| A pane split only splits that one leaf, never a subtree. | A full-height tray (root-level split) needs a top-down rebuild. |
| Top-down rebuild works: keep one anchor pane in the tab, stage the rest in a temp tab, then `pane move --target-pane … --split … --ratio …` from the root down. PIDs and the original tab id survive; the temp tab auto-closes when emptied. | Tray insertion/removal and complex restores are possible without killing anything. |
| Min pane size ≈10% of the tab in each direction (`pane resize` and `layout.set_split_ratio` clamp there; e.g. 16 cols of a 157-col tab). | The tray can't be narrower than that. "Shrink to a sliver" is not a viable minimize. |
| Socket `tab.move {"tab_id", "insert_index"}`: `insert_index` = current tab count moves the tab to the end; larger values fail with `tab_move_failed`. *(verified 2026-10-06)* | Keeps the `▾` parking tab last. |
| A pane's minimum size is 10% of its **parent split** in that direction, not of the tab: a root split can't give a pane less than 16 of 157 columns, but a pane nested in a 16-column region went down to 2. No config setting changes this. *(verified 2026-10-06)* | Why the plugin has no tray (design §2, out of scope). |
| Plugins can't add sidebar sections; `ui.tab_bar_right` (user config) shows right-aligned text from `command` entries, at most once a second. Those commands get `HERDR_ACTIVE_TAB_ID`, `HERDR_ACTIVE_PANE_ID`, `HERDR_ACTIVE_WORKSPACE_ID` (not `HERDR_TAB_ID`), plus `HERDR_SOCKET_PATH`/`HERDR_BIN_PATH`. *(verified 2026-10-06)* | The optional `▾ N` status is a user-config line reading a status file. |
| Empty tabs auto-close when their last pane moves out. | Parking/staging tabs clean themselves up; the anchor pane must never leave its tab during a rebuild. |

## Plugin runtime

| Fact | Consequence for the plugin |
|---|---|
| `--current` resolves to the **focused** pane, not the caller. `herdr pane current --current` returns that pane with its `tab_id`. Actions also get `HERDR_PANE_ID` / `HERDR_TAB_ID` from invocation context. | `pane current --current` is how every entrypoint finds the active tab (design §4.0); context ids are only a cross-check. Never use `--current` for anything else. |
| `herdr notification show <title> [--body TEXT]` shows a herdr notification. | Used for refusals (only pane in tab, nothing to restore). |
| `mouse_capture = true` still forwards mouse events to pane apps that request mouse reporting, **including the first click on an unfocused pane**: one click on a tray entry restores it. *(verified by hand 2026-10-06)* | The tray restores on a single click; no focus-in handling needed (risk R1 closed). |
| Plugin panes (`[[panes]]`, placement `split`/`tab`) are normal panes after opening and can be moved; plugin ownership follows the pane. `herdr plugin pane open --plugin ID --entrypoint E --placement split --target-pane P --direction right --no-focus` returns the pane at `.result.plugin_pane.pane`; the process gets its own `HERDR_PANE_ID` and `HERDR_TAB_ID`, and the pane's label is the manifest `title`. The CLI's `--placement` has no `popup`; leave it out to use the manifest placement. | The tray is a plugin pane entrypoint and finds its own state by its terminal id. |
| An action invoked from the CLI (`herdr plugin action invoke`) gets the active tab and focused pane as its context, like a keypress would. | Live tests call the core functions with sandbox ids instead of invoking actions, which would act on the tester's own tab. |
| Event hooks receive `HERDR_PLUGIN_EVENT_JSON`: `tab.closed` → `{"event":"tab_closed","data":{"tab_id","workspace_id"}}`, `pane.closed` → `{"event":"pane_closed","data":{"pane_id","workspace_id"}}`. Payload event names use underscores. Socket subscriptions to lifecycle events need no `pane_id`; `pane.agent_status_changed` requires one. *(verified 2026-10-06)* | Hooks only trigger a reconcile; they don't need the payload. |
| `herdr pane read <id> --source visible --format ansi` returns the pane's current screen with colour escapes as plain text (not JSON), and works on a pane that has been moved to another tab. | Source for the restore picker's live preview. |
| Popup panes (`placement = "popup"`, `width`/`height` as cells or `"80%"`) are session-modal, take all input including Escape, have no pane id, emit no pane events, and don't get `HERDR_PANE_ID`. Opening one returns `ui_busy` while another herdr modal is up. *(From herdr's plugin docs; not yet verified live.)* | The restore picker is a popup; the tab it acts on is handed over through state. |
| `herdr plugin link <path> [--disabled]` — the path comes **before** options; `link --disabled <path>` fails with `unknown option`. `link` does not run `[[build]]`; `install` does. | Contributors link their checkout; run `sh scripts/preflight.sh` by hand to exercise the build step. |
| herdr 0.9.3 has no command palette and doesn't list plugin actions in right-click menus. Actions run from `[[keys.command]] type = "plugin_action"` bindings or `herdr plugin action invoke`. *(verified 2026-10-06)* | README tells users to add key bindings; there is no other way to trigger minimize/restore. |
| Runtime commands run from the plugin root with no shell. Build commands get no runtime env or socket. | Manifest commands are argv arrays of repo-relative paths. |

## Testing against a live herdr

- Raw socket client (newline-delimited JSON): connect to `HERDR_SOCKET_PATH`,
  send `{"id", "method", "params"}` + `\n`, read one line.
- `herdr pane process-info --pane X | jq .result.process_info.shell_pid` is the
  stable PID to compare; other pid fields churn.
- `herdr pane report-agent <pane> --source test --agent claude --state working`
  fakes an agent for tray-status tests.
- `herdr pane edges` gives pane rects for before/after layout comparisons.
- zsh gotcha: `$W:t1` is a history modifier — write `${W}:t1`.
- CLI `herdr pane layout` / `pane edges` return pane **rects** and a flat
  split list, not the nested tree; use socket `layout.export` for the tree.
- `herdr status server` prints the socket path, for raw socket tests run from
  outside a herdr pane.
