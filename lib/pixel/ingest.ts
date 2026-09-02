/**
 * Turns an arbitrary character sheet into game frames.
 *
 * An image model asked for "a character sheet" returns a picture of a grid:
 * poses at whatever size it felt like, on whatever background it chose, spaced
 * however it liked. The game needs the opposite of that — a rigid 48x96 grid,
 * 56 columns wide, with the walk cycle in known slots.
 *
 * This module is the bridge. It keys out the background, finds each drawn
 * figure, works out the grid they were arranged in, and rescales every figure
 * into the game's frame box standing on the same floor line. None of it
 * assumes the sheet came from any particular tool, which is the point: the
 * art can come from an image model, an artist, or a screenshot.
 */

import type { Bitmap } from "./png";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const alphaAt = (b: Bitmap, x: number, y: number) => b.data[(y * b.width + x) * 4 + 3];

/**
 * How far apart two colours are, 0-255ish.
 *
 * Manhattan rather than Euclidean: it is cheaper, and for deciding "is this
 * the flat backdrop or the character" the difference never matters.
 */
function distance(a: Uint8Array, i: number, r: number, g: number, b: number): number {
  return Math.abs(a[i] - r) + Math.abs(a[i + 1] - g) + Math.abs(a[i + 2] - b);
}

/**
 * The colour the sheet was drawn on, if it was drawn on one.
 *
 * Read from the four corners: a character sheet has its figures in the middle,
 * so the corners are backdrop unless the image is already cut out. Returns
 * null when the corners disagree or are already transparent, which is the
 * signal to leave the image alone.
 */
export function detectBackdrop(image: Bitmap): [number, number, number] | null {
  const { width: w, height: h, data } = image;
  if (w < 4 || h < 4) return null;

  const corners = [
    [1, 1],
    [w - 2, 1],
    [1, h - 2],
    [w - 2, h - 2],
  ].map(([x, y]) => (y * w + x) * 4);

  if (corners.some((i) => data[i + 3] < 250)) return null;

  const [r, g, b] = [data[corners[0]], data[corners[0] + 1], data[corners[0] + 2]];
  for (const i of corners) {
    if (distance(data, i, r, g, b) > 30) return null;
  }
  return [r, g, b];
}

/**
 * Removes the backdrop.
 *
 * The tolerance is generous because these sheets are rarely flat — an image
 * model's "black background" is full of near-black noise and JPEG ringing. A
 * strict match leaves a confetti of stray pixels that the sprite finder then
 * reads as extra characters.
 */
export function keyOutBackdrop(image: Bitmap, tolerance = 60): Bitmap {
  const backdrop = detectBackdrop(image);
  const data = new Uint8Array(image.data);
  if (!backdrop) return { ...image, data };

  const [r, g, b] = backdrop;
  for (let i = 0; i < data.length; i += 4) {
    if (distance(data, i, r, g, b) <= tolerance) data[i + 3] = 0;
  }
  return { width: image.width, height: image.height, data };
}

/**
 * Every separately drawn figure, as a bounding box.
 *
 * A flood fill over opaque pixels, iterative rather than recursive because a
 * full-height figure on a large sheet is tens of thousands of pixels deep and
 * would blow the call stack.
 *
 * Diagonal neighbours count. A pixel-art outline frequently touches only at a
 * corner, and treating those as separate would slice one character into a
 * dozen fragments.
 */
export interface Figures {
  boxes: Box[];
  /**
   * Which figure each pixel belongs to: the 1-based index into `boxes`, or 0
   * for background. Kept so a figure can be cut out by membership rather than
   * by bounding box — boxes overlap whenever one pose leans into the next.
   */
  labels: Int32Array;
}

export function findFigures(image: Bitmap, minAlpha = 40): Figures {
  const { width: w, height: h } = image;
  const labels = new Int32Array(w * h);
  const boxes: Box[] = [];
  const stack: number[] = [];

  for (let start = 0; start < w * h; start++) {
    if (labels[start] || image.data[start * 4 + 3] < minAlpha) continue;

    const id = boxes.length + 1;
    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;
    stack.push(start);
    labels[start] = id;

    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (labels[n] || image.data[n * 4 + 3] < minAlpha) continue;
          labels[n] = id;
          stack.push(n);
        }
      }
    }

    boxes.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
  }

  return { boxes, labels };
}

/**
 * Throws away everything that is not a character.
 *
 * Sheets carry labels ("8-BIT"), stray marks and antialiasing crumbs, and all
 * of them survive the flood fill as their own little boxes. Characters are the
 * big things, so the median height of the largest few sets the bar — an
 * absolute pixel threshold would need retuning for every sheet size.
 */
export interface KeptFigure {
  box: Box;
  /** The figure's id in the label map from findFigures. */
  label: number;
}

export function keepFigures(boxes: Box[], sheet: Bitmap): KeptFigure[] {
  if (boxes.length === 0) return [];

  const heights = boxes.map((b) => b.height).sort((a, b) => b - a);
  const reference = heights[Math.min(heights.length - 1, Math.floor(heights.length / 4))];
  const minHeight = Math.max(reference * 0.45, sheet.height * 0.04);

  const kept: KeptFigure[] = [];
  boxes.forEach((b, i) => {
    if (b.height < minHeight) return;
    // Text is wide and short; a standing character never is.
    if (b.width > b.height * 3) return;
    // A band spanning the whole sheet is a border or a divider.
    if (b.width > sheet.width * 0.9) return;
    kept.push({ box: b, label: i + 1 });
  });
  return kept;
}

/**
 * Groups figures into the rows they were drawn in.
 *
 * Sorting by y alone fails as soon as one pose is drawn slightly higher than
 * its neighbours, which is normal — a running pose leans, a sitting one
 * drops. Figures join a row when they overlap it vertically at all, which
 * tolerates that drift.
 */
export function groupIntoRows(figures: KeptFigure[]): KeptFigure[][] {
  const rows: KeptFigure[][] = [];

  for (const figure of [...figures].sort((a, b) => a.box.y - b.box.y)) {
    const { box } = figure;
    const midpoint = box.y + box.height / 2;
    const row = rows.find((r) => {
      const top = Math.min(...r.map((f) => f.box.y));
      const bottom = Math.max(...r.map((f) => f.box.y + f.box.height));
      return midpoint >= top && midpoint <= bottom;
    });
    if (row) row.push(figure);
    else rows.push([figure]);
  }

  for (const row of rows) row.sort((a, b) => a.box.x - b.box.x);
  return rows;
}

/**
 * Draws one figure into a frame-sized box.
 *
 * Two rules make a cut-out sit correctly in a tile-based game: it keeps its
 * proportions, and its feet land on the bottom of the frame. Centre it
 * vertically instead and characters bob at different heights as they walk.
 *
 * Downscaling averages over the source area rather than sampling one pixel.
 * These sheets are big — a figure can be 300px tall on its way to 96 — and
 * nearest-neighbour at that ratio drops whole features, losing an eye or a
 * strap between one frame and the next. Colour is weighted by alpha so the
 * transparent surround cannot bleed a dark halo into the edges.
 */
export function fitIntoFrame(
  source: Bitmap,
  box: Box,
  frameWidth: number,
  frameHeight: number,
  /** Leave a little air so the tallest pose is not flush with the tile edge. */
  padding = 2,
  /**
   * Which source pixels are this figure's. Without it the whole bounding box
   * is copied, and a neighbour's foot or raised arm that overlaps the box
   * comes along as a stray mark in the corner of the frame.
   */
  belongs?: (x: number, y: number) => boolean,
): Bitmap {
  const out = new Uint8Array(frameWidth * frameHeight * 4);
  const usableW = frameWidth - padding * 2;
  const usableH = frameHeight - padding;
  const scale = Math.min(usableW / box.width, usableH / box.height);
  const drawW = Math.max(1, Math.round(box.width * scale));
  const drawH = Math.max(1, Math.round(box.height * scale));
  const offsetX = Math.round((frameWidth - drawW) / 2);
  const offsetY = frameHeight - drawH;

  for (let y = 0; y < drawH; y++) {
    for (let x = 0; x < drawW; x++) {
      const sx0 = box.x + Math.floor((x * box.width) / drawW);
      const sx1 = Math.max(sx0 + 1, box.x + Math.floor(((x + 1) * box.width) / drawW));
      const sy0 = box.y + Math.floor((y * box.height) / drawH);
      const sy1 = Math.max(sy0 + 1, box.y + Math.floor(((y + 1) * box.height) / drawH));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
          if (belongs && !belongs(sx, sy)) continue;
          const i = (sy * source.width + sx) * 4;
          const alpha = source.data[i + 3];
          r += source.data[i] * alpha;
          g += source.data[i + 1] * alpha;
          b += source.data[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      if (!n || a === 0) continue;

      const dx = offsetX + x;
      const dy = offsetY + y;
      if (dx < 0 || dy < 0 || dx >= frameWidth || dy >= frameHeight) continue;
      const d = (dy * frameWidth + dx) * 4;
      out[d] = Math.round(r / a);
      out[d + 1] = Math.round(g / a);
      out[d + 2] = Math.round(b / a);
      out[d + 3] = Math.round(a / n);
    }
  }

  return { width: frameWidth, height: frameHeight, data: out };
}

/** Copies a frame into a slot of a larger sheet. */
export function blitFrame(sheet: Bitmap, frame: Bitmap, column: number, row: number) {
  const x0 = column * frame.width;
  const y0 = row * frame.height;
  for (let y = 0; y < frame.height; y++) {
    const dy = y0 + y;
    if (dy < 0 || dy >= sheet.height) continue;
    for (let x = 0; x < frame.width; x++) {
      const dx = x0 + x;
      if (dx < 0 || dx >= sheet.width) continue;
      const s = (y * frame.width + x) * 4;
      const d = (dy * sheet.width + dx) * 4;
      sheet.data[d] = frame.data[s];
      sheet.data[d + 1] = frame.data[s + 1];
      sheet.data[d + 2] = frame.data[s + 2];
      sheet.data[d + 3] = frame.data[s + 3];
    }
  }
}

export function blankSheet(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** Every figure found on a sheet, in reading order, with its row. */
export interface DetectedPose {
  box: Box;
  row: number;
  column: number;
  /** Cuts this figure — and only this figure — into a frame. */
  toFrame: (frameWidth: number, frameHeight: number) => Bitmap;
}

/**
 * Drops a figure that is really two.
 *
 * When a figure in one row touches the figure below it — a raised arm, a
 * hat brim, a stray pixel — the flood fill joins them into one component
 * twice the height of everything around it. Cut out and scaled to fit, that
 * becomes two tiny stacked people in one frame. Height is judged against the
 * figure's own row, so a tall character on a short sheet is not penalised.
 */
export function dropMergedFigures(rows: KeptFigure[][], ratio = 1.6): KeptFigure[][] {
  return rows.map((row) => {
    if (row.length < 3) return row;
    const heights = row.map((f) => f.box.height).sort((a, b) => a - b);
    const median = heights[heights.length >> 1];
    return row.filter((f) => f.box.height <= median * ratio);
  });
}

export function detectPoses(image: Bitmap): { keyed: Bitmap; poses: DetectedPose[] } {
  const keyed = keyOutBackdrop(image);
  const { boxes, labels } = findFigures(keyed);
  const rows = dropMergedFigures(groupIntoRows(keepFigures(boxes, keyed)));
  const poses: DetectedPose[] = [];
  rows.forEach((row, rowIndex) => {
    row.forEach(({ box, label }, columnIndex) => {
      const belongs = (x: number, y: number) => labels[y * keyed.width + x] === label;
      poses.push({
        box,
        row: rowIndex,
        column: columnIndex,
        toFrame: (fw, fh) => fitIntoFrame(keyed, box, fw, fh, 2, belongs),
      });
    });
  });
  return { keyed, poses };
}

export { alphaAt };

/**
 * What happened when a sheet could not be read, in words a person can act on.
 *
 * "No figures found" is a dead end. The reason is always one of a few
 * specific things — a backdrop that is not one flat colour, figures far too
 * small to become a 48x96 sprite, or a whole library-style sheet with
 * hundreds of poses where the app expected a couple of dozen — and each has
 * a different fix, so the message names which.
 */
export interface SheetDiagnosis {
  width: number;
  height: number;
  backdrop: "flat" | "not flat";
  figures: number;
  /** Median figure height in pixels, when there are any. */
  figureHeight: number;
  reason: string;
  advice: string;
}

/** A sprite is 96 tall and the character stands about 64 of that. */
export const USABLE_FIGURE_HEIGHT = 40;

export function diagnoseSheet(
  image: Bitmap,
  keyed: Bitmap,
  poses: DetectedPose[],
  maxFigures: number,
): SheetDiagnosis {
  const heights = poses.map((p) => p.box.height).sort((a, b) => a - b);
  const figureHeight = heights.length ? heights[heights.length >> 1] : 0;
  const backdrop: SheetDiagnosis["backdrop"] = detectBackdrop(image) ? "flat" : "not flat";
  const base = {
    width: image.width,
    height: image.height,
    backdrop,
    figures: poses.length,
    figureHeight,
  };

  if (poses.length === 0) {
    return backdrop === "not flat"
      ? {
          ...base,
          reason: "No figures were found, and the background is not one flat colour.",
          advice:
            "Generate the sheet on a plain flat black background with clear space around every figure — gradients and textures cannot be told from the character.",
        }
      : {
          ...base,
          reason: "No figures were found on the sheet.",
          advice:
            "Check the figures are opaque and stand clear of the edges, with space between them.",
        };
  }

  if (poses.length > maxFigures) {
    return {
      ...base,
      reason: `Found ${poses.length} figures — this looks like a complete library-style sheet with every pose, not the ${maxFigures}-or-fewer the app lays out itself.`,
      advice:
        image.width === SHEET_WIDTH_HINT
          ? "It is the right width, so upload it as an exact sheet."
          : `Either export it at exactly ${SHEET_WIDTH_HINT} px wide so it is used as-is, or generate a simpler sheet: four rows (front, right, left, back), about five large figures each, on flat black.`,
    };
  }

  if (figureHeight < USABLE_FIGURE_HEIGHT) {
    return {
      ...base,
      reason: `The figures are only about ${figureHeight} px tall. A character needs roughly 64 px of real drawing to fill its 96 px frame, and there is no way to invent detail that was never drawn.`,
      advice:
        "Generate fewer, larger figures — around twenty on the canvas rather than hundreds — or a larger canvas.",
    };
  }

  return { ...base, reason: "", advice: "" };
}

/** The exact-format width, repeated here so the advice can name it. */
const SHEET_WIDTH_HINT = 2688;

/**
 * A model's rendition of a whole library sheet.
 *
 * Asked for "a sprite sheet", an image model will often reproduce the layout
 * of a library one: a short row of thumbnails, then idle and walk rows of
 * twenty-odd figures, then every other pose the library has. Hundreds of
 * figures — but the game only reads the two animated rows, and those two
 * fit comfortably under the figure cap. Recognise the shape, keep the two
 * rows, drop the rest.
 *
 * Returned re-indexed from zero, so the reader and the composer see a small
 * ordinary sheet. Null when the sheet does not have this shape.
 */
export function pickLibraryRows(poses: DetectedPose[], minPerRow = 16): DetectedPose[] | null {
  const byRow = new Map<number, DetectedPose[]>();
  for (const p of poses) {
    if (!byRow.has(p.row)) byRow.set(p.row, []);
    byRow.get(p.row)!.push(p);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  if (rows.length < 3) return null;

  // The animated rows are the first two long ones after the thumbnails.
  const long = rows.filter((r) => byRow.get(r)!.length >= minPerRow);
  if (long.length < 2 || long[0] < 1) return null;

  const idle = byRow.get(long[0])!;
  const walk = byRow.get(long[1])!;
  return [...idle, ...walk].map((p, i) => ({
    ...p,
    row: i < idle.length ? 1 : 2,
    column: i < idle.length ? i : i - idle.length,
  }));
}

/**
 * Facings from where each figure sits, for a sheet in the library's order.
 *
 * Used only when no model is available to look: the library lays every row
 * out right, up, left, down in equal quarters, and a model copying it does
 * the same. Position across the row, not index along it, so two figures that
 * touched and merged do not shift every facing after them.
 */
export function positionalAssignments(
  poses: DetectedPose[],
  facings: readonly string[],
): Array<{ pose: number; facing: string; kind: "idle" | "walk" }> {
  const out: Array<{ pose: number; facing: string; kind: "idle" | "walk" }> = [];
  for (const row of [1, 2] as const) {
    const members = poses.map((p, i) => ({ p, i })).filter((x) => x.p.row === row);
    if (!members.length) continue;
    const left = Math.min(...members.map((x) => x.p.box.x));
    const right = Math.max(...members.map((x) => x.p.box.x + x.p.box.width));
    const span = Math.max(1, right - left);
    for (const { p, i } of members) {
      const centre = p.box.x + p.box.width / 2 - left;
      const quarter = Math.min(facings.length - 1, Math.floor((centre / span) * facings.length));
      out.push({ pose: i, facing: facings[quarter], kind: row === 1 ? "idle" : "walk" });
    }
  }
  return out;
}
