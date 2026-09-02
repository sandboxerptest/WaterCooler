/**
 * The businesses on the world map, and where their buildings stand.
 *
 * A tenant is a room. Every room already keeps its own seats, people, chat
 * and activity, so walking into a building is nothing more than moving to
 * that room — the separation between businesses was there before the map.
 *
 * Shared by the world scene and the HUD, so nothing here touches Phaser.
 */

export interface Tenant {
  /** Room slug; also the building's identity in URLs. */
  slug: string;
  name: string;
  tagline: string;
  style: "castle" | "office";
}

export const TENANTS: readonly Tenant[] = [
  {
    slug: "castle-atlantic",
    name: "Castle Atlantic",
    tagline: "Head office",
    style: "castle",
  },
  {
    slug: "sandbox-erp",
    name: "Sandbox ERP",
    tagline: "Operations",
    style: "office",
  },
];

export function tenantFor(slug: string | null | undefined): Tenant | null {
  return TENANTS.find((t) => t.slug === slug) ?? null;
}

/** Where a tenant's main floor lives. */
export function tenantUrl(tenant: Tenant): string {
  return `/r/${tenant.slug}`;
}

// ── The map ─────────────────────────────────────────────

export const TILE = 48;
export const WORLD_COLUMNS = 30;
export const WORLD_ROWS = 20;
export const WORLD_WIDTH = WORLD_COLUMNS * TILE;
export const WORLD_HEIGHT = WORLD_ROWS * TILE;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Building {
  tenant: Tenant;
  /** The picture's footprint, in pixels. */
  frame: Rect;
  /** The part of the footprint a person cannot walk through. */
  solid: Rect;
  /** Walk into this to go inside. Sits on the ground in front of the door. */
  door: Rect;
  /** Where you stand after coming back out. */
  outside: { x: number; y: number };
}

/** Both pictures are drawn to this size by scripts/make-world-art.mjs. */
export const BUILDING_WIDTH = 6 * TILE;
export const BUILDING_HEIGHT = 6 * TILE;

function placeBuilding(tenant: Tenant, x: number, y: number, doorWidth: number): Building {
  const frame = { x, y, width: BUILDING_WIDTH, height: BUILDING_HEIGHT };
  const doorX = x + (BUILDING_WIDTH - doorWidth) / 2;
  return {
    tenant,
    frame,
    // The wall is solid; the doorway is a gap in it so you can walk up to it.
    solid: { x, y, width: BUILDING_WIDTH, height: BUILDING_HEIGHT - TILE / 2 },
    door: { x: doorX, y: y + BUILDING_HEIGHT - TILE / 2, width: doorWidth, height: TILE },
    outside: { x: x + BUILDING_WIDTH / 2, y: y + BUILDING_HEIGHT + TILE * 1.25 },
  };
}

export const BUILDINGS: readonly Building[] = [
  placeBuilding(TENANTS[0], TILE * 5, TILE * 4, TILE),
  placeBuilding(TENANTS[1], TILE * 19, TILE * 4, TILE * 1.5),
];

/** Where a person appears on the world map with no building to step out of. */
export const WORLD_SPAWN = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT - TILE * 3 };

/** Where to stand on arrival: outside the building just left, else the road. */
export function spawnFor(fromSlug: string | null | undefined): { x: number; y: number } {
  const building = BUILDINGS.find((b) => b.tenant.slug === fromSlug);
  return building ? building.outside : WORLD_SPAWN;
}

export function buildingFor(tenant: Tenant): Building {
  return BUILDINGS.find((b) => b.tenant.slug === tenant.slug)!;
}
