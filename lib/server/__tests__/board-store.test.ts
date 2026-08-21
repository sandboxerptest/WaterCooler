import { describe, it, expect, beforeEach } from "vitest";
import { RoomStore } from "../room-store";

let store: RoomStore;
beforeEach(() => {
  store = new RoomStore(":memory:");
});

const stroke = (id: string) => ({ id, tool: "pen", color: "#fff", width: 3, points: [0, 0, 1, 1] });

describe("the board", () => {
  it("starts empty", () => {
    expect(store.listStrokes("room-a")).toEqual([]);
  });

  it("keeps strokes in the order they were drawn", () => {
    for (const id of ["a", "b", "c"]) store.addStroke("room-a", id, stroke(id));
    expect(store.listStrokes("room-a").map((s) => (s as { id: string }).id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("ignores a stroke sent twice", () => {
    store.addStroke("room-a", "a", stroke("a"));
    store.addStroke("room-a", "a", stroke("a"));
    expect(store.listStrokes("room-a")).toHaveLength(1);
  });

  it("gives each room its own board", () => {
    store.addStroke("room-a", "a", stroke("a"));
    store.addStroke("room-b", "b", stroke("b"));
    expect(store.listStrokes("room-a")).toHaveLength(1);
    expect(store.listStrokes("room-b").map((s) => (s as { id: string }).id)).toEqual(["b"]);
  });

  it("clears one room without touching another", () => {
    store.addStroke("room-a", "a", stroke("a"));
    store.addStroke("room-b", "b", stroke("b"));
    store.clearBoard("room-a");
    expect(store.listStrokes("room-a")).toEqual([]);
    expect(store.listStrokes("room-b")).toHaveLength(1);
  });

  it("drops the oldest marks once the board is full", () => {
    for (let i = 0; i < 2050; i++) store.addStroke("room-a", `s${i}`, stroke(`s${i}`));
    const ids = store.listStrokes("room-a").map((s) => (s as { id: string }).id);
    expect(ids).toHaveLength(2000);
    expect(ids).not.toContain("s0");
    expect(ids.at(-1)).toBe("s2049");
  });

  it("survives reopening the database", () => {
    const path = `${process.env.TMPDIR ?? "/tmp"}/watercooler-board-${Date.now()}.sqlite`;
    new RoomStore(path).addStroke("room-a", "a", stroke("a"));
    expect(new RoomStore(path).listStrokes("room-a")).toHaveLength(1);
  });
});
