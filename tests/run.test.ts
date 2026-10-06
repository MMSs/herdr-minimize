import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UserError } from "../src/ops";
import { runEntrypoint } from "../src/run";

let dir: string;
const calls = () =>
  existsSync(join(dir, "log")) ? readFileSync(join(dir, "log"), "utf8").trim().split("\n") : [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mm-run-"));
  process.env.HERDR_BIN_PATH = join(import.meta.dir, "support/fake-herdr.sh");
  process.env.FAKE_HERDR_LOG = join(dir, "log");
  process.env.FAKE_HERDR_OUT = JSON.stringify({ result: { type: "ok" } });
  process.env.FAKE_HERDR_ERR = "";
  process.env.FAKE_HERDR_EXIT = "0";
  process.exitCode = 0;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.exitCode = 0;
});

describe("runEntrypoint", () => {
  test("user-facing refusals become a herdr notification", async () => {
    await runEntrypoint(async () => {
      throw new UserError("Only pane in this tab");
    });
    expect(calls()).toEqual(["notification show Minimize --body Only pane in this tab"]);
    expect(process.exitCode).toBe(0);
  });

  test("quiet entrypoints (hooks) log failures instead of notifying", async () => {
    const err = spyOn(console, "error").mockImplementation(() => {});
    await runEntrypoint(
      async () => {
        throw new Error("timed out waiting for another minimize/restore to finish");
      },
      { quiet: true },
    );
    expect(calls()).toEqual([]);
    expect(err).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    err.mockRestore();
  });
});
