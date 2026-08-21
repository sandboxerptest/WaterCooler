/**
 * Sealing the office.
 *
 * The walls are hand-placed rectangles in Tiled, so the building is only as
 * closed as someone remembered to make it — and it was not: four separate
 * openings let you walk straight out into the void, where the whole margin of
 * the map is yours to wander.
 *
 * Rather than patch each hole, the boundary is worked out from the map: find
 * everything outside the building, and make all of it solid. Holes that exist
 * today and holes drawn in tomorrow are both covered, and the office cannot
 * silently spring a leak the next time the map is edited.
 *
 * Pure functions over a grid of booleans, so this can be checked without a
 * browser or a running game.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** True where a tile has something to stand on. */
export type FloorGrid = boolean[][];

/**
 * Which tiles are outside the building: everything with no floor that can be
 * reached from the edge of the map without crossing a floor tile.
 *
 * Reached from the edge, rather than "any tile without floor", because the
 * inside is full of tiles with no floor of their own — under walls, under
 * furniture — and those must stay as they are. Only the outside is sealed.
 */
export function findExterior(floored: FloorGrid): boolean[][] {
  const height = floored.length;
  const width = height === 0 ? 0 : floored[0].length;
  const exterior = Array.from({ length: height }, () => Array<boolean>(width).fill(false));
  if (width === 0) return exterior;

  const queue: Array<[number, number]> = [];
  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    if (exterior[y][x] || floored[y][x]) return;
    exterior[y][x] = true;
    queue.push([x, y]);
  };

  for (let x = 0; x < width; x++) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    visit(0, y);
    visit(width - 1, y);
  }

  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }

  return exterior;
}

/**
 * Turn the outside into as few rectangles as possible.
 *
 * Merged into horizontal runs because each rectangle becomes a static body:
 * one per tile would be several hundred, and they tile the same space.
 */
export function mergeRuns(tiles: boolean[][], tileSize: number): Rect[] {
  const rects: Rect[] = [];

  for (let y = 0; y < tiles.length; y++) {
    let start = -1;
    for (let x = 0; x <= tiles[y].length; x++) {
      const solid = x < tiles[y].length && tiles[y][x];
      if (solid && start === -1) start = x;
      if (!solid && start !== -1) {
        rects.push({
          x: start * tileSize,
          y: y * tileSize,
          width: (x - start) * tileSize,
          height: tileSize,
        });
        start = -1;
      }
    }
  }

  return rects;
}

/** The rectangles that make the outside of the building solid. */
export function exteriorRects(floored: FloorGrid, tileSize: number): Rect[] {
  return mergeRuns(findExterior(floored), tileSize);
}
