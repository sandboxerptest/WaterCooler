/**
 * Builds a shipped character sheet from a simple generated sprite sheet.
 *
 * The input is the layout the ChatGPT prompt asks for: a flat background,
 * one row per facing, each row holding a few idle frames followed by a walk
 * cycle, with clear gaps between frames. Rows are read top to bottom as the
 * facings given. Left is mirrored from right by the composer, so a sheet
 * needs only down, up and right. See lib/pixel/strip.ts for the cutting.
 *
 *   pnpm tsx scripts/build-character.ts <Name> [--source file.png] [--rows down,up,right] [--idle 3] [--walk 6] [--preview out.png]
 *
 * Reads  public/characters/examples/<Name>.png, or --source
 * Writes public/characters/<Name>_48x48.png — then add it to WORKER_SPRITES.
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { decodePng, encodePng } from "../lib/pixel/png";
import { detectBackdrop, keyOutBackdrop } from "../lib/pixel/ingest";
import {
  composeSheet,
  FACINGS,
  FRAME_H,
  FRAME_W,
  type Assignment,
  type Facing,
} from "../lib/pixel/compose";
import {
  commonScale,
  cutCells,
  drawScaled,
  palette,
  rowBands,
  snapToPalette,
  spriteCuts,
  type Cell,
} from "../lib/pixel/strip";

/** How tall the game's own characters stand in their 96px frame. */
const CHARACTER_HEIGHT = 72;

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
if (!name)
  throw new Error(
    "usage: build-character.ts <Name> [--source file.png] [--rows down,up,right] [--idle 3] [--walk 6]",
  );
const option = (flag: string, fallback: string) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const facings = option("--rows", "down,up,right").split(",") as Facing[];
for (const f of facings) if (!FACINGS.includes(f)) throw new Error(`unknown facing "${f}"`);
const idleCount = Number(option("--idle", "3"));
const walkCount = Number(option("--walk", "6"));
const preview = option("--preview", "");

const SOURCE = option("--source", join(process.cwd(), "public/characters/examples", `${name}.png`));
const OUTPUT = join(process.cwd(), "public/characters", `${name}_48x48.png`);

const raw = decodePng(readFileSync(SOURCE));
const backdrop = detectBackdrop(raw);
console.log(
  `${name}: ${raw.width}x${raw.height}, backdrop ${backdrop ? `rgb(${backdrop.join(",")})` : "transparent"}`,
);
// Tight: a dark outline on a dark backdrop must not be keyed away with it.
const image = keyOutBackdrop(raw, 12);

const bands = rowBands(image);
if (bands.length !== facings.length) {
  throw new Error(
    `found ${bands.length} rows but expected ${facings.length} (${facings.join(", ")})`,
  );
}

const perRow = idleCount + walkCount;
const cells: Cell[] = [];
const assignments: Assignment[] = [];
bands.forEach((band, r) => {
  const cuts = spriteCuts(image, band, perRow);
  const row = cutCells(image, band, cuts);
  console.log(`row ${r} (${facings[r]}): ${row.length} frames`);
  if (row.length !== perRow)
    throw new Error(`row ${r} has ${row.length} frames, expected ${perRow}`);
  row.forEach((cell, i) => {
    assignments.push({
      pose: cells.length,
      facing: facings[r],
      kind: i < idleCount ? "idle" : "walk",
    });
    cells.push(cell);
  });
});

const colours = palette(image, 16);
const sharp = snapToPalette(image, colours);
const scale = commonScale(cells, FRAME_W, FRAME_H, 2, CHARACTER_HEIGHT);
console.log(`scale ${scale.toFixed(3)}, ${colours.length} colours`);
const frames = cells.map((cell) =>
  snapToPalette(drawScaled(sharp, cell, scale, FRAME_W, FRAME_H), colours),
);

const sheet = composeSheet(frames, assignments);
writeFileSync(OUTPUT, encodePng(sheet));
console.log(`wrote ${OUTPUT}`);
if (preview) writeFileSync(preview, encodePng(sheet));
