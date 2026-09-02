import { describe, it, expect } from "vitest";
import { fillZoom, zoomToCover } from "../camera";

// The office is 27x20 tiles at 48px.
const MAP_W = 1296;
const MAP_H = 960;
const MAX = 2;

describe("fillZoom", () => {
  it("covers the viewport rather than fitting inside it", () => {
    // A wide viewport is limited by height, not width.
    expect(fillZoom(1600, 960, MAP_W, MAP_H)).toBeCloseTo(1600 / MAP_W);
    expect(fillZoom(1296, 1200, MAP_W, MAP_H)).toBeCloseTo(1200 / MAP_H);
  });

  it("is 1 when the viewport matches the map", () => {
    expect(fillZoom(MAP_W, MAP_H, MAP_W, MAP_H)).toBe(1);
  });

  it("survives a zero-sized viewport during layout", () => {
    expect(fillZoom(0, 0, MAP_W, MAP_H)).toBe(1);
    expect(fillZoom(800, 600, 0, 0)).toBe(1);
  });
});

describe("zoomToCover", () => {
  it("zooms in when collapsing the column leaves the room too small", () => {
    // Column open: 800px of stage. Collapsed: the full 1500.
    const open = zoomToCover(0.82, 800, 800, MAP_W, MAP_H, MAX);
    const collapsed = zoomToCover(open, 1500, 800, MAP_W, MAP_H, MAX);
    expect(collapsed).toBeGreaterThan(open);
    expect(collapsed).toBeCloseTo(1500 / MAP_W);
  });

  it("leaves a deliberate zoom-in alone", () => {
    // Someone scrolled in to 1.6; a small viewport change must not yank it back.
    expect(zoomToCover(1.6, 1400, 900, MAP_W, MAP_H, MAX)).toBe(1.6);
  });

  it("never zooms past the maximum, however wide the window", () => {
    expect(zoomToCover(0.82, 6000, 4000, MAP_W, MAP_H, MAX)).toBe(MAX);
  });

  it("raises a too-small zoom to exactly cover, not further", () => {
    const z = zoomToCover(0.5, 1296, 960, MAP_W, MAP_H, MAX);
    expect(z).toBe(1);
  });
});
