import { describe, it, expect } from "vitest";
import { RoomStore, PINBALL_HIGH_SCORES } from "../room-store";

const store = () => new RoomStore(":memory:");

describe("the cauldron's high score table", () => {
  it("starts empty", () => {
    expect(store().topPinballScores("demo")).toEqual([]);
  });

  it("keeps the best three, best first", () => {
    const room = store();
    for (const [player, score] of [
      ["Ada", 1200],
      ["Bo", 400],
      ["Cy", 3100],
      ["Dee", 2000],
    ] as const) {
      room.recordPinballScore("demo", player, score);
    }

    const top = room.topPinballScores("demo");
    expect(top).toHaveLength(PINBALL_HIGH_SCORES);
    expect(top.map((s) => s.player)).toEqual(["Cy", "Dee", "Ada"]);
    expect(top[0].score).toBe(3100);
  });

  it("returns the table as it stands after a game, so the client need not ask twice", () => {
    const room = store();
    room.recordPinballScore("demo", "Ada", 500);
    expect(room.recordPinballScore("demo", "Bo", 900)[0]).toMatchObject({ player: "Bo" });
  });

  it("settles a tie in favour of whoever got there first", () => {
    const room = store();
    room.recordPinballScore("demo", "First", 1000);
    room.recordPinballScore("demo", "Second", 1000);
    expect(room.topPinballScores("demo").map((s) => s.player)).toEqual(["First", "Second"]);
  });

  it("keeps each room's table to itself", () => {
    const room = store();
    room.recordPinballScore("kitchen", "Ada", 5000);
    expect(room.topPinballScores("garden")).toEqual([]);
  });

  it("does not let a long name or a fractional score onto the board", () => {
    const room = store();
    const [entry] = room.recordPinballScore("demo", "A".repeat(40), 1234.7);
    expect(entry.player).toHaveLength(16);
    expect(entry.score).toBe(1235);
  });
});
