// The tray pane: lists this tab's minimized panes; click or enter restores.
import type { View } from "./entries";
import { herdr } from "./herdr";
import { liveViews, reconcile, restoreAll, restoreEntry } from "./ops";
import { runEntrypoint } from "./run";
import { loadState } from "./state";
import { detectReplies, KITTY_CLEAR, KITTY_PROBE, kittyImage } from "./tui/kitty";
import { type CellSize, renderTray } from "./tui/render";
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
  let cell: CellSize | null = null;
  let shown = "";

  const ownTab = () => {
    for (const [t, ts] of Object.entries(loadState().tabs))
      if (ts.tray_terminal_id === me) return t;
    return null;
  };
  const draw = () => {
    const { cols, rows } = screen.size();
    const frame = renderTray(views, selected, cols, rows, cell);
    rowToEntry = frame.rowToEntry;
    // Re-sending images every tick would flicker; only redraw on change.
    const key = JSON.stringify([
      frame.lines,
      frame.images.map((im) => [im.row, im.rows, im.label]),
    ]);
    if (key === shown) return;
    shown = key;
    process.stdout.write(KITTY_CLEAR);
    screen.draw(frame.lines);
    // Each image is opaque and covers the stacked letters below it; terminals
    // without kitty graphics never show it and keep the letters.
    for (const im of frame.images) {
      process.stdout.write(
        `\x1b[${im.row + 1};${im.col + 1}H${kittyImage(im.rgba, im.width, im.height, im.cols, im.rows)}`,
      );
    }
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
  process.stdout.write(KITTY_PROBE);
  process.on("exit", () => {
    process.stdout.write(KITTY_CLEAR);
    screen.stop();
  });
  process.stdout.on("resize", () => {
    process.stdout.write(KITTY_PROBE); // cell size may change with the font
    draw();
  });
  process.stdin.on("data", (data) => {
    const text = data.toString();
    const size = detectReplies(text);
    if (size && (size.cellW !== cell?.cellW || size.cellH !== cell?.cellH)) cell = size;
    for (const key of parseInput(text)) {
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
