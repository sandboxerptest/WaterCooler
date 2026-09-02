import { describe, it, expect } from "vitest";
import {
  BUILDINGS,
  TENANTS,
  WORLD_HEIGHT,
  WORLD_SPAWN,
  WORLD_WIDTH,
  spawnFor,
  tenantFor,
  tenantUrl,
} from "../tenants";
import { normaliseRoomSlug } from "../../rooms";

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("tenants", () => {
  it("names the two businesses", () => {
    expect(TENANTS.map((t) => t.name)).toEqual(["Castle Atlantic", "Sandbox ERP"]);
  });

  it("uses slugs the room layer accepts unchanged", () => {
    // A slug the room layer would rewrite is a building whose door leads
    // somewhere other than where it says.
    for (const t of TENANTS) expect(normaliseRoomSlug(t.slug)).toBe(t.slug);
  });

  it("points each building at its own room", () => {
    expect(tenantUrl(TENANTS[0])).toBe("/r/castle-atlantic");
    expect(tenantFor("sandbox-erp")?.name).toBe("Sandbox ERP");
    expect(tenantFor("local")).toBeNull();
  });
});

describe("the world map", () => {
  it("gives every tenant a building", () => {
    expect(BUILDINGS.map((b) => b.tenant.slug)).toEqual(TENANTS.map((t) => t.slug));
  });

  it("keeps every building, door and spawn inside the map", () => {
    for (const b of BUILDINGS) {
      for (const r of [b.frame, b.solid, b.door]) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(WORLD_WIDTH);
        expect(r.y + r.height).toBeLessThanOrEqual(WORLD_HEIGHT);
      }
      expect(b.outside.y).toBeLessThan(WORLD_HEIGHT);
    }
    expect(WORLD_SPAWN.y).toBeLessThan(WORLD_HEIGHT);
  });

  it("does not let buildings overlap", () => {
    expect(overlaps(BUILDINGS[0].frame, BUILDINGS[1].frame)).toBe(false);
  });

  it("puts the doorway on the ground where a person can reach it", () => {
    // The door trigger must not be inside the solid wall, or nobody could
    // ever stand in it — the same mistake the office doorways once made.
    for (const b of BUILDINGS) {
      expect(overlaps(b.door, b.solid)).toBe(false);
      expect(b.door.y).toBeGreaterThanOrEqual(b.solid.y + b.solid.height);
    }
  });

  it("stands you outside the building you just left, clear of its door", () => {
    const castle = BUILDINGS[0];
    const at = spawnFor("castle-atlantic");
    expect(at).toEqual(castle.outside);
    expect(at.y).toBeGreaterThan(castle.door.y + castle.door.height);
    expect(spawnFor("nowhere")).toEqual(WORLD_SPAWN);
    expect(spawnFor(null)).toEqual(WORLD_SPAWN);
  });
});
