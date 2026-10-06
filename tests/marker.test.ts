import { describe, expect, test } from "bun:test";
import { MARKER, marked, unmarked } from "../src/marker";

describe("tab marker", () => {
  test("is the ▾ glyph after a space", () => {
    expect(MARKER).toBe(" ▾");
  });

  test("marked appends it once", () => {
    expect(marked("agent")).toBe("agent ▾");
    expect(marked("agent ▾")).toBe("agent ▾");
    expect(marked("1")).toBe("1 ▾");
  });

  test("marked keeps a user's rename and puts the marker back", () => {
    expect(marked("renamed by user")).toBe("renamed by user ▾");
  });

  test("unmarked strips only a trailing marker", () => {
    expect(unmarked("agent ▾")).toBe("agent");
    expect(unmarked("agent")).toBe("agent");
    expect(unmarked("▾ notes")).toBe("▾ notes");
  });
});
