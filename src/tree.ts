// Pure operations on herdr's binary split layout. Leaves are keyed by a
// stable id (we use terminal ids; pane ids change across workspaces).

export type Dir = "right" | "down";
export type Leaf = { kind: "leaf"; id: string };
export type Split = { kind: "split"; dir: Dir; ratio: number; first: Tree; second: Tree };
export type Tree = Leaf | Split;
/** herdr's layout path: false = first child, true = second child. */
export type Path = boolean[];

export type ExportNode =
  | { type: "pane"; pane_id: string; label?: string; cwd?: string }
  | { type: "split"; direction: Dir; ratio: number; first: ExportNode; second: ExportNode };

export const TRAY_RATIO = 0.9;

export const leaf = (id: string): Leaf => ({ kind: "leaf", id });
export const split = (dir: Dir, ratio: number, first: Tree, second: Tree): Split => ({
  kind: "split",
  dir,
  ratio,
  first,
  second,
});

export function leaves(t: Tree): string[] {
  return t.kind === "leaf" ? [t.id] : [...leaves(t.first), ...leaves(t.second)];
}

export function firstLeaf(t: Tree): string {
  return t.kind === "leaf" ? t.id : firstLeaf(t.first);
}

export function at(t: Tree, path: Path): Tree {
  let node = t;
  for (const second of path) {
    if (node.kind !== "split") throw new Error("path leaves the tree");
    node = second ? node.second : node.first;
  }
  return node;
}

export function replaceAt(t: Tree, path: Path, sub: Tree): Tree {
  if (path.length === 0) return sub;
  if (t.kind !== "split") throw new Error("path leaves the tree");
  const [second, ...rest] = path;
  return second
    ? { ...t, second: replaceAt(t.second, rest, sub) }
    : { ...t, first: replaceAt(t.first, rest, sub) };
}

export function pathTo(t: Tree, id: string): Path | null {
  if (t.kind === "leaf") return t.id === id ? [] : null;
  const first = pathTo(t.first, id);
  if (first) return [false, ...first];
  const second = pathTo(t.second, id);
  return second ? [true, ...second] : null;
}

export type Removal = {
  tree: Tree;
  siblings: string[];
  dir: Dir;
  ratio: number;
  wasFirst: boolean;
};
export type Placement = Omit<Removal, "tree">;

/** Removes a leaf the way herdr does: its sibling takes the parent's whole region. */
export function removeLeaf(t: Tree, id: string): Removal | null {
  const path = pathTo(t, id);
  if (!path || path.length === 0) return null;
  const parentPath = path.slice(0, -1);
  const parent = at(t, parentPath) as Split;
  const wasFirst = path[path.length - 1] === false;
  const sibling = wasFirst ? parent.second : parent.first;
  return {
    tree: replaceAt(t, parentPath, sibling),
    siblings: leaves(sibling),
    dir: parent.dir,
    ratio: parent.ratio,
    wasFirst,
  };
}

function findSubtree(t: Tree, ids: string[]): Path | null {
  const want = new Set(ids);
  const walk = (node: Tree, path: Path): Path | null => {
    const ls = leaves(node);
    if (ls.length === want.size && ls.every((l) => want.has(l))) return path;
    if (node.kind === "leaf") return null;
    return walk(node.first, [...path, false]) ?? walk(node.second, [...path, true]);
  };
  return walk(t, []);
}

export function areas(t: Tree, share = 1, out = new Map<string, number>()): Map<string, number> {
  if (t.kind === "leaf") return out.set(t.id, share);
  areas(t.first, share * t.ratio, out);
  areas(t.second, share * (1 - t.ratio), out);
  return out;
}

/** Puts `id` back next to its recorded siblings; falls back per design §4.3. */
export function reinsert(t: Tree, id: string, p: Placement): Tree {
  const wrap = (s: Tree) =>
    p.wasFirst ? split(p.dir, p.ratio, leaf(id), s) : split(p.dir, p.ratio, s, leaf(id));
  const exact = findSubtree(t, p.siblings);
  if (exact) return replaceAt(t, exact, wrap(at(t, exact)));
  const sizes = areas(t);
  const surviving = p.siblings.filter((s) => sizes.has(s));
  const pool = surviving.length > 0 ? surviving : [...sizes.keys()];
  const target = pool.reduce((best, s) =>
    (sizes.get(s) ?? 0) > (sizes.get(best) ?? 0) ? s : best,
  );
  return replaceAt(t, pathTo(t, target) as Path, wrap(leaf(target)));
}

export function wrapTray(t: Tree, tray: string): Tree {
  return split("right", TRAY_RATIO, t, leaf(tray));
}

export function withoutTray(t: Tree, tray: string | null): Tree {
  if (!tray) return t;
  return removeLeaf(t, tray)?.tree ?? t;
}

export function sameShape(a: Tree, b: Tree): boolean {
  if (a.kind === "leaf" || b.kind === "leaf")
    return a.kind === "leaf" && b.kind === "leaf" && a.id === b.id;
  return a.dir === b.dir && sameShape(a.first, b.first) && sameShape(a.second, b.second);
}

export function splitPaths(t: Tree, path: Path = []): { path: Path; ratio: number }[] {
  if (t.kind === "leaf") return [];
  return [
    { path, ratio: t.ratio },
    ...splitPaths(t.first, [...path, false]),
    ...splitPaths(t.second, [...path, true]),
  ];
}

export function fromExport(n: ExportNode, key: (paneId: string) => string): Tree {
  return n.type === "pane"
    ? leaf(key(n.pane_id))
    : split(n.direction, n.ratio, fromExport(n.first, key), fromExport(n.second, key));
}

/** Removes each id in turn; ids not in the tree (or the last pane) are skipped. */
export function removeAll(t: Tree, ids: string[]): Tree {
  return ids.reduce((tree, id) => removeLeaf(tree, id)?.tree ?? tree, t);
}

export type Hidden = Placement & { id: string };

/**
 * The tab's layout with every minimized pane in place. The stored layout is
 * kept while hiding its minimized panes still gives the visible tree;
 * otherwise (the user rearranged the tab) it is rebuilt by reinserting the
 * hidden panes newest first, undoing the minimizes in reverse.
 */
export function fullLayout(stored: Tree | null, visible: Tree, hidden: Hidden[]): Tree {
  if (
    stored &&
    sameShape(
      removeAll(
        stored,
        hidden.map((h) => h.id),
      ),
      visible,
    )
  )
    return stored;
  return [...hidden].reverse().reduce((tree, h) => reinsert(tree, h.id, h), visible);
}
