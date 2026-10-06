// Pure frame builders for the tray and the picker. Every returned line is
// exactly `cols` wide so a redraw never leaves stale characters.
import { glyph, type View } from "../entries";
import { GLYPH_H, GLYPH_W } from "./font";
import { rasterLabel } from "./raster";
import { clipAnsi } from "./term";

export const PREVIEW_MIN_COLS = 60;
const DIM = (s: string) => `\x1b[2m${s}\x1b[22m`;
const REVERSE = "\x1b[7m";

export type CellSize = { cellW: number; cellH: number };
export type TrayImage = {
  row: number;
  col: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  label: string;
  rgba: Uint8Array;
};

type Rgb = [number, number, number];
const SHADES: Record<View["status"], { bg: Rgb; fg: Rgb; mark: string }> = {
  none: { bg: [58, 60, 74], fg: [205, 208, 220], mark: "○" },
  unknown: { bg: [58, 60, 74], fg: [205, 208, 220], mark: "○" },
  idle: { bg: [58, 60, 74], fg: [150, 214, 140], mark: "●" },
  working: { bg: [76, 64, 38], fg: [240, 198, 116], mark: "●" },
  blocked: { bg: [112, 36, 44], fg: [255, 196, 190], mark: "▲" },
};
const SELECTED_LIFT = 36;
const MARGIN = 1;

/**
 * The tray as shaded vertical strips, one per minimized pane: status mark on
 * top, then the name. With kitty graphics the name is an image of the word
 * turned 90° clockwise; otherwise its letters are stacked. Names share the
 * height; strips that don't fit at all collapse into a "+N" marker.
 */
export function renderTray(
  views: View[],
  selected: number,
  cols: number,
  rows: number,
  gfx: CellSize | null = null,
) {
  const lines: string[] = [];
  const rowToEntry: (number | null)[] = [];
  const images: TrayImage[] = [];
  const push = (text: string, entry: number | null) => {
    lines.push(clipAnsi(text, cols));
    rowToEntry.push(entry);
  };

  let tabCols = 3;
  let scale = 0;
  if (gfx) {
    // Letters about as tall as terminal text (~60% of a cell), never wider than the strip.
    const textScale = Math.max(1, Math.round((gfx.cellH * 0.6) / GLYPH_H));
    const fits = (columns: number) => Math.floor((columns * gfx.cellW - 4) / GLYPH_H);
    tabCols = fits(2) >= textScale ? 2 : 3;
    scale = Math.max(1, Math.min(textScale, fits(tabCols)));
  }
  const advance = (GLYPH_W + 1) * scale;

  const n = views.length;
  const budget = Math.max(1, Math.floor((rows - 3 * n + 1) / Math.max(1, n)));
  for (let i = 0; i < n; i++) {
    const v = views[i] as View;
    const chars = [...v.name];
    // One row per letter in every mode: the letters are what terminals
    // without kitty graphics show; the rotated image just covers them.
    const fit = budget;
    const label = chars.length > fit ? [...chars.slice(0, fit - 1), "…"] : chars;
    const height = label.length + 2;
    const last = i === n - 1;
    if (lines.length + height > (last ? rows : rows - 2)) {
      push(`\x1b[2m+${n - i}\x1b[22m`, null);
      break;
    }
    const shade = SHADES[v.status];
    const bg = shade.bg.map((c) => Math.min(255, c + (i === selected ? SELECTED_LIFT : 0)));
    const fg = `\x1b[38;2;${shade.fg.join(";")}m`;
    const cell = (content: string) => {
      const left = Math.floor((tabCols - Bun.stringWidth(content)) / 2);
      const body = `${" ".repeat(left)}${content}`.padEnd(
        tabCols - Bun.stringWidth(content) + content.length,
      );
      const strong = v.status === "blocked" ? "\x1b[1m" : "";
      return `${" ".repeat(MARGIN)}\x1b[48;2;${bg.join(";")}m${fg}${strong}${body}\x1b[0m`;
    };
    push(cell(shade.mark), i);
    if (gfx) {
      const text = label.join("");
      const width = tabCols * gfx.cellW;
      const heightPx = label.length * gfx.cellH;
      const textPx = label.length * advance - scale;
      images.push({
        row: lines.length,
        col: MARGIN,
        cols: tabCols,
        rows: label.length,
        width,
        height: heightPx,
        label: text,
        rgba: rasterLabel(text, {
          width,
          height: heightPx,
          scale,
          pad: Math.max(0, Math.floor((heightPx - textPx) / 2)),
          fg: shade.fg,
          bg: bg as [number, number, number],
        }),
      });
    }
    for (const ch of label) push(cell(Bun.stringWidth(ch) === 1 ? ch : "·"), i);
    push(cell(""), i);
    if (!last) push("", null);
  }
  while (lines.length < rows) push("", null);
  return { lines: lines.slice(0, rows), rowToEntry: rowToEntry.slice(0, rows), images };
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
