/**
 * Generates the maps from their room specs: office3.json (a bare lobby),
 * one lobby per tenant with its game in the corner, and floor.json (the
 * floors above, where the desks go).
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
import { buildFloorSpec } from "../lib/map/floor";
import type { SourceMap } from "../lib/map/harvest";

const MAPS = join(process.cwd(), "public", "maps");
const SOURCE = join(MAPS, "office2.json");

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

for (const [file, build] of [
  ["office3.json", (src: SourceMap) => buildOfficeSpec(src)],
  ["lobby-castle-atlantic.json", (src: SourceMap) => buildOfficeSpec(src, "pong")],
  ["lobby-sandbox-erp.json", (src: SourceMap) => buildOfficeSpec(src, "pinball")],
  ["floor.json", buildFloorSpec],
] as const) {
  const spec = build(raw);
  const map = generateMap(spec, tilesets);
  const output = join(MAPS, file);
  writeFileSync(output, JSON.stringify(map, null, 1));
  console.log(
    `wrote ${output}: ${map.width}x${map.height} tiles · ${spec.placements.length} placed · ` +
      `${spec.spawns.length} spawns · ${spec.transitions.map((t) => t.name).join("+")}`,
  );
}
