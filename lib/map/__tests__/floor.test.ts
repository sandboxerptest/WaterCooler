import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildFloorSpec, HEIGHT, PLAYER_START, WIDTH } from "../floor";
import { STANDABLE } from "../office";
import { generateMap, paintShell, wallCollisions } from "../generate";
import type { SourceMap } from "../harvest";
import { DESK_SLOTS, deskBox, standingSpot } from "../../world/desks";

const source = JSON.parse(
  readFileSync(join(process.cwd(), "public/maps/office2.json"), "utf8"),
) as SourceMap & { tilesets: [] };

const spec = buildFloorSpec(source);
const map = generateMap(spec, []);
const objects = (name: string) => {
  const l = map.layers.find((x) => x.name === name);
  if (!l || l.type !== "objectgroup") throw new Error(`no object layer ${name}`);
  return l.objects;
};

describe("a floor", () => {
  it("is a room with the same layers as the lobby", () => {
    expect(map.width).toBe(WIDTH);
    expect(map.height).toBe(HEIGHT);
    for (const name of ["floor", "walls", "ground", "furniture", "objects", "overhead"]) {
      expect(map.layers.find((x) => x.name === name)?.type).toBe("tilelayer");
    }
  });

  it("has the whiteboard on the wall, with its point in reach of the floor", () => {
    const board = objects("pois").find((o) => /whiteboard/i.test(o.name))!;
    expect(board).toBeDefined();
    expect(board.y).toBeLessThan(3 * 48);
  });

  it("has a lift and no door", () => {
    const transitions = objects("transitions");
    expect(transitions.map((t) => t.name)).toEqual(["elevator"]);
    expect(transitions[0].y! + transitions[0].height!).toBe(HEIGHT * 48);
  });

  it("stands the person on the floor, not in a wall", () => {
    const shell = paintShell(spec);
    expect(STANDABLE).toContain(shell[PLAYER_START.ty * WIDTH + PLAYER_START.tx]);
  });

  it("has room for every desk, off the walls, clear of the lift and the spawn", () => {
    const walls = wallCollisions(spec);
    const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    const lift = objects("transitions")[0];
    const liftBox = { x: lift.x!, y: lift.y!, width: lift.width!, height: lift.height! };
    DESK_SLOTS.forEach((_, i) => {
      const box = deskBox(i);
      for (const wall of walls) expect(overlaps(box, wall), `desk ${i} in a wall`).toBe(false);
      expect(overlaps(box, liftBox), `desk ${i} in the lift`).toBe(false);
      const spot = standingSpot(i);
      expect(spot.x).toBeGreaterThan(48);
      expect(spot.y).toBeLessThan((HEIGHT - 1) * 48);
      for (const wall of walls) {
        const inside =
          spot.x >= wall.x &&
          spot.x < wall.x + wall.width &&
          spot.y >= wall.y &&
          spot.y < wall.y + wall.height;
        expect(inside, `spot ${i} in a wall`).toBe(false);
      }
    });
  });
});
