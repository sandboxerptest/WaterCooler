import { describe, expect, it } from "vitest";
import {
  DOCKS,
  PAVED,
  SCENERY,
  WORLD_SIGNS,
  everyDoorReachable,
  groundTiles,
  propBody,
  propBounds,
  signBody,
  worldWater,
} from "./scenery";
import {
  BUILDINGS,
  DOCK,
  SHORE_ROW,
  TILE,
  WORLD_COLUMNS,
  WORLD_HEIGHT,
  WORLD_ROWS,
  WORLD_SPAWN,
  WORLD_WIDTH,
  buildingFrom,
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
        if (tiles[y][x] === "asphalt") continue;
        const underBuilding = BUILDINGS.some(
          (b) =>
            x * TILE >= b.frame.x &&
            x * TILE < b.frame.x + b.frame.width &&
            (y - 1) * TILE < b.frame.y + b.frame.height &&
            (y - 1) * TILE >= b.frame.y,
        );
        if (tiles[y][x] === "paving" && !underBuilding && tiles[y - 1][x] !== "asphalt")
          expect(tiles[y - 1][x]).not.toBe("grass");
      }
  });

  it("runs a path from every door down to the promenade, without a kerb at the door", () => {
    for (const b of BUILDINGS) {
      const col = Math.floor((b.door.x + b.door.width / 2) / TILE);
      // The door zone straddles the building's last row and the path's first.
      const from = Math.floor((b.door.y + b.door.height - 1) / TILE);
      if (b.art === "world-boat") {
        // The ferry is boarded from the dock, not a path.
        expect(tiles[from][col]).toBe("dock");
        continue;
      }
      expect(tiles[from][col], `${b.org.slug} door`).toBe("paving");
      for (let y = from; y < 18; y++) expect(tiles[y][col]).not.toBe("grass");
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

  it("stay off the walkways, apart from the benches and the fountain", () => {
    const paving = [...PAVED, ...DOCKS].map((r) => ({
      x: r.x * TILE,
      y: r.y * TILE,
      width: r.width * TILE,
      height: r.height * TILE,
    }));
    for (const p of SCENERY) {
      if (p.kind === "bench" || p.kind === "fountain") continue;
      const body = propBody(p);
      if (!body) continue;
      for (const tile of paving) {
        expect(overlaps(body, tile), `${p.kind} at ${p.x},${p.y} on the walkway`).toBe(false);
      }
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

describe("the shore", () => {
  const tiles = groundTiles();
  const ferry = buildingFrom("apeiron-media")!;

  it("is sea from the shore row down, except for the dock", () => {
    for (let y = SHORE_ROW; y < WORLD_ROWS; y++)
      for (let x = 0; x < WORLD_COLUMNS; x++) {
        const onDock = x >= DOCK.x && x < DOCK.x + DOCK.width && y < DOCK.y + DOCK.height;
        expect(tiles[y][x], `${x},${y}`).toBe(onDock ? "dock" : "water");
      }
    for (let x = 0; x < WORLD_COLUMNS; x++) expect(tiles[SHORE_ROW - 1][x]).not.toBe("water");
  });

  it("runs the dock from the south road out over the water", () => {
    expect(tiles[DOCK.y - 1][DOCK.x]).toBe("paving");
    for (let y = DOCK.y; y < DOCK.y + DOCK.height; y++)
      for (let x = DOCK.x; x < DOCK.x + DOCK.width; x++) expect(tiles[y][x]).toBe("dock");
  });

  it("moors the ferry beside the end of the dock, boarded from the dock", () => {
    expect(ferry.art).toBe("world-boat");
    expect(ferry.frame.x).toBe((DOCK.x + DOCK.width) * TILE);
    expect(ferry.entrance).toEqual({ kind: "campus", campus: "apeiron-media" });
    const doorCol = Math.floor((ferry.door.x + ferry.door.width / 2) / TILE);
    const doorRow = Math.floor((ferry.door.y + ferry.door.height - 1) / TILE);
    expect(tiles[doorRow][doorCol]).toBe("dock");
    expect(ferry.arrive).toBe("up");
    // Back on the dock at the shore, out of the boarding zone.
    expect(
      overlaps({ x: ferry.outside.x, y: ferry.outside.y, width: 1, height: 1 }, ferry.door),
    ).toBe(false);
  });

  it("keeps the sea solid everywhere but the dock", () => {
    const water = worldWater();
    expect(water.length).toBeGreaterThan(0);
    for (const body of water) {
      for (const dock of DOCKS)
        expect(
          overlaps(body, {
            x: dock.x * TILE,
            y: dock.y * TILE,
            width: dock.width * TILE,
            height: dock.height * TILE,
          }),
        ).toBe(false);
    }
  });

  it("puts the board at the head of the dock, clear of the planks", () => {
    expect(WORLD_SIGNS.some((s) => /IRELAND/.test(s.text))).toBe(true);
    for (const sign of WORLD_SIGNS)
      for (const dock of DOCKS)
        expect(
          overlaps(signBody(sign), {
            x: dock.x * TILE,
            y: dock.y * TILE,
            width: dock.width * TILE,
            height: dock.height * TILE,
          }),
        ).toBe(false);
  });
});
