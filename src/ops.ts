// Core minimize/restore operations. Entry points resolve the active tab and
// call these; the live tests call them with sandbox ids.

import { displayName, toView, type View } from "./entries";
import { herdr, type PaneInfo } from "./herdr";
import { planRebuild, type Step } from "./rebuild";
import { type Entry, loadState, type State, saveState, tabState, withLock } from "./state";
import { fromExport, fullLayout, type Hidden, removeAll, removeLeaf, type Tree } from "./tree";

export const PARKING_LABEL = "▾";

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

/** The "▾" parking tab of a workspace, if it still exists. */
function parkingTab(state: State, workspace: string, lv: Live): string | null {
  const tab = state.parking[workspace];
  return tab && [...lv.byPane.values()].some((p) => p.tab_id === tab) ? tab : null;
}

const isParkingTab = (state: State, tab: string) => Object.values(state.parking).includes(tab);

/**
 * herdr doesn't resize the terminals of panes that grow when another pane is
 * moved out of their tab (a native close does), so programs keep drawing at
 * the old size. A zoom on/off makes herdr apply the real sizes; the tab ends
 * up unzoomed, as it was. (herdr 0.9.3; see docs/herdr-api-notes.md)
 */
async function refreshSizes(tab: string): Promise<void> {
  const member = herdr.listPanes().find((p) => p.tab_id === tab)?.pane_id;
  if (!member) return;
  // Zooming focuses the zoomed pane, so zoom the one that already has focus.
  const pane = (await herdr.exportLayout(member)).focused_pane_id;
  herdr.zoomOn(pane);
  herdr.zoomOff(pane);
}

/**
 * The invariant every entry must hold: its pane is alive and sits in a ▾ tab.
 * Panes that exited or were moved back by hand fail it and are no longer
 * minimized, whatever the state file says.
 */
function isParked(state: State, lv: Live) {
  const parkingTabs = new Set(Object.values(state.parking));
  return (e: Entry) => parkingTabs.has(lv.byTerminal.get(e.terminal_id)?.tab_id ?? "");
}

export function liveViews(tab: string): View[] {
  const state = loadState();
  const ts = state.tabs[tab];
  if (!ts) return [];
  const lv = live();
  return ts.entries
    .filter(isParked(state, lv))
    .map((e) => toView(e, lv.byTerminal.get(e.terminal_id) as PaneInfo));
}

/** Moves every workspace's "▾" tab back to the end of its tab bar. */
export async function keepParkingLast(): Promise<void> {
  const state = loadState();
  for (const [workspace, tab] of Object.entries(state.parking)) {
    let tabs: { tab_id: string }[];
    try {
      tabs = herdr.listTabs(workspace);
    } catch {
      continue; // workspace closed
    }
    if (tabs.some((t) => t.tab_id === tab) && tabs.at(-1)?.tab_id !== tab) {
      await herdr.moveTab(tab, tabs.length);
    }
  }
}

export async function minimize(ctx: Ctx): Promise<void> {
  await withLock(async () => {
    const state = loadState();
    if (isParkingTab(state, ctx.tab)) {
      throw new UserError(
        `This is the ${PARKING_LABEL} tab of minimized panes; restore them from their own tab.`,
      );
    }
    const lv = live();
    const x = lv.byPane.get(ctx.pane);
    if (!x) throw new UserError("That pane no longer exists.");
    const { tree, zoomed } = await tabTree(ctx.tab, lv);
    const removal = removeLeaf(tree, x.terminal_id);
    if (!removal) throw new UserError("Only pane in this tab — nothing to minimize.");
    if (zoomed) herdr.zoomOff(ctx.pane);

    // Everything that can fail is done before the pane moves, so a moved pane
    // always gets saved in state.
    const name = displayName(x, herdr.processName(x.pane_id));
    const ts = tabState(state, ctx.tab);
    ts.entries = ts.entries.filter(isParked(state, lv));
    ts.layout = fullLayout(ts.layout ?? null, tree, hidden(ts.entries));
    const parking = parkingTab(state, x.workspace_id, lv);
    const parked = parking
      ? herdr.movePane(x.pane_id, ["--tab", parking, "--split", "right", "--no-focus"])
      : herdr.movePane(x.pane_id, ["--new-tab", "--label", PARKING_LABEL, "--no-focus"]);
    state.parking[x.workspace_id] = parked.tab_id;
    ts.entries.push({
      terminal_id: x.terminal_id,
      name,
      minimized_at: new Date().toISOString(),
      siblings: removal.siblings,
      dir: removal.dir,
      ratio: removal.ratio,
      was_first: removal.wasFirst,
    });
    saveState(state);
    await refreshSizes(ctx.tab);
  });
  await keepParkingLast();
}

export async function restoreEntry(tab: string, terminal: string): Promise<void> {
  await withLock(async () => {
    const state = loadState();
    const ts = state.tabs[tab];
    const entry = ts?.entries.find((e) => e.terminal_id === terminal);
    if (!ts || !entry) throw new UserError("That pane is no longer minimized.");
    let lv = live();
    if (!isParked(state, lv)(entry)) {
      ts.entries = ts.entries.filter(isParked(state, lv));
      if (ts.entries.length === 0) delete state.tabs[tab];
      saveState(state);
      throw new UserError(
        lv.byTerminal.has(terminal)
          ? "That pane is already back in a tab."
          : "That pane has exited.",
      );
    }
    ts.entries = ts.entries.filter(isParked(state, lv));
    let { tree, zoomed } = await tabTree(tab, lv);
    if (zoomed) {
      // A zoomed tab would hide the restored pane; its layout also can't be resized.
      herdr.zoomOff([...lv.byPane.values()].find((p) => p.tab_id === tab)?.pane_id as string);
      lv = live();
      ({ tree, zoomed } = await tabTree(tab, lv));
    }
    // Restore through the tab's full layout so panes come back in any order.
    const full = fullLayout(ts.layout ?? null, tree, hidden(ts.entries));
    const stillHidden = ts.entries.filter((e) => e !== entry).map((e) => e.terminal_id);
    await execute(tab, planRebuild(tree, removeAll(full, stillHidden)), lv, terminal);
    ts.entries = ts.entries.filter((e) => e !== entry);
    ts.layout = full;
    if (ts.entries.length === 0) delete state.tabs[tab];
    saveState(state);
    await refreshSizes(tab);
  });
}

export async function restoreAll(tab: string): Promise<void> {
  const ts = loadState().tabs[tab];
  for (const e of [...(ts?.entries ?? [])].reverse()) await restoreEntry(tab, e.terminal_id);
}

/**
 * Forgets panes that exited or were moved out of the ▾ tab by hand, and
 * closes the minimized panes of tabs that no longer exist (design §4.7).
 */
export async function reconcile(): Promise<{ closed: number }> {
  const before = loadState();
  if (Object.keys(before.tabs).length === 0 && Object.keys(before.parking).length === 0) {
    return { closed: 0 };
  }
  // Hooks queue behind a long restore (its staging tab fires tab.created),
  // so they wait longer than a keypress would.
  return withLock(
    async () => {
      const state = loadState();
      const lv = live();
      const liveTabs = new Set([...lv.byPane.values()].map((p) => p.tab_id));
      const parkingTabs = new Set(Object.values(state.parking));
      let closed = 0;
      for (const [tab, ts] of Object.entries(state.tabs)) {
        ts.entries = ts.entries.filter((e) =>
          parkingTabs.has(lv.byTerminal.get(e.terminal_id)?.tab_id ?? ""),
        );
        if (!liveTabs.has(tab)) {
          for (const e of ts.entries) {
            herdr.closePane((lv.byTerminal.get(e.terminal_id) as PaneInfo).pane_id);
            closed++;
          }
          ts.entries = [];
        }
        if (ts.entries.length === 0) delete state.tabs[tab];
      }
      for (const [workspace, tab] of Object.entries(state.parking)) {
        if (!liveTabs.has(tab)) delete state.parking[workspace];
      }
      saveState(state);
      return { closed };
    },
    { timeoutMs: 60_000 },
  );
}
