import { describe, expect, it } from "vitest";
import { PresenceHub } from "../presence-hub";
import { ResidentSimulation, presenceIdFor } from "../residents";
import { RESIDENTS, deskSpot, wanderArea } from "../../world/residents";

const yoshi = RESIDENTS[0];

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
      startAt: "lobby",
    });
    const area = wanderArea("lobby")!;
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
      startAt: "lobby",
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
      startAt: "lobby",
    });
    clock = 5 * 60_000;
    sim.tick(clock);
    expect(sim.whereabouts()[0].place).toBe("outside");
    expect(sim.whereabouts()[0].room).toBeNull();
    for (const room of rooms.values()) expect(room.hub.has(presenceIdFor(yoshi))).toBe(false);
  });

  it("rejoins a room that was closed and reopened", () => {
    let clock = 0;
    const { rooms, host } = world();
    const sim = new ResidentSimulation(host, {
      now: () => clock,
      random: () => 0.5,
      startAt: "lobby",
    });
    rooms.delete("castle-atlantic");
    clock += 120;
    sim.tick(clock);
    expect(rooms.get("castle-atlantic")!.hub.has(presenceIdFor(yoshi))).toBe(true);
  });
});
