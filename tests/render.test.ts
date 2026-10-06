import { describe, expect, test } from "bun:test";
import type { View } from "../src/entries";
import { renderPicker, renderTray } from "../src/tui/render";
import { stripAnsi } from "../src/tui/term";

const v = (name: string, cwd: string | null = "proj", status: View["status"] = "none"): View => ({
  terminal_id: name,
  pane_id: name,
  name,
  status,
  cwd,
  minimized_at: "x",
});

describe("renderTray", () => {
  const plain = (lines: string[]) => lines.map(stripAnsi).map((l) => l.trimEnd());
  const SLATE = "\x1b[48;2;58;60;74m";
  const RED = "\x1b[48;2;112;36;44m";
  const gfx = { cellW: 16, cellH: 34 };

  test("text mode: a shaded strip per pane, status mark on top, letters stacked below", () => {
    const { lines, rowToEntry, images } = renderTray([v("zsh")], -1, 16, 7);
    expect(plain(lines)).toEqual(["  ○", "  z", "  s", "  h", "", "", ""]);
    expect(rowToEntry).toEqual([0, 0, 0, 0, 0, null, null]);
    expect(lines[4]).toContain(SLATE); // bottom padding row is still shaded
    expect(lines[5]).not.toContain(SLATE);
    expect(images).toEqual([]);
    expect(lines.every((l) => Bun.stringWidth(stripAnsi(l)) === 16)).toBe(true);
  });

  test("with a known cell size, an opaque rotated-name image covers the stacked letters", () => {
    const { lines, rowToEntry, images } = renderTray([v("agent")], -1, 16, 10, gfx);
    // the letters stay in the text cells for terminals that can't show images
    expect(plain(lines).slice(0, 7)).toEqual([" ○", " a", " g", " e", " n", " t", ""]);
    expect(rowToEntry.slice(0, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, null]);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      row: 1,
      col: 1,
      cols: 2,
      rows: 5,
      width: 32,
      height: 170,
      label: "agent",
    });
    const rgba = images[0]!.rgba;
    expect(rgba).toHaveLength(32 * 170 * 4);
    expect(rgba.every((value, i) => i % 4 !== 3 || value === 255)).toBe(true);
  });

  test("rotated letters are about as tall as terminal text, not as wide as the strip", () => {
    const { images } = renderTray([v("I")], -1, 16, 6, gfx);
    const { rgba, width, height } = images[0]!;
    const fgCols = new Set<number>();
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4] === 205) fgCols.add(x);
    // 7 font pixels × scale 3 (≈ 60% of a 34px cell) = 21px across
    expect(Math.max(...fgCols) - Math.min(...fgCols) + 1).toBe(21);
  });

  test("strips are separated by an unshaded gap row", () => {
    const { rowToEntry } = renderTray([v("ab"), v("cd")], -1, 16, 12);
    expect(rowToEntry.slice(0, 9)).toEqual([0, 0, 0, 0, null, 1, 1, 1, 1]);
  });

  test("blocked panes get a red strip; the selected strip is lighter", () => {
    const { lines } = renderTray([v("a", null, "blocked"), v("b")], 1, 16, 10);
    expect(lines[0]).toContain(RED);
    expect(lines[5]).not.toContain(SLATE);
    expect(lines[5]).toContain("\x1b[48;2;94;96;110m");
  });

  test("long names are cut with an ellipsis so the strips fit", () => {
    expect(
      plain(renderTray([v("abcdefghij"), v("klmnopqrst")], -1, 16, 12).lines).slice(0, 5),
    ).toEqual(["  ○", "  a", "  b", "  …", ""]);
    const { images } = renderTray([v("abcdefghijklmnopqrst")], -1, 16, 8, gfx);
    expect(images[0]!.label).toBe("abcde…");
    expect(images[0]!.rows).toBe(6);
  });

  test("strips that don't fit collapse into a +N marker", () => {
    const { lines, rowToEntry } = renderTray([v("ab"), v("cd"), v("ef")], -1, 16, 6);
    expect(plain(lines)).toEqual(["  ○", "  …", "", "", "+2", ""]);
    expect(rowToEntry[4]).toBeNull();
  });
});

describe("renderPicker", () => {
  const base = {
    query: "",
    selected: 0,
    preview: ["$ make", "\x1b[32mok\x1b[0m"],
    cols: 80,
    rows: 8,
  };
  test("search line, list beside preview, hints at the bottom", () => {
    const { lines, rowToItem } = renderPicker({
      ...base,
      items: [
        { view: v("zsh"), positions: [] },
        { view: v("claude"), positions: [] },
      ],
    });
    const plain = lines.map(stripAnsi);
    expect(plain[0]).toContain("Restore pane");
    expect(plain[2]).toContain("zsh");
    expect(plain[2]).toContain("│ $ make");
    expect(plain[3]).toContain("claude");
    expect(plain.at(-1)).toContain("enter restore");
    expect(rowToItem.slice(0, 4)).toEqual([null, null, 0, 1]);
    expect(lines).toHaveLength(8);
    expect(lines.every((l) => Bun.stringWidth(stripAnsi(l)) === 80)).toBe(true);
  });
  test("no matches message", () => {
    expect(renderPicker({ ...base, query: "qq", items: [] }).lines.map(stripAnsi)[2]).toContain(
      "No minimized pane matches",
    );
  });
  test("preview dropped below the minimum width", () => {
    const { lines } = renderPicker({
      ...base,
      cols: 40,
      items: [{ view: v("zsh"), positions: [] }],
    });
    expect(lines.map(stripAnsi).some((l) => l.includes("│"))).toBe(false);
  });
  test("matched characters are highlighted", () => {
    const { lines } = renderPicker({
      ...base,
      query: "zs",
      items: [{ view: v("zsh"), positions: [0, 1] }],
    });
    expect(lines[2]).toContain("\x1b[1;4mz\x1b[22;24m");
  });
  test("preview shows the bottom of the screen", () => {
    const preview = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const plain = renderPicker({
      ...base,
      preview,
      items: [{ view: v("zsh"), positions: [] }],
    }).lines.map(stripAnsi);
    expect(plain[2]).toContain("line 15");
    expect(plain[6]).toContain("line 19");
  });
  test("list scrolls to keep the selection visible", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ view: v(`p${i}`), positions: [] }));
    const { rowToItem } = renderPicker({ ...base, items, selected: 9 });
    expect(rowToItem).toContain(9);
  });
});
