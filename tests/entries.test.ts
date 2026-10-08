import { describe, expect, test } from "bun:test";
import {
  displayName,
  filterViews,
  fuzzy,
  glyph,
  newestFirst,
  toView,
  type View,
} from "../src/entries";

const view = (name: string, minimized_at: string): View => ({
  pane_id: name,
  name,
  status: "none",
  cwd: null,
  minimized_at,
});

describe("entries", () => {
  test("display name prefers label, then agent, then process", () => {
    expect(displayName({ label: "notes", agent: "claude" }, "zsh")).toBe("notes");
    expect(displayName({ label: "  ", agent: "claude" }, "zsh")).toBe("claude");
    expect(displayName({ label: null, agent: null }, "lazygit")).toBe("lazygit");
    expect(displayName({}, null)).toBe("pane");
  });

  test("toView uses live label/agent, keeps the stored name otherwise, and the cwd basename", () => {
    const e = {
      pane_id: "w9:p1",
      name: "lazygit",
      minimized_at: "2026-10-06T18:00:00Z",
      siblings: [],
      dir: "right" as const,
      ratio: 0.5,
      was_first: false,
    };
    const p = {
      pane_id: "w9:p1",
      tab_id: "w9:t1",
      workspace_id: "w9",
      terminal_id: "t1",
      agent_status: "unknown" as const,
      focused: false,
      foreground_cwd: "/x/proj",
    };
    expect(toView(e, p)).toEqual({
      pane_id: "w9:p1",
      name: "lazygit",
      status: "none",
      cwd: "proj",
      minimized_at: e.minimized_at,
    });
    expect(toView(e, { ...p, agent: "claude", agent_status: "blocked" }).status).toBe("blocked");
  });

  test("newestFirst sorts by minimized_at descending", () => {
    const xs = [view("a", "2026-01-01T00:00:00Z"), view("b", "2026-01-02T00:00:00Z")];
    expect(newestFirst(xs).map((v) => v.name)).toEqual(["b", "a"]);
  });

  test("blocked glyph is emphasised", () => {
    expect(glyph("blocked")).toContain("\x1b[1;31m");
  });

  test("fuzzy matches characters in order, case-insensitively", () => {
    expect(fuzzy("lzg", "LazyGit")?.positions).toEqual([0, 2, 4]);
    expect(fuzzy("gz", "lazygit")).toBeNull();
    expect(fuzzy("", "anything")).toEqual({ score: 0, positions: [] });
  });

  test("contiguous and word-start matches rank higher", () => {
    expect(fuzzy("git", "lazygit")!.score).toBeGreaterThan(fuzzy("git", "gxixt")!.score);
    expect(fuzzy("cl", "claude")!.score).toBeGreaterThan(fuzzy("cl", "uncle")!.score);
  });

  test("filterViews ranks by score and keeps newest-first order for ties", () => {
    const views = [view("claude", "3"), view("zsh", "2"), view("codex", "1")];
    expect(filterViews(views, "").map((r) => r.view.name)).toEqual(["claude", "zsh", "codex"]);
    expect(filterViews(views, "c").map((r) => r.view.name)).toEqual(["claude", "codex"]);
    expect(filterViews(views, "zs").map((r) => r.view.name)).toEqual(["zsh"]);
    expect(filterViews(views, "qq")).toEqual([]);
  });
});
