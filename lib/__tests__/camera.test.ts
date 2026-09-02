import { describe, it, expect } from "vitest";
import { ROOM_FRAME, fitZoom, frameZoom } from "../camera";

// The lobby is 20x19 tiles at 48px.
const MAP_W = 960;
const MAP_H = 912;

describe("fitZoom", () => {
  it("fits the room inside the viewport rather than covering it", () => {
    // A wide viewport is limited by height; a tall one by width.
    expect(fitZoom(1600, 672, MAP_W, MAP_H)).toBeCloseTo(672 / MAP_H);
    expect(fitZoom(960, 1200, MAP_W, MAP_H)).toBeCloseTo(960 / MAP_W);
  });

  it("is 1 when the viewport matches the room", () => {
    expect(fitZoom(MAP_W, MAP_H, MAP_W, MAP_H)).toBe(1);
  });

  it("survives a zero-sized viewport during layout", () => {
    expect(fitZoom(0, 0, MAP_W, MAP_H)).toBe(1);
    expect(fitZoom(800, 600, 0, 0)).toBe(1);
  });
});

describe("frameZoom", () => {
  it("is the lobby's fit, whatever room is on screen, within the limits", () => {
    expect(ROOM_FRAME).toEqual({ width: MAP_W, height: MAP_H });
    expect(frameZoom(MAP_W, MAP_H, 0.5, 2)).toBe(1);
    // A floor is the same size as the lobby, so it fits the same; a smaller
    // room would too, without zooming in on it.
    expect(frameZoom(1920, 1824, 0.5, 2)).toBe(2);
    expect(frameZoom(6000, 4000, 0.5, 2)).toBe(2);
    expect(frameZoom(200, 100, 0.5, 2)).toBe(0.5);
  });

  it("grows when the chat column collapses and the viewport widens", () => {
    const open = frameZoom(800, 1000, 0.5, 2);
    const collapsed = frameZoom(1500, 1000, 0.5, 2);
    expect(collapsed).toBeGreaterThan(open);
  });
});
