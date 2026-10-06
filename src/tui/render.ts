// Pure frame builders for the tray and the picker. Every returned line is
// exactly `cols` wide so a redraw never leaves stale characters.
import { glyph, type View } from "../entries";
import { clipAnsi } from "./term";

export const PREVIEW_MIN_COLS = 60;
const DIM = (s: string) => `\x1b[2m${s}\x1b[22m`;
const REVERSE = "\x1b[7m";

/**
 * The tray as boxed vertical tabs: status mark on top, then the name one
 * letter per row. Names share the height evenly; tabs that don't fit at all
 * collapse into a "+N" marker.
 */
export function renderTray(views: View[], selected: number, cols: number, rows: number) {
  const lines: string[] = [];
  const rowToEntry: (number | null)[] = [];
  const push = (text: string, entry: number | null) => {
    lines.push(clipAnsi(text, cols));
    rowToEntry.push(entry);
  };
  const n = views.length;
  const letters = Math.max(1, Math.floor((rows - n * 4) / Math.max(1, n)));
  for (let i = 0; i < n; i++) {
    const v = views[i] as View;
    const chars = [...v.name].map((ch) => (Bun.stringWidth(ch) === 1 ? ch : "·"));
    const label = chars.length > letters ? [...chars.slice(0, letters - 1), "…"] : chars;
    const last = i === n - 1;
    if (lines.length + label.length + 3 > (last ? rows : rows - 2)) {
      push(DIM(`+${n - i}`), null);
      break;
    }
    const on = (s: string) => (i === selected ? `${REVERSE}${s}\x1b[27m` : s);
    const strong = (s: string) => (v.status === "blocked" ? `\x1b[1m${s}\x1b[22m` : s);
    push("╭─╮", i);
    push(`│${on(glyph(v.status))}│`, i);
    for (const ch of label) push(`│${on(strong(ch))}│`, i);
    push("╰─╯", i);
    if (!last) push("", null);
  }
  while (lines.length < rows) push("", null);
  return { lines: lines.slice(0, rows), rowToEntry: rowToEntry.slice(0, rows) };
}

export type PickerModel = {
  query: string;
  items: { view: View; positions: number[] }[];
  selected: number;
  preview: string[];
  cols: number;
  rows: number;
};

function highlight(name: string, positions: number[]): string {
  const hit = new Set(positions);
  return [...name].map((ch, i) => (hit.has(i) ? `\x1b[1;4m${ch}\x1b[22;24m` : ch)).join("");
}

export function renderPicker(m: PickerModel) {
  const { cols, rows } = m;
  const body = Math.max(1, rows - 3);
  const showPreview = cols >= PREVIEW_MIN_COLS;
  const listW = showPreview ? Math.min(40, Math.floor(cols * 0.35)) : cols;
  const prevW = cols - listW - 3;
  const lines: string[] = [];
  const rowToItem: (number | null)[] = [];

  lines.push(
    clipAnsi(` \x1b[1mRestore pane\x1b[22m  ${DIM("search:")} ${m.query}\x1b[7m \x1b[27m`, cols),
  );
  lines.push(clipAnsi(DIM("─".repeat(cols)), cols));
  rowToItem.push(null, null);

  const start = Math.max(0, Math.min(m.selected - body + 1, m.items.length - body));
  const preview = m.preview.slice(-body);
  for (let r = 0; r < body; r++) {
    const idx = start + r;
    const item = m.items[idx];
    let cell: string;
    if (item) {
      const sel = idx === m.selected;
      const text = `${glyph(item.view.status)} ${highlight(item.view.name, item.positions)}${item.view.cwd ? `  ${DIM(item.view.cwd)}` : ""}`;
      cell = (sel ? REVERSE : "") + clipAnsi(text, listW);
    } else {
      cell = clipAnsi(
        r === 0 && m.items.length === 0 ? DIM("No minimized pane matches") : "",
        listW,
      );
    }
    lines.push(showPreview ? `${cell}${DIM(" │ ")}${clipAnsi(preview[r] ?? "", prevW)}` : cell);
    rowToItem.push(item ? idx : null);
  }

  lines.push(clipAnsi(DIM(" ↑↓ / ctrl+j ctrl+k move · enter restore · esc cancel"), cols));
  rowToItem.push(null);
  return { lines, rowToItem };
}
