import { describe, expect, it } from "vitest";
import type { Bitmap } from "../png";
import {
  commonScale,
  cutCells,
  drawScaled,
  spriteCuts,
  largestPiece,
  palette,
  rowBands,
  snapToPalette,
} from "../strip";

const blank = (w: number, h: number): Bitmap => ({
  width: w,
  height: h,
  data: new Uint8Array(w * h * 4),
});
const paint = (img: Bitmap, x: number, y: number, rgb: [number, number, number], a = 255) => {
  const i = (y * img.width + x) * 4;
  img.data.set([...rgb, a], i);
};
const rect = (
  img: Bitmap,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgb: [number, number, number],
) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) paint(img, x, y, rgb);
};

/** Two rows of six sprites: a 6-wide head over a 12-wide body, bodies touching. */
function packedSheet(): Bitmap {
  const img = blank(76, 40);
  for (const row of [0, 20]) {
    for (let k = 0; k < 6; k++) {
      const x = 2 + k * 12;
      rect(img, x + 2, row + 2, 6, 6, [0, 200, 0]); // head, gaps between heads
      rect(img, x + 1, row + 8, 10, 9, [120, 0, 40]); // body
      rect(img, x, row + 17, 12, 1, [0, 0, 0]); // feet, touching the neighbour's
    }
  }
  return img;
}

describe("a packed sheet", () => {
  const img = packedSheet();

  it("is cut into rows", () => {
    const bands = rowBands(img);
    expect(bands).toHaveLength(2);
    expect(bands[0].y).toBeLessThan(bands[1].y);
  });

  it("cuts between the sprites even though their feet touch", () => {
    const [band] = rowBands(img);
    const cuts = spriteCuts(img, band);
    expect(cuts).toHaveLength(7);
    // Every cut lands between two bodies: on no body column.
    for (const c of cuts.slice(1, -1)) expect((c - 2) % 12 >= 11 || (c - 2) % 12 < 1).toBe(true);
  });

  it("cuts a known number of sprites by their share of the ink", () => {
    const [band] = rowBands(img);
    expect(cutCells(img, band, spriteCuts(img, band, 6))).toHaveLength(6);
    // Asked for fewer, the narrowest pieces are merged into a neighbour.
    expect(cutCells(img, band, spriteCuts(img, band, 3))).toHaveLength(3);
  });

  it("cuts six sprites per row, each with its own ink only", () => {
    const [band] = rowBands(img);
    const cells = cutCells(img, band, spriteCuts(img, band));
    expect(cells).toHaveLength(6);
    for (const c of cells) {
      // The feet touch, so the cut takes a column off one side or the other.
      expect(c.ink.width).toBeGreaterThanOrEqual(10);
      expect(c.ink.width).toBeLessThanOrEqual(12);
      expect(c.ink.height).toBe(16);
    }
    // The first sprite's head belongs to it; the neighbour's head does not.
    expect(cells[0].belongs(4, 3)).toBe(true);
    expect(cells[0].belongs(16, 3)).toBe(false);
  });

  it("gives a dark outline to the body it touches, not to a neighbour", () => {
    // Two bodies whose outlines meet along the feet; the outline colour is
    // dark enough that plain connectivity would run them together.
    const two = blank(30, 12);
    rect(two, 1, 1, 10, 10, [0, 0, 0]); // A's outline
    rect(two, 2, 2, 8, 8, [0, 200, 0]); // A's body
    rect(two, 15, 1, 10, 10, [0, 0, 0]); // B's outline
    rect(two, 16, 2, 8, 8, [0, 200, 0]); // B's body
    rect(two, 11, 10, 4, 1, [0, 0, 0]); // a dark bridge along the feet
    const a = largestPiece(two, { x: 0, y: 0, width: 13, height: 12 })!;
    expect(a.belongs(5, 5)).toBe(true);
    expect(a.belongs(10, 5)).toBe(true);
    // The bridge is dark and touches A, so a pixel or two of it comes along;
    // B's body never does.
    expect(a.ink.width).toBeLessThanOrEqual(12);
    expect(a.belongs(12, 5)).toBe(false);
    const b = largestPiece(two, { x: 13, y: 0, width: 17, height: 12 })!;
    expect(b.belongs(20, 5)).toBe(true);
    expect(b.belongs(15, 5)).toBe(true);
    expect(b.belongs(5, 5)).toBe(false);
  });

  it("keeps legs that a dark belt has cut off from the torso", () => {
    const one = blank(20, 30);
    rect(one, 4, 2, 12, 10, [0, 200, 0]); // torso
    rect(one, 4, 12, 12, 3, [0, 0, 0]); // belt: dark, full width
    rect(one, 5, 15, 10, 12, [220, 220, 220]); // legs
    const piece = largestPiece(one, { x: 0, y: 0, width: 20, height: 30 })!;
    expect(piece.belongs(10, 20)).toBe(true);
    expect(piece.ink.height).toBe(25);
  });

  it("keeps the largest piece and drops a stray fragment", () => {
    const stray = blank(20, 20);
    rect(stray, 2, 2, 8, 8, [200, 200, 200]);
    paint(stray, 15, 15, [200, 200, 200]);
    const piece = largestPiece(stray, { x: 0, y: 0, width: 20, height: 20 })!;
    expect(piece.ink).toEqual({ x: 2, y: 2, width: 8, height: 8 });
    expect(piece.belongs(15, 15)).toBe(false);
  });
});

describe("palette", () => {
  it("finds the frequent colours and snaps the halo to them", () => {
    const img = blank(10, 10);
    rect(img, 0, 0, 10, 5, [0, 200, 0]);
    rect(img, 0, 5, 10, 5, [120, 0, 40]);
    paint(img, 5, 5, [60, 100, 20]); // an in-between edge pixel
    paint(img, 0, 0, [0, 0, 0], 30); // faint: not ink
    const colours = palette(img, 2);
    expect(colours).toHaveLength(2);
    const snapped = snapToPalette(img, colours);
    const at = (x: number, y: number) =>
      Array.from(snapped.data.subarray((y * 10 + x) * 4, (y * 10 + x) * 4 + 4));
    expect(at(5, 5)[3]).toBe(255);
    expect(colours.some((c) => c.join() === at(5, 5).slice(0, 3).join())).toBe(true);
    expect(at(0, 0)[3]).toBe(0);
  });
});

describe("drawing", () => {
  it("scales every frame the same and stands it on the frame's floor", () => {
    const img = packedSheet();
    const [band] = rowBands(img);
    const cells = cutCells(img, band, spriteCuts(img, band));
    const scale = commonScale(cells, 48, 96);
    const widest = Math.max(...cells.map((c) => c.ink.width));
    expect(scale).toBeCloseTo(44 / widest, 5);
    // A height cap wins when it is the tighter limit.
    expect(commonScale(cells, 48, 96, 2, 32)).toBeCloseTo(32 / 16, 5);
    const frame = drawScaled(img, cells[0], scale, 48, 96);
    // Bottom row of ink sits at 96 - 2 - 1.
    let lowest = -1;
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 48; x++) if (frame.data[(y * 48 + x) * 4 + 3] > 0) lowest = y;
    expect(lowest).toBe(93);
  });
});
