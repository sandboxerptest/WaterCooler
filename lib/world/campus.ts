/**
 * Campuses: an organisation's front door opens onto a yard, not a lobby.
 *
 * Each little building on the yard is one of the organisation's lobbies —
 * a warehouse, a storefront, a garage, a department — and walking into it
 * is the same as walking into a building on the world map. The yard is a
 * menu: everything on it is on one screen, and the way out is the road at
 * the bottom.
 *
 * Nothing here touches Phaser.
 */

import { TILE, tenantFor, tenantsOf, type BuildingKind, type Rect, type Tenant } from "./tenants";
import type { PlacedProp } from "./scenery";

export type DoorSide = "bottom" | "left" | "right";

export interface CampusBuilding {
  tenant: Tenant;
  kind: BuildingKind;
  /** Texture key of the picture. */
  art: string;
  /** The picture's footprint, in pixels: three tiles square. */
  frame: Rect;
  solid: Rect;
  /** Which face the way in is on. Buildings along the bottom are entered from the side. */
  side: DoorSide;
  /** Walk into this to go inside: on the ground in front of the door, or on the mat beside it. */
  door: Rect;
  /** Where you stand after coming back out. */
  outside: { x: number; y: number };
  /** The way you walk on coming out: away from the door. */
  exitDirection: "down" | "left" | "right";
}

export interface Campus {
  slug: string;
  columns: number;
  rows: number;
  buildings: CampusBuilding[];
  /** Paved ground, in tiles. */
  paved: Rect[];
  props: PlacedProp[];
  /** Walk onto this — the bottom edge, anywhere along it — to go back to the world map. */
  exit: Rect;
  /** Where you stand on arriving from the world map. */
  entrance: { x: number; y: number };
}

/** How many tiles square a building is: drawn at 2x on a yard that fills the screen. */
export const BUILDING_TILES = 6;

interface Placement {
  tenant: string;
  tx: number;
  ty: number;
  side?: DoorSide;
  art?: string;
}

function building(
  { tenant: tenantSlug, tx, ty, side = "bottom", art }: Placement,
  size = BUILDING_TILES,
): CampusBuilding {
  const tenant = tenantFor(tenantSlug);
  if (!tenant?.kind) throw new Error(`${tenantSlug} is not a campus building`);
  const px = size * TILE;
  const frame = { x: tx * TILE, y: ty * TILE, width: px, height: px };
  const base = { tenant, kind: tenant.kind, art: art ?? `site-${tenant.kind}`, frame, side };
  const doorCol = Math.floor(size / 2);
  if (side === "bottom") {
    return {
      ...base,
      solid: { x: frame.x, y: frame.y, width: px, height: px - TILE / 2 },
      door: { x: frame.x + doorCol * TILE, y: frame.y + px - TILE / 2, width: TILE, height: TILE },
      outside: { x: frame.x + doorCol * TILE + TILE / 2, y: frame.y + px + TILE * 1.25 },
      exitDirection: "down",
    };
  }
  // A side door: the whole picture is solid, and the way in is the tile
  // beside its middle row, on the road side.
  const doorX = side === "right" ? frame.x + px : frame.x - TILE;
  const doorY = frame.y + doorCol * TILE;
  const away = side === "right" ? 1 : -1;
  return {
    ...base,
    solid: frame,
    door: { x: doorX, y: doorY, width: TILE, height: TILE },
    outside: { x: doorX + TILE / 2 + away * TILE * 1.25, y: doorY + TILE / 2 - 43 },
    exitDirection: side,
  };
}

/**
 * Lay out a campus. Buildings across the top stand in a row and get a path
 * down to a paved yard; buildings along the bottom face the road from the
 * side, on a paved mat. The road runs from the yard down the middle to the
 * way out.
 */
function layout(
  slug: string,
  columns: number,
  rows: number,
  placements: Placement[],
  props: PlacedProp[],
  yardTop = 7,
): Campus {
  const buildings = placements.map((p) => building(p));
  const roadX = Math.floor(columns / 2) - 2;
  const paved: Rect[] = [
    { x: 1, y: yardTop, width: columns - 2, height: 3 },
    { x: roadX, y: yardTop, width: 4, height: rows - yardTop },
  ];
  for (const b of buildings) {
    const tx = b.frame.x / TILE;
    const ty = b.frame.y / TILE;
    const size = b.frame.width / TILE;
    if (b.side === "bottom") {
      const doorTx = b.door.x / TILE;
      paved.push({ x: doorTx, y: ty + size, width: 1, height: Math.max(0, yardTop - ty - size) });
    } else {
      // The mat: from the road to the door, one tile high at the door's row.
      const doorTx = b.door.x / TILE;
      const doorTy = b.door.y / TILE;
      const from = Math.min(doorTx, b.side === "right" ? roadX : roadX + 3);
      const to = Math.max(doorTx, b.side === "right" ? roadX : roadX + 3);
      paved.push({ x: from, y: doorTy, width: to - from + 1, height: 1 });
    }
  }
  return {
    slug,
    columns,
    rows,
    buildings,
    paved,
    props,
    // The road is drawn down the middle, but the whole bottom edge is the
    // way out: this is a menu, and walking off it should always work.
    exit: { x: 0, y: (rows - 1) * TILE, width: columns * TILE, height: TILE },
    entrance: { x: (roadX + 2) * TILE, y: (rows - 2) * TILE - 4 },
  };
}

const lamps = (xs: number[], y: number): PlacedProp[] => xs.map((x) => ({ kind: "lamp", x, y }));

export const CAMPUSES: Record<string, Campus> = {
  // The departments across the top, each its own kind of building; the
  // store and the garage along the bottom, entered from the road side.
  // Sized like the lobby, so it all fits on one screen at a readable size.
  // The lobby's own frame — 20 by 19 — filled with buildings drawn at
  // twice the size, so the yard takes the screen a lobby does.
  homestar: layout(
    "homestar",
    20,
    19,
    [
      { tenant: "homestar-sales", tx: 1, ty: 1, art: "site-office-sales-2x" },
      { tenant: "homestar-finance", tx: 7, ty: 1, art: "site-office-finance-2x" },
      { tenant: "homestar-operations", tx: 13, ty: 1, art: "site-office-operations-2x" },
      { tenant: "homestar-store", tx: 1, ty: 11, side: "right", art: "site-store-2x" },
      { tenant: "homestar-field-crew", tx: 13, ty: 11, side: "left", art: "site-garage-2x" },
    ],
    [],
    7,
  ),
};

export function campusFor(slug: string | null | undefined): Campus | null {
  return slug ? (CAMPUSES[slug] ?? null) : null;
}

/** Where to stand on arrival: outside the building just left, else at the gate. */
export function campusSpawnFor(campus: Campus, fromTenant: string | null | undefined) {
  return campus.buildings.find((b) => b.tenant.slug === fromTenant)?.outside ?? campus.entrance;
}

/** Every campus lists exactly its organisation's lobbies. */
export function campusMatchesTenants(campus: Campus): boolean {
  const listed = campus.buildings.map((b) => b.tenant.slug).sort();
  // A warehouse stands behind its store, reached through the back door,
  // not from the yard.
  const expected = tenantsOf(campus.slug)
    .filter((t) => t.kind !== "warehouse")
    .map((t) => t.slug)
    .sort();
  return JSON.stringify(listed) === JSON.stringify(expected);
}
