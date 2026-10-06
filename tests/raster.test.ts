import { describe, expect, test } from "bun:test";
import { rasterLabel } from "../src/tui/raster";

const alphaAt = (px: Uint8Array, width: number, x: number, y: number) =>
  px[(y * width + x) * 4 + 3];

describe("rasterLabel", () => {
  test("produces RGBA of the requested size, transparent by default", () => {
    const px = rasterLabel("", { width: 10, height: 6, scale: 1, pad: 1, fg: [1, 2, 3] });
    expect(px).toHaveLength(10 * 6 * 4);
    expect(px.every((v, i) => i % 4 !== 3 || v === 0)).toBe(true);
  });

  test("rotates text 90° clockwise: tops of letters point right, text runs downward", () => {
    // "I" is columns 00 41 7F 41 00: its stem (column 2) becomes row pad+2
    const width = 32;
    const px = rasterLabel("I", { width, height: 34, scale: 1, pad: 1, fg: [9, 9, 9] });
    const left = Math.floor((width - 7) / 2);
    const row = (y: number) =>
      Array.from({ length: width }, (_, x) => (alphaAt(px, width, x, y) ? "#" : " ")).join("");
    expect(row(3).trim()).toBe("#######");
    expect(row(3).indexOf("#")).toBe(left);
    // column 1 of "I" has only its top and bottom pixel: right end = top of the glyph
    expect(row(2).slice(left, left + 7)).toBe("#     #");
    expect(row(1).trim()).toBe("");
  });

  test("scale multiplies every font pixel", () => {
    const px = rasterLabel("I", { width: 32, height: 40, scale: 2, pad: 0, fg: [9, 9, 9] });
    let opaque = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i]) opaque++;
    expect(opaque).toBe(11 * 4); // "I" has 11 lit pixels
  });

  test("pixels use the foreground colour", () => {
    const px = rasterLabel("I", { width: 32, height: 34, scale: 1, pad: 1, fg: [200, 100, 50] });
    const i = (3 * 32 + Math.floor((32 - 7) / 2)) * 4;
    expect([...px.slice(i, i + 4)]).toEqual([200, 100, 50, 255]);
  });

  test("an optional background fills every other pixel opaquely", () => {
    const px = rasterLabel("I", {
      width: 32,
      height: 34,
      scale: 1,
      pad: 1,
      fg: [9, 9, 9],
      bg: [1, 2, 3],
    });
    expect([...px.slice(0, 4)]).toEqual([1, 2, 3, 255]);
    expect(px.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true);
  });
});
