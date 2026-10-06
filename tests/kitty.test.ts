import { describe, expect, test } from "bun:test";
import { detectReplies, KITTY_CLEAR, KITTY_PROBE, kittyImage } from "../src/tui/kitty";

describe("kitty graphics", () => {
  test("small images are sent in one escape with placement in cells", () => {
    const out = kittyImage(new Uint8Array(4 * 2 * 2), 2, 2, 3, 4);
    expect(out).toBe(
      `\x1b_Ga=T,f=32,s=2,v=2,c=3,r=4,C=1,q=2,m=0;${Buffer.alloc(16).toString("base64")}\x1b\\`,
    );
  });

  test("large images are chunked at 4096 base64 bytes", () => {
    const out = kittyImage(new Uint8Array(4 * 50 * 50), 50, 50, 2, 3);
    const parts = out.split("\x1b\\").filter(Boolean);
    expect(parts.length).toBe(Math.ceil((Math.ceil((4 * 50 * 50) / 3) * 4) / 4096));
    expect(parts[0]).toStartWith("\x1b_Ga=T,f=32,s=50,v=50,c=2,r=3,C=1,q=2,m=1;");
    expect(parts[1]).toStartWith("\x1b_Gm=1;");
    expect(parts.at(-1)).toStartWith("\x1b_Gm=0;");
    for (const p of parts) expect(p.slice(p.indexOf(";") + 1).length).toBeLessThanOrEqual(4096);
  });

  test("clear deletes every placement and its data", () => {
    expect(KITTY_CLEAR).toBe("\x1b_Ga=d,d=A,q=2\x1b\\");
  });

  test("reads the cell size in pixels from the CSI 16 t reply", () => {
    expect(KITTY_PROBE).toBe("\x1b[16t");
    expect(detectReplies("\x1b[6;34;16t")).toEqual({ cellW: 16, cellH: 34 });
    expect(detectReplies("garbage")).toBeNull();
  });
});
