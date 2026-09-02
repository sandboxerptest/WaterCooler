import { describe, expect, it } from "vitest";
import {
  RESIDENTS,
  WANDER_AREAS,
  deskOf,
  deskSpot,
  dwell,
  hauntKey,
  hauntsOf,
  nextHaunt,
  outsideSpots,
  residentById,
  residentsAt,
  residentsOf,
  roomForHaunt,
  wanderArea,
  yardArea,
} from "./residents";
import { roomFromLocation } from "../rooms";
import { CUTOUT, TILE, WIDTH } from "../map/office";
import { HEIGHT as FLOOR_ROWS, WIDTH as FLOOR_COLS } from "../map/floor";
import { TENANTS, organisationFor } from "./tenants";
import { CAMPUSES } from "./campus";
import { WORKER_SPRITES } from "../../components/game/config/animations";

const yoshi = residentById("yoshi")!;
const mark = residentById("mark")!;
const steve = residentById("steve")!;

describe("the residents", () => {
  it("each work for a real organisation, with a sheet in the library", () => {
    for (const r of RESIDENTS) {
      expect(organisationFor(r.org), r.name).not.toBeNull();
      expect(
        WORKER_SPRITES.some((w) => w.key === r.spriteKey),
        r.name,
      ).toBe(true);
      if (r.home)
        expect(
          TENANTS.some((t) => t.slug === r.home),
          r.name,
        ).toBe(true);
    }
  });

  it("are Yoshi at Castle Atlantic, Sara and Spud at Sandbox ERP, Yash at Mettara, Steve at Chester, Mark at Homestar", () => {
    const names = (org: string) => residentsOf(org).map((r) => r.name);
    expect(names("castle-atlantic")).toEqual(["Yoshi"]);
    expect(names("sandbox-erp")).toEqual(["Sara", "Spud"]);
    expect(names("mettara")).toEqual(["Yash"]);
    expect(names("chester")).toEqual(["Steve"]);
    expect(names("homestar")).toEqual(["Mark"]);
    expect(names("blockhouse")).toEqual([]);
  });
});

describe("desks", () => {
  it("are on the agents' floor of the home lobby, whose room matches its URL", () => {
    const room = roomForHaunt(yoshi, { kind: "office" })!;
    expect(room).toBe(roomFromLocation({ pathname: "/r/castle-atlantic/floor/2", search: "" }));
    expect(deskOf(yoshi)).toBe(0);
    expect(deskSpot(yoshi).y).toBeGreaterThan(0);
  });

  it("go two to a floor at Sandbox ERP, in order", () => {
    expect(residentsAt("sandbox-erp").map((r) => r.name)).toEqual(["Sara", "Spud"]);
    expect(deskOf(residentById("spud")!)).toBe(1);
  });

  it("put Mark in Homestar Sales and nowhere else on the campus", () => {
    expect(residentsAt("homestar-sales").map((r) => r.name)).toEqual(["Mark"]);
    expect(residentsAt("homestar-finance")).toEqual([]);
    expect(roomForHaunt(mark, { kind: "office" })).toBe("homestar-sales-floor-2");
  });

  it("are not for a store's resident", () => {
    expect(deskOf(steve)).toBe(-1);
    expect(hauntsOf(steve).some((h) => h.kind === "office")).toBe(false);
  });
});

describe("haunts", () => {
  it("take Yoshi to the desk, the lobby and outside", () => {
    expect(hauntsOf(yoshi).map(hauntKey)).toEqual(["office", "room:castle-atlantic", "outside"]);
  });

  it("take Steve round the store, the warehouse and outside", () => {
    expect(hauntsOf(steve).map(hauntKey)).toEqual([
      "room:chester-warehouse",
      "room:chester-store",
      "outside",
    ]);
  });

  it("take Mark to every building on the campus, the yard and outside", () => {
    expect(hauntsOf(mark).map(hauntKey)).toEqual([
      "office",
      "room:homestar-sales",
      "room:homestar-finance",
      "room:homestar-operations",
      "room:homestar-store",
      "room:homestar-field-crew",
      "campus:homestar",
      "outside",
    ]);
  });

  it("have a presence room only for rooms and the office", () => {
    expect(roomForHaunt(yoshi, { kind: "room", room: "castle-atlantic", area: "lobby" })).toBe(
      "castle-atlantic",
    );
    expect(roomForHaunt(mark, { kind: "campus", campus: "homestar" })).toBeNull();
    expect(roomForHaunt(yoshi, { kind: "outside" })).toBeNull();
  });
});

describe("the routine", () => {
  it("never stays put", () => {
    const lobby = { kind: "room", room: "castle-atlantic", area: "lobby" } as const;
    for (let i = 0; i < 20; i++)
      expect(hauntKey(nextHaunt(yoshi, lobby, () => i / 20))).not.toBe(hauntKey(lobby));
    expect(nextHaunt(yoshi, { kind: "office" }, () => 0)).toEqual(lobby);
    expect(nextHaunt(yoshi, { kind: "office" }, () => 0.99)).toEqual({ kind: "outside" });
  });

  it("dwells within the range for the kind of place", () => {
    expect(dwell("room", () => 0)).toBe(2 * 60_000);
    expect(dwell("room", () => 0.999)).toBeLessThan(4 * 60_000);
    expect(dwell("office", () => 0)).toBeGreaterThan(dwell("room", () => 0));
  });

  it("wanders the lobby inside the walls, below the top wall, clear of the lift", () => {
    const area = WANDER_AREAS.lobby;
    expect(area.x).toBeGreaterThanOrEqual(TILE);
    expect(area.y).toBeGreaterThan(4 * TILE);
    expect(area.x + area.width).toBeLessThan((WIDTH - 2) * TILE);
    // Never into the notch below the left part.
    expect(area.y + area.height).toBeLessThanOrEqual((CUTOUT.y - 1) * TILE);
  });

  it("wanders a store, a warehouse and a garage inside their walls", () => {
    for (const area of [WANDER_AREAS.store, WANDER_AREAS.warehouse, WANDER_AREAS.garage]) {
      expect(area.x).toBeGreaterThanOrEqual(TILE);
      expect(area.y).toBeGreaterThan(3 * TILE);
      expect(area.x + area.width).toBeLessThan((FLOOR_COLS - 1) * TILE);
      expect(area.y + area.height).toBeLessThan((FLOOR_ROWS - 1) * TILE);
    }
  });

  it("stays put at the desk, outside and on the yard", () => {
    expect(wanderArea({ kind: "office" })).toBeNull();
    expect(wanderArea({ kind: "outside" })).toBeNull();
    expect(wanderArea({ kind: "campus", campus: "homestar" })).toBeNull();
  });

  it("stands on the paved yard of the campus", () => {
    const yard = yardArea("homestar");
    const paved = CAMPUSES.homestar.paved[0];
    expect(yard.width).toBeGreaterThan(0);
    // Feet inside the paving, top to bottom.
    expect(yard.y).toBeGreaterThan(paved.y * TILE);
    expect(yard.y + yard.height).toBeLessThan((paved.y + paved.height) * TILE);
    expect(yardArea("nowhere").width).toBe(0);
  });

  it("has a place by the fountain and one by its own building", () => {
    const spots = outsideSpots(mark);
    expect(spots).toHaveLength(2);
    expect(spots[1].x).toBeGreaterThan(spots[0].x);
    // Each resident's fountain place is its own.
    const fountain = RESIDENTS.map((r) => outsideSpots(r)[0].x);
    expect(new Set(fountain).size).toBe(RESIDENTS.length);
  });
});
