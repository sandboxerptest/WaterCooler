import { describe, expect, it } from "vitest";
import { coverZoom, frameZoom } from "../camera";

const MIN = 0.5;
const MAX = 2;

describe("how far out a map can be zoomed", () => {
  it("goes below the rooms' zoom on a map much bigger than the view, down to the least zoom", () => {
    // A 3000px-wide world in a 1200px view fills it at 0.42, below the
    // game's least zoom of 0.5, so 0.5 is the floor — and well below the
    // rooms' scale.
    expect(coverZoom(1200, 800, 3000, 1900, MIN, MAX)).toBe(MIN);
    expect(coverZoom(1200, 800, 3000, 1900, MIN, MAX)).toBeLessThan(frameZoom(1200, 800, MIN, MAX));
  });

  it("stops at the zoom that just fills the view with the map", () => {
    // A small yard in a big view: it must fill the view, so the floor is
    // whichever axis needs more.
    expect(coverZoom(1200, 800, 960, 912, MIN, MAX)).toBeCloseTo(1.25, 5);
  });

  it("never goes past the ceiling, and copes with a map of no size", () => {
    expect(coverZoom(4000, 4000, 100, 100, MIN, MAX)).toBe(MAX);
    expect(coverZoom(1200, 800, 0, 0, MIN, MAX)).toBe(MIN);
  });
});
