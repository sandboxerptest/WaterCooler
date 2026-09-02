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

export const SMALL = 3 * TILE;

interface Placement {
  tenant: string;
  tx: number;
  ty: number;
  side?: DoorSide;
  art?: string;
}

function small({ tenant: tenantSlug, tx, ty, side = "bottom", art }: Placement): CampusBuilding {
  const tenant = tenantFor(tenantSlug);
  if (!tenant?.kind) throw new Error(`${tenantSlug} is not a campus building`);
  const frame = { x: tx * TILE, y: ty * TILE, width: SMALL, height: SMALL };
  const base = { tenant, kind: tenant.kind, art: art ?? `site-${tenant.kind}`, frame, side };
  if (side === "bottom") {
    return {
      ...base,
      solid: { x: frame.x, y: frame.y, width: SMALL, height: SMALL - TILE / 2 },
      door: { x: frame.x + TILE, y: frame.y + SMALL - TILE / 2, width: TILE, height: TILE },
      outside: { x: frame.x + SMALL / 2, y: frame.y + SMALL + TILE * 1.25 },
      exitDirection: "down",
    };
  }
  // A side door: the whole picture is solid, and the way in is the tile
  // beside its middle row, on the road side.
  const doorX = side === "right" ? frame.x + SMALL : frame.x - TILE;
  const away = side === "right" ? 1 : -1;
  return {
    ...base,
    solid: frame,
    door: { x: doorX, y: frame.y + TILE, width: TILE, height: TILE },
    outside: { x: doorX + TILE / 2 + away * TILE * 1.25, y: frame.y + TILE + TILE / 2 - 43 },
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
  const buildings = placements.map(small);
  const roadX = Math.floor(columns / 2) - 2;
  const paved: Rect[] = [
    { x: 1, y: yardTop, width: columns - 2, height: 3 },
    { x: roadX, y: yardTop, width: 4, height: rows - yardTop },
  ];
  for (const b of buildings) {
    const tx = b.frame.x / TILE;
    const ty = b.frame.y / TILE;
    if (b.side === "bottom") {
      paved.push({ x: tx + 1, y: ty + 3, width: 1, height: Math.max(0, yardTop - ty - 3) });
    } else {
      // The mat: from the road to the door, one tile high at the door's row.
      const doorTx = b.door.x / TILE;
      const from = Math.min(doorTx, b.side === "right" ? roadX : roadX + 3);
      const to = Math.max(doorTx, b.side === "right" ? roadX : roadX + 3);
      paved.push({ x: from, y: ty + 1, width: to - from + 1, height: 1 });
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
  // Few tiles, so the camera's fit draws everything large and legible.
  homestar: layout(
    "homestar",
    16,
    12,
    [
      { tenant: "homestar-sales", tx: 1, ty: 1, art: "site-office-sales" },
      { tenant: "homestar-finance", tx: 6, ty: 1, art: "site-office-finance" },
      { tenant: "homestar-operations", tx: 11, ty: 1, art: "site-office-operations" },
      { tenant: "homestar-store", tx: 1, ty: 7, side: "right" },
      { tenant: "homestar-field-crew", tx: 12, ty: 7, side: "left" },
    ],
    [
      { kind: "planter", x: 250, y: 235 },
      { kind: "planter", x: 510, y: 235 },
    ],
    5,
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
  const expected = tenantsOf(campus.slug)
    .map((t) => t.slug)
    .sort();
  return JSON.stringify(listed) === JSON.stringify(expected);
}
