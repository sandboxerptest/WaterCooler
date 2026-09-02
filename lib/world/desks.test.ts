import { describe, expect, it } from "vitest";
import { DESK_SLOTS, MAX_DESKS, deskBox, slotsFit, standingSpot } from "./desks";

describe("desk slots", () => {
  it("are eight, in two rows, and all inside the floor", () => {
    expect(MAX_DESKS).toBe(8);
    expect(slotsFit()).toBe(true);
    expect(new Set(DESK_SLOTS.map((s) => s.ty)).size).toBe(2);
  });

  it("do not overlap each other, and each seat is below its desk", () => {
    for (let i = 0; i < MAX_DESKS; i++) {
      const box = deskBox(i);
      const spot = standingSpot(i);
      expect(spot.x).toBe(box.x + box.width / 2);
      expect(spot.y + 43).toBeGreaterThan(box.y + box.height);
      for (let j = i + 1; j < MAX_DESKS; j++) {
        const other = deskBox(j);
        const apart =
          box.x + box.width <= other.x ||
          other.x + other.width <= box.x ||
          box.y + box.height <= other.y ||
          other.y + other.height <= box.y;
        expect(apart).toBe(true);
      }
    }
  });
});
