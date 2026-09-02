import { describe, expect, it } from "vitest";
import {
  AGENTS_FLOOR,
  PEOPLE_FLOOR,
  addressFromLocation,
  describeFloor,
  elevatorStops,
  floorUrl,
  mapFileFor,
  occupantsOf,
  roomForFloor,
} from "./floors";
import { TENANTS } from "./tenants";
import { roomFromLocation } from "../rooms";

const castle = TENANTS[0];
const people = [
  { id: "ab12cd34", name: "Robert" },
  { id: "ef56gh78", name: "Alice" },
];

describe("addresses", () => {
  it("reads the lobby and the floors from the path", () => {
    expect(addressFromLocation({ pathname: `/r/${castle.slug}` })).toEqual({
      tenant: castle,
      floor: { kind: "lobby" },
    });
    expect(addressFromLocation({ pathname: `/r/${castle.slug}/floor/2` })).toEqual({
      tenant: castle,
      floor: AGENTS_FLOOR,
    });
  });

  it("is nowhere for the bare app, an unknown building, or a floor that does not exist", () => {
    expect(addressFromLocation({ pathname: "/" })).toBeNull();
    expect(addressFromLocation({ pathname: "/r/somewhere-else" })).toBeNull();
    expect(addressFromLocation({ pathname: `/r/${castle.slug}/floor/7` })).toBeNull();
  });

  it("round-trips through the URL, and the room the socket joins agrees", () => {
    const url = floorUrl(castle, PEOPLE_FLOOR, "elevator");
    expect(url).toBe(`/r/${castle.slug}/floor/1?via=elevator`);
    const pathname = url.split("?")[0];
    expect(addressFromLocation({ pathname })!.floor).toEqual(PEOPLE_FLOOR);
    expect(roomFromLocation({ pathname, search: "" })).toBe(roomForFloor(castle, PEOPLE_FLOOR));
    expect(roomForFloor(castle, { kind: "lobby" })).toBe(castle.slug);
  });
});

describe("the lift", () => {
  it("lists the lobby, the people's floor and the agents' floor, with names", () => {
    const stops = elevatorStops({ tenant: castle, floor: { kind: "lobby" } }, { people });
    expect(stops.map((s) => s.label)).toEqual(["Lobby", "Floor 1 · People", "Floor 2 · Agents"]);
    expect(stops[1].names).toEqual(["Robert", "Alice"]);
    expect(stops[2].names).toEqual(["Yoshi"]);
    expect(stops.map((s) => s.here)).toEqual([true, false, false]);
    expect(stops[2].url).toBe(`/r/${castle.slug}/floor/2?via=elevator`);
  });

  it("has nobody on the agents' floor of a building with no agents", () => {
    const finance = TENANTS.find((t) => t.slug === "homestar-finance")!;
    const stops = elevatorStops({ tenant: finance, floor: { kind: "lobby" } }, { people: [] });
    expect(stops[2].names).toEqual([]);
  });

  it("draws each room from the right map: a game lobby its own, premises their own, the rest shared", () => {
    expect(mapFileFor({ tenant: TENANTS[0], floor: { kind: "lobby" } })).toBe(
      "/maps/lobby-castle-atlantic.json",
    );
    expect(mapFileFor({ tenant: TENANTS[2], floor: { kind: "lobby" } })).toBe(
      "/maps/room-chester-warehouse.json",
    );
    expect(mapFileFor({ tenant: TENANTS[7], floor: { kind: "lobby" } })).toBe("/maps/lobby.json");
  });

  it("knows which floor you are on", () => {
    const stops = elevatorStops({ tenant: castle, floor: PEOPLE_FLOOR }, { people });
    expect(stops.map((s) => s.here)).toEqual([false, true, false]);
  });
});

describe("desks", () => {
  it("seat the people on Floor 1 and the agents on Floor 2, in order", () => {
    expect(occupantsOf(castle, PEOPLE_FLOOR, { people })).toEqual(people);
    expect(occupantsOf(castle, AGENTS_FLOOR, { people })).toEqual([{ id: "yoshi", name: "Yoshi" }]);
    expect(occupantsOf(castle, { kind: "lobby" }, { people })).toEqual([]);
  });
});

describe("the top bar and the maps", () => {
  it("describes a floor", () => {
    expect(describeFloor({ tenant: castle, floor: { kind: "lobby" } })).toBe("Lobby");
    expect(describeFloor({ tenant: castle, floor: AGENTS_FLOOR })).toBe("Floor 2 · Agents");
  });

  it("draws each floor from its own map", () => {
    expect(mapFileFor(null)).toBe("/maps/office3.json");
    expect(mapFileFor({ tenant: castle, floor: { kind: "lobby" } })).toBe(
      "/maps/lobby-castle-atlantic.json",
    );
    expect(mapFileFor({ tenant: castle, floor: PEOPLE_FLOOR })).toBe("/maps/floor.json");
  });
});
