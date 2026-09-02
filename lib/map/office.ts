/**
 * The open-plan office.
 *
 * One room, wall to wall, with a door at the top left and a lift at the
 * bottom right. The furniture is lifted wholesale out of the old partitioned
 * map (see ./harvest.ts) and re-anchored into zones, so the art is unchanged
 * and only the architecture is new.
 */

import { harvest, type Region, type SourceMap } from "./harvest";
import type { RoomSpec, WallVocabulary } from "./spec";

export const WIDTH = 27;
export const HEIGHT = 20;
export const TILE = 48;

/**
 * Wall pieces, read off the old map's rooms.
 *
 * A LimeZu wall is a stack, not a nine-slice: a cap along the top, an
 * optional face, a base, and then a shadow the wall throws onto the first
 * floor row. Keeping `topFace` empty gives the shortest wall the tileset
 * supports, which buys two more rows of usable floor.
 */
export const WALLS: WallVocabulary = {
  cornerTL: 24,
  cornerTR: 26,
  cornerBL: 56,
  cornerBR: 58,
  edgeLeft: 40,
  edgeRight: 42,
  topCap: 178,
  // One face row: the old rooms stacked cap/face/base for a wall with real
  // height. Dropping it saves a row of floor but leaves the top edge looking
  // like a line rather than a wall.
  topFace: [182],
  topBase: 194,
  topShadow: 92,
  bottomRun: 57,
  floor: 108,
};

/**
 * What is carried over from the old office: the things hung on the walls,
 * and nothing else.
 *
 * The room is deliberately bare. Desks, agents, the games corner and every
 * interaction point were stripped back so there is a clean floor to build on,
 * and these regions take only the `walls` layer — pictures, whiteboards,
 * shelving and windows — leaving behind the furniture that used to stand in
 * front of them.
 */
export const REGIONS: Region[] = [
  { label: "top wall decor", sx: 3, sy: 3, sw: 13, sh: 3, dx: 4, dy: 0, layers: ["walls"] },
  { label: "right wall decor", sx: 17, sy: 3, sw: 10, sh: 3, dx: 16, dy: 0, layers: ["walls"] },
];

/**
 * Where the player starts.
 *
 * One spawn, not none: with an empty spawns layer the scene falls back to the
 * middle of the map, and the task terminal anchors to the same point. Naming
 * it here keeps both under control. It is the only spawn, so no agents are
 * created — the roster is built from every spawn but the player's.
 */
export const PLAYER_START = { tx: 6, ty: 9, facing: "down" } as const;

/**
 * Tiles a person can stand on.
 *
 * Two of them, not one: the row directly under the top wall carries the
 * shadow the wall throws, and it is ordinary floor to walk on. Anything that
 * reasons about reachability has to know that or it will treat the whole
 * strip below the top wall as solid.
 */
export const STANDABLE: readonly number[] = [WALLS.floor, WALLS.topShadow];

export function buildOfficeSpec(source: SourceMap): RoomSpec {
  const picked = harvest(source, REGIONS);

  return {
    width: WIDTH,
    height: HEIGHT,
    tileSize: TILE,
    walls: WALLS,
    placements: picked.placements,
    // No interaction points and no agent seats: an empty room. The wall
    // collisions the generator adds are the only solid things in it.
    pois: [],
    spawns: [{ tx: PLAYER_START.tx, ty: PLAYER_START.ty, facing: PLAYER_START.facing }],
    collisions: [],
    transitions: [
      // The door leads outside, to the world map. The lift is still a stub —
      // it will lead to a person's own office one day.
      //
      // Each zone spans the wall it sits in *and* the floor in front of it.
      // A zone confined to the wall would never fire: the wall is solid, so
      // nobody can stand in it, and the doorway would be scenery.
      { name: "door", target: "world", tx: 2, ty: 0, tw: 1, th: 4, facing: "up" },
      { name: "elevator", target: "elevator", tx: 23, ty: 18, tw: 2, th: 2, facing: "down" },
    ],
  };
}
