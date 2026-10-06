// Minimal raw-mode terminal: input parsing (keys + SGR mouse), ANSI-aware
// clipping, and an alternate-screen painter.

export type Key =
  | { kind: "char"; ch: string }
  | {
      kind:
        | "up"
        | "down"
        | "enter"
        | "esc"
        | "backspace"
        | "ctrl-j"
        | "ctrl-k"
        | "ctrl-u"
        | "ctrl-c";
    }
  | { kind: "mouse"; button: number; x: number; y: number; release: boolean };

const MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const APC = /^\x1b_[^\x1b]*\x1b\\/;
const CSI = /^\x1b[[O]([0-9;?]*)([A-Za-z~])/;
const ESCAPE = /^\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/;
const CONTROL: Record<string, Key["kind"]> = {
  "\r": "enter",
  "\n": "ctrl-j",
  "\x0b": "ctrl-k",
  "\x15": "ctrl-u",
  "\x03": "ctrl-c",
  "\x7f": "backspace",
  "\b": "backspace",
};

export function parseInput(data: string): Key[] {
  const keys: Key[] = [];
  let i = 0;
  while (i < data.length) {
    const rest = data.slice(i);
    if (rest[0] === "\x1b") {
      const apc = APC.exec(rest);
      if (apc) {
        i += apc[0].length; // terminal replies such as kitty graphics acks
        continue;
      }
      const m = MOUSE.exec(rest);
      if (m) {
        keys.push({
          kind: "mouse",
          button: Number(m[1]),
          x: Number(m[2]),
          y: Number(m[3]),
          release: m[4] === "m",
        });
        i += m[0].length;
        continue;
      }
      const c = CSI.exec(rest);
      if (c) {
        if (c[2] === "A") keys.push({ kind: "up" });
        if (c[2] === "B") keys.push({ kind: "down" });
        i += c[0].length;
        continue;
      }
      keys.push({ kind: "esc" });
      i += 1;
      continue;
    }
    const ch = String.fromCodePoint(data.codePointAt(i) as number);
    const control = CONTROL[ch];
    if (control) keys.push({ kind: control } as Key);
    else if (ch >= " ") keys.push({ kind: "char", ch });
    i += ch.length;
  }
  return keys;
}

export function stripAnsi(s: string): string {
  return s.replace(new RegExp(ESCAPE.source.slice(1), "g"), "");
}

/** Clips to `width` display columns, pads with spaces, never splits an escape sequence. */
export function clipAnsi(line: string, width: number): string {
  let out = "";
  let used = 0;
  let i = 0;
  while (i < line.length) {
    if (line[i] === "\x1b") {
      const m = ESCAPE.exec(line.slice(i));
      if (m) out += m[0];
      i += m ? m[0].length : 1;
      continue;
    }
    const ch = String.fromCodePoint(line.codePointAt(i) as number);
    const w = Bun.stringWidth(ch);
    if (used + w > width) break;
    out += ch;
    used += w;
    i += ch.length;
  }
  return `${out}${" ".repeat(Math.max(0, width - used))}\x1b[0m`;
}

export function screenLines(text: string): string[] {
  const lines = text.replace(/\r/g, "").replace(/\t/g, "    ").split("\n");
  while (lines.length > 0 && stripAnsi(lines[lines.length - 1] as string).trim() === "")
    lines.pop();
  return lines;
}

export class Screen {
  start(): void {
    process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h");
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
  }
  stop(): void {
    process.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l");
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
  }
  size(): { cols: number; rows: number } {
    return { cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
  }
  draw(lines: string[]): void {
    process.stdout.write(`\x1b[H${lines.join("\r\n")}\x1b[J`);
  }
}
