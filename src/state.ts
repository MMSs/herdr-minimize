// Plugin state in $HERDR_PLUGIN_STATE_DIR/state.json. Written atomically; every
// read-modify-write happens under a mkdir lock so rapid keypresses serialise.
// Panes are keyed by pane id: it survives a herdr server restart, terminal
// ids don't (docs/herdr-api-notes.md).
import { mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Dir, leaves, type Tree } from "./tree";

export type Entry = {
  pane_id: string;
  name: string;
  minimized_at: string;
  siblings: string[];
  dir: Dir;
  ratio: number;
  was_first: boolean;
};
export type TabState = {
  entries: Entry[];
  /** The tab's layout with every minimized pane in place (tree.fullLayout). */
  layout?: Tree | null;
};
export type State = {
  version: 2;
  /** workspace id → its "▾" parking tab id */
  parking: Record<string, string>;
  /** source tab id → what was minimized from it */
  tabs: Record<string, TabState>;
};

export const emptyState = (): State => ({ version: 2, parking: {}, tabs: {} });

/** Maps a live terminal id to its pane id; undefined when the terminal is gone. */
export type PaneOfTerminal = (terminal: string) => string | undefined;

export function stateDir(): string {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!dir) throw new Error("HERDR_PLUGIN_STATE_DIR is not set; run this from herdr");
  return dir;
}

/**
 * `paneOf` is only called for a version 1 file (keyed by terminal ids), whose
 * ids are then rewritten to pane ids; pass a function that asks herdr.
 */
export function loadState(dir = stateDir(), paneOf?: () => PaneOfTerminal): State {
  let text: string;
  try {
    text = readFileSync(join(dir, "state.json"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw e;
  }
  const raw = JSON.parse(text) as { version?: unknown };
  let state: State;
  if (raw.version === 2) state = raw as State;
  else if (raw.version === 1 && paneOf) state = fromV1(raw as V1State, paneOf());
  else throw new Error(`unsupported state version ${String(raw.version)}`);
  state.parking ??= {};
  state.tabs ??= {};
  return state;
}

type V1Entry = Omit<Entry, "pane_id"> & { terminal_id: string };
type V1State = {
  parking?: Record<string, string>;
  tabs?: Record<string, { entries: V1Entry[]; layout?: Tree | null }>;
};

function fromV1(v1: V1State, paneOf: PaneOfTerminal): State {
  const tabs: Record<string, TabState> = {};
  for (const [tab, ts] of Object.entries(v1.tabs ?? {})) {
    const entries: Entry[] = [];
    for (const { terminal_id, ...e } of ts.entries) {
      const pane = paneOf(terminal_id);
      const siblings = e.siblings.map(paneOf);
      // A gone pane is forgotten, as reconcile would; a gone sibling just
      // can't be matched, so restore uses its fallback placement.
      if (pane)
        entries.push({ ...e, pane_id: pane, siblings: siblings.filter((s) => !!s) as string[] });
    }
    if (entries.length === 0) continue;
    const layout =
      ts.layout && leaves(ts.layout).every((l) => paneOf(l)) ? relabel(ts.layout, paneOf) : null;
    tabs[tab] = { entries, layout };
  }
  return { version: 2, parking: v1.parking ?? {}, tabs };
}

const relabel = (t: Tree, paneOf: PaneOfTerminal): Tree =>
  t.kind === "leaf"
    ? { kind: "leaf", id: paneOf(t.id) as string }
    : { ...t, first: relabel(t.first, paneOf), second: relabel(t.second, paneOf) };

export function saveState(state: State, dir = stateDir()): void {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.state.json.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, join(dir, "state.json"));
}

export function tabState(state: State, tab: string): TabState {
  state.tabs[tab] ??= { entries: [] };
  return state.tabs[tab];
}

type LockOptions = { dir?: string; timeoutMs?: number; staleMs?: number };

export async function withLock<T>(fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const dir = opts.dir ?? stateDir();
  const lock = join(dir, "lock");
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
  const staleMs = opts.staleMs ?? 30_000;
  mkdirSync(dir, { recursive: true });
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    try {
      if (Date.now() - statSync(lock).mtimeMs > staleMs) {
        rmdirSync(lock);
        continue;
      }
    } catch {
      continue; // released between our mkdir and stat
    }
    if (Date.now() > deadline)
      throw new Error("timed out waiting for another minimize/restore to finish");
    await Bun.sleep(25);
  }
  try {
    return await fn();
  } finally {
    rmdirSync(lock);
  }
}
