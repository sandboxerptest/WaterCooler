import { describe, expect, it } from "vitest";
import { PresenceHub } from "../presence-hub";
import { ResidentSimulation, presenceIdFor } from "../residents";
import { RESIDENTS, WANDER_AREAS, deskSpot, residentById } from "../../world/residents";

const yoshi = RESIDENTS[0];
const mark = residentById("mark")!;
const steve = residentById("steve")!;

function world() {
  const rooms = new Map<string, { hub: PresenceHub }>();
  const host = {
    roomFor(slug: string) {
      let room = rooms.get(slug);
      if (!room) {
        room = { hub: new PresenceHub() };
        rooms.set(slug, room);
      }
      return room;
    },
  };
  return { rooms, host };
}

describe("a resident's day", () => {
  it("starts in the office as a resident, not a person", () => {
    const { rooms, host } = world();
    const sim = new ResidentSimulation(host, {
      now: () => 0,
      random: () => 0.5,
      startAt: "office",
    });
    const office = rooms.get("castle-atlantic-floor-2")!;
    const player = office.hub.snapshot().find((p) => p.id === presenceIdFor(yoshi))!;
    expect(player.name).toBe("Yoshi");
    expect(player.x).toBe(deskSpot(yoshi).x);
    expect(player.facing).toBe("up");
    expect(player.resident).toBe(true);
    expect(player.spriteKey).toBe(yoshi.spriteKey);
    expect(office.hub.count).toBe(0);
    expect(sim.whereabouts()[0].place).toBe("office");
  });

  it("wanders inside the room's walkable area", () => {
    let clock = 0;
    const { rooms, host } = world();
    const sim = new ResidentSimulation(host, {
      now: () => clock,
      random: () => 0.9,
      startAt: "room",
    });
    const area = WANDER_AREAS.lobby;
    for (let i = 0; i < 400; i++) {
      clock += 120;
      sim.tick(clock);
      const player = rooms.get("castle-atlantic")!.hub.snapshot()[0];
      expect(player.x).toBeGreaterThanOrEqual(area.x);
      expect(player.x).toBeLessThanOrEqual(area.x + area.width);
      expect(player.y).toBeGreaterThanOrEqual(area.y);
      expect(player.y).toBeLessThanOrEqual(area.y + area.height);
    }
  });

  it("moves on when the dwell is up, and leaves the room behind", () => {
    let clock = 0;
    const { rooms, host } = world();
    const sim = new ResidentSimulation(host, {
      now: () => clock,
      random: () => 0,
      startAt: "room",
    });
    expect(rooms.get("castle-atlantic")!.hub.has(presenceIdFor(yoshi))).toBe(true);
    clock = 3 * 60_000;
    sim.tick(clock);
    // random 0 picks the first other place: the office.
    expect(sim.whereabouts()[0].place).toBe("office");
    expect(rooms.get("castle-atlantic")!.hub.has(presenceIdFor(yoshi))).toBe(false);
    expect(rooms.get("castle-atlantic-floor-2")!.hub.has(presenceIdFor(yoshi))).toBe(true);
  });

  it("is in no room while outside", () => {
    let clock = 0;
    const { rooms, host } = world();
    const sim = new ResidentSimulation(host, {
      now: () => clock,
      random: () => 0.99,
      startAt: "room",
    });
    clock = 5 * 60_000;
    sim.tick(clock);
    expect(sim.whereabouts()[0].place).toBe("outside");
    expect(sim.whereabouts()[0].room).toBeNull();
    expect(sim.whereabouts()[0].spot).not.toBeNull();
    for (const room of rooms.values()) expect(room.hub.has(presenceIdFor(yoshi))).toBe(false);
  });

  it("puts Steve in the warehouse and Mark at his Sales desk to begin with", () => {
    const { rooms, host } = world();
    const sim = new ResidentSimulation(host, { now: () => 0, random: () => 0.5 });
    // Steve has no desk: his first haunt stands in for the office.
    expect(rooms.get("chester-warehouse")!.hub.has(presenceIdFor(steve))).toBe(true);
    expect(rooms.get("homestar-sales-floor-2")!.hub.has(presenceIdFor(mark))).toBe(true);
    const marks = sim.whereabouts().find((w) => w.id === "mark")!;
    expect(marks.place).toBe("office");
    expect(marks.room).toBe("homestar-sales-floor-2");
  });

  it("stands Mark somewhere on the yard when he is on the campus", () => {
    let clock = 0;
    const { host } = world();
    // A fixed but varied sequence, so his day takes him round every haunt.
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const sim = new ResidentSimulation(host, { now: () => clock, random });
    // Walk his day until he reaches the yard.
    let onYard = null;
    for (let i = 0; i < 200 && !onYard; i++) {
      clock += 9 * 60_000;
      sim.tick(clock);
      const where = sim.whereabouts().find((w) => w.id === "mark")!;
      if (where.place === "campus") onYard = where;
    }
    expect(onYard).not.toBeNull();
    expect(onYard!.campus).toBe("homestar");
    expect(onYard!.room).toBeNull();
    expect(onYard!.spot!.x).toBeGreaterThan(0);
  });

  it("rejoins a room that was closed and reopened", () => {
    let clock = 0;
    const { rooms, host } = world();
    const sim = new ResidentSimulation(host, {
      now: () => clock,
      random: () => 0.5,
      startAt: "room",
    });
    rooms.delete("castle-atlantic");
    clock += 120;
    sim.tick(clock);
    expect(rooms.get("castle-atlantic")!.hub.has(presenceIdFor(yoshi))).toBe(true);
  });
});
