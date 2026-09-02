/**
 * Residents: the AI agents who live in the buildings.
 *
 * A resident belongs to one organisation. Those with a home lobby have a
 * desk on the agents' floor above it; a store's resident has no desk and
 * lives between the shop and the warehouse instead. They are not people
 * at keyboards: the server walks them about on a loose routine through
 * their haunts — the desk, the organisation's rooms, its campus yard, and
 * the green between the buildings — and everyone who is there sees them.
 *
 * Nothing here touches Phaser, the DOM or the server; the server's
 * simulation and the scenes both read from this.
 */

import { floorRoomSlug } from "../rooms";
import { BUILDINGS, hasCampus, hasFloors, tenantsOf, type BuildingKind } from "./tenants";
import { TILE, WIDTH as LOBBY_COLS } from "../map/office";
import { standingSpot } from "./desks";
import { CAMPUSES } from "./campus";

export interface Resident {
  /** Stable id; also the second half of their office's URL segment. */
  id: string;
  name: string;
  title: string;
  /** Slug of the organisation they work for. */
  org: string;
  /** The lobby whose agents' floor holds their desk; null for someone with no desk. */
  home: string | null;
  /** A library sheet key (see WORKER_SPRITES). */
  spriteKey: string;
}

export const RESIDENTS: readonly Resident[] = [
  {
    id: "yoshi",
    name: "Yoshi",
    title: "Data Scientist",
    org: "castle-atlantic",
    home: "castle-atlantic",
    spriteKey: "character_data_scientist",
  },
  {
    id: "sara",
    name: "Sara",
    title: "Operations",
    org: "sandbox-erp",
    home: "sandbox-erp",
    spriteKey: "character_sara",
  },
  {
    id: "spud",
    name: "Spud",
    title: "Support",
    org: "sandbox-erp",
    home: "sandbox-erp",
    spriteKey: "character_spud",
  },
  {
    id: "yash",
    name: "Yash",
    title: "Research",
    org: "mettara",
    home: "mettara",
    spriteKey: "character_yash",
  },
  {
    id: "steve",
    name: "Steve",
    title: "Store Manager",
    org: "chester",
    home: null,
    spriteKey: "character_steve",
  },
  {
    id: "mark",
    name: "Mark",
    title: "Sales",
    org: "homestar",
    home: "homestar-sales",
    spriteKey: "character_mark",
  },
];

/** Everyone who works for an organisation. */
export function residentsOf(orgSlug: string): Resident[] {
  return RESIDENTS.filter((r) => r.org === orgSlug);
}

/** Everyone with a desk above a lobby, in desk order. */
export function residentsAt(lobbySlug: string): Resident[] {
  return RESIDENTS.filter((r) => r.home === lobbySlug);
}

export function residentById(id: string): Resident | null {
  return RESIDENTS.find((r) => r.id === id) ?? null;
}

/** The floor the agents' desks are on. */
export const AGENTS_LEVEL = 2;

/** Which desk slot a resident has on their building's agents' floor; -1 without one. */
export function deskOf(resident: Resident): number {
  if (!resident.home) return -1;
  return residentsAt(resident.home).findIndex((r) => r.id === resident.id);
}

/** Where a resident stands when at their desk: the sprite's centre. */
export function deskSpot(resident: Resident): { x: number; y: number } {
  return standingSpot(Math.max(0, deskOf(resident)));
}

// ── Haunts ──────────────────────────────────────────────

/** What kind of floor a room has, for where one may wander in it. */
export type Area = "lobby" | BuildingKind;

/** Somewhere a resident goes. */
export type Haunt =
  | { kind: "office" }
  | { kind: "room"; room: string; area: Area }
  | { kind: "campus"; campus: string }
  | { kind: "outside" };

export type PlaceKind = Haunt["kind"];

/** One string per haunt, to tell them apart. */
export function hauntKey(haunt: Haunt): string {
  switch (haunt.kind) {
    case "room":
      return `room:${haunt.room}`;
    case "campus":
      return `campus:${haunt.campus}`;
    default:
      return haunt.kind;
  }
}

/**
 * Everywhere a resident goes: their desk, every room of their
 * organisation — each lobby, or the store and the rooms behind it — the
 * campus yard if there is one, and outside.
 */
export function hauntsOf(resident: Resident): Haunt[] {
  const haunts: Haunt[] = [];
  if (resident.home) haunts.push({ kind: "office" });
  for (const tenant of tenantsOf(resident.org)) {
    const area: Area = hasFloors(tenant) ? "lobby" : (tenant.kind ?? "lobby");
    haunts.push({ kind: "room", room: tenant.slug, area });
  }
  if (hasCampus(resident.org)) haunts.push({ kind: "campus", campus: resident.org });
  haunts.push({ kind: "outside" });
  return haunts;
}

/** The presence room a resident is in at a haunt; none outside or on a yard. */
export function roomForHaunt(resident: Resident, haunt: Haunt): string | null {
  if (haunt.kind === "office")
    return resident.home ? floorRoomSlug(resident.home, AGENTS_LEVEL) : null;
  if (haunt.kind === "room") return haunt.room;
  return null;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a resident may wander in a room, as bounds for the sprite's centre.
 * They are drawn, not simulated, so they must simply never be sent
 * anywhere solid: each is the open floor of its kind of room, clear of
 * the furniture and the lift.
 */
export const WANDER_AREAS: Record<Area, Rect> = {
  // The wide part of the lobby: inside the walls with a margin, below the
  // top wall's furniture, and clear of the lift in the bottom corner.
  lobby: { x: 2 * TILE, y: 7 * TILE, width: (LOBBY_COLS - 5) * TILE, height: 5 * TILE },
  // The front of the shop, left of the window shelving and above the first aisle.
  store: { x: 1.5 * TILE, y: 4 * TILE, width: 8.5 * TILE, height: 1.5 * TILE },
  // The aisle between the two rows of racks.
  warehouse: { x: 1.5 * TILE, y: 6.5 * TILE, width: 13 * TILE, height: 0.75 * TILE },
  // Between the workbenches and the van bays.
  garage: { x: 1.5 * TILE, y: 4.75 * TILE, width: 15 * TILE, height: 1.25 * TILE },
  // An office on a campus is a lobby with floors, and wanders as one.
  office: { x: 2 * TILE, y: 7 * TILE, width: (LOBBY_COLS - 5) * TILE, height: 5 * TILE },
};

/** Where a resident may wander at a haunt; nowhere at the desk, outside or on a yard. */
export function wanderArea(haunt: Haunt): Rect | null {
  return haunt.kind === "room" ? WANDER_AREAS[haunt.area] : null;
}

/** The paved yard of a campus, in campus pixels, as bounds for the feet: well inside its edges. */
export function yardArea(campus: string): Rect {
  const yard = CAMPUSES[campus]?.paved[0];
  if (!yard) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: (yard.x + 0.5) * TILE,
    y: yard.y * TILE + 24,
    width: (yard.width - 1) * TILE,
    height: yard.height * TILE - 32,
  };
}

/** How long a resident stays somewhere before moving on, in milliseconds. */
export const DWELL_MS: Record<PlaceKind, [min: number, max: number]> = {
  office: [4 * 60_000, 8 * 60_000],
  room: [2 * 60_000, 4 * 60_000],
  campus: [2 * 60_000, 3 * 60_000],
  outside: [2 * 60_000, 3 * 60_000],
};

/** Somewhere else: never the same haunt twice in a row. */
export function nextHaunt(
  resident: Resident,
  current: Haunt,
  random: () => number = Math.random,
): Haunt {
  const key = hauntKey(current);
  const options = hauntsOf(resident).filter((h) => hauntKey(h) !== key);
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
}

export function dwell(place: PlaceKind, random: () => number = Math.random): number {
  const [min, max] = DWELL_MS[place];
  return min + Math.floor(random() * (max - min));
}

// ── Outside ─────────────────────────────────────────────

/** Where residents stand when they are outside: in front of the fountain, by the feet. */
export const OUTSIDE_SPOT = { x: 760, y: 668 };

/**
 * Where a resident may stand on the world map, by the feet: their own
 * place by the fountain, or beside the path to their building's door.
 */
export function outsideSpots(resident: Resident): { x: number; y: number }[] {
  const index = Math.max(
    0,
    RESIDENTS.findIndex((r) => r.id === resident.id),
  );
  const spots = [{ x: OUTSIDE_SPOT.x + index * 40, y: OUTSIDE_SPOT.y }];
  const building = BUILDINGS.find((b) => b.org.slug === resident.org);
  if (building) spots.push({ x: building.outside.x + 60, y: building.outside.y + 43 });
  return spots;
}

/** What the server tells the scenes about a resident right now. */
export interface Whereabouts {
  id: string;
  name: string;
  title: string;
  spriteKey: string;
  org: string;
  place: PlaceKind;
  /** The presence room they are in, for rooms and the office. */
  room: string | null;
  /** The yard they are on, for a campus. */
  campus: string | null;
  /** Where they stand, by the feet, on the world map or a yard. */
  spot: { x: number; y: number } | null;
  since: number;
}
