/**
 * A room slug, said the way a person would: "Castle Atlantic · Lobby",
 * "Sandbox ERP · Floor 2 · Agents", "World map", "Apeiron Media · Ireland".
 *
 * Rooms are named by slug on the socket; the People panel turns those back
 * into places. Nothing here touches Phaser or the DOM.
 */

import { WORLD_ROOM_SLUG } from "../rooms";
import { CAMPUSES } from "./campus";
import { floorTitle } from "./floors";
import { hasFloors, organisationFor, tenantFor, tenantTitle } from "./tenants";

const CAMPUS_PREFIX = "campus-";
const FLOOR = /^(.+)-floor-(\d{1,2})$/;

export interface Place {
  /** Where, in words. */
  label: string;
  /** Outdoors, a building's ground floor, a floor above it, or somewhere unknown. */
  kind: "world" | "campus" | "lobby" | "floor" | "unknown";
}

export function describeRoom(slug: string): Place {
  if (slug === WORLD_ROOM_SLUG) return { label: "World map", kind: "world" };

  if (slug.startsWith(CAMPUS_PREFIX)) {
    const org = slug.slice(CAMPUS_PREFIX.length);
    const company = organisationFor(org);
    const campus = CAMPUSES[org];
    if (company) {
      return { label: `${company.name} · ${campus?.place ?? "Campus"}`, kind: "campus" };
    }
  }

  const floor = slug.match(FLOOR);
  if (floor) {
    const tenant = tenantFor(floor[1]);
    const level = Number(floor[2]);
    if (tenant && (level === 1 || level === 2)) {
      return {
        label: `${tenantTitle(tenant)} · ${floorTitle({ kind: "floor", level })}`,
        kind: "floor",
      };
    }
  }

  const tenant = tenantFor(slug);
  if (tenant) {
    return {
      label: hasFloors(tenant) ? `${tenantTitle(tenant)} · Lobby` : tenantTitle(tenant),
      kind: "lobby",
    };
  }

  return { label: slug, kind: "unknown" };
}
