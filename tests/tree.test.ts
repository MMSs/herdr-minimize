import { describe, expect, test } from "bun:test";
import {
  areas,
  firstLeaf,
  fromExport,
  leaf,
  leaves,
  pathTo,
  reinsert,
  removeLeaf,
  sameShape,
  split,
  splitPaths,
  TRAY_RATIO,
  withoutTray,
  wrapTray,
} from "../src/tree";

// a | (b / c)
const abc = split("right", 0.6, leaf("a"), split("down", 0.5, leaf("b"), leaf("c")));

describe("tree", () => {
  test("leaves and firstLeaf follow first-to-second order", () => {
    expect(leaves(abc)).toEqual(["a", "b", "c"]);
    expect(firstLeaf(abc)).toBe("a");
  });

  test("pathTo uses false=first, true=second", () => {
    expect(pathTo(abc, "c")).toEqual([true, true]);
    expect(pathTo(abc, "a")).toEqual([false]);
    expect(pathTo(abc, "zz")).toBeNull();
  });

  test("removeLeaf gives the whole region to the sibling and records the placement", () => {
    const r = removeLeaf(abc, "b")!;
    expect(r.tree).toEqual(split("right", 0.6, leaf("a"), leaf("c")));
    expect(r).toMatchObject({ siblings: ["c"], dir: "down", ratio: 0.5, wasFirst: true });
    const r2 = removeLeaf(abc, "a")!;
    expect(r2.tree).toEqual(split("down", 0.5, leaf("b"), leaf("c")));
    expect(r2).toMatchObject({ siblings: ["b", "c"], dir: "right", ratio: 0.6, wasFirst: true });
  });

  test("removeLeaf refuses the only pane", () => {
    expect(removeLeaf(leaf("a"), "a")).toBeNull();
  });

  test("reinsert reverses removeLeaf exactly", () => {
    for (const id of ["a", "b", "c"]) {
      const r = removeLeaf(abc, id)!;
      expect(reinsert(r.tree, id, r)).toEqual(abc);
    }
  });

  test("reinsert falls back to the largest surviving sibling when the subtree changed", () => {
    const r = removeLeaf(abc, "a")!; // siblings b, c
    const changed = split("down", 0.3, leaf("b"), split("right", 0.5, leaf("c"), leaf("d")));
    // b has 0.3 of the area, c has 0.35 → c wins
    expect(reinsert(changed, "a", r)).toEqual(
      split(
        "down",
        0.3,
        leaf("b"),
        split("right", 0.5, split("right", 0.6, leaf("a"), leaf("c")), leaf("d")),
      ),
    );
  });

  test("reinsert falls back to the largest pane when no sibling survives", () => {
    const r = removeLeaf(abc, "a")!;
    const other = split("right", 0.2, leaf("x"), leaf("y"));
    expect(reinsert(other, "a", r)).toEqual(
      split("right", 0.2, leaf("x"), split("right", 0.6, leaf("a"), leaf("y"))),
    );
  });

  test("areas multiply ratios down the tree", () => {
    const m = areas(abc);
    expect(m.get("a")).toBeCloseTo(0.6);
    expect(m.get("c")).toBeCloseTo(0.2);
  });

  test("wrapTray puts the tray full-height on the right; withoutTray undoes it", () => {
    const w = wrapTray(abc, "t");
    expect(w).toEqual(split("right", TRAY_RATIO, abc, leaf("t")));
    expect(withoutTray(w, "t")).toEqual(abc);
    expect(withoutTray(abc, null)).toEqual(abc);
  });

  test("sameShape ignores ratios but not ids or directions", () => {
    expect(
      sameShape(abc, split("right", 0.1, leaf("a"), split("down", 0.9, leaf("b"), leaf("c")))),
    ).toBe(true);
    expect(
      sameShape(abc, split("down", 0.6, leaf("a"), split("down", 0.5, leaf("b"), leaf("c")))),
    ).toBe(false);
    expect(
      sameShape(abc, split("right", 0.6, leaf("a"), split("down", 0.5, leaf("c"), leaf("b")))),
    ).toBe(false);
  });

  test("splitPaths lists every split top-down", () => {
    expect(splitPaths(abc)).toEqual([
      { path: [], ratio: 0.6 },
      { path: [true], ratio: 0.5 },
    ]);
  });

  test("fromExport maps herdr nodes and keys leaves", () => {
    const t = fromExport(
      {
        type: "split",
        direction: "right",
        ratio: 0.6,
        first: { type: "pane", pane_id: "w1:p1" },
        second: { type: "pane", pane_id: "w1:p2" },
      },
      (p) => `term-${p}`,
    );
    expect(t).toEqual(split("right", 0.6, leaf("term-w1:p1"), leaf("term-w1:p2")));
  });
});
