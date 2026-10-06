import type { Step } from "../../src/rebuild";
import {
  at,
  leaf,
  pathTo,
  removeLeaf,
  replaceAt,
  type Split,
  split,
  type Tree,
} from "../../src/tree";

/** Applies steps the way herdr would, throwing on anything herdr would refuse or that strands a pane. */
export function simulate(start: Tree, steps: Step[]): Tree {
  let tab: Tree = start;
  const has = (id: string) => pathTo(tab, id) !== null;
  for (const s of steps) {
    switch (s.op) {
      case "stage": {
        if (!has(s.id)) throw new Error(`stage: ${s.id} not in tab`);
        const r = removeLeaf(tab, s.id);
        if (!r) throw new Error(`stage: ${s.id} is the last pane; the tab would close`);
        tab = r.tree;
        break;
      }
      case "place": {
        if (has(s.id)) throw new Error(`place: ${s.id} already in tab`);
        const p = pathTo(tab, s.target);
        if (!p) throw new Error(`place: target ${s.target} not in tab`);
        tab = replaceAt(tab, p, split(s.dir, s.ratio, leaf(s.target), leaf(s.id)));
        break;
      }
      case "swap": {
        const pa = pathTo(tab, s.a);
        const pb = pathTo(tab, s.b);
        if (!pa || !pb) throw new Error("swap: pane not in tab");
        tab = replaceAt(replaceAt(tab, pa, leaf(s.b)), pb, leaf(s.a));
        break;
      }
      case "ratio": {
        const node = at(tab, s.path);
        if (node.kind !== "split") throw new Error("ratio: path is not a split");
        tab = replaceAt(tab, s.path, { ...(node as Split), ratio: s.ratio });
        break;
      }
    }
  }
  return tab;
}
