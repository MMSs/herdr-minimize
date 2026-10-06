# Design

How herdr-minimize works and why. The herdr behaviour it relies on is recorded
separately, with the herdr version it was verified on, in
[herdr-api-notes.md](herdr-api-notes.md). Change this document in the same PR
as any change to the behaviour it describes.

## 1. Problem

herdr has no way to minimize a pane. When a tab holds several panes (editor,
agents, lazygit, shells), the only options are to close a pane, zoom one pane
full-screen, or move a pane to another tab — which loses its place in the
layout, and putting it back by hand never reproduces the original size.

Upstream has open ideas for this (discussions
[#1244 stacked panes](https://github.com/herdrdev/herdr/discussions/1244),
[#4425 multi-pane slots](https://github.com/herdrdev/herdr/discussions/4425))
but nothing is merged as of herdr 0.9.3.

### Prior art

`prabhatCH/herdr-park`, `rrg/herdr-park-agents`, `iviaxpow3r/herdr-session-parker`,
`haretoke/herdr-agent-parking` and `EzequielAlejandroLastra/herdr-space-parking`
all **stop** the process to free memory and resume an agent session later.
herdr-minimize does the opposite: the process keeps running untouched
(agents keep working and notifying), only its screen space is taken away, and
it comes back to exactly where it was.

## 2. User experience

Every action works on the **active tab** only: the tab that holds the focused
pane at the moment the action runs. Nothing the plugin does reaches into other
tabs, except the parking workspace it owns (§4.1).

1. **Minimize.** With a pane focused, the user presses a key (suggested
   `prefix+i`; free base prefix letters in 0.9.3 are `a`, `i`, `y`) or picks
   "Minimize pane" from the command palette. The pane disappears from the tab;
   its neighbours grow into the space exactly as if it had been closed. Focus
   goes to the pane that took over the space. If the pane is the only one in
   the tab (the tray doesn't count), nothing happens and a notification says
   there is nothing else to show in its place.
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
5. **Restore from the tray by keyboard.** The tray is a normal pane, so it can
   be focused with the usual pane-navigation keys; `j`/`k`/arrows move,
   `enter` restores, `R` restores all.
6. **Restore action.** A plugin action "Restore pane" (suggested key
   `prefix+shift+i`) restores without going through the tray. It only looks
   at the current tab's minimized panes:
   - none → a notification says there is nothing to restore;
   - exactly one → that pane is restored straight away;
   - more than one → a **restore picker** opens (§4.6) so the user chooses
     which one.
7. **Width.** The tray takes ~10% of the tab width, herdr's minimum pane width.
   Entries truncate to fit.

### Out of scope (v1)

- Minimizing across tabs/workspaces (the tray is per tab; there is no global list).
- Minimizing the tray itself, or the only pane of a tab (refused with a
  notification, §2.1).
- Windows (the raw socket transport differs; can be added later).
- Persisting minimized panes across a full herdr server restart beyond what
  herdr's own session restore already keeps — see R3.

## 3. Components

```
herdr-plugin.toml        manifest: actions, tray and picker pane entrypoints, startup hook, events
scripts/preflight.sh     install-time [[build]] check that bun is present
src/herdr.ts             thin client: CLI via HERDR_BIN_PATH + raw socket for layout export/ratios
src/tree.ts              pure BSP-tree ops (no I/O): remove leaf, reinsert, wrap with tray
src/rebuild.ts           pure: turns current + target tree into ordered herdr steps
src/state.ts             JSON state file in HERDR_PLUGIN_STATE_DIR + lock
src/entries.ts           pure: display names, status glyphs, fuzzy search (tray + picker)
src/tui/term.ts          raw-mode terminal: input parsing, ANSI-aware clipping
src/tui/render.ts        pure frame builders for the tray and the picker
src/ops.ts               core operations: active tab, minimize, restore, reconcile
src/run.ts               entrypoint wrapper: failures become herdr notifications
src/actions/minimize.ts  action entrypoint
src/actions/restore.ts   action entrypoint: 0 → notify, 1 → restore, >1 → open picker
src/tray.ts              tray TUI (pane entrypoint): render, mouse + keys, live updates
src/picker.ts            restore picker TUI (popup entrypoint): list + live preview
src/hooks/reconcile.ts   startup and pane/tab-closed hook
```

TypeScript run directly by Bun, with no runtime dependencies, so installing
the plugin needs nothing but `bun`. `tree.ts` and `rebuild.ts` are pure and
carry the logic; they are unit-tested with `bun test`. Everything with I/O is
kept thin.

## 4. Behaviour

### 4.0 Resolving the active tab

Every entrypoint (minimize, restore, picker) starts by resolving the active
tab with `herdr pane current --current`, which returns the focused pane and
its `tab_id`, and works only on that tab. Ids from the invocation context
(`HERDR_TAB_ID`, `HERDR_PLUGIN_CONTEXT_JSON`) are used only as a cross-check:
if they name a different tab, the action stops with a notification rather
than guess. This is deliberately not configurable; it is what keeps a stray
keypress or a stale state record from rearranging a tab the user isn't
looking at. The tray is the one exception: it acts on the tab it lives in,
which is the active tab whenever the user is clicking or typing in it.

### 4.1 Parking location

Minimized panes live in one dedicated workspace per session labelled
`minimized`, one tab per minimized pane (labelled with the pane's name). It is
created on first minimize and closes by itself when the last pane leaves.
A pane gets a new pane id when it moves into (or out of) that workspace, so
the plugin identifies panes by their `terminal_id`, which never changes, and
looks the current pane id up before each herdr call. herdr has no API to hide a workspace (upstream idea #4843), so it
appears in the sidebar; the tray is the intended UI and the workspace is just
storage. Agents in it still report status, trigger notifications and are
reachable by the next-agent keys.

### 4.2 Minimize(pane X in tab T)

1. T is the active tab (§4.0) and X its focused pane. If X is the tray, do
   nothing. If X is the only non-tray pane in T, show a notification
   ("Only pane in this tab — nothing to minimize") and stop. Unzoom T if zoomed.
2. `layout.export` → tree keyed by terminal id. Record entry (§4.8): X's
   terminal id, name, time, `siblings` (terminal ids of X's sibling subtree),
   the parent split's `dir` and `ratio`, and whether X was its first child.
3. Move X into its own new tab in the parking workspace (`--no-focus`).
4. If T has no tray yet, add it: target tree = `split(right, r_tray, T_tree, tray)`
   where `r_tray` gives the tray ~10% width; apply via rebuild.
5. Focus: herdr has no focus-by-id, so focus goes wherever herdr moves it
   when the focused pane leaves; verify it lands in the pane that took the
   space.

### 4.3 Restore(entry E)

1. Current tree of T, excluding the tray: `C`.
2. Find the smallest subtree of `C` whose leaf set equals `E.sibling_leaves`.
   - Found → replace it with `split(E.direction, E.ratio, X, S)` or
     `(S, X)` per `E.x_was_first`. Because removing X gave its whole region to
     S, this reproduces the original geometry exactly (scaled by the tray
     column while the tray exists).
   - Not found (layout changed since) → fall back to the surviving leaf of
     `E.sibling_leaves` with the largest area and split it in the original
     direction/ratio; if none survive, split the largest pane in T.
3. Rebuild to the new tree, still wrapped in the tray split while the tray
   exists. X's move into the tab uses `--focus`.
4. Remove E from state and save. If it was the last entry for T, close the
   tray **last**, after the save: the tray may be the process running this
   restore, and closing it removes the root split so the tab returns to its
   original layout. If the rebuild fails, the entry is kept, so the pane is
   never stranded in the parking workspace.

### 4.4 Rebuild(tab T, target tree D)

- Fast paths: if D has the same shape as the current tree, only ratios
  change. If D adds one pane next to a single-pane sibling, it is one
  `pane move` (plus a `pane swap` when the new pane must be the first child).
  These cover most minimizes and restores.
- General path: anchor A = first leaf of the current tree. Move every other
  pane of T into a temporary staging tab **in T's own workspace** (so pane
  ids don't change). If D's first leaf isn't A, move it next to A and stage
  A. Then walk D top-down: for `split(dir, r, P, Q)` whose region is held by
  `firstLeaf(P)`, move `firstLeaf(Q)` with `--target-pane firstLeaf(P)
  --split dir`, then recurse into P and Q. The staging tab closes by itself
  once empty.
- Finally every split of D is set to its exact ratio with
  `layout.set_split_ratio`.
- Moves use `--no-focus`, except the restored pane's move, which uses
  `--focus`.
- The whole operation runs under a lock (`mkdir` lock in the state dir) so two
  quick key presses can't interleave rebuilds.

### 4.5 Tray pane

- A `[[panes]]` entrypoint `tray`, opened by the minimize action and then
  placed by the rebuild. One tray per tab; its pane id is stored in state.
- On start: alternate screen, hide cursor, enable SGR mouse reporting
  (`\e[?1000h\e[?1006h`), handle `SIGWINCH`.
- Data: re-reads the state file and `herdr pane list` once a second (agent
  status changes show within a second). It finds its tab by its own terminal
  id in state; if none is found within a few seconds of starting it closes
  itself.
- Click on an entry row → runs restore for that entry (same code path as the
  action). Keys as in §2.5.
- Declines agent detection: reports nothing; labels its pane `minimized` so it
  is recognisable in pickers.

### 4.6 Restore picker

Opened by the restore action when the current tab has more than one minimized
pane. It is a `[[panes]]` entrypoint `picker` with `placement = "popup"`
(about 80% × 80% of the terminal): a session-modal overlay that takes all
input and leaves the tiled layout alone.

- **Layout.** A search box across the top. Below it, left: one row per
  minimized pane of the active tab that matches the search, most recently
  minimized first, shown like tray entries (status glyph, name, cwd). Right: a
  preview of the selected pane's current screen. Below a minimum popup width
  (~60 columns) the preview is dropped and only the search box and list are
  shown.
- **Search.** The search box has focus from the start; typing filters the
  list by the entry's display name (§2.3: label → agent → process),
  case-insensitive, matching the typed characters in order (fuzzy
  subsequence), with contiguous and word-start matches ranked first and
  matched characters highlighted. An empty query shows everything in the
  default order. The selection moves to the best match on every keystroke;
  no matches shows "No minimized pane matches" and `enter` does nothing.
  `backspace` deletes a character, `ctrl+u` clears the query.
- **Preview.** `herdr pane read <id> --source visible --format ansi`, re-read
  when the selection changes and about once a second while open, so a working
  agent's output moves. Lines are clipped to the preview box ANSI-aware (never
  cut inside an escape sequence; reset attributes at each line end) and the
  bottom of the screen is kept when the box is shorter than the pane.
- **Keys.** Printable keys go to the search box, so navigation uses
  `up`/`down` and `ctrl+k`/`ctrl+j` (plain `j`/`k` are typed into the
  search). `enter` restores the selected pane; `esc` closes without
  restoring (and `q` is just a letter here). Mouse: click selects and previews,
  double-click restores, scroll moves the selection.
- **Restore.** Leaves the popup's screen, runs the same restore path as the
  tray (§4.3), then exits, which closes the popup.
- **Which tab.** The picker resolves the active tab itself on start (§4.0),
  like the actions do. The popup is modal, so the active tab can't change
  while it is open. If the active tab has fewer than two minimized panes by
  the time the picker starts (one was restored or exited in between), it
  falls back to the action's behaviour: restore the single one, or notify and
  close.
- **Live changes.** If entries disappear while the picker is open (pane
  exited, restored from the tray) the list updates; if one entry is left the
  picker stays open rather than restoring on its own; if none are left it
  closes.

### 4.7 Events and lifecycle

- `pane.closed` / `pane.exited` for a minimized pane → drop its entry; close
  the tray if it was the last one for that tab.
- `tab.closed` for a tab with minimized panes → the panes stay alive in the
  parking workspace (closing a tab must not kill minimized agents), their
  entries are dropped since no active tab can restore them any more, and a
  notification says how many were left in the `minimized` workspace. The user
  can move them out with herdr's normal pane commands.
- User manually closes the tray pane → the `pane.closed` hook reconciles; if
  that tab is the active one, everything is restored (nothing becomes
  unreachable). Otherwise the restore action still works there, and the tray
  is recreated on the next minimize in that tab.
- User manually moves a pane out of the parking workspace → drop its entry on
  next reconcile.

### 4.8 State file

`$HERDR_PLUGIN_STATE_DIR/state.json`, written atomically (temp file + rename):

```json
{
  "version": 1,
  "parking_workspace_id": "w7",
  "tabs": {
    "w2:t1": {
      "tray_terminal_id": "term_65d2fc1dd0acf54",
      "entries": [
        { "terminal_id": "term_65d2fbbd24e7052", "name": "lazygit",
          "minimized_at": "2026-10-06T18:00:00.000Z",
          "siblings": ["term_65d2fbbd1de2e51"], "dir": "down", "ratio": 0.6,
          "was_first": false }
      ]
    }
  }
}
```

Tabs are keyed by tab id, which is stable while the tab stays in its
workspace.

Bump `version` and migrate on read whenever the shape changes; users upgrade
with minimized panes in flight.

## 5. Planned manifest entrypoints

Add each to `herdr-plugin.toml` only once its script exists (the manifest test
enforces this). Verify `contexts` values and event names against the installed
herdr's plugin docs before relying on them.

```toml
[[startup]]
command = ["bun", "src/hooks/reconcile.ts"]

[[actions]]
id = "minimize"
title = "Minimize pane"
contexts = ["pane"]
command = ["bun", "src/actions/minimize.ts"]

[[actions]]
id = "restore"
title = "Restore pane"
contexts = ["tab"]
command = ["bun", "src/actions/restore.ts"]

[[panes]]
id = "tray"
title = "minimized"
placement = "split"
command = ["bun", "src/tray.ts"]

[[panes]]
id = "picker"
title = "Restore pane"
placement = "popup"
width = "80%"
height = "80%"
command = ["bun", "src/picker.ts"]

[[events]]
on = "pane.closed"
command = ["bun", "src/hooks/reconcile.ts"]

[[events]]
on = "tab.closed"
command = ["bun", "src/hooks/reconcile.ts"]
```

## 6. Open risks — spike these first

- **R1: first click on an unfocused tray.** Unverified whether herdr forwards
  that click to the pane app or only uses it to focus the pane. If it only
  focuses, either accept "click to focus, click to restore", or restore the
  selected entry when the tray gains focus via a mouse click (needs focus-in
  reporting `\e[?1004h`).
- **R2: rebuild flicker.** The general-path rebuild reflows every pane in the
  tab for a moment (nvim/lazygit redraw). Measure; if bad, prefer the fast
  path more aggressively and only do a full rebuild when the tray is added.
- **R3: server restart.** Unverified whether pane ids survive a herdr server
  restart/handoff. Startup reconcile must match entries to panes defensively
  and drop anything that can't be matched, never guess.
- **R4: tray width on narrow terminals.** 10% of a narrow tab is very few
  columns; fall back to a glyph-only layout (status glyph + first letter)
  under ~10 columns.
- **R5: picker context.** A popup gets no `HERDR_PANE_ID`, and it is
  unverified whether it sees the action's tab in `HERDR_PLUGIN_CONTEXT_JSON`.
  Mitigated by design: everything resolves the active tab itself (§4.0), so
  no context has to be handed over. Still to check: opening the popup returns
  `ui_busy` while another herdr modal is up; notify instead of failing
  silently.

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
7. The restore action with one minimized pane restores it without any UI; with
   several it opens the picker, whose preview shows each pane's live screen,
   and `enter` restores the selected one to its original rect. Typing part of
   a pane's name narrows the list to it; arrows and `ctrl+j`/`ctrl+k` move the
   selection.
8. Minimize on a tab with a single pane leaves the layout untouched and shows
   a notification. Actions never change any tab other than the active one and
   the plugin's parking workspace.
9. Rapid repeated minimize/restore presses never leave a pane stranded (lock).
10. Live tests run only against `herdr workspace create --no-focus` workspaces
   created and torn down by the test, never the user's real tabs.
