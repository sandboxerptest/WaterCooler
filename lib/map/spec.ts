/**
 * The office, described rather than drawn.
 *
 * The map is a Tiled file, but Tiled is not installed on any machine that
 * works on this project — and a 27x20 map across six tile layers is over
 * 3,000 tile ids plus 49 pixel-placed collision rectangles. Nobody edits that
 * by hand twice.
 *
 * So the room is a spec, and the generator in ./generate.ts turns it into the
 * Tiled JSON the scene already knows how to load. Moving a desk is a line here.
 */

/** Tiled global tile ids carry flip flags in the top three bits. */
export const FLIP_MASK = 0x1fffffff;

/**
 * The tiles a wall ring is built from, harvested from the existing map.
 *
 * LimeZu walls are not a nine-slice: a horizontal run stacks a cap, an
 * optional face and a base, and the floor below it carries its own shadow row.
 * Naming the pieces keeps the generator readable and, more usefully, makes
 * retuning the look a change to this table alone.
 */
export interface WallVocabulary {
  /** Outer corners of the ring, top-left clockwise. */
  cornerTL: number;
  cornerTR: number;
  cornerBL: number;
  cornerBR: number;
  /** Vertical runs. */
  edgeLeft: number;
  edgeRight: number;
  /** Horizontal top run, stacked downward from the cap. */
  topCap: number;
  topFace: number[];
  topBase: number;
  /** The shadow the top wall casts on the first floor row. */
  topShadow: number;
  /** Horizontal bottom run. */
  bottomRun: number;
  /** Plain floor. */
  floor: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A piece of furniture, placed by tile and drawn from a harvested tile id. */
export interface Placement {
  /** Tile column and row of the top-left tile. */
  tx: number;
  ty: number;
  /** Tiled gid, flip flags included. */
  gid: number;
  /** Which layer it belongs on. */
  layer: "walls" | "ground" | "furniture" | "objects" | "props" | "props-over" | "overhead";
  /** Blocks movement. Collision rects are derived from these. */
  solid?: boolean;
}

/**
 * A named interaction point. The scene finds features by matching these names
 * with a regex — /cauldron/i is the pinball table, /bucket/i is ping pong,
 * /white ?board/i is the drawing surface — so a rename silently removes the
 * feature with no error anywhere. Treat the strings as an API.
 */
export interface PoiSpec {
  name: string;
  tx: number;
  ty: number;
  facing?: "up" | "down" | "left" | "right";
}

export interface SpawnSpec {
  tx: number;
  ty: number;
  facing?: "up" | "down" | "left" | "right";
  /** The boss seat, otherwise the leftmost spawn is chosen. */
  name?: string;
}

/**
 * A doorway out of the room. The target is a stub today; these exist so a
 * later scene can be attached without touching the map or the generator.
 */
export interface TransitionSpec {
  name: string;
  target: string;
  tx: number;
  ty: number;
  /** Tiles wide, for a double door or a lift car. */
  tw?: number;
  th?: number;
  facing?: "up" | "down" | "left" | "right";
}

export interface RoomSpec {
  width: number;
  height: number;
  tileSize: number;
  walls: WallVocabulary;
  placements: Placement[];
  pois: PoiSpec[];
  spawns: SpawnSpec[];
  transitions: TransitionSpec[];
  /**
   * Collision rectangles that come with harvested furniture, in pixels.
   * Stamped art carries the boxes that were drawn for it; rectangles derived
   * from `solid` placements are added to these.
   */
  collisions?: Rect[];
  /**
   * A rectangle of the room's bounding box that is not room, in tiles: the
   * bottom-left, for a room shaped like a 7. Walls are drawn around it and
   * it is solid.
   */
  cutout?: { x: number; y: number; width: number; height: number };
}
