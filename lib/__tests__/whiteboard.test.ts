import { describe, it, expect } from "vitest";
import { BOARD_HEIGHT, BOARD_WIDTH, isStroke, sanitiseStroke, type Stroke } from "../whiteboard";

const base: Stroke = { id: "s1", tool: "pen", color: "#fff", width: 4, points: [10, 20, 30, 40] };

describe("isStroke", () => {
  it("accepts a well-formed stroke", () => {
    expect(isStroke(base)).toBe(true);
  });

  it("rejects anything that is not one", () => {
    expect(isStroke(null)).toBe(false);
    expect(isStroke({ ...base, points: [1] })).toBe(false);
    expect(isStroke({ ...base, points: [1, "2"] })).toBe(false);
    expect(isStroke({ ...base, width: "thick" })).toBe(false);
    expect(isStroke({ ...base, points: [1, Number.NaN] })).toBe(false);
  });
});

describe("sanitiseStroke", () => {
  it("keeps an ordinary stroke intact", () => {
    expect(sanitiseStroke(base).points).toEqual([10, 20, 30, 40]);
  });

  it("clamps points to the board", () => {
    // A modified client should not be able to draw outside the frame
    const wild = sanitiseStroke({ ...base, points: [-500, -500, 99999, 99999] });
    expect(wild.points).toEqual([0, 0, BOARD_WIDTH, BOARD_HEIGHT]);
  });

  it("caps stroke width", () => {
    expect(sanitiseStroke({ ...base, width: 5000 }).width).toBe(40);
    expect(sanitiseStroke({ ...base, width: 0 }).width).toBe(1);
  });

  it("caps how many points one stroke may carry", () => {
    const huge = sanitiseStroke({ ...base, points: Array.from({ length: 9000 }, () => 5) });
    expect(huge.points.length).toBeLessThanOrEqual(2000);
  });

  it("truncates long identifiers and authors", () => {
    const long = sanitiseStroke({ ...base, id: "x".repeat(200), author: "y".repeat(200) });
    expect(long.id.length).toBeLessThanOrEqual(64);
    expect(long.author?.length).toBeLessThanOrEqual(16);
  });
});
