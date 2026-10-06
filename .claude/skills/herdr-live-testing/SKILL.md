---
name: herdr-live-testing
description: Use when verifying herdr-minimize behaviour against a running herdr - minimize/restore, layout rebuilds, tray clicks, focus, events, PIDs - or when checking a herdr fact before relying on it. Covers creating and tearing down throwaway workspaces safely.
---

# Live herdr testing

Unit tests cover pure layout logic. Anything about how herdr actually moves,
focuses, sizes or reports panes must be checked against a running herdr. The
user is usually working in that same herdr, so the rules below are not optional.

## Rules

- Only operate on workspaces you created in this session. Never move, close,
  resize or send input to panes you didn't create. `--current` means the
  user's focused pane, so never use it.
- Never call socket `layout.apply`; it kills every pane in the tab.
- Always close your workspaces when done, including after a failure.
- Call `herdr` by absolute path (see `$H` below). In the user's shell,
  `herdr` may be a wrapper function.
- In zsh, write `${W}:t1`, not `$W:t1` (`:t` is a history modifier).

## Sandbox

```sh
H=$(whence -p herdr 2>/dev/null || command -v herdr)   # skip shell wrapper functions
W=$($H workspace create --no-focus --label mm-sandbox | jq -r .result.workspace.workspace_id)
P1=$($H pane list --workspace "$W" | jq -r '.result.panes[0].pane_id')
P2=$($H pane split "$P1" --direction right --no-focus | jq -r .result.pane.pane_id)
P3=$($H pane split "$P2" --direction down --ratio 0.6 --no-focus | jq -r .result.pane.pane_id)
# ... test ...
$H workspace close "$W"
```

A new pane's shell needs a moment to start; text sent before its prompt is
ready is echoed but never runs. Use `$H pane run P '<cmd>'` and then
`$H pane wait-output P --regex '<expected>' --timeout 5000` instead of fixed
sleeps.

`workspace create` prints the new workspace, its first tab (`${W}:t1`) and its
root pane. Every command prints JSON; read ids with `jq`.

## Measuring

| What | Command |
|---|---|
| Pane rects (compare before/after; ±1 cell rounding is fine) | `$H pane edges --pane P \| jq '.result.edges.layout.panes'` |
| Split tree with ratios | socket `layout.export {"pane_id": P}` (CLI `pane layout` returns rects only) |
| Stable shell PID (other pid fields churn) | `$H pane process-info --pane P \| jq .result.process_info.shell_pid` |
| Fake an agent for tray status | `$H pane report-agent P --source test --agent claude --state blocked` |

Raw socket request: connect to `$HERDR_SOCKET_PATH`, write one line of
`{"id":"1","method":"layout.export","params":{"pane_id":"…"}}` and read one line
back. From a terminal outside a herdr pane, find the path with
`$H status server`.

## Automated live tests

`bun run test:live` runs `tests/live/` against the running herdr: minimize and
restore across 2-, 3- and 5-pane layouts, comparing pane rects and shell PIDs,
in throwaway `mm-e2e` workspaces it closes again. It needs this checkout
linked as `mmss.minimize` (the tray pane is opened from the linked plugin)
and uses the plugin's real state directory. Plain `bun test` skips it.

## Testing the plugin itself

```sh
$H plugin link "$PWD"            # path before options
$H plugin action invoke mmss.minimize.<action>
$H plugin log list --plugin mmss.minimize
$H plugin unlink mmss.minimize   # when done, unless the user wants it kept
```

Actions invoked from the CLI get no pane context unless herdr provides one.
Mouse and focus behaviour (risk R1 in docs/design.md) needs the user to click:
ask them, and say exactly which sandbox pane to click.

## Afterwards

- Anything new you learned about herdr goes into `docs/herdr-api-notes.md`
  with the herdr version (`$H --version`).
- Report what you verified and how. Say plainly what you could not verify.
