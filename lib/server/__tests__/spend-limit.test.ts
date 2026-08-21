import { describe, it, expect, beforeEach } from "vitest";
import { RoomStore, ROOM_SPEND_LIMIT_USD } from "../room-store";

const ROOM = "budget-room";
let store: RoomStore;

beforeEach(() => {
  store = new RoomStore(":memory:");
});

describe("spend ledger", () => {
  it("starts a room at nothing spent", () => {
    expect(store.getSpend(ROOM)).toBe(0);
    expect(store.isOverBudget(ROOM)).toBe(false);
  });

  it("accumulates what runs cost", () => {
    store.addSpend(ROOM, 0.12);
    store.addSpend(ROOM, 0.08);
    expect(store.getSpend(ROOM)).toBeCloseTo(0.2, 5);
  });

  it("defaults the ceiling to fifty dollars", () => {
    expect(ROOM_SPEND_LIMIT_USD).toBe(50);
  });

  it("halts the room once the ceiling is reached", () => {
    store.addSpend(ROOM, ROOM_SPEND_LIMIT_USD - 0.01);
    expect(store.isOverBudget(ROOM)).toBe(false);

    store.addSpend(ROOM, 0.02);
    expect(store.isOverBudget(ROOM)).toBe(true);
  });

  it("ignores nonsense costs rather than corrupting the total", () => {
    store.addSpend(ROOM, 1);
    store.addSpend(ROOM, NaN);
    store.addSpend(ROOM, -5);
    store.addSpend(ROOM, Infinity);
    expect(store.getSpend(ROOM)).toBe(1);
  });

  it("bills each room separately", () => {
    store.addSpend("room-a", 3);
    store.addSpend("room-b", 1);
    expect(store.getSpend("room-a")).toBe(3);
    expect(store.getSpend("room-b")).toBe(1);
  });

  it("keeps spend across a reopen of the same database", () => {
    // The ceiling is worthless if a restart resets the meter
    const path = `${process.env.TMPDIR ?? "/tmp"}/watercooler-spend-${Date.now()}.sqlite`;
    const first = new RoomStore(path);
    first.addSpend(ROOM, 4.5);

    const second = new RoomStore(path);
    expect(second.getSpend(ROOM)).toBeCloseTo(4.5, 5);
  });
});
