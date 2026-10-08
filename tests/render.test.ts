import { describe, expect, test } from "bun:test";
import type { View } from "../src/entries";
import { renderPicker } from "../src/tui/render";
import { stripAnsi } from "../src/tui/term";

const v = (name: string, cwd: string | null = "proj", status: View["status"] = "none"): View => ({
  pane_id: name,
  name,
  status,
  cwd,
  minimized_at: "x",
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
