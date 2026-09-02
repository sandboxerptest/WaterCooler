/**
 * Residents: the AI agents who live in the buildings.
 *
 * A resident belongs to one tenant and has a desk on the agents' floor of
 * that building. They are not people at keyboards: the server walks them
 * about on a loose routine — at their desk, wandering the lobby, or out on
 * the green between the buildings — and everyone who is there sees them.
 *
 * Nothing here touches Phaser, the DOM or the server; the server's
 * simulation and the scenes both read from this.
 */

import { floorRoomSlug } from "../rooms";
import { tenantsOf } from "./tenants";
import { TILE, WIDTH as LOBBY_COLS } from "../map/office";
import { standingSpot } from "./desks";

export interface Resident {
  /** Stable id; also the second half of their office's URL segment. */
  id: string;
  name: string;
  title: string;
  /** Slug of the organisation they work for. */
  tenant: string;
  /** A library sheet key (see WORKER_SPRITES). */
  spriteKey: string;
}

export const RESIDENTS: readonly Resident[] = [
  {
    id: "yoshi",
    name: "Yoshi",
    title: "Data Scientist",
    tenant: "castle-atlantic",
    spriteKey: "character_data_scientist",
  },
];

export function residentsOf(tenantSlug: string): Resident[] {
  return RESIDENTS.filter((r) => r.tenant === tenantSlug);
}

export function residentById(id: string): Resident | null {
  return RESIDENTS.find((r) => r.id === id) ?? null;
}

/** The floor the agents' desks are on. */
export const AGENTS_LEVEL = 2;

/** Which desk slot a resident has on their building's agents' floor. */
export function deskOf(resident: Resident): number {
  return residentsOf(resident.tenant).findIndex((r) => r.id === resident.id);
}

/** Where a resident stands when at their desk: the sprite's centre. */
export function deskSpot(resident: Resident): { x: number; y: number } {
  return standingSpot(Math.max(0, deskOf(resident)));
}

export type Place = "office" | "lobby" | "outside";
export const PLACES: readonly Place[] = ["office", "lobby", "outside"];

/** An organisation's first lobby: where its agents wander and have their desks. */
export function homeLobbyOf(orgSlug: string): string {
  return tenantsOf(orgSlug)[0]?.slug ?? orgSlug;
}

/** The presence room a resident is in at a place; none when outside. */
export function roomForPlace(resident: Resident, place: Place): string | null {
  const lobby = homeLobbyOf(resident.tenant);
  if (place === "lobby") return lobby;
  if (place === "office") return floorRoomSlug(lobby, AGENTS_LEVEL);
  return null;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a resident may wander at a place, as bounds for the sprite's centre.
 * Only the lobby: at their desk they stay at their desk, and outside they
 * stand by the fountain. Inside the walls with a margin, below the top
 * wall's furniture, and clear of the lift in the bottom corner — they are
 * drawn, not simulated, so they must simply never be sent anywhere solid.
 */
export function wanderArea(place: Place): Rect | null {
  if (place !== "lobby") return null;
  // The wide part of the lobby only: the notch below the left part is void.
  return { x: 2 * TILE, y: 7 * TILE, width: (LOBBY_COLS - 5) * TILE, height: 5 * TILE };
}

/** How long a resident stays somewhere before moving on, in milliseconds. */
export const DWELL_MS: Record<Place, [min: number, max: number]> = {
  office: [4 * 60_000, 8 * 60_000],
  lobby: [2 * 60_000, 4 * 60_000],
  outside: [2 * 60_000, 3 * 60_000],
};

/** Somewhere else: never the same place twice in a row. */
export function nextPlace(current: Place, random: () => number = Math.random): Place {
  const options = PLACES.filter((p) => p !== current);
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
}

export function dwell(place: Place, random: () => number = Math.random): number {
  const [min, max] = DWELL_MS[place];
  return min + Math.floor(random() * (max - min));
}

/** Where residents stand when they are outside: in front of the fountain, by the feet. */
export const OUTSIDE_SPOT = { x: 760, y: 668 };

/** What the server tells the scenes about a resident right now. */
export interface Whereabouts {
  id: string;
  name: string;
  title: string;
  spriteKey: string;
  tenant: string;
  place: Place;
  room: string | null;
  since: number;
}
