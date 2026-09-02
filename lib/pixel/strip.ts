/**
 * Cutting a packed side-view sheet.
 *
 * Some sheets are not laid out on a grid with air between the sprites: the
 * frames are packed so tightly that feet and tails touch the neighbour, and
 * connected components run whole rows together. What never touches is the
 * bright body of one sprite and the next — only their dark edges meet — so
 * a row is cut where no bright ink is, and the sprite in each cell is the
 * largest body inside it with its own outline attached.
 *
 * Exports are often resampled — an image tool scaled the sheet on the way
 * out — which leaves anti-aliased edges that never were in the pixel art.
 * Snapping every pixel to the sprite's own palette puts the hard edges
 * back. Pure functions on bitmaps, nothing here touches the filesystem.
 */

import type { Bitmap } from "./png";
import type { Box } from "./ingest";

/** Ink per column (or row) for a region: how many pixels are more than faintly opaque. */
function inkProfile(image: Bitmap, region: Box, axis: "x" | "y", minAlpha = 40): Float64Array {
  const out = new Float64Array(axis === "x" ? region.width : region.height);
  for (let y = region.y; y < region.y + region.height; y++) {
    if (y < 0 || y >= image.height) continue;
    for (let x = region.x; x < region.x + region.width; x++) {
      if (x < 0 || x >= image.width) continue;
      if (image.data[(y * image.width + x) * 4 + 3] > minAlpha) {
        out[axis === "x" ? x - region.x : y - region.y]++;
      }
    }
  }
  return out;
}

/**
 * The rows of the sheet: runs of scanlines with ink, split by empty ones.
 * A run much shorter than the others is a stray mark, not a row.
 */
export function rowBands(image: Bitmap, minAlpha = 40): Box[] {
  const profile = inkProfile(
    image,
    { x: 0, y: 0, width: image.width, height: image.height },
    "y",
    minAlpha,
  );
  const runs: Box[] = [];
  let start = -1;
  for (let y = 0; y <= profile.length; y++) {
    const on = y < profile.length && profile[y] > 0;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      runs.push({ x: 0, y: start, width: image.width, height: y - start });
      start = -1;
    }
  }
  const tallest = Math.max(0, ...runs.map((r) => r.height));
  return runs.filter((r) => r.height >= tallest * 0.5);
}

/** Ink per column counting only bright pixels: the body, not the outline or edge fringe. */
function brightProfile(image: Bitmap, region: Box, minAlpha = 40, bright = BRIGHT): Float64Array {
  const out = new Float64Array(region.width);
  for (let y = region.y; y < region.y + region.height; y++) {
    if (y < 0 || y >= image.height) continue;
    for (let x = region.x; x < region.x + region.width; x++) {
      if (x < 0 || x >= image.width) continue;
      const i = (y * image.width + x) * 4;
      if (image.data[i + 3] <= minAlpha) continue;
      if (Math.max(image.data[i], image.data[i + 1], image.data[i + 2]) < bright) continue;
      out[x - region.x]++;
    }
  }
  return out;
}

/** Below this on every channel a pixel is outline or edge fringe, not body. */
export const BRIGHT = 48;

/**
 * Where to cut one row into its sprites.
 *
 * Packed sheets put each frame straight after the last at its own trimmed
 * width, so there is no fixed pitch to find. What holds is that the bright
 * body of one sprite never touches the next — only their dark outlines and
 * edge fringe do — so a column with no bright ink at all is a boundary.
 * Cuts go through the middle of every such gap.
 *
 * With a known `count`, the segmentation is nudged to it: too many pieces
 * (a raised arm cut off from its body) and the narrowest is merged into its
 * nearer neighbour; too few (two sprites that do meet) and the widest is
 * split at its faintest column.
 */
export function spriteCuts(image: Bitmap, band: Box, count?: number, minRun = 3): number[] {
  const profile = brightProfile(image, band);
  const segments: { start: number; end: number }[] = [];
  let start = -1;
  for (let i = 0; i <= profile.length; i++) {
    const on = i < profile.length && profile[i] > 0;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start >= minRun) segments.push({ start, end: i - 1 });
      start = -1;
    }
  }
  if (!segments.length) return [];

  if (count && count > 0) {
    while (segments.length > count) {
      let narrowest = 0;
      for (let k = 1; k < segments.length; k++) {
        if (
          segments[k].end - segments[k].start <
          segments[narrowest].end - segments[narrowest].start
        )
          narrowest = k;
      }
      const seg = segments[narrowest];
      const before = segments[narrowest - 1];
      const after = segments[narrowest + 1];
      const toBefore = before ? seg.start - before.end : Infinity;
      const toAfter = after ? after.start - seg.end : Infinity;
      if (toBefore <= toAfter && before) {
        before.end = seg.end;
        segments.splice(narrowest, 1);
      } else if (after) {
        after.start = seg.start;
        segments.splice(narrowest, 1);
      } else break;
    }
    while (segments.length < count) {
      let widest = 0;
      for (let k = 1; k < segments.length; k++) {
        if (segments[k].end - segments[k].start > segments[widest].end - segments[widest].start)
          widest = k;
      }
      const seg = segments[widest];
      const width = seg.end - seg.start + 1;
      if (width < minRun * 2) break;
      // The faintest column, away from the edges.
      let at = seg.start + Math.floor(width / 2);
      for (let x = seg.start + Math.floor(width / 4); x <= seg.end - Math.floor(width / 4); x++) {
        if (profile[x] < profile[at]) at = x;
      }
      segments.splice(widest, 1, { start: seg.start, end: at - 1 }, { start: at, end: seg.end });
    }
  }

  const cuts = [Math.max(0, band.x + segments[0].start - 1)];
  for (let k = 1; k < segments.length; k++) {
    cuts.push(band.x + Math.round((segments[k - 1].end + 1 + segments[k].start) / 2));
  }
  cuts.push(Math.min(image.width, band.x + segments[segments.length - 1].end + 2));
  return cuts;
}

export interface Cell {
  /** The cut rectangle. */
  box: Box;
  /** Which pixels in the cut are the sprite's own: the largest connected piece. */
  belongs: (x: number, y: number) => boolean;
  /** Tight bounds of that piece. */
  ink: Box;
}

/** Cut a band at the given x positions, and find the sprite in each cell. */
export function cutCells(image: Bitmap, band: Box, cuts: number[], minAlpha = 40): Cell[] {
  const cells: Cell[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const x0 = Math.max(0, cuts[k]);
    const x1 = Math.min(image.width, cuts[k + 1]);
    if (x1 <= x0) continue;
    const box = { x: x0, y: band.y, width: x1 - x0, height: band.height };
    const cell = largestPiece(image, box, minAlpha);
    if (cell) cells.push(cell);
  }
  // A sliver — the top of the row below poking into this band — is not a
  // sprite. Sprites in a row are all about as tall as each other.
  const tallest = Math.max(0, ...cells.map((c) => c.ink.height));
  return cells.filter((c) => c.ink.height >= tallest * 0.5);
}

/**
 * The largest piece of ink inside a rectangle, or null when it is empty.
 *
 * Pieces are found on the bright pixels alone — the body — and the dark
 * ones, outline and edge fringe, are then given to whichever body they
 * touch. Two sprites whose feet meet are joined only by their dark edges,
 * so this keeps them apart where plain connectivity would run them together.
 * Within one sprite, bright pieces a dark belt has split are put back
 * together by their columns.
 */
export function largestPiece(image: Bitmap, box: Box, minAlpha = 40, bright = BRIGHT): Cell | null {
  const { width: w, height: h } = box;
  const labels = new Int32Array(w * h);
  const index = (x: number, y: number) => ((box.y + y) * image.width + box.x + x) * 4;
  const inked = (x: number, y: number) => image.data[index(x, y) + 3] > minAlpha;
  const isBody = (x: number, y: number) => {
    const i = index(x, y);
    return inked(x, y) && Math.max(image.data[i], image.data[i + 1], image.data[i + 2]) >= bright;
  };
  let next = 0;
  const sizes: number[] = [];
  const spans: { minX: number; maxX: number }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (labels[y * w + x] || !isBody(x, y)) continue;
      const label = ++next;
      let size = 0;
      const span = { minX: x, maxX: x };
      spans[label] = span;
      const stack = [[x, y]];
      labels[y * w + x] = label;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        size++;
        span.minX = Math.min(span.minX, cx);
        span.maxX = Math.max(span.maxX, cx);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (labels[ny * w + nx] || !isBody(nx, ny)) continue;
            labels[ny * w + nx] = label;
            stack.push([nx, ny]);
          }
        }
      }
      sizes[label] = size;
    }
  }
  if (!next) return null;
  let best = 1;
  for (let l = 2; l <= next; l++) if (sizes[l] > sizes[best]) best = l;

  // A dark sash or belt splits a body into bright pieces stacked one above
  // the other. A neighbouring sprite sits beside, never under: so any piece
  // whose columns mostly overlap the body's is part of it. Repeat until
  // nothing more joins, since the body's span grows as pieces do.
  const joined = new Set<number>([best]);
  const body = { ...spans[best] };
  for (let grew = true; grew; ) {
    grew = false;
    for (let l = 1; l <= next; l++) {
      if (joined.has(l)) continue;
      const span = spans[l];
      const overlap = Math.min(span.maxX, body.maxX) - Math.max(span.minX, body.minX) + 1;
      if (overlap < (span.maxX - span.minX + 1) * 0.5) continue;
      joined.add(l);
      body.minX = Math.min(body.minX, span.minX);
      body.maxX = Math.max(body.maxX, span.maxX);
      grew = true;
    }
  }
  for (let i = 0; i < labels.length; i++) if (labels[i] && joined.has(labels[i])) labels[i] = best;

  // Dark pixels join the body they touch; a few passes reach a thick outline.
  for (let pass = 0; pass < 3; pass++) {
    const grown = labels.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (labels[y * w + x] || !inked(x, y)) continue;
        for (let dy = -1; dy <= 1 && !grown[y * w + x]; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (labels[ny * w + nx] === best) {
              grown[y * w + x] = best;
              break;
            }
          }
        }
      }
    }
    labels.set(grown);
  }

  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (labels[y * w + x] !== best) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    box,
    ink: { x: box.x + minX, y: box.y + minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    belongs: (x, y) => {
      const lx = x - box.x;
      const ly = y - box.y;
      if (lx < 0 || ly < 0 || lx >= w || ly >= h) return false;
      return labels[ly * w + lx] === best;
    },
  };
}

export type Rgb = [number, number, number];

/**
 * The colours a sprite is actually drawn in.
 *
 * Resampling leaves a halo of in-between colours along every edge, but each
 * of those is rare; the real colours are the frequent ones. Colours are
 * bucketed coarsely and the buckets merged when they are near each other —
 * so five slightly different near-blacks become one outline colour and do
 * not crowd out the crest's orange — then the most frequent are kept.
 */
export function palette(image: Bitmap, count = 14, minAlpha = 128, bucket = 16, merge = 40): Rgb[] {
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] < minAlpha) continue;
    const r = image.data[i];
    const g = image.data[i + 1];
    const b = image.data[i + 2];
    const key = `${Math.floor(r / bucket)},${Math.floor(g / bucket)},${Math.floor(b / bucket)}`;
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    buckets.set(key, e);
  }
  const merged: { n: number; r: number; g: number; b: number }[] = [];
  for (const e of [...buckets.values()].sort((a, b) => b.n - a.n)) {
    const mean: Rgb = [e.r / e.n, e.g / e.n, e.b / e.n];
    const near = merged.find((m) => {
      const c: Rgb = [m.r / m.n, m.g / m.n, m.b / m.n];
      return Math.hypot(c[0] - mean[0], c[1] - mean[1], c[2] - mean[2]) < merge;
    });
    if (near) {
      near.n += e.n;
      near.r += e.r;
      near.g += e.g;
      near.b += e.b;
    } else merged.push({ ...e });
  }
  return merged
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((e) => [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)] as Rgb);
}

/** Every pixel to its nearest palette colour, and alpha to all or nothing. */
export function snapToPalette(image: Bitmap, colours: Rgb[], minAlpha = 128): Bitmap {
  const data = new Uint8Array(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] < minAlpha) continue;
    let best = colours[0];
    let bestD = Infinity;
    for (const c of colours) {
      const d =
        (c[0] - image.data[i]) ** 2 +
        (c[1] - image.data[i + 1]) ** 2 +
        (c[2] - image.data[i + 2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    data[i] = best[0];
    data[i + 1] = best[1];
    data[i + 2] = best[2];
    data[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data };
}

/**
 * Draw one sprite into a frame at a given scale, feet on the bottom, centred.
 *
 * Every frame of a character must use the same scale — fitting each to the
 * frame on its own makes a crouched step shorter than a standing one, so the
 * character grows and shrinks as it walks. Area-averaged, then the caller
 * snaps the palette again to keep the edges hard.
 */
export function drawScaled(
  source: Bitmap,
  cell: Cell,
  scale: number,
  frameWidth: number,
  frameHeight: number,
  bottomPadding = 2,
): Bitmap {
  const out = new Uint8Array(frameWidth * frameHeight * 4);
  const { ink } = cell;
  const drawW = Math.max(1, Math.round(ink.width * scale));
  const drawH = Math.max(1, Math.round(ink.height * scale));
  const offsetX = Math.round((frameWidth - drawW) / 2);
  const offsetY = frameHeight - bottomPadding - drawH;
  for (let y = 0; y < drawH; y++) {
    for (let x = 0; x < drawW; x++) {
      const sx0 = ink.x + Math.floor((x * ink.width) / drawW);
      const sx1 = Math.max(sx0 + 1, ink.x + Math.floor(((x + 1) * ink.width) / drawW));
      const sy0 = ink.y + Math.floor((y * ink.height) / drawH);
      const sy1 = Math.max(sy0 + 1, ink.y + Math.floor(((y + 1) * ink.height) / drawH));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          n++;
          if (!cell.belongs(sx, sy)) continue;
          const i = (sy * source.width + sx) * 4;
          const alpha = source.data[i + 3];
          r += source.data[i] * alpha;
          g += source.data[i + 1] * alpha;
          b += source.data[i + 2] * alpha;
          a += alpha;
        }
      }
      if (!n || !a) continue;
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

/**
 * The one scale for every cell: the largest that fits them all inside the
 * frame, and no taller than `targetHeight` — the game's own characters stand
 * about 72px tall in a 96px frame, and a new one should stand beside them,
 * not over them.
 */
export function commonScale(
  cells: Cell[],
  frameWidth: number,
  frameHeight: number,
  padding = 2,
  targetHeight = frameHeight - padding,
): number {
  let scale = Infinity;
  for (const { ink } of cells) {
    scale = Math.min(scale, (frameWidth - padding * 2) / ink.width, targetHeight / ink.height);
  }
  return Number.isFinite(scale) ? scale : 1;
}
