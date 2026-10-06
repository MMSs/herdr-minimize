// Kitty graphics protocol: sending RGBA images placed in cell units, and
// detecting support plus the cell size in pixels from terminal replies.

const CHUNK = 4096;

export const KITTY_CLEAR = "\x1b_Ga=d,d=A,q=2\x1b\\";
/** Asks the terminal (herdr answers for the pane) for the cell size in pixels. */
export const KITTY_PROBE = "\x1b[16t";

/** Transmits and displays an image over `cols`×`rows` cells at the cursor, leaving the cursor put. */
export function kittyImage(
  rgba: Uint8Array,
  width: number,
  height: number,
  cols: number,
  rows: number,
): string {
  const data = Buffer.from(rgba).toString("base64");
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += CHUNK) chunks.push(data.slice(i, i + CHUNK));
  if (chunks.length === 0) chunks.push("");
  return chunks
    .map((chunk, i) => {
      const more = i < chunks.length - 1 ? 1 : 0;
      const keys =
        i === 0
          ? `a=T,f=32,s=${width},v=${height},c=${cols},r=${rows},C=1,q=2,m=${more}`
          : `m=${more}`;
      return `\x1b_G${keys};${chunk}\x1b\\`;
    })
    .join("");
}

export function detectReplies(reply: string): { cellW: number; cellH: number } | null {
  const size = /\x1b\[6;(\d+);(\d+)t/.exec(reply);
  return size ? { cellW: Number(size[2]), cellH: Number(size[1]) } : null;
}
