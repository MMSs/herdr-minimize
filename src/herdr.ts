// Thin herdr client: the CLI through HERDR_BIN_PATH for everything it covers,
// the raw socket only for layout export/ratio methods the CLI lacks.
import type { ExportNode, Path } from "./tree";

export const PLUGIN_ID = process.env.HERDR_PLUGIN_ID ?? "mmss.minimize";

export class HerdrError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type AgentStatus = "idle" | "working" | "blocked" | "unknown";
export type PaneInfo = {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  terminal_id: string;
  label?: string | null;
  agent?: string | null;
  agent_status: AgentStatus;
  cwd?: string;
  foreground_cwd?: string;
  focused: boolean;
};
export type LayoutExport = {
  tab_id: string;
  zoomed: boolean;
  focused_pane_id: string;
  root: ExportNode;
};

const bin = () => process.env.HERDR_BIN_PATH ?? "herdr";

function run(args: string[]): { out: string; err: string; code: number } {
  const r = Bun.spawnSync([bin(), ...args], { stdout: "pipe", stderr: "pipe", env: process.env });
  return { out: r.stdout.toString(), err: r.stderr.toString(), code: r.exitCode };
}

// biome-ignore lint/suspicious/noExplicitAny: herdr responses are untyped JSON
export function cli(args: string[]): any {
  const { out, err, code } = run(args);
  // herdr prints results on stdout and API errors as JSON on stderr.
  let parsed: { result?: unknown; error?: { code: string; message: string } } | null = null;
  for (const text of [out, err]) {
    try {
      parsed = JSON.parse(text);
      break;
    } catch {
      // not JSON; try the other stream
    }
  }
  if (!parsed) {
    throw new HerdrError(
      "cli_failed",
      `herdr ${args.join(" ")}: ${(err || out).trim() || `exit ${code}`}`,
    );
  }
  if (parsed.error)
    throw new HerdrError(
      parsed.error.code,
      `herdr ${args.slice(0, 2).join(" ")}: ${parsed.error.message}`,
    );
  return parsed.result;
}

export function cliText(args: string[]): string {
  const { out, err, code } = run(args);
  if (code !== 0)
    throw new HerdrError("cli_failed", `herdr ${args.join(" ")}: ${(err || out).trim()}`);
  return out;
}

// biome-ignore lint/suspicious/noExplicitAny: herdr responses are untyped JSON
export async function rpc(method: string, params: object): Promise<any> {
  const path = process.env.HERDR_SOCKET_PATH;
  if (!path) throw new Error("HERDR_SOCKET_PATH is not set; run this from herdr");
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let buf = "";
  const socket = await Bun.connect({
    unix: path,
    socket: {
      data(_s, chunk) {
        buf += chunk.toString();
        const nl = buf.indexOf("\n");
        if (nl >= 0) resolve(buf.slice(0, nl));
      },
      error(_s, e) {
        reject(e);
      },
      close() {
        reject(new Error(`herdr closed the socket during ${method}`));
      },
    },
  });
  socket.write(`${JSON.stringify({ id: `mm-${process.pid}`, method, params })}\n`);
  try {
    const res = JSON.parse(await promise);
    if (res.error) throw new HerdrError(res.error.code, `${method}: ${res.error.message}`);
    return res.result;
  } finally {
    socket.end();
  }
}

export const herdr = {
  currentPane: (): PaneInfo => cli(["pane", "current", "--current"]).pane,
  listPanes: (): PaneInfo[] => cli(["pane", "list"]).panes,
  /** Best-effort: only used for display names, so a failed lookup is just "no name". */
  processName: (pane: string): string | null => {
    try {
      return (
        cli(["pane", "process-info", "--pane", pane]).process_info?.foreground_processes?.[0]
          ?.name ?? null
      );
    } catch {
      return null;
    }
  },
  exportLayout: async (pane: string): Promise<LayoutExport> =>
    (await rpc("layout.export", { pane_id: pane })).layout,
  setRatio: async (tab: string, path: Path, ratio: number): Promise<void> => {
    await rpc("layout.set_split_ratio", { tab_id: tab, path, ratio });
  },
  movePane: (pane: string, args: string[]): PaneInfo =>
    cli(["pane", "move", pane, ...args]).move_result.pane,
  swap: (a: string, b: string): void => {
    cli(["pane", "swap", "--source-pane", a, "--target-pane", b]);
  },
  closePane: (pane: string): void => {
    cli(["pane", "close", pane]);
  },
  zoomOn: (pane: string): void => {
    cli(["pane", "zoom", pane, "--on"]);
  },
  zoomOff: (pane: string): void => {
    cli(["pane", "zoom", pane, "--off"]);
  },
  workspaceExists: (id: string): boolean => {
    try {
      cli(["workspace", "get", id]);
      return true;
    } catch (e) {
      if (e instanceof HerdrError && e.code !== "cli_failed") return false;
      throw e;
    }
  },
  notify: (title: string, body: string): void => {
    cli(["notification", "show", title, "--body", body]);
  },
  openPluginPane: (entrypoint: string, args: string[] = []): PaneInfo | null =>
    cli(["plugin", "pane", "open", "--plugin", PLUGIN_ID, "--entrypoint", entrypoint, ...args])
      ?.plugin_pane?.pane ?? null,
  listTabs: (workspace: string): { tab_id: string; label: string }[] =>
    cli(["tab", "list", "--workspace", workspace]).tabs,
  /** Moves a tab; insert_index = tab count puts it last. */
  moveTab: async (tab: string, index: number): Promise<void> => {
    await rpc("tab.move", { tab_id: tab, insert_index: index });
  },
  readScreen: (pane: string): string =>
    cliText(["pane", "read", pane, "--source", "visible", "--format", "ansi"]),
};
