// How minimized panes are named, marked and searched, shared by tray and picker.
import { basename } from "node:path";
import type { AgentStatus, PaneInfo } from "./herdr";
import type { Entry } from "./state";

export type View = {
  terminal_id: string;
  pane_id: string;
  name: string;
  status: AgentStatus | "none";
  cwd: string | null;
  minimized_at: string;
};

export function displayName(
  p: Partial<Pick<PaneInfo, "label" | "agent">>,
  process: string | null,
): string {
  return p.label?.trim() || p.agent || process || "pane";
}

export function toView(e: Entry, p: PaneInfo): View {
  const dir = p.foreground_cwd || p.cwd || "";
  return {
    terminal_id: e.terminal_id,
    pane_id: p.pane_id,
    name: p.label?.trim() || p.agent || e.name,
    status: p.agent ? p.agent_status : "none",
    cwd: dir ? basename(dir) : null,
    minimized_at: e.minimized_at,
  };
}

export function newestFirst<T extends { minimized_at: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => b.minimized_at.localeCompare(a.minimized_at));
}

const GLYPHS: Record<View["status"], [string, string]> = {
  working: ["33", "●"],
  blocked: ["1;31", "▲"],
  idle: ["32", "●"],
  unknown: ["2", "○"],
  none: ["2", "○"],
};

/** Coloured status mark; resets only bold/dim/colour so surrounding reverse video survives. */
export function glyph(status: View["status"]): string {
  const [sgr, char] = GLYPHS[status];
  return `\x1b[${sgr}m${char}\x1b[22;39m`;
}

export type Match = { score: number; positions: number[] };

export function fuzzy(query: string, text: string): Match | null {
  if (!query) return { score: 0, positions: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let best: Match | null = null;
  for (
    let start = t.indexOf(q[0] as string);
    start !== -1;
    start = t.indexOf(q[0] as string, start + 1)
  ) {
    const positions = [start];
    for (let qi = 1, from = start + 1; qi < q.length; qi++) {
      const found = t.indexOf(q[qi] as string, from);
      if (found === -1) break;
      positions.push(found);
      from = found + 1;
    }
    if (positions.length !== q.length) continue;
    const score = scoreOf(positions, t);
    if (!best || score > best.score) best = { score, positions };
  }
  return best;
}

function scoreOf(positions: number[], text: string): number {
  let score = 0;
  positions.forEach((p, i) => {
    score += 1;
    if (i > 0 && p === (positions[i - 1] as number) + 1) score += 5;
    if (p === 0 || /[\s\-_./:]/.test(text[p - 1] as string)) score += 3;
  });
  return score - (positions[0] as number) * 0.1;
}

export function filterViews(views: View[], query: string): { view: View; positions: number[] }[] {
  return views
    .map((view) => ({ view, match: fuzzy(query, view.name) }))
    .filter((r): r is { view: View; match: Match } => r.match !== null)
    .sort((a, b) => b.match.score - a.match.score)
    .map(({ view, match }) => ({ view, positions: match.positions }));
}
