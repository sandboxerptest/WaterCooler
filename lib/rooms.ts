/**
 * Room identity.
 *
 * A room is named by its slug, and the slug is in the URL — which means the
 * link is the credential. Anyone holding it can walk in, so slugs should be
 * unguessable for anything but a demo.
 *
 * Shared by client and server, so no imports beyond this file.
 */

export const DEFAULT_ROOM_SLUG = "local";

const MAX_SLUG_LENGTH = 40;

/**
 * Reduce anything to a safe slug. Rooms end up as directory names for agent
 * sandboxes, so this has to exclude separators and traversal outright rather
 * than trusting callers.
 */
export function normaliseRoomSlug(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_ROOM_SLUG;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
  return slug || DEFAULT_ROOM_SLUG;
}

/** A random slug with enough entropy that a link cannot be guessed. */
export function generateRoomSlug(randomBytes: () => string): string {
  return `r-${randomBytes()}`;
}

/**
 * What a room path names: the building, and the floor within it.
 *
 * /r/<slug> is the building's lobby; /r/<slug>/floor/<n> is a floor above
 * it. Each is its own room — its own people, seats and conversation — but
 * they share the building's identity.
 */
export function parseRoomPath(pathname: string): { slug: string; floor: number | null } | null {
  const match = pathname.match(/^\/r\/([^/]+)(?:\/floor\/(\d{1,2}))?/);
  if (!match) return null;
  return {
    slug: normaliseRoomSlug(decodeURIComponent(match[1])),
    floor: match[2] ? Number(match[2]) : null,
  };
}

/** The room a floor of a building keeps its people in. */
export function floorRoomSlug(slug: string, level: number): string {
  return normaliseRoomSlug(`${slug}-floor-${level}`);
}

/** Which room this browser is in, taken from /r/<slug>[/floor/<n>] or ?room=<slug>. */
export function roomFromLocation(location: { pathname: string; search: string }): string {
  const path = parseRoomPath(location.pathname);
  if (path) return path.floor !== null ? floorRoomSlug(path.slug, path.floor) : path.slug;

  const params = new URLSearchParams(location.search);
  const query = params.get("room");
  if (query) return normaliseRoomSlug(query);

  return DEFAULT_ROOM_SLUG;
}
