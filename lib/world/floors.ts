/**
 * Floors.
 *
 * A building has a lobby — the main floor everyone arrives on — and two
 * floors above it: Floor 1, where the building's people have their desks,
 * and Floor 2, where its agents do. The lift is how you move between them.
 * Each floor is its own room (see lib/rooms.ts), with its own people and
 * conversation.
 *
 * URLs carry the whole address:
 *   /r/<slug>            the lobby
 *   /r/<slug>/floor/1    the people's floor
 *   /r/<slug>/floor/2    the agents' floor
 * Add ?via=elevator to step out of the lift, or ?via=door to step in from
 * outside; either way you arrive walking, and clear of the doorway.
 *
 * Nothing here touches Phaser or the DOM.
 */

import { floorRoomSlug, parseRoomPath } from "../rooms";
import { TENANTS, tenantFor, type Tenant } from "./tenants";
import { residentsOf } from "./residents";

export type Level = 1 | 2;
export type Floor = { kind: "lobby" } | { kind: "floor"; level: Level };

export const LOBBY: Floor = { kind: "lobby" };
export const PEOPLE_FLOOR: Floor = { kind: "floor", level: 1 };
export const AGENTS_FLOOR: Floor = { kind: "floor", level: 2 };

export interface Address {
  tenant: Tenant;
  floor: Floor;
}

export function addressFromLocation(location: { pathname: string }): Address | null {
  const path = parseRoomPath(location.pathname);
  const tenant = path ? tenantFor(path.slug) : null;
  if (!path || !tenant) return null;
  if (path.floor === null) return { tenant, floor: LOBBY };
  if (path.floor !== 1 && path.floor !== 2) return null;
  return { tenant, floor: { kind: "floor", level: path.floor } };
}

export function floorUrl(tenant: Tenant, floor: Floor, via?: "elevator" | "door"): string {
  const base =
    floor.kind === "lobby" ? `/r/${tenant.slug}` : `/r/${tenant.slug}/floor/${floor.level}`;
  return via ? `${base}?via=${via}` : base;
}

/** The room a floor keeps its people in. */
export function roomForFloor(tenant: Tenant, floor: Floor): string {
  return floor.kind === "lobby" ? tenant.slug : floorRoomSlug(tenant.slug, floor.level);
}

export function sameFloor(a: Floor, b: Floor): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "lobby" || b.kind === "lobby" || a.level === b.level;
}

/** Somebody with a desk. */
export interface Occupant {
  id: string;
  name: string;
}

export interface Person extends Occupant {
  /** Slug of the building they belong to. */
  home: string | null;
}

/** Who has a desk on each floor of a building. */
export interface Occupancy {
  /** The building's people, from the register. */
  people: Occupant[];
}

export interface FloorStop {
  floor: Floor;
  label: string;
  /** Everyone with a desk there, in slot order. */
  names: string[];
}

export function floorTitle(floor: Floor): string {
  if (floor.kind === "lobby") return "Lobby";
  return floor.level === 1 ? "Floor 1 · People" : "Floor 2 · Agents";
}

/** The floors of a building, bottom up, with who sits on each. */
export function floorsOf(tenant: Tenant, occupancy: Occupancy): FloorStop[] {
  return [
    { floor: LOBBY, label: floorTitle(LOBBY), names: [] },
    {
      floor: PEOPLE_FLOOR,
      label: floorTitle(PEOPLE_FLOOR),
      names: occupancy.people.map((p) => p.name),
    },
    {
      floor: AGENTS_FLOOR,
      label: floorTitle(AGENTS_FLOOR),
      names: residentsOf(tenant.slug).map((r) => r.name),
    },
  ];
}

/** Who has a desk on a floor, in slot order. */
export function occupantsOf(tenant: Tenant, floor: Floor, occupancy: Occupancy): Occupant[] {
  if (floor.kind === "lobby") return [];
  if (floor.level === 1) return occupancy.people;
  return residentsOf(tenant.slug).map((r) => ({ id: r.id, name: r.name }));
}

/** What the top bar says about where you are. */
export function describeFloor(address: Address): string {
  return floorTitle(address.floor);
}

export interface ElevatorStop extends FloorStop {
  url: string;
  /** Where the person already is; the button is lit but does nothing. */
  here: boolean;
}

/** The lift's buttons from where you stand. */
export function elevatorStops(address: Address, occupancy: Occupancy): ElevatorStop[] {
  return floorsOf(address.tenant, occupancy).map((stop) => ({
    ...stop,
    url: floorUrl(address.tenant, stop.floor, "elevator"),
    here: sameFloor(stop.floor, address.floor),
  }));
}

/** The map a floor is drawn from. */
export function mapFileFor(address: Address | null): string {
  if (!address) return "/maps/office3.json";
  if (address.floor.kind === "floor") return "/maps/floor.json";
  return `/maps/lobby-${address.tenant.slug}.json`;
}

/** Whether a building slug names a building someone can call home. */
export function isHome(slug: string | null | undefined): slug is string {
  return TENANTS.some((t) => t.slug === slug);
}
