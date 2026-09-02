/**
 * Builds a character sheet from a base sheet and a set of colours.
 *
 * Every generated character is a re-skin of one library sheet, never a
 * freshly drawn one. That is what makes the result pixel-perfect by
 * construction: the geometry, the frame grid, the animation timing and the
 * silhouette are the artist's, untouched, and only the colours move. A sheet
 * drawn from scratch would have to re-earn all of that and would still not
 * line up with the characters already in the room.
 */

import { decodePng, encodePng, type Bitmap } from "./png";
import { colourKey, parseHex, remapRamp, type Rgb } from "./palette";

/** The sheet every generated character is built from. */
export const BASE_SHEET = "Premade_Character_48x48_09.png";

export const SHEET_WIDTH = 2688;
export const SHEET_HEIGHT = 1968;

/**
 * The colour ramps of the base sheet, read off it directly and ordered
 * light to dark.
 *
 * The outline (#46465e and its shadow #3a3a50) is deliberately absent. It
 * traces the whole silhouette — hair, arms, face, boots — so recolouring it
 * with any one material would smear that material's hue around the entire
 * character. Left alone, it keeps every generated character sitting in the
 * same visual family as the ones already in the game.
 */
export const BASE_RAMPS = {
  hair: ["#898171", "#79746f", "#706663"],
  skin: ["#ffb893", "#f69784", "#e1a382"],
  outfit: ["#787d93", "#565972"],
  shoes: ["#f8d239", "#f2b22b", "#caaa00"],
} as const;

export type CharacterRole = keyof typeof BASE_RAMPS;

export type CharacterColours = Record<CharacterRole, string>;

/** The base sheet's own colours, for previews and as a fallback. */
export const BASE_COLOURS: CharacterColours = {
  hair: "#79746f",
  skin: "#ffb893",
  outfit: "#787d93",
  shoes: "#f2b22b",
};

/**
 * A lookup from every base colour to its replacement.
 *
 * Built once per character and then applied per pixel, because a sheet is
 * 5.3 million pixels and doing colour maths on each of them would be slow
 * enough to notice.
 */
export function buildColourMap(colours: CharacterColours): Map<number, Rgb> {
  const map = new Map<number, Rgb>();
  for (const [role, ramp] of Object.entries(BASE_RAMPS) as Array<
    [CharacterRole, readonly string[]]
  >) {
    const base = ramp.map(parseHex);
    const replacement = remapRamp(base, parseHex(colours[role]));
    base.forEach((from, i) => {
      map.set(colourKey(from.r, from.g, from.b), replacement[i]);
    });
  }
  return map;
}

/**
 * Applies a colour map to a whole sheet.
 *
 * Fully transparent pixels are skipped rather than recoloured. A sheet is
 * mostly empty space, and writing colour into it would leave a halo the
 * moment anything scaled or filtered the image.
 */
export function recolourSheet(sheet: Bitmap, map: Map<number, Rgb>): Bitmap {
  const data = new Uint8Array(sheet.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const to = map.get(colourKey(data[i], data[i + 1], data[i + 2]));
    if (!to) continue;
    data[i] = to.r;
    data[i + 1] = to.g;
    data[i + 2] = to.b;
  }
  return { width: sheet.width, height: sheet.height, data };
}

/** Reads the base sheet, re-skins it, and returns an encoded PNG. */
export function renderCharacterSheet(baseFile: Buffer, colours: CharacterColours): Buffer {
  const sheet = decodePng(baseFile);
  if (sheet.width !== SHEET_WIDTH || sheet.height !== SHEET_HEIGHT) {
    // The frame grid is hard-coded in the animation config; a sheet of the
    // wrong size produces a character animated from the wrong pixels rather
    // than an error, which is far harder to spot.
    throw new Error(
      `Base sheet must be ${SHEET_WIDTH}x${SHEET_HEIGHT}, got ${sheet.width}x${sheet.height}`,
    );
  }
  return encodePng(recolourSheet(sheet, buildColourMap(colours)));
}
