import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli, HerdrError, herdr } from "../src/herdr";

let dir: string;
const fake = join(import.meta.dir, "support/fake-herdr.sh");
const reply = (body: unknown, exit = 0) => {
  process.env.FAKE_HERDR_OUT = typeof body === "string" ? body : JSON.stringify(body);
  process.env.FAKE_HERDR_EXIT = String(exit);
};
const calls = () => readFileSync(join(dir, "log"), "utf8").trim().split("\n");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mm-herdr-"));
  process.env.HERDR_BIN_PATH = fake;
  process.env.FAKE_HERDR_LOG = join(dir, "log");
  process.env.FAKE_HERDR_ERR = "";
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("herdr cli", () => {
  test("calls HERDR_BIN_PATH and returns .result", () => {
    reply({ id: "x", result: { type: "pane_info", pane: { pane_id: "w1:p1" } } });
    expect(herdr.currentPane().pane_id).toBe("w1:p1");
    expect(calls()).toEqual(["pane current --current"]);
  });

  test("API errors become HerdrError with the code", () => {
    reply({ id: "x", error: { code: "pane_not_found", message: "pane not found" } });
    expect(() => cli(["pane", "get", "w9:p9"])).toThrow(HerdrError);
    try {
      cli(["pane", "get", "w9:p9"]);
    } catch (e) {
      expect((e as HerdrError).code).toBe("pane_not_found");
    }
  });

  test("API errors printed on stderr with a failing exit keep their code", () => {
    reply("", 1);
    process.env.FAKE_HERDR_ERR = JSON.stringify({
      error: { code: "workspace_not_found", message: "workspace w9 not found" },
    });
    expect(herdr.workspaceExists("w9")).toBe(false);
  });

  test("non-JSON failure surfaces stderr/stdout", () => {
    reply("unknown option: --nope", 2);
    expect(() => cli(["pane", "move", "--nope"])).toThrow(/unknown option/);
  });

  test("movePane returns the pane from move_result", () => {
    reply({
      result: { move_result: { changed: true, pane: { pane_id: "w2:p1", terminal_id: "t" } } },
    });
    expect(herdr.movePane("w1:p3", ["--new-tab", "--no-focus"]).pane_id).toBe("w2:p1");
    expect(calls()[0]).toBe("pane move w1:p3 --new-tab --no-focus");
  });

  test("workspaceExists maps not-found to false", () => {
    reply({ error: { code: "workspace_not_found", message: "nope" } });
    expect(herdr.workspaceExists("w7")).toBe(false);
  });

  test("processName reads the first foreground process", () => {
    reply({ result: { process_info: { foreground_processes: [{ name: "lazygit" }] } } });
    expect(herdr.processName("w1:p1")).toBe("lazygit");
  });
});
