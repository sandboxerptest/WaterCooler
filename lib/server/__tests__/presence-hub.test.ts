import { describe, it, expect, beforeEach } from "vitest";
import { PresenceHub, sanitiseName } from "../presence-hub";
import { IDLE_TIMEOUT_MS, MAX_HUMAN_PLAYERS, MOVE_SPEED_PX_S } from "../../presence-types";

let clock = 1_000_000;
let hub: PresenceHub;

const spawn = { spriteKey: "player", x: 100, y: 100, facing: "down" as const };

beforeEach(() => {
  clock = 1_000_000;
  hub = new PresenceHub({ now: () => clock });
});

function join(id: string, name = id) {
  return hub.join(id, { name, ...spawn });
}

describe("capacity", () => {
  it("defaults to four humans", () => {
    expect(hub.capacity).toBe(MAX_HUMAN_PLAYERS);
  });

  it("admits players up to the cap", () => {
    for (let i = 0; i < MAX_HUMAN_PLAYERS; i++) {
      expect(join(`p${i}`).ok).toBe(true);
    }
    expect(hub.count).toBe(MAX_HUMAN_PLAYERS);
  });

  it("turns away one human more than the cap, with the cap in the refusal", () => {
    for (let i = 0; i < MAX_HUMAN_PLAYERS; i++) join(`p${i}`);

    const result = join(`p${MAX_HUMAN_PLAYERS}`);
    expect(result).toEqual({ ok: false, reason: "full", capacity: MAX_HUMAN_PLAYERS });
    expect(hub.count).toBe(MAX_HUMAN_PLAYERS);
  });

  it("places a player where a scene says, however far that is from before", () => {
    join("p0");
    hub.move("p0", { x: 10, y: 10, facing: "down", moving: false });
    const placed = hub.place("p0", { x: 1400, y: 655, facing: "up" });
    expect(placed).toMatchObject({ x: 1400, y: 655, facing: "up", moving: false });
    expect(hub.snapshot().find((p) => p.id === "p0")).toMatchObject({ x: 1400, y: 655 });
    expect(hub.place("nobody", { x: 0, y: 0, facing: "down" })).toBeNull();
  });

  it("remembers whose microphone is on, and says so in the roster", () => {
    join("p0");
    join("p1");
    hub.setMic("p0", true);
    const roster = hub.snapshot();
    expect(roster.find((p) => p.id === "p0")?.mic).toBe(true);
    expect(roster.find((p) => p.id === "p1")?.mic).toBeUndefined();
    hub.setMic("p0", false);
    expect(hub.snapshot().find((p) => p.id === "p0")?.mic).toBeUndefined();
    hub.setMic("nobody", true);
  });

  it("takes a new look and name along with the place", () => {
    join("p0");
    hub.place("p0", { x: 5, y: 5, facing: "down", spriteKey: "character_coop", name: "  Coop " });
    expect(hub.snapshot().find((p) => p.id === "p0")).toMatchObject({
      spriteKey: "character_coop",
      name: "Coop",
    });
  });

  it("frees a slot when someone leaves", () => {
    for (let i = 0; i < MAX_HUMAN_PLAYERS; i++) join(`p${i}`);
    hub.leave("p0");
    expect(join("p4").ok).toBe(true);
  });

  it("lets an existing player rejoin even at capacity", () => {
    // A reconnect must not be refused by the seat the same player still holds
    for (let i = 0; i < MAX_HUMAN_PLAYERS; i++) join(`p${i}`);
    expect(join("p2", "p2 again").ok).toBe(true);
    expect(hub.count).toBe(MAX_HUMAN_PLAYERS);
  });
});

describe("movement", () => {
  it("accepts a walk that speed allows", () => {
    join("p1");
    clock += 100; // 100ms of walking ≈ 16px
    const moved = hub.move("p1", { x: 110, y: 100, facing: "right", moving: true });
    expect(moved?.x).toBe(110);
    expect(moved?.moving).toBe(true);
  });

  it("clamps a teleport back to walking distance", () => {
    join("p1");
    clock += 100;
    const moved = hub.move("p1", { x: 5000, y: 100, facing: "right", moving: true })!;

    const travelled = moved.x - 100;
    expect(travelled).toBeGreaterThan(0);
    // 100ms at 160px/s with the tolerance is well under 100px, never 4900
    expect(travelled).toBeLessThan((MOVE_SPEED_PX_S / 1000) * 100 * 3);
  });

  it("keeps the intended direction when clamping", () => {
    join("p1");
    clock += 100;
    const moved = hub.move("p1", { x: -5000, y: 100, facing: "left", moving: true })!;
    expect(moved.x).toBeLessThan(100);
  });

  it("ignores non-finite coordinates instead of corrupting the position", () => {
    join("p1");
    clock += 100;
    const moved = hub.move("p1", { x: NaN, y: Infinity, facing: "up", moving: true })!;
    expect(moved.x).toBe(100);
    expect(moved.y).toBe(100);
  });

  it("returns null for a player who is not in the room", () => {
    expect(hub.move("ghost", { x: 1, y: 1, facing: "up", moving: false })).toBeNull();
  });

  it("allows a longer distance after a longer gap", () => {
    join("p1");
    clock += 1000; // a full second of walking
    const moved = hub.move("p1", { x: 300, y: 100, facing: "right", moving: true })!;
    expect(moved.x).toBe(300);
  });
});

describe("idle sweeping", () => {
  it("keeps players who are still reporting", () => {
    join("p1");
    clock += IDLE_TIMEOUT_MS - 1;
    expect(hub.sweep()).toEqual([]);
    expect(hub.count).toBe(1);
  });

  it("drops a player who has gone quiet", () => {
    join("p1");
    join("p2");
    clock += IDLE_TIMEOUT_MS + 1;
    hub.touch("p2");

    const dropped = hub.sweep();
    expect(dropped.map((p) => p.id)).toEqual(["p1"]);
    expect(hub.has("p2")).toBe(true);
  });

  it("counts movement as being alive", () => {
    join("p1");
    clock += IDLE_TIMEOUT_MS - 100;
    hub.move("p1", { x: 101, y: 100, facing: "down", moving: true });
    clock += 200;
    expect(hub.sweep()).toEqual([]);
  });
});

describe("snapshots", () => {
  it("reports everyone currently present", () => {
    join("p1", "Alice");
    join("p2", "Bob");
    expect(
      hub
        .snapshot()
        .map((p) => p.name)
        .sort(),
    ).toEqual(["Alice", "Bob"]);
  });

  it("rounds coordinates so the wire stays small", () => {
    join("p1");
    clock += 1000;
    hub.move("p1", { x: 123.456789, y: 100, facing: "right", moving: true });
    expect(hub.snapshot()[0].x).toBe(123.46);
  });

  it("omits bookkeeping fields", () => {
    join("p1");
    expect(Object.keys(hub.snapshot()[0]).sort()).toEqual([
      "facing",
      "id",
      "moving",
      "name",
      "spriteKey",
      "x",
      "y",
    ]);
  });
});

describe("sanitiseName", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitiseName("  Robert   C  ")).toBe("Robert C");
  });

  it("caps length so name tags stay readable", () => {
    expect(sanitiseName("x".repeat(50))).toHaveLength(16);
  });

  it("falls back for an empty name", () => {
    expect(sanitiseName("   ")).toBe("Guest");
  });
});
