// Core minimize/restore operations. Entry points resolve the active tab and
// call these; the live tests call them with sandbox ids.
import { displayName, toView, type View } from "./entries";
import { herdr, type PaneInfo, PLUGIN_ID } from "./herdr";
import { planRebuild, type Step } from "./rebuild";
import { type Entry, loadState, saveState, tabState, withLock } from "./state";
import {
  firstLeaf,
  fromExport,
  fullLayout,
  type Hidden,
  removeAll,
  removeLeaf,
  type Tree,
  withoutTray,
  wrapTray,
} from "./tree";

export const PARKING_LABEL = "minimized";

const hidden = (entries: Entry[]): Hidden[] =>
  entries.map((e) => ({
    id: e.terminal_id,
    siblings: e.siblings,
    dir: e.dir,
    ratio: e.ratio,
    wasFirst: e.was_first,
  }));

export class UserError extends Error {}

export type Ctx = { tab: string; pane: string };

type Live = { byTerminal: Map<string, PaneInfo>; byPane: Map<string, PaneInfo> };

function live(): Live {
  const panes = herdr.listPanes();
  return {
    byTerminal: new Map(panes.map((p) => [p.terminal_id, p])),
    byPane: new Map(panes.map((p) => [p.pane_id, p])),
  };
}

/** The tab holding the focused pane. Context ids only cross-check it (design §4.0). */
export function activeContext(): Ctx {
  const focused = herdr.currentPane();
  const fromEnv = process.env.HERDR_TAB_ID;
  if (fromEnv && fromEnv !== focused.tab_id) {
    throw new UserError("The active tab changed before the action ran. Nothing was changed.");
  }
  return { tab: focused.tab_id, pane: focused.pane_id };
}

async function tabTree(tab: string, lv: Live): Promise<{ tree: Tree; zoomed: boolean }> {
  const member = [...lv.byPane.values()].find((p) => p.tab_id === tab);
  if (!member) throw new UserError("That tab no longer exists.");
  const layout = await herdr.exportLayout(member.pane_id);
  const tree = fromExport(layout.root, (paneId) => {
    const p = lv.byPane.get(paneId);
    if (!p) throw new Error(`pane ${paneId} is in the layout but not in the pane list`);
    return p.terminal_id;
  });
  return { tree, zoomed: layout.zoomed };
}

async function execute(tab: string, steps: Step[], lv: Live, focus?: string): Promise<void> {
  const paneOf = new Map([...lv.byTerminal].map(([t, p]) => [t, p.pane_id]));
  const id = (terminal: string) => {
    const p = paneOf.get(terminal);
    if (!p) throw new Error(`no pane for terminal ${terminal}`);
    return p;
  };
  let staging: string | null = null;
  for (const s of steps) {
    if (s.op === "stage") {
      const moved: PaneInfo = staging
        ? herdr.movePane(id(s.id), ["--tab", staging, "--split", "right", "--no-focus"])
        : herdr.movePane(id(s.id), ["--new-tab", "--label", "minimize-staging", "--no-focus"]);
      staging = moved.tab_id;
      paneOf.set(s.id, moved.pane_id);
    } else if (s.op === "place") {
      const moved = herdr.movePane(id(s.id), [
        "--tab",
        tab,
        "--target-pane",
        id(s.target),
        "--split",
        s.dir,
        "--ratio",
        String(s.ratio),
        s.id === focus ? "--focus" : "--no-focus",
      ]);
      paneOf.set(s.id, moved.pane_id);
    } else if (s.op === "swap") {
      herdr.swap(id(s.a), id(s.b));
    } else {
      await herdr.setRatio(tab, s.path, s.ratio);
    }
  }
}

function aliveTray(tray: string | null | undefined, lv: Live, tab: string): string | null {
  return tray && lv.byTerminal.get(tray)?.tab_id === tab ? tray : null;
}

export function liveViews(tab: string): View[] {
  const ts = loadState().tabs[tab];
  if (!ts) return [];
  const lv = live();
  return ts.entries.flatMap((e) => {
    const p = lv.byTerminal.get(e.terminal_id);
    return p ? [toView(e, p)] : [];
  });
}

export async function minimize(ctx: Ctx): Promise<void> {
  await withLock(async () => {
    const state = loadState();
    const lv = live();
    const x = lv.byPane.get(ctx.pane);
    if (!x) throw new UserError("That pane no longer exists.");
    const tray = aliveTray(state.tabs[ctx.tab]?.tray_terminal_id, lv, ctx.tab);
    if (x.terminal_id === tray) throw new UserError("The tray can't be minimized.");
    const { tree, zoomed } = await tabTree(ctx.tab, lv);
    const visible = withoutTray(tree, tray);
    const removal = removeLeaf(visible, x.terminal_id);
    if (!removal) throw new UserError("Only pane in this tab — nothing to minimize.");
    if (zoomed) herdr.zoomOff(ctx.pane);

    const name = displayName(x, herdr.processName(x.pane_id));
    const parking =
      state.parking_workspace_id && herdr.workspaceExists(state.parking_workspace_id)
        ? state.parking_workspace_id
        : null;
    const parked = parking
      ? herdr.movePane(x.pane_id, [
          "--new-tab",
          "--workspace",
          parking,
          "--label",
          name,
          "--no-focus",
        ])
      : herdr.movePane(x.pane_id, [
          "--new-workspace",
          "--label",
          PARKING_LABEL,
          "--tab-label",
          name,
          "--no-focus",
        ]);
    state.parking_workspace_id = parked.workspace_id;

    const ts = tabState(state, ctx.tab);
    ts.layout = fullLayout(ts.layout ?? null, visible, hidden(ts.entries));
    ts.entries.push({
      terminal_id: x.terminal_id,
      name,
      minimized_at: new Date().toISOString(),
      siblings: removal.siblings,
      dir: removal.dir,
      ratio: removal.ratio,
      was_first: removal.wasFirst,
    });
    ts.tray_terminal_id = tray;
    saveState(state); // the pane is parked; record it before anything else can fail

    let trayId = tray;
    if (!trayId) {
      const anchor = lv.byTerminal.get(firstLeaf(removal.tree)) as PaneInfo;
      const opened = herdr.openPluginPane("tray", [
        "--placement",
        "split",
        "--target-pane",
        anchor.pane_id,
        "--direction",
        "right",
        "--no-focus",
      ]);
      if (!opened) throw new Error(`${PLUGIN_ID}: herdr did not return the tray pane`);
      trayId = opened.terminal_id;
      ts.tray_terminal_id = trayId;
      saveState(state);
    }
    const lv2 = live();
    const now = await tabTree(ctx.tab, lv2);
    await execute(ctx.tab, planRebuild(now.tree, wrapTray(removal.tree, trayId)), lv2);
  });
}

export async function restoreEntry(tab: string, terminal: string): Promise<void> {
  let closeTray: string | null = null;
  await withLock(async () => {
    const state = loadState();
    const ts = state.tabs[tab];
    const entry = ts?.entries.find((e) => e.terminal_id === terminal);
    if (!ts || !entry) throw new UserError("That pane is no longer minimized.");
    const lv = live();
    if (!lv.byTerminal.has(terminal)) {
      ts.entries = ts.entries.filter((e) => e !== entry);
      saveState(state);
      throw new UserError("That pane has exited.");
    }
    const tray = aliveTray(ts.tray_terminal_id, lv, tab);
    const { tree } = await tabTree(tab, lv);
    // Restore through the tab's full layout so panes come back in any order.
    const full = fullLayout(ts.layout ?? null, withoutTray(tree, tray), hidden(ts.entries));
    const stillHidden = ts.entries.filter((e) => e !== entry).map((e) => e.terminal_id);
    const restored = removeAll(full, stillHidden);
    ts.layout = full;
    // Keep the tray in place during the rebuild: it may be the process running this.
    await execute(tab, planRebuild(tree, tray ? wrapTray(restored, tray) : restored), lv, terminal);
    ts.entries = ts.entries.filter((e) => e !== entry);
    if (ts.entries.length === 0) {
      delete state.tabs[tab];
      closeTray = tray ? (live().byTerminal.get(tray)?.pane_id ?? null) : null;
    }
    saveState(state);
  });
  if (closeTray) herdr.closePane(closeTray); // last: may terminate the calling tray
}

export async function restoreAll(tab: string): Promise<void> {
  const ts = loadState().tabs[tab];
  for (const e of [...(ts?.entries ?? [])].reverse()) await restoreEntry(tab, e.terminal_id);
}

/** Drops entries whose pane or tab is gone; closes trays with nothing left. */
export async function reconcile(): Promise<{ orphaned: number; trayLost: string[] }> {
  if (Object.keys(loadState().tabs).length === 0) return { orphaned: 0, trayLost: [] };
  return withLock(async () => {
    const state = loadState();
    const lv = live();
    const liveTabs = new Set([...lv.byPane.values()].map((p) => p.tab_id));
    let orphaned = 0;
    const trayLost: string[] = [];
    for (const [tab, ts] of Object.entries(state.tabs)) {
      const parked = (e: { terminal_id: string }) =>
        lv.byTerminal.get(e.terminal_id)?.workspace_id === state.parking_workspace_id;
      ts.entries = ts.entries.filter(parked);
      if (!liveTabs.has(tab)) {
        orphaned += ts.entries.length;
        delete state.tabs[tab];
        continue;
      }
      const tray = aliveTray(ts.tray_terminal_id, lv, tab);
      if (ts.entries.length === 0) {
        delete state.tabs[tab];
        if (tray) herdr.closePane((lv.byTerminal.get(tray) as PaneInfo).pane_id);
      } else if (!tray && ts.tray_terminal_id) {
        ts.tray_terminal_id = null;
        trayLost.push(tab);
      }
    }
    saveState(state);
    return { orphaned, trayLost };
  });
}
