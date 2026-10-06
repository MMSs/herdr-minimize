// Plans the herdr moves that turn the current tab tree into the target tree
// without killing anything. herdr can only split a single leaf, so anything
// beyond a one-pane insertion is rebuilt top-down from one anchor pane.
import {
  type Dir,
  firstLeaf,
  leaves,
  type Path,
  removeLeaf,
  sameShape,
  splitPaths,
  type Tree,
} from "./tree";

export type Step =
  | { op: "stage"; id: string }
  | { op: "place"; id: string; target: string; dir: Dir; ratio: number }
  | { op: "swap"; a: string; b: string }
  | { op: "ratio"; path: Path; ratio: number };

export function planRebuild(current: Tree, target: Tree): Step[] {
  const wanted = new Set(leaves(target));
  for (const id of leaves(current)) {
    if (!wanted.has(id)) throw new Error(`rebuild would drop ${id}`);
  }
  const present = new Set(leaves(current));
  const incoming = leaves(target).filter((id) => !present.has(id));
  const ratios: Step[] = splitPaths(target).map(({ path, ratio }) => ({
    op: "ratio",
    path,
    ratio,
  }));

  if (incoming.length === 0 && sameShape(current, target)) return ratios;

  if (incoming.length === 1) {
    const x = incoming[0] as string;
    const r = removeLeaf(target, x);
    if (r && r.siblings.length === 1 && sameShape(current, r.tree)) {
      const s = r.siblings[0] as string;
      const place: Step = {
        op: "place",
        id: x,
        target: s,
        dir: r.dir,
        ratio: r.wasFirst ? 1 - r.ratio : r.ratio,
      };
      return r.wasFirst ? [place, { op: "swap", a: x, b: s }, ...ratios] : [place, ...ratios];
    }
  }

  const anchor = firstLeaf(current);
  const steps: Step[] = leaves(current)
    .filter((id) => id !== anchor)
    .map((id) => ({ op: "stage", id }));
  const root = firstLeaf(target);
  if (root !== anchor) {
    steps.push(
      { op: "place", id: root, target: anchor, dir: "right", ratio: 0.5 },
      { op: "stage", id: anchor },
    );
  }
  const walk = (node: Tree) => {
    if (node.kind === "leaf") return;
    steps.push({
      op: "place",
      id: firstLeaf(node.second),
      target: firstLeaf(node.first),
      dir: node.dir,
      ratio: node.ratio,
    });
    walk(node.first);
    walk(node.second);
  };
  walk(target);
  return [...steps, ...ratios];
}
