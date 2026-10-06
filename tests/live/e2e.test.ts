// Drives a real herdr in throwaway workspaces. Run with `bun run test:live`
// from a checkout linked as mmss.minimize. Skipped by plain `bun test`.
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { cli, cliText, herdr } from "../../src/herdr";
import {
  keepParkingLast,
  liveViews,
  minimize,
  PARKING_LABEL,
  reconcile,
  restoreAll,
  restoreEntry,
  UserError,
} from "../../src/ops";
import { loadState } from "../../src/state";

const LIVE = !!process.env.MINIMIZE_LIVE;
const ROOT = join(import.meta.dir, "../..");
const workspaces: string[] = [];

type Rect = { x: number; y: number; width: number; height: number };

function sandbox(): { ws: string; tab: string; root: string } {
  const r = cli(["workspace", "create", "--no-focus", "--label", "mm-e2e"]);
  workspaces.push(r.workspace.workspace_id);
  return { ws: r.workspace.workspace_id, tab: r.tab.tab_id, root: r.root_pane.pane_id };
}
const splitPane = (p: string, dir: "right" | "down", ratio = 0.5): string =>
  cli(["pane", "split", p, "--direction", dir, "--ratio", String(ratio), "--no-focus"]).pane
    .pane_id;
const terminalOf = (p: string): string => cli(["pane", "get", p]).pane.terminal_id;
const pid = (p: string): number =>
  cli(["pane", "process-info", "--pane", p]).process_info.shell_pid;
function rects(anyPane: string): Map<string, Rect> {
  const byPane = new Map(herdr.listPanes().map((p) => [p.pane_id, p.terminal_id]));
  const layout = cli(["pane", "edges", "--pane", anyPane]).edges.layout;
  return new Map(
    layout.panes.map((p: { pane_id: string; rect: Rect }) => [byPane.get(p.pane_id), p.rect]),
  );
}
function expectSameRects(a: Map<string, Rect>, b: Map<string, Rect>) {
  expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
  for (const [k, r] of a) {
    const s = b.get(k) as Rect;
    for (const f of ["x", "y", "width", "height"] as const)
      expect(Math.abs(r[f] - s[f])).toBeLessThanOrEqual(1);
  }
}
const tabPanes = (tab: string) => herdr.listPanes().filter((p) => p.tab_id === tab);
/** The pane's real terminal size from the kernel, as its program sees it. */
function ptySize(pane: string): { cols: number; rows: number } {
  const pid = cli(["pane", "process-info", "--pane", pane]).process_info.shell_pid;
  const tty = Bun.spawnSync(["ps", "-o", "tty=", "-p", String(pid)])
    .stdout.toString()
    .trim();
  const flag = process.platform === "darwin" ? "-f" : "-F";
  const out = Bun.spawnSync(["stty", flag, `/dev/${tty}`, "size"])
    .stdout.toString()
    .trim();
  const [rows, cols] = out.split(" ").map(Number) as [number, number];
  return { cols, rows };
}
/** Every pane's terminal matches its rect, minus herdr's border and padding (≤4 cells). */
function expectTerminalsMatchLayout(tab: string) {
  const r = rects(tabPanes(tab)[0]!.pane_id);
  for (const p of tabPanes(tab)) {
    const rect = r.get(p.terminal_id)!;
    const size = ptySize(p.pane_id);
    expect(rect.width - size.cols).toBeLessThanOrEqual(4);
    expect(rect.height - size.rows).toBeLessThanOrEqual(4);
  }
}
const tabsOf = (ws: string): { tab_id: string; label: string }[] =>
  cli(["tab", "list", "--workspace", ws]).tabs;

describe.skipIf(!LIVE)("live herdr", () => {
  beforeAll(() => {
    process.env.HERDR_SOCKET_PATH ??= /socket: (.+)/.exec(cliText(["status", "server"]))?.[1];
    const plugin = cli(["plugin", "list", "--plugin", "mmss.minimize", "--json"]).plugins[0];
    if (plugin?.plugin_root !== ROOT)
      throw new Error(`link this checkout first: herdr plugin link "${ROOT}"`);
    const config = cliText(["plugin", "config-dir", "mmss.minimize"]).trim();
    process.env.HERDR_PLUGIN_STATE_DIR = join(dirname(dirname(config)), "mmss.minimize");
  });

  afterEach(() => {
    for (const ws of workspaces.splice(0)) cli(["workspace", "close", ws]);
  });

  const layouts: [string, (root: string) => string[]][] = [
    ["2 panes", (a) => [a, splitPane(a, "right", 0.6)]],
    [
      "3 panes nested",
      (a) => {
        const b = splitPane(a, "right", 0.6);
        return [a, b, splitPane(b, "down", 0.4)];
      },
    ],
    [
      "5 panes",
      (a) => {
        const b = splitPane(a, "down", 0.7);
        const c = splitPane(a, "right", 0.5);
        const d = splitPane(c, "down", 0.3);
        return [a, b, c, d, splitPane(b, "right", 0.25)];
      },
    ],
  ];

  for (const [name, build] of layouts) {
    test(`${name}: every pane minimizes into the ▾ tab and restores to the same rect and PID`, async () => {
      const { ws, tab, root } = sandbox();
      const panes = build(root);
      for (const p of panes) {
        const before = rects(tabPanes(tab)[0]!.pane_id);
        const shell = pid(p);
        await minimize({ tab, pane: p });
        const parking = loadState().parking[ws]!;
        expect(tabsOf(ws).at(-1)).toMatchObject({ tab_id: parking, label: PARKING_LABEL });
        expect(tabPanes(parking).map((q) => q.pane_id)).toEqual([p]); // same workspace: id kept
        await restoreEntry(tab, terminalOf(p));
        expect(loadState().tabs[tab]).toBeUndefined();
        expect(tabsOf(ws).some((t) => t.label === PARKING_LABEL)).toBe(false); // empty ▾ tab closed
        expectSameRects(before, rects(tabPanes(tab)[0]!.pane_id));
        expect(pid(p)).toBe(shell);
      }
    }, 60_000);
  }

  test("two minimized panes restore in any order to the original layout", async () => {
    const { tab, root } = sandbox();
    const [a, b, c] = layouts[1]![1](root) as [string, string, string];
    const before = rects(a);
    const [tb, tc] = [terminalOf(b), terminalOf(c)];
    await minimize({ tab, pane: c });
    await minimize({ tab, pane: b });
    await restoreEntry(tab, tc);
    await restoreEntry(tab, tb);
    expectSameRects(before, rects(a));
  }, 60_000);

  test("rapid concurrent minimizes never strand a pane", async () => {
    const { tab, root } = sandbox();
    const [a, b, c] = layouts[1]![1](root) as [string, string, string];
    const before = rects(a);
    await Promise.all([minimize({ tab, pane: b }), minimize({ tab, pane: c })]);
    expect(loadState().tabs[tab]!.entries).toHaveLength(2);
    await restoreAll(tab);
    expectSameRects(before, rects(a));
  }, 60_000);

  test("the only pane in a tab is refused and nothing changes", async () => {
    const { tab, root } = sandbox();
    await expect(minimize({ tab, pane: root })).rejects.toBeInstanceOf(UserError);
    expect(loadState().tabs[tab]).toBeUndefined();
  });

  test("panes in the ▾ tab can't be minimized again", async () => {
    const { ws, tab, root } = sandbox();
    const b = splitPane(root, "right");
    splitPane(b, "down");
    await minimize({ tab, pane: b });
    const parking = loadState().parking[ws]!;
    await expect(minimize({ tab: parking, pane: b })).rejects.toBeInstanceOf(UserError);
    await restoreAll(tab);
  }, 60_000);

  test("the ▾ tab is moved back to the end when a new tab appears", async () => {
    const { ws, tab, root } = sandbox();
    await minimize({ tab, pane: splitPane(root, "right") });
    cli(["tab", "create", "--workspace", ws, "--no-focus", "--label", "later"]);
    expect(tabsOf(ws).at(-1)!.label).toBe("later");
    await keepParkingLast();
    expect(tabsOf(ws).at(-1)!.label).toBe(PARKING_LABEL);
    await restoreAll(tab);
  }, 60_000);

  test("restore still works after the sibling was closed", async () => {
    const { tab, root } = sandbox();
    const [, b, c] = layouts[1]![1](root) as [string, string, string];
    const tc = terminalOf(c);
    await minimize({ tab, pane: c });
    cli(["pane", "close", b]);
    await restoreEntry(tab, tc);
    expect(tabPanes(tab).some((q) => q.terminal_id === tc)).toBe(true);
  }, 60_000);

  test("a minimized pane that exits is dropped on reconcile", async () => {
    const { tab, root } = sandbox();
    const b = splitPane(root, "right");
    await minimize({ tab, pane: b });
    cli(["pane", "close", b]);
    await reconcile();
    expect(loadState().tabs[tab]).toBeUndefined();
  }, 60_000);

  test("closing a tab closes its minimized panes", async () => {
    const { ws, root } = sandbox();
    const t2: string = cli(["tab", "create", "--workspace", ws, "--no-focus"]).tab.tab_id;
    const p = tabPanes(t2)[0]!.pane_id;
    const victim = splitPane(p, "right");
    await minimize({ tab: t2, pane: victim });
    cli(["tab", "close", t2]);
    // herdr's own tab.closed hook may get there first; either way the pane goes.
    await reconcile();
    expect(herdr.listPanes().some((q) => q.pane_id === victim)).toBe(false);
    expect(loadState().tabs[t2]).toBeUndefined();
    expect(tabPanes(cli(["pane", "get", root]).pane.tab_id)).toHaveLength(1);
  }, 60_000);

  test("a minimized pane moved back by hand is no longer treated as minimized", async () => {
    const { tab, root } = sandbox();
    const b = splitPane(root, "right");
    await minimize({ tab, pane: b });
    cli(["pane", "move", b, "--tab", tab, "--target-pane", root, "--split", "right", "--no-focus"]);
    expect(liveViews(tab)).toEqual([]);
    await expect(restoreEntry(tab, terminalOf(b))).rejects.toBeInstanceOf(UserError);
    expect(loadState().tabs[tab]).toBeUndefined();
    await minimize({ tab, pane: b }); // no duplicate entry
    expect(loadState().tabs[tab]!.entries).toHaveLength(1);
    await restoreAll(tab);
  }, 60_000);

  test("restoring into a zoomed tab unzooms it so the pane is visible", async () => {
    const { tab, root } = sandbox();
    const b = splitPane(root, "right");
    splitPane(b, "down");
    await minimize({ tab, pane: b });
    cli(["pane", "zoom", root, "--on"]);
    await restoreEntry(tab, terminalOf(b));
    expect((await herdr.exportLayout(root)).zoomed).toBe(false);
  }, 60_000);

  test("panes left behind and restored get their real terminal size (herdr resize)", async () => {
    const { tab, root } = sandbox();
    const [, b, c] = layouts[1]![1](root) as [string, string, string];
    await minimize({ tab, pane: c });
    expectTerminalsMatchLayout(tab);
    await minimize({ tab, pane: b });
    expectTerminalsMatchLayout(tab);
    await restoreAll(tab);
    expectTerminalsMatchLayout(tab);
  }, 60_000);

  test("a restored pane has focus, and keeping sizes right doesn't move it", async () => {
    const { tab, root } = sandbox();
    const [, b, c] = layouts[1]![1](root) as [string, string, string];
    await minimize({ tab, pane: b });
    await restoreEntry(tab, terminalOf(b));
    expect((await herdr.exportLayout(c)).focused_pane_id).toBe(b);
  }, 60_000);

  test("a tab with minimized panes shows ▾ after its name until the last restore", async () => {
    const { ws, tab, root } = sandbox();
    cli(["tab", "rename", tab, "work"]);
    const [, b, c] = layouts[1]![1](root) as [string, string, string];
    const label = () => tabsOf(ws).find((t) => t.tab_id === tab)!.label;
    await minimize({ tab, pane: b });
    expect(label()).toBe("work ▾");
    await minimize({ tab, pane: c });
    expect(label()).toBe("work ▾");
    await restoreEntry(tab, terminalOf(c));
    expect(label()).toBe("work ▾"); // one still minimized
    await restoreEntry(tab, terminalOf(b));
    expect(label()).toBe("work");
    expect(tabsOf(ws).at(-1)!.label).not.toBe("▾ ▾"); // the parking tab is never marked
  }, 60_000);

  test("renaming a tab with minimized panes keeps the ▾", async () => {
    const { ws, tab, root } = sandbox();
    await minimize({ tab, pane: splitPane(root, "right") });
    cli(["tab", "rename", tab, "renamed"]);
    await reconcile(); // herdr's tab.renamed hook does the same
    expect(tabsOf(ws).find((t) => t.tab_id === tab)!.label).toBe("renamed ▾");
    await restoreAll(tab);
    expect(tabsOf(ws).find((t) => t.tab_id === tab)!.label).toBe("renamed");
  }, 60_000);
});
