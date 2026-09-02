import { describe, expect, it } from "vitest";
import { CAMPUSES, campusMatchesTenants, campusSpawnFor } from "./campus";
import { allReachable, groundGrid, propBody, signBody, tilesOf, waterBodies } from "./scenery";
import { BOAT, TILE, hasCampus, ORGANISATIONS } from "./tenants";

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

describe("campuses", () => {
  it("exist for exactly the organisations whose door is not a lobby", () => {
    const withCampus = ORGANISATIONS.filter((o) => hasCampus(o.slug)).map((o) => o.slug);
    expect(Object.keys(CAMPUSES).sort()).toEqual(withCampus.sort());
  });

  for (const campus of Object.values(CAMPUSES)) {
    describe(campus.slug, () => {
      const bounds = { width: campus.columns * TILE, height: campus.rows * TILE };
      const grid = groundGrid(
        campus.columns,
        campus.rows,
        campus.paved,
        campus.buildings.map((b) => tilesOf(b.frame)),
        [],
        campus.water ?? [],
        campus.dock ?? [],
      );
      const solids = [
        ...campus.buildings.map((b) => b.solid),
        ...campus.props.map(propBody).filter((r) => r !== null),
        ...(campus.signs ?? []).map(signBody),
        ...(campus.boat ? [{ ...campus.boat, ...BOAT }] : []),
        ...waterBodies(grid),
      ];

      it("has one little building per lobby, apart from the warehouse behind the store", () => {
        expect(campusMatchesTenants(campus)).toBe(true);
      });

      it("keeps everything inside, apart, and off the road out", () => {
        for (const b of campus.buildings) {
          expect(b.frame.x).toBeGreaterThanOrEqual(TILE);
          expect(b.frame.x + b.frame.width).toBeLessThanOrEqual(bounds.width - TILE);
          expect(b.frame.y + b.frame.height).toBeLessThan(campus.exit.y);
          for (const other of campus.buildings) {
            if (other !== b) expect(overlaps(b.frame, other.frame)).toBe(false);
          }
        }
        for (const s of solids) expect(overlaps(s, campus.exit)).toBe(false);
      });

      it("paves the ground in front of, or beside, every door", () => {
        for (const b of campus.buildings) {
          const col = Math.floor((b.door.x + b.door.width / 2) / TILE);
          const row = Math.floor((b.door.y + b.door.height - 1) / TILE);
          expect(grid[row][col], `${b.tenant.slug} door`).not.toBe("grass");
          expect(overlaps(b.door, b.solid), `${b.tenant.slug} door in its wall`).toBe(false);
        }
        if (!campus.dock)
          expect(grid[campus.rows - 1][Math.floor(campus.columns / 2)]).not.toBe("grass");
      });

      it("lets you walk from the gate to every door, and back out", () => {
        const doors = campus.buildings.map((b) => ({
          x: b.door.x + b.door.width / 2,
          y: b.door.y,
        }));
        expect(allReachable(bounds, solids, campus.entrance, doors)).toBe(true);
        expect(
          allReachable(bounds, solids, campus.entrance, [
            { x: campus.exit.x + campus.exit.width / 2, y: campus.exit.y },
          ]),
        ).toBe(true);
      });

      if (campus.dock) {
        it("is an island: water all round, a dock to the ferry, and a board saying where you are", () => {
          const edge = (x: number, y: number) => grid[y][x];
          for (let x = 0; x < campus.columns; x++) {
            expect(edge(x, 0)).toBe("water");
            expect(edge(x, campus.rows - 1)).not.toBe("grass");
          }
          for (let y = 0; y < campus.rows; y++) {
            expect(edge(0, y)).toBe("water");
            expect(edge(campus.columns - 1, y)).toBe("water");
          }
          // The way out is the end of the dock, and the ferry is moored beside it.
          const col = Math.floor((campus.exit.x + campus.exit.width / 2) / TILE);
          const row = Math.floor((campus.exit.y + campus.exit.height - 1) / TILE);
          expect(grid[row][col]).toBe("dock");
          expect(campus.boat!.x).toBe(campus.exit.x + campus.exit.width);
          // You arrive on the dock too, facing the island.
          expect(
            grid[Math.floor(campus.entrance.y / TILE)][Math.floor(campus.entrance.x / TILE)],
          ).toBe("dock");
          expect(campus.signs?.some((s) => /IRELAND/.test(s.text))).toBe(true);
          expect(campus.place).toBe("Ireland");
        });
      } else {
        it("keeps the bottom edge — the way out from anywhere — clear of solids", () => {
          for (const s of solids) expect(s.y + s.height).toBeLessThanOrEqual(campus.exit.y);
          expect(campus.exit.width).toBe(bounds.width);
        });
      }

      it("stands you outside the building you just left, else at the gate", () => {
        const first = campus.buildings[0];
        expect(campusSpawnFor(campus, first.tenant.slug)).toEqual(first.outside);
        expect(first.outside.y).toBeGreaterThan(first.door.y + first.door.height);
        expect(campusSpawnFor(campus, null)).toEqual(campus.entrance);
      });
    });
  }
});
