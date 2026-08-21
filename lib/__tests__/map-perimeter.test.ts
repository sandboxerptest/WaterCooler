import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { exteriorRects, findExterior, mergeRuns, type Rect } from "../map-perimeter";

const grid = (rows: string[]) => rows.map((row) => [...row].map((cell) => cell === "#"));

describe("finding the outside", () => {
  it("marks what can be reached from the edge of the map", () => {
    const floored = grid([".....", ".###.", ".#.#.", ".###.", "....."]);
    const outside = findExterior(floored);

    expect(outside[0][0]).toBe(true); // the corner of the map
    expect(outside[2][2]).toBe(false); // the hole in the middle of the building
    expect(outside[1][1]).toBe(false); // floor is never outside
  });

  it("leaves the gaps inside the building alone", () => {
    // Under walls and furniture there is no floor either, and those tiles
    // must stay walkable-adjacent: sealing them would wall off the rooms
    const floored = grid(["....", ".##.", ".##.", "...."]);
    const outside = findExterior(floored);
    expect(outside.flat().filter(Boolean)).toHaveLength(12);
  });

  it("finds its way through a gap in the wall, which is the whole point", () => {
    const floored = grid([
      ".....",
      ".###.",
      "..##.", // the hole: the outside reaches in here
      ".###.",
      ".....",
    ]);
    expect(findExterior(floored)[2][1]).toBe(true);
  });
});

describe("merging the outside into rectangles", () => {
  it("joins a row of tiles into one rectangle", () => {
    const rects = mergeRuns(grid(["####"]), 48);
    expect(rects).toEqual([{ x: 0, y: 0, width: 192, height: 48 }]);
  });

  it("breaks a row where the run stops", () => {
    expect(mergeRuns(grid(["##.#"]), 48)).toEqual([
      { x: 0, y: 0, width: 96, height: 48 },
      { x: 144, y: 0, width: 48, height: 48 },
    ]);
  });

  it("covers every tile it was given", () => {
    const tiles = grid(["#.##", ".###", "####"]);
    const covered = mergeRuns(tiles, 10).reduce(
      (total, r) => total + (r.width / 10) * (r.height / 10),
      0,
    );
    expect(covered).toBe(tiles.flat().filter(Boolean).length);
  });
});

/**
 * The real test: take the office as it ships and try to walk out of it.
 *
 * Four separate openings used to let you out — the left wall, the top-left
 * corner, the bottom-left, and a long stretch of the bottom wall — and once
 * out, the whole margin of the map was walkable.
 */
describe("the office as it ships", () => {
  const map = JSON.parse(readFileSync(join(process.cwd(), "public/maps/office2.json"), "utf8")) as {
    width: number;
    height: number;
    tilewidth: number;
    layers: Array<{ name: string; type: string; data?: number[]; objects?: Rect[] }>;
  };

  const layer = (name: string) => map.layers.find((l) => l.name === name);
  const floor = layer("floor")!.data!;
  const ground = layer("ground")!.data!;
  const tile = map.tilewidth;

  const floored = Array.from({ length: map.height }, (_, y) =>
    Array.from({ length: map.width }, (_, x) => {
      const index = y * map.width + x;
      return floor[index] !== 0 || ground[index] !== 0;
    }),
  );

  /** The walls someone drew in Tiled, which is what the office used to have. */
  const handPlacedWalls = (layer("collisions")!.objects as Rect[]).filter(
    (r) => r.width > 0 && r.height > 0,
  );
  /** Those, plus the sealed exterior. */
  const walls: Rect[] = [...handPlacedWalls, ...exteriorRects(floored, tile)];

  /** The player's body is a small box at their feet. */
  const HALF_W = 11;
  const HALF_H = 5;
  const FOOT = 14;
  const STEP = 4;

  const hasFloor = (x: number, y: number) => {
    const tx = Math.floor(x / tile);
    const ty = Math.floor((y + FOOT) / tile);
    return ty >= 0 && ty < map.height && tx >= 0 && tx < map.width && floored[ty][tx];
  };

  /** Walk everywhere the player can get to, and note any step off the floor. */
  const explore = (wallSet: Rect[]) => {
    const blockedBy = (x: number, y: number) => {
      const fx = x;
      const fy = y + FOOT;
      if (fx < HALF_W || fy < HALF_H) return true;
      if (fx > map.width * tile - HALF_W || fy > map.height * tile - HALF_H) return true;
      return wallSet.some(
        (r) =>
          fx > r.x - HALF_W &&
          fx < r.x + r.width + HALF_W &&
          fy > r.y - HALF_H &&
          fy < r.y + r.height + HALF_H,
      );
    };

    const start: [number, number] = [688, 752];
    const seen = new Set([start.join()]);
    const onFloor = new Set<string>();
    const queue: Array<[number, number]> = [start];
    const escapes: string[] = [];

    while (queue.length > 0) {
      const [x, y] = queue.pop()!;
      for (const [dx, dy] of [
        [STEP, 0],
        [-STEP, 0],
        [0, STEP],
        [0, -STEP],
      ]) {
        const next: [number, number] = [x + dx, y + dy];
        const key = next.join();
        if (seen.has(key) || blockedBy(...next)) continue;
        if (hasFloor(...next)) onFloor.add(key);
        else escapes.push(`(${next[0]}, ${next[1]})`);
        seen.add(key);
        queue.push(next);
      }
    }

    return { seen, onFloor, escapes };
  };

  it("cannot be walked out of, from any corner of it", () => {
    const { seen, escapes } = explore(walls);

    expect(escapes.slice(0, 5)).toEqual([]);
    expect(seen.size).toBeGreaterThan(10000); // and it is still an office
  });

  it("could be walked out of before, in four separate places", () => {
    // Without the seal the old openings are all still there — this is the bug
    // the seal exists for, kept as a test so the fix cannot quietly regress
    const { escapes } = explore(handPlacedWalls);
    expect(escapes.length).toBeGreaterThan(100);
  });

  it("seals nothing in: everything the office is for is still reachable", () => {
    // The seal does take walking room away — the ledge along the top of the
    // walls, which could only ever be got to by leaving the building. What it
    // must not touch is anywhere with a reason to go there.
    const { seen } = explore(walls);
    const positions = [...seen].map((spot) => spot.split(",").map(Number) as [number, number]);
    const canStandNear = (x: number, y: number, within = 56) =>
      positions.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < within);

    const pois = layer("pois")!.objects as unknown as Array<{ name: string; x: number; y: number }>;
    const unreachable = pois.filter((poi) => !canStandNear(poi.x, poi.y, 72)).map((p) => p.name);
    expect(unreachable).toEqual([]);

    const seats = layer("spawns")!.objects as unknown as Array<{ x: number; y: number }>;
    const strandedSeats = seats.filter((seat) => !canStandNear(seat.x, seat.y, 72));
    expect(strandedSeats).toEqual([]);
  });

  it("leaves both doorways clear", () => {
    const { seen } = explore(walls);
    for (const [x, y] of [
      [528, 560],
      [960, 560],
    ]) {
      const nearby = [...seen].some((spot) => {
        const [sx, sy] = spot.split(",").map(Number);
        return Math.abs(sx - x) < 40 && Math.abs(sy - y) < 40;
      });
      expect(nearby).toBe(true);
    }
  });
});
