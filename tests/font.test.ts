import { describe, expect, test } from "bun:test";
import { GLYPH_H, glyph5x7, textBitmap } from "../src/tui/font";

describe("5x7 font", () => {
  test("every printable ASCII character has five 7-bit columns", () => {
    for (let c = 32; c < 127; c++) {
      const g = glyph5x7(String.fromCharCode(c));
      expect(g).toHaveLength(5);
      for (const col of g) expect(col).toBeLessThan(1 << GLYPH_H);
    }
  });

  test("letters render recognisably", () => {
    expect(textBitmap("A")).toEqual([
      " ### ",
      "#   #",
      "#   #",
      "#   #",
      "#####",
      "#   #",
      "#   #",
    ]);
    expect(textBitmap("H")).toEqual([
      "#   #",
      "#   #",
      "#   #",
      "#####",
      "#   #",
      "#   #",
      "#   #",
    ]);
  });

  test("characters are separated by one blank column", () => {
    expect(textBitmap("II")[3]).toBe("  #     #  ");
  });

  test("unknown characters fall back to a box, and … has its own glyph", () => {
    expect(glyph5x7("é")).toEqual(glyph5x7("\u0000"));
    expect(textBitmap("…")[6]).toBe("# # #");
  });
});
