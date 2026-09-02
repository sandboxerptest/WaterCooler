/**
 * Lifts art out of the old map so the new one is built from the same pieces.
 *
 * The office was drawn in Tiled by hand: desks are runs of consecutive tile
 * ids, whiteboards sit across three tiles, and every solid thing has a
 * collision box that was positioned by eye. Picking individual tile ids out of
 * that would tear the assemblies apart, so instead whole regions are copied —
 * every tile layer, the prop objects, the points and the collision boxes —
 * and re-anchored somewhere new.
 */

import type { Placement, PoiSpec, Rect, SpawnSpec } from "./spec";

export interface SourceMap {
  width: number;
  height: number;
  tilewidth: number;
  layers: Array<{
    type: string;
    name: string;
    data?: number[];
    objects?: Array<{
      name?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      gid?: number;
      properties?: Array<{ name: string; value: unknown }>;
    }>;
  }>;
}

/** A rectangle of the old map, and where its top-left corner lands in the new one. */
export interface Region {
  /** What this region is, for logging and for the spec to read. */
  label: string;
  /** Source rectangle, in tiles. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Destination top-left, in tiles. */
  dx: number;
  dy: number;
  /**
   * Which layers to copy. Defaults to all of them; naming a subset is how a
   * region takes the pictures off a wall without dragging the furniture that
   * stood in front of it.
   */
  layers?: Array<Placement["layer"]>;
}

export interface Harvest {
  placements: Placement[];
  pois: PoiSpec[];
  spawns: SpawnSpec[];
  collisions: Rect[];
}

const ALL_TILE_LAYERS: Array<Placement["layer"]> = ["walls", "furniture", "objects", "overhead"];
const ALL_OBJECT_LAYERS: Array<Placement["layer"]> = ["props", "props-over"];

function facingOf(props: Array<{ name: string; value: unknown }> | undefined) {
  const f = props?.find((p) => p.name === "facing")?.value;
  return typeof f === "string" ? (f as PoiSpec["facing"]) : undefined;
}

/**
 * Copies every region out of the source map.
 *
 * `ground` is deliberately not carried: it holds the old interior partitions'
 * floor trim, which is exactly what an open room is meant to lose. `walls` is
 * safe to carry because it holds only wall-mounted decor — whiteboards,
 * windows, shelving. The structural shell lives in `floor`, and that is
 * repainted from scratch rather than copied.
 */
export function harvest(source: SourceMap, regions: Region[]): Harvest {
  const size = source.tilewidth;
  const out: Harvest = { placements: [], pois: [], spawns: [], collisions: [] };
  const layerByName = new Map(source.layers.map((l) => [l.name, l]));

  const contains = (r: Region, tx: number, ty: number) =>
    tx >= r.sx && tx < r.sx + r.sw && ty >= r.sy && ty < r.sy + r.sh;

  for (const region of regions) {
    const shiftX = region.dx - region.sx;
    const shiftY = region.dy - region.sy;
    const wanted = region.layers;
    const tileLayers = wanted ? ALL_TILE_LAYERS.filter((l) => wanted.includes(l)) : ALL_TILE_LAYERS;
    const objectLayers = wanted
      ? ALL_OBJECT_LAYERS.filter((l) => wanted.includes(l))
      : ALL_OBJECT_LAYERS;

    for (const name of tileLayers) {
      const layer = layerByName.get(name);
      if (!layer?.data) continue;
      for (let y = region.sy; y < region.sy + region.sh; y++) {
        for (let x = region.sx; x < region.sx + region.sw; x++) {
          if (x < 0 || x >= source.width || y < 0 || y >= source.height) continue;
          const gid = layer.data[y * source.width + x];
          if (gid) out.placements.push({ tx: x + shiftX, ty: y + shiftY, gid, layer: name });
        }
      }
    }

    for (const name of objectLayers) {
      const layer = layerByName.get(name);
      if (!layer?.objects) continue;
      for (const o of layer.objects) {
        if (!o.gid) continue;
        // Tile objects anchor bottom-left, so the tile they occupy is one up.
        const tx = Math.round(o.x / size);
        const ty = Math.round(o.y / size) - 1;
        if (!contains(region, tx, ty)) continue;
        out.placements.push({ tx: tx + shiftX, ty: ty + shiftY, gid: o.gid, layer: name });
      }
    }

    for (const o of layerByName.get("pois")?.objects ?? []) {
      const tx = Math.floor(o.x / size);
      const ty = Math.floor(o.y / size);
      if (!contains(region, tx, ty) || !o.name) continue;
      out.pois.push({
        name: o.name,
        tx: tx + shiftX,
        ty: ty + shiftY,
        facing: facingOf(o.properties),
      });
    }

    for (const o of layerByName.get("spawns")?.objects ?? []) {
      const tx = Math.floor(o.x / size);
      const ty = Math.floor(o.y / size);
      if (!contains(region, tx, ty)) continue;
      out.spawns.push({ tx: tx + shiftX, ty: ty + shiftY, facing: facingOf(o.properties) });
    }

    for (const o of layerByName.get("collisions")?.objects ?? []) {
      // A box belongs to the region when its centre does, so a box that
      // overhangs a region edge still travels with the furniture it guards.
      const cx = Math.floor((o.x + o.width / 2) / size);
      const cy = Math.floor((o.y + o.height / 2) / size);
      if (!contains(region, cx, cy)) continue;
      out.collisions.push({
        x: o.x + shiftX * size,
        y: o.y + shiftY * size,
        width: o.width,
        height: o.height,
      });
    }
  }

  return out;
}

/**
 * Drops art that nothing in the game reacts to.
 *
 * The old office was dressed: rugs, pot plants, spare chairs, lockers, a
 * copier nobody uses. None of it is reachable — the scene only reacts to the
 * named points and the seats — so in an open room it reads as clutter rather
 * than as furniture.
 *
 * Everything within `radius` tiles of a point or a seat is kept, which is
 * enough to hold a whole assembly together: a whiteboard is three tiles wide,
 * a desk is four, and both sit beside their anchor. Collision boxes are pruned
 * against the same anchors — a box left behind after its art is gone is an
 * invisible wall in the middle of the floor.
 */
export function pruneToActionable(picked: Harvest, radius: number, tileSize: number): Harvest {
  const anchors = [...picked.pois, ...picked.spawns].map((a) => ({ tx: a.tx, ty: a.ty }));

  const nearAnchor = (tx: number, ty: number) =>
    anchors.some((a) => Math.abs(a.tx - tx) <= radius && Math.abs(a.ty - ty) <= radius);

  return {
    ...picked,
    placements: picked.placements.filter((p) => nearAnchor(p.tx, p.ty)),
    collisions: picked.collisions.filter((r) =>
      nearAnchor(
        Math.floor((r.x + r.width / 2) / tileSize),
        Math.floor((r.y + r.height / 2) / tileSize),
      ),
    ),
  };
}
