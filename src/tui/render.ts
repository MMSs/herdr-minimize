// Pure frame builders for the tray and the picker. Every returned line is
// exactly `cols` wide so a redraw never leaves stale characters.
import { glyph, type View } from "../entries";
import { clipAnsi } from "./term";

export const PREVIEW_MIN_COLS = 60;
const DIM = (s: string) => `\x1b[2m${s}\x1b[22m`;
const REVERSE = "\x1b[7m";

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
