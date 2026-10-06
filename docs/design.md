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
pane at the moment the action runs (§4.0). Minimized panes are parked in a
`▾` tab of the same workspace; nothing else outside the active tab is touched.
The goal is behaviour as close to herdr's zoom as a plugin can get: the pane
simply isn't in the tab any more, and nothing takes its place.

1. **Minimize.** With a pane focused, the user presses a key (suggested
   `prefix+i`; free base prefix letters in 0.9.3 are `a`, `i`, `y`) or picks
   "Minimize pane" from the command palette. The pane disappears from the tab;
   its neighbours grow into the space exactly as if it had been closed. If it
   is the only pane in the tab, nothing happens and a notification says so.
2. **The `▾` tab.** The pane moves to a tab labelled `▾` in the same
   workspace, created on the first minimize and kept at the end of the tab
   bar. herdr closes it by itself once it is empty. Clicking it shows every
   minimized pane of that workspace tiled, so they can be glanced at; they
   keep running, and agents in them keep reporting status and notifying.
3. **Restore.** A plugin action "Restore pane" (suggested key
   `prefix+shift+i`) only looks at the current tab's minimized panes:
   - none → a notification says there is nothing to restore;
   - exactly one → that pane is restored straight away;
   - more than one → a **restore picker** opens (§4.4) so the user chooses.
   A restored pane goes back to its original position at its original size,
   and is focused. Panes come back exactly in any order.
4. **Closing.** Closing a tab also closes the panes minimized from it. A
   minimized pane whose process exits is simply forgotten.

### Out of scope (v1)

- A tray or sidebar section. herdr keeps every pane at least 10% of its
  parent split (16 of 157 columns for a full-height column), and plugins
  can't add sidebar sections, floating panes or right-aligned tabs. A
  rotated-label tray was built and dropped for this reason (git history:
  `wip: rotated-label tray experiment`).
- Detaching a process and reattaching it to a new pane later: closing a pane
  ends its terminal, and herdr has no API to move a terminal between panes
  other than moving the pane.
- Minimizing across tabs/workspaces (restore is per tab).
- Windows (untested; the raw socket transport differs).

## 3. Components

```
herdr-plugin.toml        manifest: actions, picker popup, startup + event hooks
scripts/preflight.sh     install-time [[build]] check that bun is present
src/herdr.ts             thin client: CLI via HERDR_BIN_PATH + raw socket for layout/tab moves
src/tree.ts              pure BSP-tree ops: remove/reinsert leaves, full layout bookkeeping
src/rebuild.ts           pure: turns current + target tree into ordered herdr steps
src/state.ts             JSON state file in HERDR_PLUGIN_STATE_DIR + lock
src/entries.ts           pure: display names, status glyphs, fuzzy search
src/tui/term.ts          raw-mode terminal: input parsing, ANSI-aware clipping
src/tui/render.ts        pure frame builder for the picker
src/ops.ts               core operations: active tab, minimize, restore, reconcile
src/run.ts               entrypoint wrapper: failures become herdr notifications
src/actions/minimize.ts  action entrypoint
src/actions/restore.ts   action entrypoint: 0 → notify, 1 → restore, >1 → open picker
src/picker.ts            restore picker TUI (popup entrypoint): search, list, live preview
src/hooks/reconcile.ts   startup and pane/tab lifecycle hook
```

TypeScript run directly by Bun, with no runtime dependencies, so installing
the plugin needs nothing but `bun`. `tree.ts` and `rebuild.ts` are pure and
carry the logic; they are unit-tested with `bun test`. Everything with I/O is
kept thin and covered by the live tests (`bun run test:live`).

## 4. Behaviour

### 4.0 Resolving the active tab

Every entrypoint (minimize, restore, picker) starts by resolving the active
tab with `herdr pane current --current`, which returns the focused pane and
its `tab_id`, and works only on that tab. Ids from the invocation context
(`HERDR_TAB_ID`) are used only as a cross-check: if they name a different tab,
the action stops with a notification rather than guess. This keeps a stray
keypress or a stale state record from rearranging a tab the user isn't
looking at. The `▾` tab itself is refused as a source tab.

### 4.1 Parking

Each workspace gets at most one `▾` tab (its id is in state). Minimizing moves
the pane into it (`pane move --tab ▾ --split right`, or `--new-tab --label ▾`
for the first one), always `--no-focus`. Because the pane never leaves its
workspace, its pane id stays the same; the plugin still keys everything by
`terminal_id`, which never changes, and looks pane ids up before each call.
After every minimize, and on every `tab.created` event, the `▾` tab is moved
back to the end of its workspace's tab bar (`tab.move` with `insert_index` =
tab count).

### 4.2 Minimize(pane X in tab T)

1. Refuse if T is a `▾` tab, or X is T's only pane (notification). Unzoom T
   if zoomed.
2. `layout.export` → tree keyed by terminal id. Update T's **full layout**
   (§4.3) and record an entry: X's terminal id, name, time, and its placement
   (`siblings`: terminal ids of X's sibling subtree, the parent split's `dir`
   and `ratio`, whether X was the first child).
3. Move X into the `▾` tab. Its sibling takes its space, exactly as if X had
   been closed; no rebuild is needed.
4. Focus: herdr has no focus-by-id, so focus goes wherever herdr moves it when
   the focused pane leaves.

### 4.3 Restore(entry E)

1. Current tree of T: `C`.
2. **Full layout.** State keeps, per tab, the layout with every minimized pane
   still in place. It stays valid while hiding the minimized panes from it
   still gives `C`; the target is then the full layout minus the panes that
   stay minimized, so panes come back exactly, in any order. (Each entry's
   own placement can't do that: minimize `c`, then its sibling `b`, restore
   `c` first, and `b`'s record no longer describes the tab.) If the user
   rearranged the tab, the full layout is rebuilt from `C` by reinserting the
   minimized panes newest first, each by its placement record:
   - find the smallest subtree of `C` whose leaf set equals the recorded
     siblings and split it in the recorded direction/ratio;
   - otherwise split the largest surviving sibling, or else the largest pane.
3. Rebuild T to the target (§4.5). X's move into T uses `--focus`.
4. Remove E and save. If the rebuild fails the entry is kept, so a pane is
   never stranded in the `▾` tab without a record.

Ratios come from the moment of minimizing: resizes made while panes are
minimized are undone by the restore.

### 4.4 Restore picker

Opened by the restore action when the current tab has more than one minimized
pane. It is a `[[panes]]` entrypoint `picker` with `placement = "popup"`
(about 80% × 80% of the terminal): a session-modal overlay that takes all
input and leaves the tiled layout alone.

- **Layout.** A search box across the top. Below it, left: one row per
  minimized pane of the active tab that matches the search, most recently
  minimized first (status glyph, name, cwd). Right: a preview of the selected
  pane's current screen. Below ~60 columns the preview is dropped.
- **Search.** Typing filters by display name (pane label → agent name →
  foreground process name), case-insensitive fuzzy subsequence, contiguous
  and word-start matches ranked first, matched characters highlighted. Empty
  query shows everything. No matches shows "No minimized pane matches".
  `backspace` deletes a character, `ctrl+u` clears.
- **Preview.** `herdr pane read <id> --source visible --format ansi`, re-read
  when the selection changes and about once a second. Lines are clipped
  ANSI-aware and the bottom of the screen is kept.
- **Keys.** Printable keys go to the search, so navigation is `up`/`down` and
  `ctrl+k`/`ctrl+j`. `enter` restores, `esc` cancels. Mouse: click selects,
  double-click restores, scroll moves.
- **Restore.** Leaves the popup's screen, runs §4.3, then exits (closing the
  popup).
- **Which tab.** The picker resolves the active tab itself (§4.0); the popup
  is modal, so it can't change while open. If fewer than two entries remain
  when it starts, it behaves like the action (restore the one, or notify).
- **Live changes.** Entries that disappear while it is open leave the list;
  with none left it closes.

### 4.5 Rebuild(tab T, target tree D)

- Fast paths: if D has the same shape as the current tree, only ratios
  change. If D adds one pane next to a single-pane sibling, it is one
  `pane move` (plus a `pane swap` when the new pane must be the first child).
- General path: anchor A = first leaf of the current tree. Move every other
  pane of T into a temporary staging tab in T's workspace. If D's first leaf
  isn't A, move it next to A and stage A. Then walk D top-down: for
  `split(dir, r, P, Q)` whose region is held by `firstLeaf(P)`, move
  `firstLeaf(Q)` with `--target-pane firstLeaf(P) --split dir`, then recurse.
  The staging tab closes by itself once empty.
- Finally every split of D is set to its exact ratio with
  `layout.set_split_ratio`.
- Everything runs under the state lock, so rapid key presses serialise.

### 4.6 Events and lifecycle

All handled by one hook (`src/hooks/reconcile.ts`), run at startup and on
`pane.closed`, `tab.closed` and `tab.created`:

- A minimized pane that exited, or that the user moved out of the `▾` tab, is
  forgotten.
- When a source tab no longer exists, its minimized panes are **closed**.
- A `▾` tab that no longer exists is forgotten; the next minimize creates one.
- Every `▾` tab is moved back to the end of its tab bar.

### 4.7 State file

`$HERDR_PLUGIN_STATE_DIR/state.json`, written atomically (temp file + rename)
under a `mkdir` lock:

```json
{
  "version": 1,
  "parking": { "w2": "w2:t4" },
  "tabs": {
    "w2:t1": {
      "entries": [
        { "terminal_id": "term_65d2fbbd24e7052", "name": "lazygit",
          "minimized_at": "2026-10-06T18:00:00.000Z",
          "siblings": ["term_65d2fbbd1de2e51"], "dir": "down", "ratio": 0.6,
          "was_first": false }
      ],
      "layout": { "kind": "split", "dir": "down", "ratio": 0.6,
                  "first": { "kind": "leaf", "id": "term_65d2fbbd1de2e51" },
                  "second": { "kind": "leaf", "id": "term_65d2fbbd24e7052" } }
    }
  }
}
```

`parking` maps a workspace to its `▾` tab; `tabs` is keyed by source tab id.
Bump `version` and migrate on read whenever
the shape changes.

## 5. Manifest entrypoints

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
id = "picker"
title = "Restore pane"
placement = "popup"
width = "80%"
height = "80%"
command = ["bun", "src/picker.ts"]

[[events]]  # also tab.closed and tab.created
on = "pane.closed"
command = ["bun", "src/hooks/reconcile.ts"]
```

## 6. Open risks

- **R2: rebuild flicker.** The general-path rebuild reflows the tab briefly.
  Most minimizes need no rebuild at all now; restores use the fast path when
  they can.
- **R3: server restart.** Unverified whether terminal ids survive a herdr
  server restart/handoff. Startup reconcile drops anything that can't be
  matched; it never guesses.
- **R5: picker popup.** Opening it returns `ui_busy` while another herdr modal
  is up; the action notifies instead.

## 7. Acceptance criteria

1. Minimize then restore a pane in a 2-, 3- and 5-pane nested layout →
   `herdr pane edges` rects after restore equal the rects before minimize (±1
   cell).
2. The minimized pane's shell PID is unchanged after minimize → restore.
3. An agent minimized while working keeps working and herdr notifications
   still fire for it.
4. The `▾` tab appears with the first minimized pane of a workspace, stays at
   the end of the tab bar, and disappears with the last restore.
5. Closing a tab closes its minimized panes; a minimized pane that exits is
   forgotten.
6. The restore action with one minimized pane restores it without any UI; with
   several it opens the picker, whose preview shows each pane's live screen,
   and `enter` restores the selected one to its original rect. Typing part of
   a pane's name narrows the list; arrows and `ctrl+j`/`ctrl+k` move.
7. Minimize on a tab with a single pane leaves it untouched and notifies.
8. Rapid repeated minimize/restore presses never leave a pane stranded (lock).
9. Live tests run only against workspaces they create and close, never the
   user's real tabs.
