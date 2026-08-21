import { describe, it, expect, beforeEach } from "vitest";
import { RoomStore } from "../room-store";

/**
 * The roster the agent bridge delegates to is derived from the room store.
 * These pin the behaviour that used to break: each browser pushed its own view
 * of the seats, so whichever client wrote last won — and a tab whose scene had
 * not populated seats yet published an empty roster, silently removing the main
 * agent's ability to delegate until something re-synced.
 */

const ROOM = "roster-room";

function roster(store: RoomStore, room = ROOM) {
  const seats = store.getSnapshot(room).seats as Array<{
    seatId?: string;
    label?: string;
    roleTitle?: string;
    assigned?: boolean;
  }>;
  return seats
    .filter((seat) => seat.assigned && seat.seatId && seat.label)
    .map((seat) => ({ seatId: seat.seatId!, label: seat.label!, roleTitle: seat.roleTitle }));
}

let store: RoomStore;

beforeEach(() => {
  store = new RoomStore(":memory:");
});

function staff(seatId: string, label: string) {
  store.upsertSeat(ROOM, { seatId, label, roleTitle: "Worker", assigned: true });
}

describe("worker roster", () => {
  it("lists the staffed seats", () => {
    staff("seat-0", "Alice");
    staff("seat-1", "Bob");

    expect(roster(store).map((w) => w.label)).toEqual(["Alice", "Bob"]);
  });

  it("leaves out seats nobody is sitting in", () => {
    staff("seat-0", "Alice");
    store.upsertSeat(ROOM, { seatId: "seat-5", label: "Seat 6", assigned: false });

    expect(roster(store).map((w) => w.label)).toEqual(["Alice"]);
  });

  it("survives a second client that knows about fewer seats", () => {
    // The regression: this used to replace the roster wholesale
    staff("seat-0", "Alice");
    staff("seat-1", "Bob");
    staff("seat-2", "Carol");

    // A tab whose scene has not populated seats yet writes nothing at all,
    // because there is no per-client push any more
    expect(roster(store)).toHaveLength(3);
  });

  it("keeps delegation available while seats are being edited", () => {
    staff("seat-0", "Alice");
    staff("seat-1", "Bob");

    // Renaming one seat must not momentarily empty the roster, which is what
    // stripped the dispatch tool mid-run
    store.upsertSeat(ROOM, { seatId: "seat-0", label: "Alicia", roleTitle: "QA", assigned: true });

    const current = roster(store);
    expect(current).toHaveLength(2);
    expect(current.map((w) => w.label).sort()).toEqual(["Alicia", "Bob"]);
  });

  it("reflects a seat being vacated", () => {
    staff("seat-0", "Alice");
    staff("seat-1", "Bob");
    store.upsertSeat(ROOM, { seatId: "seat-1", label: "Bob", assigned: false });

    expect(roster(store).map((w) => w.label)).toEqual(["Alice"]);
  });

  it("keeps one room's roster out of another's", () => {
    staff("seat-0", "Alice");
    store.upsertSeat("other-room", { seatId: "seat-0", label: "Stranger", assigned: true });

    expect(roster(store).map((w) => w.label)).toEqual(["Alice"]);
    expect(roster(store, "other-room").map((w) => w.label)).toEqual(["Stranger"]);
  });
});
