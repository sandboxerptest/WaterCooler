import { describe, expect, it } from "vitest";
import { SCENERY, everyDoorReachable, groundTiles, propBody, propBounds } from "./scenery";
import {
  BUILDINGS,
  TILE,
  WORLD_COLUMNS,
  WORLD_HEIGHT,
  WORLD_ROWS,
  WORLD_SPAWN,
  WORLD_WIDTH,
} from "./tenants";

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

describe("ground", () => {
  const tiles = groundTiles();

  it("covers the whole map", () => {
    expect(tiles).toHaveLength(WORLD_ROWS);
    for (const row of tiles) expect(row).toHaveLength(WORLD_COLUMNS);
  });

  it("puts a kerb only where paving meets grass above it", () => {
    for (let y = 1; y < WORLD_ROWS; y++)
      for (let x = 0; x < WORLD_COLUMNS; x++) {
        if (tiles[y][x] === "kerb") expect(tiles[y - 1][x]).toBe("grass");
        const underBuilding = BUILDINGS.some(
          (b) =>
            x * TILE >= b.frame.x &&
            x * TILE < b.frame.x + b.frame.width &&
            (y - 1) * TILE < b.frame.y + b.frame.height &&
            (y - 1) * TILE >= b.frame.y,
        );
        if (tiles[y][x] === "paving" && !underBuilding) expect(tiles[y - 1][x]).not.toBe("grass");
      }
  });

  it("runs a path from every door down to the promenade, without a kerb at the door", () => {
    for (const b of BUILDINGS) {
      const col = Math.floor((b.door.x + b.door.width / 2) / TILE);
      // The door zone straddles the building's last row and the path's first.
      const from = Math.floor((b.door.y + b.door.height - 1) / TILE);
      expect(tiles[from][col]).toBe("paving");
      for (let y = from; y < WORLD_ROWS - 2; y++) expect(tiles[y][col]).not.toBe("grass");
    }
    expect(tiles[Math.floor(WORLD_SPAWN.y / TILE)][Math.floor(WORLD_SPAWN.x / TILE)]).not.toBe(
      "grass",
    );
  });
});

describe("props", () => {
  it("stand inside the map", () => {
    for (const p of SCENERY) {
      const r = propBounds(p);
      expect(r.x).toBeGreaterThanOrEqual(-TILE);
      expect(r.y).toBeGreaterThanOrEqual(-TILE);
      expect(r.x + r.width).toBeLessThanOrEqual(WORLD_WIDTH + TILE);
      expect(r.y + r.height).toBeLessThanOrEqual(WORLD_HEIGHT + TILE);
    }
  });

  it("keep their feet off the doors, the spawn points and the buildings", () => {
    const keepClear = [
      ...BUILDINGS.map((b) => b.door),
      ...BUILDINGS.map((b) => b.solid),
      ...BUILDINGS.map((b) => ({
        x: b.outside.x - 24,
        y: b.outside.y - 48,
        width: 48,
        height: 60,
      })),
      { x: WORLD_SPAWN.x - 24, y: WORLD_SPAWN.y - 48, width: 48, height: 60 },
    ];
    for (const p of SCENERY) {
      const body = propBody(p);
      if (!body) continue;
      for (const zone of keepClear)
        expect(overlaps(body, zone), `${p.kind} at ${p.x},${p.y}`).toBe(false);
    }
  });

  it("do not stand on each other", () => {
    const bodies = SCENERY.map((p) => ({ p, body: propBody(p) })).filter((b) => b.body);
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++)
        expect(
          overlaps(bodies[i].body!, bodies[j].body!),
          `${bodies[i].p.kind} and ${bodies[j].p.kind}`,
        ).toBe(false);
  });

  it("leave every door reachable from the spawn", () => {
    expect(everyDoorReachable()).toBe(true);
  });
});
