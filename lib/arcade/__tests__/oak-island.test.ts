import { describe, expect, it } from "vitest";
import { NO_INPUT, type ArcadeInput } from "../types";
import {
  DAN_TILE,
  ENEMIES,
  MAX_HP,
  act,
  createOakIsland,
  enterRoom,
  facingTile,
  findTile,
  has,
  score,
  stepOakIsland,
  type OakState,
} from "../oak-island/game";
import { COLS, LEGEND, ROOMS, ROWS, TILE } from "../oak-island/world";

const press: ArcadeInput = { ...NO_INPUT, actionPressed: true, action: true };
const calm = () => 0.5;

/** Past the title and the opening words. */
function begin(): OakState {
  const s = createOakIsland(calm);
  stepOakIsland(s, press, 1 / 60);
  while (s.dialog.length) stepOakIsland(s, press, 1 / 60);
  return s;
}

function standAt(s: OakState, room: string, tx: number, ty: number) {
  enterRoom(s, room, tx * TILE + TILE / 2, ty * TILE + TILE / 2);
  s.enemies = [];
}

describe("the island", () => {
  it("is drawn in whole screens of known tiles, joined at their edges", () => {
    for (const room of Object.values(ROOMS)) {
      expect(room.rows, room.id).toHaveLength(ROWS);
      for (const row of room.rows) {
        expect(row, room.id).toHaveLength(COLS);
        for (const ch of row) expect(LEGEND[ch], `${room.id} "${ch}"`).toBeDefined();
      }
      for (const [edge, other] of Object.entries(room.exits)) {
        expect(ROOMS[other], `${room.id} ${edge}`).toBeDefined();
      }
      if (room.ladderDownTo) expect(findTile(ROOMS[room.ladderDownTo], "ladderUp")).not.toBeNull();
    }
    expect(findTile(ROOMS.shaft150, "vault")).not.toBeNull();
    expect(findTile(ROOMS.cove, "dig")).not.toBeNull();
    expect(findTile(ROOMS.swamp, "cache")).not.toBeNull();
    expect(findTile(ROOMS.lot8, "chest")).not.toBeNull();
    expect(findTile(ROOMS.shaft90, "sign")).not.toBeNull();
  });
});

describe("a hunter", () => {
  it("has a way back for every way out, and returns home by it from every row and column", () => {
    const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" } as const;
    type Edge = keyof typeof OPPOSITE;
    for (const room of Object.values(ROOMS)) {
      for (const [edge, other] of Object.entries(room.exits) as [Edge, string][]) {
        expect(ROOMS[other].exits[OPPOSITE[edge]], `${other} back to ${room.id}`).toBe(room.id);
      }
    }
    const s = begin();
    s.items.push("fibre");
    let crossings = 0;
    for (const room of Object.values(ROOMS)) {
      for (const [edge, other] of Object.entries(room.exits) as [Edge, string][]) {
        const along = edge === "up" || edge === "down" ? COLS : ROWS;
        for (let i = 0; i < along; i++) {
          const x = edge === "left" ? 2 : edge === "right" ? COLS * TILE - 2 : i * TILE + TILE / 2;
          const y = edge === "up" ? 2 : edge === "down" ? ROWS * TILE - 2 : i * TILE + TILE / 2;
          enterRoom(s, room.id, x, y);
          s.enemies = [];
          s.dialog = [];
          // Only an open tile at the edge is a way out; a tree there is just a tree.
          stepOakIsland(s, { ...NO_INPUT, [edge]: true }, 1 / 60);
          if (s.room !== other) continue;
          crossings += 1;
          s.enemies = [];
          s.dialog = [];
          // Turn round: a few steps back the way we came must land us home.
          let home = false;
          for (let step = 0; step < 90 && !home; step++) {
            stepOakIsland(s, { ...NO_INPUT, [OPPOSITE[edge]]: true }, 1 / 60);
            s.dialog = [];
            if (s.room === room.id) home = true;
          }
          expect(home, `${room.id} ${edge} at ${i} → ${other} and back`).toBe(true);
        }
      }
    }
    expect(crossings).toBeGreaterThan(20);
  });

  it("never arrives inside a tree, whichever row or column it leaves by", () => {
    const s = begin();
    s.items.push("fibre");
    for (const room of Object.values(ROOMS)) {
      for (const [edge, other] of Object.entries(room.exits)) {
        for (let i = 0; i < (edge === "up" || edge === "down" ? COLS : ROWS); i++) {
          // Stand on the far side of the edge in the room being left, as if walked off it.
          const x = edge === "left" ? 2 : edge === "right" ? COLS * TILE - 2 : i * TILE + TILE / 2;
          const y = edge === "up" ? 2 : edge === "down" ? ROWS * TILE - 2 : i * TILE + TILE / 2;
          enterRoom(s, room.id, x, y);
          if (s.room !== room.id) continue;
          stepOakIsland(
            s,
            { ...NO_INPUT, [edge === "left" || edge === "right" ? edge : edge]: true },
            1 / 60,
          );
          if (s.room !== other) continue;
          // Wherever it landed, it can take a step in some direction.
          const before = { x: s.x, y: s.y };
          let moved = false;
          for (const dir of ["up", "down", "left", "right"] as const) {
            const probe = { ...NO_INPUT, [dir]: true };
            const px = s.x;
            const py = s.y;
            stepOakIsland(s, probe, 1 / 30);
            if (s.room !== other || s.x !== px || s.y !== py) moved = true;
            s.x = before.x;
            s.y = before.y;
            s.room = other;
            s.dialog = [];
            if (moved) break;
          }
          expect(moved, `${room.id} ${edge} at ${i}`).toBe(true);
        }
      }
    }
  });

  it("starts at the title, reads the opening, then stands on the causeway", () => {
    const s = createOakIsland(calm);
    expect(s.title).toBe(true);
    stepOakIsland(s, NO_INPUT, 1);
    expect(s.title).toBe(true);
    const begun = begin();
    expect(begun.title).toBe(false);
    expect(begun.dialog).toEqual([]);
    expect(begun.room).toBe("landing");
    expect(begun.hp).toBe(MAX_HP);
  });

  it("walks, and is stopped by the sea", () => {
    const s = begin();
    const before = s.y;
    stepOakIsland(s, { ...NO_INPUT, down: true }, 0.5);
    expect(s.y).toBeGreaterThan(before);
    expect(s.facing).toBe("down");
    // Off the causeway, the shore is water: walking up stops at it.
    standAt(s, "landing", 3, 5);
    for (let i = 0; i < 60; i++) stepOakIsland(s, { ...NO_INPUT, up: true }, 1 / 60);
    expect(s.y).toBeGreaterThan(4 * TILE - 1);
    expect(s.y).toBeLessThan(5 * TILE);
  });

  it("gets the shovel from Dan, once", () => {
    const s = begin();
    standAt(s, "landing", DAN_TILE.tx - 1, DAN_TILE.ty);
    expect(has(s, "shovel")).toBe(false);
    act(s);
    expect(has(s, "shovel")).toBe(true);
    expect(s.dialog.length).toBeGreaterThan(0);
    s.dialog = [];
    act(s);
    expect(s.dialog[0]).toMatch(/fibre/i);
  });

  it("digs the fibre out of the cove with the shovel, not without", () => {
    const s = begin();
    const spot = findTile(ROOMS.cove, "dig")!;
    standAt(s, "cove", spot.x / TILE - 0.5, spot.y / TILE + 0.5);
    s.facing = "up";
    expect(facingTile(s).tile).toBe("dig");
    act(s);
    expect(has(s, "fibre")).toBe(false);
    s.dialog = [];
    s.items.push("shovel");
    act(s);
    expect(has(s, "fibre")).toBe(true);
  });

  it("cannot wade into the flooded pit until the fibre is found", () => {
    const s = begin();
    standAt(s, "pit", 7, 5);
    for (let i = 0; i < 120; i++) stepOakIsland(s, { ...NO_INPUT, down: true }, 1 / 60);
    expect(s.room).toBe("pit");
    expect(s.y).toBeLessThan(7 * TILE);
    expect(s.dialog[0]).toMatch(/seawater/);
    s.dialog = [];
    s.items.push("fibre");
    for (let i = 0; i < 200 && s.room === "pit"; i++) {
      stepOakIsland(s, { ...NO_INPUT, down: true }, 1 / 60);
    }
    expect(s.room).toBe("shaft30");
  });

  it("climbs down every ladder and back up again, and stays where it lands", () => {
    const s = begin();
    s.items.push("fibre");
    const ladder = findTile(ROOMS.pit, "ladder")!;
    standAt(s, "pit", ladder.x / TILE - 0.5, ladder.y / TILE - 0.5);
    for (const [from, to] of [
      ["pit", "shaft30"],
      ["shaft30", "shaft90"],
      ["shaft90", "shaft150"],
    ]) {
      expect(s.room).toBe(from);
      stepOakIsland(s, NO_INPUT, 1 / 60);
      expect(s.room).toBe(to);
      for (let i = 0; i < 10; i++) stepOakIsland(s, NO_INPUT, 1 / 60);
      expect(s.room).toBe(to);
      s.enemies = [];
      const down = findTile(ROOMS[to], "ladderDown");
      if (down) {
        s.x = down.x;
        s.y = down.y;
        s.onLadder = false;
      }
    }
    for (const [from, to] of [
      ["shaft150", "shaft90"],
      ["shaft90", "shaft30"],
      ["shaft30", "pit"],
    ]) {
      const up = findTile(ROOMS[from], "ladderUp")!;
      s.x = up.x;
      s.y = up.y;
      s.onLadder = false;
      stepOakIsland(s, NO_INPUT, 1 / 60);
      expect(s.room).toBe(to);
      for (let i = 0; i < 10; i++) stepOakIsland(s, NO_INPUT, 1 / 60);
      expect(s.room).toBe(to);
      s.enemies = [];
    }
  });

  it("reads the 90-foot stone only by lantern light, and the vault wants cross and cipher", () => {
    const s = begin();
    const stone = findTile(ROOMS.shaft90, "sign")!;
    standAt(s, "shaft90", stone.x / TILE - 0.5, stone.y / TILE + 0.5);
    s.facing = "up";
    act(s);
    expect(has(s, "cipher")).toBe(false);
    s.dialog = [];
    s.items.push("lantern");
    act(s);
    expect(has(s, "cipher")).toBe(true);
    // The vault door is in the bottom wall; you face down at it from the floor above.
    const door = findTile(ROOMS.shaft150, "vault")!;
    standAt(s, "shaft150", door.x / TILE - 0.5, door.y / TILE - 1.5);
    s.facing = "down";
    expect(facingTile(s).tile).toBe("vault");
    s.dialog = [];
    act(s);
    expect(s.won).toBe(false);
    s.dialog = [];
    s.items.push("cross");
    act(s);
    expect(s.won).toBe(true);
    expect(s.over).toBe(true);
    expect(score(s)).toBeGreaterThanOrEqual(1000);
  });

  it("swings the shovel at a crab, and is bitten by what it misses", () => {
    const s = begin();
    s.items.push("shovel");
    standAt(s, "landing", 7, 10);
    s.facing = "right";
    s.enemies = [
      { kind: "crab", x: s.x + 16, y: s.y, hp: 1, hit: 0, kx: 0, ky: 0, wx: 0, wy: 0, wander: 9 },
    ];
    act(s);
    stepOakIsland(s, NO_INPUT, 1 / 60);
    expect(s.enemies).toHaveLength(0);
    expect(s.gold).toBe(ENEMIES.crab.gold);
    // A skeleton on top of the hunter takes a half heart, then a breath passes before the next.
    s.enemies = [
      { kind: "skeleton", x: s.x, y: s.y, hp: 2, hit: 0, kx: 0, ky: 0, wx: 0, wy: 0, wander: 9 },
    ];
    stepOakIsland(s, NO_INPUT, 1 / 60);
    expect(s.hp).toBe(MAX_HP - 1);
    stepOakIsland(s, NO_INPUT, 1 / 60);
    expect(s.hp).toBe(MAX_HP - 1);
  });

  it("is the seventh when the hearts run out", () => {
    const s = begin();
    standAt(s, "landing", 7, 10);
    s.hp = 1;
    s.enemies = [
      { kind: "ghost", x: s.x, y: s.y, hp: 2, hit: 0, kx: 0, ky: 0, wx: 0, wy: 0, wander: 0 },
    ];
    stepOakIsland(s, NO_INPUT, 1 / 60);
    expect(s.over).toBe(true);
    expect(s.won).toBe(false);
    expect(s.ending).toBe("The seventh");
  });
});
