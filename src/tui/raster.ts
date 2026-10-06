// Draws a label into an RGBA buffer rotated 90° clockwise (tops of letters
// point right, text runs downward), centred across the width.
import { GLYPH_H, GLYPH_W, glyph5x7 } from "./font";

export type RasterOptions = {
  width: number;
  height: number;
  /** pixels per font pixel */
  scale: number;
  /** pixels left empty above the first letter */
  pad: number;
  fg: [number, number, number];
  /** fills every other pixel; omitted = transparent */
  bg?: [number, number, number];
};

export function rasterLabel(text: string, o: RasterOptions): Uint8Array {
  const px = new Uint8Array(o.width * o.height * 4);
  if (o.bg) for (let i = 0; i < px.length; i += 4) px.set([...o.bg, 255], i);
  const left = Math.floor((o.width - GLYPH_H * o.scale) / 2);
  const advance = (GLYPH_W + 1) * o.scale;
  [...text].forEach((ch, i) => {
    const columns = glyph5x7(ch);
    const top = o.pad + i * advance;
    columns.forEach((bits, gx) => {
      for (let gy = 0; gy < GLYPH_H; gy++) {
        if (!((bits >> gy) & 1)) continue;
        // clockwise: glyph column → output row, glyph row (from the top) → output column (from the right)
        const ox = left + (GLYPH_H - 1 - gy) * o.scale;
        const oy = top + gx * o.scale;
        for (let dy = 0; dy < o.scale; dy++) {
          for (let dx = 0; dx < o.scale; dx++) {
            const x = ox + dx;
            const y = oy + dy;
            if (x < 0 || y < 0 || x >= o.width || y >= o.height) continue;
            px.set([...o.fg, 255], (y * o.width + x) * 4);
          }
        }
      }
    });
  });
  return px;
}
