import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyState, loadState, saveState, statusTexts, tabState, withLock } from "../src/state";

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
      terminal_id: "term_1",
      name: "zsh",
      minimized_at: "2026-10-06T18:00:00.000Z",
      siblings: ["term_2"],
      dir: "down",
      ratio: 0.6,
      was_first: false,
    });
    saveState(s, dir);
    expect(loadState(dir)).toEqual(s);
    expect(readdirSync(dir)).toEqual(["state.json"]);
  });

  test("a file from before the parking field loads with an empty parking map", async () => {
    await Bun.write(join(dir, "state.json"), JSON.stringify({ version: 1, tabs: {} }));
    expect(loadState(dir).parking).toEqual({});
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

  test("status text per tab is the ▾ mark and its count", () => {
    const s = emptyState();
    const entry = {
      terminal_id: "t",
      name: "n",
      minimized_at: "x",
      siblings: [],
      dir: "right" as const,
      ratio: 0.5,
      was_first: false,
    };
    tabState(s, "w1:t1").entries.push(entry, { ...entry, terminal_id: "u" });
    tabState(s, "w1:t2");
    expect(statusTexts(s)).toEqual({ "w1:t1": "▾ 2" });
  });
});
