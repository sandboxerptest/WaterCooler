/**
 * What stands on the world map besides the buildings.
 *
 * The ground is a grid of grass with paved areas laid on top: a promenade
 * along the bottom, a plaza in the middle, and a path up to each door. The
 * props are placed by their feet (bottom centre), which is also how they
 * sort against people: whoever's feet are lower is drawn in front.
 *
 * The props are drawn by scripts/make-world-art.mjs in the interiors'
 * palette. Nothing here touches Phaser, so the layout can be checked
 * without a browser.
 */

import {
  BUILDINGS,
  TILE,
  WORLD_COLUMNS,
  WORLD_HEIGHT,
  WORLD_ROWS,
  WORLD_SPAWN,
  WORLD_WIDTH,
  type Rect,
} from "./tenants";

export type Ground = "grass" | "paving" | "kerb";

/** Paved ground, in tiles. Order does not matter; anything paved is walkable. */
export const PAVED: readonly Rect[] = [
  { x: 0, y: 16, width: WORLD_COLUMNS, height: 2 }, // promenade
  { x: 11, y: 9, width: 8, height: 7 }, // plaza
  { x: 7, y: 10, width: 2, height: 6 }, // castle path
  { x: 21, y: 10, width: 2, height: 6 }, // office path
];

const inRect = (r: Rect, x: number, y: number) =>
  x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

const buildingTiles = (): Rect[] =>
  BUILDINGS.map((b) => ({
    x: b.frame.x / TILE,
    y: b.frame.y / TILE,
    width: b.frame.width / TILE,
    height: b.frame.height / TILE,
  }));

/**
 * The ground tile at every cell. Paving gets a kerb along any edge that
 * meets grass above it — but not where it meets a building, since a path
 * runs straight up to the door.
 */
export function groundTiles(): Ground[][] {
  const paved = (x: number, y: number) => PAVED.some((r) => inRect(r, x, y));
  const built = buildingTiles();
  const rows: Ground[][] = [];
  for (let y = 0; y < WORLD_ROWS; y++) {
    const row: Ground[] = [];
    for (let x = 0; x < WORLD_COLUMNS; x++) {
      if (!paved(x, y)) row.push("grass");
      else if (y > 0 && !paved(x, y - 1) && !built.some((b) => inRect(b, x, y - 1)))
        row.push("kerb");
      else row.push("paving");
    }
    rows.push(row);
  }
  return rows;
}

// ── Props ──────────────────────────────────────────────

export interface PropSpec {
  width: number;
  height: number;
  /** The solid part at the foot, centred on the prop's feet. Absent means walk-through. */
  footprint?: { width: number; height: number };
  /** Drawn frames with a second pose, shown in turn. */
  animate?: boolean;
}

export const PROPS = {
  tree: { width: 96, height: 120, footprint: { width: 22, height: 22 } },
  bush: { width: 64, height: 48, footprint: { width: 48, height: 18 } },
  lamp: { width: 32, height: 96, footprint: { width: 14, height: 10 } },
  bench: { width: 96, height: 48, footprint: { width: 92, height: 26 } },
  fountain: {
    width: 144,
    height: 96,
    footprint: { width: 132, height: 52 },
    animate: true,
  },
  planter: { width: 64, height: 48, footprint: { width: 52, height: 20 } },
  signpost: { width: 48, height: 96, footprint: { width: 12, height: 10 } },
} as const satisfies Record<string, PropSpec>;

export type PropKind = keyof typeof PROPS;

export interface PlacedProp {
  kind: PropKind;
  /** Feet: bottom centre, in world pixels. */
  x: number;
  y: number;
}

const treeLine = (y: number, xs: number[]): PlacedProp[] => xs.map((x) => ({ kind: "tree", x, y }));

export const SCENERY: readonly PlacedProp[] = [
  // A wood along the top, and a few trees framing the buildings.
  ...treeLine(118, [60, 200, 340, 480, 620, 760, 900, 1040, 1180, 1320]),
  ...treeLine(250, [130, 1400]),
  { kind: "tree", x: 100, y: 420 },
  { kind: "tree", x: 1340, y: 420 },
  { kind: "tree", x: 620, y: 330 },
  { kind: "tree", x: 830, y: 300 },
  { kind: "bush", x: 720, y: 400 },
  // Flowers and lamps at each entrance.
  { kind: "bush", x: 262, y: 500 },
  { kind: "bush", x: 506, y: 500 },
  { kind: "bush", x: 934, y: 500 },
  { kind: "bush", x: 1178, y: 500 },
  { kind: "lamp", x: 316, y: 540 },
  { kind: "lamp", x: 452, y: 540 },
  { kind: "lamp", x: 988, y: 540 },
  { kind: "lamp", x: 1124, y: 540 },
  // The plaza: a fountain and a bench.
  { kind: "planter", x: 620, y: 478 },
  { kind: "planter", x: 820, y: 478 },
  { kind: "fountain", x: 720, y: 620 },
  { kind: "bench", x: 720, y: 720 },
  { kind: "lamp", x: 540, y: 560 },
  { kind: "lamp", x: 900, y: 560 },
  // Along the bottom.
  { kind: "signpost", x: 780, y: 900 },
  { kind: "bush", x: 80, y: 950 },
  { kind: "bush", x: 320, y: 950 },
  { kind: "bush", x: 520, y: 950 },
  { kind: "bush", x: 940, y: 950 },
  { kind: "bush", x: 1160, y: 950 },
  { kind: "bush", x: 1380, y: 950 },
];

/** The picture's rectangle. */
export function propBounds(p: PlacedProp): Rect {
  const spec: PropSpec = PROPS[p.kind];
  return { x: p.x - spec.width / 2, y: p.y - spec.height, width: spec.width, height: spec.height };
}

/** The part a person cannot walk through, or null for a walk-through prop. */
export function propBody(p: PlacedProp): Rect | null {
  const foot = (PROPS[p.kind] as PropSpec).footprint;
  if (!foot) return null;
  return { x: p.x - foot.width / 2, y: p.y - foot.height, width: foot.width, height: foot.height };
}

// ── Can you still get everywhere? ──────────────────────

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/**
 * Whether a person can walk from the spawn to every door with the props and
 * buildings in the way. Coarse: a grid of cells the size of a person's feet,
 * a cell blocked if any solid touches it.
 */
export function everyDoorReachable(cell = 24): boolean {
  const solids = [
    ...BUILDINGS.map((b) => b.solid),
    ...SCENERY.map(propBody).filter((r): r is Rect => r !== null),
  ];
  const cols = Math.ceil(WORLD_WIDTH / cell);
  const rows = Math.ceil(WORLD_HEIGHT / cell);
  const blocked = (cx: number, cy: number) => {
    const c = { x: cx * cell, y: cy * cell, width: cell, height: cell };
    return solids.some((s) => overlaps(s, c));
  };
  const key = (cx: number, cy: number) => cy * cols + cx;
  const start = { cx: Math.floor(WORLD_SPAWN.x / cell), cy: Math.floor(WORLD_SPAWN.y / cell) };
  const seen = new Set<number>([key(start.cx, start.cy)]);
  const queue = [start];
  while (queue.length) {
    const { cx, cy } = queue.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (seen.has(key(nx, ny)) || blocked(nx, ny)) continue;
      seen.add(key(nx, ny));
      queue.push({ cx: nx, cy: ny });
    }
  }
  return BUILDINGS.every((b) =>
    seen.has(key(Math.floor((b.door.x + b.door.width / 2) / cell), Math.floor(b.door.y / cell))),
  );
}
