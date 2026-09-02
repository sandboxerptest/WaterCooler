import { describe, it, expect } from "vitest";
import type { Bitmap } from "../png";
import {
  composeSheet,
  flipHorizontal,
  framesFor,
  sanitiseAssignments,
  reconcileRows,
  sliceFrame,
  PORTRAIT_COLUMN,
  PORTRAIT_ROW,
  FRAME_H,
  FRAME_W,
  COLUMNS,
  SHEET_H,
  SHEET_W,
  type Assignment,
} from "../compose";

/** A frame with a single marker pixel whose colour identifies it. */
function tagged(id: number, atX = 10): Bitmap {
  const data = new Uint8Array(FRAME_W * FRAME_H * 4);
  data.set([id, id, id, 255], (50 * FRAME_W + atX) * 4);
  return { width: FRAME_W, height: FRAME_H, data };
}
const idOf = (f: Bitmap) => {
  for (let i = 3; i < f.data.length; i += 4) if (f.data[i]) return f.data[i - 3];
  return -1;
};
const slot = (sheet: Bitmap, row: number, col: number): Bitmap => {
  const out = new Uint8Array(FRAME_W * FRAME_H * 4);
  for (let y = 0; y < FRAME_H; y++) {
    const s = ((row * FRAME_H + y) * SHEET_W + col * FRAME_W) * 4;
    out.set(sheet.data.subarray(s, s + FRAME_W * 4), y * FRAME_W * 4);
  }
  return { width: FRAME_W, height: FRAME_H, data: out };
};

describe("flipHorizontal", () => {
  it("mirrors a frame", () => {
    const f = tagged(7, 10);
    const flipped = flipHorizontal(f);
    expect(flipped.data[(50 * FRAME_W + (FRAME_W - 1 - 10)) * 4]).toBe(7);
    expect(flipped.data[(50 * FRAME_W + 10) * 4 + 3]).toBe(0);
  });
});

describe("framesFor", () => {
  const frames = [tagged(1), tagged(2), tagged(3), tagged(4)];

  it("uses the poses drawn for that facing and kind", () => {
    const a: Assignment[] = [{ pose: 2, facing: "down", kind: "idle" }];
    expect(framesFor(frames, a, "down", "idle").map(idOf)).toEqual([3, 3, 3, 3, 3, 3]);
  });

  it("cycles a short run to fill six slots", () => {
    const a: Assignment[] = [
      { pose: 0, facing: "down", kind: "walk" },
      { pose: 1, facing: "down", kind: "walk" },
    ];
    expect(framesFor(frames, a, "down", "walk").map(idOf)).toEqual([1, 2, 1, 2, 1, 2]);
  });

  it("mirrors the other side when one profile is missing", () => {
    // Most sheets draw only one side view.
    const a: Assignment[] = [{ pose: 3, facing: "right", kind: "idle" }];
    const left = framesFor(frames, a, "left", "idle");
    expect(left[0].data[(50 * FRAME_W + (FRAME_W - 1 - 10)) * 4]).toBe(4);
  });

  it("stands still when there is no walk cycle for a facing", () => {
    const a: Assignment[] = [{ pose: 1, facing: "up", kind: "idle" }];
    expect(framesFor(frames, a, "up", "walk").map(idOf)).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it("falls back to facing down when a facing is missing entirely", () => {
    const a: Assignment[] = [{ pose: 0, facing: "down", kind: "idle" }];
    expect(framesFor(frames, a, "up", "walk").map(idOf)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("prefers a genuine mirror over the wrong kind", () => {
    const a: Assignment[] = [
      { pose: 0, facing: "left", kind: "idle" },
      { pose: 1, facing: "right", kind: "walk" },
    ];
    // Asked for left/walk: mirror of right/walk (pose 1) beats left/idle (pose 0).
    const left = framesFor(frames, a, "left", "walk");
    expect(left[0].data[(50 * FRAME_W + (FRAME_W - 1 - 10)) * 4]).toBe(2);
  });
});

describe("composeSheet", () => {
  const frames = [tagged(1), tagged(2), tagged(3), tagged(4), tagged(5)];
  const a: Assignment[] = [
    { pose: 0, facing: "down", kind: "idle" },
    { pose: 1, facing: "right", kind: "idle" },
    { pose: 2, facing: "up", kind: "idle" },
    { pose: 3, facing: "down", kind: "walk" },
    { pose: 4, facing: "down", kind: "walk" },
  ];
  const sheet = composeSheet(frames, a);

  it("is exactly the size the game hard-codes", () => {
    expect(sheet.width).toBe(SHEET_W);
    expect(sheet.height).toBe(SHEET_H);
    expect(SHEET_W / FRAME_W).toBe(COLUMNS);
  });

  it("puts idle in row 1 in right / up / left / down order", () => {
    expect(idOf(slot(sheet, 1, 0))).toBe(2); // right
    expect(idOf(slot(sheet, 1, 6))).toBe(3); // up
    expect(idOf(slot(sheet, 1, 18))).toBe(1); // down
    // left is the mirror of right
    expect(slot(sheet, 1, 12).data[(50 * FRAME_W + (FRAME_W - 1 - 10)) * 4]).toBe(2);
  });

  it("puts walk in row 2 and cycles the two down frames", () => {
    const down = [18, 19, 20, 21, 22, 23].map((c) => idOf(slot(sheet, 2, c)));
    expect(down).toEqual([4, 5, 4, 5, 4, 5]);
  });

  it("leads with the character's face in row 0", () => {
    expect(idOf(slot(sheet, 0, 0))).toBe(1);
  });

  it("leaves no animated slot empty", () => {
    for (const row of [1, 2]) {
      for (let col = 0; col < 24; col++) {
        expect(idOf(slot(sheet, row, col)), `row ${row} col ${col}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("sanitiseAssignments", () => {
  it("drops indices out of range, repeats and unknown labels", () => {
    const out = sanitiseAssignments(
      [
        { pose: 0, facing: "down", kind: "idle" },
        { pose: 0, facing: "up", kind: "idle" },
        { pose: 9, facing: "down", kind: "idle" },
        { pose: 1, facing: "sideways", kind: "idle" },
        { pose: 2, facing: "left", kind: "run" },
        { pose: "3", facing: "left", kind: "walk" },
        { pose: 3, facing: "left", kind: "walk" },
      ],
      4,
    );
    expect(out).toEqual([
      { pose: 0, facing: "down", kind: "idle" },
      { pose: 3, facing: "left", kind: "walk" },
    ]);
  });

  it("tolerates garbage", () => {
    expect(sanitiseAssignments(null, 3)).toEqual([]);
    expect(sanitiseAssignments("nope", 3)).toEqual([]);
  });
});

describe("reconcileRows", () => {
  const rowOf = (pose: number) => Math.floor(pose / 4); // four figures per row

  it("flips a lone outlier to its row's majority", () => {
    const a: Assignment[] = [
      { pose: 0, facing: "left", kind: "idle" },
      { pose: 1, facing: "left", kind: "idle" },
      { pose: 2, facing: "down", kind: "idle" }, // misread
      { pose: 3, facing: "left", kind: "walk" },
    ];
    const { assignments, corrected } = reconcileRows(a, rowOf);
    expect(corrected).toEqual([2]);
    expect(assignments[2].facing).toBe("left");
    // Kind is never touched.
    expect(assignments[3].kind).toBe("walk");
  });

  it("leaves a genuinely split row alone", () => {
    const a: Assignment[] = [
      { pose: 0, facing: "left", kind: "idle" },
      { pose: 1, facing: "left", kind: "idle" },
      { pose: 2, facing: "right", kind: "idle" },
      { pose: 3, facing: "right", kind: "idle" },
    ];
    expect(reconcileRows(a, rowOf).corrected).toEqual([]);
  });

  it("does not vote in a row too small to have a majority worth trusting", () => {
    const a: Assignment[] = [
      { pose: 0, facing: "left", kind: "idle" },
      { pose: 1, facing: "down", kind: "idle" },
    ];
    expect(reconcileRows(a, rowOf).corrected).toEqual([]);
  });

  it("does not mutate what it was given", () => {
    const a: Assignment[] = [
      { pose: 0, facing: "up", kind: "idle" },
      { pose: 1, facing: "up", kind: "idle" },
      { pose: 2, facing: "down", kind: "idle" },
    ];
    reconcileRows(a, rowOf);
    expect(a[2].facing).toBe("down");
  });
});

describe("sliceFrame", () => {
  it("cuts the portrait slot back out of a composed sheet", () => {
    const face = tagged(9, 20);
    const sheet = composeSheet([face], [{ pose: 0, facing: "down", kind: "idle" }]);
    const back = sliceFrame(sheet, PORTRAIT_COLUMN, PORTRAIT_ROW);
    expect(back.width).toBe(FRAME_W);
    expect(back.height).toBe(FRAME_H);
    expect(Array.from(back.data)).toEqual(Array.from(face.data));
  });
});
