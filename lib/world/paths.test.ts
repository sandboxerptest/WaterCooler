import { describe, expect, it } from "vitest";
import { campusFromPath, campusPath, isOutdoorPath, isWorldPath } from "./paths";

describe("addresses", () => {
  it("know the world map, with or without a trailing slash", () => {
    expect(isWorldPath("/world")).toBe(true);
    expect(isWorldPath("/world/")).toBe(true);
    expect(isWorldPath("/worldly")).toBe(false);
    expect(isWorldPath("/r/castle-atlantic")).toBe(false);
  });

  it("round-trip a campus", () => {
    expect(campusPath("homestar")).toBe("/campus/homestar");
    expect(campusFromPath("/campus/homestar")).toBe("homestar");
    expect(campusFromPath("/campus/homestar/")).toBe("homestar");
  });

  it("refuse anything that is not a campus", () => {
    expect(campusFromPath("/campus/")).toBeNull();
    expect(campusFromPath("/campus/Home%20star")).toBeNull();
    expect(campusFromPath("/r/homestar-sales")).toBeNull();
    expect(campusFromPath("/world")).toBeNull();
  });

  it("tell outdoors from a room", () => {
    expect(isOutdoorPath("/world")).toBe(true);
    expect(isOutdoorPath("/campus/homestar")).toBe(true);
    expect(isOutdoorPath("/r/homestar-sales")).toBe(false);
    expect(isOutdoorPath("/")).toBe(false);
  });
});
