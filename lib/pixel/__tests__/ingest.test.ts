import { describe, it, expect } from "vitest";
import type { Bitmap } from "../png";
import {
  detectBackdrop,
  detectPoses,
  diagnoseSheet,
  dropMergedFigures,
  pickLibraryRows,
  positionalAssignments,
  type DetectedPose,
  findFigures,
  fitIntoFrame,
  groupIntoRows,
  keepFigures,
  keyOutBackdrop,
} from "../ingest";

/** A sheet filled with one colour, with figures drawn as solid rectangles. */
function sheet(width: number, height: number, bg: [number, number, number, number]): Bitmap {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(bg, i * 4);
  return { width, height, data };
}

function paint(b: Bitmap, x0: number, y0: number, w: number, h: number, c = [200, 90, 60, 255]) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) b.data.set(c, (y * b.width + x) * 4);
  }
}

describe("backdrop detection", () => {
  it("reads a flat backdrop off the corners", () => {
    expect(detectBackdrop(sheet(100, 100, [6, 6, 8, 255]))).toEqual([6, 6, 8]);
  });

  it("leaves an already cut-out image alone", () => {
    expect(detectBackdrop(sheet(100, 100, [0, 0, 0, 0]))).toBeNull();
  });

  it("refuses to guess when the corners disagree", () => {
    const s = sheet(100, 100, [0, 0, 0, 255]);
    paint(s, 90, 90, 10, 10, [255, 255, 255, 255]);
    expect(detectBackdrop(s)).toBeNull();
  });

  it("keys out near-black noise, not only exact black", () => {
    // An image model's "black" is full of near-black — a strict match leaves a
    // confetti of stray pixels that then read as extra characters.
    const s = sheet(60, 60, [4, 4, 6, 255]);
    s.data.set([20, 18, 22, 255], (30 * 60 + 30) * 4);
    paint(s, 10, 10, 20, 30);
    const keyed = keyOutBackdrop(s);
    expect(keyed.data[(30 * 60 + 30) * 4 + 3]).toBe(0);
    expect(keyed.data[(15 * 60 + 15) * 4 + 3]).toBe(255);
  });
});

describe("finding figures", () => {
  it("finds each separate figure with a tight box", () => {
    const s = sheet(200, 100, [0, 0, 0, 0]);
    paint(s, 10, 20, 30, 60);
    paint(s, 100, 10, 40, 80);
    // Scan order, not reading order — the row grouper sorts later.
    const boxes = [...findFigures(s).boxes].sort((a, b) => a.x - b.x);
    expect(boxes).toEqual([
      { x: 10, y: 20, width: 30, height: 60 },
      { x: 100, y: 10, width: 40, height: 80 },
    ]);
  });

  it("joins pixels that touch only at a corner", () => {
    // A pixel-art outline often does; treating it as two figures would slice
    // one character into fragments.
    const s = sheet(10, 10, [0, 0, 0, 0]);
    paint(s, 2, 2, 2, 2);
    paint(s, 4, 4, 2, 2);
    expect(findFigures(s).boxes).toHaveLength(1);
  });

  it("labels every pixel with its figure", () => {
    const s = sheet(50, 20, [0, 0, 0, 0]);
    paint(s, 2, 2, 5, 10);
    paint(s, 30, 2, 5, 10);
    const { labels } = findFigures(s);
    expect(labels[4 * 50 + 4]).toBe(1);
    expect(labels[4 * 50 + 32]).toBe(2);
    expect(labels[0]).toBe(0);
  });
});

describe("keeping only characters", () => {
  const s = sheet(1000, 800, [0, 0, 0, 0]);

  it("drops a wide, short label", () => {
    const boxes = [
      { x: 0, y: 0, width: 100, height: 300 },
      { x: 300, y: 700, width: 400, height: 30 },
    ];
    expect(keepFigures(boxes, s).map((f) => f.box)).toEqual([boxes[0]]);
  });

  it("drops crumbs far smaller than the characters", () => {
    const boxes = [
      { x: 0, y: 0, width: 100, height: 300 },
      { x: 200, y: 0, width: 100, height: 300 },
      { x: 500, y: 500, width: 4, height: 5 },
    ];
    expect(keepFigures(boxes, s)).toHaveLength(2);
  });

  it("drops a divider spanning the sheet", () => {
    const boxes = [
      { x: 0, y: 0, width: 100, height: 300 },
      { x: 0, y: 400, width: 950, height: 200 },
    ];
    expect(keepFigures(boxes, s)).toHaveLength(1);
  });

  it("keeps the label id in step with the surviving box", () => {
    const boxes = [
      { x: 300, y: 700, width: 400, height: 30 },
      { x: 0, y: 0, width: 100, height: 300 },
    ];
    expect(keepFigures(boxes, s)).toEqual([{ box: boxes[1], label: 2 }]);
  });
});

describe("rows", () => {
  const f = (x: number, y: number, w: number, h: number, label: number) => ({
    box: { x, y, width: w, height: h },
    label,
  });

  it("groups figures into the rows they were drawn in, in reading order", () => {
    const rows = groupIntoRows([
      f(300, 10, 50, 100, 1),
      f(10, 200, 50, 100, 2),
      f(10, 12, 50, 100, 3),
    ]);
    expect(rows.map((r) => r.map((x) => x.label))).toEqual([[3, 1], [2]]);
  });

  it("keeps a figure drawn a little higher than its neighbours in the same row", () => {
    // A running pose leans; a sitting one drops. Sorting by y alone splits them.
    const rows = groupIntoRows([
      f(10, 40, 50, 100, 1),
      f(100, 10, 50, 100, 2),
      f(200, 60, 50, 100, 3),
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe("dropMergedFigures", () => {
  const f = (h: number, label: number) => ({
    box: { x: label * 40, y: 0, width: 30, height: h },
    label,
  });

  it("removes a figure twice the height of its row", () => {
    const rows = dropMergedFigures([[f(46, 1), f(48, 2), f(47, 3), f(95, 4), f(46, 5)]]);
    expect(rows[0].map((x) => x.label)).toEqual([1, 2, 3, 5]);
  });

  it("leaves a short row alone, where there is no majority to judge by", () => {
    const rows = dropMergedFigures([[f(46, 1), f(95, 2)]]);
    expect(rows[0]).toHaveLength(2);
  });

  it("judges height against the figure's own row, not the sheet", () => {
    const rows = dropMergedFigures([
      [f(30, 1), f(31, 2), f(30, 3)],
      [f(90, 4), f(92, 5), f(91, 6)],
    ]);
    expect(rows[1]).toHaveLength(3);
  });
});

describe("fitting into a frame", () => {
  it("keeps proportions and stands the figure on the floor", () => {
    const s = sheet(400, 400, [0, 0, 0, 0]);
    paint(s, 50, 50, 100, 300);
    const frame = fitIntoFrame(s, { x: 50, y: 50, width: 100, height: 300 }, 48, 96);
    // Bottom row must have paint; top row must not.
    const bottom = Array.from({ length: 48 }, (_, x) => frame.data[(95 * 48 + x) * 4 + 3]);
    const top = Array.from({ length: 48 }, (_, x) => frame.data[(0 * 48 + x) * 4 + 3]);
    expect(bottom.some((a) => a > 0)).toBe(true);
    expect(top.every((a) => a === 0)).toBe(true);
    // 1:3 source in a 1:2 frame is height-limited: ~94px tall, ~31px wide.
    let minX = 48;
    let maxX = -1;
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 48; x++)
        if (frame.data[(y * 48 + x) * 4 + 3] > 0) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
    expect(maxX - minX + 1).toBeGreaterThanOrEqual(29);
    expect(maxX - minX + 1).toBeLessThanOrEqual(33);
  });

  it("leaves no dark halo where paint meets transparency", () => {
    // Averaging RGB over a mix of opaque and clear pixels drags the edge
    // toward black unless colour is weighted by alpha.
    const s = sheet(100, 100, [0, 0, 0, 0]);
    paint(s, 20, 20, 60, 60, [255, 255, 255, 255]);
    const frame = fitIntoFrame(s, { x: 20, y: 20, width: 60, height: 60 }, 24, 24, 0);
    for (let i = 0; i < frame.data.length; i += 4) {
      if (frame.data[i + 3] === 0) continue;
      expect(frame.data[i]).toBe(255);
    }
  });

  it("cuts out only the figure it was asked for", () => {
    // An L-shaped figure whose bounding box encloses a separate neighbour —
    // the shape a raised arm or a leaning run makes on a loose sheet. Solid
    // rectangles cannot model this: if their boxes overlap they touch, and
    // touching figures are correctly one figure.
    const s = sheet(100, 100, [0, 0, 0, 0]);
    paint(s, 10, 10, 10, 80, [255, 0, 0, 255]); // upright of the L
    paint(s, 10, 80, 30, 10, [255, 0, 0, 255]); // foot of the L
    paint(s, 25, 20, 10, 40, [0, 0, 255, 255]); // neighbour inside the L's box
    const { boxes, labels } = findFigures(s);
    expect(boxes).toHaveLength(2);
    const red = boxes.findIndex((b) => b.width === 30) + 1;
    const frame = fitIntoFrame(
      s,
      { x: 10, y: 10, width: 30, height: 80 },
      48,
      96,
      2,
      (x, y) => labels[y * 100 + x] === red,
    );
    for (let i = 0; i < frame.data.length; i += 4) {
      if (frame.data[i + 3] === 0) continue;
      expect(frame.data[i + 2], "blue neighbour leaked in").toBeLessThan(50);
    }
  });
});

describe("detectPoses end to end", () => {
  it("turns a loose sheet on black into ordered, cut-out poses", () => {
    const s = sheet(600, 400, [3, 3, 5, 255]);
    paint(s, 20, 20, 60, 150);
    paint(s, 200, 30, 60, 150);
    paint(s, 400, 15, 60, 150);
    paint(s, 30, 220, 60, 150);
    paint(s, 250, 230, 60, 150);
    paint(s, 100, 385, 300, 12, [255, 255, 255, 255]); // a caption
    const { poses } = detectPoses(s);
    expect(poses.map((p) => [p.row, p.column])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
    ]);
    const frame = poses[0].toFrame(48, 96);
    expect(frame.width).toBe(48);
    expect(frame.data.some((_, i) => i % 4 === 3 && frame.data[i] > 0)).toBe(true);
  });
});

describe("diagnoseSheet", () => {
  const img = (w: number, h: number, bg: [number, number, number, number]) => {
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set(bg, i * 4);
    return { width: w, height: h, data };
  };
  const pose = (h: number, w = 30): DetectedPose => ({
    row: 0,
    column: 0,
    box: { x: 0, y: 0, width: w, height: h },
    toFrame: () => ({ width: 48, height: 96, data: new Uint8Array(48 * 96 * 4) }),
  });

  it("blames a gradient background when nothing is found", () => {
    const g = img(100, 100, [0, 0, 0, 255]);
    g.data.set([90, 80, 70, 255], (1 * 100 + 1) * 4); // the sampled top-left corner differs
    const d = diagnoseSheet(g, g, [], 64);
    expect(d.backdrop).toBe("not flat");
    expect(d.reason).toMatch(/not one flat colour/);
  });

  it("recognises a full library-style sheet by its figure count", () => {
    const flat = img(100, 100, [0, 0, 0, 255]);
    const d = diagnoseSheet(
      flat,
      flat,
      Array.from({ length: 300 }, () => pose(25)),
      64,
    );
    expect(d.reason).toMatch(/300 figures/);
    expect(d.advice).toMatch(/2688/);
  });

  it("explains that tiny figures cannot be enlarged into sprites", () => {
    const flat = img(100, 100, [0, 0, 0, 255]);
    const d = diagnoseSheet(
      flat,
      flat,
      Array.from({ length: 20 }, () => pose(24)),
      64,
    );
    expect(d.figureHeight).toBe(24);
    expect(d.reason).toMatch(/24 px tall/);
  });

  it("has nothing to say about a good sheet", () => {
    const flat = img(100, 100, [0, 0, 0, 255]);
    const d = diagnoseSheet(
      flat,
      flat,
      Array.from({ length: 16 }, () => pose(150)),
      64,
    );
    expect(d.reason).toBe("");
  });
});

describe("library-shaped sheets", () => {
  const at = (row: number, column: number, x: number): DetectedPose => ({
    row,
    column,
    box: { x, y: row * 60, width: 24, height: 46 },
    toFrame: () => ({ width: 48, height: 96, data: new Uint8Array(48 * 96 * 4) }),
  });
  const thumbs = [0, 1, 2, 3].map((c) => at(0, c, c * 30));
  const longRow = (row: number, n: number) =>
    Array.from({ length: n }, (_, c) => at(row, c, c * 30));

  it("keeps the two long rows after the thumbnails and drops the rest", () => {
    const poses = [
      ...thumbs,
      ...longRow(1, 20),
      ...longRow(2, 21),
      ...longRow(3, 3),
      ...longRow(4, 11),
    ];
    const picked = pickLibraryRows(poses)!;
    expect(picked).toHaveLength(41);
    expect(picked.filter((p) => p.row === 1)).toHaveLength(20);
    expect(picked.filter((p) => p.row === 2)).toHaveLength(21);
    expect(picked[0].column).toBe(0);
    expect(picked[20].column).toBe(0);
  });

  it("is null for an ordinary small sheet", () => {
    expect(pickLibraryRows([...longRow(0, 5), ...longRow(1, 5), ...longRow(2, 5)])).toBeNull();
  });

  it("is null when the long rows are not preceded by anything", () => {
    // A plain two-row sheet of 20 figures is not the library shape.
    expect(pickLibraryRows([...longRow(0, 20), ...longRow(1, 20)])).toBeNull();
  });

  it("assigns facings by position across the row, surviving a merged neighbour", () => {
    // 24 slots but one figure missing (merged) — the quarters must still hold.
    const row = longRow(1, 24).filter((_, c) => c !== 7);
    const out = positionalAssignments(row, ["right", "up", "left", "down"]);
    const facingOf = (x: number) => out.find((a) => row[a.pose].box.x === x)!.facing;
    expect(facingOf(0)).toBe("right");
    expect(facingOf(5 * 30)).toBe("right");
    expect(facingOf(8 * 30)).toBe("up");
    expect(facingOf(15 * 30)).toBe("left");
    expect(facingOf(23 * 30)).toBe("down");
    expect(out.every((a) => a.kind === "idle")).toBe(true);
  });
});
