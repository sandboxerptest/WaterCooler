import { describe, it, expect } from "vitest";
import { RoomStore } from "../room-store";
import { ACTIVITY_LIMIT } from "../../activity";

const store = () => new RoomStore(":memory:");
const line = (text: string) => ({ kind: "task" as const, actor: "Alice", text });

describe("the room's activity log", () => {
  it("starts empty", () => {
    expect(store().listActivity("demo")).toEqual([]);
  });

  it("reads oldest first, the way the day happened", () => {
    const room = store();
    for (const text of ["first", "second", "third"]) room.recordActivity("demo", line(text));
    expect(room.listActivity("demo").map((e) => e.text)).toEqual(["first", "second", "third"]);
  });

  it("hands back the entry it stored, with the id the panel keys off", () => {
    const room = store();
    const saved = room.recordActivity("demo", {
      kind: "agent",
      actor: "Bo",
      text: "answered",
      detail: "2.1s · $0.0400",
    });
    expect(saved).toMatchObject({ id: 1, kind: "agent", actor: "Bo", detail: "2.1s · $0.0400" });
    expect(Date.parse(saved.at)).not.toBeNaN();
  });

  it("gives every entry its own id, so the live feed can spot a repeat", () => {
    const room = store();
    const ids = ["a", "b", "c"].map((t) => room.recordActivity("demo", line(t)).id);
    expect(new Set(ids).size).toBe(3);
  });

  it("keeps each room's log to itself", () => {
    const room = store();
    room.recordActivity("kitchen", line("kettle on"));
    expect(room.listActivity("garden")).toEqual([]);
  });

  it("drops the oldest lines rather than growing without end", () => {
    const room = store();
    for (let i = 0; i < ACTIVITY_LIMIT + 40; i++) room.recordActivity("demo", line(`line ${i}`));

    const log = room.listActivity("demo");
    expect(log).toHaveLength(ACTIVITY_LIMIT);
    expect(log[0].text).toBe("line 40"); // the first forty fell off the end
    expect(log[log.length - 1].text).toBe(`line ${ACTIVITY_LIMIT + 39}`);
  });

  it("trims a runaway line rather than storing a wall of text", () => {
    const room = store();
    const saved = room.recordActivity("demo", {
      kind: "task",
      actor: "A".repeat(80),
      text: "B".repeat(900),
    });
    expect(saved.actor.length).toBeLessThanOrEqual(80);
    expect(room.listActivity("demo")[0].text.length).toBeLessThanOrEqual(400);
  });

  it("survives being asked for a room that has never been used", () => {
    expect(() => store().listActivity("brand-new")).not.toThrow();
  });
});
