import { describe, it, expect } from "vitest";
import {
  BUILDINGS,
  ORGANISATIONS,
  TENANTS,
  WORLD_HEIGHT,
  WORLD_SPAWN,
  WORLD_WIDTH,
  hasCampus,
  spawnFor,
  tenantFor,
  tenantTitle,
  tenantUrl,
  tenantsOf,
} from "../tenants";
import { normaliseRoomSlug } from "../../rooms";

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("organisations and their lobbies", () => {
  it("names the businesses, and the lab", () => {
    expect(ORGANISATIONS.map((o) => o.name)).toEqual([
      "Castle Atlantic",
      "Sandbox ERP",
      "Chester",
      "Blockhouse",
      "Homestar",
      "Mettara",
      "Apeiron Media",
    ]);
  });

  it("gives every lobby a slug the room layer accepts unchanged, and an organisation", () => {
    for (const t of TENANTS) {
      expect(normaliseRoomSlug(t.slug)).toBe(t.slug);
      expect(ORGANISATIONS.some((o) => o.slug === t.org)).toBe(true);
    }
    expect(new Set(TENANTS.map((t) => t.slug)).size).toBe(TENANTS.length);
  });

  it("lists each store's parts and each campus's departments", () => {
    expect(tenantsOf("chester").map((t) => t.location)).toEqual(["Warehouse", "Store"]);
    expect(tenantsOf("blockhouse").map((t) => t.location)).toEqual([
      "Warehouse",
      "Store",
      "Field Crew",
    ]);
    expect(tenantsOf("homestar").map((t) => t.location)).toEqual([
      "Sales",
      "Finance",
      "Operations",
      "Building Supply",
      "Building Supply Warehouse",
      "Field Crew",
    ]);
    expect(hasCampus("castle-atlantic")).toBe(false);
    expect(hasCampus("chester")).toBe(false);
    expect(hasCampus("homestar")).toBe(true);
  });

  it("titles and points each lobby at its own room", () => {
    expect(tenantUrl(TENANTS[0])).toBe("/r/castle-atlantic");
    expect(tenantTitle(tenantFor("sandbox-erp")!)).toBe("Sandbox ERP");
    expect(tenantTitle(tenantFor("chester-warehouse")!)).toBe("Chester · Warehouse");
    expect(tenantFor("local")).toBeNull();
  });
});

describe("the world map", () => {
  it("gives every organisation one front door, to a lobby or a campus", () => {
    expect(BUILDINGS.map((b) => b.org.slug).sort()).toEqual(
      ORGANISATIONS.map((o) => o.slug).sort(),
    );
    for (const b of BUILDINGS) {
      if (b.entrance.kind === "lobby") expect(hasCampus(b.org.slug)).toBe(false);
      else expect(b.entrance.campus).toBe(b.org.slug);
    }
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
    for (let i = 0; i < BUILDINGS.length; i++)
      for (let j = i + 1; j < BUILDINGS.length; j++)
        expect(overlaps(BUILDINGS[i].frame, BUILDINGS[j].frame)).toBe(false);
  });

  it("puts the doorway on the ground where a person can reach it", () => {
    for (const b of BUILDINGS) {
      expect(overlaps(b.door, b.solid)).toBe(false);
      // Under the building — or, for the ferry, on the dock beside it.
      if (b.art === "world-boat") expect(b.door.x + b.door.width).toBeLessThanOrEqual(b.solid.x);
      else expect(b.door.y).toBeGreaterThanOrEqual(b.solid.y + b.solid.height);
    }
  });

  it("stands you outside the building you just left, clear of its door", () => {
    const castle = BUILDINGS[0];
    expect(spawnFor("castle-atlantic")).toEqual(castle.outside);
    expect(spawnFor("castle-atlantic").y).toBeGreaterThan(castle.door.y + castle.door.height);
    // Out of a store is that store's front door; out of a campus's lobby, the gate.
    const chester = BUILDINGS.find((b) => b.org.slug === "chester")!;
    expect(chester.entrance).toEqual({ kind: "lobby", tenant: tenantFor("chester-store") });
    expect(spawnFor("chester-store")).toEqual(chester.outside);
    expect(spawnFor("homestar-sales")).toEqual(
      BUILDINGS.find((b) => b.org.slug === "homestar")!.outside,
    );
    expect(spawnFor("nowhere")).toEqual(WORLD_SPAWN);
    expect(spawnFor(null)).toEqual(WORLD_SPAWN);
  });
});
