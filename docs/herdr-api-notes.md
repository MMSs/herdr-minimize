# herdr API notes

herdr behaviour this plugin depends on, verified live against **herdr 0.9.3**
in throwaway workspaces. herdr's docs don't cover most of it, so when you
re-verify something on a newer herdr, update the row and the version here
rather than trusting memory.

## Pane and layout primitives

| Fact | Consequence for the plugin |
|---|---|
| `pane move <id> --new-tab --no-focus` / `--workspace` moves a live pane; the pane id **and shell PID survive**. | Minimizing = moving the pane to a parking location. Nothing is killed. |
| `pane move <id> --tab T --target-pane P --split right\|down --ratio R --no-focus` re-inserts a pane; `--ratio` is the **existing (target) pane's** share. Only `right`/`down` exist. | The re-insertion primitive. |
| Socket `layout.export {"pane_id": X}` returns the tab's BSP tree: `split{direction: right\|down, ratio (= first child's share), first, second}` / `pane{pane_id, cwd, label}`. `{"tab_id": …}` returns `layout_not_found`. | Always pass a `pane_id`. Record tree position and ratios at minimize time. |
| **Socket `layout.apply` is destructive**: it treats the tree as a template, closes the target tab (killing its panes) and spawns a new tab with fresh panes. `pane_id` in nodes is ignored. | **Never use `layout.apply`.** Rebuild layouts only with `pane move`. |
| A pane split only splits that one leaf, never a subtree. | A full-height tray (root-level split) needs a top-down rebuild. |
| Top-down rebuild works: keep one anchor pane in the tab, stage the rest in a temp tab, then `pane move --target-pane … --split … --ratio …` from the root down. PIDs and the original tab id survive; the temp tab auto-closes when emptied. | Tray insertion/removal and complex restores are possible without killing anything. |
| Min pane size ≈10% of the tab in each direction (`pane resize` and `layout.set_split_ratio` clamp there; e.g. 16 cols of a 157-col tab). | The tray can't be narrower than that. "Shrink to a sliver" is not a viable minimize. |
| Empty tabs auto-close when their last pane moves out. | Parking/staging tabs clean themselves up; the anchor pane must never leave its tab during a rebuild. |

## Plugin runtime

| Fact | Consequence for the plugin |
|---|---|
| `--current` resolves to the **focused** pane, not the caller. `herdr pane current --current` returns that pane with its `tab_id`. Actions also get `HERDR_PANE_ID` / `HERDR_TAB_ID` from invocation context. | `pane current --current` is how every entrypoint finds the active tab (design §4.0); context ids are only a cross-check. Never use `--current` for anything else. |
| `herdr notification show <title> [--body TEXT]` shows a herdr notification. | Used for refusals (only pane in tab, nothing to restore). |
| `mouse_capture = true` still forwards mouse events to pane apps that request mouse reporting. | The tray can be clickable (but see risk R1 in [design.md](design.md#6-open-risks--spike-these-first)). |
| Plugin panes (`[[panes]]`, placement `split`/`tab`) are normal panes after opening and can be moved; plugin ownership follows the pane. | The tray is a plugin pane entrypoint. |
| `herdr pane read <id> --source visible --format ansi` returns the pane's current screen with colour escapes as plain text (not JSON), and works on a pane that has been moved to another tab. | Source for the restore picker's live preview. |
| Popup panes (`placement = "popup"`, `width`/`height` as cells or `"80%"`) are session-modal, take all input including Escape, have no pane id, emit no pane events, and don't get `HERDR_PANE_ID`. Opening one returns `ui_busy` while another herdr modal is up. *(From herdr's plugin docs; not yet verified live.)* | The restore picker is a popup; the tab it acts on is handed over through state. |
| `herdr plugin link <path> [--disabled]` — the path comes **before** options; `link --disabled <path>` fails with `unknown option`. `link` does not run `[[build]]`; `install` does. | Contributors link their checkout; run `sh scripts/preflight.sh` by hand to exercise the build step. |
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
