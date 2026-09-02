import { describe, expect, it } from "vitest";
import {
  RESIDENTS,
  dwell,
  nextPlace,
  deskOf,
  deskSpot,
  residentsOf,
  roomForPlace,
  wanderArea,
} from "./residents";
import { roomFromLocation } from "../rooms";
import { CUTOUT, TILE, WIDTH } from "../map/office";

const yoshi = RESIDENTS[0];

describe("Yoshi", () => {
  it("works at Castle Atlantic and nowhere else", () => {
    expect(residentsOf("castle-atlantic")).toEqual([yoshi]);
    expect(residentsOf("sandbox-erp")).toEqual([]);
  });

  it("has a desk on the agents' floor, whose room matches its URL", () => {
    const room = roomForPlace(yoshi, "office")!;
    expect(room).toBe(roomFromLocation({ pathname: "/r/castle-atlantic/floor/2", search: "" }));
    expect(deskOf(yoshi)).toBe(0);
    expect(deskSpot(yoshi).y).toBeGreaterThan(0);
    expect(roomForPlace(yoshi, "lobby")).toBe("castle-atlantic");
    expect(roomForPlace(yoshi, "outside")).toBeNull();
  });
});

describe("the routine", () => {
  it("never stays put", () => {
    for (let i = 0; i < 20; i++) expect(nextPlace("lobby", () => i / 20)).not.toBe("lobby");
    expect(nextPlace("office", () => 0)).toBe("lobby");
    expect(nextPlace("office", () => 0.99)).toBe("outside");
  });

  it("dwells within the range for the place", () => {
    expect(dwell("lobby", () => 0)).toBe(2 * 60_000);
    expect(dwell("lobby", () => 0.999)).toBeLessThan(4 * 60_000);
  });

  it("wanders inside the walls, below the top wall, clear of the lift", () => {
    const area = wanderArea("lobby")!;
    expect(area.x).toBeGreaterThanOrEqual(TILE);
    expect(area.y).toBeGreaterThan(4 * TILE);
    expect(area.x + area.width).toBeLessThan((WIDTH - 2) * TILE);
    // Never into the notch below the left part.
    expect(area.y + area.height).toBeLessThanOrEqual((CUTOUT.y - 1) * TILE);
    expect(wanderArea("outside")).toBeNull();
    expect(wanderArea("office")).toBeNull();
  });
});
