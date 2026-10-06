import { describe, expect, test } from "bun:test";
import { clipAnsi, parseInput, screenLines, stripAnsi } from "../src/tui/term";

describe("parseInput", () => {
  test("distinguishes enter, ctrl+j and ctrl+k", () => {
    expect(parseInput("\r\n\x0b").map((k) => k.kind)).toEqual(["enter", "ctrl-j", "ctrl-k"]);
  });
  test("arrows, backspace, ctrl+u, lone escape", () => {
    expect(parseInput("\x1b[A\x1b[B\x1bOA\x7f\x15\x1b").map((k) => k.kind)).toEqual([
      "up",
      "down",
      "up",
      "backspace",
      "ctrl-u",
      "esc",
    ]);
  });
  test("printable text including emoji stays whole", () => {
    expect(parseInput("aé🙂")).toEqual([
      { kind: "char", ch: "a" },
      { kind: "char", ch: "é" },
      { kind: "char", ch: "🙂" },
    ]);
  });
  test("SGR mouse press, release and wheel", () => {
    expect(parseInput("\x1b[<0;5;3M\x1b[<0;5;3m\x1b[<65;1;1M")).toEqual([
      { kind: "mouse", button: 0, x: 5, y: 3, release: false },
      { kind: "mouse", button: 0, x: 5, y: 3, release: true },
      { kind: "mouse", button: 65, x: 1, y: 1, release: false },
    ]);
  });
  test("terminal replies (kitty APC, window ops) are not read as keys", () => {
    expect(parseInput("\x1b_Gi=31;OK\x1b\\\x1b[6;34;16tj")).toEqual([{ kind: "char", ch: "j" }]);
  });
  test("focus reports and unknown CSI are ignored", () => {
    expect(parseInput("\x1b[I\x1b[O\x1b[2~")).toEqual([]);
  });
});

describe("clipAnsi", () => {
  test("pads short lines to exact width", () => {
    expect(stripAnsi(clipAnsi("ab", 5))).toBe("ab   ");
  });
  test("never cuts inside an escape sequence and resets at the end", () => {
    const out = clipAnsi("\x1b[31mhello\x1b[0m world", 3);
    expect(out).toBe("\x1b[31mhel\x1b[0m");
  });
  test("wide characters count as two columns", () => {
    expect(stripAnsi(clipAnsi("🙂🙂🙂", 5))).toBe("🙂🙂 ");
  });
  test("keeps OSC sequences intact", () => {
    expect(clipAnsi("\x1b]8;;http://x\x07ab", 1)).toBe("\x1b]8;;http://x\x07a\x1b[0m");
  });
});

describe("screenLines", () => {
  test("normalises CRLF, expands tabs, drops trailing blank lines", () => {
    expect(screenLines("a\r\n\tb\r\n\r\n\x1b[0m\r\n")).toEqual(["a", "    b"]);
  });
});
