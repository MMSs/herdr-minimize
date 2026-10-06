import { describe, expect, test } from "bun:test";
import { planRebuild } from "../src/rebuild";
import {
  leaf,
  leaves,
  reinsert,
  removeLeaf,
  split,
  type Tree,
  withoutTray,
  wrapTray,
} from "../src/tree";
import { simulate } from "./support/simulate";

const abc = split("right", 0.6, leaf("a"), split("down", 0.5, leaf("b"), leaf("c")));

function check(current: Tree, target: Tree) {
  const steps = planRebuild(current, target);
  expect(simulate(current, steps)).toEqual(target);
  return steps;
}

describe("planRebuild", () => {
  test("same shape only fixes ratios", () => {
    const steps = check(
      split("right", 0.5, leaf("a"), leaf("b")),
      split("right", 0.7, leaf("a"), leaf("b")),
    );
    expect(steps.every((s) => s.op === "ratio")).toBe(true);
  });

  test("single insertion next to a leaf is one move", () => {
    const r = removeLeaf(abc, "c")!;
    const steps = check(r.tree, abc);
    expect(steps.filter((s) => s.op !== "ratio")).toEqual([
      { op: "place", id: "c", target: "b", dir: "down", ratio: 0.5 },
    ]);
  });

  test("single insertion as first child uses place + swap", () => {
    const r = removeLeaf(abc, "b")!;
    const steps = check(r.tree, abc);
    expect(steps.map((s) => s.op).filter((o) => o !== "ratio")).toEqual(["place", "swap"]);
  });

  test("restoring next to a subtree takes the general path", () => {
    const r = removeLeaf(abc, "a")!; // sibling is b/c subtree
    check(r.tree, abc);
  });

  test("restoring the root anchor pane works", () => {
    const r = removeLeaf(abc, "a")!;
    const steps = check(wrapTray(r.tree, "t"), wrapTray(abc, "t"));
    expect(steps.some((s) => s.op === "stage" && s.id === "b")).toBe(true);
  });

  test("wrapping a nested tree with a tray that was opened beside one pane", () => {
    const current = split(
      "right",
      0.6,
      split("right", 0.5, leaf("a"), leaf("t")),
      split("down", 0.5, leaf("b"), leaf("c")),
    );
    check(current, wrapTray(abc, "t"));
  });

  test("refuses to drop a pane", () => {
    expect(() => planRebuild(abc, split("right", 0.5, leaf("a"), leaf("b")))).toThrow(/drop c/);
  });

  test("fuzz: any minimize/restore sequence reaches the target exactly", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const randomTree = (ids: string[]): Tree => {
      if (ids.length === 1) return leaf(ids[0]!);
      const cut = 1 + Math.floor(rand() * (ids.length - 1));
      return split(
        rand() < 0.5 ? "right" : "down",
        0.2 + rand() * 0.6,
        randomTree(ids.slice(0, cut)),
        randomTree(ids.slice(cut)),
      );
    };
    for (let i = 0; i < 300; i++) {
      const n = 2 + Math.floor(rand() * 6);
      const original = randomTree(Array.from({ length: n }, (_, k) => `p${k}`));
      const victim = leaves(original)[Math.floor(rand() * n)]!;
      const removed = removeLeaf(original, victim)!;
      // minimize: tray opened beside the first pane, then wrapped
      const opened = (() => {
        const first = leaves(removed.tree)[0]!;
        return reinsert(removed.tree, "t", {
          siblings: [first],
          dir: "right",
          ratio: 0.5,
          wasFirst: false,
        });
      })();
      check(opened, wrapTray(removed.tree, "t"));
      // restore with the tray still present, then the tray is closed by the caller
      const restoredTarget = wrapTray(reinsert(removed.tree, victim, removed), "t");
      check(wrapTray(removed.tree, "t"), restoredTarget);
      expect(withoutTray(restoredTarget, "t")).toEqual(original);
    }
  });
});
