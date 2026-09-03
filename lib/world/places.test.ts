import { describe, expect, it } from "vitest";
import { describeRoom } from "./places";

describe("saying where a room is", () => {
  it("names the outdoors", () => {
    expect(describeRoom("world")).toEqual({ label: "World map", kind: "world" });
    expect(describeRoom("campus-homestar")).toEqual({ label: "Homestar · Campus", kind: "campus" });
    expect(describeRoom("campus-apeiron-media")).toEqual({
      label: "Apeiron Media · Ireland",
      kind: "campus",
    });
  });

  it("names a building's floors", () => {
    expect(describeRoom("castle-atlantic")).toEqual({
      label: "Castle Atlantic · Lobby",
      kind: "lobby",
    });
    expect(describeRoom("castle-atlantic-floor-1")).toEqual({
      label: "Castle Atlantic · Floor 1 · People",
      kind: "floor",
    });
    expect(describeRoom("sandbox-erp-floor-2")).toEqual({
      label: "Sandbox ERP · Floor 2 · Agents",
      kind: "floor",
    });
  });

  it("names a store or warehouse without a lobby", () => {
    expect(describeRoom("chester-store")).toEqual({ label: "Chester · Store", kind: "lobby" });
    expect(describeRoom("homestar-warehouse").label).toBe("Homestar · Building Supply Warehouse");
  });

  it("falls back to the slug for anything it does not know", () => {
    expect(describeRoom("local")).toEqual({ label: "local", kind: "unknown" });
    expect(describeRoom("campus-nowhere")).toEqual({ label: "campus-nowhere", kind: "unknown" });
    expect(describeRoom("castle-atlantic-floor-9")).toEqual({
      label: "castle-atlantic-floor-9",
      kind: "unknown",
    });
  });
});
