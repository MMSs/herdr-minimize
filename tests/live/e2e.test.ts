// Drives a real herdr in throwaway workspaces. Run with `bun run test:live`
// from a checkout linked as mmss.minimize. Skipped by plain `bun test`.
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { cli, cliText, herdr } from "../../src/herdr";
import { minimize, reconcile, restoreAll, restoreEntry, UserError } from "../../src/ops";
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
    test(`${name}: every pane minimizes and restores to the same rect and PID`, async () => {
      const { tab, root } = sandbox();
      const panes = build(root);
      for (const p of panes) {
        const terminal = terminalOf(p);
        // ids of panes restored earlier in this loop have changed; measure via a live member
        const before = rects(tabPanes(tab)[0]!.pane_id);
        const shell = pid(p);
        await minimize({ tab, pane: p });
        const st = loadState().tabs[tab]!;
        expect(st.entries.map((e) => e.terminal_id)).toEqual([terminal]);
        expect(tabPanes(tab).some((q) => q.terminal_id === terminal)).toBe(false);
        const tray = tabPanes(tab).find((q) => q.terminal_id === st.tray_terminal_id)!;
        const trayRect = rects(tray.pane_id).get(tray.terminal_id)!;
        expect(trayRect.y).toBe(0);
        await restoreEntry(tab, terminal);
        expect(loadState().tabs[tab]).toBeUndefined();
        const anchor = tabPanes(tab)[0]!.pane_id;
        expectSameRects(before, rects(anchor));
        const back = tabPanes(tab).find((q) => q.terminal_id === terminal)!;
        expect(pid(back.pane_id)).toBe(shell);
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

  test("the tray itself can't be minimized", async () => {
    const { tab, root } = sandbox();
    const b = splitPane(root, "right");
    await minimize({ tab, pane: b });
    const tray = tabPanes(tab).find(
      (q) => q.terminal_id === loadState().tabs[tab]!.tray_terminal_id,
    )!;
    await expect(minimize({ tab, pane: tray.pane_id })).rejects.toBeInstanceOf(UserError);
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

  test("closing a minimized pane drops it and removes the tray on reconcile", async () => {
    const { tab, root } = sandbox();
    const b = splitPane(root, "right");
    const tb = terminalOf(b);
    await minimize({ tab, pane: b });
    const parked = herdr.listPanes().find((q) => q.terminal_id === tb)!;
    cli(["pane", "close", parked.pane_id]);
    await reconcile();
    expect(loadState().tabs[tab]).toBeUndefined();
    expect(tabPanes(tab)).toHaveLength(1);
  }, 60_000);
});
