/**
 * Sheets that already match the game.
 *
 * Someone who drew, or generated, a sheet to the exact specification does not
 * want it read, interpreted and re-laid — they want it used. This path stores
 * the sheet as it came, and its only jobs are to recognise the format, tidy
 * the two things that are safe to tidy, and say plainly what is missing.
 *
 * Nothing here calls a model. A sheet in the right format works with no API
 * key on the server at all.
 */

import type { Bitmap } from "./png";
import { detectBackdrop, keyOutBackdrop, blankSheet } from "./ingest";
import {
  COLUMNS,
  FACINGS,
  FRAME_H,
  FRAME_W,
  FRAMES_PER_DIRECTION,
  SHEET_H,
  SHEET_W,
} from "./compose";

/** Rows 0-2 are all the game reads; a sheet that stops there is complete. */
export const MIN_EXACT_HEIGHT = FRAME_H * 3;

/**
 * Whether a sheet is in the game's format.
 *
 * Width is the only hard rule: the game hard-codes 56 columns, so a sheet of
 * any other width animates from the wrong pixels without an error. Height
 * need only cover the three rows that are read, in whole rows.
 */
export function isExactSheet(image: Bitmap): boolean {
  return image.width === SHEET_W && image.height >= MIN_EXACT_HEIGHT;
}

export interface NormalisedSheet {
  sheet: Bitmap;
  /** A flat opaque backdrop was found and cleared. */
  backdropRemoved: boolean;
  /** The sheet was shorter than the library height and was extended. */
  padded: boolean;
}

/**
 * Brings an exact-format sheet to the library's dimensions, untouched
 * otherwise.
 *
 * Padding is transparent rows below the art, so a minimal three-row sheet and
 * a full library sheet come out the same size and everything downstream —
 * the portrait cut, the slot audit, the file on disk — sees one shape.
 * Keying is done only when the corners agree on a colour; a sheet that is
 * already transparent is not touched at all.
 */
export function normaliseExactSheet(image: Bitmap): NormalisedSheet {
  const backdropRemoved = detectBackdrop(image) !== null;
  const keyed = backdropRemoved ? keyOutBackdrop(image) : image;

  if (keyed.height === SHEET_H) return { sheet: keyed, backdropRemoved, padded: false };

  const sheet = blankSheet(SHEET_W, SHEET_H);
  const rows = Math.min(keyed.height, SHEET_H);
  sheet.data.set(keyed.data.subarray(0, rows * SHEET_W * 4), 0);
  return { sheet, backdropRemoved, padded: keyed.height < SHEET_H };
}

/** Where a frame lives, in words a person can act on. */
export function slotName(row: number, column: number): string {
  const kind = row === 1 ? "idle" : "walk";
  const facing = FACINGS[Math.floor(column / FRAMES_PER_DIRECTION)];
  const frame = (column % FRAMES_PER_DIRECTION) + 1;
  return `${kind} ${facing} #${frame}`;
}

/**
 * Every animated slot with nothing drawn in it.
 *
 * The game reads 48 frames — idle and walk, four facings, six frames each —
 * and plays them whether or not anything is there. An empty one shows as the
 * character blinking out of existence for a tenth of a second, which is far
 * harder to diagnose from inside the game than from a list of slot names.
 */
export function emptySlots(sheet: Bitmap, minOpaquePixels = 40): string[] {
  const empty: string[] = [];
  for (const row of [1, 2]) {
    for (let column = 0; column < FACINGS.length * FRAMES_PER_DIRECTION; column++) {
      let opaque = 0;
      for (let y = 0; y < FRAME_H && opaque < minOpaquePixels; y++) {
        const base = ((row * FRAME_H + y) * sheet.width + column * FRAME_W) * 4;
        for (let x = 0; x < FRAME_W; x++) {
          if (sheet.data[base + x * 4 + 3] > 40) opaque++;
        }
      }
      if (opaque < minOpaquePixels) empty.push(slotName(row, column));
    }
  }
  return empty;
}

/** The sheet's own columns, for a reader who wants to check the maths. */
export const EXACT_FORMAT = {
  width: SHEET_W,
  height: SHEET_H,
  minHeight: MIN_EXACT_HEIGHT,
  frameWidth: FRAME_W,
  frameHeight: FRAME_H,
  columns: COLUMNS,
} as const;
