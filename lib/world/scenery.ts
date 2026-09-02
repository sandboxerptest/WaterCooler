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
  BOAT,
  BUILDINGS,
  CENTRE_X,
  DOCK,
  EAST_X,
  SHORE_ROW,
  TILE,
  WORLD_COLUMNS,
  WORLD_HEIGHT,
  WORLD_ROWS,
  WORLD_SPAWN,
  WORLD_WIDTH,
  type Rect,
} from "./tenants";

export type Ground = "grass" | "paving" | "kerb" | "asphalt" | "water" | "dock";

const CENTRE = CENTRE_X / TILE;

/** Where the promenades run, in tile rows. */
export const NORTH_ROAD = 16;
export const SOUTH_ROAD = 30;

/** A path from a building's door straight down to the road below it, in tiles. */
function pathDown(b: (typeof BUILDINGS)[number]): Rect {
  const x = Math.floor((b.door.x + b.door.width / 2) / TILE) - 1;
  const y = (b.frame.y + b.frame.height) / TILE;
  const road = y <= NORTH_ROAD ? NORTH_ROAD : SOUTH_ROAD;
  return { x, y, width: 2, height: road - y };
}

/** Paved ground, in tiles. Order does not matter; anything paved is walkable. */
export const PAVED: readonly Rect[] = [
  { x: 0, y: NORTH_ROAD, width: WORLD_COLUMNS, height: 2 }, // the north road, the whole way
  { x: 0, y: SOUTH_ROAD, width: WORLD_COLUMNS, height: 2 }, // the south road, the same
  { x: CENTRE + 11, y: 9, width: 8, height: 7 }, // plaza
  // A path to each door; the ferry has the dock instead.
  ...BUILDINGS.filter((b) => b.frame.y < SOUTH_ROAD * TILE).map(pathDown),
  // Three avenues join the two roads: west, centre and east.
  { x: 8, y: NORTH_ROAD + 2, width: 2, height: SOUTH_ROAD - NORTH_ROAD - 2 },
  { x: CENTRE + 14, y: NORTH_ROAD + 2, width: 2, height: SOUTH_ROAD - NORTH_ROAD - 2 },
  { x: CENTRE + 30 + 6, y: NORTH_ROAD + 2, width: 2, height: SOUTH_ROAD - NORTH_ROAD - 2 },
];

/** Asphalt, in tiles: the car park by the campus, off the east avenue. */
export const ASPHALT: readonly Rect[] = [{ x: CENTRE + 30 + 9, y: 22, width: 6, height: 5 }];

/** The sea, in tiles: the whole bottom of the map, past the bushes on the shore. */
export const WATER: readonly Rect[] = [
  { x: 0, y: SHORE_ROW, width: WORLD_COLUMNS, height: WORLD_ROWS - SHORE_ROW },
];

/** Dock planking, in tiles. Laid over the water, and walkable. */
export const DOCKS: readonly Rect[] = [DOCK];

/** A board with words on it, standing on its feet like a prop. */
export interface Sign {
  text: string;
  x: number;
  y: number;
}

/** The board at the head of the dock. */
export const WORLD_SIGNS: readonly Sign[] = [
  { text: "FERRY TO\nIRELAND", x: DOCK.x * TILE - 60, y: (SHORE_ROW - 1) * TILE + 44 },
];

const inRect = (r: Rect, x: number, y: number) =>
  x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

/** A pixel rectangle as whole tiles. */
export const tilesOf = (r: Rect): Rect => ({
  x: r.x / TILE,
  y: r.y / TILE,
  width: r.width / TILE,
  height: r.height / TILE,
});

/**
 * The ground tile at every cell. Paving gets a kerb along any edge that
 * meets grass above it — but not where it meets a building, since a path
 * runs straight up to the door. Dock planking lies over the water, so it
 * is decided first.
 */
export function groundGrid(
  columns: number,
  rows: number,
  paved: readonly Rect[],
  built: readonly Rect[],
  asphalt: readonly Rect[] = [],
  water: readonly Rect[] = [],
  dock: readonly Rect[] = [],
): Ground[][] {
  const isPaved = (x: number, y: number) => paved.some((r) => inRect(r, x, y));
  const grid: Ground[][] = [];
  for (let y = 0; y < rows; y++) {
    const row: Ground[] = [];
    for (let x = 0; x < columns; x++) {
      if (dock.some((r) => inRect(r, x, y))) row.push("dock");
      else if (water.some((r) => inRect(r, x, y))) row.push("water");
      else if (asphalt.some((r) => inRect(r, x, y))) row.push("asphalt");
      else if (!isPaved(x, y)) row.push("grass");
      else if (y > 0 && !isPaved(x, y - 1) && !built.some((b) => inRect(b, x, y - 1)))
        row.push("kerb");
      else row.push("paving");
    }
    grid.push(row);
  }
  return grid;
}

export function groundTiles(): Ground[][] {
  return groundGrid(
    WORLD_COLUMNS,
    WORLD_ROWS,
    PAVED,
    BUILDINGS.map((b) => tilesOf(b.frame)),
    ASPHALT,
    WATER,
    DOCKS,
  );
}

/**
 * The water as solids, in pixels: one body per run of water tiles along a
 * row, with the dock left out so it can be walked. Nobody walks on the
 * sea, and a walk that is planned around it stays dry.
 */
export function waterBodies(grid: Ground[][]): Rect[] {
  const bodies: Rect[] = [];
  grid.forEach((row, y) => {
    let start = -1;
    const flush = (end: number) => {
      if (start >= 0)
        bodies.push({ x: start * TILE, y: y * TILE, width: (end - start) * TILE, height: TILE });
      start = -1;
    };
    row.forEach((ground, x) => {
      if (ground === "water") {
        if (start < 0) start = x;
      } else flush(x);
    });
    flush(row.length);
  });
  return bodies;
}

/** The world's water, as solids. */
export function worldWater(): Rect[] {
  return waterBodies(groundTiles());
}

/** A sign's board stands on the ground like a prop, and is as solid at the foot. */
export function signBody(sign: Sign): Rect {
  return propBody({ kind: "board", x: sign.x, y: sign.y })!;
}

// ── Props ──────────────────────────────────────────────

export interface PropSpec {
  /** Texture key, when the prop is not on the props sheet. */
  texture?: string;
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
  pond: { texture: "world-pond", width: 288, height: 192, footprint: { width: 268, height: 140 } },
  van: { texture: "van", width: 96, height: 144, footprint: { width: 88, height: 130 } },
  sheep: { width: 48, height: 40, footprint: { width: 30, height: 10 } },
  board: { width: 144, height: 88, footprint: { width: 112, height: 10 } },
} as const satisfies Record<string, PropSpec>;

export type PropKind = keyof typeof PROPS;

export interface PlacedProp {
  kind: PropKind;
  /** Feet: bottom centre, in world pixels. */
  x: number;
  y: number;
}

const treeLine = (y: number, xs: number[]): PlacedProp[] => xs.map((x) => ({ kind: "tree", x, y }));

/** Props in the middle screen, placed as if it stood alone, then moved into place. */
const centre = (props: PlacedProp[]): PlacedProp[] =>
  props.map((p) => ({ ...p, x: p.x + CENTRE_X }));

/** Every 140px across a stretch. */
const along = (from: number, to: number, step: number): number[] => {
  const xs: number[] = [];
  for (let x = from; x <= to; x += step) xs.push(x);
  return xs;
};

export const SCENERY: readonly PlacedProp[] = [
  // A wood along the top, the whole way — except where Blockhouse stands
  // against it.
  ...treeLine(
    118,
    along(60, WORLD_WIDTH - 60, 140).filter((x) => x < 150 || x > 520),
  ),
  // Bushes along the shore, the whole way — except at the dock and the ferry.
  ...along(80, WORLD_WIDTH - 60, 220)
    .filter((x) => x < DOCK.x * TILE - 140 || x > (DOCK.x + DOCK.width) * TILE + BOAT.width + 60)
    .map((x): PlacedProp => ({ kind: "bush", x, y: SHORE_ROW * TILE - 12 })),

  // West: the two stores, each with lamps and flowers at the door.
  { kind: "tree", x: 700, y: 250 },
  { kind: "tree", x: 1330, y: 300 },
  { kind: "tree", x: 1000, y: 640 },
  { kind: "bush", x: 214, y: 404 },
  { kind: "bush", x: 458, y: 404 },
  { kind: "lamp", x: 268, y: 450 },
  { kind: "lamp", x: 404, y: 450 },
  { kind: "bush", x: 550, y: 692 },
  { kind: "bush", x: 794, y: 692 },
  { kind: "lamp", x: 600, y: 740 },
  { kind: "lamp", x: 744, y: 740 },
  { kind: "planter", x: 520, y: 300 },

  // Centre: the plaza between the two head offices.
  ...centre([
    ...treeLine(250, [130, 1400]),
    { kind: "tree", x: 100, y: 420 },
    { kind: "tree", x: 1340, y: 420 },
    { kind: "tree", x: 620, y: 330 },
    { kind: "tree", x: 830, y: 300 },
    { kind: "bush", x: 720, y: 400 },
    { kind: "bush", x: 262, y: 500 },
    { kind: "bush", x: 490, y: 500 },
    { kind: "bush", x: 950, y: 500 },
    { kind: "bush", x: 1178, y: 500 },
    { kind: "lamp", x: 316, y: 540 },
    { kind: "lamp", x: 452, y: 540 },
    { kind: "lamp", x: 988, y: 540 },
    { kind: "lamp", x: 1124, y: 540 },
    { kind: "planter", x: 620, y: 424 },
    { kind: "planter", x: 820, y: 424 },
    { kind: "fountain", x: 720, y: 620 },
    { kind: "bench", x: 720, y: 720 },
    { kind: "lamp", x: 504, y: 560 },
    { kind: "lamp", x: 936, y: 560 },
  ]),

  // South of the north road: a park with a pond in the middle stretch,
  // the campus car park to the east with the vans in it, and along the
  // south road, plots for the businesses still to come.
  { kind: "pond", x: CENTRE_X + 300, y: 1380 },
  { kind: "bench", x: CENTRE_X + 120, y: 1240 },
  { kind: "bench", x: CENTRE_X + 480, y: 1240 },
  { kind: "tree", x: CENTRE_X + 60, y: 1120 },
  { kind: "tree", x: CENTRE_X + 540, y: 1100 },
  { kind: "tree", x: CENTRE_X + 200, y: 1010 },
  { kind: "bush", x: CENTRE_X + 380, y: 1000 },
  { kind: "planter", x: CENTRE_X + 900, y: 1000 },
  { kind: "planter", x: CENTRE_X + 1100, y: 1000 },
  { kind: "tree", x: CENTRE_X + 1000, y: 1200 },
  { kind: "tree", x: CENTRE_X + 1240, y: 1300 },
  // The lab stands back among trees.
  ...treeLine(990, [80, 210, 330]),
  { kind: "tree", x: 520, y: 1120 },
  { kind: "tree", x: 530, y: 1260 },
  { kind: "bush", x: 60, y: 1330 },
  { kind: "lamp", x: 120, y: 1370 },
  { kind: "lamp", x: 264, y: 1370 },

  { kind: "lamp", x: 360, y: 1250 },
  { kind: "lamp", x: 504, y: 1250 },
  { kind: "lamp", x: CENTRE_X + 650, y: 1000 },
  { kind: "lamp", x: CENTRE_X + 790, y: 1000 },
  { kind: "van", x: EAST_X + 480, y: 1280 },
  { kind: "van", x: EAST_X + 590, y: 1280 },
  { kind: "van", x: EAST_X + 700, y: 1280 },
  { kind: "tree", x: EAST_X + 120, y: 1150 },
  { kind: "tree", x: EAST_X + 700, y: 1000 },
  { kind: "lamp", x: EAST_X + 260, y: 1000 },
  { kind: "lamp", x: EAST_X + 400, y: 1000 },

  // East: the campus gate, with a formal approach.
  ...[
    { kind: "tree", x: 80, y: 300 },
    { kind: "tree", x: 700, y: 300 },
    { kind: "planter", x: 200, y: 520 },
    { kind: "planter", x: 480, y: 520 },
    { kind: "lamp", x: 250, y: 620 },
    { kind: "lamp", x: 420, y: 620 },
    { kind: "bench", x: 160, y: 700 },
    { kind: "bench", x: 560, y: 700 },
  ].map((p): PlacedProp => ({ ...(p as PlacedProp), x: p.x + EAST_X })),
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
 * Whether a person can walk from `from` to every one of `targets` with the
 * solids in the way. Coarse: a grid of cells the size of a person's feet,
 * a cell blocked if any solid touches it.
 */
export function allReachable(
  bounds: { width: number; height: number },
  solids: Rect[],
  from: { x: number; y: number },
  targets: { x: number; y: number }[],
  cell = 24,
): boolean {
  const cols = Math.ceil(bounds.width / cell);
  const rows = Math.ceil(bounds.height / cell);
  const blocked = (cx: number, cy: number) => {
    const c = { x: cx * cell, y: cy * cell, width: cell, height: cell };
    return solids.some((s) => overlaps(s, c));
  };
  const key = (cx: number, cy: number) => cy * cols + cx;
  const start = { cx: Math.floor(from.x / cell), cy: Math.floor(from.y / cell) };
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
  return targets.every((t) => seen.has(key(Math.floor(t.x / cell), Math.floor(t.y / cell))));
}

/** Everything solid on the world map: the buildings, the props' feet, the signs and the sea. */
export function worldSolids(): Rect[] {
  return [
    ...BUILDINGS.map((b) => b.solid),
    ...SCENERY.map(propBody).filter((r): r is Rect => r !== null),
    ...WORLD_SIGNS.map(signBody),
    ...worldWater(),
  ];
}

/** Whether every building's door on the world map can be reached from the spawn. */
export function everyDoorReachable(cell = 24): boolean {
  return allReachable(
    { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    worldSolids(),
    WORLD_SPAWN,
    BUILDINGS.map((b) => ({ x: b.door.x + b.door.width / 2, y: b.door.y })),
    cell,
  );
}
