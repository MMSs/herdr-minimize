// The tray pane: lists this tab's minimized panes; click or enter restores.
import type { View } from "./entries";
import { herdr } from "./herdr";
import { liveViews, reconcile, restoreAll, restoreEntry } from "./ops";
import { runEntrypoint } from "./run";
import { loadState } from "./state";
import { renderTray } from "./tui/render";
import { parseInput, Screen } from "./tui/term";

const GRACE_MS = 5_000;

await runEntrypoint(async () => {
  const myPane = process.env.HERDR_PANE_ID;
  if (!myPane) throw new Error("the tray must run as a herdr pane");
  const me = herdr.listPanes().find((p) => p.pane_id === myPane)?.terminal_id;
  const screen = new Screen();
  const started = Date.now();
  let tab: string | null = null;
  let views: View[] = [];
  let selected = -1;
  let rowToEntry: (number | null)[] = [];
  let busy = false;
  let emptyTicks = 0;

  const ownTab = () => {
    for (const [t, ts] of Object.entries(loadState().tabs))
      if (ts.tray_terminal_id === me) return t;
    return null;
  };
  const draw = () => {
    const { cols, rows } = screen.size();
    const frame = renderTray(views, selected, cols, rows);
    rowToEntry = frame.rowToEntry;
    screen.draw(frame.lines);
  };
  const refresh = async () => {
    if (busy) return;
    tab = ownTab();
    views = tab ? liveViews(tab) : [];
    selected = Math.min(selected, views.length - 1);
    if (!tab && Date.now() - started > GRACE_MS) {
      screen.stop();
      herdr.closePane(myPane);
      return;
    }
    emptyTicks = tab && views.length === 0 ? emptyTicks + 1 : 0;
    if (emptyTicks >= 3) await reconcile(); // panes exited; reconcile closes this tray
    draw();
  };
  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    try {
      await runEntrypoint(fn);
    } finally {
      busy = false;
      await refresh();
    }
  };

  screen.start();
  process.on("exit", () => screen.stop());
  process.stdout.on("resize", draw);
  process.stdin.on("data", (data) => {
    for (const key of parseInput(data.toString())) {
      if (key.kind === "mouse") {
        if (key.release) continue;
        if (key.button === 64) selected = Math.max(0, selected - 1);
        else if (key.button === 65) selected = Math.min(views.length - 1, selected + 1);
        else if (key.button === 0) {
          const idx = rowToEntry[key.y - 1];
          const v = idx == null ? undefined : views[idx];
          if (tab && v) void act(() => restoreEntry(tab as string, v.terminal_id));
        }
      } else if (key.kind === "down" || (key.kind === "char" && key.ch === "j")) {
        selected = Math.min(views.length - 1, selected + 1);
      } else if (key.kind === "up" || (key.kind === "char" && key.ch === "k")) {
        selected = Math.max(0, selected - 1);
      } else if (key.kind === "enter") {
        const v = views[selected];
        if (tab && v) void act(() => restoreEntry(tab as string, v.terminal_id));
      } else if (key.kind === "char" && key.ch === "R") {
        if (tab) void act(() => restoreAll(tab as string));
      }
    }
    draw();
  });
  await refresh();
  setInterval(() => void refresh(), 1_000);
  await new Promise(() => {}); // run until herdr closes the pane
});
