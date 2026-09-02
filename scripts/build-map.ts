/**
 * Generates public/maps/office3.json from the room spec.
 *
 * Writes a new file rather than overwriting office2.json, so the old office
 * stays intact and the scene can be pointed back at it in one line.
 *
 *   pnpm build:map
 */

import { readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { generateMap, type TilesetRef } from "../lib/map/generate";
import { buildOfficeSpec } from "../lib/map/office";
import type { SourceMap } from "../lib/map/harvest";

const MAPS = join(process.cwd(), "public", "maps");
const SOURCE = join(MAPS, "office2.json");
const OUTPUT = join(MAPS, "office3.json");

const raw = JSON.parse(readFileSync(SOURCE, "utf8")) as SourceMap & { tilesets: TilesetRef[] };

/**
 * Four tilesets in the old map still point at the upstream author's own
 * Pictures folder. They resolve only because the loader takes the basename and
 * looks in /tilesets/ — luck, not design. Rewrite them on the way out.
 */
const tilesets: TilesetRef[] = raw.tilesets.map((ts) => ({
  ...ts,
  image: `../tilesets/${basename(ts.image)}`,
}));

const spec = buildOfficeSpec(raw);
const map = generateMap(spec, tilesets);

writeFileSync(OUTPUT, JSON.stringify(map, null, 1));

const counts = {
  tiles: spec.placements.length,
  pois: spec.pois.length,
  spawns: spec.spawns.length,
  collisions: (spec.collisions?.length ?? 0) + 0,
  transitions: spec.transitions.length,
};
console.log(`wrote ${OUTPUT}`);
console.log(
  `  ${map.width}x${map.height} tiles · ${counts.tiles} placed · ${counts.pois} pois · ` +
    `${counts.spawns} spawns · ${counts.collisions} collision boxes · ${counts.transitions} transitions`,
);
console.log("  points:", spec.pois.map((p) => p.name).join(", "));
