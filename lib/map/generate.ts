/**
 * Turns a RoomSpec into the Tiled JSON the office scene loads.
 *
 * The output has to satisfy an existing reader, so the layer names are a
 * contract: OfficeScene calls createLayer for floor, walls, ground, furniture,
 * objects and overhead, and getObjectLayer for props, props-over, collisions,
 * pois and spawns. Every one is emitted even when empty — a missing layer is a
 * null return the scene does not check.
 */

import type { Placement, Rect, RoomSpec } from "./spec";

export interface TileLayer {
  type: "tilelayer";
  name: string;
  width: number;
  height: number;
  x: 0;
  y: 0;
  opacity: 1;
  visible: true;
  id: number;
  data: number[];
}

export interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0;
  visible: true;
  gid?: number;
  point?: true;
  properties?: Array<{ name: string; type: string; value: string }>;
}

export interface ObjectLayer {
  type: "objectgroup";
  name: string;
  id: number;
  opacity: 1;
  visible: true;
  x: 0;
  y: 0;
  draworder: "topdown";
  objects: TiledObject[];
}

export interface TilesetRef {
  firstgid: number;
  name: string;
  image: string;
  imagewidth: number;
  imageheight: number;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  margin: 0;
  spacing: 0;
}

export interface TiledMap {
  compressionlevel: -1;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  infinite: false;
  orientation: "orthogonal";
  renderorder: "right-down";
  type: "map";
  version: string;
  tiledversion: string;
  nextlayerid: number;
  nextobjectid: number;
  tilesets: TilesetRef[];
  layers: Array<TileLayer | ObjectLayer>;
}

const TILE_LAYERS = ["floor", "walls", "ground", "furniture", "objects", "overhead"] as const;
const OBJECT_LAYERS = [
  "props",
  "props-over",
  "collisions",
  "pois",
  "spawns",
  "transitions",
] as const;

type TileLayerName = (typeof TILE_LAYERS)[number];

function blank(width: number, height: number): number[] {
  return new Array<number>(width * height).fill(0);
}

/**
 * Paints the room shell into a floor grid: a closed wall ring with a textured
 * top run, and plain floor everywhere inside.
 *
 * The ring is closed on purpose even where a doorway sits. An opening you can
 * walk through needs a destination first, and a hole in the wall with nothing
 * behind it is a bug we have already fixed once.
 */
export function paintShell(spec: RoomSpec): number[] {
  const { width: w, height: h, walls: v } = spec;
  const grid = blank(w, h);
  const at = (x: number, y: number, gid: number) => {
    if (x >= 0 && x < w && y >= 0 && y < h) grid[y * w + x] = gid;
  };

  // Floor first, then the ring over it, so the ring always wins at the edges.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) at(x, y, v.floor);
  }

  // Top run: cap, optional face rows, base, then the shadow it casts.
  const topRows = [v.topCap, ...v.topFace, v.topBase];
  for (let x = 1; x < w - 1; x++) {
    topRows.forEach((gid, i) => at(x, i, gid));
    at(x, topRows.length, v.topShadow);
    at(x, h - 1, v.bottomRun);
  }

  for (let y = 1; y < h - 1; y++) {
    at(0, y, v.edgeLeft);
    at(w - 1, y, v.edgeRight);
  }

  at(0, 0, v.cornerTL);
  at(w - 1, 0, v.cornerTR);
  at(0, h - 1, v.cornerBL);
  at(w - 1, h - 1, v.cornerBR);

  return grid;
}

/** How many rows the top wall stack occupies: cap, any face rows, then base. */
export function topWallRows(spec: RoomSpec): number {
  return 2 + spec.walls.topFace.length;
}

/** The first floor row below the top wall stack — where furniture may start. */
export function firstWalkableRow(spec: RoomSpec): number {
  return topWallRows(spec) + 1;
}

/**
 * Solid rectangles for the wall ring itself.
 *
 * These have to be written into the map because nothing else produces them.
 * The scene decides what is walkable by asking whether the "floor" layer has a
 * tile — and the wall ring lives in that layer, so without these the walls
 * read as floor: the pathfinder routes straight through them and the
 * perimeter sealer, finding no hole, adds nothing.
 *
 * The top wall is several tiles deep and the other three are one, which is
 * what the art shows: you look down on the side and bottom walls but at the
 * face of the top one.
 */
export function wallCollisions(spec: RoomSpec): Rect[] {
  const t = spec.tileSize;
  const w = spec.width * t;
  const h = spec.height * t;
  return [
    { x: 0, y: 0, width: w, height: topWallRows(spec) * t },
    { x: 0, y: h - t, width: w, height: t },
    { x: 0, y: 0, width: t, height: h },
    { x: w - t, y: 0, width: t, height: h },
  ];
}

/**
 * Merges solid placements into horizontal runs, then emits one rect per run.
 *
 * Deriving collisions from the furniture is the whole point: the old map kept
 * 49 hand-drawn rectangles, so moving a desk left its collision box behind.
 */
export function deriveCollisions(spec: RoomSpec): Rect[] {
  const size = spec.tileSize;
  const solid = new Set<string>();
  for (const p of spec.placements) {
    if (p.solid) solid.add(`${p.tx},${p.ty}`);
  }

  const rects: Rect[] = [];
  for (let y = 0; y < spec.height; y++) {
    let runStart = -1;
    for (let x = 0; x <= spec.width; x++) {
      const filled = solid.has(`${x},${y}`);
      if (filled && runStart < 0) runStart = x;
      if (!filled && runStart >= 0) {
        rects.push({
          x: runStart * size,
          y: y * size,
          width: (x - runStart) * size,
          height: size,
        });
        runStart = -1;
      }
    }
  }
  return rects;
}

let nextId = 1;
const resetIds = () => {
  nextId = 1;
};
const takeId = () => nextId++;

function pointObject(
  name: string,
  tx: number,
  ty: number,
  size: number,
  facing?: string,
): TiledObject {
  return {
    id: takeId(),
    name,
    type: "",
    // Points sit at the centre of their tile so an agent standing on the tile
    // reads as standing at the point.
    x: tx * size + size / 2,
    y: ty * size + size / 2,
    width: 0,
    height: 0,
    rotation: 0,
    visible: true,
    point: true,
    ...(facing ? { properties: [{ name: "facing", type: "string", value: facing }] } : {}),
  };
}

function placementsOn(spec: RoomSpec, layer: Placement["layer"]): Placement[] {
  return spec.placements.filter((p) => p.layer === layer);
}

export function generateMap(spec: RoomSpec, tilesets: TilesetRef[]): TiledMap {
  resetIds();
  const size = spec.tileSize;
  const layers: Array<TileLayer | ObjectLayer> = [];
  let layerId = 1;

  const tileGrids: Record<TileLayerName, number[]> = {
    floor: paintShell(spec),
    walls: blank(spec.width, spec.height),
    ground: blank(spec.width, spec.height),
    furniture: blank(spec.width, spec.height),
    objects: blank(spec.width, spec.height),
    overhead: blank(spec.width, spec.height),
  };

  for (const p of spec.placements) {
    const grid = tileGrids[p.layer as TileLayerName];
    if (!grid) continue;
    if (p.tx < 0 || p.tx >= spec.width || p.ty < 0 || p.ty >= spec.height) continue;
    grid[p.ty * spec.width + p.tx] = p.gid;
  }

  for (const name of TILE_LAYERS) {
    layers.push({
      type: "tilelayer",
      name,
      width: spec.width,
      height: spec.height,
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      id: layerId++,
      data: tileGrids[name],
    });
  }

  const objectLayers: Record<string, TiledObject[]> = {
    props: placementsOn(spec, "props").map((p) => ({
      id: takeId(),
      name: "",
      type: "",
      x: p.tx * size,
      // Tiled anchors tile objects at their bottom-left corner.
      y: (p.ty + 1) * size,
      width: size,
      height: size,
      rotation: 0,
      visible: true,
      gid: p.gid,
    })),
    "props-over": placementsOn(spec, "props-over").map((p) => ({
      id: takeId(),
      name: "",
      type: "",
      x: p.tx * size,
      y: (p.ty + 1) * size,
      width: size,
      height: size,
      rotation: 0,
      visible: true,
      gid: p.gid,
    })),
    collisions: [
      ...wallCollisions(spec),
      ...(spec.collisions ?? []),
      ...deriveCollisions(spec),
    ].map((r) => ({
      id: takeId(),
      name: "",
      type: "",
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      rotation: 0,
      visible: true,
    })),
    pois: spec.pois.map((p) => pointObject(p.name, p.tx, p.ty, size, p.facing)),
    spawns: spec.spawns.map((s) => pointObject(s.name ?? "", s.tx, s.ty, size, s.facing)),
    transitions: spec.transitions.map((t) => ({
      id: takeId(),
      name: t.name,
      type: "",
      x: t.tx * size,
      y: t.ty * size,
      width: (t.tw ?? 1) * size,
      height: (t.th ?? 1) * size,
      rotation: 0,
      visible: true,
      properties: [
        { name: "target", type: "string", value: t.target },
        ...(t.facing ? [{ name: "facing", type: "string", value: t.facing }] : []),
      ],
    })),
  };

  for (const name of OBJECT_LAYERS) {
    layers.push({
      type: "objectgroup",
      name,
      id: layerId++,
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
      draworder: "topdown",
      objects: objectLayers[name] ?? [],
    });
  }

  return {
    compressionlevel: -1,
    width: spec.width,
    height: spec.height,
    tilewidth: size,
    tileheight: size,
    infinite: false,
    orientation: "orthogonal",
    renderorder: "right-down",
    type: "map",
    version: "1.10",
    tiledversion: "1.11.2",
    nextlayerid: layerId,
    nextobjectid: nextId,
    tilesets,
    layers,
  };
}
