/**
 * The rooms of a building supply business: the store, the warehouse behind
 * it, and the field crew's garage.
 *
 * None of these is a lobby. There is no lift and there are no floors: you
 * walk into the store from the street, out through the back into the
 * warehouse, and — where the business has one — through a side door to the
 * garage. The doors are all in the top wall, as the lobby's are, so the
 * same door art and the same latch serve them.
 *
 * The furniture is stamped straight from the interiors' tilesets by tile
 * coordinate, so the rooms are drawn in the same hand as everything else.
 */

import type { Placement, RoomSpec, TransitionSpec } from "./spec";
import { HEIGHT as FLOOR_ROWS, WIDTH as FLOOR_COLS } from "./floor";
import { TILE, WALLS } from "./office";

export const WIDTH = FLOOR_COLS;
export const HEIGHT = FLOOR_ROWS;

/** Tilesets as the old map names them, with their first gids. */
const TILESETS = {
  grocery: { firstgid: 18589, columns: 16 },
  basement: { firstgid: 1617, columns: 16 },
} as const;

type TilesetName = keyof typeof TILESETS;

/**
 * Stamp a rectangle of a tileset onto the map at a tile position. Solid
 * unless said otherwise: furniture is walked around, not through.
 */
function stamp(
  tileset: TilesetName,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  options: { layer?: Placement["layer"]; solid?: boolean } = {},
): Placement[] {
  const { firstgid, columns } = TILESETS[tileset];
  const out: Placement[] = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      out.push({
        tx: dx + x,
        ty: dy + y,
        gid: firstgid + (sy + y) * columns + (sx + x),
        layer: options.layer ?? "furniture",
        solid: options.solid ?? true,
      });
    }
  }
  return out;
}

/** A door in the top wall, spanning the wall and the floor in front of it. */
function topDoor(name: string, target: string, tx: number): TransitionSpec {
  return { name, target, tx, ty: 0, tw: 1, th: 4, facing: "up" };
}

/** The target of a door into another room, arriving at that room's named door. */
export const roomTarget = (slug: string, door: string) => `room:${slug}:${door}`;

export interface StoreOptions {
  /** Slug of the warehouse room behind the store, if there is one. */
  warehouse?: string;
  /** Slug of the field crew's garage, if there is one. */
  fieldCrew?: string;
  /** Slug of this store, for the doors that lead back to it. */
  self: string;
}

/**
 * Which column of the top wall each door stands in. The warehouse is a few
 * steps from the front door, since street → store → warehouse is the trip
 * most often made; the field crew's door is beyond it.
 */
export const STORE_DOORS = { front: 2, warehouse: 5, fieldCrew: 8 } as const;

export function buildStoreSpec(options: StoreOptions): RoomSpec {
  const placements: Placement[] = [
    // The shop window in the front wall, right of the doors.
    ...stamp("grocery", 12, 23, 4, 2, 11, 1, { layer: "walls", solid: false }),
    // Tall shelving under the window and fridges beside it.
    ...stamp("grocery", 10, 15, 4, 3, 11, 3),
    ...stamp("grocery", 8, 15, 2, 3, 16, 3),
    // Two aisles: packed shelves, then wooden bins of stock.
    ...stamp("grocery", 10, 15, 4, 2, 4, 7),
    ...stamp("grocery", 0, 15, 2, 2, 11, 7),
    ...stamp("grocery", 10, 17, 2, 2, 13, 7),
    ...stamp("grocery", 0, 61, 4, 2, 4, 10),
    ...stamp("grocery", 4, 61, 4, 2, 11, 10),
    // Checkout by the front door, with a stack of baskets and the carts.
    ...stamp("grocery", 6, 24, 4, 3, 1, 10),
    ...stamp("grocery", 14, 12, 1, 1, 6, 12),
    ...stamp("grocery", 6, 22, 2, 2, 7, 11),
    // The garden corner.
    ...stamp("grocery", 4, 65, 4, 3, 15, 10),
    ...stamp("grocery", 0, 74, 2, 2, 17, 6),
  ];
  const transitions: TransitionSpec[] = [topDoor("door", "world", STORE_DOORS.front)];
  if (options.warehouse) {
    transitions.push(
      topDoor("warehouse", roomTarget(options.warehouse, "store"), STORE_DOORS.warehouse),
    );
  }
  if (options.fieldCrew) {
    transitions.push(
      topDoor("field-crew", roomTarget(options.fieldCrew, "store"), STORE_DOORS.fieldCrew),
    );
  }
  return {
    width: WIDTH,
    height: HEIGHT,
    tileSize: TILE,
    walls: WALLS,
    placements,
    pois: [],
    spawns: [{ tx: 2, ty: 5, facing: "down" }],
    transitions,
    collisions: [],
  };
}

export function buildWarehouseSpec(store: string): RoomSpec {
  const placements: Placement[] = [
    // Three kinds of rack, two rows of them, with an aisle between.
    ...stamp("basement", 3, 4, 2, 4, 5, 3),
    ...stamp("basement", 8, 4, 2, 4, 9, 3),
    ...stamp("basement", 12, 4, 2, 4, 13, 3),
    ...stamp("basement", 12, 4, 2, 4, 5, 8),
    ...stamp("basement", 3, 4, 2, 4, 9, 8),
    ...stamp("basement", 8, 4, 2, 4, 13, 8),
    // Barrels and crates against the far wall, a packing bench by the door.
    ...stamp("basement", 0, 4, 2, 2, 16, 3),
    ...stamp("basement", 0, 9, 2, 3, 16, 6),
    ...stamp("basement", 7, 14, 3, 2, 1, 10),
  ];
  return {
    width: WIDTH,
    height: HEIGHT,
    tileSize: TILE,
    walls: WALLS,
    placements,
    pois: [],
    spawns: [{ tx: 2, ty: 5, facing: "down" }],
    transitions: [topDoor("store", roomTarget(store, "warehouse"), STORE_DOORS.front)],
    collisions: [],
  };
}

export function buildGarageSpec(store: string): RoomSpec {
  const placements: Placement[] = [
    // Workbenches along the back wall, one of each kind.
    ...stamp("basement", 7, 14, 3, 2, 4, 3),
    ...stamp("basement", 11, 14, 3, 2, 9, 3),
    ...stamp("basement", 11, 16, 3, 2, 14, 3),
    // Stock and fuel in the corners.
    ...stamp("basement", 0, 9, 2, 3, 1, 8),
    ...stamp("basement", 0, 4, 2, 2, 17, 8),
    ...stamp("basement", 0, 7, 2, 2, 17, 10),
  ];
  return {
    width: WIDTH,
    height: HEIGHT,
    tileSize: TILE,
    walls: WALLS,
    placements,
    pois: [],
    spawns: [{ tx: 2, ty: 5, facing: "down" }],
    transitions: [topDoor("store", roomTarget(store, "field-crew"), STORE_DOORS.front)],
    collisions: [],
  };
}

/** Where the vans stand in a garage: bays on the floor, as pixel rectangles. */
export const GARAGE_BAYS = [
  { x: 5 * TILE, y: 7 * TILE },
  { x: 10 * TILE, y: 7 * TILE },
];
