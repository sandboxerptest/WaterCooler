import { describe, it, expect, beforeEach } from "vitest";
import { RoomStore, LIMITS } from "../room-store";

const ROOM = "test-room";

function task(id: string, extra: Record<string, unknown> = {}) {
  return {
    taskId: id,
    message: `do ${id}`,
    status: "queued",
    sessionKey: "main",
    createdAt: "2026-08-20T00:00:00.000Z",
    ...extra,
  };
}

function message(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    role: "assistant",
    content: `said ${id}`,
    timestamp: "2026-08-20T00:00:00.000Z",
    sessionKey: "main",
    ...extra,
  };
}

let store: RoomStore;
beforeEach(() => {
  store = new RoomStore(":memory:");
});

describe("snapshots", () => {
  it("returns an empty world for a room that has never been used", () => {
    expect(store.getSnapshot("brand-new")).toEqual({
      tasks: [],
      messages: [],
      sessions: [],
      seats: [],
      activeSessionKey: null,
    });
  });

  it("round-trips tasks, messages, sessions and seats", () => {
    store.replaceTasks(ROOM, [task("t1")]);
    store.replaceMessages(ROOM, [message("m1")]);
    store.replaceSessions(ROOM, [{ sessionKey: "main", title: "Main" }]);
    store.replaceSeats(ROOM, [{ seatId: "seat-0", label: "Alice", roleTitle: "QA" }]);

    const snapshot = store.getSnapshot(ROOM);
    expect(snapshot.tasks).toEqual([task("t1")]);
    expect(snapshot.messages).toEqual([message("m1")]);
    expect(snapshot.sessions).toEqual([{ sessionKey: "main", title: "Main" }]);
    expect(snapshot.seats).toEqual([{ seatId: "seat-0", label: "Alice", roleTitle: "QA" }]);
  });

  it("preserves the order the client sent", () => {
    // Order carries meaning: chat reads top to bottom and tasks are newest-first
    store.replaceMessages(
      ROOM,
      ["m1", "m2", "m3"].map((id) => message(id)),
    );
    const ids = store.getSnapshot(ROOM).messages.map((m) => (m as { id: string }).id);
    expect(ids).toEqual(["m1", "m2", "m3"]);
  });

  it("keeps rooms isolated from each other", () => {
    store.replaceTasks("room-a", [task("a1")]);
    store.replaceTasks("room-b", [task("b1")]);

    expect(store.getSnapshot("room-a").tasks).toEqual([task("a1")]);
    expect(store.getSnapshot("room-b").tasks).toEqual([task("b1")]);
  });
});

describe("replacement semantics", () => {
  it("replaces a slice rather than merging into it", () => {
    store.replaceTasks(ROOM, [task("t1"), task("t2")]);
    store.replaceTasks(ROOM, [task("t3")]);

    const ids = store.getSnapshot(ROOM).tasks.map((t) => (t as { taskId: string }).taskId);
    expect(ids).toEqual(["t3"]);
  });

  it("writing one slice leaves the others alone", () => {
    store.replaceTasks(ROOM, [task("t1")]);
    store.replaceMessages(ROOM, [message("m1")]);

    store.replaceTasks(ROOM, []);

    expect(store.getSnapshot(ROOM).tasks).toEqual([]);
    expect(store.getSnapshot(ROOM).messages).toHaveLength(1);
  });

  it("skips rows with no id instead of failing the whole write", () => {
    store.replaceTasks(ROOM, [task("t1"), { message: "no id here" }, task("t2")]);

    const ids = store.getSnapshot(ROOM).tasks.map((t) => (t as { taskId: string }).taskId);
    expect(ids).toEqual(["t1", "t2"]);
  });
});

describe("limits", () => {
  it("keeps the newest messages when over the cap", () => {
    const many = Array.from({ length: LIMITS.messages + 20 }, (_, i) => message(`m${i}`));
    store.replaceMessages(ROOM, many);

    const stored = store.getSnapshot(ROOM).messages;
    expect(stored).toHaveLength(LIMITS.messages);
    // Chat is trimmed from the front, so the last message must survive
    expect((stored[stored.length - 1] as { id: string }).id).toBe(`m${LIMITS.messages + 19}`);
  });

  it("keeps the first tasks when over the cap", () => {
    const many = Array.from({ length: LIMITS.tasks + 10 }, (_, i) => task(`t${i}`));
    store.replaceTasks(ROOM, many);

    const stored = store.getSnapshot(ROOM).tasks;
    expect(stored).toHaveLength(LIMITS.tasks);
    // Tasks arrive newest-first, so the head is what matters
    expect((stored[0] as { taskId: string }).taskId).toBe("t0");
  });

  it("caps sessions", () => {
    const many = Array.from({ length: LIMITS.sessions + 5 }, (_, i) => ({ sessionKey: `s${i}` }));
    store.replaceSessions(ROOM, many);
    expect(store.getSnapshot(ROOM).sessions).toHaveLength(LIMITS.sessions);
  });
});

describe("active session key", () => {
  it("round-trips and can be cleared", () => {
    store.setActiveSessionKey(ROOM, "agent:main:main");
    expect(store.getSnapshot(ROOM).activeSessionKey).toBe("agent:main:main");

    store.setActiveSessionKey(ROOM, null);
    expect(store.getSnapshot(ROOM).activeSessionKey).toBeNull();
  });
});

describe("attribution", () => {
  it("records who asked for a task, defaulting to the local player", () => {
    store.replaceTasks(ROOM, [task("t1"), task("t2", { requestedBy: "player-7" })]);

    // Attribution lives in a column so a shared room can say who asked for what,
    // while the client object is stored verbatim.
    const stored = store.getSnapshot(ROOM).tasks as Record<string, unknown>[];
    expect(stored[1].requestedBy).toBe("player-7");
    expect(stored[0].requestedBy).toBeUndefined();
  });
});
