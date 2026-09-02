/**
 * The businesses, their buildings, and where those stand on the world map.
 *
 * Three ideas, kept apart:
 *
 * - An *organisation* is who you work for. It is the home a person chooses
 *   and the thing a resident agent belongs to.
 * - A *tenant* is one enterable room. A head office is a lobby with floors
 *   above it; a building supply business is a store, with its warehouse and
 *   garage as rooms behind it; a campus has a department lobby, a store and
 *   a garage per little building on its yard.
 * - A *building* on the world map is an organisation's front door. It leads
 *   straight into a room — a lobby or a store — or onto a campus: a yard of
 *   little buildings, one per tenant, which is that organisation's menu.
 *
 * Shared by the scenes and the HUD, so nothing here touches Phaser.
 */

import type { Game } from "../map/office";

export type OrgStyle = "castle" | "office" | "supply" | "blocks" | "campus" | "lab" | "irish";

export interface Organisation {
  slug: string;
  name: string;
  tagline: string;
  style: OrgStyle;
  /** Its front door opens onto a yard of buildings rather than into a room. */
  campus?: boolean;
}

export const ORGANISATIONS: readonly Organisation[] = [
  { slug: "castle-atlantic", name: "Castle Atlantic", tagline: "Head office", style: "castle" },
  { slug: "sandbox-erp", name: "Sandbox ERP", tagline: "Operations", style: "office" },
  { slug: "chester", name: "Chester", tagline: "Building supply", style: "supply" },
  { slug: "blockhouse", name: "Blockhouse", tagline: "Building supply", style: "blocks" },
  { slug: "homestar", name: "Homestar", tagline: "Business campus", style: "campus", campus: true },
  // Out of the way, past the trees at the far end of the south road: the
  // science lab that makes the whole world possible.
  { slug: "mettara", name: "Mettara", tagline: "Science lab", style: "lab" },
  // Across the water: the island, reached by the ferry from the dock at
  // the bottom of the map. Its "campus" is the island itself.
  {
    slug: "apeiron-media",
    name: "Apeiron Media",
    tagline: "Media house",
    style: "irish",
    campus: true,
  },
];

export function organisationFor(slug: string | null | undefined): Organisation | null {
  return ORGANISATIONS.find((o) => o.slug === slug) ?? null;
}

/** What a little building on a campus is, which decides how it is drawn. */
export type BuildingKind = "warehouse" | "store" | "garage" | "office";

export interface Tenant {
  /** Room slug; also the lobby's identity in URLs. */
  slug: string;
  /** The organisation this lobby belongs to. */
  org: string;
  /** The organisation's name. */
  name: string;
  /** For a campus's building: what it is, e.g. "Warehouse". Absent for a one-lobby organisation. */
  location?: string;
  kind?: BuildingKind;
  /** The game in the lobby's corner, if it has one. */
  game?: Game;
}

const org = (slug: string) => organisationFor(slug)!;

function lobby(slug: string, orgSlug: string, extra: Partial<Tenant> = {}): Tenant {
  return { slug, org: orgSlug, name: org(orgSlug).name, ...extra };
}

export const TENANTS: readonly Tenant[] = [
  lobby("castle-atlantic", "castle-atlantic", { game: "pong" }),
  lobby("sandbox-erp", "sandbox-erp", { game: "pinball" }),
  lobby("chester-warehouse", "chester", { location: "Warehouse", kind: "warehouse" }),
  lobby("chester-store", "chester", { location: "Store", kind: "store" }),
  lobby("blockhouse-warehouse", "blockhouse", { location: "Warehouse", kind: "warehouse" }),
  lobby("blockhouse-store", "blockhouse", { location: "Store", kind: "store" }),
  lobby("blockhouse-field-crew", "blockhouse", { location: "Field Crew", kind: "garage" }),
  lobby("homestar-sales", "homestar", { location: "Sales", kind: "office" }),
  lobby("homestar-finance", "homestar", { location: "Finance", kind: "office" }),
  lobby("homestar-operations", "homestar", { location: "Operations", kind: "office" }),
  lobby("homestar-store", "homestar", { location: "Building Supply", kind: "store" }),
  // Behind the campus's store, so it carries the store's name too.
  lobby("homestar-warehouse", "homestar", {
    location: "Building Supply Warehouse",
    kind: "warehouse",
  }),
  lobby("homestar-field-crew", "homestar", { location: "Field Crew", kind: "garage" }),
  lobby("mettara", "mettara"),
  // The one house on the island: a lobby with floors, laid out like Castle
  // Atlantic's, ping pong table and all. "office" is what makes it a
  // building on its island the way a department is on a campus.
  lobby("apeiron-media", "apeiron-media", { kind: "office", game: "pong" }),
];

export function tenantFor(slug: string | null | undefined): Tenant | null {
  return TENANTS.find((t) => t.slug === slug) ?? null;
}

/** All of an organisation's lobbies, in the order they are listed. */
export function tenantsOf(orgSlug: string): Tenant[] {
  return TENANTS.filter((t) => t.org === orgSlug);
}

/** "Chester · Warehouse", or just "Castle Atlantic". */
export function tenantTitle(tenant: Tenant): string {
  return tenant.location ? `${tenant.name} · ${tenant.location}` : tenant.name;
}

/** Where a tenant's main floor lives. */
export function tenantUrl(tenant: Tenant): string {
  return `/r/${tenant.slug}`;
}

/** Whether an organisation's front door opens onto a campus rather than a room. */
export function hasCampus(orgSlug: string): boolean {
  return organisationFor(orgSlug)?.campus === true;
}

/** Whether a room is a lobby with floors above it, rather than a store, warehouse or garage. */
export function hasFloors(tenant: Tenant): boolean {
  return !tenant.kind || tenant.kind === "office";
}

/** The store an organisation is entered through, if it is a store business. */
export function storeOf(orgSlug: string): Tenant | null {
  return tenantsOf(orgSlug).find((t) => t.kind === "store") ?? null;
}

// ── The map ─────────────────────────────────────────────

export const TILE = 48;
/** The stores to the west, the plaza in the middle, the campus to the east: each a short walk. */
export const WORLD_COLUMNS = 62;
/** Two rows of buildings deep: the businesses along the north road, plots for more along the south — and then the sea. */
export const WORLD_ROWS = 39;
export const WORLD_WIDTH = WORLD_COLUMNS * TILE;
export const WORLD_HEIGHT = WORLD_ROWS * TILE;
/** Where the middle stretch — the plaza between the two head offices — begins. */
export const CENTRE_X = 16 * TILE;
/** Where the east stretch — the campus gate — begins. */
export const EAST_X = CENTRE_X + 30 * TILE;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── The shore ───────────────────────────────────────────

/** The first row of open water; everything below it is the sea. */
export const SHORE_ROW = 34;
/** The dock: the centre avenue carried on past the south road and out over the water, in tiles. */
export const DOCK: Rect = { x: CENTRE_X / TILE + 14, y: 32, width: 2, height: 5 };
/** The ferry's picture. */
export const BOAT = { width: 192, height: 168 };

export type Entrance = { kind: "lobby"; tenant: Tenant } | { kind: "campus"; campus: string };

export interface Building {
  org: Organisation;
  /** The picture's footprint, in pixels. */
  frame: Rect;
  /** The part of the footprint a person cannot walk through. */
  solid: Rect;
  /** Walk into this to go inside. Sits on the ground in front of the door. */
  door: Rect;
  /** Where you stand after coming back out. */
  outside: { x: number; y: number };
  entrance: Entrance;
  /** Texture key of the picture. */
  art: string;
  /** The way you walk on coming back out: away from the door. Down, unless said otherwise. */
  arrive?: "up" | "down";
}

function placeBuilding(
  orgSlug: string,
  x: number,
  y: number,
  width: number,
  doorWidth: number,
  entrance: Entrance,
  art: string,
): Building {
  const height = 6 * TILE;
  const frame = { x, y, width, height };
  const doorX = x + (width - doorWidth) / 2;
  return {
    org: org(orgSlug),
    frame,
    // The wall is solid; the doorway is a gap in it so you can walk up to it.
    solid: { x, y, width, height: height - TILE / 2 },
    door: { x: doorX, y: y + height - TILE / 2, width: doorWidth, height: TILE },
    outside: { x: x + width / 2, y: y + height + TILE * 1.25 },
    entrance,
    art,
  };
}

const intoLobby = (slug: string): Entrance => ({ kind: "lobby", tenant: tenantFor(slug)! });
const ontoCampus = (slug: string): Entrance => ({ kind: "campus", campus: slug });

export const BUILDINGS: readonly Building[] = [
  placeBuilding(
    "castle-atlantic",
    CENTRE_X + TILE * 5,
    TILE * 4,
    6 * TILE,
    TILE,
    intoLobby("castle-atlantic"),
    "world-castle",
  ),
  placeBuilding(
    "sandbox-erp",
    CENTRE_X + TILE * 19,
    TILE * 4,
    6 * TILE,
    TILE * 1.5,
    intoLobby("sandbox-erp"),
    "world-office",
  ),
  // West: the two building supply stores, Blockhouse to the north and
  // Chester below it. Their doors open straight into the shop.
  placeBuilding(
    "blockhouse",
    TILE * 4,
    TILE * 2,
    6 * TILE,
    TILE * 1.5,
    intoLobby("blockhouse-store"),
    "world-blocks",
  ),
  placeBuilding(
    "chester",
    TILE * 11,
    TILE * 8,
    6 * TILE,
    TILE * 1.5,
    intoLobby("chester-store"),
    "world-supply",
  ),
  // South-west, off the south road behind the trees: the lab.
  placeBuilding("mettara", TILE * 1, TILE * 21, 6 * TILE, TILE, intoLobby("mettara"), "world-lab"),
  // East: the Homestar campus gate.
  placeBuilding(
    "homestar",
    EAST_X + TILE * 3,
    TILE * 3,
    8 * TILE,
    TILE * 2,
    ontoCampus("homestar"),
    "world-campus",
  ),
  // South: the ferry, moored on the east side of the dock's end. Walking
  // onto the end of the dock boards it, and it sails to the island.
  ferry(),
];

function ferry(): Building {
  const frame = {
    x: (DOCK.x + DOCK.width) * TILE,
    y: SHORE_ROW * TILE - TILE / 2,
    width: BOAT.width,
    height: BOAT.height,
  };
  return {
    org: org("apeiron-media"),
    frame,
    // A boat in the water: all of it is solid, since the water is too.
    solid: frame,
    // The end of the dock, both boards wide, where the gangway comes across.
    door: { x: DOCK.x * TILE, y: (DOCK.y + 3) * TILE, width: DOCK.width * TILE, height: 2 * TILE },
    // Back on the dock at the shore, facing up the avenue.
    outside: { x: DOCK.x * TILE + TILE, y: SHORE_ROW * TILE - TILE / 2 },
    entrance: ontoCampus("apeiron-media"),
    art: "world-boat",
    arrive: "up",
  };
}

/** Where a person appears on the world map with no building to step out of: by the fountain. */
export const WORLD_SPAWN = { x: CENTRE_X + 600, y: 655 };

/** The building a slug — a tenant's or an organisation's — comes out of. */
export function buildingFrom(slug: string | null | undefined): Building | null {
  if (!slug) return null;
  const tenant = tenantFor(slug);
  return (
    BUILDINGS.find((b) =>
      b.entrance.kind === "lobby" ? b.entrance.tenant.slug === slug : b.entrance.campus === slug,
    ) ?? (tenant ? (BUILDINGS.find((b) => b.org.slug === tenant.org) ?? null) : null)
  );
}

/** Where to stand on arrival: outside the building just left, else the road. */
export function spawnFor(fromSlug: string | null | undefined): { x: number; y: number } {
  return buildingFrom(fromSlug)?.outside ?? WORLD_SPAWN;
}
