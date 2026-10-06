// Restore picker popup: fuzzy search by name, live preview, enter restores.
import { filterViews, newestFirst, type View } from "./entries";
import { herdr } from "./herdr";
import { activeContext, liveViews, restoreEntry, UserError } from "./ops";
import { runEntrypoint } from "./run";
import { renderPicker } from "./tui/render";
import { parseInput, Screen, screenLines } from "./tui/term";

const DOUBLE_CLICK_MS = 400;

await runEntrypoint(async () => {
  const { tab } = activeContext();
  let views = newestFirst(liveViews(tab));
  if (views.length === 0) throw new UserError("No minimized panes in this tab.");
  if (views.length === 1) return restoreEntry(tab, (views[0] as View).terminal_id);

  const screen = new Screen();
  let query = "";
  let selected = 0;
  let preview: string[] = [];
  let rowToItem: (number | null)[] = [];
  let lastClick = { idx: -1, at: 0 };
  const { promise: chosen, resolve: choose } = Promise.withResolvers<View | null>();

  const items = () => filterViews(views, query);
  const current = () => items()[selected]?.view;
  const loadPreview = () => {
    const v = current();
    try {
      preview = v ? screenLines(herdr.readScreen(v.pane_id)) : [];
    } catch {
      preview = [];
    }
  };
  const draw = () => {
    const { cols, rows } = screen.size();
    const frame = renderPicker({ query, items: items(), selected, preview, cols, rows });
    rowToItem = frame.rowToItem;
    screen.draw(frame.lines);
  };
  const move = (delta: number) => {
    selected = Math.max(0, Math.min(items().length - 1, selected + delta));
    loadPreview();
  };
  const setQuery = (q: string) => {
    query = q;
    selected = 0;
    loadPreview();
  };

  screen.start();
  process.on("exit", () => screen.stop());
  process.stdout.on("resize", draw);
  process.stdin.on("data", (data) => {
    for (const key of parseInput(data.toString())) {
      switch (key.kind) {
        case "char":
          setQuery(query + key.ch);
          break;
        case "backspace":
          setQuery([...query].slice(0, -1).join(""));
          break;
        case "ctrl-u":
          setQuery("");
          break;
        case "up":
        case "ctrl-k":
          move(-1);
          break;
        case "down":
        case "ctrl-j":
          move(1);
          break;
        case "enter":
          if (current()) choose(current() as View);
          break;
        case "esc":
        case "ctrl-c":
          choose(null);
          break;
        case "mouse": {
          if (key.release) break;
          if (key.button === 64) move(-1);
          else if (key.button === 65) move(1);
          else if (key.button === 0) {
            const idx = rowToItem[key.y - 1];
            if (idx == null) break;
            const now = Date.now();
            if (idx === lastClick.idx && now - lastClick.at < DOUBLE_CLICK_MS)
              choose(items()[idx]?.view ?? null);
            selected = idx;
            lastClick = { idx, at: now };
            loadPreview();
          }
        }
      }
    }
    draw();
  });

  const tick = setInterval(() => {
    const keep = current()?.terminal_id;
    views = newestFirst(liveViews(tab));
    if (views.length === 0) return choose(null);
    const idx = items().findIndex((r) => r.view.terminal_id === keep);
    selected = idx >= 0 ? idx : Math.min(selected, Math.max(0, items().length - 1));
    loadPreview();
    draw();
  }, 1_000);

  loadPreview();
  draw();
  const pick = await chosen;
  clearInterval(tick);
  screen.stop();
  if (pick) await restoreEntry(tab, pick.terminal_id);
  process.exit(0);
});
