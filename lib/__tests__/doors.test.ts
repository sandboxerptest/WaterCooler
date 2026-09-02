import { describe, it, expect } from "vitest";
import { anyoneNear, centreOf, DoorLatch, insideZone, type DoorZone } from "../doors";

const door: DoorZone = { name: "door", target: "lobby", x: 96, y: 0, width: 96, height: 48 };
const lift: DoorZone = {
  name: "elevator",
  target: "elevator",
  x: 1104,
  y: 912,
  width: 96,
  height: 48,
};

describe("door geometry", () => {
  it("measures proximity from the middle of the opening", () => {
    expect(centreOf(door)).toEqual({ x: 144, y: 24 });
  });

  it("opens for anyone close enough", () => {
    expect(anyoneNear(door, [{ x: 150, y: 40 }], 60)).toBe(true);
    expect(anyoneNear(door, [{ x: 400, y: 400 }], 60)).toBe(false);
  });

  it("opens for an agent, not only the player", () => {
    const player = { x: 900, y: 900 };
    const worker = { x: 140, y: 30 };
    expect(anyoneNear(door, [player, worker], 60)).toBe(true);
  });

  it("knows the doorway itself from the area around it", () => {
    expect(insideZone(door, { x: 100, y: 10 })).toBe(true);
    // Just outside the right edge — a rectangle is half-open, so width lands out.
    expect(insideZone(door, { x: 192, y: 10 })).toBe(false);
    expect(insideZone(door, { x: 150, y: 60 })).toBe(false);
  });
});

describe("DoorLatch", () => {
  it("reports an entry once, however long the player loiters", () => {
    const latch = new DoorLatch();
    expect(latch.step([door], { x: 100, y: 10 })).toEqual([door]);
    expect(latch.step([door], { x: 101, y: 11 })).toEqual([]);
    expect(latch.step([door], { x: 102, y: 12 })).toEqual([]);
  });

  it("re-arms once the player steps back out", () => {
    const latch = new DoorLatch();
    latch.step([door], { x: 100, y: 10 });
    latch.step([door], { x: 300, y: 300 });
    expect(latch.step([door], { x: 100, y: 10 })).toEqual([door]);
  });

  it("does not fire for a player who never entered", () => {
    const latch = new DoorLatch();
    expect(latch.step([door, lift], { x: 600, y: 400 })).toEqual([]);
  });

  it("tracks each doorway separately", () => {
    const latch = new DoorLatch();
    expect(latch.step([door, lift], { x: 100, y: 10 })).toEqual([door]);
    // Walking to the lift enters it and releases the door in the same step.
    expect(latch.step([door, lift], { x: 1110, y: 920 })).toEqual([lift]);
    expect(latch.step([door, lift], { x: 100, y: 10 })).toEqual([door]);
  });

  it("fires again after a reset, so returning to a room works", () => {
    const latch = new DoorLatch();
    latch.step([lift], { x: 1110, y: 920 });
    latch.reset();
    expect(latch.step([lift], { x: 1110, y: 920 })).toEqual([lift]);
  });
});
