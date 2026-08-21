import { describe, it, expect, beforeEach, vi } from "vitest";
import { ACHIEVEMENTS, achievementFor } from "../../achievements";
import { RoomStore } from "../room-store";

const ROOM = "badge-room";
let store: RoomStore;

vi.mock("../room-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../room-store")>();
  return { ...actual, getRoomStore: () => store };
});

const rules = await import("../achievement-rules");

beforeEach(() => {
  store = new RoomStore(":memory:");
});

function finishTask(seatId: string, taskId: string) {
  store.upsertTask(ROOM, { taskId, seatId, status: "completed", message: "done" });
}

describe("agent badges", () => {
  it("gives First Words for a first completed task, once", () => {
    finishTask("seat-0", "t1");
    const first = rules.onRunCompleted({
      room: ROOM,
      seatId: "seat-0",
      seatLabel: "Alice",
      durationMs: 1000,
      dispatched: false,
      humansPresent: 1,
    });
    expect(first.map((a) => a.code)).toContain("first-words");

    finishTask("seat-0", "t2");
    const second = rules.onRunCompleted({
      room: ROOM,
      seatId: "seat-0",
      seatLabel: "Alice",
      durationMs: 1000,
      dispatched: false,
      humansPresent: 1,
    });
    expect(second.map((a) => a.code)).not.toContain("first-words");
  });

  it("gives Night Shift only when nobody is watching", () => {
    finishTask("seat-1", "t1");
    const watched = rules.onRunCompleted({
      room: ROOM,
      seatId: "seat-1",
      seatLabel: "Bob",
      durationMs: 10,
      dispatched: false,
      humansPresent: 2,
    });
    expect(watched.map((a) => a.code)).not.toContain("night-shift");

    const alone = rules.onRunCompleted({
      room: ROOM,
      seatId: "seat-1",
      seatLabel: "Bob",
      durationMs: 10,
      dispatched: false,
      humansPresent: 0,
    });
    expect(alone.map((a) => a.code)).toContain("night-shift");
  });

  it("gives Marathon past two minutes", () => {
    finishTask("seat-2", "t1");
    const quick = rules.onRunCompleted({
      room: ROOM,
      seatId: "seat-2",
      seatLabel: "Carol",
      durationMs: 119_000,
      dispatched: false,
      humansPresent: 1,
    });
    expect(quick.map((a) => a.code)).not.toContain("marathon");

    const long = rules.onRunCompleted({
      room: ROOM,
      seatId: "seat-2",
      seatLabel: "Carol",
      durationMs: 121_000,
      dispatched: false,
      humansPresent: 1,
    });
    expect(long.map((a) => a.code)).toContain("marathon");
  });

  it("gives Frugal under a penny but not for a free run", () => {
    finishTask("seat-3", "t1");
    const cheap = rules.onRunCompleted({
      room: ROOM,
      seatId: "seat-3",
      seatLabel: "Dave",
      durationMs: 10,
      costUsd: 0.004,
      dispatched: false,
      humansPresent: 1,
    });
    expect(cheap.map((a) => a.code)).toContain("frugal");

    // A zero-cost run means the provider reported nothing, not thrift
    store = new RoomStore(":memory:");
    finishTask("seat-3", "t1");
    const free = rules.onRunCompleted({
      room: ROOM,
      seatId: "seat-3",
      seatLabel: "Dave",
      durationMs: 10,
      costUsd: 0,
      dispatched: false,
      humansPresent: 1,
    });
    expect(free.map((a) => a.code)).not.toContain("frugal");
  });

  it("gives Sub-contractor only for work handed down by another agent", () => {
    finishTask("seat-4", "t1");
    const delegated = rules.onRunCompleted({
      room: ROOM,
      seatId: "seat-4",
      seatLabel: "Eve",
      durationMs: 10,
      dispatched: true,
      humansPresent: 1,
    });
    expect(delegated.map((a) => a.code)).toContain("sub-contractor");
  });
});

describe("human badges", () => {
  it("gives Walked In once, however many times you return", () => {
    expect(rules.onPlayerJoined(ROOM, "Robert").map((a) => a.code)).toEqual(["walked-in"]);
    expect(rules.onPlayerJoined(ROOM, "Robert")).toEqual([]);
  });

  it("gives Icebreaker only to the first person to speak", () => {
    expect(rules.onPlayerSpoke(ROOM, "Robert", "room", true).map((a) => a.code)).toContain(
      "icebreaker",
    );
    expect(rules.onPlayerSpoke(ROOM, "Priya", "room", false).map((a) => a.code)).not.toContain(
      "icebreaker",
    );
  });

  it("gives Whisperer for talking to people nearby", () => {
    expect(rules.onPlayerSpoke(ROOM, "Robert", "nearby", false).map((a) => a.code)).toEqual([
      "whisperer",
    ]);
  });

  it("gives Full House to everyone present", () => {
    const earned = rules.onRoomFull(ROOM, ["Ann", "Ben", "Cara", "Dan"]);
    expect(earned.map((a) => a.subjectName).sort()).toEqual(["Ann", "Ben", "Cara", "Dan"]);
  });

  it("gives Foreman only after covering every staffed seat", () => {
    for (const seatId of ["seat-0", "seat-1"]) {
      store.upsertSeat(ROOM, { seatId, label: seatId, assigned: true });
    }
    store.upsertTask(ROOM, { taskId: "t1", seatId: "seat-0", requestedByName: "Robert" });
    expect(rules.onTaskAssigned(ROOM, "Robert")).toEqual([]);

    store.upsertTask(ROOM, { taskId: "t2", seatId: "seat-1", requestedByName: "Robert" });
    expect(rules.onTaskAssigned(ROOM, "Robert").map((a) => a.code)).toContain("foreman");
  });

  it("does not give Foreman in a one-seat room, which would be trivial", () => {
    store.upsertSeat(ROOM, { seatId: "seat-0", label: "Solo", assigned: true });
    store.upsertTask(ROOM, { taskId: "t1", seatId: "seat-0", requestedByName: "Robert" });
    expect(rules.onTaskAssigned(ROOM, "Robert")).toEqual([]);
  });
});

describe("the catalogue", () => {
  it("rewards no badge for sheer volume", () => {
    // The room pays per task, so a "do 100 tasks" badge would spend the budget
    // to earn itself. Every entry must key on variety, timing or craft.
    const volumeWords = /\b(100|50|ten|hundred|many|most tasks|volume)\b/i;
    const offenders = ACHIEVEMENTS.filter((a) => volumeWords.test(a.description));
    expect(offenders.map((a) => a.code)).toEqual([]);
  });

  it("has unique codes and resolves them", () => {
    const codes = ACHIEVEMENTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(achievementFor(code)?.code).toBe(code);
  });
});
