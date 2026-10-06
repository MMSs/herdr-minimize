# herdr-minimize — product spec

Status: design approved in conversation 2026-10-06, not yet implemented.
Target: herdr 0.9.3+, macOS + Linux. Published as a standalone GitHub repo
(`MMSs/herdr-minimize`) listed in the herdr plugin marketplace.

## 1. Problem

herdr has no way to minimize a pane. When a tab holds several panes (editor,
agents, lazygit, shells), the only options are to close a pane, zoom one pane
full-screen, or move a pane to another tab — which loses its place in the
layout, and putting it back by hand never reproduces the original size.

Upstream has open ideas for this (discussions
[#1244 stacked panes](https://github.com/herdrdev/herdr/discussions/1244),
[#4425 multi-pane slots](https://github.com/herdrdev/herdr/discussions/4425))
but nothing is merged. Rechecked 2026-10-06 against herdr 0.9.3: no native
minimize/stack/hide, and no community plugin does it.

### Prior art (and why this is different)

`prabhatCH/herdr-park`, `rrg/herdr-park-agents`, `iviaxpow3r/herdr-session-parker`,
`haretoke/herdr-agent-parking` and `EzequielAlejandroLastra/herdr-space-parking`
all **stop** the process to free memory and resume an agent session later.
herdr-minimize does the opposite: the process keeps running untouched
(agents keep working and notifying), only its screen space is taken away, and
it comes back to exactly where it was.

## 2. User experience

1. **Minimize.** With a pane focused, the user presses a key (suggested
   `prefix+i`; free base prefix letters in 0.9.3 are `a`, `i`, `y`) or picks
   "Minimize pane" from the command palette. The pane disappears from the tab;
   its neighbours grow into the space exactly as if it had been closed. Focus
   goes to the pane that took over the space.
2. **Tray appears.** A narrow, full-height column — the *tray* — appears on the
   right edge of that tab. It exists only on tabs that currently have
   minimized panes; other tabs are untouched.
3. **Tray contents.** One entry per minimized pane from this tab, in minimize
   order. Each entry shows:
   - an agent-status glyph when the pane runs a detected agent (working /
     blocked / idle, same colours herdr uses), otherwise a neutral glyph;
   - a short name: pane label → agent name → foreground process name;
   - cwd basename on a second, dimmed line when space allows.
   Blocked agents are visually emphasised, since that's when the user needs to
   restore one.
4. **Restore by click.** Clicking an entry puts that pane back in its original
   position at its original size and focuses it. The tray updates; when the
   last entry is restored the tray closes and the tab returns to the full
   layout it had before anything was minimized.
5. **Restore by keyboard.** The tray is a normal pane, so it can be focused
   with the usual pane-navigation keys; `j`/`k`/arrows move, `enter` restores,
   `R` restores all. A plugin action "Restore last minimized pane" (suggested
   key `prefix+shift+i`) restores without touching the tray.
6. **Width.** The tray takes ~10% of the tab width. That is herdr's minimum pane
   width (verified: 16 cols of a 157-col tab), so the tray can't be narrower
   than that. Entries truncate to fit.

### Out of scope (v1)

- Minimizing across tabs/workspaces (the tray is per tab; there is no global list).
- Minimizing the tray itself, or the last remaining pane of a tab (refuse with a
  notification).
- Windows support (socket transport differs; herdr plugins can opt in later).
- Persisting minimized panes across a full herdr server restart beyond what
  herdr's own session restore already keeps — see §6.

## 3. Verified herdr facts this design depends on

All tested live on herdr 0.9.3 in throwaway workspaces on 2026-10-06.

| Fact | Consequence |
|---|---|
| `pane move <id> --new-tab --no-focus` / `--workspace` moves a live pane; pane id **and shell PID survive**. | Minimizing = moving the pane to a parking location. Nothing is killed. |
| `pane move <id> --tab T --target-pane P --split right\|down --ratio R --no-focus` re-inserts it; `--ratio` is the **existing (target) pane's** share. Only `right`/`down` exist. | Re-insertion primitive. |
| Socket `layout.export {"pane_id": X}` returns the tab's BSP tree: `split{direction: right\|down, ratio (= first child's share), first, second}` / `pane{pane_id, cwd, label}`. `{"tab_id": …}` returns `layout_not_found` — always pass a `pane_id`. | Record the exact tree position and ratios at minimize time. |
| **Socket `layout.apply` is destructive**: it treats the tree as a template, closes the target tab (killing its panes) and spawns a brand-new tab with fresh panes. `pane_id` in nodes is ignored. | **Never use `layout.apply`.** Rebuild layouts only with `pane move`. |
| A pane split only splits that one leaf, never a subtree. | A full-height tray (a root-level split) needs a top-down rebuild (§4.3). |
| Top-down rebuild works: keep one anchor pane in the tab, stage the rest in a temp tab, then `pane move --target-pane … --split … --ratio …` from the root down. PIDs and the original tab id survive; the temp tab auto-closes when emptied. | Tray insertion/removal and complex restores are feasible without killing anything. |
| Min pane size ≈10% of tab size in each direction (`pane resize` and `layout.set_split_ratio` clamp there). | Tray width floor; "shrink to a sliver" is not a viable minimize. |
| `--current` resolves to the **focused** pane, not the caller. Actions get `HERDR_PANE_ID`/`HERDR_TAB_ID` from invocation context. | Always use explicit ids from `HERDR_PLUGIN_CONTEXT_JSON` / env. |
| herdr's `mouse_capture = true` still forwards mouse to pane apps that request mouse reporting. | Tray can be clickable — **but see open risk R1**. |
| Plugin panes (`[[panes]]`, placement `split`/`tab`) are normal herdr panes after opening and can be moved; plugin ownership follows the pane. | The tray is a plugin pane entrypoint. |
| Empty tabs auto-close when their last pane moves out. | Parking/staging tabs clean themselves up; the anchor pane must never leave its tab during a rebuild. |

## 4. Design

### 4.1 Components

```
herdr-plugin.toml        manifest: actions, tray pane entrypoint, startup hook, events
src/herdr.ts             thin client: CLI via HERDR_BIN_PATH + raw socket for layout.export/events
src/tree.ts              pure BSP-tree ops (no I/O): remove leaf, reinsert, wrap with tray, diff
src/rebuild.ts           turns a target tree into an ordered list of `pane move` calls
src/state.ts             JSON state file in HERDR_PLUGIN_STATE_DIR + lock
src/actions/minimize.ts  action entrypoint
src/actions/restore.ts   action entrypoint (restore by id / last / all)
src/tray.ts              tray TUI (pane entrypoint): render, mouse + keys, live updates
src/startup.ts           reconcile state after server start/handoff
```

Language: TypeScript on Bun (no runtime deps; `bun` is already required by
sessionizer on the author's machine). `tree.ts` and `rebuild.ts` are pure and
unit-tested with `bun test`; everything with I/O is thin.

### 4.2 Parking location

Minimized panes live in one dedicated workspace per session labelled
`minimized`, one tab per source tab. It is created on first minimize and closed
when empty. herdr has no API to hide a workspace (upstream idea #4843), so it
will appear in the sidebar; the tray is the intended UI, and the workspace is
just storage. Agents in it still report status, trigger notifications and are
reachable by the next-agent keys.

### 4.3 Algorithms

**Minimize(pane X in tab T)**
1. Refuse if X is the tray or the only non-tray pane in T. Unzoom T if zoomed.
2. `layout.export` → tree. Record entry: `{pane_id, tab_id, minimized_at,
   path, sibling_leaves, direction, ratio, x_was_first}` where `path` is the
   first/second path to X's parent split, `sibling_leaves` the set of leaf ids
   in X's sibling subtree, and `ratio` the parent split's ratio.
3. Move X into the parking tab for T (`--no-focus`).
4. If T has no tray yet, add it: target tree = `split(right, r_tray, T_tree, tray)`
   where `r_tray` gives the tray ~10% width; apply via rebuild (below).
5. Focus the pane that inherited X's space (first leaf of the sibling subtree).

**Restore(entry E)**
1. Current tree of T, excluding the tray: `C`.
2. Find the smallest subtree of `C` whose leaf set equals `E.sibling_leaves`.
   - Found → replace it with `split(E.direction, E.ratio, X, S)` or
     `(S, X)` per `E.x_was_first`. Because removing X gave its whole region to
     S, this reproduces the original geometry exactly (scaled by the tray
     column while the tray exists).
   - Not found (layout changed since) → fall back to the surviving leaf of
     `E.sibling_leaves` with the largest area and split it in the original
     direction/ratio; if none survive, split the largest pane in T.
   - T no longer exists → restore into a new tab in the original workspace
     (or the focused workspace if that is gone too).
3. If this was the last minimized pane of T, the target tree is the new `C`
   without the tray; otherwise it stays wrapped in the tray split.
4. Apply via rebuild; focus X; remove E from state; refresh tray.

**Rebuild(tab T, target tree D)**
- Fast path: if D differs from the current tree by one leaf being inserted next
  to a single-leaf sibling, or by the tray being removed, do it in one
  `pane move` (+ close the tray pane). This covers most restores.
- General path: anchor = first leaf of D (must already be in T). Move every
  other pane of T into a temporary staging tab in the parking workspace. Then
  walk D top-down: for `split(dir, r, A, B)` whose region is currently held by
  `firstLeaf(A)`, move `firstLeaf(B)` with `--target-pane firstLeaf(A)
  --split dir --ratio r`, then recurse into A and B. Invariant: each region's
  anchor is the first leaf of its subtree, so no swaps are needed.
- Every move uses `--no-focus`; focus is set once at the end.
- Whole operation runs under a lock (`mkdir` lock in the state dir) so two quick
  key presses can't interleave rebuilds.

### 4.4 Tray pane

- A `[[panes]]` entrypoint `tray`, opened by the minimize action and then
  placed by the rebuild. One tray per tab; its pane id is stored in state.
- On start: alternate screen, hide cursor, enable SGR mouse reporting
  (`\e[?1000h\e[?1006h`), handle `SIGWINCH`.
- Data: reads state file; subscribes to socket events (`pane.agent_status_changed`,
  `pane.closed`, `pane.exited`, `pane.moved`, `tab.closed`) to re-render, with
  a slow poll (2 s) as fallback.
- Click on an entry row → runs restore for that entry (same code path as the
  action). Keys as in §2.5.
- Declines agent detection: report nothing; label the pane `minimized` so it
  is recognisable in pickers.

### 4.5 Events and lifecycle

- `pane.closed` / `pane.exited` for a minimized pane → drop its entry; close
  the tray if it was the last one for that tab.
- `tab.closed` for a tab with minimized panes → leave them in the parking
  workspace and keep the entries; restore then uses the "tab gone" fallback.
- User manually closes the tray pane → treat as "restore all" for that tab
  (least surprising: nothing becomes unreachable).
- User manually moves a pane out of the parking workspace → drop its entry on
  next reconcile.

### 4.6 State file

`$HERDR_PLUGIN_STATE_DIR/state.json`:

```json
{
  "version": 1,
  "parking_workspace_id": "w7",
  "tabs": {
    "w2:t1": {
      "tray_pane_id": "w2:p9",
      "entries": [
        { "pane_id": "w2:p4", "minimized_at": "2026-10-06T18:00:00Z",
          "path": [false, true], "sibling_leaves": ["w2:p5", "w2:p6"],
          "direction": "down", "ratio": 0.6, "x_was_first": false }
      ]
    }
  }
}
```

Write atomically (temp file + rename).

## 5. Manifest sketch

```toml
id = "minimize"
name = "Minimize"
version = "0.1.0"
min_herdr_version = "0.9.3"
description = "Minimize panes to a clickable tray and restore them to their exact place"
platforms = ["macos", "linux"]

[[startup]]
command = ["bun", "src/startup.ts"]

[[actions]]
id = "minimize"
title = "Minimize pane"
contexts = ["pane"]
command = ["bun", "src/actions/minimize.ts"]

[[actions]]
id = "restore-last"
title = "Restore last minimized pane"
contexts = ["tab"]
command = ["bun", "src/actions/restore.ts", "--last"]

[[panes]]
id = "tray"
title = "Minimized panes"
placement = "split"
command = ["bun", "src/tray.ts"]

[[events]]
on = "pane.closed"
command = ["bun", "src/startup.ts", "--reconcile"]
```

Verify `contexts` values and event names against `herdr plugin` docs for the
installed version before relying on them. User config (README):

```toml
[[keys.command]]
key = "prefix+i"
type = "plugin_action"
command = "minimize.minimize"
description = "minimize pane"

[[keys.command]]
key = "prefix+shift+i"
type = "plugin_action"
command = "minimize.restore-last"
description = "restore last minimized pane"
```

## 6. Open risks — spike these first

- **R1: first click on an unfocused tray.** Unverified whether herdr forwards
  that click to the pane app or only uses it to focus the pane. If it only
  focuses, either accept "click to focus, click to restore", or restore the
  selected entry when the tray gains focus via a mouse click (needs focus-in
  reporting `\e[?1004h`). Test this in the first hour, before the rest.
- **R2: rebuild flicker.** The general-path rebuild reflows every pane in the
  tab for a moment (nvim/lazygit redraw). Measure; if bad, prefer the fast
  path more aggressively and only do a full rebuild when the tray is added.
- **R3: server restart.** Unverified whether pane ids survive a herdr
  server restart/handoff. Startup reconcile must match entries to panes
  defensively and drop anything that can't be matched, never guess.
- **R4: tray width on narrow terminals.** 10% of a narrow tab is very few
  columns; fall back to a glyph-only layout (status glyph + first letter)
  under ~10 columns.

## 7. Acceptance criteria

1. Minimize then restore a pane in a 2-, 3- and 5-pane nested layout →
   `herdr pane edges` rects after restore equal the rects before minimize (±1
   cell for rounding) once the tray is gone.
2. The minimized pane's shell PID is unchanged after minimize → restore.
3. An agent minimized while working keeps working, its status updates live in
   the tray, and herdr notifications still fire for it.
4. The tray appears only on tabs with minimized panes and disappears with the
   last restore; other tabs' layouts are never touched.
5. Clicking a tray entry restores that pane (subject to R1's outcome).
6. Closing a minimized pane's process removes its entry; closing the tray
   restores everything.
7. Rapid repeated minimize/restore presses never leave a pane stranded (lock).
8. Headless tests: everything above runs against `herdr workspace create
   --no-focus` workspaces created and torn down by the test, never the user's
   real tabs.

## 8. Publishing

- Repo `MMSs/herdr-minimize`, manifest at the repo root, MIT licence.
- GitHub topic `herdr-plugin` → indexed by the marketplace within ~30 minutes.
- Install line for README: `herdr plugin install MMSs/herdr-minimize`.
- README: what it does, GIF of minimize → tray → click restore, the keybinding
  snippet, requirements (`bun`), and how it differs from the "park" plugins.

## 9. Testing notes for the implementing session

- Raw socket client (newline-delimited JSON): connect to `HERDR_SOCKET_PATH`,
  send `{"id", "method", "params"}` + `\n`, read one line.
- Shell gotcha in zsh test scripts: `$W:t1` is a history modifier — write `${W}:t1`.
- `herdr pane process-info --pane X | jq .result.process_info.shell_pid` is
  the stable PID to compare (other pid fields churn).
- `herdr pane report-agent <pane> --source test --agent claude --state working`
  fakes an agent for tray-status tests.
