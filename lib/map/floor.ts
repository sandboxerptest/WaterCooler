/**
 * A floor above the lobby: where a building's people, or its agents, have
 * their desks.
 *
 * One room shared by everyone on that floor, reached only by the lift,
 * which stands where it does downstairs — bottom left — so the ride feels
 * like a ride. The desks are not in the map: who sits here changes, so the
 * scene places one per occupant (see lib/world/desks.ts). The wall carries
 * the shared whiteboard, as the lobby does.
 */

import { harvest, type Region, type SourceMap } from "./harvest";
import type { RoomSpec } from "./spec";
import { TILE, WALLS, WHITEBOARD } from "./office";

export const WIDTH = 20;
export const HEIGHT = 14;

/** The same one thing on the wall as downstairs: the shared whiteboard. */
export const REGIONS: Region[] = [WHITEBOARD.region];

/** Where you stand when the lift is not how you came. */
export const PLAYER_START = { tx: 9, ty: 7, facing: "down" } as const;

/** Where it is downstairs: bottom left, under where the door would be. */
export const ELEVATOR = { tx: 2, ty: HEIGHT - 2, tw: 2, th: 2 } as const;

export function buildFloorSpec(source: SourceMap): RoomSpec {
  const picked = harvest(source, REGIONS);
  return {
    width: WIDTH,
    height: HEIGHT,
    tileSize: TILE,
    walls: WALLS,
    placements: picked.placements,
    pois: [WHITEBOARD.poi],
    spawns: [{ tx: PLAYER_START.tx, ty: PLAYER_START.ty, facing: PLAYER_START.facing }],
    collisions: [],
    // No door: the only way out is the way in.
    transitions: [{ name: "elevator", target: "elevator", ...ELEVATOR, facing: "down" }],
  };
}
