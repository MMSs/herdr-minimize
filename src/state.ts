// Plugin state in $HERDR_PLUGIN_STATE_DIR/state.json. Written atomically; every
// read-modify-write happens under a mkdir lock so rapid keypresses serialise.
import { mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Dir, Tree } from "./tree";

export type Entry = {
  terminal_id: string;
  name: string;
  minimized_at: string;
  siblings: string[];
  dir: Dir;
  ratio: number;
  was_first: boolean;
};
export type TabState = {
  tray_terminal_id: string | null;
  entries: Entry[];
  /** The tab's layout with every minimized pane in place (tree.fullLayout). */
  layout?: Tree | null;
};
export type State = {
  version: 1;
  parking_workspace_id: string | null;
  tabs: Record<string, TabState>;
};

export const emptyState = (): State => ({ version: 1, parking_workspace_id: null, tabs: {} });

export function stateDir(): string {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!dir) throw new Error("HERDR_PLUGIN_STATE_DIR is not set; run this from herdr");
  return dir;
}

export function loadState(dir = stateDir()): State {
  let text: string;
  try {
    text = readFileSync(join(dir, "state.json"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw e;
  }
  const raw = JSON.parse(text) as { version?: unknown };
  if (raw.version !== 1) throw new Error(`unsupported state version ${String(raw.version)}`);
  return raw as State;
}

export function saveState(state: State, dir = stateDir()): void {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.state.json.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, join(dir, "state.json"));
}

export function tabState(state: State, tab: string): TabState {
  state.tabs[tab] ??= { tray_terminal_id: null, entries: [] };
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
