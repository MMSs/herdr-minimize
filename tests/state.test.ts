import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyState, loadState, saveState, tabState, withLock } from "../src/state";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mm-state-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("state", () => {
  test("missing file loads as empty state", () => {
    expect(loadState(dir)).toEqual(emptyState());
  });

  test("save then load round-trips and leaves no temp files", () => {
    const s = emptyState();
    tabState(s, "w1:t1").entries.push({
      pane_id: "w1:p3",
      name: "zsh",
      minimized_at: "2026-10-06T18:00:00.000Z",
      siblings: ["w1:p2"],
      dir: "down",
      ratio: 0.6,
      was_first: false,
    });
    saveState(s, dir);
    expect(loadState(dir)).toEqual(s);
    expect(readdirSync(dir)).toEqual(["state.json"]);
  });

  test("a file from before the parking field loads with an empty parking map", async () => {
    await Bun.write(join(dir, "state.json"), JSON.stringify({ version: 2, tabs: {} }));
    expect(loadState(dir).parking).toEqual({});
  });

  test("a version 1 file keyed by terminal ids is migrated to pane ids", async () => {
    const v1 = {
      version: 1,
      parking: { w1: "w1:t4" },
      tabs: {
        "w1:t1": {
          entries: [
            {
              terminal_id: "term_c",
              name: "zsh",
              minimized_at: "2026-10-06T18:00:00.000Z",
              siblings: ["term_b"],
              dir: "down",
              ratio: 0.6,
              was_first: false,
            },
          ],
          layout: {
            kind: "split",
            dir: "right",
            ratio: 0.5,
            first: { kind: "leaf", id: "term_a" },
            second: {
              kind: "split",
              dir: "down",
              ratio: 0.6,
              first: { kind: "leaf", id: "term_b" },
              second: { kind: "leaf", id: "term_c" },
            },
          },
        },
      },
    };
    await Bun.write(join(dir, "state.json"), JSON.stringify(v1));
    const live: Record<string, string> = { term_a: "w1:p1", term_b: "w1:p2", term_c: "w1:p3" };
    const s = loadState(dir, () => (t) => live[t]);
    expect(s.version).toBe(2);
    expect(s.parking).toEqual({ w1: "w1:t4" });
    const ts = s.tabs["w1:t1"]!;
    expect(ts.entries).toEqual([
      {
        pane_id: "w1:p3",
        name: "zsh",
        minimized_at: "2026-10-06T18:00:00.000Z",
        siblings: ["w1:p2"],
        dir: "down",
        ratio: 0.6,
        was_first: false,
      },
    ]);
    expect(ts.layout).toEqual({
      kind: "split",
      dir: "right",
      ratio: 0.5,
      first: { kind: "leaf", id: "w1:p1" },
      second: {
        kind: "split",
        dir: "down",
        ratio: 0.6,
        first: { kind: "leaf", id: "w1:p2" },
        second: { kind: "leaf", id: "w1:p3" },
      },
    });
  });

  test("migration drops entries whose terminal is gone and keeps unknown ids out of the layout", async () => {
    const v1 = {
      version: 1,
      parking: {},
      tabs: {
        "w1:t1": {
          entries: [
            {
              terminal_id: "term_gone",
              name: "zsh",
              minimized_at: "x",
              siblings: ["term_a"],
              dir: "right",
              ratio: 0.5,
              was_first: false,
            },
          ],
          layout: {
            kind: "split",
            dir: "right",
            ratio: 0.5,
            first: { kind: "leaf", id: "term_a" },
            second: { kind: "leaf", id: "term_gone" },
          },
        },
      },
    };
    await Bun.write(join(dir, "state.json"), JSON.stringify(v1));
    const s = loadState(dir, () => (t) => (t === "term_a" ? "w1:p1" : undefined));
    expect(s.tabs).toEqual({});
  });

  test("the live lookup is only made for a version 1 file", async () => {
    await Bun.write(join(dir, "state.json"), JSON.stringify(emptyState()));
    let asked = false;
    loadState(dir, () => {
      asked = true;
      return () => undefined;
    });
    expect(asked).toBe(false);
  });

  test("unknown version is refused instead of misread", async () => {
    await Bun.write(join(dir, "state.json"), JSON.stringify({ version: 99 }));
    expect(() => loadState(dir)).toThrow(/version 99/);
  });

  test("lock serialises concurrent operations", async () => {
    const order: string[] = [];
    const op = (name: string) =>
      withLock(
        async () => {
          order.push(`${name}:start`);
          await Bun.sleep(30);
          order.push(`${name}:end`);
        },
        { dir },
      );
    await Promise.all([op("a"), op("b")]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  test("lock is released when the operation throws", async () => {
    await expect(
      withLock(
        async () => {
          throw new Error("boom");
        },
        { dir },
      ),
    ).rejects.toThrow("boom");
    expect(await withLock(async () => 42, { dir })).toBe(42);
  });

  test("a stale lock left by a crashed process is broken", async () => {
    mkdirSync(join(dir, "lock"));
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(dir, "lock"), old, old);
    expect(await withLock(async () => "ok", { dir, timeoutMs: 500 })).toBe("ok");
  });

  test("a fresh lock held too long times out", async () => {
    mkdirSync(join(dir, "lock"));
    await expect(withLock(async () => "never", { dir, timeoutMs: 200 })).rejects.toThrow(
      /timed out/,
    );
  });
});
